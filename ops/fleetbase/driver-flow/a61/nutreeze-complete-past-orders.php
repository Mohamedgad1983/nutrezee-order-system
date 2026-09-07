#!/usr/bin/env php
<?php
declare(strict_types=1);
/**
 * A29 + A61 — close past-day orders (root fix for the never-closing lifecycle).
 *
 * Three closure rules, all limited to orders whose DATE(scheduled_at) is strictly before
 * --before (Kuwait "today"):
 *
 *   dispatched            -> completed  (A29: untouched by the driver; transitional rule, tagged)
 *   started               -> completed  (A61: driver started but never closed; tagged separately)
 *   not_delivered /
 *   returned_to_kitchen   -> expired    (A61: driver reported non-delivery; closed WITHOUT delivery,
 *                                        keeps the NOT_DELIVERED / RETURNED_TO_KITCHEN history rows)
 *
 * Per order: insert ONE tracking_statuses row (COMPLETED or EXPIRED, meta carries the tag), point
 * tracking_numbers.status_uuid at it, set orders.status. Idempotent: an existing row with the same
 * code on the tracking number is reused; already-closed orders leave the scope by themselves.
 * Native events/webhooks are deliberately not fired (mirrors nutreeze-orders.php conventions).
 *
 * Usage:
 *   php nutreeze-complete-past-orders.php --before=YYYY-MM-DD             # dry-run
 *   php nutreeze-complete-past-orders.php --before=YYYY-MM-DD --limit=20 --apply --confirm=NUTREEZE
 */
use Fleetbase\FleetOps\Models\Contact;
use Fleetbase\FleetOps\Models\Order;
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

const COMPANY_UUID = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c';
const CHUNK = 500;
/** status -> [target status, tracking code, tracking status text, details, backfill tag] */
const RULES = [
    'dispatched'          => ['completed', 'COMPLETED', 'Order Completed', 'Order has been completed.', 'a29_complete_past_orders'],
    'started'             => ['completed', 'COMPLETED', 'Order Completed', 'Closed by the daily rule: started by the driver but never completed.', 'a61_started_not_completed'],
    'not_delivered'       => ['expired', 'EXPIRED', 'Closed without delivery / أُقفل بدون تسليم', 'Closed by the daily rule after a not-delivered report.', 'a61_not_delivered_closed'],
    'returned_to_kitchen' => ['expired', 'EXPIRED', 'Closed without delivery / أُقفل بدون تسليم', 'Closed by the daily rule after return to kitchen.', 'a61_returned_closed'],
];

$apply = in_array('--apply', $argv, true);
$confirmed = in_array('--confirm=NUTREEZE', $argv, true);
$before = null;
$limit = null;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--before=')) {
        $before = substr($arg, 9);
    }
    if (str_starts_with($arg, '--limit=')) {
        $limit = (int) substr($arg, 8);
    }
}
if ($before === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $before)) {
    fwrite(STDERR, "--before=YYYY-MM-DD is required (stay-open boundary, Kuwait today)\n");
    exit(1);
}

