#!/usr/bin/env php
<?php

// WP-OPS-A71 — WhatsApp-system subscribers (ERPNext POS subscriptions, not in the Partner feed)
// as Fleetbase orders for one delivery day, so they appear on Batch Labels with a driver.
//
// A second, independent writer next to nutreeze-orders.php. It owns ONLY records under its own
// prefix (NUTREEZE-WA-DAY-YYYYMMDD) and owner marker (nutreeze_whatsapp_subscribers); the Partner
// sync selects by its own prefix and never sees these. Partner records are read, never written:
// the driver of an area and the area's centre come from that day's Partner orders (in the legacy
// system every area has exactly one driver per day).
//
// Input: a root-only JSON file {delivery_date, rows:[{ref, order_number, customer_name,
// customer_phone, area, address_text, plan}]}. Output: JSON lines without customer data.

declare(strict_types=1);

use Fleetbase\FleetOps\Models\Contact;
use Fleetbase\FleetOps\Models\Order;
use Fleetbase\FleetOps\Models\OrderConfig;
use Fleetbase\FleetOps\Models\Payload;
use Fleetbase\FleetOps\Models\Place;
use Fleetbase\FleetOps\Models\TrackingNumber;
use Fleetbase\FleetOps\Models\TrackingStatus;
use Fleetbase\FleetOps\Support\LiveCacheService;
use Fleetbase\FleetOps\Support\Utils as FleetOpsUtils;
use Fleetbase\LaravelMysqlSpatial\Types\Point;
use Fleetbase\Support\ApiModelCache;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Milon\Barcode\Facades\DNS2DFacade as DNS2D;
use Spatie\ResponseCache\Facades\ResponseCache;

ini_set('display_errors', '0');
error_reporting(E_ALL);

try {
    require '/fleetbase/api/vendor/autoload.php';
    $app = require '/fleetbase/api/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
} catch (Throwable) {
    fwrite(STDOUT, "{\"event\":\"fatal\",\"stage\":\"bootstrap\"}\n");
    exit(1);
}

const WA_OWNER = 'nutreeze_whatsapp_subscribers';
const WA_PREFIX = 'NUTREEZE-WA';
const PARTNER_DAY_PREFIX = 'NUTREEZE-PARTNER-DAY';
const WA_MAPPING_VERSION = 1;
const CONFIG_DIR = '/fleetbase/api/storage/app/integrations/config';
const CALL_INSTRUCTION = 'NO EXACT PIN - CALL CUSTOMER / لا يوجد موقع دقيق - اتصل بالعميل';
const CALL_PLACE_PREFIX = 'CALL CUSTOMER FIRST / اتصل بالعميل أولا - ';

