#!/usr/bin/env php
<?php
declare(strict_types=1);
/**
 * A61 — replace the Transport order-config flow (driver activities) from transport.flow.json.
 *
 * Runs inside the fleetbase application container. Dry-run by default: prints the current and
 * the proposed flow keys and exits. Writes only with `--apply --confirm=NUTREEZE`.
 *
 *   php apply-transport-flow.php --flow=/path/transport.flow.json                    # dry-run
 *   php apply-transport-flow.php --flow=/path/transport.flow.json --apply --confirm=NUTREEZE
 */
use Fleetbase\FleetOps\Models\OrderConfig;
use Fleetbase\FleetOps\Support\LiveCacheService;
use Fleetbase\Support\ApiModelCache;
use Illuminate\Contracts\Console\Kernel;
use Spatie\ResponseCache\Facades\ResponseCache;

ini_set('display_errors', '0');
error_reporting(E_ALL);

const COMPANY_UUID = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c';
const ORDER_CONFIG_PUBLIC_ID = 'order_config_zYjt2qXcAX'; // Transport
const REQUIRED_FIELDS = ['key', 'code', 'status', 'details', 'activities', 'complete', 'logic', 'events', 'internalId'];

$emit = static function (array $payload): void {
    fwrite(STDOUT, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
};

$apply = in_array('--apply', $argv, true);
$confirmed = in_array('--confirm=NUTREEZE', $argv, true);
$flowPath = null;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--flow=')) {
        $flowPath = substr($arg, 7);
    }
}
if ($flowPath === null || !is_file($flowPath)) {
    fwrite(STDERR, "--flow=<transport.flow.json> is required\n");
    exit(1);
}
$flow = json_decode((string) file_get_contents($flowPath), true);
if (!is_array($flow) || $flow === []) {
    fwrite(STDERR, "flow file is not a JSON object\n");
    exit(1);
}

// Structural validation before anything touches the database.
$errors = [];
$completeKeys = [];
foreach ($flow as $key => $activity) {
    foreach (REQUIRED_FIELDS as $field) {
        if (!array_key_exists($field, $activity)) {
            $errors[] = "$key: missing $field";
        }
    }
    if (($activity['key'] ?? null) !== $key) {
        $errors[] = "$key: key mismatch";
    }
    foreach ($activity['activities'] ?? [] as $child) {
        if (!isset($flow[$child])) {
            $errors[] = "$key: unknown child $child";
        }
    }
    if (!empty($activity['complete'])) {
        $completeKeys[] = $key;
    }
    if (!empty($activity['logic']) || !empty($activity['events'])) {
        $errors[] = "$key: logic/events must stay empty in this unit";
    }
}
foreach (['created', 'dispatched', 'started', 'completed'] as $must) {
    if (!isset($flow[$must]) || $flow[$must]['code'] !== $must) {
        $errors[] = "required lifecycle activity $must missing or code changed";
    }
}
if ($completeKeys !== ['completed']) {
    $errors[] = 'exactly one completing activity (completed) is allowed, got ' . implode(',', $completeKeys);
}
// every activity must be reachable from created
$seen = ['created' => true];
$queue = ['created'];
while ($queue) {
    $k = array_shift($queue);
    foreach ($flow[$k]['activities'] ?? [] as $child) {
        if (!isset($seen[$child])) {
            $seen[$child] = true;
            $queue[] = $child;
        }
    }
}
foreach (array_keys($flow) as $key) {
    if (!isset($seen[$key])) {
        $errors[] = "$key: unreachable from created";
    }
}
if ($errors) {
    $emit(['event' => 'invalid_flow', 'errors' => $errors]);
    exit(1);
}

try {
    require '/fleetbase/api/vendor/autoload.php';
    $app = require '/fleetbase/api/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
} catch (Throwable) {
    $emit(['event' => 'fatal', 'stage' => 'bootstrap']);
    exit(1);
}

$config = OrderConfig::withoutGlobalScopes()
    ->where('company_uuid', COMPANY_UUID)
    ->where('public_id', ORDER_CONFIG_PUBLIC_ID)
    ->whereNull('deleted_at')
    ->first();
if (!$config) {
    $emit(['event' => 'fatal', 'stage' => 'order_config_not_found']);
    exit(1);
}
$current = is_array($config->flow) ? $config->flow : (json_decode((string) $config->flow, true) ?: []);
$summary = static fn (array $f): array => array_map(
    static fn (array $a): array => ['code' => $a['code'], 'complete' => (bool) ($a['complete'] ?? false), 'next' => $a['activities'] ?? []],
    $f,
);
$emit([
    'event'    => 'plan',
    'config'   => $config->public_id,
    'name'     => $config->name,
    'current'  => $summary($current),
    'proposed' => $summary($flow),
    'mode'     => $apply ? 'APPLY' : 'dry-run',
]);
if (!$apply) {
    exit(0);
}
if (!$confirmed) {
    fwrite(STDERR, "--apply requires --confirm=NUTREEZE\n");
    exit(1);
}

$config->flow = $flow;
$config->save();

$previousCompany = session('company');
try {
    session(['company' => COMPANY_UUID]);
    ApiModelCache::invalidateModelCache(new OrderConfig(), COMPANY_UUID);
    LiveCacheService::invalidateMultiple(['orders', 'operations-monitor']);
    ResponseCache::clear();
} finally {
    session(['company' => $previousCompany]);
}
$fresh = OrderConfig::withoutGlobalScopes()->where('uuid', $config->uuid)->first();
$storedKeys = array_keys(is_array($fresh->flow) ? $fresh->flow : json_decode((string) $fresh->flow, true));
$emit(['event' => 'applied', 'config' => $config->public_id, 'stored_keys' => $storedKeys]);
