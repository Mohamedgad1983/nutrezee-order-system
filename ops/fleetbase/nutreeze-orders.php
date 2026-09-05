#!/usr/bin/env php
<?php

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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Milon\Barcode\Facades\DNS2DFacade as DNS2D;
use Spatie\ResponseCache\Facades\ResponseCache;

ini_set('display_errors', '0');
error_reporting(E_ALL);

try {
    require '/fleetbase/api/vendor/autoload.php';
    $app = require '/fleetbase/api/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
} catch (Throwable) {
    fwrite(STDOUT, "{\"event\":\"fatal\",\"stage\":\"bootstrap\",\"error_class\":\"BootstrapError\",\"error_code\":\"internal_error\"}\n");
    exit(1);
}

const VENDOR_BASE = 'https://nutreeze.com/integration';
const DEFAULT_PREFIX = 'NUTREEZE-PARTNER';
const DEFAULT_DAILY_PREFIX = 'NUTREEZE-PARTNER-DAY';
const DEFAULT_LIMIT = 200;
const MAPPING_VERSION = 2;
const DAILY_MAPPING_VERSION = 4;
// Fleetbase driver assignment is a mirror of Partner's own driver.id. The bridge
// never invents an assignment: a routable order without a mapped Partner driver
// is held, never hashed onto a roster driver.
const PARTNER_DRIVER_ASSIGNMENT_MODE = 'partner_driver_id_v1';
const PARTNER_DRIVER_ASSIGNMENT_MODE_CALL_REQUIRED = 'partner_driver_id_call_required_v1';
const PARTNER_DRIVER_MAP_SCHEMA_VERSION = 1;
const DAILY_SOURCE_SELECTOR = 'partner_daily_deliveries_v1';
const INTEGRATION_CONFIG_ROOT = '/fleetbase/api/storage/app/integrations/config';
const DAILY_DISPATCHABLE_MEAL_STATUSES = ['ordered', 'driver_assigned'];
/** WP-OPS-07 (A50): daytime cancel-only reconciliation withdraws exactly these source states. */
const DAILY_WITHDRAWAL_HOLD_REASONS = ['source_order_canceled', 'unapproved_meal_status'];
const DAILY_DISPATCHABLE_ORDER_STATUSES = ['success'];
// Sponsor amendment A19 authorizes address/area fallback dispatch for this
// delivery date only. A matching runtime confirmation is still mandatory, and
// the unattended timer deliberately never supplies it.
const ADDRESS_CALL_AUTHORIZED_DATES = ['2026-07-20'];
const ADDRESS_CALL_AUTHORIZATION = 'A19';
// A57 (owner, 2026-09-05): call-customer dispatch is a STANDING policy from this delivery
// date on. A Partner order with a driver but no real customer pin is no longer held; it is
// dispatched to that driver on the area (or, for areas missing from the map, the Kuwait
// City) fallback centroid, flagged approximate, with the call-customer instruction. The
// timers supply the per-date confirmation themselves. Rows without a customer phone still
// hold: nobody can be called.
const ADDRESS_CALL_STANDING_FROM = '2026-09-05';
const ADDRESS_CALL_STANDING_AUTHORIZATION = 'A57';
const LOCATION_RECOVERY_AUTHORIZATION = 'A30';
const ADDRESS_CALL_INSTRUCTION = 'NO EXACT PIN - CALL CUSTOMER / لا يوجد موقع دقيق - اتصل بالعميل';
const ADDRESS_CALL_PLACE_PREFIX = 'CALL CUSTOMER FIRST / اتصل بالعميل أولا - ';

// Approximate area-level centroids (lat, lng) used ONLY when the vendor feed has no
// location_pin. Fleetbase service_areas/zones were checked first (2026-07-12): the only
// geometry present is soft-deleted DEMO data. The expanded one-day A19 map covers the
// textual routing areas observed in the complete July 19 source manifest plus the two
// new July 20 labels (Abbasiya and Qadsiya); area-name searches were cross-checked
// against OpenStreetMap Nominatim on 2026-07-20 without sending customer addresses or
// any other customer data. Places created from this map are ALWAYS flagged
// meta.pin_source = 'area_fallback', the original null pin is preserved in payload
// meta.source_location_pin, and the driver must call the customer before navigating.
// These points are not customer pins or a permanent routing map.
const AREA_FALLBACK_CENTROIDS = [
    'abbasiya' => [29.2601314, 47.93219],
    'abdullah al mubarak' => [29.2411046, 47.9045486],
    'abu ftaira' => [29.1976228, 48.1019956],
    'adailiya' => [29.3262544, 47.9818435],
    'adan' => [29.2327916, 48.0681642],
    'al masayel' => [29.238148, 48.0893252],
    'al qurain' => [29.2253933, 48.0730744],
    'al qusour' => [29.2160646, 48.0734748],
    'al-mutlaa' => [29.4832981, 47.59663],
    'andalous' => [29.3031016, 47.8852021],
    'ardhiya' => [29.3006, 47.8964],
    'bayan' => [29.3033, 48.0489],
    'bneid alqar' => [29.3741685, 48.0013984],
    'dasma' => [29.3656988, 48.0019243],
    'doha' => [29.32388, 47.7932659],
    'egaila' => [29.170925, 48.1025734],
    'fahad al ahmed' => [29.1273334, 48.1040492],
    'fahaheel' => [29.081324, 48.1275121],
    'farwaniya' => [29.2775, 47.9586],
    'ferdous' => [29.283319, 47.874774],
    'fintas' => [29.1717715, 48.117815],
    'fnaitess' => [29.2210847, 48.0935826],
    'hadiya' => [29.1445758, 48.0919391],
    'hateen' => [29.2835228, 48.020395],
    'hawally' => [29.3378678, 48.0235507],
    'ishbiliya' => [29.2731164, 47.9384941],
    'jaber al ahmad' => [29.3424579, 47.7600225],
    'jaber al-ali' => [29.1677169, 48.0830369],
    'jabriya' => [29.3189243, 48.0322381],
    'jahra' => [29.3375, 47.658056],
    'kaifan' => [29.340629, 47.9592011],
    'khairan' => [28.6614324, 48.3890963],
    'khairan city' => [28.6614324, 48.3890963],
    'khaldiya' => [29.3251501, 47.9650989],
    'mahboula' => [29.1490219, 48.1210101],
    'mangaf' => [29.1059112, 48.1281441],
    'mishrif' => [29.2793048, 48.0698414],
    'mubarak al kabeer' => [29.2173735, 48.0393468],
    'naseem' => [29.3207054, 47.6765013],
    'north west al sulaibikhat' => [29.328167, 47.8068916],
    'nuzha' => [29.3416311, 47.9915104],
    'omariya' => [29.2955133, 47.9558023],
    'oyoun' => [29.3283623, 47.655147],
    'qadsiya' => [29.3486319, 48.0038777],
    'qairawan' => [29.3074997, 47.7928931],
    'qasr' => [29.3427924, 47.6937154],
    'qortuba' => [29.3134043, 47.9862685],
    'rabiya' => [29.2956997, 47.9372931],
    'rawda' => [29.3300697, 47.9984022],
    'riqqa' => [29.1473639, 48.1056933],
    'rumaithiya' => [29.3151348, 48.0705355],
    'saad al abdullah' => [29.3099502, 47.720734],
    'sabah al nasser' => [29.271254, 47.8859774],
    'sabah al salem' => [29.2538763, 48.0677454],
    'sabahiya' => [29.1071132, 48.1069544],
    'salam' => [29.2967818, 48.0145815],
    'salmiya' => [29.3327834, 48.0684884],
    'salwa' => [29.2892859, 48.0807358],
    'shaab' => [29.3512891, 48.0251526],
    'shamiya' => [29.3515574, 47.9658095],
    'shuhada' => [29.2721192, 48.0307198],
    'siddiq' => [29.2946228, 47.9924653],
    'south abdullah al mubarak' => [29.2280, 47.8770],
    'sulaibikhat' => [29.3165445, 47.8457816],
    'surra' => [29.3144991, 48.0069616],
    'wafra residential' => [28.6076787, 48.0208426],
    'west abdullah al mubarak' => [29.2484185, 47.8580244],
    'yarmouk' => [29.3112015, 47.9694907],
    'zahra' => [29.2755879, 47.9997683],
    'jleeb alshuyokh' => [29.2596016, 47.9336667],
];
// Last resort for areas not in the map (logged so operators can extend the map):
// Kuwait City centroid, flagged fallback_scope = 'country'.
const COUNTRY_FALLBACK_CENTROID = [29.3759, 47.9774];

/**
 * Resolve the effective dropoff pin for a validated vendor row.
 * Vendor pin wins untouched; otherwise an area-level (or country-level) fallback
 * centroid is returned, tagged with its provenance so it is never mistaken for a
 * real customer pin.
 */
function resolveEffectivePin(array $row): array
{
    if ($row['pin'] !== null) {
        return [
            'lat' => $row['pin']['lat'],
            'lng' => $row['pin']['lng'],
            'pin_source' => 'vendor',
            'fallback_scope' => null,
        ];
    }
    if (isset($row['recovery_pin']) && is_array($row['recovery_pin'])) {
        return [
            'lat' => $row['recovery_pin']['lat'],
            'lng' => $row['recovery_pin']['lng'],
            'pin_source' => 'driver_capture',
            'fallback_scope' => null,
        ];
    }
    if (isset($row['recovery_anchor']) && is_array($row['recovery_anchor'])) {
        return [
            'lat' => $row['recovery_anchor']['lat'],
            'lng' => $row['recovery_anchor']['lng'],
            'pin_source' => 'known_stop_anchor',
            'fallback_scope' => 'area',
        ];
    }
    foreach ([$row['area_en'], $row['area_ar'], $row['routing_area']] as $candidate) {
        if (is_string($candidate) && $candidate !== '') {
            $key = mb_strtolower(trim($candidate));
            if (isset(AREA_FALLBACK_CENTROIDS[$key])) {
                return [
                    'lat' => AREA_FALLBACK_CENTROIDS[$key][0],
                    'lng' => AREA_FALLBACK_CENTROIDS[$key][1],
                    'pin_source' => 'area_fallback',
                    'fallback_scope' => 'area',
                ];
            }
        }
    }
    return [
        'lat' => COUNTRY_FALLBACK_CENTROID[0],
        'lng' => COUNTRY_FALLBACK_CENTROID[1],
        'pin_source' => 'area_fallback',
        'fallback_scope' => 'country',
    ];
}

function addressCallInstruction(array $row, bool $allowAddressCall = false): ?string
{
    return rowRequiresCustomerCall($row, $allowAddressCall)
        ? ADDRESS_CALL_INSTRUCTION
        : null;
}

function sourceOrderNotes(array $row, bool $allowAddressCall = false): string
{
    $notes = 'Vendor order ' . $row['order_number'] . ' | Area (AR): ' . ($row['area_ar'] ?? '');
    $instruction = addressCallInstruction($row, $allowAddressCall);
    return $instruction === null ? $notes : $notes . ' | ' . $instruction;
}

function sourcePlaceName(array $row, bool $allowAddressCall = false): string
{
    $name = 'Vendor Order ' . $row['order_number'] . ' - ' . $row['routing_area'];
    return rowRequiresCustomerCall($row, $allowAddressCall)
        ? ADDRESS_CALL_PLACE_PREFIX . $name
        : $name;
}

function safeLog(string $event, array $fields = []): void
{
    $safe = ['event' => $event] + $fields;
    fwrite(STDOUT, json_encode($safe, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
}

function kuwaitNow(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->format(DateTimeInterface::ATOM);
}

function metaArray(mixed $value): array
{
    if (is_array($value)) {
        return $value;
    }
    if (is_object($value)) {
        return json_decode(json_encode($value, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
    return [];
}

/**
 * Fleetbase's meta attributes compare the serialized JSON representation, so assigning
 * a semantically identical decoded array marks an existing model dirty (key ordering and
 * encoding differ). Only assign when the decoded value actually changes.
 */
function applyMetaUpdates(object $model, array $updates): array
{
    $current = metaArray($model->meta ?? null);
    $next = array_replace($current, $updates);
    if ($next !== $current) {
        $model->setAttribute('meta', $next);
    }
    return $next;
}

function saveWithoutActivity(object $model): bool
{
    if (method_exists($model, 'getActivitylogOptions') && !method_exists($model, 'disableLogging')) {
        throw new RuntimeException('activity_logging_cannot_disable');
    }
    if (method_exists($model, 'disableLogging')) {
        $model->disableLogging();
    }
    if (($model->exists ?? false) && method_exists($model, 'isDirty') && !$model->isDirty()) {
        return false;
    }
    if (!($model->exists ?? false)) {
        if (method_exists($model, 'generateUuid') && empty($model->uuid)) {
            $model->setAttribute('uuid', $model::generateUuid());
        }
        if (method_exists($model, 'generatePublicId') && empty($model->public_id)) {
            $model->setAttribute('public_id', $model::generatePublicId());
        }
    }
    $saved = $model::withoutEvents(fn (): bool => (bool) $model->save());
    if (!$saved) {
        throw new RuntimeException('fleetbase_save_rejected');
    }
    return true;
}

function deleteWithoutActivity(object $model): bool
{
    if (method_exists($model, 'getActivitylogOptions') && !method_exists($model, 'disableLogging')) {
        throw new RuntimeException('activity_logging_cannot_disable');
    }
    if (method_exists($model, 'disableLogging')) {
        $model->disableLogging();
    }
    if (!($model->exists ?? false)) {
        return false;
    }
    $deleted = $model::withoutEvents(fn (): bool => (bool) $model->forceDelete());
    if (!$deleted) {
        throw new RuntimeException('fleetbase_delete_rejected');
    }
    return true;
}

function hasForbiddenContactReference(array $contactUuids): bool
{
    if ($contactUuids === []) {
        return false;
    }
    $references = [
        ['categories', 'owner_uuid'],
        ['files', 'subject_uuid'],
        ['ledger_invoices', 'customer_uuid'],
        ['orders', 'facilitator_uuid'],
        ['purchase_rates', 'customer_uuid'],
        ['reviews', 'customer_uuid'],
        ['tracking_numbers', 'owner_uuid'],
        ['transactions', 'customer_uuid'],
        ['transactions', 'owner_uuid'],
        ['vendor_personnels', 'contact_uuid'],
        ['votes', 'customer_uuid'],
    ];
    foreach ($references as [$table, $column]) {
        if (Schema::hasTable($table)
            && Schema::hasColumn($table, $column)
            && DB::table($table)->whereIn($column, $contactUuids)->exists()) {
            return true;
        }
    }
    return false;
}

function hasForeignOperationalContactReference(array $contactUuids, string $companyUuid, string $prefix, ?array $allowedPayloadUuids = null): bool
{
    if ($contactUuids === []) {
        return false;
    }
    if ($allowedPayloadUuids === null) {
        $allowedPayloadUuids = DB::table('payloads')
            ->where('company_uuid', $companyUuid)
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $prefix)
            ->pluck('uuid')
            ->all();
    }
    foreach (['entities', 'waypoints'] as $table) {
        if (!Schema::hasTable($table)
            || !Schema::hasColumn($table, 'customer_uuid')
            || !Schema::hasColumn($table, 'payload_uuid')) {
            continue;
        }
        $query = DB::table($table)->whereIn('customer_uuid', $contactUuids);
        if ($allowedPayloadUuids === []) {
            if ($query->exists()) {
                return true;
            }
            continue;
        }
        if ($query->where(function ($reference) use ($allowedPayloadUuids) {
            $reference->whereNull('payload_uuid')->orWhereNotIn('payload_uuid', $allowedPayloadUuids);
        })->exists()) {
            return true;
        }
    }
    return false;
}

function placeHasForeignReference(string $placeUuid, string $allowedPayloadUuid, bool $forDeletion = false): bool
{
    $payloadReferences = DB::table('payloads')
        ->where(function ($query) use ($placeUuid) {
            $query->where('pickup_uuid', $placeUuid)
                ->orWhere('dropoff_uuid', $placeUuid)
                ->orWhere('return_uuid', $placeUuid);
        })
        ->get(['uuid', 'pickup_uuid', 'dropoff_uuid', 'return_uuid']);
    foreach ($payloadReferences as $reference) {
        if ($reference->uuid !== $allowedPayloadUuid
            || $reference->pickup_uuid === $placeUuid
            || $reference->return_uuid === $placeUuid
            || ($reference->dropoff_uuid === $placeUuid && $forDeletion)) {
            return true;
        }
    }
    $directReferences = [
        ['assets', 'current_place_uuid'],
        ['companies', 'place_uuid'],
        ['contacts', 'place_uuid'],
        ['manifest_stops', 'place_uuid'],
        ['vendors', 'place_uuid'],
    ];
    foreach ($directReferences as [$table, $column]) {
        if (Schema::hasTable($table)
            && Schema::hasColumn($table, $column)
            && DB::table($table)->where($column, $placeUuid)->exists()) {
            return true;
        }
    }
    if (Schema::hasTable('waypoints') && Schema::hasColumn('waypoints', 'place_uuid')) {
        $waypoints = DB::table('waypoints')->where('place_uuid', $placeUuid);
        if ($forDeletion || $waypoints->where(function ($query) use ($allowedPayloadUuid) {
            $query->whereNull('payload_uuid')->orWhere('payload_uuid', '!=', $allowedPayloadUuid);
        })->exists()) {
            if ($forDeletion && $waypoints->exists()) {
                return true;
            }
            if (!$forDeletion) {
                return true;
            }
        }
    }
    return false;
}

function resolveCompanyUuid(): string
{
    $configured = getenv('FLEETBASE_COMPANY_UUID') ?: null;
    $companies = DB::table('companies')
        ->when($configured, fn ($query) => $query->where('uuid', $configured))
        ->pluck('uuid');
    if ($companies->count() !== 1) {
        throw new RuntimeException('fleetbase_company_scope');
    }
    return (string) $companies->first();
}

function latestCustomerRows(array $rows): array
{
    $latest = [];
    foreach ($rows as $row) {
        $ref = $row['customer_ref'];
        if (!isset($latest[$ref])
            || parseTimestamp($row['updated_at'], 'updated_at') > parseTimestamp($latest[$ref]['updated_at'], 'updated_at')) {
            $latest[$ref] = $row;
        }
    }
    return $latest;
}

function parseTimestamp(string $value, string $field): DateTimeImmutable
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\+03:00$/', $value, $parts)
        || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
        || (int) $parts[4] > 23
        || (int) $parts[5] > 59
        || (int) $parts[6] > 59) {
        throw new RuntimeException('contract_timestamp_' . $field);
    }
    try {
        return new DateTimeImmutable($value);
    } catch (Throwable) {
        throw new RuntimeException('contract_timestamp_' . $field);
    }
}

function parsePin(mixed $value): ?array
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value) || !preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/', $value, $matches)) {
        return null;
    }
    $lat = (float) $matches[1];
    $lng = (float) $matches[2];
    // The Partner integration is Kuwait-only. Global-range validation would
    // incorrectly treat 0,0, transposed 48,29, or another country's coordinates
    // as a routable customer pin.
    if (($lat === 0.0 && $lng === 0.0)
        || $lat < 28.4
        || $lat > 30.2
        || $lng < 46.4
        || $lng > 48.6) {
        return null;
    }
    return ['lat' => $lat, 'lng' => $lng];
}

function pinHoldReason(array $row): ?string
{
    if (($row['pin'] ?? null) !== null || ($row['recovery_pin'] ?? null) !== null) {
        return null;
    }
    return sourcePinHoldReason($row);
}

/** The Partner-only pin state, kept separate so operational summaries never count A30 data as source. */
function sourcePinHoldReason(array $row): ?string
{
    if (($row['pin'] ?? null) !== null) {
        return null;
    }
    $raw = $row['location_pin'] ?? null;
    return $raw === null || $raw === ''
        ? 'no_real_location_pin'
        : 'invalid_source_location_pin';
}

function dailyHoldReason(array $row): ?string
{
    $statusHold = dailyStatusHoldReason($row);
    if ($statusHold !== null) {
        return $statusHold;
    }
    return dailyDriverHoldReason($row) ?? pinHoldReason($row);
}

/**
 * Partner's driver.id is the only assignment authority. A source row without a
 * driver, or with a driver that is not in the protected Partner-to-Fleetbase
 * map, is held before any pin evaluation so it can never be call-dispatched.
 */
function dailyDriverHoldReason(array $row): ?string
{
    if (($row['partner_driver_id'] ?? null) === null) {
        return 'no_partner_driver';
    }
    if (($row['partner_driver_uuid'] ?? null) === null) {
        return 'unmapped_partner_driver';
    }
    return null;
}

/** Status eligibility is independent of location recovery; held rows never become anchors. */
function dailyStatusHoldReason(array $row): ?string
{
    if (($row['source_order_status'] ?? null) === 'cancel') {
        return 'source_order_canceled';
    }
    if (!in_array((string) ($row['source_order_status'] ?? ''), DAILY_DISPATCHABLE_ORDER_STATUSES, true)) {
        return 'unapproved_order_status';
    }
    if (!in_array((string) ($row['meal_status'] ?? ''), DAILY_DISPATCHABLE_MEAL_STATUSES, true)) {
        return 'unapproved_meal_status';
    }
    return null;
}

/**
 * WP-OPS-07 (A50) — daytime rule (after the ~03:00 collection, same delivery date): only a
 * Partner cancellation or an on-hold delivery may change a dispatched order, and only by
 * withdrawing it from the driver. Owner decision 2026-09-03: on-hold counts as a withdrawal
 * because the customer may eat elsewhere that day. Any other daytime change (driver, address,
 * pin, new order, missing row) is ignored until the next full sync.
 */
function dailyWithdrawalReason(array $row): ?string
{
    if (($row['source_order_status'] ?? null) === 'cancel') {
        return 'source_order_canceled';
    }
    if (($row['meal_status'] ?? null) === 'on_hold') {
        return 'unapproved_meal_status';
    }
    return null;
}

/** A57: a call needs a phone; the written address is printed on the label either way. */
function rowHasAddressCallContext(array $row): bool
{
    return is_string($row['customer_phone'] ?? null)
        && trim($row['customer_phone']) !== '';
}

function rowRequiresCustomerCall(array $row, bool $allowAddressCall = false): bool
{
    if (!$allowAddressCall
        || !in_array(dailyHoldReason($row), ['no_real_location_pin', 'invalid_source_location_pin'], true)
        || !rowHasAddressCallContext($row)) {
        return false;
    }
    $effectivePin = resolveEffectivePin($row);
    // A57: the country-level centroid is accepted too (flagged fallback_scope = 'country' and
    // logged per area so the map can be extended); the driver calls before navigating.
    return in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
        && in_array($effectivePin['fallback_scope'], ['area', 'country'], true);
}

function addressCallDateAuthorized(string $deliveryDate): bool
{
    return in_array($deliveryDate, ADDRESS_CALL_AUTHORIZED_DATES, true)
        || strcmp($deliveryDate, ADDRESS_CALL_STANDING_FROM) >= 0;
}

function rowIsDailyRoutable(array $row, bool $allowAddressCall = false): bool
{
    return dailyHoldReason($row) === null || rowRequiresCustomerCall($row, $allowAddressCall);
}

function resolveAddressCallAuthorization(?string $deliveryDate, mixed $confirmation): bool
{
    if ($confirmation === null) {
        return false;
    }
    if ($deliveryDate === null
        || !is_string($confirmation)
        || !hash_equals($deliveryDate, $confirmation)) {
        throw new RuntimeException('daily_address_call_confirmation_guard');
    }
    if (!addressCallDateAuthorized($deliveryDate)) {
        throw new RuntimeException('daily_address_call_date_not_authorized');
    }
    return true;
}

function resolveLocationRecoveryAuthorization(?string $deliveryDate, mixed $confirmation): bool
{
    if ($confirmation === null) {
        return false;
    }
    if ($deliveryDate === null
        || !is_string($confirmation)
        || !hash_equals($deliveryDate, $confirmation)) {
        throw new RuntimeException('daily_location_recovery_confirmation_guard');
    }
    return true;
}

function addressCallAuthorization(array $row, bool $allowAddressCall = false): ?string
{
    if (!rowRequiresCustomerCall($row, $allowAddressCall)) {
        return null;
    }
    if (isset($row['recovery_anchor'])) {
        return LOCATION_RECOVERY_AUTHORIZATION;
    }
    $deliveryDate = (string) ($row['delivery_date'] ?? '');
    if (in_array($deliveryDate, ADDRESS_CALL_AUTHORIZED_DATES, true)) {
        return ADDRESS_CALL_AUTHORIZATION;
    }
    return strcmp($deliveryDate, ADDRESS_CALL_STANDING_FROM) >= 0
        ? ADDRESS_CALL_STANDING_AUTHORIZATION
        : LOCATION_RECOVERY_AUTHORIZATION;
}

function navigationModeForRow(array $row, bool $allowAddressCall = false): string
{
    if (rowRequiresCustomerCall($row, $allowAddressCall)) {
        return 'fallback_then_call_customer';
    }
    if (($row['recovery_pin'] ?? null) !== null) {
        return 'saved_customer_pin';
    }
    return rowIsDailyRoutable($row, $allowAddressCall) ? 'verified_customer_pin' : 'held';
}

function locationAccuracyForRow(array $row, bool $allowAddressCall = false): string
{
    if (rowRequiresCustomerCall($row, $allowAddressCall)) {
        return ($row['recovery_anchor'] ?? null) !== null
            ? 'known_stop_not_customer_pin'
            : 'area_fallback_not_customer_pin';
    }
    if (($row['recovery_pin'] ?? null) !== null) {
        return 'captured_customer_pin';
    }
    return rowIsDailyRoutable($row, $allowAddressCall) ? 'customer_pin' : 'not_routable';
}

function dailyHeldOrderStatus(?string $holdReason): string
{
    return in_array($holdReason, ['source_order_canceled', 'source_row_missing'], true)
        ? 'canceled'
        : 'created';
}

function dailyHeldTrackingCode(?string $holdReason): string
{
    return dailyHeldOrderStatus($holdReason) === 'canceled' ? 'CANCELED' : 'ON_HOLD';
}

/**
 * FleetbaseWriter's generic contract intentionally skips canceled rows. Daily
 * reconciliation must retain them as explicit, unassigned tombstones, so present
 * them to the base mapper as pending while preserving the original source status
 * and source hash for DailyDispatchWriter.
 */
function dailyRowsForBaseWriter(array $dailyRows): array
{
    return array_map(function (array $row): array {
        if (!in_array((string) ($row['source_order_status'] ?? ''), DAILY_DISPATCHABLE_ORDER_STATUSES, true)) {
            $row['status'] = 'pending';
        }
        return $row;
    }, $dailyRows);
}

function requiredString(array $row, string $field, int $max = 2000): string
{
    if (!array_key_exists($field, $row) || !is_string($row[$field])) {
        throw new RuntimeException('contract_string_' . $field);
    }
    $value = trim($row[$field]);
    if ($value === '' || mb_strlen($value) > $max) {
        throw new RuntimeException('contract_string_' . $field);
    }
    return $value;
}

function optionalArea(array $row, string $field): ?string
{
    if (!array_key_exists($field, $row) || $row[$field] === null || $row[$field] === '') {
        return null;
    }
    if (!is_string($row[$field]) || mb_strlen(trim($row[$field])) > 255) {
        throw new RuntimeException('contract_area_' . $field);
    }
    $value = trim($row[$field]);
    return $value === '' ? null : $value;
}

function validateRow(array $row, bool $createdAtRequired = true): array
{
    if (!isset($row['order_id']) || !is_int($row['order_id']) || $row['order_id'] <= 0) {
        throw new RuntimeException('contract_order_id');
    }
    $status = requiredString($row, 'status', 32);
    if (!in_array($status, ['success', 'pending', 'cancel', 'ongoing', 'active'], true)) {
        throw new RuntimeException('contract_status');
    }
    $customerRef = requiredString($row, 'customer_ref', 120);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $customerRef)) {
        throw new RuntimeException('contract_customer_ref');
    }
    $areaEn = optionalArea($row, 'area_en');
    $areaAr = optionalArea($row, 'area_ar');
    $routingArea = $areaEn ?? $areaAr;
    if ($routingArea === null) {
        throw new RuntimeException('contract_routing_area');
    }
    $createdAt = null;
    if ($createdAtRequired) {
        $createdAt = requiredString($row, 'created_at', 64);
    } elseif (array_key_exists('created_at', $row) && $row['created_at'] !== null && $row['created_at'] !== '') {
        $createdAt = requiredString($row, 'created_at', 64);
    }
    $updatedAt = requiredString($row, 'updated_at', 64);
    $updatedTime = parseTimestamp($updatedAt, 'updated_at');
    if ($createdAt !== null && parseTimestamp($createdAt, 'created_at') > $updatedTime) {
        throw new RuntimeException('contract_timestamp_order');
    }
    $rawPin = $row['location_pin'] ?? null;
    if ($rawPin !== null && $rawPin !== '' && !is_string($rawPin)) {
        throw new RuntimeException('contract_location_pin_type');
    }
    $pin = parsePin($rawPin);

    $normalized = [
        'order_id' => $row['order_id'],
        'order_number' => requiredString($row, 'order_number', 255),
        'status' => $status,
        'area_en' => $areaEn,
        'area_ar' => $areaAr,
        'routing_area' => $routingArea,
        'location_pin' => $rawPin,
        'pin' => $pin,
        'pin_quality' => $pin !== null
            ? 'exact_kuwait'
            : ($rawPin === null || $rawPin === '' ? 'missing' : 'invalid_or_outside_kuwait'),
        'customer_ref' => $customerRef,
        'customer_name' => requiredString($row, 'customer_name', 255),
        'customer_phone' => requiredString($row, 'customer_phone', 64),
        'address_text' => requiredString($row, 'address_text', 2000),
        'created_at' => $createdAt,
        'updated_at' => $updatedAt,
    ];
    $normalized['_source_hash'] = hash('sha256', json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    return $normalized;
}