function out(string $event, array $fields = []): void
{
    fwrite(STDOUT, json_encode(['event' => $event] + $fields, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
}

function metaOf(mixed $value): array
{
    if (is_array($value)) {
        return $value;
    }
    if (is_object($value)) {
        return json_decode(json_encode($value), true) ?: [];
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
    return [];
}

function quietSave(object $model): bool
{
    if (method_exists($model, 'disableLogging')) {
        $model->disableLogging();
    }
    if (($model->exists ?? false) && !$model->isDirty()) {
        return false;
    }
    if (!($model->exists ?? false)) {
        if (empty($model->uuid)) {
            $model->setAttribute('uuid', $model::generateUuid());
        }
        if (method_exists($model, 'generatePublicId') && empty($model->public_id)) {
            $model->setAttribute('public_id', $model::generatePublicId());
        }
    }
    if (!$model::withoutEvents(fn (): bool => (bool) $model->save())) {
        throw new RuntimeException('fleetbase_save_rejected');
    }
    return true;
}

function setMeta(object $model, array $updates): void
{
    $current = metaOf($model->meta ?? null);
    $next = array_replace($current, $updates);
    if ($next !== $current) {
        $model->setAttribute('meta', $next);
    }
}

function areaKey(?string $area): string
{
    return preg_replace('/[^a-z]/', '', strtolower((string) $area)) ?? '';
}

function loadJson(string $path, bool $required): array
{
    if (!is_file($path)) {
        if ($required) {
            throw new RuntimeException('config_missing:' . basename($path));
        }
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        throw new RuntimeException('config_invalid:' . basename($path));
    }
    return $data;
}

final class WaWriter
{
    private string $company;
    private string $orderConfig;
    private string $trackingPrefix;
    private string $prefix;
    private array $pickup;
    public array $stats = [
        'created' => 0, 'updated' => 0, 'unchanged' => 0, 'canceled' => 0,
        'with_driver' => 0, 'no_driver' => 0, 'driver_from_day' => 0, 'driver_from_memory' => 0,
    ];
    public array $noDriverAreas = [];

    public function __construct(private string $day, private bool $dryRun)
    {
        $companies = DB::table('companies')->pluck('uuid');
        if ($companies->count() !== 1) {
            throw new RuntimeException('fleetbase_company_scope');
        }
        $this->company = (string) $companies->first();
        $configs = OrderConfig::withoutGlobalScopes()->where('key', 'transport')->whereNull('deleted_at')
            ->where('company_uuid', $this->company)->get();
        if ($configs->isEmpty()) {
            $configs = OrderConfig::withoutGlobalScopes()->where('key', 'transport')->whereNull('deleted_at')
                ->whereNull('company_uuid')->get();
        }
        if ($configs->count() !== 1) {
            throw new RuntimeException('fleetbase_order_config');
        }
        $this->orderConfig = (string) $configs->first()->uuid;
        $name = (string) (DB::table('companies')->where('uuid', $this->company)->value('name') ?? '');
        $letters = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name) ?? '', 0, 3));
        $this->trackingPrefix = strlen($letters) === 3 ? $letters : 'FLB';
        $this->prefix = WA_PREFIX . '-DAY-' . str_replace('-', '', $day);
        $this->pickup = loadJson(CONFIG_DIR . '/nutreeze-pickup.json', true);
    }

    /** area key → ['driver' => uuid|null, 'lat', 'lng', 'area_en'] from that day's Partner orders. */
    private function partnerAreas(): array
    {
        $rows = DB::table('orders as o')
            ->join('payloads as p', 'p.uuid', '=', 'o.payload_uuid')
            ->where('o.company_uuid', $this->company)
            ->where('o.internal_id', 'like', PARTNER_DAY_PREFIX . '-' . str_replace('-', '', $this->day) . '-ORDER-%')
            ->whereNull('o.deleted_at')
            ->whereNotNull('o.driver_assigned_uuid')
            ->where('o.status', 'not like', '%cancel%')
            ->get(['o.driver_assigned_uuid as driver', 'o.meta as meta', 'p.dropoff_uuid as place']);
        $locations = [];
        foreach ($rows->pluck('place')->filter()->unique()->chunk(500) as $chunk) {
            foreach (Place::withoutGlobalScopes()->whereIn('uuid', $chunk->all())->get(['uuid', 'location']) as $place) {
                if ($place->location instanceof Point) {
                    $locations[$place->uuid] = [$place->location->getLat(), $place->location->getLng()];
                }
            }
        }
        $areas = [];
        foreach ($rows as $row) {
            $meta = metaOf($row->meta);
            $name = (string) ($meta['routing_area'] ?? $meta['area_en'] ?? '');
            $key = areaKey($name);
            if ($key === '') {
                continue;
            }
            $areas[$key] ??= ['drivers' => [], 'lat' => 0.0, 'lng' => 0.0, 'n' => 0, 'area_en' => $name];
            $areas[$key]['drivers'][$row->driver] = ($areas[$key]['drivers'][$row->driver] ?? 0) + 1;
            if (isset($locations[$row->place])) {
                $areas[$key]['lat'] += $locations[$row->place][0];
                $areas[$key]['lng'] += $locations[$row->place][1];
                $areas[$key]['n']++;
            }
        }
        $result = [];
        foreach ($areas as $key => $area) {
            arsort($area['drivers']);
            if ($area['n'] === 0) {
                continue;
            }
            $result[$key] = [
                'driver' => (string) array_key_first($area['drivers']),
                'lat' => $area['lat'] / $area['n'],
                'lng' => $area['lng'] / $area['n'],
                'area_en' => $area['area_en'],
            ];
        }
        return $result;
    }

    public function run(array $rows): void
    {
        $aliases = loadJson(CONFIG_DIR . '/nutreeze-wa-area-aliases.json', false);
        $memoryPath = CONFIG_DIR . '/nutreeze-wa-area-memory.json';
        $memory = loadJson($memoryPath, false);
        $today = $this->partnerAreas();
        out('areas', ['partner_areas_today' => count($today), 'remembered' => count($memory)]);

        $activeDrivers = DB::table('drivers')->where('company_uuid', $this->company)->whereNull('deleted_at')
            ->pluck('uuid')->flip();
        $pickup = $this->dryRun ? null : $this->pickupPlace();
        $seen = [];
        foreach ($rows as $row) {
            $key = areaKey($row['area']);
            $key = areaKey($aliases[$key] ?? $key);
            // "Qurain" and "Al Qurain" are the same area in the legacy list.
            foreach ([$key, 'al' . $key, str_starts_with($key, 'al') ? substr($key, 2) : $key] as $candidate) {
                if ($candidate !== '' && (isset($today[$candidate]) || isset($memory[$candidate]))) {
                    $key = $candidate;
                    break;
                }
            }
            $source = null;
            $hit = $today[$key] ?? null;
            if ($hit !== null) {
                $source = 'day';
            } elseif (isset($memory[$key]) && isset($activeDrivers[$memory[$key]['driver'] ?? ''])) {
                $hit = $memory[$key];
                $source = 'memory';
            }
            $driver = $hit['driver'] ?? null;
            if ($driver === null) {
                $this->stats['no_driver']++;
                $this->noDriverAreas[$row['area'] === '' ? '(blank)' : $row['area']] = true;
            } else {
                $this->stats['with_driver']++;
                $this->stats[$source === 'day' ? 'driver_from_day' : 'driver_from_memory']++;
            }
            $pin = $hit !== null
                ? ['lat' => (float) $hit['lat'], 'lng' => (float) $hit['lng']]
                : ['lat' => (float) $this->pickup['lat'], 'lng' => (float) $this->pickup['lng']];
            $seen[$this->prefix . '-ORDER-' . $row['ref']] = true;
            if (!$this->dryRun) {
                $this->upsert($row, $driver, $pin, (string) ($hit['area_en'] ?? $row['area']), $source, $pickup);
            }
        }
        if (!$this->dryRun) {
            $this->cancelMissing($seen);
            foreach ($today as $key => $area) {
                $memory[$key] = $area + ['seen' => $this->day];
            }
            file_put_contents($memoryPath, json_encode($memory, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
            chmod($memoryPath, 0600);
        }
    }

    private function pickupPlace(): Place
    {
        $key = WA_PREFIX . '-PICKUP';
        $place = Place::withoutGlobalScopes()->where('company_uuid', $this->company)
            ->where('meta->integration_key', $key)->first() ?? new Place();
        $place->fill([
            'company_uuid' => $this->company,
            'name' => $this->pickup['name'],
            'street1' => $this->pickup['street1'],
            'city' => $this->pickup['city'],
            'district' => $this->pickup['city'],
            'country' => $this->pickup['country'],
        ]);
        if (!($place->location instanceof Point)) {
            $place->setAttribute('location', new Point((float) $this->pickup['lat'], (float) $this->pickup['lng']));
        }
        setMeta($place, ['integration_owner' => WA_OWNER, 'integration_key' => $key, 'shared_pickup' => true]);
        quietSave($place);
        return $place;
    }

    private function owned(object $model): void
    {
        $meta = metaOf($model->meta);
        if (($meta['integration_owner'] ?? null) !== WA_OWNER || $model->company_uuid !== $this->company) {
            throw new RuntimeException('wa_foreign_record');
        }
    }

    private function upsert(array $row, ?string $driver, array $pin, string $areaEn, ?string $driverSource, Place $pickup): void
    {
        $internalId = $this->prefix . '-ORDER-' . $row['ref'];
        $order = Order::withoutGlobalScopes()->where('company_uuid', $this->company)
            ->where('internal_id', $internalId)->lockForUpdate()->first();
        $created = $order === null;
        $order ??= new Order();
        if (!$created) {
            $this->owned($order);
            if ((bool) $order->started || $order->started_at !== null) {
                $this->stats['unchanged']++;
                return;
            }
        }

        $contactId = WA_PREFIX . '-CUSTOMER-' . $row['ref'];
        $contact = Contact::withoutGlobalScopes()->where('company_uuid', $this->company)
            ->where('internal_id', $contactId)->lockForUpdate()->first() ?? new Contact();
        if ($contact->exists) {
            $this->owned($contact);
        }
        $contact->fill([
            'company_uuid' => $this->company, 'internal_id' => $contactId, 'name' => $row['customer_name'],
            'phone' => $row['customer_phone'], 'type' => 'customer',
        ]);
        setMeta($contact, ['integration_owner' => WA_OWNER, 'source_customer_ref' => $row['ref']]);
        $contact->setAttribute('deleted_at', null);
        $changed = quietSave($contact);

        $payload = $order->payload_uuid
            ? Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first()
            : null;
        $payload ??= new Payload();
        if ($payload->exists) {
            $this->owned($payload);
        }
        $payload->fill(['company_uuid' => $this->company, 'pickup_uuid' => $pickup->uuid]);
        setMeta($payload, [
            'integration_owner' => WA_OWNER, 'integration_prefix' => $this->prefix,
            'source_order_number' => $row['order_number'], 'address_text' => $row['address_text'],
        ]);
        $payload->setAttribute('deleted_at', null);
        $changed = quietSave($payload) || $changed;

        $place = $payload->dropoff_uuid
            ? Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first()
            : null;
        $place ??= new Place();
        if ($place->exists) {
            $this->owned($place);
        }
        $place->fill([
            'company_uuid' => $this->company, 'owner_uuid' => $contact->uuid, 'owner_type' => Contact::class,
            'name' => CALL_PLACE_PREFIX . 'WhatsApp ' . $row['order_number'] . ' - ' . $areaEn,
            'street1' => $row['address_text'], 'street2' => CALL_INSTRUCTION,
            'city' => $areaEn, 'district' => $areaEn, 'country' => 'KW', 'phone' => $row['customer_phone'],
        ]);
        if (!($place->location instanceof Point)
            || abs($place->location->getLat() - $pin['lat']) > 0.000001
            || abs($place->location->getLng() - $pin['lng']) > 0.000001) {
            $place->setAttribute('location', new Point($pin['lat'], $pin['lng']));
        }
        setMeta($place, [
            'integration_owner' => WA_OWNER, 'integration_prefix' => $this->prefix,
            'integration_key' => $this->prefix . '-PLACE-' . $row['ref'], 'pin_source' => 'area_fallback',
            'routing_area' => $areaEn, 'area_en' => $areaEn,
        ]);
        $place->setAttribute('deleted_at', null);
        $changed = quietSave($place) || $changed;
        if ($payload->dropoff_uuid !== $place->uuid) {
            $payload->dropoff_uuid = $place->uuid;
            quietSave($payload);
            $changed = true;
        }

        $scheduledAt = (new DateTimeImmutable($this->day . ' ' . $this->pickup['dispatch_time'] . ':00', new DateTimeZone('Asia/Kuwait')))
            ->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $holdReason = $driver === null ? 'no_driver_for_area' : null;
        $order->fill([
            'company_uuid' => $this->company, 'internal_id' => $internalId, 'order_config_uuid' => $this->orderConfig,
            'customer_uuid' => $contact->uuid, 'customer_type' => Contact::class, 'payload_uuid' => $payload->uuid,
            'type' => 'transport',
            'notes' => 'WhatsApp subscriber ' . $row['order_number'] . ' | ' . $row['plan'] . ' | ' . CALL_INSTRUCTION,
            'driver_assigned_uuid' => $driver,
            'scheduled_at' => $driver === null ? null : $scheduledAt,
            'status' => $driver === null ? 'created' : 'dispatched',
            'dispatched' => $driver !== null,
            'dispatched_at' => $driver === null ? null : ($order->dispatched_at ?? gmdate('Y-m-d H:i:s')),
        ]);
        setMeta($order, [
            'integration_owner' => WA_OWNER, 'integration_prefix' => $this->prefix,
            'mapping_version' => WA_MAPPING_VERSION, 'source' => 'erpnext_whatsapp_subscription',
            'source_order_number' => $row['order_number'], 'source_customer_ref' => $row['ref'],
            'delivery_date' => $this->day, 'routing_area' => $areaEn, 'area_en' => $areaEn,
            'pin_source' => 'area_fallback', 'call_customer_required' => true,
            'dispatch_state' => $driver === null ? 'held_no_driver_for_area' : 'dispatched_call_customer_required',
            'hold_reason' => $holdReason, 'driver_source' => $driverSource,
            'dispatch_time_local' => $this->pickup['dispatch_time'], 'dispatch_timezone' => 'Asia/Kuwait',
            // A71.2: printed on the label as they are in ERPNext today (the label database may hold an older address).
            'label_address' => ['area' => $areaEn, 'block' => $row['block'], 'street' => $row['street'],
                'flat' => $row['house'], 'direction' => $row['details']],
            'label_package' => $row['plan'], 'label_days_remaining' => $row['days_remaining'],
        ]);
        $order->setAttribute('deleted_at', null);
        $changed = quietSave($order) || $changed;
        $this->tracking($order, $pin, $driver !== null);
        $this->stats[$created ? 'created' : ($changed ? 'updated' : 'unchanged')]++;
    }

    private function tracking(Order $order, array $pin, bool $dispatched): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $number = $order->tracking_number_uuid
            ?: DB::table('tracking_numbers')->where('owner_uuid', $order->uuid)->whereNull('deleted_at')->orderBy('id')->value('uuid');
        if ($number === null) {
            do {
                $text = $this->trackingPrefix;
                for ($i = 0; $i < 10; $i++) {
                    $text .= random_int(0, 9);
                }
                $text .= 'KW';
            } while (DB::table('tracking_numbers')->where('tracking_number', $text)->exists());
            $number = TrackingNumber::generateUuid();
            DB::table('tracking_numbers')->insert([
                'uuid' => $number, 'public_id' => TrackingNumber::generatePublicId('track'), '_key' => 'console',
                'company_uuid' => $this->company, 'owner_uuid' => $order->uuid, 'owner_type' => Order::class,
                'region' => 'KW', 'tracking_number' => $text,
                'qr_code' => DNS2D::getBarcodePNG($order->uuid, 'QRCODE'),
                'barcode' => DNS2D::getBarcodePNG($order->uuid, 'PDF417'), 'created_at' => $now,
            ]);
        }
        $wanted = [['CREATED', 'Order Created', 'New order created.', $pin]];
        if ($dispatched) {
            $wanted[] = ['DISPATCHED', 'Order Dispatched', 'Order has been dispatched.',
                ['lat' => (float) $this->pickup['lat'], 'lng' => (float) $this->pickup['lng']]];
        }
        $last = null;
        foreach ($wanted as [$code, $status, $details, $at]) {
            $last = DB::table('tracking_statuses')->where('tracking_number_uuid', $number)->whereNull('deleted_at')
                ->where('code', $code)->orderBy('id')->value('uuid');
            if ($last === null) {
                $last = TrackingStatus::generateUuid();
                DB::table('tracking_statuses')->insert([
                    'uuid' => $last, 'public_id' => TrackingStatus::generatePublicId('status'), '_key' => 'console',
                    'company_uuid' => $this->company, 'tracking_number_uuid' => $number, 'status' => $status,
                    'details' => $details, 'code' => $code, 'complete' => 0,
                    'location' => FleetOpsUtils::parsePointToWkt(new Point($at['lat'], $at['lng'])), 'created_at' => $now,
                ]);
            }
        }
        if (DB::table('tracking_numbers')->where('uuid', $number)->value('status_uuid') !== $last) {
            DB::table('tracking_numbers')->where('uuid', $number)->update(['status_uuid' => $last, 'updated_at' => $now]);
        }
        if ($order->tracking_number_uuid !== $number) {
            DB::table('orders')->where('uuid', $order->uuid)->update(['tracking_number_uuid' => $number]);
            $order->setAttribute('tracking_number_uuid', $number);
            $order->syncOriginalAttribute('tracking_number_uuid');
        }
    }

    /** A subscriber no longer active for the day: cancel the (unstarted) order, keep it as a record. */
    private function cancelMissing(array $seen): void
    {
        $orders = Order::withoutGlobalScopes()->where('company_uuid', $this->company)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')->whereNull('deleted_at')->lockForUpdate()->get();
        foreach ($orders as $order) {
            if (isset($seen[$order->internal_id]) || str_contains((string) $order->status, 'cancel')) {
                continue;
            }
            $this->owned($order);
            if ((bool) $order->started || $order->started_at !== null) {
                continue;
            }
            $order->fill(['status' => 'canceled', 'driver_assigned_uuid' => null, 'scheduled_at' => null,
                'dispatched' => false, 'dispatched_at' => null]);
            setMeta($order, ['hold_reason' => 'source_row_missing', 'dispatch_state' => 'canceled_source_row_missing']);
            quietSave($order);
            $this->stats['canceled']++;
        }
    }

    public function invalidate(): void
    {
        $previous = session('company');
        try {
            session(['company' => $this->company]);
            LiveCacheService::invalidateMultiple(['orders', 'routes', 'coordinates', 'drivers', 'places', 'operations-monitor']);
            foreach ([Order::class, Payload::class, Contact::class, Place::class, TrackingNumber::class, TrackingStatus::class] as $class) {
                ApiModelCache::invalidateModelCache(new $class(), $this->company);
            }
            ResponseCache::clear();
        } finally {
            session(['company' => $previous]);
        }
    }
}

$options = getopt('', ['delivery-date:', 'input:', 'dry-run']);
$day = (string) ($options['delivery-date'] ?? '');
$input = (string) ($options['input'] ?? '');
$dryRun = array_key_exists('dry-run', $options);
try {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) || !checkdate((int) substr($day, 5, 2), (int) substr($day, 8, 2), (int) substr($day, 0, 4))) {
        throw new RuntimeException('delivery_date_invalid');
    }
    $data = loadJson($input, true);
    if (($data['delivery_date'] ?? null) !== $day || !is_array($data['rows'] ?? null)) {
        throw new RuntimeException('input_day_mismatch');
    }
    $rows = [];
    foreach ($data['rows'] as $row) {
        $ref = (string) ($row['ref'] ?? '');
        if (!preg_match('/^[0-9]{6,15}$/', $ref) || isset($rows[$ref])
            || !preg_match('/^WA-[0-9]{6,15}$/', (string) ($row['order_number'] ?? ''))
            || trim((string) ($row['customer_name'] ?? '')) === '' || trim((string) ($row['customer_phone'] ?? '')) === '') {
            throw new RuntimeException('input_row_invalid');
        }
        $rows[$ref] = [
            'ref' => $ref, 'order_number' => (string) $row['order_number'],
            'customer_name' => trim((string) $row['customer_name']), 'customer_phone' => trim((string) $row['customer_phone']),
            'area' => trim((string) ($row['area'] ?? '')), 'address_text' => trim((string) ($row['address_text'] ?? '')),
            'plan' => trim((string) ($row['plan'] ?? '')),
            'block' => trim((string) ($row['block'] ?? '')), 'street' => trim((string) ($row['street'] ?? '')),
            'house' => trim((string) ($row['house'] ?? '')), 'details' => trim((string) ($row['details'] ?? '')),
            'days_remaining' => is_int($row['days_remaining'] ?? null) ? $row['days_remaining'] : null,
        ];
    }
    $lock = fopen('/tmp/nutreeze-wa-orders.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
        throw new RuntimeException('wa_lock_busy');
    }
    $writer = new WaWriter($day, $dryRun);
    DB::transaction(fn () => $writer->run(array_values($rows)));
    if (!$dryRun) {
        $writer->invalidate();
    }
    out('complete', ['delivery_date' => $day, 'dry_run' => $dryRun, 'rows' => count($rows)] + $writer->stats
        + ['no_driver_areas' => array_keys($writer->noDriverAreas)]);
    exit(0);
} catch (Throwable $error) {
    out('fatal', ['error' => $error instanceof RuntimeException && !($error instanceof PDOException)
        ? $error->getMessage() : get_class($error), 'line' => $error->getLine()]);
    exit(1);
}
