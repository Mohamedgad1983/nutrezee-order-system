#!/usr/bin/env php
<?php
declare(strict_types=1);
/**
 * A61 — read-only check of what Navigator will be offered as "next activity" for each order
 * status under the live Transport config. Uses unsaved Order instances; writes nothing.
 */
use Fleetbase\FleetOps\Models\Order;
use Fleetbase\FleetOps\Models\OrderConfig;
use Illuminate\Contracts\Console\Kernel;

ini_set('display_errors', '0');
require '/fleetbase/api/vendor/autoload.php';
$app = require '/fleetbase/api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$config = OrderConfig::withoutGlobalScopes()
    ->where('company_uuid', '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c')
    ->where('public_id', 'order_config_zYjt2qXcAX')
    ->first();
$out = ['config' => $config->public_id, 'keys' => array_keys($config->flow), 'next' => []];
foreach (['created', 'dispatched', 'started', 'not_delivered', 'returned_to_kitchen', 'completed'] as $status) {
    $order = new Order();
    $order->status = $status;
    $order->setRelation('orderConfig', $config);
    $out['next'][$status] = $config->nextActivity($order)
        ->map(static fn ($a): string => $a->get('key') . ':' . $a->get('code') . (($a->complete()) ? ':complete' : ''))
        ->values()->all();
}
$out['getters'] = [
    'started'   => $config->getStartedActivity()?->get('key'),
    'completed' => $config->getCompletedActivity()?->get('key'),
    'canceled'  => $config->getCanceledActivity()?->get('key'),
];
fwrite(STDOUT, json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