function validateDeliveryDate(string $value, string $field = 'delivery_date'): string
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts)
        || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
        throw new RuntimeException('contract_' . $field);
    }
    return $value;
}

function optionalMealName(array $row, string $field): ?string
{
    if (!array_key_exists($field, $row) || $row[$field] === null || $row[$field] === '') {
        return null;
    }
    if (!is_string($row[$field]) || mb_strlen(trim($row[$field])) > 255) {
        throw new RuntimeException('contract_' . $field);
    }
    $value = trim($row[$field]);
    return $value === '' ? null : $value;
}

function validateMealHistoryRow(array $row): array
{
    $customerRef = requiredString($row, 'customer_ref', 120);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $customerRef)) {
        throw new RuntimeException('contract_meal_customer_ref');
    }
    $mealId = $row['meal_id'] ?? null;
    if (is_int($mealId)) {
        $mealId = (string) $mealId;
    }
    if (!is_string($mealId) || !preg_match('/^[A-Za-z0-9._-]+$/', $mealId)) {
        throw new RuntimeException('contract_meal_id');
    }
    $qty = $row['qty'] ?? null;
    if (!is_int($qty) || $qty < 1 || $qty > 1000000) {
        throw new RuntimeException('contract_meal_qty');
    }
    return [
        'customer_ref' => $customerRef,
        'order_number' => requiredString($row, 'order_number', 255),
        'delivery_date' => validateDeliveryDate(requiredString($row, 'delivery_date', 10)),
        'status' => requiredString($row, 'status', 64),
        'meal_id' => $mealId,
        'meal_name_ar' => optionalMealName($row, 'meal_name_ar'),
        'meal_name_en' => optionalMealName($row, 'meal_name_en'),
        'qty' => $qty,
        'updated_at' => requiredString($row, 'updated_at', 64),
        '_updated_time' => parseTimestamp(requiredString($row, 'updated_at', 64), 'meal_updated_at'),
    ];
}

/**
 * Join a day's meal rows to the canonical order endpoint. The order endpoint owns
 * customer/address/routing identity; meal-history supplies the delivery date and
 * one-to-many meal detail. Current (2024+) order_number values are unique, but we
 * still fail closed if the source violates that contract.
 */
function buildDailyRows(array $rawMeals, array $rawOrders, string $deliveryDate): array
{
    $deliveryDate = validateDeliveryDate($deliveryDate);
    $mealGroups = [];
    foreach ($rawMeals as $rawMeal) {
        if (!is_array($rawMeal)) {
            throw new RuntimeException('contract_meal_row_object');
        }
        $meal = validateMealHistoryRow($rawMeal);
        if ($meal['delivery_date'] !== $deliveryDate) {
            continue;
        }
        $key = $meal['order_number'];
        if (!isset($mealGroups[$key])) {
            $mealGroups[$key] = [
                'customer_ref' => $meal['customer_ref'],
                'status' => $meal['status'],
                'meal_item_count' => 0,
                'meal_qty' => 0,
                'updated_at' => $meal['updated_at'],
                '_updated_time' => $meal['_updated_time'],
            ];
        }
        $group = &$mealGroups[$key];
        if ($group['customer_ref'] !== $meal['customer_ref']
            || $group['status'] !== $meal['status']) {
            throw new RuntimeException('contract_daily_group_conflict');
        }
        // The documented feed is one row per meal item per delivery date.
        // meal_id is a catalog reference, not a row identity, so the same meal
        // may legitimately appear more than once for an order/date.
        $group['meal_item_count']++;
        $group['meal_qty'] += $meal['qty'];
        if ($meal['_updated_time'] > $group['_updated_time']) {
            $group['_updated_time'] = $meal['_updated_time'];
            $group['updated_at'] = $meal['updated_at'];
        }
        unset($group);
    }
    $ordersByNumber = [];
    foreach ($rawOrders as $rawOrder) {
        if (!is_array($rawOrder)) {
            throw new RuntimeException('contract_row_object');
        }
        if (!isset($rawOrder['order_number']) || !is_string($rawOrder['order_number'])) {
            throw new RuntimeException('contract_string_order_number');
        }
        $number = trim($rawOrder['order_number']);
        if (!isset($mealGroups[$number])) {
            continue;
        }
        $order = validateRow($rawOrder);
        if (isset($ordersByNumber[$number])
            && $ordersByNumber[$number]['order_id'] !== $order['order_id']) {
            throw new RuntimeException('contract_daily_order_number_not_unique');
        }
        if (!isset($ordersByNumber[$number])) {
            $ordersByNumber[$number] = $order;
            continue;
        }
        $candidateTime = parseTimestamp($order['updated_at'], 'updated_at');
        $existingTime = parseTimestamp($ordersByNumber[$number]['updated_at'], 'updated_at');
        if ($candidateTime > $existingTime) {
            $ordersByNumber[$number] = $order;
        } elseif ($candidateTime == $existingTime
            && $order['_source_hash'] !== $ordersByNumber[$number]['_source_hash']) {
            throw new RuntimeException('contract_daily_conflicting_order_snapshot');
        }
    }

    $daily = [];
    $seenOrderIds = [];
    foreach ($mealGroups as $number => $group) {
        $order = $ordersByNumber[$number] ?? null;
        if ($order === null) {
            throw new RuntimeException('daily_order_context_missing');
        }
        if ($order['customer_ref'] !== $group['customer_ref']) {
            throw new RuntimeException('daily_customer_ref_mismatch');
        }
        $orderIdKey = (string) $order['order_id'];
        if (isset($seenOrderIds[$orderIdKey])) {
            throw new RuntimeException('contract_daily_order_id_not_unique');
        }
        $seenOrderIds[$orderIdKey] = true;
        $daily[] = $order + [
            'delivery_date' => $deliveryDate,
            'source_order_status' => $order['status'],
            'meal_status' => $group['status'],
            'meal_item_count' => $group['meal_item_count'],
            'meal_qty' => $group['meal_qty'],
            'meal_updated_at' => $group['updated_at'],
        ];
    }
    usort($daily, fn (array $a, array $b): int => $a['order_id'] <=> $b['order_id']);
    return $daily;
}

function requiredObject(array $row, string $field): array
{
    if (!array_key_exists($field, $row) || !is_array($row[$field]) || array_is_list($row[$field])) {
        throw new RuntimeException('contract_object_' . $field);
    }
    return $row[$field];
}

function requiredBoolean(array $row, string $field): bool
{
    if (!array_key_exists($field, $row) || !is_bool($row[$field])) {
        throw new RuntimeException('contract_boolean_' . $field);
    }
    return $row[$field];
}

function optionalString(array $row, string $field, int $max = 2000): ?string
{
    if (!array_key_exists($field, $row) || $row[$field] === null || $row[$field] === '') {
        return null;
    }
    if (!is_string($row[$field])) {
        throw new RuntimeException('contract_string_' . $field);
    }
    $value = trim($row[$field]);
    if ($value === '' || mb_strlen($value) > $max) {
        throw new RuntimeException('contract_string_' . $field);
    }
    return $value;
}

/**
 * Validate the Partner daily-deliveries contract without inventing fields that
 * the endpoint does not publish. In particular, created_at and meal quantity
 * remain null; updated_at and meal_item_count retain their documented meaning.
 */
function validateDailyDeliveryRow(array $row, string $deliveryDate): array
{
    if (!isset($row['delivery_id']) || !is_int($row['delivery_id']) || $row['delivery_id'] <= 0) {
        throw new RuntimeException('contract_delivery_id');
    }
    if (!isset($row['order_id']) || !is_int($row['order_id']) || $row['order_id'] <= 0) {
        throw new RuntimeException('contract_order_id');
    }
    $rowDate = validateDeliveryDate(requiredString($row, 'delivery_date', 10));
    if ($rowDate !== validateDeliveryDate($deliveryDate)) {
        throw new RuntimeException('contract_daily_delivery_date_mismatch');
    }
    $customerRef = requiredString($row, 'customer_ref', 120);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $customerRef)) {
        throw new RuntimeException('contract_customer_ref');
    }
    $isCancelled = requiredBoolean($row, 'is_cancelled');
    $isOnHold = requiredBoolean($row, 'is_on_hold');
    $orderStatus = requiredString($row, 'order_status', 32);
    $deliveryStatus = requiredString($row, 'delivery_status', 64);
    $mealItemCount = $row['meal_item_count'] ?? null;
    if (!is_int($mealItemCount) || $mealItemCount < 0 || $mealItemCount > 1000000) {
        throw new RuntimeException('contract_meal_item_count');
    }
    $customer = requiredObject($row, 'customer');
    $address = requiredObject($row, 'address');
    $timeSlot = requiredObject($row, 'time_slot');
    $driver = requiredObject($row, 'driver');
    // Partner's driver.id IS the Fleetbase assignment authority (A46). It is
    // normalized to a string identifier; a null id means Partner has not
    // assigned a driver and the order is held rather than guessed.
    if (!array_key_exists('id', $driver)
        || ($driver['id'] !== null && !is_int($driver['id']) && !is_string($driver['id']))) {
        throw new RuntimeException('contract_driver_id');
    }
    $partnerDriverId = normalizePartnerDriverId($driver['id']);
    $partnerDriverName = optionalString($driver, 'name', 255);
    optionalString($row, 'delivery_method', 255);
    optionalString($row, 'driver_instructions', 2000);
    requiredString($row, 'hold_state', 64);
    // Partner can legitimately omit the optional legacy time-slot object values.
    // Fleetbase scheduling is governed by the protected pickup dispatch_time,
    // not these presentation fields. Non-null values remain contract-checked.
    $timeSlotTitle = optionalString($timeSlot, 'title', 255);
    $timeSlotStart = optionalString($timeSlot, 'start', 64);
    $timeSlotEnd = optionalString($timeSlot, 'end', 64);
    $updatedAt = requiredString($row, 'updated_at', 64);
    $updatedTime = parseTimestamp($updatedAt, 'daily_delivery_updated_at');

    $sourceOrderStatus = ($isCancelled || $orderStatus === 'cancel') ? 'cancel' : $orderStatus;
    $sourceDeliveryStatus = $isOnHold ? 'on_hold' : $deliveryStatus;
    $base = validateRow([
        'order_id' => $row['order_id'],
        'order_number' => requiredString($row, 'order_number', 255),
        'status' => $sourceOrderStatus,
        'area_en' => optionalArea($address, 'area_en'),
        'area_ar' => optionalArea($address, 'area_ar'),
        'location_pin' => $row['location_pin'] ?? null,
        'customer_ref' => $customerRef,
        'customer_name' => requiredString($customer, 'name', 255),
        'customer_phone' => requiredString($customer, 'phone', 64),
        'address_text' => requiredString($address, 'text', 2000),
        'created_at' => null,
        'updated_at' => $updatedAt,
    ], false);

    $identity = [
        'order_id' => $base['order_id'],
        'order_number' => $base['order_number'],
        'customer_ref' => $base['customer_ref'],
        'customer_name' => $base['customer_name'],
        'customer_phone' => $base['customer_phone'],
        'delivery_date' => $rowDate,
        'order_status' => $sourceOrderStatus,
        'is_cancelled' => $isCancelled,
        'is_on_hold' => $isOnHold,
        'hold_state' => requiredString($row, 'hold_state', 64),
        'area_en' => $base['area_en'],
        'area_ar' => $base['area_ar'],
        'address_text' => $base['address_text'],
        'location_pin' => $base['location_pin'],
        'delivery_method' => optionalString($row, 'delivery_method', 255),
        'driver_instructions' => optionalString($row, 'driver_instructions', 2000),
        'partner_driver_id' => $partnerDriverId,
        'time_slot' => [
            'id' => $timeSlot['id'] ?? null,
            'title' => $timeSlotTitle,
            'start' => $timeSlotStart,
            'end' => $timeSlotEnd,
        ],
    ];
    return $base + [
        'delivery_id' => $row['delivery_id'],
        'delivery_date' => $rowDate,
        'source_order_status' => $sourceOrderStatus,
        'meal_status' => $sourceDeliveryStatus,
        'meal_item_count' => $mealItemCount,
        'meal_qty' => null,
        'meal_updated_at' => $updatedAt,
        'source_selector' => DAILY_SOURCE_SELECTOR,
        'partner_driver_id' => $partnerDriverId,
        'partner_driver_name' => $partnerDriverName,
        '_updated_time' => $updatedTime,
        '_identity_hash' => hash('sha256', json_encode($identity, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)),
    ];
}

/** Partner driver ids are opaque identifiers (integer or string); names never take part. */
function normalizePartnerDriverId(mixed $value): ?string
{
    if ($value === null) {
        return null;
    }
    if (is_int($value)) {
        if ($value <= 0) {
            throw new RuntimeException('contract_driver_id');
        }
        return (string) $value;
    }
    if (!is_string($value)) {
        throw new RuntimeException('contract_driver_id');
    }
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    if (mb_strlen($value) > 64 || !preg_match('/^[A-Za-z0-9._-]+$/', $value)) {
        throw new RuntimeException('contract_driver_id');
    }
    return $value;
}

/**
 * The endpoint is one row per delivery instance, while Fleetbase needs one job
 * per order. Duplicate instances are collapsed only under a fail-closed rule:
 * identical order/routing identity plus either identical delivery state/count
 * rows or one newest positive-meal row superseding zero-meal rows.
 */