$emit = static function (array $payload): void {
    fwrite(STDOUT, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
};

$scope = static fn () => DB::table('orders')
    ->where('company_uuid', COMPANY_UUID)
    ->whereNull('deleted_at')
    ->whereIn('status', array_keys(RULES))
    ->whereNotNull('scheduled_at')
    ->whereRaw('DATE(scheduled_at) < ?', [$before]);

$total = $scope()->count();
$byStatus = $scope()->selectRaw('status, COUNT(*) AS c')->groupBy('status')->pluck('c', 'status');
$byDay = $scope()->selectRaw('DATE(scheduled_at) AS d, COUNT(*) AS c')->groupBy('d')->orderByDesc('d')->limit(8)->get();
$priorBackfillRows = DB::table('tracking_statuses')
    ->whereIn('code', ['COMPLETED', 'EXPIRED'])
    ->whereNotNull('meta->backfill')
    ->count();

$emit([
    'event'               => 'scope',
    'before'              => $before,
    'orders_in_scope'     => $total,
    'by_status'           => $byStatus,
    'prior_backfill_rows' => $priorBackfillRows,
    'latest_days'         => $byDay,
    'mode'                => $apply ? 'APPLY' : 'dry-run',
    'limit'               => $limit,
]);

if (!$apply) {
    $emit(['event' => 'dry_run_done', 'would_close' => $limit !== null ? min($limit, $total) : $total]);
    exit(0);
}
if (!$confirmed) {
    fwrite(STDERR, "--apply requires --confirm=NUTREEZE\n");
    exit(1);
}

$now = date('Y-m-d H:i:s');
$stats = ['closed' => 0, 'completed' => 0, 'expired' => 0, 'status_rows_inserted' => 0, 'status_rows_reused' => 0, 'no_tracking_number' => 0, 'current_job_cleared' => 0];
$touchedOrderUuids = [];

$query = $scope()->select(['uuid', 'status', 'tracking_number_uuid'])->orderBy('uuid');
if ($limit !== null) {
    $query->limit($limit);
}
$rows = $query->get();

foreach ($rows->chunk(CHUNK) as $chunk) {
    DB::transaction(static function () use ($chunk, $before, $now, &$stats, &$touchedOrderUuids): void {
        foreach ($chunk as $order) {
            [$targetStatus, $code, $statusText, $details, $tag] = RULES[$order->status];
            $meta = json_encode([
                'backfill'    => $tag,
                'rule'        => 'scheduled-day-passed',
                'from_status' => $order->status,
                'before'      => $before,
                'applied_at'  => $now,
            ]);
            if ($order->tracking_number_uuid !== null) {
                $statusUuid = DB::table('tracking_statuses')
                    ->where('tracking_number_uuid', $order->tracking_number_uuid)
                    ->where('code', $code)
                    ->whereNull('deleted_at')
                    ->value('uuid');
                if ($statusUuid === null) {
                    $statusUuid = TrackingStatus::generateUuid();
                    DB::table('tracking_statuses')->insert([
                        'uuid'                 => $statusUuid,
                        'public_id'            => TrackingStatus::generatePublicId('status'),
                        '_key'                 => 'console',
                        'company_uuid'         => COMPANY_UUID,
                        'tracking_number_uuid' => $order->tracking_number_uuid,
                        'meta'                 => $meta,
                        'status'               => $statusText,
                        'details'              => $details,
                        'code'                 => $code,
                        'complete'             => $targetStatus === 'completed' ? 1 : 0,
                        'location'             => FleetOpsUtils::parsePointToWkt(new Point(0, 0)),
                        'created_at'           => $now,
                    ]);
                    $stats['status_rows_inserted']++;
                } else {
                    $stats['status_rows_reused']++;
                }
                DB::table('tracking_numbers')
                    ->where('uuid', $order->tracking_number_uuid)
                    ->update(['status_uuid' => $statusUuid]);
            } else {
                $stats['no_tracking_number']++;
            }
            DB::table('orders')->where('uuid', $order->uuid)
                ->update(['status' => $targetStatus, 'updated_at' => $now]);
            // A61: a non-completing close never ran Driver::unassignCurrentOrder(); clear it here.
            $stats['current_job_cleared'] += DB::table('drivers')
                ->where('current_job_uuid', $order->uuid)
                ->update(['current_job_uuid' => null]);
            $stats['closed']++;
            $stats[$targetStatus]++;
            $touchedOrderUuids[] = $order->uuid;
        }
    });
    $emit(['event' => 'progress'] + $stats);
}

// The silent write path skips Eloquent observers, so perform their cache
// invalidation explicitly — same recipe as nutreeze-orders.php.
$previousCompany = session('company');
try {
    session(['company' => COMPANY_UUID]);
    LiveCacheService::invalidateMultiple([
        'orders', 'routes', 'coordinates', 'drivers', 'places', 'operations-monitor',
    ]);
    foreach ([Order::class, Payload::class, Contact::class, Place::class, TrackingNumber::class, TrackingStatus::class] as $modelClass) {
        ApiModelCache::invalidateModelCache(new $modelClass(), COMPANY_UUID);
    }
    ResponseCache::clear();
    foreach ($touchedOrderUuids as $uuid) {
        Cache::forget('order:' . $uuid . ':tracker');
    }
} finally {
    session(['company' => $previousCompany]);
}

$emit(['event' => 'apply_done'] + $stats);