function buildDailyDeliveryRows(array $rawDeliveries, string $deliveryDate): array
{
    $groups = [];
    foreach ($rawDeliveries as $raw) {
        if (!is_array($raw)) {
            throw new RuntimeException('contract_daily_delivery_row_object');
        }
        $row = validateDailyDeliveryRow($raw, $deliveryDate);
        $groups[(string) $row['order_id']][] = $row;
    }

    $daily = [];
    $seenNumbers = [];
    foreach ($groups as $group) {
        $first = $group[0];
        foreach ($group as $member) {
            if ($member['_identity_hash'] !== $first['_identity_hash']) {
                throw new RuntimeException('contract_daily_delivery_group_conflict');
            }
        }
        $selected = $first;
        if (count($group) > 1) {
            $positive = array_values(array_filter(
                $group,
                fn (array $member): bool => $member['meal_item_count'] > 0,
            ));
            $latest = $group[0]['_updated_time'];
            foreach ($group as $member) {
                if ($member['_updated_time'] > $latest) {
                    $latest = $member['_updated_time'];
                }
            }
            $materialStates = [];
            foreach ($group as $member) {
                $materialStates[$member['meal_status'] . "\0" . $member['meal_item_count']] = true;
            }
            if (count($materialStates) === 1) {
                usort($group, function (array $a, array $b): int {
                    $timeOrder = $a['_updated_time'] <=> $b['_updated_time'];
                    return $timeOrder !== 0 ? $timeOrder : ($a['delivery_id'] <=> $b['delivery_id']);
                });
                $selected = $group[array_key_last($group)];
            } elseif (count($positive) === 1) {
                $selected = $positive[0];
                if ($selected['_updated_time'] != $latest) {
                    throw new RuntimeException('contract_daily_delivery_duplicate_stale_meal_row');
                }
            } else {
                throw new RuntimeException('contract_daily_delivery_duplicate_ambiguous');
            }
        }
        $number = $selected['order_number'];
        if (isset($seenNumbers[$number]) && $seenNumbers[$number] !== $selected['order_id']) {
            throw new RuntimeException('contract_daily_order_number_not_unique');
        }
        $seenNumbers[$number] = $selected['order_id'];
        $deliveryIds = array_column($group, 'delivery_id');
        sort($deliveryIds, SORT_NUMERIC);
        $deliveryStates = array_map(
            fn (array $member): array => [
                'delivery_id' => $member['delivery_id'],
                'delivery_status' => $member['meal_status'],
                'meal_item_count' => $member['meal_item_count'],
                'updated_at' => $member['meal_updated_at'],
            ],
            $group,
        );
        usort($deliveryStates, fn (array $a, array $b): int => $a['delivery_id'] <=> $b['delivery_id']);
        $selected['source_delivery_ids'] = $deliveryIds;
        $selected['source_delivery_row_count'] = count($group);
        $selected['_source_hash'] = hash('sha256', json_encode([
            'selector' => DAILY_SOURCE_SELECTOR,
            'order' => array_intersect_key($selected, array_flip([
                'order_id', 'order_number', 'status', 'area_en', 'area_ar', 'routing_area',
                'location_pin', 'pin_quality', 'customer_ref', 'customer_name',
                'customer_phone', 'address_text', 'created_at', 'updated_at',
                'delivery_date', 'source_order_status', 'partner_driver_id',
            ])),
            'delivery_states' => $deliveryStates,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
        unset($selected['_updated_time'], $selected['_identity_hash'], $selected['delivery_id']);
        $daily[] = $selected;
    }
    usort($daily, fn (array $a, array $b): int => $a['order_id'] <=> $b['order_id']);
    return $daily;
}

function loadLockedJson(string $path, string $errorPrefix): array
{
    $root = INTEGRATION_CONFIG_ROOT;
    if (!is_dir($root)
        || is_link($root)
        || realpath($root) !== $root
        || fileowner($root) !== 0
        || (fileperms($root) & 0777) !== 0700
        || dirname($path) !== $root
        || is_link($path)
        || !is_file($path)
        || realpath($path) !== $path
        || fileowner($path) !== 0
        || (fileperms($path) & 0777) !== 0600
        || filesize($path) === false
        || filesize($path) < 2
        || filesize($path) > 65536) {
        throw new RuntimeException($errorPrefix . '_file_guard');
    }
    try {
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        throw new RuntimeException($errorPrefix . '_json');
    }
    if (!is_array($decoded)) {
        throw new RuntimeException($errorPrefix . '_json');
    }
    return $decoded;
}

/**
 * Read the PII-minimised A30 export produced by the host runner. It contains only an opaque
 * Partner customer reference, coordinates and the append-only capture id; never names or phones.
 */
function loadLocationCaptures(string $path): array
{
    $rows = loadLockedJson($path, 'location_captures');
    $captures = [];
    foreach ($rows as $row) {
        if (!is_array($row)
            || !is_string($row['partner_customer_ref'] ?? null)
            || trim($row['partner_customer_ref']) === ''
            || mb_strlen(trim($row['partner_customer_ref'])) > 255
            || !is_string($row['capture_id'] ?? null)
            || trim($row['capture_id']) === '') {
            throw new RuntimeException('location_captures_shape');
        }
        $ref = trim($row['partner_customer_ref']);
        $lat = $row['latitude'] ?? null;
        $lng = $row['longitude'] ?? null;
        if ((!is_float($lat) && !is_int($lat))
            || (!is_float($lng) && !is_int($lng))
            || parsePin((string) $lat . ',' . (string) $lng) === null
            || isset($captures[$ref])) {
            throw new RuntimeException('location_captures_coordinate_or_duplicate');
        }
        $captures[$ref] = [
            'lat' => (float) $lat,
            'lng' => (float) $lng,
            'capture_id' => trim($row['capture_id']),
        ];
    }
    return $captures;
}

/**
 * Apply A30 precedence without mutating the Partner source values:
 * valid Partner pin > latest approved Nutrezee capture > same-area known-stop anchor > centroid.
 * Anchor identity is deliberately discarded; only its coordinate survives on the target row.
 */
function applyLocationRecoveryData(array $rows, array $captures): array
{
    foreach ($rows as &$row) {
        $ref = (string) ($row['customer_ref'] ?? '');
        if (($row['pin'] ?? null) === null && isset($captures[$ref])) {
            $row['recovery_pin'] = [
                'lat' => $captures[$ref]['lat'],
                'lng' => $captures[$ref]['lng'],
            ];
            $row['recovery_capture_id'] = $captures[$ref]['capture_id'];
        }
    }
    unset($row);

    $knownByArea = [];
    foreach ($rows as $row) {
        // An anchor must be a real stop in today's dispatchable workload. A valid coordinate from
        // a cancelled, incomplete or otherwise held row is not an operational stop.
        if (dailyStatusHoldReason($row) !== null
            || (($row['pin'] ?? null) === null && ($row['recovery_pin'] ?? null) === null)) {
            continue;
        }
        $area = mb_strtolower(trim((string) ($row['routing_area'] ?? '')));
        if ($area === '') {
            continue;
        }
        $pin = resolveEffectivePin($row);
        $knownByArea[$area][] = ['lat' => $pin['lat'], 'lng' => $pin['lng']];
    }

    foreach ($rows as &$row) {
        if (dailyStatusHoldReason($row) !== null
            || !rowHasAddressCallContext($row)
            || sourcePinHoldReason($row) === null
            || ($row['recovery_pin'] ?? null) !== null) {
            continue;
        }
        $area = mb_strtolower(trim((string) ($row['routing_area'] ?? '')));
        $candidates = $knownByArea[$area] ?? [];
        if ($candidates === []) {
            continue;
        }
        // With no customer coordinate to measure from, choose the known stop nearest the area's
        // published centroid. This is deterministic and cannot disclose the anchor customer.
        $centroid = resolveEffectivePin($row);
        if (($centroid['fallback_scope'] ?? null) !== 'area') {
            continue;
        }
        usort($candidates, function (array $left, array $right) use ($centroid): int {
            $leftDistance = (($left['lat'] - $centroid['lat']) ** 2) + (($left['lng'] - $centroid['lng']) ** 2);
            $rightDistance = (($right['lat'] - $centroid['lat']) ** 2) + (($right['lng'] - $centroid['lng']) ** 2);
            return $leftDistance <=> $rightDistance
                ?: $left['lat'] <=> $right['lat']
                ?: $left['lng'] <=> $right['lng'];
        });
        $row['recovery_anchor'] = $candidates[0];
    }
    unset($row);
    return $rows;
}

function loadDriverRoster(string $path, string $companyUuid): array
{
    $config = loadLockedJson($path, 'driver_roster');
    $publicIds = $config['driver_public_ids'] ?? null;
    $expected = $config['expected_count'] ?? null;
    if (!is_array($publicIds)
        || !is_int($expected)
        || $expected < 1
        || count($publicIds) !== $expected
        || count(array_unique($publicIds)) !== $expected) {
        throw new RuntimeException('driver_roster_shape');
    }
    foreach ($publicIds as $publicId) {
        if (!is_string($publicId) || !preg_match('/^driver_[A-Za-z0-9]{6,40}$/', $publicId)) {
            throw new RuntimeException('driver_roster_public_id');
        }
    }
    $rows = resolveActiveDrivers($publicIds, $companyUuid);
    if (count($rows) !== $expected) {
        throw new RuntimeException('driver_roster_resolution');
    }
    usort($rows, fn (array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));
    return $rows;
}

/** Fleetbase drivers that are live, verified, and able to sign in to Navigator. */
function resolveActiveDrivers(array $publicIds, string $companyUuid): array
{
    return DB::table('drivers as d')
        ->join('users as u', 'u.uuid', '=', 'd.user_uuid')
        ->join('company_users as cu', function ($join) {
            $join->on('cu.user_uuid', '=', 'u.uuid')
                ->on('cu.company_uuid', '=', 'd.company_uuid');
        })
        ->where('d.company_uuid', $companyUuid)
        ->where('u.company_uuid', $companyUuid)
        ->whereIn('d.public_id', $publicIds)
        ->whereNull('d.deleted_at')
        ->whereNull('u.deleted_at')
        ->whereNull('cu.deleted_at')
        ->where('d.status', 'available')
        ->where('u.type', 'driver')
        ->where(function ($query) {
            $query->whereNull('u.status')->orWhere('u.status', 'active');
        })
        ->where('cu.status', 'active')
        ->whereNotNull('u.password')
        ->where('u.password', '!=', '')
        ->distinct()
        ->get(['d.uuid', 'd.public_id'])
        ->map(fn ($row): array => ['uuid' => (string) $row->uuid, 'public_id' => (string) $row->public_id])
        ->all();
}

/**
 * Pure shape validation of the Partner-to-Fleetbase driver map. Each Partner
 * driver id maps to exactly one Fleetbase driver; a Fleetbase driver may carry
 * several Partner aliases (Partner exposes both a numeric user id such as 19033
 * and a unit code such as "A9"). The optional `unit` is an operational label
 * (e.g. "Area-3"), never a person.
 */
function validatePartnerDriverMap(array $config): array
{
    $entries = $config['drivers'] ?? null;
    $expected = $config['expected_count'] ?? null;
    if (($config['schema_version'] ?? null) !== PARTNER_DRIVER_MAP_SCHEMA_VERSION
        || !is_array($entries)
        || !is_int($expected)
        || $expected < 1
        || count($entries) !== $expected) {
        throw new RuntimeException('partner_driver_map_shape');
    }
    // Partner ids are kept as strings everywhere: PHP would silently turn a
    // numeric-string array key such as "42" into int 42.
    $seenPartnerIds = [];
    $drivers = [];
    foreach ($entries as $entry) {
        if (!is_array($entry)) {
            throw new RuntimeException('partner_driver_map_entry');
        }
        $partnerId = $entry['partner_driver_id'] ?? null;
        if (is_int($partnerId)) {
            $partnerId = (string) $partnerId;
        }
        if (!is_string($partnerId)
            || $partnerId === ''
            || mb_strlen($partnerId) > 64
            || !preg_match('/^[A-Za-z0-9._-]+$/', $partnerId)
            || isset($seenPartnerIds[$partnerId])) {
            throw new RuntimeException('partner_driver_map_partner_id');
        }
        $publicId = $entry['driver_public_id'] ?? null;
        if (!is_string($publicId) || !preg_match('/^driver_[A-Za-z0-9]{6,40}$/', $publicId)) {
            throw new RuntimeException('partner_driver_map_public_id');
        }
        $unit = $entry['unit'] ?? null;
        if ($unit !== null
            && (!is_string($unit) || trim($unit) === '' || mb_strlen($unit) > 64
                || preg_match('/[\x00-\x1F\x7F]/u', $unit))) {
            throw new RuntimeException('partner_driver_map_unit');
        }
        $drivers[] = [
            'partner_driver_id' => $partnerId,
            'public_id' => $publicId,
            'unit' => $unit === null ? null : trim($unit),
        ];
        $seenPartnerIds[$partnerId] = true;
    }
    usort($drivers, fn (array $a, array $b): int => strcmp($a['partner_driver_id'], $b['partner_driver_id']));
    return $drivers;
}

/**
 * Load the protected Partner driver map and resolve every Fleetbase driver in it.
 * The roster (who may be dispatched) and the map (which Partner driver each one
 * is) must name exactly the same Fleetbase drivers, so a stale or partial file
 * can never silently drop or add a dispatchable driver.
 */
function loadPartnerDriverMap(string $path, string $companyUuid, array $rosterDrivers): array
{
    $map = validatePartnerDriverMap(loadLockedJson($path, 'partner_driver_map'));
    $publicIds = array_values(array_unique(array_map(fn (array $entry): string => $entry['public_id'], $map)));
    $rosterPublicIds = array_values(array_map(fn (array $driver): string => $driver['public_id'], $rosterDrivers));
    sort($publicIds, SORT_STRING);
    sort($rosterPublicIds, SORT_STRING);
    if ($publicIds !== $rosterPublicIds) {
        throw new RuntimeException('partner_driver_map_roster_mismatch');
    }
    $resolved = resolveActiveDrivers($publicIds, $companyUuid);
    if (count($resolved) !== count($publicIds)) {
        throw new RuntimeException('partner_driver_map_resolution');
    }
    $uuidByPublicId = [];
    foreach ($resolved as $driver) {
        $uuidByPublicId[$driver['public_id']] = $driver['uuid'];
    }
    $drivers = [];
    foreach ($map as $entry) {
        $drivers[] = [
            'uuid' => $uuidByPublicId[$entry['public_id']],
            'public_id' => $entry['public_id'],
            'partner_driver_id' => $entry['partner_driver_id'],
            'unit' => $entry['unit'],
        ];
    }
    usort($drivers, fn (array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));
    return $drivers;
}

/**
 * Attach the mapped Fleetbase driver to every source row. Rows keep their
 * Partner driver id even when unmapped so the hold is explainable; only ids
 * (never names) are reported back for the operational log.
 */
function applyPartnerDriverAssignments(array $dailyRows, array $drivers): array
{
    $byPartnerId = [];
    foreach ($drivers as $driver) {
        if (!is_string($driver['partner_driver_id'] ?? null)) {
            throw new RuntimeException('partner_driver_map_required');
        }
        $byPartnerId[$driver['partner_driver_id']] = $driver;
    }
    $rows = [];
    $unmapped = [];
    $withoutDriver = 0;
    foreach ($dailyRows as $row) {
        $partnerId = $row['partner_driver_id'] ?? null;
        $row['partner_driver_uuid'] = null;
        $row['partner_driver_public_id'] = null;
        if ($partnerId === null) {
            $withoutDriver++;
        } elseif (isset($byPartnerId[$partnerId])) {
            $row['partner_driver_uuid'] = $byPartnerId[$partnerId]['uuid'];
            $row['partner_driver_public_id'] = $byPartnerId[$partnerId]['public_id'];
        } else {
            $unmapped[$partnerId] = true;
        }
        $rows[] = $row;
    }
    $unmappedIds = array_map('strval', array_keys($unmapped));
    sort($unmappedIds, SORT_STRING);
    return [
        'rows' => $rows,
        'orders_without_partner_driver' => $withoutDriver,
        'unmapped_partner_driver_ids' => $unmappedIds,
    ];
}

function loadPickupConfig(string $path): array
{
    $config = loadLockedJson($path, 'pickup_config');
    $maxLengths = [
        'name' => 255,
        'street1' => 255,
        'city' => 191,
        'country' => 2,
        'dispatch_time' => 5,
    ];
    foreach ($maxLengths as $field => $maxLength) {
        if (!isset($config[$field]) || !is_string($config[$field]) || trim($config[$field]) === '') {
            throw new RuntimeException('pickup_config_' . $field);
        }
        if (mb_strlen(trim($config[$field])) > $maxLength
            || preg_match('/[\x00-\x1F\x7F]/u', $config[$field])) {
            throw new RuntimeException('pickup_config_' . $field);
        }
    }
    if (!preg_match('/^\d{2}:\d{2}$/', $config['dispatch_time'])
        || !preg_match('/^[A-Z]{2}$/', $config['country'])) {
        throw new RuntimeException('pickup_config_format');
    }
    [$hour, $minute] = array_map('intval', explode(':', $config['dispatch_time']));
    if ($hour > 23 || $minute > 59) {
        throw new RuntimeException('pickup_config_time');
    }
    foreach (['lat', 'lng'] as $field) {
        if (!isset($config[$field]) || !is_float($config[$field]) && !is_int($config[$field])) {
            throw new RuntimeException('pickup_config_' . $field);
        }
    }
    $lat = (float) $config['lat'];
    $lng = (float) $config['lng'];
    if ($lat < 28.4 || $lat > 30.2 || $lng < 46.4 || $lng > 48.6) {
        throw new RuntimeException('pickup_config_coordinate');
    }
    $coordinateSource = is_string($config['coordinate_source'] ?? null)
        ? trim($config['coordinate_source'])
        : 'operator_config';
    if ($coordinateSource === ''
        || mb_strlen($coordinateSource) > 128
        || preg_match('/[\x00-\x1F\x7F]/u', $coordinateSource)) {
        throw new RuntimeException('pickup_config_coordinate_source');
    }
    return [
        'name' => trim($config['name']),
        'street1' => trim($config['street1']),
        'city' => trim($config['city']),
        'country' => $config['country'],
        'lat' => $lat,
        'lng' => $lng,
        'dispatch_time' => $config['dispatch_time'],
        'coordinate_source' => $coordinateSource,
    ];
}

/**
 * Mirror Partner's driver assignment. Every routable row must already carry the
 * Fleetbase driver resolved from its Partner driver.id; the bridge never picks a
 * driver itself. Routing areas play no part in assignment (A46 replaced the
 * former routing-area rendezvous hash, which contradicted Partner's driver-owned
 * area model).
 */
function allocateDailyDrivers(array $dailyRows, array $drivers, bool $allowAddressCall = false): array
{
    if ($drivers === []) {
        throw new RuntimeException('driver_roster_empty');
    }
    $publicIdByUuid = [];
    $loads = [];
    foreach ($drivers as $driver) {
        $publicIdByUuid[$driver['uuid']] = $driver['public_id'];
        $loads[$driver['public_id']] = 0;
    }
    ksort($loads, SORT_STRING);
    $assignments = [];
    foreach ($dailyRows as $row) {
        if (!rowIsDailyRoutable($row, $allowAddressCall)) {
            continue;
        }
        $uuid = $row['partner_driver_uuid'] ?? null;
        if (!is_string($uuid) || !isset($publicIdByUuid[$uuid])) {
            throw new RuntimeException('daily_allocation_driver');
        }
        $orderId = (string) $row['order_id'];
        if (isset($assignments[$orderId])) {
            throw new RuntimeException('daily_allocation_duplicate_order');
        }
        $assignments[$orderId] = $uuid;
        $loads[$publicIdByUuid[$uuid]]++;
    }
    return ['assignments' => $assignments, 'loads' => $loads];
}

function dailyMealHash(array $row): string
{
    return hash('sha256', json_encode([
        'source_selector' => $row['source_selector'] ?? 'legacy_meal_history_v1',
        'delivery_date' => $row['delivery_date'],
        'meal_status' => $row['meal_status'],
        'meal_item_count' => $row['meal_item_count'],
        'meal_qty' => $row['meal_qty'],
        'meal_updated_at' => $row['meal_updated_at'],
        'source_delivery_ids' => $row['source_delivery_ids'] ?? [],
        'source_delivery_row_count' => $row['source_delivery_row_count'] ?? 0,
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
}

function dailySourceDigest(array $dailyRows): string
{
    $context = hash_init('sha256');
    foreach ($dailyRows as $row) {
        hash_update($context, (string) $row['order_id']);
        hash_update($context, "\0");
        hash_update($context, $row['_source_hash']);
        hash_update($context, "\0");
        hash_update($context, dailyMealHash($row));
        hash_update($context, "\n");
    }
    return hash_final($context);
}

/**
 * Reconcile Partner's endpoint membership to a root-protected Driver Orders
 * export. The manifest contains order numbers only (no names, phones, or
 * addresses). Every manifest order must exist in the complete API response;
 * API-only rows are excluded and reported, while a missing manifest order
 * aborts the run.
 */
function applyDriverOrdersMembership(array $dailyRows, string $path, string $deliveryDate): array
{
    return applyDriverOrdersMembershipManifest(
        $dailyRows,
        loadLockedJson($path, 'driver_orders_manifest'),
        $deliveryDate,
    );
}

function applyDriverOrdersMembershipManifest(array $dailyRows, array $manifest, string $deliveryDate): array
{
    if (($manifest['schema_version'] ?? null) !== 1
        || ($manifest['source'] ?? null) !== 'legacy_driver_orders_csv_v1'
        || ($manifest['delivery_date'] ?? null) !== $deliveryDate
        || !is_int($manifest['expected_count'] ?? null)
        || $manifest['expected_count'] < 0
        || !is_array($manifest['order_numbers'] ?? null)
        || !is_string($manifest['order_number_digest'] ?? null)
        || !preg_match('/^[a-f0-9]{64}$/', $manifest['order_number_digest'])) {
        throw new RuntimeException('driver_orders_manifest_shape');
    }

    $numbers = [];
    foreach ($manifest['order_numbers'] as $number) {
        if (!is_string($number)) {
            throw new RuntimeException('driver_orders_manifest_order_number');
        }
        $number = trim($number);
        if ($number === ''
            || mb_strlen($number) > 255
            || !preg_match('/^[A-Za-z0-9._-]+$/', $number)
            || isset($numbers[$number])) {
            throw new RuntimeException('driver_orders_manifest_order_number');
        }
        $numbers[$number] = true;
    }
    if (count($numbers) !== $manifest['expected_count']) {
        throw new RuntimeException('driver_orders_manifest_count');
    }
    $sortedNumbers = array_keys($numbers);
    sort($sortedNumbers, SORT_STRING);
    $digest = hash('sha256', implode("\n", $sortedNumbers) . ($sortedNumbers === [] ? '' : "\n"));
    if (!hash_equals($manifest['order_number_digest'], $digest)) {
        throw new RuntimeException('driver_orders_manifest_digest');
    }

    $byNumber = [];
    foreach ($dailyRows as $row) {
        $number = (string) $row['order_number'];
        if (isset($byNumber[$number])) {
            throw new RuntimeException('driver_orders_manifest_api_duplicate');
        }
        $byNumber[$number] = $row;
    }
    $missing = array_diff_key($numbers, $byNumber);
    if ($missing !== []) {
        throw new RuntimeException('driver_orders_manifest_missing_from_api');
    }
    $selected = array_values(array_intersect_key($byNumber, $numbers));
    usort($selected, fn (array $a, array $b): int => $a['order_id'] <=> $b['order_id']);
    return [
        'rows' => $selected,
        'count' => count($numbers),
        'digest' => $digest,
        'api_only_excluded' => count($dailyRows) - count($selected),
    ];
}

/**
 * Freeze a started job, but allow the transactional writer to reconcile an
 * integration-owned job that has not started yet. Partner may legitimately
 * advance an allowed lifecycle status or refresh updated_at after Fleetbase has
 * pre-dispatched the job; those raw hash changes are not an operational conflict
 * until Navigator records started/started_at.
 */
function guardDailyDispatchedReconciliation(
    bool $started,
    bool $routable,
    ?string $expectedDriver,
    ?string $actualDriver,
    ?string $storedSourceHash,
    string $currentSourceHash,
    ?string $storedMealHash,
    string $currentMealHash,
): void
{
    if (!$routable) {
        if ($started) {
            throw new RuntimeException('daily_started_snapshot_changed');
        }
        return;
    }
    if ($expectedDriver === null) {
        throw new RuntimeException('daily_allocation_driver');
    }
    if (!$started) {
        return;
    }
    if ($actualDriver !== $expectedDriver
        || $storedSourceHash !== $currentSourceHash
        || $storedMealHash !== $currentMealHash) {
        throw new RuntimeException('daily_started_snapshot_changed');
    }
}

/**
 * This preflight runs before FleetbaseWriter. Started jobs are immutable;
 * unstarted integration-owned rows may proceed to the outer transaction, where
 * the writer atomically refreshes, reassigns, holds, or tombstones them.
 */
function guardDailyOperationalRows(
    string $prefix,
    array $dailyRows,
    array $drivers,
    string $companyUuid,
    bool $allowAddressCall = false,
): void
{
    $byInternalId = [];
    foreach ($dailyRows as $row) {
        $byInternalId[$prefix . '-ORDER-' . $row['order_id']] = $row;
    }
    $allocation = allocateDailyDrivers($dailyRows, $drivers, $allowAddressCall);
    $existing = Order::withoutGlobalScopes()
        ->where('company_uuid', $companyUuid)
        ->where('internal_id', 'like', $prefix . '-ORDER-%')
        ->whereNull('deleted_at')
        ->get([
            'internal_id',
            'status',
            'dispatched',
            'driver_assigned_uuid',
            'scheduled_at',
            'started',
            'started_at',
            'meta',
        ]);
    foreach ($existing as $order) {
        $meta = metaArray($order->meta);
        if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($meta['integration_prefix'] ?? null) !== $prefix) {
            throw new RuntimeException('daily_foreign_order');
        }
        if (($meta['daily_source_selector'] ?? null) !== DAILY_SOURCE_SELECTOR) {
            // Old meal-history prefixes must never be reconciled against the
            // new complete selector; doing so could tombstone valid live jobs.
            throw new RuntimeException('daily_source_selector_mismatch');
        }
    }
    foreach ($existing as $order) {
        if (!isset($byInternalId[$order->internal_id])) {
            $meta = metaArray($order->meta);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $prefix) {
                throw new RuntimeException('daily_foreign_order');
            }
            if ((bool) $order->started || $order->started_at !== null) {
                throw new RuntimeException('daily_started_source_missing');
            }
            if (!in_array((string) $order->status, ['created', 'dispatched', 'canceled'], true)) {
                throw new RuntimeException('daily_missing_source_state_guard');
            }
            // DailyDispatchWriter will atomically convert an unstarted missing
            // source row to an unassigned cancellation tombstone.
            continue;
        }
        if ((string) $order->status === 'created'
            && !(bool) $order->dispatched
            && !(bool) $order->started
            && $order->started_at === null) {
            // Created orders have not entered the operational lifecycle. The
            // outer transaction may safely assign, repair, unassign, or hold.
            continue;
        }
        $row = $byInternalId[$order->internal_id];
        if ((string) $order->status === 'canceled'
            && !(bool) $order->dispatched
            && !(bool) $order->started
            && $order->started_at === null
            && dailyHoldReason($row) === 'source_order_canceled') {
            // An explicit source cancellation is an idempotent terminal
            // tombstone. It is never silently reactivated.
            continue;
        }
        if ((string) $order->status !== 'dispatched' || !(bool) $order->dispatched) {
            throw new RuntimeException('daily_operational_state_guard');
        }
        $meta = metaArray($order->meta);
        if (($meta['call_customer_required'] ?? false) === true
            && !$allowAddressCall
            && in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )) {
            throw new RuntimeException('daily_address_call_confirmation_required');
        }
        $expectedDriver = $allocation['assignments'][(string) $row['order_id']] ?? null;
        guardDailyDispatchedReconciliation(
            (bool) $order->started || $order->started_at !== null,
            rowIsDailyRoutable($row, $allowAddressCall),
            $expectedDriver,
            $order->driver_assigned_uuid,
            $meta['daily_source_hash'] ?? null,
            $row['_source_hash'],
            $meta['daily_meal_hash'] ?? null,
            dailyMealHash($row),
        );
    }
}

/**
 * The integration suppresses Eloquent events to avoid notifications/webhooks, so
 * it must explicitly perform the cache invalidation those observers normally do.
 */
function invalidateDailyCaches(string $prefix, string $companyUuid): array
{
    $previousCompany = session('company');
    try {
        session(['company' => $companyUuid]);
        LiveCacheService::invalidateMultiple([
            'orders',
            'routes',
            'coordinates',
            'drivers',
            'places',
            'operations-monitor',
        ]);
        $apiCacheModels = [
            Order::class,
            Payload::class,
            Contact::class,
            Place::class,
            TrackingNumber::class,
            TrackingStatus::class,
        ];
        foreach ($apiCacheModels as $modelClass) {
            ApiModelCache::invalidateModelCache(new $modelClass(), $companyUuid);
        }
        ResponseCache::clear();

        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $companyUuid)
            ->where('internal_id', 'like', $prefix . '-ORDER-%')
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $prefix)
            ->whereNull('deleted_at')
            ->get();
        $payloadUuids = $orders->pluck('payload_uuid')->filter()->unique()->values()->all();
        $customerUuids = $orders->pluck('customer_uuid')->filter()->unique()->values()->all();
        $payloads = $payloadUuids === []
            ? collect()
            : Payload::withoutGlobalScopes()->whereIn('uuid', $payloadUuids)->get();
        $placeUuids = $payloads
            ->flatMap(fn (Payload $payload): array => array_values(array_filter([
                $payload->pickup_uuid,
                $payload->dropoff_uuid,
            ])))
            ->unique()
            ->values()
            ->all();
        $contacts = $customerUuids === []
            ? collect()
            : Contact::withoutGlobalScopes()->whereIn('uuid', $customerUuids)->get();
        $places = $placeUuids === []
            ? collect()
            : Place::withoutGlobalScopes()->whereIn('uuid', $placeUuids)->get();
        foreach ([$orders, $payloads, $contacts, $places] as $models) {
            foreach ($models as $model) {
                if (method_exists($model, 'flushAttributesCache')) {
                    $model->flushAttributesCache();
                }
            }
        }
        foreach ($orders as $order) {
            Cache::forget('order:' . $order->uuid . ':tracker');
        }
        return [
            'live_endpoints_invalidated' => 6,
            'api_model_tables_invalidated' => count($apiCacheModels),
            'http_response_cache_cleared' => true,
            'order_attribute_caches_flushed' => $orders->count(),
            'payload_attribute_caches_flushed' => $payloads->count(),
            'contact_attribute_caches_flushed' => $contacts->count(),
            'place_attribute_caches_flushed' => $places->count(),
            'tracker_caches_forgotten' => $orders->count(),
        ];
    } catch (Throwable) {
        throw new RuntimeException('daily_cache_invalidation');
    } finally {
        if ($previousCompany === null) {
            session()->forget('company');
        } else {
            session(['company' => $previousCompany]);
        }
    }
}

function deduplicateRows(array $rows): array
{
    $byId = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            throw new RuntimeException('contract_row_object');
        }
        $candidate = validateRow($row);
        $id = $candidate['order_id'];
        if (!isset($byId[$id])) {
            $byId[$id] = $candidate;
            continue;
        }
        $existingTime = parseTimestamp($byId[$id]['updated_at'], 'updated_at');
        $candidateTime = parseTimestamp($candidate['updated_at'], 'updated_at');
        if ($candidateTime > $existingTime) {
            $byId[$id] = $candidate;
        } elseif ($candidateTime == $existingTime && $candidate['_source_hash'] !== $byId[$id]['_source_hash']) {
            throw new RuntimeException('contract_conflicting_duplicate');
        }
    }
    ksort($byId, SORT_NUMERIC);
    return array_values($byId);
}

function maxUpdatedAt(array $rows): ?string
{
    $max = null;
    $maxTime = null;
    foreach ($rows as $row) {
        $time = parseTimestamp($row['updated_at'], 'updated_at');
        if ($maxTime === null || $time > $maxTime) {
            $maxTime = $time;
            $max = $row['updated_at'];
        }
    }
    return $max;
}

final class VendorClient
{
    public function __construct(private string $token)
    {
        if (strlen($token) < 8 || strlen($token) > 4096 || preg_match('/[\x00-\x1F\x7F]/', $token)) {
            throw new RuntimeException('vendor_token_invalid');
        }
    }

    public function fetchAll(string $since, int $limit, ?int $failAfterPage = null): array
    {
        $rows = [];
        $cursor = null;
        $seen = [];
        $page = 0;

        do {
            $page++;
            if ($page > 10000) {
                throw new RuntimeException('vendor_page_guard');
            }
            $query = ['since' => $since, 'limit' => $limit];
            if ($cursor !== null) {
                $query['cursor'] = $cursor;
            }
            $url = VENDOR_BASE . '/orders?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
            $handle = curl_init($url);
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT => 45,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_HTTPHEADER => [
                    'X-Api-Key: ' . $this->token,
                    'Accept: application/json',
                ],
            ]);
            $requestTime = kuwaitNow();
            $raw = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
            $curlFailed = $raw === false;
            curl_close($handle);

            if ($curlFailed) {
                throw new RuntimeException('vendor_network');
            }
            if ($status === 401 || $status === 403) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/orders', 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown', 'watermark' => $since]);
                throw new RuntimeException('vendor_auth');
            }
            if ($status !== 200) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/orders', 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown', 'watermark' => $since]);
                throw new RuntimeException('vendor_http');
            }

            try {
                $payload = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                throw new RuntimeException('vendor_json');
            } finally {
                $raw = null;
            }
            if (!is_array($payload)
                || !isset($payload['data'])
                || !is_array($payload['data'])
                || !array_key_exists('count', $payload)
                || !is_int($payload['count'])
                || $payload['count'] < 0
                || $payload['count'] !== count($payload['data'])
                || !isset($payload['server_time'])
                || !is_string($payload['server_time'])
                || !array_key_exists('next_cursor', $payload)) {
                throw new RuntimeException('vendor_envelope');
            }
            parseTimestamp($payload['server_time'], 'server_time');
            $next = $payload['next_cursor'];
            if ($next !== null && !is_int($next) && !is_string($next)) {
                throw new RuntimeException('vendor_cursor_type');
            }
            if (is_string($next) && $next === '') {
                throw new RuntimeException('vendor_cursor_type');
            }
            if ($next !== null && $payload['data'] === []) {
                throw new RuntimeException('vendor_cursor_no_progress');
            }
            safeLog('vendor_page', [
                'request_time' => $requestTime,
                'endpoint' => '/orders',
                'http_status' => 200,
                'page' => $page,
                'row_count' => count($payload['data']),
                'cursor_state' => $next === null ? 'null' : 'present',
                'watermark' => $since,
            ]);
            array_push($rows, ...$payload['data']);

            if ($failAfterPage !== null && $page >= $failAfterPage) {
                throw new RuntimeException('test_failure_after_page');
            }
            if ($next !== null) {
                if (isset($seen[$next])) {
                    throw new RuntimeException('vendor_cursor_loop');
                }
                $seen[$next] = true;
            }
            $cursor = $next;
        } while ($cursor !== null);

        return ['rows' => $rows, 'pages' => $page];
    }

    public function fetchDailySource(string $deliveryDate, int $limit): array
    {
        $deliveryDate = validateDeliveryDate($deliveryDate);
        $deliveries = $this->fetchEndpoint(
            'daily-deliveries',
            ['delivery_date' => $deliveryDate],
            $limit,
            function (mixed $raw) use ($deliveryDate): ?array {
                if (!is_array($raw)) {
                    throw new RuntimeException('contract_daily_delivery_row_object');
                }
                validateDailyDeliveryRow($raw, $deliveryDate);
                return $raw;
            },
            100,
        );
        $completeness = $deliveries['daily_completeness'] ?? null;
        if (!is_array($completeness)
            || ($completeness['delivery_date'] ?? null) !== $deliveryDate
            || ($completeness['deliveries'] ?? null) !== $deliveries['response_rows']) {
            throw new RuntimeException('vendor_daily_completeness_mismatch');
        }
        return [
            'delivery_rows' => $deliveries['rows'],
            'delivery_pages' => $deliveries['pages'],
            'delivery_response_rows' => $deliveries['response_rows'],
            'daily_completeness' => $completeness,
        ];
    }

    /**
     * Cursor walker shared by the daily endpoints. The transform validates the
     * selector on every row and the full contract on the day's relevant subset, so
     * unrelated historical anomalies cannot block a daily run and historical PII is
     * never written to disk or accumulated in memory.
     */
    private function fetchEndpoint(
        string $endpoint,
        array $baseQuery,
        int $limit,
        callable $transform,
        int $maxPages,
    ): array
    {
        if (!in_array($endpoint, ['orders', 'meal-history', 'daily-deliveries'], true)) {
            throw new RuntimeException('vendor_endpoint');
        }
        $rows = [];
        $cursor = null;
        $seen = [];
        $page = 0;
        $responseRows = 0;
        $dailyCompleteness = null;
        $dailyCompletenessHash = null;
        do {
            $page++;
            if ($page > $maxPages) {
                throw new RuntimeException('vendor_page_guard');
            }
            $query = $baseQuery + ['limit' => $limit];
            if ($cursor !== null) {
                $query['cursor'] = $cursor;
            }
            $url = VENDOR_BASE . '/' . $endpoint . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
            $attempt = 0;
            do {
                $attempt++;
                $handle = curl_init($url);
                curl_setopt_array($handle, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_FOLLOWLOCATION => false,
                    CURLOPT_CONNECTTIMEOUT => 10,
                    CURLOPT_TIMEOUT => 120,
                    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                    CURLOPT_HTTPHEADER => [
                        'X-Api-Key: ' . $this->token,
                        'Accept: application/json',
                    ],
                ]);
                $requestTime = kuwaitNow();
                $raw = curl_exec($handle);
                $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
                $curlFailed = $raw === false;
                curl_close($handle);
                $retryable = $curlFailed || $status === 429 || ($status >= 500 && $status <= 599);
                if (!$retryable || $attempt >= 3) {
                    break;
                }
                safeLog('vendor_retry', [
                    'request_time' => $requestTime,
                    'endpoint' => '/' . $endpoint,
                    'http_status' => $status,
                    'page' => $page,
                    'attempt' => $attempt,
                ]);
                $raw = null;
                usleep(1000000 * $attempt);
            } while (true);
            if ($curlFailed) {
                throw new RuntimeException('vendor_network');
            }
            if ($status === 401 || $status === 403) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/' . $endpoint, 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown']);
                throw new RuntimeException('vendor_auth');
            }
            if ($status !== 200) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/' . $endpoint, 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown']);
                throw new RuntimeException('vendor_http');
            }
            try {
                $payload = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                throw new RuntimeException('vendor_json');
            } finally {
                $raw = null;
            }
            if (!is_array($payload)
                || !isset($payload['data'])
                || !is_array($payload['data'])
                || !array_key_exists('count', $payload)
                || !is_int($payload['count'])
                || $payload['count'] < 0
                || $payload['count'] !== count($payload['data'])
                || !isset($payload['server_time'])
                || !is_string($payload['server_time'])
                || !array_key_exists('next_cursor', $payload)) {
                throw new RuntimeException('vendor_envelope');
            }
            parseTimestamp($payload['server_time'], 'server_time');
            if ($endpoint === 'daily-deliveries') {
                if (($payload['mode'] ?? null) !== 'live'
                    || !is_array($payload['completeness'] ?? null)
                    || !is_array($payload['completeness']['per_date'] ?? null)) {
                    throw new RuntimeException('vendor_daily_completeness');
                }
                $completeness = $payload['completeness'];
                $snapshotBuiltAt = requiredString($completeness, 'snapshot_built_at', 64);
                parseTimestamp($snapshotBuiltAt, 'snapshot_built_at');
                foreach (['snapshot_age_seconds', 'refresh_interval_minutes', 'rows_in_window'] as $field) {
                    if (!isset($completeness[$field]) || !is_int($completeness[$field]) || $completeness[$field] < 0) {
                        throw new RuntimeException('vendor_daily_completeness_' . $field);
                    }
                }
                $windowFrom = validateDeliveryDate(requiredString($completeness, 'window_from', 10), 'window_from');
                $windowTo = validateDeliveryDate(requiredString($completeness, 'window_to', 10), 'window_to');
                $selectedDate = (string) ($baseQuery['delivery_date'] ?? '');
                if ($selectedDate < $windowFrom || $selectedDate > $windowTo) {
                    throw new RuntimeException('vendor_daily_window');
                }
                $matching = array_values(array_filter(
                    $completeness['per_date'],
                    fn (mixed $item): bool => is_array($item)
                        && ($item['delivery_date'] ?? null) === $selectedDate,
                ));
                if (count($matching) > 1) {
                    throw new RuntimeException('vendor_daily_completeness_date');
                }
                if ($matching === []) {
                    if ($payload['data'] !== [] || $payload['count'] !== 0) {
                        throw new RuntimeException('vendor_daily_completeness_date');
                    }
                    // The live endpoint omits zero-delivery dates from per_date.
                    // Inside its declared window, an empty selected response is
                    // therefore normalized to an explicit zero-day contract.
                    $daily = [
                        'deliveries' => 0,
                        'distinct_orders' => 0,
                        'scheduled' => 0,
                        'on_hold' => 0,
                        'cancelled' => 0,
                    ];
                } else {
                    $daily = $matching[0];
                }
                foreach (['deliveries', 'distinct_orders', 'scheduled', 'on_hold', 'cancelled'] as $field) {
                    if (!isset($daily[$field]) || !is_int($daily[$field]) || $daily[$field] < 0) {
                        throw new RuntimeException('vendor_daily_completeness_' . $field);
                    }
                }
                if ($daily['scheduled'] + $daily['on_hold'] + $daily['cancelled'] !== $daily['deliveries']) {
                    throw new RuntimeException('vendor_daily_completeness_total');
                }
                $normalizedCompleteness = [
                    'delivery_date' => $selectedDate,
                    'deliveries' => $daily['deliveries'],
                    'distinct_orders' => $daily['distinct_orders'],
                    'scheduled' => $daily['scheduled'],
                    'on_hold' => $daily['on_hold'],
                    'cancelled' => $daily['cancelled'],
                ];
                $completenessHash = hash('sha256', json_encode($normalizedCompleteness, JSON_THROW_ON_ERROR));
                if ($dailyCompletenessHash !== null && !hash_equals($dailyCompletenessHash, $completenessHash)) {
                    throw new RuntimeException('vendor_daily_completeness_changed');
                }
                $dailyCompleteness = $normalizedCompleteness;
                $dailyCompletenessHash = $completenessHash;
            }
            $next = $payload['next_cursor'];
            if ($next !== null && !is_int($next) && !is_string($next)) {
                throw new RuntimeException('vendor_cursor_type');
            }
            if (is_string($next) && $next === '') {
                throw new RuntimeException('vendor_cursor_type');
            }
            if ($next !== null && $payload['data'] === []) {
                throw new RuntimeException('vendor_cursor_no_progress');
            }
            $responseRows += count($payload['data']);
            foreach ($payload['data'] as $sourceRow) {
                $selected = $transform($sourceRow);
                if ($selected !== null) {
                    $rows[] = $selected;
                }
            }
            safeLog('vendor_page', [
                'request_time' => $requestTime,
                'endpoint' => '/' . $endpoint,
                'http_status' => 200,
                'page' => $page,
                'row_count' => count($payload['data']),
                'selected_count' => count($rows),
                'cursor_state' => $next === null ? 'null' : 'present',
            ]);
            if ($next !== null) {
                $nextKey = (string) $next;
                if (isset($seen[$nextKey])) {
                    throw new RuntimeException('vendor_cursor_loop');
                }
                $seen[$nextKey] = true;
            }
            $cursor = $next;
        } while ($cursor !== null);
        return [
            'rows' => $rows,
            'pages' => $page,
            'response_rows' => $responseRows,
            'daily_completeness' => $dailyCompleteness,
        ];
    }
}

final class WatermarkStore
{
    public function __construct(private string $path)
    {
        $root = '/fleetbase/api/storage/app/integrations/state';
        if (!file_exists($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
            throw new RuntimeException('watermark_directory');
        }
        $directory = dirname($this->path);
        if ($directory !== $root
            || is_link($directory)
            || realpath($directory) !== $root
            || !preg_match('/^[a-z0-9][a-z0-9-]{2,80}\.json$/', basename($this->path))
            || is_link($this->path)) {
            throw new RuntimeException('watermark_path_invalid');
        }
    }

    public function read(): ?string
    {
        if (!is_file($this->path)) {
            return null;
        }
        $decoded = json_decode((string) file_get_contents($this->path), true);
        if (!is_array($decoded) || !isset($decoded['updated_at']) || !is_string($decoded['updated_at'])) {
            throw new RuntimeException('watermark_invalid');
        }
        parseTimestamp($decoded['updated_at'], 'watermark');
        return $decoded['updated_at'];
    }

    public function write(string $updatedAt): void
    {
        parseTimestamp($updatedAt, 'watermark');
        $directory = dirname($this->path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('watermark_directory');
        }
        chmod($directory, 0700);
        $temporary = tempnam($directory, '.watermark-');
        if ($temporary === false || is_link($temporary)) {
            throw new RuntimeException('watermark_temporary');
        }
        $contents = json_encode(['updated_at' => $updatedAt, 'committed_at' => kuwaitNow()], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        if (file_put_contents($temporary, $contents, LOCK_EX) === false) {
            throw new RuntimeException('watermark_write');
        }
        chmod($temporary, 0600);
        if (!rename($temporary, $this->path)) {
            @unlink($temporary);
            throw new RuntimeException('watermark_rename');
        }
        chmod($this->path, 0600);
    }

    public function remove(): void
    {
        if (is_link($this->path)) {
            throw new RuntimeException('watermark_path_invalid');
        }
        if (is_file($this->path)) {
            if (!unlink($this->path)) {
                throw new RuntimeException('watermark_remove');
            }
        }
    }
}

final class FleetbaseWriter
{
    private string $companyUuid;
    private string $orderConfigUuid;
    private array $customerCache = [];
    private ?array $verificationResult = null;
    private array $touchedSubjectIds = ['order' => [], 'contact' => [], 'payload' => [], 'place' => []];
    private array $stats = [
        'orders_created' => 0,
        'orders_updated' => 0,
        'orders_unchanged' => 0,
        'customers_created' => 0,
        'customers_updated' => 0,
        'customers_unchanged' => 0,
        'payloads_created' => 0,
        'payloads_updated' => 0,
        'payloads_unchanged' => 0,
        'places_created' => 0,
        'places_updated' => 0,
        'places_unchanged' => 0,
        'places_removed' => 0,
        'null_pin_orders' => 0,
        'non_null_pin_orders' => 0,
        'area_fallback_places' => 0,
        'tracking_numbers_created' => 0,
        'tracking_numbers_adopted' => 0,
        'tracking_statuses_created' => 0,
    ];
    private string $trackingNumberPrefix;

    public function __construct(
        private string $prefix,
        private bool $allowAddressCall = false,
    )
    {
        $this->companyUuid = resolveCompanyUuid();
        // Native tracking numbers are prefixed with the first 3 letters of the company
        // name (TrackingNumber::generateTrackingNumber). session('company') is empty in
        // CLI, so derive the prefix explicitly from the resolved company.
        $companyName = (string) (DB::table('companies')->where('uuid', $this->companyUuid)->value('name') ?? '');
        $derived = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $companyName) ?? '', 0, 3));
        $this->trackingNumberPrefix = strlen($derived) === 3 ? $derived : 'FLB';

        $companyConfigs = OrderConfig::withoutGlobalScopes()
            ->where('key', 'transport')
            ->whereNull('deleted_at')
            ->where('company_uuid', $this->companyUuid)
            ->get();
        $globalConfigs = OrderConfig::withoutGlobalScopes()
            ->where('key', 'transport')
            ->whereNull('deleted_at')
            ->whereNull('company_uuid')
            ->get();
        $configs = $companyConfigs->isNotEmpty() ? $companyConfigs : $globalConfigs;
        if ($configs->count() !== 1) {
            throw new RuntimeException('fleetbase_order_config');
        }
        $this->orderConfigUuid = (string) $configs->first()->uuid;
    }

    public function upsert(array $eligible, ?array $verifyRows = null): array
    {
        $activityIdBefore = (int) (DB::table('activity')->max('id') ?? 0);
        $cancelStateBefore = [];
        if ($verifyRows !== null) {
            foreach ($verifyRows as $row) {
                if ($row['status'] === 'cancel') {
                    $key = $this->prefix . '-ORDER-' . $row['order_id'];
                    $cancelStateBefore[$key] = Order::withoutGlobalScopes()
                        ->where('company_uuid', $this->companyUuid)
                        ->where('internal_id', $key)
                        ->exists();
                }
            }
        }
        DB::transaction(function () use ($eligible, $verifyRows, $cancelStateBefore, $activityIdBefore): void {
            foreach (latestCustomerRows($eligible) as $row) {
                $this->upsertCustomer($row);
            }
            foreach ($eligible as $row) {
                $this->upsertOne($row);
            }
            if ($verifyRows !== null) {
                $this->verificationResult = $this->verify($verifyRows, $cancelStateBefore);
            }
            $newTouchedActivity = DB::table('activity')
                ->where('id', '>', $activityIdBefore)
                ->where(function ($query) {
                    $query->where(function ($orderQuery) {
                        $orderQuery->where('subject_type', Order::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['order'])));
                    })->orWhere(function ($contactQuery) {
                        $contactQuery->where('subject_type', Contact::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['contact'])));
                    })->orWhere(function ($payloadQuery) {
                        $payloadQuery->where('subject_type', Payload::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['payload'])));
                    })->orWhere(function ($placeQuery) {
                        $placeQuery->where('subject_type', Place::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['place'])));
                    });
                })
                ->count();
            $this->stats['activity_rows_created'] = $newTouchedActivity;
            if ($newTouchedActivity !== 0) {
                throw new RuntimeException('fleetbase_activity_log_write');
            }
        }, 1);
        return $this->stats;
    }

    public function verificationResult(): ?array
    {
        return $this->verificationResult;
    }

    private function assertOwned(object $model, string $kind): void
    {
        $meta = metaArray($model->meta ?? null);
        if (($model->company_uuid ?? null) !== $this->companyUuid
            || ($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($meta['integration_prefix'] ?? null) !== $this->prefix) {
            throw new RuntimeException('fleetbase_foreign_' . $kind);
        }
    }

    private function assertCustomerOwned(Contact $customer, array $row): void
    {
        $this->assertOwned($customer, 'customer');
        $meta = metaArray($customer->meta);
        if (($meta['source_customer_ref'] ?? null) !== $row['customer_ref']) {
            throw new RuntimeException('fleetbase_foreign_customer_ref');
        }
        $linkedOrders = DB::table('orders')
            ->where('customer_uuid', $customer->uuid)
            ->get(['company_uuid', 'internal_id', 'meta']);
        foreach ($linkedOrders as $linkedOrder) {
            $linkedMeta = metaArray($linkedOrder->meta ?? null);
            if (($linkedOrder->company_uuid ?? null) !== $this->companyUuid
                || ($linkedMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($linkedMeta['integration_prefix'] ?? null) !== $this->prefix
                || !is_string($linkedOrder->internal_id ?? null)
                || !str_starts_with($linkedOrder->internal_id, $this->prefix . '-ORDER-')) {
                throw new RuntimeException('fleetbase_shared_customer');
            }
        }
        $linkedPlaces = DB::table('places')
            ->where('owner_uuid', $customer->uuid)
            ->get(['uuid', 'company_uuid', 'meta']);
        foreach ($linkedPlaces as $linkedPlace) {
            $linkedMeta = metaArray($linkedPlace->meta ?? null);
            if (($linkedPlace->company_uuid ?? null) !== $this->companyUuid
                || ($linkedMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($linkedMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
            $linkedPayloads = DB::table('payloads')
                ->where('dropoff_uuid', $linkedPlace->uuid)
                ->get(['company_uuid', 'meta']);
            if ($linkedPayloads->count() !== 1) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
            $payloadMeta = metaArray($linkedPayloads->first()->meta ?? null);
            if (($linkedPayloads->first()->company_uuid ?? null) !== $this->companyUuid
                || ($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
        }
        if (!empty($customer->user_uuid)
            || !empty($customer->place_uuid)
            || !empty($customer->photo_uuid)
            || hasForbiddenContactReference([$customer->uuid])
            || hasForeignOperationalContactReference([$customer->uuid], $this->companyUuid, $this->prefix)) {
            throw new RuntimeException('fleetbase_shared_customer_reference');
        }
    }

    private function assertOrderOwned(Order $order, array $row): void
    {
        $this->assertOwned($order, 'order');
        $meta = metaArray($order->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('fleetbase_foreign_order_id');
        }
        $storedUpdated = $meta['source_updated_at'] ?? null;
        if (is_string($storedUpdated)
            && parseTimestamp($row['updated_at'], 'updated_at') < parseTimestamp($storedUpdated, 'stored_source_updated_at')) {
            throw new RuntimeException('fleetbase_stale_source');
        }
    }

    private function assertPayloadOwned(Payload $payload, Order $order, array $row): void
    {
        $this->assertOwned($payload, 'payload');
        $meta = metaArray($payload->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('fleetbase_foreign_payload_id');
        }
        if (DB::table('orders')->where('payload_uuid', $payload->uuid)->where('uuid', '!=', $order->uuid)->exists()) {
            throw new RuntimeException('fleetbase_shared_payload');
        }
    }

    private function assertPlaceOwned(Place $place, Payload $payload, Contact $customer, array $row): void
    {
        $this->assertOwned($place, 'place');
        $meta = metaArray($place->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']
            || ($meta['integration_key'] ?? null) !== $this->prefix . '-PLACE-' . $row['order_id']
            || $place->owner_uuid !== $customer->uuid
            || placeHasForeignReference($place->uuid, $payload->uuid)) {
            throw new RuntimeException('fleetbase_foreign_place_reference');
        }
    }

    private function upsertCustomer(array $row): Contact
    {
        $ref = $row['customer_ref'];
        if (isset($this->customerCache[$ref])) {
            return $this->customerCache[$ref];
        }
        $internalId = $this->prefix . '-CUSTOMER-' . $ref;
        $query = Contact::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('fleetbase_duplicate_customer_key');
        }
        $customer = $query->lockForUpdate()->first();
        $created = $customer === null;
        $customer ??= new Contact();
        if (!$created) {
            $this->assertCustomerOwned($customer, $row);
        }
        $meta = metaArray($customer->meta);
        if (!$created
            && ($meta['mapping_version'] ?? null) === MAPPING_VERSION
            && ($meta['source_updated_at'] ?? null) === $row['updated_at']
            && $customer->deleted_at === null
            && $customer->type === 'customer'
            && $customer->name === $row['customer_name']
            && $customer->phone === $row['customer_phone']) {
            $this->stats['customers_unchanged']++;
            return $this->customerCache[$ref] = $customer;
        }
        $customer->fill([
            'company_uuid' => $this->companyUuid,
            'internal_id' => $internalId,
            'name' => $row['customer_name'],
            'phone' => $row['customer_phone'],
            'type' => 'customer',
            'meta' => array_replace($meta, [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_customer_ref' => $ref,
                'source_updated_at' => $row['updated_at'],
            ]),
        ]);
        $customer->setAttribute('deleted_at', null);
        $changed = saveWithoutActivity($customer);
        $this->touchedSubjectIds['contact'][] = $customer->getKey();
        $this->stats[$created ? 'customers_created' : ($changed ? 'customers_updated' : 'customers_unchanged')]++;
        return $this->customerCache[$ref] = $customer;
    }

    private function upsertOne(array $row): void
    {
        $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
        $query = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('fleetbase_duplicate_order_key');
        }
        $order = $query->lockForUpdate()->first();
        $orderCreated = $order === null;
        $order ??= new Order();
        if (!$orderCreated) {
            $this->assertOrderOwned($order, $row);
        }

        $customer = $this->upsertCustomer($row);
        $payload = $order->payload_uuid
            ? Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first()
            : null;
        $payloadCreated = $payload === null;
        $payload ??= new Payload();
        if (!$payloadCreated) {
            $this->assertPayloadOwned($payload, $order, $row);
        }
        $existingPlace = $payload->dropoff_uuid
            ? Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first()
            : null;
        $effectivePin = resolveEffectivePin($row);
        if (!$orderCreated && !$payloadCreated) {
            $orderMeta = metaArray($order->meta);
            $payloadMeta = metaArray($payload->meta);
            $expectedNotes = sourceOrderNotes($row, $this->allowAddressCall);
            $expectedStreet2 = addressCallInstruction($row, $this->allowAddressCall);
            $mappingCurrent = $order->deleted_at === null
                && $payload->deleted_at === null
                && $order->order_config_uuid === $this->orderConfigUuid
                && $order->customer_uuid === $customer->uuid
                && $order->customer_type === Contact::class
                && $order->payload_uuid === $payload->uuid
                && $order->type === 'transport'
                && $order->notes === $expectedNotes
                && ($orderMeta['mapping_version'] ?? null) === MAPPING_VERSION
                && ($orderMeta['source_order_id'] ?? null) === $row['order_id']
                && ($orderMeta['source_order_number'] ?? null) === $row['order_number']
                && ($orderMeta['source_status'] ?? null) === $row['status']
                && ($orderMeta['source_created_at'] ?? null) === $row['created_at']
                && ($orderMeta['source_updated_at'] ?? null) === $row['updated_at']
                && ($orderMeta['routing_area'] ?? null) === $row['routing_area']
                && ($orderMeta['area_en'] ?? null) === $row['area_en']
                && ($orderMeta['area_ar'] ?? null) === $row['area_ar']
                && ($orderMeta['source_location_present'] ?? null) === ($row['pin'] !== null)
                && ($orderMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                && ($payloadMeta['mapping_version'] ?? null) === MAPPING_VERSION
                && ($payloadMeta['source_order_id'] ?? null) === $row['order_id']
                && ($payloadMeta['source_order_number'] ?? null) === $row['order_number']
                && ($payloadMeta['source_updated_at'] ?? null) === $row['updated_at']
                && ($payloadMeta['routing_area'] ?? null) === $row['routing_area']
                && ($payloadMeta['area_en'] ?? null) === $row['area_en']
                && ($payloadMeta['area_ar'] ?? null) === $row['area_ar']
                && ($payloadMeta['address_text'] ?? null) === $row['address_text']
                && ($payloadMeta['source_location_pin'] ?? null) === $row['location_pin']
                && ($payloadMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                && $this->trackingIntact($order);
            // Every eligible order must have a dropoff Place: the vendor pin when
            // present, otherwise the flagged area-fallback centroid.
            if ($existingPlace) {
                $this->assertPlaceOwned($existingPlace, $payload, $customer, $row);
                $placeMeta = metaArray($existingPlace->meta);
                $mappingCurrent = $mappingCurrent
                    && $existingPlace->deleted_at === null
                    && $existingPlace->owner_type === Contact::class
                    && $existingPlace->name === sourcePlaceName($row, $this->allowAddressCall)
                    && $existingPlace->street1 === $row['address_text']
                    && $existingPlace->street2 === $expectedStreet2
                    && $existingPlace->city === $row['routing_area']
                    && $existingPlace->district === $row['routing_area']
                    && $existingPlace->neighborhood === $row['area_ar']
                    && $existingPlace->country === 'KW'
                    && $existingPlace->phone === $row['customer_phone']
                    && $existingPlace->location instanceof Point
                    && abs($existingPlace->location->getLat() - $effectivePin['lat']) <= 0.000001
                    && abs($existingPlace->location->getLng() - $effectivePin['lng']) <= 0.000001
                    && ($placeMeta['mapping_version'] ?? null) === MAPPING_VERSION
                    && ($placeMeta['source_order_id'] ?? null) === $row['order_id']
                    && ($placeMeta['source_updated_at'] ?? null) === $row['updated_at']
                    && ($placeMeta['routing_area'] ?? null) === $row['routing_area']
                    && ($placeMeta['area_en'] ?? null) === $row['area_en']
                    && ($placeMeta['area_ar'] ?? null) === $row['area_ar']
                    && ($placeMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                    && ($placeMeta['fallback_scope'] ?? null) === $effectivePin['fallback_scope'];
            } else {
                $mappingCurrent = false;
            }
            if ($mappingCurrent) {
                $this->stats['orders_unchanged']++;
                $this->stats['payloads_unchanged']++;
                $this->stats['places_unchanged']++;
                if ($row['pin'] === null) {
                    $this->stats['null_pin_orders']++;
                } else {
                    $this->stats['non_null_pin_orders']++;
                }
                return;
            }
        }
        $payload->fill([
            'company_uuid' => $this->companyUuid,
            'meta' => array_replace(metaArray($payload->meta), [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_order_id' => $row['order_id'],
                'source_order_number' => $row['order_number'],
                'source_customer_ref' => $row['customer_ref'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'address_text' => $row['address_text'],
                'source_location_pin' => $row['location_pin'],
                'pin_source' => $effectivePin['pin_source'],
                'fallback_source' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['pin_source'] : null,
                'fallback_latitude' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['lat'] : null,
                'fallback_longitude' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['lng'] : null,
                'location_capture_id' => $row['recovery_capture_id'] ?? null,
            ]),
        ]);
        $payload->setAttribute('deleted_at', null);
        $payloadChanged = saveWithoutActivity($payload);
        $this->touchedSubjectIds['payload'][] = $payload->getKey();

        if ($row['pin'] === null) {
            $this->stats['null_pin_orders']++;
        } else {
            $this->stats['non_null_pin_orders']++;
        }
        $placeCreated = $existingPlace === null;
        $place = $existingPlace ?? new Place();
        if (!$placeCreated) {
            $this->assertPlaceOwned($place, $payload, $customer, $row);
        }
        $place->fill([
            'company_uuid' => $this->companyUuid,
            'owner_uuid' => $customer->uuid,
            'owner_type' => Contact::class,
            'name' => sourcePlaceName($row, $this->allowAddressCall),
            'street1' => $row['address_text'],
            'street2' => addressCallInstruction($row, $this->allowAddressCall),
            'city' => $row['routing_area'],
            'district' => $row['routing_area'],
            'neighborhood' => $row['area_ar'],
            'country' => 'KW',
            'phone' => $row['customer_phone'],
            'location' => new Point($effectivePin['lat'], $effectivePin['lng']),
            'meta' => array_replace(metaArray($place->meta), [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'integration_key' => $this->prefix . '-PLACE-' . $row['order_id'],
                'source_order_id' => $row['order_id'],
                'source_customer_ref' => $row['customer_ref'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'pin_source' => $effectivePin['pin_source'],
                'fallback_scope' => $effectivePin['fallback_scope'],
                'location_capture_id' => $row['recovery_capture_id'] ?? null,
            ]),
        ]);
        $place->setAttribute('deleted_at', null);
        $placeChanged = saveWithoutActivity($place);
        $this->touchedSubjectIds['place'][] = $place->getKey();
        if ($effectivePin['pin_source'] === 'area_fallback') {
            $this->stats['area_fallback_places']++;
        }
        $payload->dropoff_uuid = $place->uuid;
        $payloadChanged = saveWithoutActivity($payload) || $payloadChanged;
        $this->stats[$placeCreated ? 'places_created' : ($placeChanged ? 'places_updated' : 'places_unchanged')]++;
        $this->stats[$payloadCreated ? 'payloads_created' : ($payloadChanged ? 'payloads_updated' : 'payloads_unchanged')]++;

        $orderMeta = metaArray($order->meta);
        $order->fill([
            'company_uuid' => $this->companyUuid,
            'internal_id' => $internalId,
            'order_config_uuid' => $this->orderConfigUuid,
            'customer_uuid' => $customer->uuid,
            'customer_type' => Contact::class,
            'payload_uuid' => $payload->uuid,
            'type' => 'transport',
            'status' => $orderCreated ? 'created' : $order->status,
            'notes' => sourceOrderNotes($row, $this->allowAddressCall),
            'meta' => array_replace($orderMeta, [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_order_id' => $row['order_id'],
                'source_order_number' => $row['order_number'],
                'source_customer_ref' => $row['customer_ref'],
                'source_status' => $row['status'],
                'source_created_at' => $row['created_at'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'source_location_present' => $row['pin'] !== null,
                'pin_source' => $effectivePin['pin_source'],
                'fallback_source' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['pin_source'] : null,
                'fallback_latitude' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['lat'] : null,
                'fallback_longitude' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                    ? $effectivePin['lng'] : null,
                'location_capture_id' => $row['recovery_capture_id'] ?? null,
            ]),
        ]);
        $order->setAttribute('deleted_at', null);
        $orderChanged = saveWithoutActivity($order);
        $this->touchedSubjectIds['order'][] = $order->getKey();
        $this->ensureTrackingRecords($order, $effectivePin, (string) ($place->country ?: 'KW'));
        $this->stats[$orderCreated ? 'orders_created' : ($orderChanged ? 'orders_updated' : 'orders_unchanged')]++;
    }

    /**
     * True when the order already has the tracking records the Fleet-Ops console
     * requires (OrderFilter::queryForInternal → whereHas trackingNumber +
     * trackingStatuses), and they belong to this company and this order.
     */
    private function trackingIntact(Order $order): bool
    {
        if (empty($order->tracking_number_uuid)) {
            return false;
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            return false;
        }
        return DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->exists();
    }

    /**
     * Create (idempotently) the tracking records a native Fleetbase order gets from
     * TrackingNumber::insertGetUuid(): one tracking_numbers row (owner = the order)
     * and one initial CREATED tracking_statuses row, then point
     * orders.tracking_number_uuid / tracking_numbers.status_uuid at them.
     *
     * Mirrors the native insert shape exactly (query-builder inserts — the native
     * path is also event-free) with two deliberate CLI adaptations:
     *  - company_uuid / tracking number prefix come from the resolved company
     *    (native reads session('company'), which is empty in CLI);
     *  - the initial status location is the order's dropoff pin instead of the
     *    native placeholder POINT(0 0), so no fake (0,0) coordinate is emitted.
     * No dispatch/webhook side effects: no Eloquent events fire at any point.
     */
    private function ensureTrackingRecords(Order $order, array $effectivePin, string $region): void
    {
        $trackingNumberUuid = $order->tracking_number_uuid ?: null;
        if ($trackingNumberUuid === null) {
            // Adopt an orphan tracking number from a prior partial run before creating.
            $orphan = DB::table('tracking_numbers')
                ->where('owner_uuid', $order->uuid)
                ->whereNull('deleted_at')
                ->orderBy('id')
                ->first(['uuid']);
            $trackingNumberUuid = $orphan->uuid ?? null;
            if ($trackingNumberUuid !== null) {
                $this->stats['tracking_numbers_adopted']++;
            }
        }
        if ($trackingNumberUuid !== null) {
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $trackingNumberUuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
            if (!$trackingNumber
                || $trackingNumber->company_uuid !== $this->companyUuid
                || $trackingNumber->owner_uuid !== $order->uuid) {
                throw new RuntimeException('fleetbase_foreign_tracking_number');
            }
        } else {
            $trackingNumberUuid = TrackingNumber::generateUuid();
            DB::table('tracking_numbers')->insert([
                'uuid' => $trackingNumberUuid,
                'public_id' => TrackingNumber::generatePublicId('track'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'owner_uuid' => $order->uuid,
                'owner_type' => Order::class,
                'region' => strtoupper($region),
                'tracking_number' => $this->generateUniqueTrackingNumber(strtoupper($region)),
                'qr_code' => DNS2D::getBarcodePNG($order->uuid, 'QRCODE'),
                'barcode' => DNS2D::getBarcodePNG($order->uuid, 'PDF417'),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_numbers_created']++;
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $trackingNumberUuid)
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        }

        $statusUuid = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumberUuid)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->value('uuid');
        if ($statusUuid === null) {
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumberUuid,
                'status' => 'Order Created',
                'details' => 'New order created.',
                'code' => 'CREATED',
                'complete' => 0,
                'location' => FleetOpsUtils::parsePointToWkt(new Point($effectivePin['lat'], $effectivePin['lng'])),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) === null) {
            DB::table('tracking_numbers')->where('uuid', $trackingNumberUuid)->update(['status_uuid' => $statusUuid]);
        }
        if ($order->tracking_number_uuid !== $trackingNumberUuid) {
            // Same silent write the native path uses after insertGetUuid.
            DB::table('orders')->where('uuid', $order->uuid)->update(['tracking_number_uuid' => $trackingNumberUuid]);
            $order->setAttribute('tracking_number_uuid', $trackingNumberUuid);
            $order->syncOriginalAttribute('tracking_number_uuid');
        }
    }

    /**
     * Company-prefixed tracking number, unique against existing rows (incl. trashed),
     * matching TrackingNumber::generateTrackingNumber()'s NNN##########RR shape.
     */
    private function generateUniqueTrackingNumber(string $region): string
    {
        $guard = 0;
        do {
            if (++$guard > 100) {
                throw new RuntimeException('tracking_number_generation');
            }
            $number = $this->trackingNumberPrefix;
            for ($i = 0; $i < 10; $i++) {
                $number .= random_int(0, 9);
            }
            $number .= $region;
        } while (DB::table('tracking_numbers')->where('tracking_number', $number)->exists());
        return $number;
    }

    /**
     * Re-run the current mapping (tracking records + always-a-dropoff-place) over the
     * integration-owned orders already persisted for this prefix, rebuilding each
     * vendor row from the metadata stored at import time and pushing it through the
     * exact same validateRow() → upsert() → verify() path a live vendor run uses.
     * Touches ONLY orders whose meta carries this integration's ownership markers.
     */
    public function backfillDisplay(): array
    {
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $this->prefix)
            ->whereNull('deleted_at')
            ->orderBy('internal_id')
            ->get();
        $rows = [];
        foreach ($orders as $order) {
            $meta = metaArray($order->meta);
            $payload = $order->payload_uuid
                ? Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first()
                : null;
            if (!$payload) {
                throw new RuntimeException('backfill_payload_missing');
            }
            $payloadMeta = metaArray($payload->meta);
            $customer = $order->customer_uuid
                ? Contact::withoutGlobalScopes()->where('uuid', $order->customer_uuid)->first()
                : null;
            if (!$customer) {
                throw new RuntimeException('backfill_customer_missing');
            }
            $customerMeta = metaArray($customer->meta);
            $rows[] = validateRow([
                'order_id' => $meta['source_order_id'] ?? null,
                'order_number' => $meta['source_order_number'] ?? null,
                'status' => $meta['source_status'] ?? null,
                'area_en' => $meta['area_en'] ?? null,
                'area_ar' => $meta['area_ar'] ?? null,
                'location_pin' => $payloadMeta['source_location_pin'] ?? null,
                'customer_ref' => $customerMeta['source_customer_ref'] ?? null,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'address_text' => $payloadMeta['address_text'] ?? null,
                'created_at' => $meta['source_created_at'] ?? null,
                'updated_at' => $meta['source_updated_at'] ?? null,
            ]);
        }
        $stats = $this->upsert($rows, $rows);
        return ['orders_scanned' => count($rows)] + $stats;
    }

    private function verify(array $deduplicated, array $cancelStateBefore): array
    {
        $eligible = array_values(array_filter($deduplicated, fn (array $row): bool => in_array($row['status'], ['success', 'pending'], true)));
        $canceled = array_values(array_filter($deduplicated, fn (array $row): bool => $row['status'] === 'cancel'));
        $expectedCustomers = count(array_unique(array_column($eligible, 'customer_ref')));
        // Every eligible order gets a dropoff Place (vendor pin or flagged area fallback).
        $expectedPlaces = count($eligible);
        $expectedOrderIds = array_map(fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'], $eligible);
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->whereIn('internal_id', $expectedOrderIds)
            ->get()
            ->keyBy('internal_id');
        if ($orders->count() !== count($eligible)) {
            throw new RuntimeException('verify_order_count');
        }
        $latestCustomerRows = latestCustomerRows($eligible);
        $districtCaseNormalizations = 0;
        $verifiedPlaceUuids = [];
        foreach ($eligible as $row) {
            $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
            $order = $orders->get($internalId);
            if (!$order) {
                throw new RuntimeException('verify_order_missing');
            }
            if ($order->tracking_number_uuid === null) {
                throw new RuntimeException('verify_tracking_number_missing');
            }
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $order->tracking_number_uuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
            if (!$trackingNumber
                || $trackingNumber->company_uuid !== $this->companyUuid
                || $trackingNumber->owner_uuid !== $order->uuid) {
                throw new RuntimeException('verify_tracking_number_owner');
            }
            if (!DB::table('tracking_statuses')
                ->where('tracking_number_uuid', $trackingNumber->uuid)
                ->whereNull('deleted_at')
                ->where('code', 'CREATED')
                ->exists()) {
                throw new RuntimeException('verify_tracking_status_missing');
            }
            $meta = metaArray($order->meta);
            if (($meta['source_order_id'] ?? null) !== $row['order_id']
                || ($meta['source_order_number'] ?? null) !== $row['order_number']
                || ($meta['source_status'] ?? null) !== $row['status']
                || ($meta['source_created_at'] ?? null) !== $row['created_at']
                || ($meta['source_updated_at'] ?? null) !== $row['updated_at']
                || ($meta['routing_area'] ?? null) !== $row['routing_area']
                || ($meta['area_ar'] ?? null) !== $row['area_ar']) {
                throw new RuntimeException('verify_order_mapping');
            }
            $customer = Contact::withoutGlobalScopes()->where('uuid', $order->customer_uuid)->first();
            $expectedCustomer = $latestCustomerRows[$row['customer_ref']];
            if (!$customer || $customer->name !== $expectedCustomer['customer_name'] || $customer->phone !== $expectedCustomer['customer_phone']) {
                throw new RuntimeException('verify_customer_mapping');
            }
            $customerMeta = metaArray($customer->meta);
            if (($customerMeta['source_customer_ref'] ?? null) !== $row['customer_ref']) {
                throw new RuntimeException('verify_customer_ref');
            }
            $payload = Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first();
            if (!$payload) {
                throw new RuntimeException('verify_payload_missing');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['routing_area'] ?? null) !== $row['routing_area']
                || ($payloadMeta['area_en'] ?? null) !== $row['area_en']
                || ($payloadMeta['area_ar'] ?? null) !== $row['area_ar']
                || ($payloadMeta['address_text'] ?? null) !== $row['address_text']) {
                throw new RuntimeException('verify_payload_mapping');
            }
            // The original vendor pin (or its absence) must be preserved verbatim.
            if (!array_key_exists('source_location_pin', $payloadMeta)
                || $payloadMeta['source_location_pin'] !== $row['location_pin']) {
                throw new RuntimeException('verify_source_pin_not_preserved');
            }
            $expectedPin = resolveEffectivePin($row);
            $place = Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first();
            if (!$place || !$place->location instanceof Point) {
                throw new RuntimeException('verify_place_missing');
            }
            $placeMeta = metaArray($place->meta);
            if (($placeMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                || ($payloadMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                || (metaArray($order->meta)['pin_source'] ?? null) !== $expectedPin['pin_source']) {
                throw new RuntimeException('verify_pin_source');
            }
            if ($row['pin'] === null && ($placeMeta['fallback_scope'] ?? null) !== $expectedPin['fallback_scope']) {
                throw new RuntimeException('verify_fallback_scope');
            }
            if (abs($place->location->getLat() - $expectedPin['lat']) > 0.000001) {
                throw new RuntimeException('verify_place_latitude');
            }
            if (abs($place->location->getLng() - $expectedPin['lng']) > 0.000001) {
                throw new RuntimeException('verify_place_longitude');
            }
            if ($place->district !== $row['routing_area']) {
                if ($place->district === null || $place->district === '') {
                    throw new RuntimeException('verify_place_district_null');
                }
                if (trim((string) $place->district) === $row['routing_area']) {
                    throw new RuntimeException('verify_place_district_whitespace');
                }
                if (mb_strtolower((string) $place->district) === mb_strtolower($row['routing_area'])) {
                    $districtCaseNormalizations++;
                } else {
                    throw new RuntimeException('verify_place_district_different');
                }
            }
            if ($place->street1 !== $row['address_text']) {
                throw new RuntimeException('verify_place_address');
            }
            if ($place->street2 !== addressCallInstruction($row, $this->allowAddressCall)
                || $place->phone !== $row['customer_phone']
                || $place->name !== sourcePlaceName($row, $this->allowAddressCall)
                || $order->notes !== sourceOrderNotes($row, $this->allowAddressCall)) {
                throw new RuntimeException('verify_address_call_display');
            }
            $verifiedPlaceUuids[$place->uuid] = true;
        }
        foreach ($canceled as $row) {
            $key = $this->prefix . '-ORDER-' . $row['order_id'];
            $existsAfter = Order::withoutGlobalScopes()->where('company_uuid', $this->companyUuid)->where('internal_id', $key)->exists();
            if ($existsAfter !== ($cancelStateBefore[$key] ?? false)) {
                throw new RuntimeException('verify_cancel_changed');
            }
        }
        $expectedCustomerIds = array_values(array_unique(array_map(
            fn (array $row): string => $this->prefix . '-CUSTOMER-' . $row['customer_ref'],
            $eligible
        )));
        $customerCount = Contact::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->whereIn('internal_id', $expectedCustomerIds)
            ->count();
        if ($customerCount !== $expectedCustomers) {
            throw new RuntimeException('verify_customer_count');
        }
        $placeCount = count($verifiedPlaceUuids);
        if ($placeCount !== $expectedPlaces) {
            throw new RuntimeException('verify_place_count');
        }
        $nullPinCount = count(array_filter($eligible, fn (array $row): bool => $row['pin'] === null));
        return [
            'passed' => true,
            'orders' => count($eligible),
            'cancels_skipped' => count($canceled),
            'customers' => $customerCount,
            'null_pin_orders' => $nullPinCount,
            'non_null_pin_orders' => count($eligible) - $nullPinCount,
            'area_fallback_places' => $nullPinCount,
            'places' => $placeCount,
            'orders_with_tracking' => count($eligible),
            'district_case_normalizations' => $districtCaseNormalizations,
        ];
    }

    public static function cleanup(string $prefix, string $statePath): array
    {
        if (!str_starts_with($prefix, 'TEST-FB-NUTREEZE')) {
            throw new RuntimeException('cleanup_prefix_guard');
        }
        $companyUuid = resolveCompanyUuid();
        $counts = DB::transaction(function () use ($prefix, $companyUuid): array {
            $orders = DB::table('orders')
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-ORDER-%')
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'payload_uuid']);
            $payloads = $orders->pluck('payload_uuid')->filter()->unique()->values()->all();
            $ownedPayloads = $payloads === [] ? collect() : DB::table('payloads')
                ->where('company_uuid', $companyUuid)
                ->whereIn('uuid', $payloads)
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'dropoff_uuid']);
            if ($ownedPayloads->count() !== count($payloads)) {
                throw new RuntimeException('cleanup_foreign_payload');
            }
            $payloads = $ownedPayloads->pluck('uuid')->all();
            if ($payloads !== [] && DB::table('orders')->whereIn('payload_uuid', $payloads)->whereNotIn('uuid', $orders->pluck('uuid')->all())->exists()) {
                throw new RuntimeException('cleanup_shared_payload');
            }
            $places = $ownedPayloads->pluck('dropoff_uuid')->filter()->unique()->values()->all();
            $ownedPlaceCount = $places === [] ? 0 : DB::table('places')
                ->where('company_uuid', $companyUuid)
                ->whereIn('uuid', $places)
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->count();
            if ($ownedPlaceCount !== count($places)) {
                throw new RuntimeException('cleanup_foreign_place');
            }
            foreach ($ownedPayloads as $ownedPayload) {
                if ($ownedPayload->dropoff_uuid
                    && placeHasForeignReference($ownedPayload->dropoff_uuid, $ownedPayload->uuid)) {
                    throw new RuntimeException('cleanup_shared_place');
                }
            }
            $contacts = DB::table('contacts')
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-CUSTOMER-%')
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'user_uuid', 'place_uuid', 'photo_uuid']);
            if ($contacts->isNotEmpty()
                && DB::table('orders')->whereIn('customer_uuid', $contacts->pluck('uuid')->all())->whereNotIn('uuid', $orders->pluck('uuid')->all())->exists()) {
                throw new RuntimeException('cleanup_shared_customer');
            }
            $contactUuids = $contacts->pluck('uuid')->all();
            $contactPlaces = $contactUuids === [] ? collect() : DB::table('places')
                ->whereIn('owner_uuid', $contactUuids)
                ->get(['uuid', 'company_uuid', 'meta']);
            $allowedPlaceUuids = array_fill_keys($places, true);
            foreach ($contactPlaces as $contactPlace) {
                $placeMeta = metaArray($contactPlace->meta ?? null);
                if (!isset($allowedPlaceUuids[$contactPlace->uuid])
                    || ($contactPlace->company_uuid ?? null) !== $companyUuid
                    || ($placeMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                    || ($placeMeta['integration_prefix'] ?? null) !== $prefix) {
                    throw new RuntimeException('cleanup_shared_customer_place');
                }
            }
            foreach ($contacts as $contact) {
                if (!empty($contact->user_uuid) || !empty($contact->place_uuid) || !empty($contact->photo_uuid)) {
                    throw new RuntimeException('cleanup_shared_customer_reference');
                }
            }
            if (hasForbiddenContactReference($contactUuids)
                || hasForeignOperationalContactReference($contactUuids, $companyUuid, $prefix, $payloads)) {
                throw new RuntimeException('cleanup_shared_customer_reference');
            }
            $orderCount = $orders->count();
            if ($payloads !== []) {
                DB::table('payloads')->whereIn('uuid', $payloads)->update([
                    'pickup_uuid' => null,
                    'dropoff_uuid' => null,
                    'return_uuid' => null,
                    'current_waypoint_uuid' => null,
                ]);
            }
            if ($payloads !== []) {
                DB::table('entities')->whereIn('payload_uuid', $payloads)->delete();
                DB::table('waypoints')->whereIn('payload_uuid', $payloads)->delete();
            }
            // Tracking records created for these orders (owner_uuid = order uuid).
            $orderUuids = $orders->pluck('uuid')->all();
            $trackingNumberUuids = $orderUuids === [] ? [] : DB::table('tracking_numbers')
                ->whereIn('owner_uuid', $orderUuids)
                ->pluck('uuid')
                ->all();
            $trackingStatusesDeleted = $trackingNumberUuids === [] ? 0 : DB::table('tracking_statuses')
                ->whereIn('tracking_number_uuid', $trackingNumberUuids)
                ->delete();
            $trackingNumbersDeleted = $trackingNumberUuids === [] ? 0 : DB::table('tracking_numbers')
                ->whereIn('uuid', $trackingNumberUuids)
                ->delete();
            $orderDeleted = $orderCount === 0 ? 0 : DB::table('orders')->whereIn('uuid', $orderUuids)->delete();
            $payloadDeleted = $payloads === [] ? 0 : DB::table('payloads')->whereIn('uuid', $payloads)->delete();
            $placeCount = $places === [] ? 0 : DB::table('places')->whereIn('uuid', $places)->delete();
            $customerDeleted = $contacts->isEmpty() ? 0 : DB::table('contacts')->whereIn('uuid', $contacts->pluck('uuid')->all())->delete();
            return [
                'orders_found' => $orderCount,
                'orders_deleted' => $orderDeleted,
                'customers_deleted' => $customerDeleted,
                'payloads_deleted' => $payloadDeleted,
                'places_deleted' => $placeCount,
                'tracking_numbers_deleted' => $trackingNumbersDeleted,
                'tracking_statuses_deleted' => $trackingStatusesDeleted,
            ];
        }, 1);
        (new WatermarkStore($statePath))->remove();
        return $counts;
    }
}

/**
 * Add the daily dispatch contract to the integration-owned orders created by
 * FleetbaseWriter. Both writers run inside one outer transaction, and this
 * dispatch phase remains independently idempotent for safe retries. It never
 * rewrites an order after operations has moved it beyond the governed
 * created/dispatched/canceled states.
 */
final class DailyDispatchWriter
{
    private string $companyUuid;
    private ?array $verificationResult = null;
    private array $touchedSubjectIds = ['order' => [], 'payload' => [], 'place' => []];
    private array $stats = [
        'pickup_places_created' => 0,
        'pickup_places_updated' => 0,
        'pickup_places_unchanged' => 0,
        'orders_dispatched' => 0,
        'orders_dispatched_real_pin' => 0,
        'orders_dispatched_call_required' => 0,
        'orders_held_no_pin' => 0,
        'orders_held_invalid_pin' => 0,
        'orders_held_unapproved_order_status' => 0,
        'orders_held_unapproved_status' => 0,
        'orders_held_source_canceled' => 0,
        'orders_held_source_missing' => 0,
        'orders_held_no_partner_driver' => 0,
        'orders_held_unmapped_partner_driver' => 0,
        'orders_unchanged' => 0,
        'payloads_updated' => 0,
        'payloads_unchanged' => 0,
        'tracking_statuses_created' => 0,
        'tracking_statuses_unchanged' => 0,
        'tracking_hold_statuses_created' => 0,
        'tracking_hold_statuses_unchanged' => 0,
        'tracking_cancel_statuses_created' => 0,
        'tracking_cancel_statuses_unchanged' => 0,
        'address_call_artifacts_cleared' => 0,
        'orders_withdrawn_canceled' => 0,
        'orders_withdrawn_on_hold' => 0,
        'orders_withdraw_blocked_started' => 0,
        'orders_withdraw_unchanged' => 0,
        'orders_deliverable_untouched' => 0,
        'orders_source_missing_ignored' => 0,
        'orders_other_change_ignored' => 0,
    ];

    public function __construct(
        private string $prefix,
        private array $pickup,
        private array $drivers,
        private bool $allowAddressCall = false,
    ) {
        $this->companyUuid = resolveCompanyUuid();
        if ($this->drivers === []) {
            throw new RuntimeException('driver_roster_empty');
        }
    }

    public function apply(array $dailyRows, bool $verify = true): array
    {
        if ($dailyRows === []) {
            throw new RuntimeException('daily_source_empty');
        }
        $allocation = allocateDailyDrivers($dailyRows, $this->drivers, $this->allowAddressCall);
        $expectedAssigned = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowIsDailyRoutable($row, $this->allowAddressCall),
        ));
        if (count($allocation['assignments']) !== $expectedAssigned
            || array_sum($allocation['loads']) !== $expectedAssigned) {
            throw new RuntimeException('daily_allocation_reconciliation');
        }
        $activityIdBefore = (int) (DB::table('activity')->max('id') ?? 0);

        DB::transaction(function () use ($dailyRows, $allocation, $verify, $activityIdBefore): void {
            $pickup = $this->upsertPickup();
            $this->neutralizeMissingSourceOrders($dailyRows);
            foreach ($dailyRows as $row) {
                $this->applyOne($row, $allocation['assignments'], $pickup);
            }
            if ($verify) {
                $this->verificationResult = $this->verify($dailyRows, $allocation, $pickup);
            }
            $newTouchedActivity = DB::table('activity')
                ->where('id', '>', $activityIdBefore)
                ->where(function ($query) {
                    $query->where(function ($orderQuery) {
                        $orderQuery->where('subject_type', Order::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['order'])));
                    })->orWhere(function ($payloadQuery) {
                        $payloadQuery->where('subject_type', Payload::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['payload'])));
                    })->orWhere(function ($placeQuery) {
                        $placeQuery->where('subject_type', Place::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['place'])));
                    });
                })
                ->count();
            $this->stats['activity_rows_created'] = $newTouchedActivity;
            if ($newTouchedActivity !== 0) {
                throw new RuntimeException('fleetbase_activity_log_write');
            }
        }, 1);

        $loads = array_values($allocation['loads']);
        $this->stats['drivers_configured'] = count($loads);
        $this->stats['drivers_used'] = count(array_filter($loads, fn (int $load): bool => $load > 0));
        $this->stats['driver_load_min'] = min($loads);
        $this->stats['driver_load_max'] = max($loads);
        return $this->stats;
    }

    public function verificationResult(): ?array
    {
        return $this->verificationResult;
    }

    private function scheduledAtUtc(string $deliveryDate): string
    {
        $local = new DateTimeImmutable(
            validateDeliveryDate($deliveryDate) . ' ' . $this->pickup['dispatch_time'] . ':00',
            new DateTimeZone('Asia/Kuwait'),
        );
        return $local->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function upsertPickup(): Place
    {
        $integrationKey = $this->prefix . '-PICKUP';
        $query = Place::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('meta->integration_key', $integrationKey);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('daily_duplicate_pickup');
        }
        $place = $query->lockForUpdate()->first();
        $created = $place === null;
        $place ??= new Place();
        $meta = metaArray($place->meta);
        if (!$created) {
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix
                || ($place->company_uuid ?? null) !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_pickup');
            }
            if ($place->deleted_at === null
                && $place->owner_uuid === null
                && $place->owner_type === null
                && $place->name === $this->pickup['name']
                && $place->street1 === $this->pickup['street1']
                && $place->city === $this->pickup['city']
                && $place->district === $this->pickup['city']
                && $place->country === $this->pickup['country']
                && $place->location instanceof Point
                && abs($place->location->getLat() - $this->pickup['lat']) <= 0.000001
                && abs($place->location->getLng() - $this->pickup['lng']) <= 0.000001
                && ($meta['integration_key'] ?? null) === $integrationKey
                && ($meta['daily_mapping_version'] ?? null) === DAILY_MAPPING_VERSION
                && ($meta['coordinate_source'] ?? null) === $this->pickup['coordinate_source']
                && ($meta['shared_pickup'] ?? null) === true) {
                $this->stats['pickup_places_unchanged']++;
                return $place;
            }
        }
        $place->fill([
            'company_uuid' => $this->companyUuid,
            'owner_uuid' => null,
            'owner_type' => null,
            'name' => $this->pickup['name'],
            'street1' => $this->pickup['street1'],
            'city' => $this->pickup['city'],
            'district' => $this->pickup['city'],
            'country' => $this->pickup['country'],
        ]);
        if (!($place->location instanceof Point)
            || abs($place->location->getLat() - $this->pickup['lat']) > 0.000001
            || abs($place->location->getLng() - $this->pickup['lng']) > 0.000001) {
            $place->setAttribute('location', new Point($this->pickup['lat'], $this->pickup['lng']));
        }
        applyMetaUpdates($place, [
            'integration_owner' => 'nutreeze_partner_orders',
            'integration_prefix' => $this->prefix,
            'integration_key' => $integrationKey,
            'daily_mapping_version' => DAILY_MAPPING_VERSION,
            'coordinate_source' => $this->pickup['coordinate_source'],
            'shared_pickup' => true,
        ]);
        $place->setAttribute('deleted_at', null);
        $changed = saveWithoutActivity($place);
        $this->touchedSubjectIds['place'][] = $place->getKey();
        $this->stats[$created
            ? 'pickup_places_created'
            : ($changed ? 'pickup_places_updated' : 'pickup_places_unchanged')]++;
        return $place;
    }

    /**
     * A delivery that was present in an earlier complete snapshot but is absent
     * from the current two-pass manifest is retained as an auditable tombstone.
     * Unstarted jobs are canceled, unscheduled, and unassigned in this same
     * transaction; an advanced job fails closed for operator intervention.
     */
    /**
     * WP-OPS-07 (A50) daytime cancel-only reconciliation. Never creates, reassigns, re-pins or
     * tombstones; it only withdraws orders whose Partner row is now cancelled or on hold, and
     * leaves started jobs untouched (reported for the operator). Everything else in the day is
     * left exactly as the last full sync wrote it.
     */
    public function withdrawOnly(array $dailyRows): array
    {
        if ($dailyRows === []) {
            throw new RuntimeException('daily_source_empty');
        }
        $byInternalId = [];
        foreach ($dailyRows as $row) {
            $byInternalId[$this->prefix . '-ORDER-' . $row['order_id']] = $row;
        }
        $activityIdBefore = (int) (DB::table('activity')->max('id') ?? 0);
        $withdrawn = [];
        $blockedStarted = [];

        DB::transaction(function () use ($byInternalId, &$withdrawn, &$blockedStarted, $activityIdBefore): void {
            $orders = Order::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->get();
            foreach ($orders as $order) {
                $meta = metaArray($order->meta);
                if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                    || ($meta['integration_prefix'] ?? null) !== $this->prefix) {
                    throw new RuntimeException('daily_foreign_order');
                }
                if (($meta['daily_source_selector'] ?? null) !== DAILY_SOURCE_SELECTOR) {
                    throw new RuntimeException('daily_source_selector_mismatch');
                }
                $row = $byInternalId[(string) $order->internal_id] ?? null;
                if ($row === null) {
                    // A row that vanished during the day is NOT treated as a cancellation here:
                    // a partial or glitched feed must never withdraw live jobs. The next full
                    // sync tombstones it under its own guards.
                    $this->stats['orders_source_missing_ignored']++;
                    continue;
                }
                $holdReason = dailyWithdrawalReason($row);
                if ($holdReason === null) {
                    $this->stats[dailyStatusHoldReason($row) === null
                        ? 'orders_deliverable_untouched'
                        : 'orders_other_change_ignored']++;
                    continue;
                }
                $started = (bool) $order->started || $order->started_at !== null;
                if ($started) {
                    $blockedStarted[] = (string) $order->internal_id;
                    $this->stats['orders_withdraw_blocked_started']++;
                    continue;
                }
                $targetStatus = dailyHeldOrderStatus($holdReason);
                if ((string) $order->status === $targetStatus
                    && !(bool) $order->dispatched
                    && $order->driver_assigned_uuid === null
                    && ($meta['hold_reason'] ?? null) === $holdReason) {
                    $this->ensureHeldTracking($order, $holdReason);
                    $this->stats['orders_withdraw_unchanged']++;
                    continue;
                }
                if (!in_array((string) $order->status, ['created', 'dispatched', 'canceled'], true)) {
                    throw new RuntimeException('daily_operational_state_guard');
                }
                $wasCallRequired = ($meta['call_customer_required'] ?? false) === true;
                $order->fill([
                    'driver_assigned_uuid' => null,
                    'scheduled_at' => null,
                    'status' => $targetStatus,
                    'dispatched' => false,
                    'dispatched_at' => null,
                    'notes' => str_replace(' | ' . ADDRESS_CALL_INSTRUCTION, '', (string) $order->notes),
                ]);
                applyMetaUpdates($order, [
                    'assignment_mode' => 'none',
                    'dispatch_state' => 'held_' . $holdReason,
                    'hold_reason' => $holdReason,
                    'partner_driver_public_id' => null,
                    'meal_status' => $row['meal_status'],
                    'meal_updated_at' => $row['meal_updated_at'],
                    'source_order_status' => $row['source_order_status'],
                    'daily_source_hash' => $row['_source_hash'],
                    'daily_meal_hash' => dailyMealHash($row),
                    'source_location_exception' => null,
                    'call_customer_required' => false,
                    'navigation_mode' => 'held',
                    'location_accuracy' => 'not_routable',
                    'address_call_authorization' => null,
                    'daytime_withdrawn_at' => kuwaitNow(),
                    'daytime_withdrawal_mode' => 'cancel_only_v1',
                ]);
                saveWithoutActivity($order);
                $this->touchedSubjectIds['order'][] = $order->getKey();

                $payload = Payload::withoutGlobalScopes()
                    ->where('company_uuid', $this->companyUuid)
                    ->where('uuid', $order->payload_uuid)
                    ->lockForUpdate()
                    ->first();
                if (!$payload) {
                    throw new RuntimeException('daily_payload_resolution');
                }
                $payloadMeta = metaArray($payload->meta);
                if (($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                    || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix) {
                    throw new RuntimeException('daily_foreign_payload');
                }
                applyMetaUpdates($payload, [
                    'meal_status' => $row['meal_status'],
                    'source_order_status' => $row['source_order_status'],
                    'daily_source_hash' => $row['_source_hash'],
                    'source_location_exception' => null,
                    'call_customer_required' => false,
                    'navigation_mode' => 'held',
                    'location_accuracy' => 'not_routable',
                    'address_call_authorization' => null,
                ]);
                saveWithoutActivity($payload);
                $this->touchedSubjectIds['payload'][] = $payload->getKey();

                if ($wasCallRequired) {
                    $place = Place::withoutGlobalScopes()
                        ->where('company_uuid', $this->companyUuid)
                        ->where('uuid', $payload->dropoff_uuid)
                        ->lockForUpdate()
                        ->first();
                    if (!$place) {
                        throw new RuntimeException('daily_verify_dropoff');
                    }
                    $placeName = (string) $place->name;
                    if (str_starts_with($placeName, ADDRESS_CALL_PLACE_PREFIX)) {
                        $placeName = substr($placeName, strlen(ADDRESS_CALL_PLACE_PREFIX));
                    }
                    $place->fill(['name' => $placeName, 'street2' => null]);
                    saveWithoutActivity($place);
                    $this->touchedSubjectIds['place'][] = $place->getKey();
                    $this->stats['address_call_artifacts_cleared']++;
                }
                $this->ensureHeldTracking($order, $holdReason);
                $this->stats[$holdReason === 'source_order_canceled'
                    ? 'orders_withdrawn_canceled'
                    : 'orders_withdrawn_on_hold']++;
                $withdrawn[] = ['internal_id' => (string) $order->internal_id, 'hold_reason' => $holdReason];
            }

            // Post-write verification inside the transaction: every withdrawn order must be
            // driverless, undispatched and in its held/canceled state.
            foreach ($withdrawn as $item) {
                $check = Order::withoutGlobalScopes()
                    ->where('company_uuid', $this->companyUuid)
                    ->where('internal_id', $item['internal_id'])
                    ->first(['status', 'dispatched', 'driver_assigned_uuid', 'meta']);
                $checkMeta = metaArray($check->meta ?? null);
                if (!$check
                    || (string) $check->status !== dailyHeldOrderStatus($item['hold_reason'])
                    || (bool) $check->dispatched
                    || $check->driver_assigned_uuid !== null
                    || ($checkMeta['navigation_mode'] ?? null) !== 'held'
                    || ($checkMeta['dispatch_state'] ?? null) !== 'held_' . $item['hold_reason']) {
                    throw new RuntimeException('daily_withdraw_verification');
                }
            }
            $newTouchedActivity = DB::table('activity')
                ->where('id', '>', $activityIdBefore)
                ->where(function ($query) {
                    $query->where(function ($orderQuery) {
                        $orderQuery->where('subject_type', Order::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['order'])));
                    })->orWhere(function ($payloadQuery) {
                        $payloadQuery->where('subject_type', Payload::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['payload'])));
                    });
                })
                ->count();
            $this->stats['activity_rows_created'] = $newTouchedActivity;
            if ($newTouchedActivity !== 0) {
                throw new RuntimeException('fleetbase_activity_log_write');
            }
        }, 1);

        $this->verificationResult = [
            'passed' => true,
            'mode' => 'cancel_only_v1',
            'withdrawn' => count($withdrawn),
            'blocked_started_internal_ids' => $blockedStarted,
        ];
        if ($withdrawn !== []) {
            invalidateDailyCaches($this->prefix, $this->companyUuid);
        }
        return $this->stats;
    }

    private function neutralizeMissingSourceOrders(array $dailyRows): void
    {
        $sourceIds = array_fill_keys(array_map(
            fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'],
            $dailyRows,
        ), true);
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->get();
        foreach ($orders as $order) {
            if (isset($sourceIds[(string) $order->internal_id])) {
                continue;
            }
            $meta = metaArray($order->meta);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_order');
            }
            if ((bool) $order->started || $order->started_at !== null) {
                throw new RuntimeException('daily_started_source_missing');
            }
            if (!in_array((string) $order->status, ['created', 'dispatched', 'canceled'], true)) {
                throw new RuntimeException('daily_missing_source_state_guard');
            }
            $holdReason = 'source_row_missing';
            $wasCallRequired = ($meta['call_customer_required'] ?? false) === true;
            $order->fill([
                'driver_assigned_uuid' => null,
                'scheduled_at' => null,
                'status' => dailyHeldOrderStatus($holdReason),
                'dispatched' => false,
                'dispatched_at' => null,
                'notes' => str_replace(
                    ' | ' . ADDRESS_CALL_INSTRUCTION,
                    '',
                    (string) $order->notes,
                ),
            ]);
            applyMetaUpdates($order, [
                'assignment_mode' => 'none',
                'dispatch_state' => 'held_' . $holdReason,
                'hold_reason' => $holdReason,
                'source_location_exception' => null,
                'call_customer_required' => false,
                'navigation_mode' => 'held',
                'location_accuracy' => 'not_routable',
                'address_call_authorization' => null,
                'source_missing_detected_at' => $meta['source_missing_detected_at'] ?? kuwaitNow(),
            ]);
            $changed = saveWithoutActivity($order);
            $this->touchedSubjectIds['order'][] = $order->getKey();
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->lockForUpdate()
                ->first();
            if (!$payload) {
                throw new RuntimeException('daily_payload_resolution');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_payload');
            }
            applyMetaUpdates($payload, [
                'source_location_exception' => null,
                'call_customer_required' => false,
                'navigation_mode' => 'held',
                'location_accuracy' => 'not_routable',
                'address_call_authorization' => null,
            ]);
            saveWithoutActivity($payload);
            $this->touchedSubjectIds['payload'][] = $payload->getKey();

            $place = Place::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $payload->dropoff_uuid)
                ->lockForUpdate()
                ->first();
            if (!$place) {
                throw new RuntimeException('daily_verify_dropoff');
            }
            $placeMeta = metaArray($place->meta);
            if (($placeMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($placeMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_place');
            }
            $placeName = (string) $place->name;
            if (str_starts_with($placeName, ADDRESS_CALL_PLACE_PREFIX)) {
                $placeName = substr($placeName, strlen(ADDRESS_CALL_PLACE_PREFIX));
            }
            $place->fill(['name' => $placeName, 'street2' => null]);
            saveWithoutActivity($place);
            $this->touchedSubjectIds['place'][] = $place->getKey();
            if ($wasCallRequired) {
                $this->stats['address_call_artifacts_cleared']++;
            }
            $this->ensureHeldTracking($order, $holdReason);
            $this->stats['orders_held_source_missing']++;
            if (!$changed) {
                $this->stats['orders_unchanged']++;
            }
        }
    }

    private function applyOne(array $row, array $assignments, Place $pickup): void
    {
        $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
        $query = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() !== 1) {
            throw new RuntimeException('daily_order_resolution');
        }
        $order = $query->lockForUpdate()->first();
        if (!$order) {
            throw new RuntimeException('daily_order_resolution');
        }
        $orderMeta = metaArray($order->meta);
        if (($orderMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($orderMeta['integration_prefix'] ?? null) !== $this->prefix
            || ($orderMeta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('daily_foreign_order');
        }
        $sourceHoldReason = dailyHoldReason($row);
        $routable = rowIsDailyRoutable($row, $this->allowAddressCall);
        $callCustomerRequired = rowRequiresCustomerCall($row, $this->allowAddressCall);
        $effectivePin = resolveEffectivePin($row);
        $holdReason = $routable ? null : $sourceHoldReason;
        $allowedStates = ['created', 'dispatched'];
        if ($sourceHoldReason === 'source_order_canceled') {
            $allowedStates[] = 'canceled';
        }
        if (!in_array((string) $order->status, $allowedStates, true)) {
            throw new RuntimeException('daily_operational_state_guard');
        }

        $payload = Payload::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('uuid', $order->payload_uuid)
            ->lockForUpdate()
            ->first();
        if (!$payload) {
            throw new RuntimeException('daily_payload_resolution');
        }
        $payloadMeta = metaArray($payload->meta);
        if (($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix
            || ($payloadMeta['source_order_id'] ?? null) !== $row['order_id']
            || DB::table('orders')->where('payload_uuid', $payload->uuid)->where('uuid', '!=', $order->uuid)->exists()) {
            throw new RuntimeException('daily_foreign_payload');
        }

        $payload->fill(['pickup_uuid' => $pickup->uuid]);
        applyMetaUpdates($payload, [
            'daily_mapping_version' => DAILY_MAPPING_VERSION,
            'daily_source_selector' => $row['source_selector'],
            'source_delivery_ids' => $row['source_delivery_ids'],
            'source_delivery_row_count' => $row['source_delivery_row_count'],
            'delivery_date' => $row['delivery_date'],
            'meal_status' => $row['meal_status'],
            'meal_item_count' => $row['meal_item_count'],
            'meal_qty' => $row['meal_qty'],
            'meal_updated_at' => $row['meal_updated_at'],
            'source_order_status' => $row['source_order_status'],
            'source_customer_ref' => $row['customer_ref'],
            'daily_source_hash' => $row['_source_hash'],
            'daily_meal_hash' => dailyMealHash($row),
            'pickup_coordinate_source' => $this->pickup['coordinate_source'],
            'source_location_exception' => $callCustomerRequired ? $sourceHoldReason : null,
            'call_customer_required' => $callCustomerRequired,
            'navigation_mode' => navigationModeForRow($row, $this->allowAddressCall),
            'location_accuracy' => locationAccuracyForRow($row, $this->allowAddressCall),
            'address_call_authorization' => addressCallAuthorization($row, $this->allowAddressCall),
            'pin_source' => $effectivePin['pin_source'],
            'fallback_source' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                ? $effectivePin['pin_source'] : null,
            'fallback_latitude' => $callCustomerRequired ? $effectivePin['lat'] : null,
            'fallback_longitude' => $callCustomerRequired ? $effectivePin['lng'] : null,
            'location_capture_id' => $row['recovery_capture_id'] ?? null,
        ]);
        $payloadChanged = saveWithoutActivity($payload);
        $this->touchedSubjectIds['payload'][] = $payload->getKey();
        $this->stats[$payloadChanged ? 'payloads_updated' : 'payloads_unchanged']++;

        $assignment = $assignments[(string) $row['order_id']] ?? null;
        // Immediate bridge-owned dispatch is deliberate. Fleetbase's native
        // scheduler completes lifecycle work through a queue whose deployed
        // Redis prefix is currently mismatched; relying on it would leave
        // partially-dispatched orders.
        $shouldDispatch = $routable;
        if ($routable !== ($assignment !== null)) {
            throw new RuntimeException('daily_assignment_pin_guard');
        }
        $scheduledAt = $this->scheduledAtUtc($row['delivery_date']);
        $dispatchState = $shouldDispatch
            ? ($callCustomerRequired ? 'dispatched_call_customer_required' : 'dispatched')
            : 'held_' . $holdReason;
        $expectedDriver = $routable ? $assignment : null;
        if ($order->driver_assigned_uuid !== null
            && $order->driver_assigned_uuid !== $expectedDriver
            && ((string) $order->status === 'dispatched'
                && ((bool) $order->started || $order->started_at !== null))) {
            throw new RuntimeException('daily_existing_driver_conflict');
        }
        if ((string) $order->status === 'dispatched'
            && (!$routable || $order->driver_assigned_uuid !== $expectedDriver)
            && ((bool) $order->started || $order->started_at !== null)) {
            throw new RuntimeException('daily_existing_dispatch_conflict');
        }

        $order->fill([
            'driver_assigned_uuid' => $expectedDriver,
            // A null schedule is a second fail-safe for held rows: Fleetbase's
            // minute scheduler selects undispatched created/pending orders whose
            // scheduled_at is due.
            'scheduled_at' => $routable ? $scheduledAt : null,
            'status' => $shouldDispatch ? 'dispatched' : dailyHeldOrderStatus($holdReason),
            'dispatched' => $shouldDispatch,
            'dispatched_at' => $shouldDispatch
                ? ($order->dispatched_at ?? gmdate('Y-m-d H:i:s'))
                : null,
        ]);
        applyMetaUpdates($order, [
            'daily_mapping_version' => DAILY_MAPPING_VERSION,
            'daily_source_selector' => $row['source_selector'],
            'source_delivery_ids' => $row['source_delivery_ids'],
            'source_delivery_row_count' => $row['source_delivery_row_count'],
            'delivery_date' => $row['delivery_date'],
            'meal_status' => $row['meal_status'],
            'meal_item_count' => $row['meal_item_count'],
            'meal_qty' => $row['meal_qty'],
            'meal_updated_at' => $row['meal_updated_at'],
            'source_order_status' => $row['source_order_status'],
            'source_customer_ref' => $row['customer_ref'],
            'daily_source_hash' => $row['_source_hash'],
            'daily_meal_hash' => dailyMealHash($row),
            'assignment_mode' => $callCustomerRequired
                ? PARTNER_DRIVER_ASSIGNMENT_MODE_CALL_REQUIRED
                : ($routable ? PARTNER_DRIVER_ASSIGNMENT_MODE : 'none'),
            'partner_driver_id' => $row['partner_driver_id'] ?? null,
            'partner_driver_name' => $row['partner_driver_name'] ?? null,
            'partner_driver_public_id' => $routable ? ($row['partner_driver_public_id'] ?? null) : null,
            'dispatch_state' => $dispatchState,
            'hold_reason' => $holdReason,
            'source_location_exception' => $callCustomerRequired ? $sourceHoldReason : null,
            'call_customer_required' => $callCustomerRequired,
            'navigation_mode' => navigationModeForRow($row, $this->allowAddressCall),
            'location_accuracy' => locationAccuracyForRow($row, $this->allowAddressCall),
            'address_call_authorization' => addressCallAuthorization($row, $this->allowAddressCall),
            'pin_source' => $effectivePin['pin_source'],
            'fallback_source' => in_array($effectivePin['pin_source'], ['known_stop_anchor', 'area_fallback'], true)
                ? $effectivePin['pin_source'] : null,
            'fallback_latitude' => $callCustomerRequired ? $effectivePin['lat'] : null,
            'fallback_longitude' => $callCustomerRequired ? $effectivePin['lng'] : null,
            'location_capture_id' => $row['recovery_capture_id'] ?? null,
            'dispatch_time_local' => $this->pickup['dispatch_time'],
            'dispatch_timezone' => 'Asia/Kuwait',
            'pickup_coordinate_source' => $this->pickup['coordinate_source'],
        ]);
        $orderChanged = saveWithoutActivity($order);
        $this->touchedSubjectIds['order'][] = $order->getKey();
        if ($shouldDispatch) {
            $this->ensureDispatchedTracking($order);
            $this->stats['orders_dispatched']++;
            $this->stats[$callCustomerRequired
                ? 'orders_dispatched_call_required'
                : 'orders_dispatched_real_pin']++;
        } else {
            $this->ensureHeldTracking($order, $holdReason);
            $holdStat = match ($holdReason) {
                'no_real_location_pin' => 'orders_held_no_pin',
                'invalid_source_location_pin' => 'orders_held_invalid_pin',
                'source_order_canceled' => 'orders_held_source_canceled',
                'unapproved_order_status' => 'orders_held_unapproved_order_status',
                'no_partner_driver' => 'orders_held_no_partner_driver',
                'unmapped_partner_driver' => 'orders_held_unmapped_partner_driver',
                default => 'orders_held_unapproved_status',
            };
            $this->stats[$holdStat]++;
        }
        if (!$orderChanged) {
            $this->stats['orders_unchanged']++;
        }
    }

    private function ensureDispatchedTracking(Order $order): void
    {
        if ($order->tracking_number_uuid === null) {
            throw new RuntimeException('daily_tracking_number_missing');
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            throw new RuntimeException('daily_tracking_number_owner');
        }
        $statuses = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->where('code', 'DISPATCHED')
            ->get(['uuid', 'company_uuid']);
        if ($statuses->count() > 1) {
            throw new RuntimeException('daily_duplicate_dispatch_status');
        }
        $statusUuid = $statuses->first()->uuid ?? null;
        if ($statusUuid !== null) {
            if ($statuses->first()->company_uuid !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_dispatch_status');
            }
            $this->stats['tracking_statuses_unchanged']++;
        } else {
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumber->uuid,
                'status' => 'Order Dispatched',
                'details' => 'Order has been dispatched.',
                'code' => 'DISPATCHED',
                'complete' => 0,
                // Native dispatch starts tracking at the assigned driver or
                // pickup—not at the customer's destination. The bridge has no
                // trustworthy live driver coordinate, so use the configured
                // kitchen pickup.
                'location' => FleetOpsUtils::parsePointToWkt(new Point(
                    $this->pickup['lat'],
                    $this->pickup['lng'],
                )),
                'created_at' => gmdate('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) !== $statusUuid) {
            DB::table('tracking_numbers')
                ->where('uuid', $trackingNumber->uuid)
                ->update(['status_uuid' => $statusUuid, 'updated_at' => gmdate('Y-m-d H:i:s')]);
        }
    }

    private function ensureHeldTracking(Order $order, ?string $holdReason): void
    {
        if ($order->tracking_number_uuid === null) {
            throw new RuntimeException('daily_tracking_number_missing');
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            throw new RuntimeException('daily_tracking_number_owner');
        }
        $trackingCode = dailyHeldTrackingCode($holdReason);
        $statuses = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->where('code', $trackingCode)
            ->get(['uuid', 'company_uuid']);
        if ($statuses->count() > 1) {
            throw new RuntimeException('daily_duplicate_hold_status');
        }
        $statusUuid = $statuses->first()->uuid ?? null;
        if ($statusUuid !== null) {
            if ($statuses->first()->company_uuid !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_hold_status');
            }
            $this->stats[$trackingCode === 'CANCELED'
                ? 'tracking_cancel_statuses_unchanged'
                : 'tracking_hold_statuses_unchanged']++;
        } else {
            $isCanceled = $trackingCode === 'CANCELED';
            $details = match ($holdReason) {
                'source_order_canceled' => 'Order canceled by the Partner source.',
                'source_row_missing' => 'Order canceled because the source delivery is no longer present.',
                'unapproved_order_status' => 'Order held because the source order status is not approved for dispatch.',
                'unapproved_meal_status' => 'Order held because the source meal status is not approved for dispatch.',
                'invalid_source_location_pin' => 'Order held because the source location is invalid.',
                default => 'Order held because a real source location is unavailable.',
            };
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumber->uuid,
                'status' => $isCanceled ? 'Order Canceled' : 'Order On Hold',
                'details' => $details,
                'code' => $trackingCode,
                'complete' => $isCanceled ? 1 : 0,
                'location' => FleetOpsUtils::parsePointToWkt(new Point(
                    $this->pickup['lat'],
                    $this->pickup['lng'],
                )),
                'created_at' => gmdate('Y-m-d H:i:s'),
            ]);
            $this->stats[$trackingCode === 'CANCELED'
                ? 'tracking_cancel_statuses_created'
                : 'tracking_hold_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) !== $statusUuid) {
            DB::table('tracking_numbers')
                ->where('uuid', $trackingNumber->uuid)
                ->update(['status_uuid' => $statusUuid, 'updated_at' => gmdate('Y-m-d H:i:s')]);
        }
    }

    private function verify(array $dailyRows, array $allocation, Place $pickup): array
    {
        $expectedIds = array_map(
            fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'],
            $dailyRows,
        );
        $prefixOrders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->whereNull('deleted_at')
            ->get();
        $expectedIdLookup = array_fill_keys($expectedIds, true);
        if ($prefixOrders->pluck('internal_id')->unique()->count() !== $prefixOrders->count()
            || array_diff($expectedIds, $prefixOrders->pluck('internal_id')->all()) !== []) {
            throw new RuntimeException('daily_verify_order_reconciliation');
        }
        $missingTombstones = $prefixOrders->filter(
            fn (Order $order): bool => !isset($expectedIdLookup[(string) $order->internal_id]),
        );
        foreach ($missingTombstones as $order) {
            $meta = metaArray($order->meta);
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $order->tracking_number_uuid)
                ->where('company_uuid', $this->companyUuid)
                ->where('owner_uuid', $order->uuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'status_uuid']);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix
                || ($meta['dispatch_state'] ?? null) !== 'held_source_row_missing'
                || ($meta['hold_reason'] ?? null) !== 'source_row_missing'
                || ($meta['call_customer_required'] ?? false) !== false
                || ($meta['address_call_authorization'] ?? null) !== null
                || ($meta['source_location_exception'] ?? null) !== null
                || ($meta['navigation_mode'] ?? null) !== 'held'
                || ($meta['location_accuracy'] ?? null) !== 'not_routable'
                || str_contains((string) $order->notes, ADDRESS_CALL_INSTRUCTION)
                || (string) $order->status !== 'canceled'
                || (bool) $order->dispatched
                || (bool) $order->started
                || $order->started_at !== null
                || $order->driver_assigned_uuid !== null
                || (string) $order->getRawOriginal('scheduled_at') !== ''
                || !$trackingNumber
                || !DB::table('tracking_statuses')
                    ->where('uuid', $trackingNumber->status_uuid)
                    ->where('tracking_number_uuid', $trackingNumber->uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('code', 'CANCELED')
                    ->whereNull('deleted_at')
                    ->exists()) {
                throw new RuntimeException('daily_verify_missing_tombstone');
            }
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->first();
            $payloadMeta = $payload ? metaArray($payload->meta) : [];
            $dropoff = $payload
                ? Place::withoutGlobalScopes()
                    ->where('company_uuid', $this->companyUuid)
                    ->where('uuid', $payload->dropoff_uuid)
                    ->first()
                : null;
            if (!$payload
                || !$dropoff
                || ($payloadMeta['call_customer_required'] ?? false) !== false
                || ($payloadMeta['address_call_authorization'] ?? null) !== null
                || ($payloadMeta['source_location_exception'] ?? null) !== null
                || ($payloadMeta['navigation_mode'] ?? null) !== 'held'
                || ($payloadMeta['location_accuracy'] ?? null) !== 'not_routable'
                || str_starts_with((string) $dropoff->name, ADDRESS_CALL_PLACE_PREFIX)
                || $dropoff->street2 === ADDRESS_CALL_INSTRUCTION) {
                throw new RuntimeException('daily_verify_missing_tombstone_policy');
            }
        }
        $orders = $prefixOrders->keyBy('internal_id');
        $pickupMeta = metaArray($pickup->meta);
        if (($pickupMeta['integration_key'] ?? null) !== $this->prefix . '-PICKUP'
            || !$pickup->location instanceof Point
            || abs($pickup->location->getLat() - $this->pickup['lat']) > 0.000001
            || abs($pickup->location->getLng() - $this->pickup['lng']) > 0.000001) {
            throw new RuntimeException('daily_verify_pickup');
        }
        $expectedDriverUuids = array_fill_keys(array_column($this->drivers, 'uuid'), true);
        $actualLoads = array_fill_keys(array_column($this->drivers, 'uuid'), 0);
        $assigned = 0;
        $assignedRealPin = 0;
        $assignedCallRequired = 0;
        $held = 0;
        foreach ($dailyRows as $row) {
            $order = $orders->get($this->prefix . '-ORDER-' . $row['order_id']);
            if (!$order) {
                throw new RuntimeException('daily_verify_order_missing');
            }
            $meta = metaArray($order->meta);
            $scheduledRaw = (string) $order->getRawOriginal('scheduled_at');
            $expectedRoutable = rowIsDailyRoutable($row, $this->allowAddressCall);
            $expectedCallRequired = rowRequiresCustomerCall($row, $this->allowAddressCall);
            $expectedNavigationMode = navigationModeForRow($row, $this->allowAddressCall);
            $expectedLocationAccuracy = locationAccuracyForRow($row, $this->allowAddressCall);
            if (($meta['daily_mapping_version'] ?? null) !== DAILY_MAPPING_VERSION
                || ($meta['daily_source_selector'] ?? null) !== $row['source_selector']
                || ($meta['source_delivery_ids'] ?? null) !== $row['source_delivery_ids']
                || ($meta['source_delivery_row_count'] ?? null) !== $row['source_delivery_row_count']
                || ($meta['delivery_date'] ?? null) !== $row['delivery_date']
                || ($meta['meal_status'] ?? null) !== $row['meal_status']
                || ($meta['meal_item_count'] ?? null) !== $row['meal_item_count']
                || ($meta['meal_qty'] ?? null) !== $row['meal_qty']
                || ($meta['source_order_status'] ?? null) !== $row['source_order_status']
                || ($meta['source_customer_ref'] ?? null) !== $row['customer_ref']
                || ($meta['daily_source_hash'] ?? null) !== $row['_source_hash']
                || ($meta['daily_meal_hash'] ?? null) !== dailyMealHash($row)
                || ($meta['call_customer_required'] ?? null) !== $expectedCallRequired
                || ($meta['navigation_mode'] ?? null) !== $expectedNavigationMode
                || ($meta['location_accuracy'] ?? null) !== $expectedLocationAccuracy
                || ($meta['source_location_exception'] ?? null) !== (
                    $expectedCallRequired ? dailyHoldReason($row) : null
                )
                || ($meta['address_call_authorization'] ?? null) !== addressCallAuthorization(
                    $row, $this->allowAddressCall
                )) {
                throw new RuntimeException('daily_verify_order_mapping');
            }
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->first();
            if (!$payload
                || $payload->pickup_uuid !== $pickup->uuid
                || $payload->dropoff_uuid === null) {
                throw new RuntimeException('daily_verify_payload');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['delivery_date'] ?? null) !== $row['delivery_date']
                || ($payloadMeta['daily_source_selector'] ?? null) !== $row['source_selector']
                || ($payloadMeta['source_delivery_ids'] ?? null) !== $row['source_delivery_ids']
                || ($payloadMeta['source_delivery_row_count'] ?? null) !== $row['source_delivery_row_count']
                || ($payloadMeta['meal_qty'] ?? null) !== $row['meal_qty']
                || ($payloadMeta['source_order_status'] ?? null) !== $row['source_order_status']
                || ($payloadMeta['source_customer_ref'] ?? null) !== $row['customer_ref']
                || ($payloadMeta['daily_source_hash'] ?? null) !== $row['_source_hash']
                || ($payloadMeta['daily_meal_hash'] ?? null) !== dailyMealHash($row)
                || ($payloadMeta['call_customer_required'] ?? null) !== $expectedCallRequired
                || ($payloadMeta['navigation_mode'] ?? null) !== $expectedNavigationMode
                || ($payloadMeta['location_accuracy'] ?? null) !== $expectedLocationAccuracy
                || ($payloadMeta['source_location_exception'] ?? null) !== (
                    $expectedCallRequired ? dailyHoldReason($row) : null
                )
                || ($payloadMeta['address_call_authorization'] ?? null) !== addressCallAuthorization(
                    $row, $this->allowAddressCall
                )) {
                throw new RuntimeException('daily_verify_payload_mapping');
            }
            $expectedDriver = $allocation['assignments'][(string) $row['order_id']] ?? null;
            if ($expectedRoutable) {
                if ($expectedDriver === null
                    || !isset($expectedDriverUuids[$expectedDriver])
                    || $order->driver_assigned_uuid !== $expectedDriver
                    || ($meta['hold_reason'] ?? null) !== null
                    || ($meta['assignment_mode'] ?? null) !== (
                        $expectedCallRequired
                            ? PARTNER_DRIVER_ASSIGNMENT_MODE_CALL_REQUIRED
                            : PARTNER_DRIVER_ASSIGNMENT_MODE
                    )
                    || ($meta['partner_driver_id'] ?? null) !== ($row['partner_driver_id'] ?? null)
                    || ($meta['partner_driver_public_id'] ?? null) !== ($row['partner_driver_public_id'] ?? null)
                    || $scheduledRaw !== $this->scheduledAtUtc($row['delivery_date'])) {
                    throw new RuntimeException('daily_verify_dispatch');
                }
                if ((string) $order->status !== 'dispatched'
                    || !(bool) $order->dispatched
                    || $order->dispatched_at === null
                    || ($meta['dispatch_state'] ?? null) !== (
                        $expectedCallRequired ? 'dispatched_call_customer_required' : 'dispatched'
                    )) {
                    throw new RuntimeException('daily_verify_dispatch');
                }
                $trackingNumber = DB::table('tracking_numbers')
                    ->where('uuid', $order->tracking_number_uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('owner_uuid', $order->uuid)
                    ->whereNull('deleted_at')
                    ->first(['uuid', 'status_uuid']);
                if (!$trackingNumber
                    || !DB::table('tracking_statuses')
                        ->where('uuid', $trackingNumber->status_uuid)
                        ->where('tracking_number_uuid', $trackingNumber->uuid)
                        ->where('company_uuid', $this->companyUuid)
                        ->where('code', 'DISPATCHED')
                        ->whereNull('deleted_at')
                        ->exists()) {
                    throw new RuntimeException('daily_verify_tracking');
                }
                $dropoff = Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first();
                $expectedPin = resolveEffectivePin($row);
                $dropoffMeta = $dropoff ? metaArray($dropoff->meta) : [];
                if (!$dropoff
                    || !$dropoff->location instanceof Point
                    || abs($dropoff->location->getLat() - $expectedPin['lat']) > 0.000001
                    || abs($dropoff->location->getLng() - $expectedPin['lng']) > 0.000001
                    || ($dropoffMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                    || ($dropoffMeta['fallback_scope'] ?? null) !== $expectedPin['fallback_scope']
                    || $dropoff->name !== sourcePlaceName($row, $this->allowAddressCall)
                    || $dropoff->street1 !== $row['address_text']
                    || $dropoff->street2 !== addressCallInstruction($row, $this->allowAddressCall)
                    || $dropoff->phone !== $row['customer_phone']
                    || $order->notes !== sourceOrderNotes($row, $this->allowAddressCall)) {
                    throw new RuntimeException('daily_verify_dropoff');
                }
                $actualLoads[$expectedDriver]++;
                $assigned++;
                if ($expectedCallRequired) {
                    $assignedCallRequired++;
                } else {
                    $assignedRealPin++;
                }
            } else {
                $expectedHoldReason = dailyHoldReason($row);
                if ($expectedDriver !== null
                    || $order->driver_assigned_uuid !== null
                    || (string) $order->status !== dailyHeldOrderStatus($expectedHoldReason)
                    || (bool) $order->dispatched
                    || $scheduledRaw !== ''
                    || ($meta['dispatch_state'] ?? null) !== 'held_' . $expectedHoldReason
                    || ($meta['hold_reason'] ?? null) !== $expectedHoldReason) {
                    throw new RuntimeException('daily_verify_hold');
                }
                $trackingNumber = DB::table('tracking_numbers')
                    ->where('uuid', $order->tracking_number_uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('owner_uuid', $order->uuid)
                    ->whereNull('deleted_at')
                    ->first(['uuid', 'status_uuid']);
                if (!$trackingNumber
                    || !DB::table('tracking_statuses')
                        ->where('uuid', $trackingNumber->status_uuid)
                        ->where('tracking_number_uuid', $trackingNumber->uuid)
                        ->where('company_uuid', $this->companyUuid)
                        ->where('code', dailyHeldTrackingCode($expectedHoldReason))
                        ->whereNull('deleted_at')
                        ->exists()) {
                    throw new RuntimeException('daily_verify_hold_tracking');
                }
                $held++;
            }
        }
        $expectedLoadsByUuid = [];
        foreach ($this->drivers as $driver) {
            $expectedLoadsByUuid[$driver['uuid']] = $allocation['loads'][$driver['public_id']] ?? -1;
        }
        ksort($actualLoads);
        ksort($expectedLoadsByUuid);
        if ($actualLoads !== $expectedLoadsByUuid
            || $assigned + $held !== count($dailyRows)) {
            throw new RuntimeException('daily_verify_load_reconciliation');
        }
        return [
            'passed' => true,
            'source_orders' => count($dailyRows),
            'fleetbase_orders' => $prefixOrders->count(),
            'source_missing_tombstones' => $missingTombstones->count(),
            'assigned_orders' => $assigned,
            'assigned_real_pin' => $assignedRealPin,
            'assigned_call_required' => $assignedCallRequired,
            'held_unroutable' => $held,
            'pickup_places' => 1,
            'scheduled_orders' => $assigned,
            'held_unscheduled_orders' => $held,
            'duplicate_internal_ids' => 0,
            'unexplained_orders' => 0,
        ];
    }
}

function acquireLock(string $prefix): string
{
    $companyUuid = resolveCompanyUuid();
    $name = 'nutreeze_orders_' . substr(hash('sha256', $prefix . '|' . $companyUuid), 0, 32);
    $row = DB::selectOne('SELECT GET_LOCK(?, 0) AS acquired', [$name]);
    if ((int) ($row->acquired ?? 0) !== 1) {
        throw new RuntimeException('integration_lock_busy');
    }
    return $name;
}

function releaseLock(?string $name): void
{
    if ($name !== null) {
        DB::selectOne('SELECT RELEASE_LOCK(?) AS released', [$name]);
    }
}

function runSelfTest(): array
{
    $semanticMetaModel = new class {
        public mixed $meta = '{"stable":true}';
        public array $assigned = [];

        public function setAttribute(string $key, mixed $value): void
        {
            $this->assigned[$key] = $value;
            $this->{$key} = $value;
        }
    };
    applyMetaUpdates($semanticMetaModel, ['stable' => true]);
    if ($semanticMetaModel->assigned !== []) {
        throw new RuntimeException('self_test_semantic_meta_noop');
    }
    applyMetaUpdates($semanticMetaModel, ['new_value' => 1]);
    if (($semanticMetaModel->assigned['meta']['new_value'] ?? null) !== 1) {
        throw new RuntimeException('self_test_semantic_meta_update');
    }
    $base = [
        'order_number' => 'SAME-DISPLAY',
        'status' => 'success',
        'area_ar' => 'منطقة اختبار',
        'area_en' => 'Synthetic Area',
        'location_pin' => null,
        'customer_ref' => 'SYN-1',
        'customer_name' => 'Synthetic Customer',
        'customer_phone' => '+000000000',
        'address_text' => 'Synthetic Address',
        'created_at' => '2026-07-12T00:00:00+03:00',
        'updated_at' => '2026-07-12T00:00:00+03:00',
    ];
    $a = validateRow(['order_id' => 1] + $base);
    $b = validateRow(['order_id' => 2, 'customer_ref' => 'SYN-2', 'location_pin' => '29.3000,48.0000'] + $base);
    $fallback = validateRow(['order_id' => 3, 'customer_ref' => 'SYN-3', 'area_en' => null] + $base);
    $cancel = validateRow(['order_id' => 4, 'customer_ref' => 'SYN-4', 'status' => 'cancel'] + $base);
    $active = validateRow(['order_id' => 9, 'customer_ref' => 'SYN-9', 'status' => 'active'] + $base);
    if ($a['pin'] !== null
        || $b['pin'] === null
        || $fallback['routing_area'] !== 'منطقة اختبار'
        || $cancel['status'] !== 'cancel'
        || $active['status'] !== 'active') {
        throw new RuntimeException('self_test_mapping');
    }
    if (count(deduplicateRows([
        ['order_id' => 1] + $base,
        ['order_id' => 2, 'customer_ref' => 'SYN-2'] + $base,
    ])) !== 2) {
        throw new RuntimeException('self_test_order_number_identity');
    }
    $invalidPin = validateRow(['order_id' => 5, 'customer_ref' => 'SYN-5', 'location_pin' => '999,999'] + $base);
    $transposedPin = validateRow(['order_id' => 7, 'customer_ref' => 'SYN-7', 'location_pin' => '48.0000,29.3000'] + $base);
    $zeroPin = validateRow(['order_id' => 8, 'customer_ref' => 'SYN-8', 'location_pin' => '0,0'] + $base);
    if ($invalidPin['pin'] !== null
        || $transposedPin['pin'] !== null
        || $zeroPin['pin'] !== null
        || pinHoldReason($invalidPin) !== 'invalid_source_location_pin') {
        throw new RuntimeException('self_test_pin_validation');
    }
    $vendorPin = resolveEffectivePin($b);
    if ($vendorPin['pin_source'] !== 'vendor'
        || abs($vendorPin['lat'] - 29.3) > 0.000001
        || abs($vendorPin['lng'] - 48.0) > 0.000001) {
        throw new RuntimeException('self_test_vendor_pin_passthrough');
    }
    $areaPin = resolveEffectivePin(validateRow(['order_id' => 6, 'customer_ref' => 'SYN-6', 'area_en' => 'Farwaniya'] + $base));
    if ($areaPin['pin_source'] !== 'area_fallback'
        || $areaPin['fallback_scope'] !== 'area'
        || abs($areaPin['lat'] - AREA_FALLBACK_CENTROIDS['farwaniya'][0]) > 0.000001) {
        throw new RuntimeException('self_test_area_fallback');
    }
    if (count(AREA_FALLBACK_CENTROIDS) !== 70) {
        throw new RuntimeException('self_test_area_fallback_manifest');
    }
    foreach (AREA_FALLBACK_CENTROIDS as $area => [$lat, $lng]) {
        if ($area === '' || parsePin($lat . ',' . $lng) === null) {
            throw new RuntimeException('self_test_area_fallback_coordinate');
        }
    }
    $countryPin = resolveEffectivePin($a);
    if ($countryPin['pin_source'] !== 'area_fallback' || $countryPin['fallback_scope'] !== 'country') {
        throw new RuntimeException('self_test_country_fallback');
    }
    $mealBase = [
        'customer_ref' => 'SYN-1',
        'order_number' => 'DAILY-1',
        'delivery_date' => '2026-07-19',
        'status' => 'driver_assigned',
        'meal_id' => 101,
        'meal_name_ar' => 'وجبة',
        'meal_name_en' => 'Meal',
        'qty' => 2,
        'updated_at' => '2026-07-18T10:00:00+03:00',
    ];
    $dailyOrders = [
        ['order_id' => 11, 'order_number' => 'DAILY-1', 'location_pin' => '29.3000,48.0000'] + $base,
        ['order_id' => 12, 'order_number' => 'DAILY-2', 'customer_ref' => 'SYN-2'] + $base,
    ];
    $dailyMeals = [
        $mealBase,
        ['meal_id' => 102, 'qty' => 1] + $mealBase,
        ['customer_ref' => 'SYN-2', 'order_number' => 'DAILY-2', 'meal_id' => 201, 'qty' => 1] + $mealBase,
    ];
    $daily = buildDailyRows($dailyMeals, $dailyOrders, '2026-07-19');
    if (count($daily) !== 2
        || $daily[0]['meal_item_count'] !== 2
        || $daily[0]['meal_qty'] !== 3
        || $daily[1]['pin'] !== null) {
        throw new RuntimeException('self_test_daily_join');
    }
    $syntheticDrivers = [
        ['uuid' => 'driver-uuid-a', 'public_id' => 'driver_AAAAAA', 'partner_driver_id' => '7', 'unit' => 'Area-1'],
        ['uuid' => 'driver-uuid-b', 'public_id' => 'driver_BBBBBB', 'partner_driver_id' => '9', 'unit' => 'Area-2'],
    ];
    // Partner driver.id is the only assignment authority (A46).
    if (normalizePartnerDriverId(7) !== '7'
        || normalizePartnerDriverId(' 7 ') !== '7'
        || normalizePartnerDriverId(null) !== null
        || normalizePartnerDriverId('') !== null) {
        throw new RuntimeException('self_test_partner_driver_id_normalization');
    }
    foreach ([0, -3, 'bad id', str_repeat('9', 65), 1.5] as $badDriverId) {
        try {
            normalizePartnerDriverId($badDriverId);
            throw new RuntimeException('self_test_partner_driver_id_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== 'contract_driver_id') {
                throw $exception;
            }
        }
    }
    $driverless = applyPartnerDriverAssignments($daily, $syntheticDrivers);
    if ($driverless['orders_without_partner_driver'] !== 2
        || $driverless['unmapped_partner_driver_ids'] !== []
        || dailyHoldReason($driverless['rows'][0]) !== 'no_partner_driver'
        || rowIsDailyRoutable($driverless['rows'][0])
        || rowIsDailyRoutable($driverless['rows'][1], true)
        || rowRequiresCustomerCall($driverless['rows'][1], true)
        || allocateDailyDrivers($driverless['rows'], $syntheticDrivers)['assignments'] !== []) {
        throw new RuntimeException('self_test_daily_no_partner_driver_hold');
    }
    $unmappedRows = array_map(fn (array $row): array => ['partner_driver_id' => '42'] + $row, $daily);
    $unmapped = applyPartnerDriverAssignments($unmappedRows, $syntheticDrivers);
    if ($unmapped['orders_without_partner_driver'] !== 0
        || $unmapped['unmapped_partner_driver_ids'] !== ['42']
        || dailyHoldReason($unmapped['rows'][0]) !== 'unmapped_partner_driver'
        || rowIsDailyRoutable($unmapped['rows'][0])
        || allocateDailyDrivers($unmapped['rows'], $syntheticDrivers)['assignments'] !== []) {
        throw new RuntimeException('self_test_daily_unmapped_partner_driver_hold');
    }
    // Same routing area, different Partner drivers: the area never couples orders.
    $daily = applyPartnerDriverAssignments([
        ['partner_driver_id' => '9'] + $daily[0],
        ['partner_driver_id' => '7'] + $daily[1],
    ], $syntheticDrivers)['rows'];
    $sameAreaOther = ['order_id' => 99, 'partner_driver_id' => '7'] + $daily[0];
    unset($sameAreaOther['partner_driver_uuid'], $sameAreaOther['partner_driver_public_id']);
    $sameAreaOther = applyPartnerDriverAssignments([$sameAreaOther], $syntheticDrivers)['rows'][0];
    $allocation = allocateDailyDrivers([...$daily, $sameAreaOther], $syntheticDrivers);
    if (($allocation['assignments']['11'] ?? null) !== 'driver-uuid-b'
        || ($allocation['assignments']['99'] ?? null) !== 'driver-uuid-a'
        || isset($allocation['assignments']['12'])
        || $allocation['loads'] !== ['driver_AAAAAA' => 1, 'driver_BBBBBB' => 1]) {
        throw new RuntimeException('self_test_daily_allocation');
    }
    $foreignUuidRow = $daily[0];
    $foreignUuidRow['partner_driver_uuid'] = 'driver-uuid-zzz';
    try {
        allocateDailyDrivers([$foreignUuidRow], $syntheticDrivers);
        throw new RuntimeException('self_test_daily_allocation_foreign_not_rejected');
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== 'daily_allocation_driver') {
            throw $exception;
        }
    }
    try {
        allocateDailyDrivers([$daily[0], $daily[0]], $syntheticDrivers);
        throw new RuntimeException('self_test_daily_allocation_duplicate_not_rejected');
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== 'daily_allocation_duplicate_order') {
            throw $exception;
        }
    }
    $validMap = [
        'schema_version' => PARTNER_DRIVER_MAP_SCHEMA_VERSION,
        'expected_count' => 2,
        'drivers' => [
            ['partner_driver_id' => 9, 'driver_public_id' => 'driver_BBBBBB', 'unit' => 'Area-2'],
            ['partner_driver_id' => '7', 'driver_public_id' => 'driver_AAAAAA'],
        ],
    ];
    $validated = validatePartnerDriverMap($validMap);
    if (array_column($validated, 'partner_driver_id') !== ['7', '9']
        || $validated[1]['public_id'] !== 'driver_BBBBBB'
        || $validated[1]['unit'] !== 'Area-2'
        || $validated[0]['unit'] !== null) {
        throw new RuntimeException('self_test_partner_driver_map_valid');
    }
    // Aliases: a numeric Partner user id and a unit code may name the same Fleetbase driver.
    $aliasMap = validatePartnerDriverMap(array_replace($validMap, ['expected_count' => 3, 'drivers' => [
        ...$validMap['drivers'],
        ['partner_driver_id' => '19033', 'driver_public_id' => 'driver_BBBBBB', 'unit' => 'Area-2'],
    ]]));
    $aliasDrivers = [
        ...$syntheticDrivers,
        ['uuid' => 'driver-uuid-b', 'public_id' => 'driver_BBBBBB', 'partner_driver_id' => '19033', 'unit' => 'Area-2'],
    ];
    $aliasRows = applyPartnerDriverAssignments([
        ['partner_driver_id' => '19033'] + $daily[0],
    ], $aliasDrivers)['rows'];
    $aliasAllocation = allocateDailyDrivers($aliasRows, $aliasDrivers);
    if (count($aliasMap) !== 3
        || ($aliasAllocation['assignments']['11'] ?? null) !== 'driver-uuid-b'
        || $aliasAllocation['loads'] !== ['driver_AAAAAA' => 0, 'driver_BBBBBB' => 1]) {
        throw new RuntimeException('self_test_partner_driver_map_alias');
    }
    foreach ([
        [array_replace($validMap, ['schema_version' => 2]), 'partner_driver_map_shape'],
        [array_replace($validMap, ['expected_count' => 1]), 'partner_driver_map_shape'],
        [array_replace($validMap, ['drivers' => [
            $validMap['drivers'][0],
            ['partner_driver_id' => '9', 'driver_public_id' => 'driver_AAAAAA'],
        ]]), 'partner_driver_map_partner_id'],
        [array_replace($validMap, ['drivers' => [
            $validMap['drivers'][0],
            ['partner_driver_id' => '7', 'driver_public_id' => 'not-a-driver'],
        ]]), 'partner_driver_map_public_id'],
        [array_replace($validMap, ['drivers' => [
            $validMap['drivers'][0],
            ['partner_driver_id' => '7', 'driver_public_id' => 'driver_AAAAAA', 'unit' => "bad\x01"],
        ]]), 'partner_driver_map_unit'],
    ] as [$badMap, $expectedError]) {
        try {
            validatePartnerDriverMap($badMap);
            throw new RuntimeException('self_test_partner_driver_map_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== $expectedError) {
                throw $exception;
            }
        }
    }
    $canceledDaily = buildDailyRows(
        [$mealBase],
        [['status' => 'cancel'] + $dailyOrders[0]],
        '2026-07-19',
    );
    $canceledBase = dailyRowsForBaseWriter($canceledDaily);
    if (($canceledDaily[0]['source_order_status'] ?? null) !== 'cancel'
        || dailyHoldReason($canceledDaily[0]) !== 'source_order_canceled'
        || rowIsDailyRoutable($canceledDaily[0])
        || dailyHeldOrderStatus(dailyHoldReason($canceledDaily[0])) !== 'canceled'
        || dailyHeldTrackingCode(dailyHoldReason($canceledDaily[0])) !== 'CANCELED'
        || $canceledBase[0]['status'] !== 'pending'
        || $canceledBase[0]['_source_hash'] !== $canceledDaily[0]['_source_hash']) {
        throw new RuntimeException('self_test_daily_source_cancellation');
    }
    $unknownStatusDaily = buildDailyRows(
        [['status' => 'skipped'] + $mealBase],
        [$dailyOrders[0]],
        '2026-07-19',
    );
    $pendingOrderDaily = buildDailyRows(
        [$mealBase],
        [['status' => 'pending'] + $dailyOrders[0]],
        '2026-07-19',
    );
    if (dailyHoldReason($unknownStatusDaily[0]) !== 'unapproved_meal_status'
        || rowIsDailyRoutable($unknownStatusDaily[0])
        || allocateDailyDrivers($unknownStatusDaily, $syntheticDrivers)['assignments'] !== []
        || dailyHoldReason($pendingOrderDaily[0]) !== 'unapproved_order_status'
        || rowIsDailyRoutable($pendingOrderDaily[0])) {
        throw new RuntimeException('self_test_daily_status_allowlist');
    }
    $authorizedRealPin = $daily[0];
    $authorizedRealPin['delivery_date'] = '2026-07-20';
    $authorizedFallback = $daily[1];
    $authorizedFallback['delivery_date'] = '2026-07-20';
    $authorizedFallback['area_en'] = 'Farwaniya';
    $authorizedFallback['routing_area'] = 'Farwaniya';
    $authorizedInvalid = $authorizedFallback;
    $authorizedInvalid['order_id'] = 13;
    $authorizedInvalid['location_pin'] = '999,999';
    $authorizedCountryFallback = $daily[1];
    $authorizedCountryFallback['delivery_date'] = '2026-07-20';
    $authorizedUnapproved = $unknownStatusDaily[0];
    $authorizedUnapproved['delivery_date'] = '2026-07-20';
    $authorizedUnapproved['area_en'] = 'Farwaniya';
    $authorizedUnapproved['routing_area'] = 'Farwaniya';
    if (rowIsDailyRoutable($authorizedFallback)
        || !rowRequiresCustomerCall($authorizedFallback, true)
        || !rowRequiresCustomerCall($authorizedInvalid, true)
        || !rowIsDailyRoutable($authorizedFallback, true)
        || rowRequiresCustomerCall($authorizedRealPin, true)
        // A57: unmapped areas fall back to the country centroid and are still call-dispatched.
        || !rowRequiresCustomerCall($authorizedCountryFallback, true)
        || resolveEffectivePin($authorizedCountryFallback)['fallback_scope'] !== 'country'
        || rowRequiresCustomerCall($authorizedUnapproved, true)
        // A57: a missing written address no longer holds the row; a missing phone still does.
        || !rowRequiresCustomerCall(['address_text' => ''] + $authorizedFallback, true)
        || rowRequiresCustomerCall(['customer_phone' => ''] + $authorizedFallback, true)
        || rowRequiresCustomerCall($authorizedFallback, false)) {
        throw new RuntimeException('self_test_daily_address_call_policy');
    }
    $authorizedAllocation = allocateDailyDrivers(
        [$authorizedRealPin, $authorizedFallback, $authorizedInvalid],
        $syntheticDrivers,
        true,
    );
    if (count($authorizedAllocation['assignments']) !== 3
        || array_sum($authorizedAllocation['loads']) !== 3
        || addressCallInstruction($authorizedFallback, true) === null
        || !str_starts_with(sourcePlaceName($authorizedFallback, true), 'CALL CUSTOMER FIRST')
        || !str_contains(sourceOrderNotes($authorizedFallback, true), 'CALL CUSTOMER')) {
        throw new RuntimeException('self_test_daily_address_call_allocation');
    }
    if (!resolveAddressCallAuthorization('2026-07-20', '2026-07-20')
        || resolveAddressCallAuthorization('2026-07-20', null)
        // A57: standing from 2026-09-05; the per-date confirmation is still mandatory.
        || !resolveAddressCallAuthorization('2026-09-05', '2026-09-05')
        || !resolveAddressCallAuthorization('2027-01-01', '2027-01-01')
        || resolveAddressCallAuthorization('2026-09-06', null)
        || addressCallAuthorization(['delivery_date' => '2026-09-06'] + $authorizedFallback, true)
            !== ADDRESS_CALL_STANDING_AUTHORIZATION
        || addressCallAuthorization($authorizedFallback, true) !== ADDRESS_CALL_AUTHORIZATION) {
        throw new RuntimeException('self_test_daily_address_call_confirmation');
    }
    foreach ([
        ['2026-07-20', '2026-07-19', 'daily_address_call_confirmation_guard'],
        ['2026-07-21', '2026-07-21', 'daily_address_call_date_not_authorized'],
        ['2026-09-04', '2026-09-04', 'daily_address_call_date_not_authorized'],
        ['2026-09-06', '2026-09-05', 'daily_address_call_confirmation_guard'],
    ] as [$date, $confirmation, $expectedError]) {
        try {
            resolveAddressCallAuthorization($date, $confirmation);
            throw new RuntimeException('self_test_daily_address_call_confirmation_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== $expectedError) {
                throw $exception;
            }
        }
    }
    $recoveryRows = applyLocationRecoveryData(
        [
            ['routing_area' => 'Farwaniya', 'pin' => ['lat' => 29.28, 'lng' => 47.96]] + $authorizedRealPin,
            ['routing_area' => 'Farwaniya'] + $authorizedFallback,
        ],
        [],
    );
    if (($recoveryRows[1]['recovery_anchor'] ?? null) === null
        || resolveEffectivePin($recoveryRows[1])['pin_source'] !== 'known_stop_anchor'
        || !rowRequiresCustomerCall($recoveryRows[1], true)
        || addressCallAuthorization($recoveryRows[1], true) !== LOCATION_RECOVERY_AUTHORIZATION
        || locationAccuracyForRow($recoveryRows[1], true) !== 'known_stop_not_customer_pin') {
        throw new RuntimeException('self_test_location_recovery_anchor');
    }
    $heldAnchorRows = applyLocationRecoveryData(
        [
            ['routing_area' => 'Farwaniya'] + $pendingOrderDaily[0],
            ['routing_area' => 'Farwaniya'] + $authorizedFallback,
        ],
        [],
    );
    if (($heldAnchorRows[1]['recovery_anchor'] ?? null) !== null) {
        throw new RuntimeException('self_test_location_recovery_held_anchor');
    }
    $capturedRows = applyLocationRecoveryData(
        [$authorizedFallback],
        ['SYN-2' => ['lat' => 29.281, 'lng' => 47.961, 'capture_id' => 'capture-test']],
    );
    if (resolveEffectivePin($capturedRows[0])['pin_source'] !== 'driver_capture'
        || dailyHoldReason($capturedRows[0]) !== null
        || rowRequiresCustomerCall($capturedRows[0], true)
        || navigationModeForRow($capturedRows[0], true) !== 'saved_customer_pin'
        || locationAccuracyForRow($capturedRows[0], true) !== 'captured_customer_pin') {
        throw new RuntimeException('self_test_location_recovery_capture');
    }
    if (!resolveLocationRecoveryAuthorization('2026-08-08', '2026-08-08')
        || resolveLocationRecoveryAuthorization('2026-08-08', null)) {
        throw new RuntimeException('self_test_location_recovery_confirmation');
    }
    $repeatedMealItems = buildDailyRows([$mealBase, $mealBase], $dailyOrders, '2026-07-19');
    if (count($repeatedMealItems) !== 1
        || $repeatedMealItems[0]['meal_item_count'] !== 2
        || $repeatedMealItems[0]['meal_qty'] !== 4) {
        throw new RuntimeException('self_test_daily_repeated_meal_item');
    }
    $missingContextRejected = false;
    try {
        buildDailyRows([$mealBase], [], '2026-07-19');
    } catch (RuntimeException $exception) {
        $missingContextRejected = $exception->getMessage() === 'daily_order_context_missing';
    }
    if (!$missingContextRejected) {
        throw new RuntimeException('self_test_daily_missing_context');
    }
    $invalidDateRejected = false;
    try {
        validateDeliveryDate('2026-02-30');
    } catch (RuntimeException) {
        $invalidDateRejected = true;
    }
    if (!$invalidDateRejected) {
        throw new RuntimeException('self_test_daily_date');
    }
    if (dailySourceDigest($daily) !== dailySourceDigest($daily)
        || dailySourceDigest($daily) === dailySourceDigest(array_reverse($daily))) {
        throw new RuntimeException('self_test_daily_digest');
    }
    $conflictingOrderRejected = false;
    try {
        buildDailyRows(
            [$mealBase],
            [
                $dailyOrders[0],
                ['address_text' => 'Different Address'] + $dailyOrders[0],
            ],
            '2026-07-19',
        );
    } catch (RuntimeException $exception) {
        $conflictingOrderRejected = $exception->getMessage() === 'contract_daily_conflicting_order_snapshot';
    }
    if (!$conflictingOrderRejected) {
        throw new RuntimeException('self_test_daily_order_snapshot');
    }
    if (buildDailyRows([], [], '2026-07-19') !== []) {
        throw new RuntimeException('self_test_daily_zero');
    }
    $deliveryBase = [
        'delivery_id' => 501,
        'order_id' => 31,
        'order_number' => 'DELIVERY-31',
        'customer_ref' => 'SYN-31',
        'delivery_date' => '2026-08-12',
        'order_status' => 'success',
        'delivery_status' => 'driver_assigned',
        'hold_state' => 'scheduled',
        'is_cancelled' => false,
        'is_on_hold' => false,
        'meal_item_count' => 0,
        'location_pin' => '29.3000,48.0000',
        'delivery_method' => 'Call upon arrival',
        'driver_instructions' => null,
        'customer' => ['name' => 'Daily Customer', 'phone' => '50000000'],
        'address' => [
            'area_en' => 'Farwaniya',
            'area_ar' => 'الفروانية',
            'text' => 'Daily Address',
        ],
        'time_slot' => ['id' => 1, 'title' => 'Morning', 'start' => '05:00', 'end' => '16:00'],
        'driver' => ['id' => null, 'name' => null],
        'updated_at' => '2026-08-11T10:00:00+03:00',
    ];
    $dailyDeliveryRows = buildDailyDeliveryRows([
        $deliveryBase,
        array_replace($deliveryBase, [
            'delivery_id' => 502,
            'delivery_status' => 'ordered',
            'meal_item_count' => 4,
            'updated_at' => '2026-08-11T11:00:00+03:00',
        ]),
        array_replace($deliveryBase, [
            'delivery_id' => 503,
            'order_id' => 32,
            'order_number' => 'DELIVERY-32',
            'customer_ref' => 'SYN-32',
            'meal_item_count' => 2,
        ]),
    ], '2026-08-12');
    if (count($dailyDeliveryRows) !== 2
        || $dailyDeliveryRows[0]['meal_item_count'] !== 4
        || $dailyDeliveryRows[0]['meal_qty'] !== null
        || $dailyDeliveryRows[0]['created_at'] !== null
        || $dailyDeliveryRows[0]['source_delivery_ids'] !== [501, 502]
        || $dailyDeliveryRows[0]['source_delivery_row_count'] !== 2
        || $dailyDeliveryRows[0]['source_selector'] !== DAILY_SOURCE_SELECTOR) {
        throw new RuntimeException('self_test_daily_delivery_canonicalization');
    }
    $duplicateConflictRejected = false;
    try {
        buildDailyDeliveryRows([
            $deliveryBase,
            array_replace($deliveryBase, [
                'delivery_id' => 502,
                'meal_item_count' => 1,
                'updated_at' => '2026-08-11T11:00:00+03:00',
                'address' => array_replace($deliveryBase['address'], ['text' => 'Different Address']),
            ]),
        ], '2026-08-12');
    } catch (RuntimeException $exception) {
        $duplicateConflictRejected = $exception->getMessage() === 'contract_daily_delivery_group_conflict';
    }
    if (!$duplicateConflictRejected) {
        throw new RuntimeException('self_test_daily_delivery_conflict');
    }
    $identicalDuplicateRows = buildDailyDeliveryRows([
        array_replace($deliveryBase, ['meal_item_count' => 3]),
        array_replace($deliveryBase, [
            'delivery_id' => 502,
            'meal_item_count' => 3,
            'updated_at' => '2026-08-11T11:00:00+03:00',
        ]),
    ], '2026-08-12');
    if ($identicalDuplicateRows[0]['source_delivery_ids'] !== [501, 502]
        || $identicalDuplicateRows[0]['meal_item_count'] !== 3
        || $identicalDuplicateRows[0]['updated_at'] !== '2026-08-11T11:00:00+03:00') {
        throw new RuntimeException('self_test_daily_delivery_identical_duplicate');
    }
    foreach ([
        [
            array_replace($deliveryBase, [
                'delivery_id' => 502,
                'delivery_status' => 'ordered',
                'updated_at' => '2026-08-11T11:00:00+03:00',
            ]),
            'contract_daily_delivery_duplicate_ambiguous',
        ],
        [
            array_replace($deliveryBase, [
                'delivery_id' => 502,
                'meal_item_count' => 1,
                'updated_at' => '2026-08-11T09:00:00+03:00',
            ]),
            'contract_daily_delivery_duplicate_stale_meal_row',
        ],
    ] as [$candidate, $expectedError]) {
        try {
            buildDailyDeliveryRows([$deliveryBase, $candidate], '2026-08-12');
            throw new RuntimeException('self_test_daily_delivery_duplicate_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== $expectedError) {
                throw $exception;
            }
        }
    }
    $singleDeliveryRows = buildDailyDeliveryRows([
        array_replace($deliveryBase, ['meal_item_count' => 1]),
    ], '2026-08-12');
    $changedDeliveryIdRows = buildDailyDeliveryRows([
        array_replace($deliveryBase, ['delivery_id' => 599, 'meal_item_count' => 1]),
    ], '2026-08-12');
    if (dailySourceDigest($singleDeliveryRows) === dailySourceDigest($changedDeliveryIdRows)) {
        throw new RuntimeException('self_test_daily_delivery_digest');
    }
    $driverDeliveryRows = buildDailyDeliveryRows([
        array_replace($deliveryBase, ['driver' => ['id' => 9, 'name' => 'Unit Nine']]),
    ], '2026-08-12');
    if ($driverDeliveryRows[0]['partner_driver_id'] !== '9'
        || $driverDeliveryRows[0]['partner_driver_name'] !== 'Unit Nine'
        || $dailyDeliveryRows[0]['partner_driver_id'] !== null
        || dailyHoldReason($dailyDeliveryRows[0]) !== 'no_partner_driver'
        || $driverDeliveryRows[0]['_source_hash'] === buildDailyDeliveryRows([
            array_replace($deliveryBase, ['driver' => ['id' => 7, 'name' => 'Unit Nine']]),
        ], '2026-08-12')[0]['_source_hash']
        || $driverDeliveryRows[0]['_source_hash'] !== buildDailyDeliveryRows([
            array_replace($deliveryBase, ['driver' => ['id' => '9', 'name' => 'Renamed']]),
        ], '2026-08-12')[0]['_source_hash']) {
        throw new RuntimeException('self_test_daily_delivery_partner_driver');
    }
    try {
        buildDailyDeliveryRows([
            array_replace($deliveryBase, ['driver' => ['id' => 9, 'name' => null]]),
            array_replace($deliveryBase, [
                'delivery_id' => 502,
                'meal_item_count' => 1,
                'updated_at' => '2026-08-11T11:00:00+03:00',
                'driver' => ['id' => 7, 'name' => null],
            ]),
        ], '2026-08-12');
        throw new RuntimeException('self_test_daily_delivery_driver_conflict_not_rejected');
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== 'contract_daily_delivery_group_conflict') {
            throw $exception;
        }
    }
    $emptyTimeSlotRows = buildDailyDeliveryRows([
        array_replace($deliveryBase, [
            'time_slot' => ['id' => null, 'title' => null, 'start' => null, 'end' => null],
        ]),
    ], '2026-08-12');
    if (count($emptyTimeSlotRows) !== 1) {
        throw new RuntimeException('self_test_daily_delivery_empty_time_slot');
    }
    try {
        buildDailyDeliveryRows([
            array_replace($deliveryBase, [
                'time_slot' => array_replace($deliveryBase['time_slot'], ['title' => ['invalid']]),
            ]),
        ], '2026-08-12');
        throw new RuntimeException('self_test_daily_delivery_invalid_time_slot_title_not_rejected');
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== 'contract_string_title') {
            throw $exception;
        }
    }
    // A pre-dispatched but unstarted job remains safe to reconcile inside the
    // existing transaction even when Partner advances ordered -> driver_assigned,
    // refreshes updated_at, changes the deterministic assignment, or holds it.
    guardDailyDispatchedReconciliation(
        false,
        true,
        'driver-uuid-b',
        'driver-uuid-a',
        'old-source-hash',
        'new-source-hash',
        'old-meal-hash',
        'new-meal-hash',
    );
    guardDailyDispatchedReconciliation(
        false,
        false,
        null,
        'driver-uuid-a',
        'old-source-hash',
        'new-source-hash',
        'old-meal-hash',
        'new-meal-hash',
    );
    guardDailyDispatchedReconciliation(
        true,
        true,
        'driver-uuid-a',
        'driver-uuid-a',
        'stable-source-hash',
        'stable-source-hash',
        'stable-meal-hash',
        'stable-meal-hash',
    );
    foreach ([
        [true, false, null, 'driver-uuid-a', 'old', 'new', 'old', 'new'],
        [true, true, 'driver-uuid-b', 'driver-uuid-a', 'same', 'same', 'same', 'same'],
        [true, true, 'driver-uuid-a', 'driver-uuid-a', 'old', 'new', 'same', 'same'],
    ] as $guardArguments) {
        try {
            guardDailyDispatchedReconciliation(...$guardArguments);
            throw new RuntimeException('self_test_daily_started_snapshot_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== 'daily_started_snapshot_changed') {
                throw $exception;
            }
        }
    }
    try {
        guardDailyDispatchedReconciliation(
            false,
            true,
            null,
            null,
            'same',
            'same',
            'same',
            'same',
        );
        throw new RuntimeException('self_test_daily_missing_allocation_not_rejected');
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== 'daily_allocation_driver') {
            throw $exception;
        }
    }
    $membershipNumbers = ['DELIVERY-31'];
    $membershipManifest = [
        'schema_version' => 1,
        'source' => 'legacy_driver_orders_csv_v1',
        'delivery_date' => '2026-08-12',
        'expected_count' => 1,
        'order_number_digest' => hash('sha256', "DELIVERY-31\n"),
        'order_numbers' => $membershipNumbers,
    ];
    $membership = applyDriverOrdersMembershipManifest(
        $dailyDeliveryRows,
        $membershipManifest,
        '2026-08-12',
    );
    if ($membership['count'] !== 1
        || $membership['api_only_excluded'] !== 1
        || count($membership['rows']) !== 1
        || $membership['rows'][0]['order_number'] !== 'DELIVERY-31') {
        throw new RuntimeException('self_test_driver_orders_membership');
    }
    foreach ([
        array_replace($membershipManifest, [
            'order_numbers' => ['DELIVERY-99'],
            'order_number_digest' => hash('sha256', "DELIVERY-99\n"),
        ]),
        array_replace($membershipManifest, ['order_number_digest' => str_repeat('0', 64)]),
    ] as $index => $invalidManifest) {
        try {
            applyDriverOrdersMembershipManifest($dailyDeliveryRows, $invalidManifest, '2026-08-12');
            throw new RuntimeException('self_test_driver_orders_membership_not_rejected');
        } catch (RuntimeException $exception) {
            $expected = $index === 0
                ? 'driver_orders_manifest_missing_from_api'
                : 'driver_orders_manifest_digest';
            if ($exception->getMessage() !== $expected) {
                throw $exception;
            }
        }
    }
    // WP-OPS-07 (A50): daytime withdrawal decision is pure and covers exactly cancel + on-hold.
    $withdrawCancel = buildDailyRows([$mealBase], [['status' => 'cancel'] + $dailyOrders[0]], '2026-07-19');
    $withdrawOnHold = buildDailyRows([['status' => 'on_hold'] + $mealBase], [$dailyOrders[0]], '2026-07-19');
    $withdrawNormal = buildDailyRows([$mealBase], [$dailyOrders[0]], '2026-07-19');
    $withdrawPending = buildDailyRows([$mealBase], [['status' => 'pending'] + $dailyOrders[0]], '2026-07-19');
    if (dailyWithdrawalReason($withdrawCancel[0]) !== 'source_order_canceled'
        || dailyHeldOrderStatus(dailyWithdrawalReason($withdrawCancel[0])) !== 'canceled') {
        throw new RuntimeException('self_test_daily_withdrawal_cancel');
    }
    if (dailyWithdrawalReason($withdrawOnHold[0]) !== 'unapproved_meal_status'
        || dailyHeldOrderStatus(dailyWithdrawalReason($withdrawOnHold[0])) !== 'created'
        || dailyHeldTrackingCode(dailyWithdrawalReason($withdrawOnHold[0])) !== 'ON_HOLD') {
        throw new RuntimeException('self_test_daily_withdrawal_on_hold');
    }
    if (dailyWithdrawalReason($withdrawNormal[0]) !== null) {
        throw new RuntimeException('self_test_daily_withdrawal_deliverable');
    }
    if (dailyWithdrawalReason($withdrawPending[0]) !== null
        || dailyStatusHoldReason($withdrawPending[0]) !== 'unapproved_order_status') {
        throw new RuntimeException('self_test_daily_withdrawal_other_status_ignored');
    }
    foreach (DAILY_WITHDRAWAL_HOLD_REASONS as $reason) {
        if (!in_array($reason, ['source_order_canceled', 'unapproved_meal_status'], true)) {
            throw new RuntimeException('self_test_daily_withdrawal_reasons');
        }
    }
    return ['passed' => 43, 'total' => 43];
}

$stage = 'startup';
$lockName = null;
$token = null;

try {
    $options = getopt('', [
        'since:', 'limit:', 'prefix:', 'state-file:', 'token-stdin', 'dry-run', 'verify',
        'self-test', 'cleanup-prefix:', 'confirm-cleanup:', 'fail-after-page:', 'fail-before-watermark',
        'confirm-since-override:', 'backfill-display', 'confirm-backfill:',
        'delivery-date:', 'meal-since:', 'driver-roster:', 'pickup-config:',
        'expected-count:', 'expected-digest:', 'confirm-daily-sync:', 'confirm-zero-day:',
        'confirm-address-call-dispatch:', 'confirm-location-recovery:', 'location-captures:',
        'driver-orders-manifest:', 'partner-driver-map:', 'cancel-only:',
    ]);

    if (isset($options['self-test'])) {
        $result = runSelfTest();
        safeLog('self_test', $result);
        exit(0);
    }

    $deliveryDate = isset($options['delivery-date'])
        ? validateDeliveryDate((string) $options['delivery-date'])
        : null;
    $allowA19AddressCall = resolveAddressCallAuthorization(
        $deliveryDate,
        $options['confirm-address-call-dispatch'] ?? null,
    );
    $allowLocationRecovery = resolveLocationRecoveryAuthorization(
        $deliveryDate,
        $options['confirm-location-recovery'] ?? null,
    );
    $allowAddressCall = $allowA19AddressCall || $allowLocationRecovery;
    if (isset($options['location-captures']) !== $allowLocationRecovery) {
        throw new RuntimeException('daily_location_captures_authorization_guard');
    }
    if (isset($options['driver-orders-manifest']) && $deliveryDate === null) {
        throw new RuntimeException('driver_orders_manifest_daily_only');
    }
    if (isset($options['partner-driver-map']) && $deliveryDate === null) {
        throw new RuntimeException('partner_driver_map_daily_only');
    }
    $dailyPrefix = $deliveryDate === null
        ? null
        : DEFAULT_DAILY_PREFIX . '-' . str_replace('-', '', $deliveryDate);
    $prefix = strtoupper((string) ($options['prefix'] ?? $options['cleanup-prefix'] ?? $dailyPrefix ?? DEFAULT_PREFIX));
    if (!preg_match('/^[A-Z0-9][A-Z0-9-]{2,60}$/', $prefix)) {
        throw new RuntimeException('prefix_invalid');
    }
    if ($deliveryDate !== null && !hash_equals((string) $dailyPrefix, $prefix)) {
        throw new RuntimeException('daily_prefix_override_guard');
    }
    if ($deliveryDate !== null
        && (isset($options['cleanup-prefix'])
            || isset($options['backfill-display'])
            || isset($options['since'])
            || isset($options['fail-after-page'])
            || isset($options['fail-before-watermark'])
            || isset($options['confirm-since-override']))) {
        throw new RuntimeException('daily_option_conflict');
    }
    $companyUuid = resolveCompanyUuid();
    $companyStateKey = substr(hash('sha256', $companyUuid), 0, 12);
    $expectedStatePath = '/fleetbase/api/storage/app/integrations/state/' . strtolower($prefix) . '-' . $companyStateKey . '.json';
    $statePath = (string) ($options['state-file'] ?? $expectedStatePath);
    if (!hash_equals($expectedStatePath, $statePath)) {
        throw new RuntimeException('watermark_prefix_mismatch');
    }
    $lockName = acquireLock($prefix);

    if (isset($options['cleanup-prefix'])) {
        $stage = 'cleanup';
        if (getenv('NUTREEZE_TEST_MODE') !== '1' || ($options['confirm-cleanup'] ?? null) !== $prefix) {
            throw new RuntimeException('cleanup_confirmation_guard');
        }
        $counts = FleetbaseWriter::cleanup($prefix, $statePath);
        safeLog('cleanup', $counts);
        releaseLock($lockName);
        exit(0);
    }

    if (isset($options['backfill-display'])) {
        // Re-apply the current mapping (tracking records + flagged fallback places) to
        // this prefix's already-imported orders. No vendor fetch, no watermark change.
        // Touches only rows carrying this integration's ownership markers.
        $stage = 'backfill_display';
        if (($options['confirm-backfill'] ?? null) !== $prefix) {
            throw new RuntimeException('backfill_confirmation_guard');
        }
        $writer = new FleetbaseWriter($prefix);
        $result = $writer->backfillDisplay();
        safeLog('backfill_display', $result);
        safeLog('verification', $writer->verificationResult() ?? ['passed' => false]);
        releaseLock($lockName);
        exit(0);
    }

    if ($deliveryDate === null && getenv('NUTREEZE_ALLOW_LEGACY_INCREMENTAL') !== '1') {
        throw new RuntimeException('legacy_incremental_disabled');
    }

    $stage = 'configuration';
    $limit = (int) ($options['limit'] ?? DEFAULT_LIMIT);
    if ($limit < 1 || $limit > 1000) {
        throw new RuntimeException('limit_invalid');
    }

    if (!isset($options['token-stdin'])) {
        throw new RuntimeException('vendor_token_stdin_required');
    }
    putenv('NUTREEZE_API_KEY');
    $tokenInput = (string) stream_get_contents(STDIN, 4097);
    if (strlen($tokenInput) > 4096) {
        throw new RuntimeException('vendor_token_too_long');
    }
    $token = trim($tokenInput);
    $tokenInput = null;
    if ($token === '') {
        throw new RuntimeException('vendor_token_missing');
    }

    if ($deliveryDate !== null) {
        $stage = 'daily_configuration';
        if (isset($options['meal-since'])) {
            throw new RuntimeException('daily_meal_since_obsolete');
        }
        $expectedCount = null;
        if (isset($options['expected-count'])) {
            $expectedRaw = (string) $options['expected-count'];
            if (!preg_match('/^(?:0|[1-9]\d{0,6})$/', $expectedRaw)) {
                throw new RuntimeException('daily_expected_count_invalid');
            }
            $expectedCount = (int) $expectedRaw;
        }
        $expectedDigest = null;
        if (isset($options['expected-digest'])) {
            $expectedDigest = strtolower((string) $options['expected-digest']);
            if (!preg_match('/^[a-f0-9]{64}$/', $expectedDigest)) {
                throw new RuntimeException('daily_expected_digest_invalid');
            }
        }

        $driverRosterPath = (string) ($options['driver-roster'] ?? '');
        $pickupConfigPath = (string) ($options['pickup-config'] ?? '');
        $partnerDriverMapPath = (string) ($options['partner-driver-map'] ?? '');
        if ($driverRosterPath === '' || $pickupConfigPath === '' || $partnerDriverMapPath === '') {
            throw new RuntimeException('daily_config_paths_required');
        }
        $stage = 'daily_driver_map';
        $drivers = loadPartnerDriverMap(
            $partnerDriverMapPath,
            $companyUuid,
            loadDriverRoster($driverRosterPath, $companyUuid),
        );

        $stage = 'daily_vendor_fetch';
        $fetched = (new VendorClient($token))->fetchDailySource($deliveryDate, $limit);
        $token = null;
        putenv('NUTREEZE_API_KEY');

        $stage = 'daily_contract_validation';
        $dailyRows = buildDailyDeliveryRows($fetched['delivery_rows'], $deliveryDate);
        $sourceDeclaredOrders = $fetched['daily_completeness']['distinct_orders'];
        if (count($dailyRows) !== $sourceDeclaredOrders) {
            throw new RuntimeException('vendor_daily_distinct_order_mismatch');
        }
        $driverOrdersMembership = null;
        if (isset($options['driver-orders-manifest'])) {
            $driverOrdersMembership = applyDriverOrdersMembership(
                $dailyRows,
                (string) $options['driver-orders-manifest'],
                $deliveryDate,
            );
            $dailyRows = $driverOrdersMembership['rows'];
        }
        $futureLimit = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->modify('+5 minutes');
        foreach ($dailyRows as $dailyRow) {
            if (parseTimestamp($dailyRow['updated_at'], 'updated_at') > $futureLimit
                || parseTimestamp($dailyRow['meal_updated_at'], 'meal_updated_at') > $futureLimit) {
                throw new RuntimeException('vendor_future_timestamp');
            }
        }
        // The manifest digest remains Partner-only. A capture or anchor change must never be
        // misrepresented as a changed Partner snapshot.
        $sourceDigest = dailySourceDigest($dailyRows);
        $stage = 'daily_driver_assignment';
        $partnerDriverAssignment = applyPartnerDriverAssignments($dailyRows, $drivers);
        $dailyRows = $partnerDriverAssignment['rows'];
        $locationCaptures = [];
        if ($allowLocationRecovery) {
            $locationCaptures = loadLocationCaptures((string) $options['location-captures']);
            $dailyRows = applyLocationRecoveryData($dailyRows, $locationCaptures);
        }
        $sourceRealPinCount = count(array_filter($dailyRows, fn (array $row): bool => $row['pin'] !== null));
        $recoveredPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => ($row['recovery_pin'] ?? null) !== null,
        ));
        $routableCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $heldCount = count($dailyRows) - $routableCount;
        $sourceMissingPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => sourcePinHoldReason($row) === 'no_real_location_pin',
        ));
        $sourceInvalidPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => sourcePinHoldReason($row) === 'invalid_source_location_pin',
        ));
        $addressCallCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowRequiresCustomerCall($row, $allowAddressCall),
        ));
        $heldNoPartnerDriverCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'no_partner_driver',
        ));
        $heldUnmappedPartnerDriverCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'unmapped_partner_driver',
        ));
        $partnerDriverLoads = allocateDailyDrivers($dailyRows, $drivers, $allowAddressCall)['loads'];
        $locationAreaFallbackCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )
                && resolveEffectivePin($row)['fallback_scope'] === 'area',
        ));
        $locationKnownStopAnchorCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => ($row['recovery_anchor'] ?? null) !== null,
        ));
        $locationCountryFallbackCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )
                && resolveEffectivePin($row)['fallback_scope'] === 'country',
        ));
        $locationCountryFallbackAreas = [];
        foreach ($dailyRows as $dailyRow) {
            if (in_array(
                dailyHoldReason($dailyRow),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            ) && resolveEffectivePin($dailyRow)['fallback_scope'] === 'country') {
                $locationCountryFallbackAreas[mb_strtolower(trim((string) $dailyRow['routing_area']))] = true;
            }
        }
        ksort($locationCountryFallbackAreas);
        $heldMissingPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'no_real_location_pin'
                && !rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $heldInvalidPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'invalid_source_location_pin'
                && !rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $unapprovedStatusCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'unapproved_meal_status',
        ));
        $unapprovedOrderStatusCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'unapproved_order_status',
        ));
        $sourceCanceledCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'source_order_canceled',
        ));
        $duplicateDeliveryRowsCollapsed = $fetched['delivery_response_rows'] - $sourceDeclaredOrders;
        safeLog('daily_source_summary', [
            'delivery_date' => $deliveryDate,
            'source_selector' => DAILY_SOURCE_SELECTOR,
            'source_endpoint' => '/integration/daily-deliveries',
            'delivery_pages' => $fetched['delivery_pages'],
            'delivery_response_rows' => $fetched['delivery_response_rows'],
            'source_declared_deliveries' => $fetched['daily_completeness']['deliveries'],
            'source_declared_distinct_orders' => $sourceDeclaredOrders,
            'source_declared_scheduled' => $fetched['daily_completeness']['scheduled'],
            'source_declared_on_hold' => $fetched['daily_completeness']['on_hold'],
            'source_declared_cancelled' => $fetched['daily_completeness']['cancelled'],
            'duplicate_delivery_rows_collapsed' => $duplicateDeliveryRowsCollapsed,
            'driver_orders_manifest_checked' => $driverOrdersMembership !== null,
            'driver_orders_manifest_count' => $driverOrdersMembership['count'] ?? null,
            'driver_orders_manifest_digest' => $driverOrdersMembership['digest'] ?? null,
            'api_only_orders_excluded' => $driverOrdersMembership['api_only_excluded'] ?? 0,
            'daily_orders' => count($dailyRows),
            'orders_with_real_pin' => $sourceRealPinCount,
            'orders_dispatchable' => $routableCount,
            'orders_dispatchable_real_pin' => $routableCount - $addressCallCount,
            'orders_dispatchable_partner_pin' => $sourceRealPinCount,
            'orders_dispatchable_saved_pin' => $recoveredPinCount,
            'orders_dispatchable_address_call' => $addressCallCount,
            'source_orders_missing_pin' => $sourceMissingPinCount,
            'source_orders_invalid_pin' => $sourceInvalidPinCount,
            'orders_location_area_fallback' => $locationAreaFallbackCount,
            'orders_location_known_stop_anchor' => $locationKnownStopAnchorCount,
            'orders_location_country_fallback_held' => $locationCountryFallbackCount,
            // General routing-area labels only; no customer identity, phone, or
            // detailed address is written to the operational log.
            'orders_location_country_fallback_areas' => array_keys($locationCountryFallbackAreas),
            'orders_held_missing_pin' => $heldMissingPinCount,
            'orders_held_invalid_pin' => $heldInvalidPinCount,
            'orders_held_unapproved_meal_status' => $unapprovedStatusCount,
            'orders_held_unapproved_order_status' => $unapprovedOrderStatusCount,
            'orders_held_source_canceled' => $sourceCanceledCount,
            'orders_held_no_partner_driver' => $heldNoPartnerDriverCount,
            'orders_held_unmapped_partner_driver' => $heldUnmappedPartnerDriverCount,
            // Driver identifiers only; never driver names or customer data.
            'partner_driver_map_count' => count($drivers),
            'partner_driver_ids_unmapped' => $partnerDriverAssignment['unmapped_partner_driver_ids'],
            'partner_driver_loads' => $partnerDriverLoads,
            'assignment_mode' => PARTNER_DRIVER_ASSIGNMENT_MODE,
            'address_call_override' => $allowAddressCall,
            'address_call_authorization' => $allowLocationRecovery
                ? LOCATION_RECOVERY_AUTHORIZATION
                : ($allowA19AddressCall ? ADDRESS_CALL_AUTHORIZATION : null),
            'approved_location_captures_loaded' => count($locationCaptures),
            'expected_count' => $expectedCount,
            'source_digest' => $sourceDigest,
            'expected_digest' => $expectedDigest,
            'manifest_checked' => $expectedCount !== null && $expectedDigest !== null,
            'reconciled' => $expectedCount !== null
                && $expectedDigest !== null
                && count($dailyRows) === $expectedCount
                && hash_equals($expectedDigest, $sourceDigest),
        ]);
        if ($expectedCount !== null && count($dailyRows) !== $expectedCount) {
            throw new RuntimeException('daily_expected_count_mismatch');
        }
        if ($expectedDigest !== null && !hash_equals($expectedDigest, $sourceDigest)) {
            throw new RuntimeException('daily_expected_digest_mismatch');
        }

        if (isset($options['dry-run'])) {
            safeLog('complete', [
                'dry_run' => true,
                'delivery_date' => $deliveryDate,
                'source_orders' => count($dailyRows),
                'fleetbase_written' => false,
            ]);
            releaseLock($lockName);
            exit(0);
        }
        if (isset($options['cancel-only'])) {
            // WP-OPS-07 (A50): daytime cancel-only reconciliation. Same manifest gate as a full
            // sync (dry-run count + digest), its own narrow writer, no operational-state preflight
            // because started jobs are skipped rather than rejected.
            $stage = 'daily_cancel_only';
            if (!hash_equals($deliveryDate, (string) $options['cancel-only'])) {
                throw new RuntimeException('daily_cancel_only_confirmation_guard');
            }
            if (isset($options['confirm-daily-sync']) || isset($options['confirm-zero-day'])) {
                throw new RuntimeException('daily_cancel_only_exclusive');
            }
            if ($expectedCount === null || $expectedDigest === null) {
                throw new RuntimeException('daily_source_manifest_required');
            }
            if ($allowAddressCall) {
                throw new RuntimeException('daily_cancel_only_no_address_call');
            }
            $withdrawalCandidates = count(array_filter(
                $dailyRows,
                fn (array $row): bool => dailyWithdrawalReason($row) !== null,
            ));
            $pickup = loadPickupConfig($pickupConfigPath);
            $withdrawWriter = new DailyDispatchWriter($prefix, $pickup, $drivers, false);
            $withdrawStats = $withdrawWriter->withdrawOnly($dailyRows);
            $withdrawVerification = $withdrawWriter->verificationResult() ?? ['passed' => false];
            safeLog('daily_withdraw_summary', [
                'delivery_date' => $deliveryDate,
                'mode' => 'cancel_only_v1',
                'source_orders' => count($dailyRows),
                'withdrawal_candidates' => $withdrawalCandidates,
            ] + $withdrawStats + ['verification' => $withdrawVerification]);
            if (($withdrawVerification['passed'] ?? false) !== true) {
                throw new RuntimeException('daily_withdraw_verification');
            }
            safeLog('complete', [
                'dry_run' => false,
                'delivery_date' => $deliveryDate,
                'mode' => 'cancel_only_v1',
                'source_orders' => count($dailyRows),
                'withdrawn_orders' => $withdrawStats['orders_withdrawn_canceled'] + $withdrawStats['orders_withdrawn_on_hold'],
                'blocked_started' => $withdrawStats['orders_withdraw_blocked_started'],
                'verified' => true,
                'watermark_committed' => false,
            ]);
            releaseLock($lockName);
            exit(0);
        }
        if ($allowAddressCall && $locationCountryFallbackCount > 0) {
            // A57: unmapped areas no longer abort the run; they are call-dispatched on the
            // country centroid and reported here so AREA_FALLBACK_CENTROIDS can be extended.
            safeLog('daily_address_call_unknown_area', [
                'delivery_date' => $deliveryDate,
                'orders' => $locationCountryFallbackCount,
                'areas' => array_keys($locationCountryFallbackAreas),
            ]);
        }
        if (!isset($options['confirm-daily-sync'])
            || !hash_equals($deliveryDate, (string) $options['confirm-daily-sync'])) {
            throw new RuntimeException('daily_confirmation_guard');
        }
        if ($expectedCount === null || $expectedDigest === null) {
            throw new RuntimeException('daily_source_manifest_required');
        }
        if ($dailyRows === []) {
            if (!isset($options['confirm-zero-day'])
                || !hash_equals($deliveryDate, (string) $options['confirm-zero-day'])) {
                throw new RuntimeException('daily_zero_day_confirmation_required');
            }
            $existingCount = Order::withoutGlobalScopes()
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-ORDER-%')
                ->whereNull('deleted_at')
                ->count();
            if ($existingCount !== 0) {
                throw new RuntimeException('daily_zero_source_existing_orders');
            }
            safeLog('daily_verification', [
                'passed' => true,
                'source_orders' => 0,
                'fleetbase_orders' => 0,
                'unexplained_orders' => 0,
                'duplicate_internal_ids' => 0,
            ]);
            safeLog('complete', [
                'dry_run' => false,
                'delivery_date' => $deliveryDate,
                'source_orders' => 0,
                'assigned_orders' => 0,
                'held_orders' => 0,
                'verified' => true,
                'watermark_committed' => false,
            ]);
            releaseLock($lockName);
            exit(0);
        }
        $pickup = loadPickupConfig($pickupConfigPath);
        guardDailyOperationalRows($prefix, $dailyRows, $drivers, $companyUuid, $allowAddressCall);
        $baseRows = dailyRowsForBaseWriter($dailyRows);

        $stage = 'daily_fleetbase_transaction';
        $dailyWrite = DB::transaction(function () use (
            &$stage,
            $prefix,
            $dailyRows,
            $baseRows,
            $pickup,
            $drivers,
            $allowAddressCall,
        ): array {
            $stage = 'daily_fleetbase_upsert';
            $writer = new FleetbaseWriter($prefix, $allowAddressCall);
            $writeStats = $writer->upsert($baseRows, $baseRows);

            $stage = 'daily_dispatch';
            $dispatchWriter = new DailyDispatchWriter($prefix, $pickup, $drivers, $allowAddressCall);
            $dispatchStats = $dispatchWriter->apply($dailyRows, true);
            return [
                'write_stats' => $writeStats,
                'base_verification' => $writer->verificationResult() ?? ['passed' => false],
                'dispatch_stats' => $dispatchStats,
                'daily_verification' => $dispatchWriter->verificationResult() ?? ['passed' => false],
            ];
        }, 1);
        safeLog('write_summary', $dailyWrite['write_stats']);
        safeLog('base_verification', $dailyWrite['base_verification']);
        safeLog('dispatch_summary', $dailyWrite['dispatch_stats']);
        safeLog('daily_verification', $dailyWrite['daily_verification']);
        $stage = 'daily_cache_invalidation';
        safeLog('cache_invalidation', invalidateDailyCaches($prefix, $companyUuid));
        safeLog('complete', [
            'dry_run' => false,
            'delivery_date' => $deliveryDate,
            'source_orders' => count($dailyRows),
            'assigned_orders' => $routableCount,
            'held_orders' => $heldCount,
            'verified' => true,
            'watermark_committed' => false,
        ]);
        releaseLock($lockName);
        exit(0);
    }

    $store = new WatermarkStore($statePath);
    $storedWatermark = $store->read();
    $explicitSince = isset($options['since']) ? (string) $options['since'] : null;
    $since = (string) ($explicitSince ?? $storedWatermark ?? getenv('NUTREEZE_INITIAL_SINCE') ?: '');
    if ($since === '') {
        throw new RuntimeException('initial_since_required');
    }
    $sinceTime = parseTimestamp($since, 'since');
    if ($storedWatermark !== null && $explicitSince !== null && $explicitSince !== $storedWatermark) {
        $confirmedTestOverride = getenv('NUTREEZE_TEST_MODE') === '1'
            && isset($options['confirm-since-override'])
            && hash_equals($explicitSince, (string) $options['confirm-since-override']);
        if (!$confirmedTestOverride) {
            throw new RuntimeException('since_override_guard');
        }
    }

    $failAfterPage = isset($options['fail-after-page']) ? (int) $options['fail-after-page'] : null;
    $failBeforeWatermark = isset($options['fail-before-watermark']);
    if (($failAfterPage !== null || $failBeforeWatermark) && getenv('NUTREEZE_TEST_MODE') !== '1') {
        throw new RuntimeException('failure_injection_guard');
    }

    $stage = 'vendor_fetch';
    $fetched = (new VendorClient($token))->fetchAll($since, $limit, $failAfterPage);
    $token = null;
    putenv('NUTREEZE_API_KEY');

    $stage = 'contract_validation';
    $deduplicated = deduplicateRows($fetched['rows']);
    $futureLimit = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->modify('+5 minutes');
    foreach ($deduplicated as $row) {
        $rowTime = parseTimestamp($row['updated_at'], 'updated_at');
        if ($rowTime < $sinceTime) {
            throw new RuntimeException('vendor_since_violation');
        }
        if ($rowTime > $futureLimit) {
            throw new RuntimeException('vendor_future_timestamp');
        }
    }
    $eligible = array_values(array_filter($deduplicated, fn (array $row): bool => in_array($row['status'], ['success', 'pending'], true)));
    $canceled = count($deduplicated) - count($eligible);
    $nextWatermark = maxUpdatedAt($deduplicated);
    safeLog('source_summary', [
        'pages' => $fetched['pages'],
        'response_rows' => count($fetched['rows']),
        'deduplicated_rows' => count($deduplicated),
        'eligible_rows' => count($eligible),
        'cancels_skipped' => $canceled,
        'watermark_before' => $since,
        'watermark_candidate' => $nextWatermark,
    ]);

    if (isset($options['dry-run'])) {
        safeLog('complete', ['dry_run' => true, 'watermark_committed' => false]);
        releaseLock($lockName);
        exit(0);
    }

    $stage = 'fleetbase_upsert';
    $writer = new FleetbaseWriter($prefix);
    $writeStats = $writer->upsert($eligible, isset($options['verify']) ? $deduplicated : null);
    safeLog('write_summary', $writeStats);

    if (isset($options['verify'])) {
        safeLog('verification', $writer->verificationResult() ?? ['passed' => false]);
    }

    if ($failBeforeWatermark) {
        throw new RuntimeException('test_failure_before_watermark');
    }

    $stage = 'watermark_commit';
    if ($nextWatermark !== null) {
        $store->write($nextWatermark);
    }
    safeLog('complete', [
        'dry_run' => false,
        'watermark_committed' => $nextWatermark !== null,
        'watermark_after' => $nextWatermark ?? $since,
    ]);
    releaseLock($lockName);
    exit(0);
} catch (Throwable $exception) {
    $token = null;
    putenv('NUTREEZE_API_KEY');
    $errorCode = $exception instanceof RuntimeException && preg_match('/^[a-z0-9_]+$/', $exception->getMessage())
        ? $exception->getMessage()
        : 'internal_error';
    safeLog('fatal', [
        'stage' => $stage,
        'error_class' => (new ReflectionClass($exception))->getShortName(),
        'error_code' => $errorCode,
    ]);
    releaseLock($lockName);
    exit(1);
}
