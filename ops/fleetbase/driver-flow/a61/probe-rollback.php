<?php
// A61 — model-path check on a real order inside a rolled-back transaction (no persistent write).
use Fleetbase\FleetOps\Models\Order;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
require '/fleetbase/api/vendor/autoload.php';
$app = require '/fleetbase/api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
session(['company' => '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c']);
$o = Order::withoutGlobalScopes()->where('internal_id', $argv[1] ?? 'NUTREEZE-PARTNER-DAY-20260907-ORDER-27789')->first();
$cfg = $o->config();
$out = ['before' => $o->status];
DB::beginTransaction();
try {
    $o->started = true; $o->started_at = now(); $o->save();
    $o->updateActivity($cfg->getStartedActivity());
    $out['after_start'] = [$o->fresh()->status, $cfg->nextActivity($o->fresh())->map(fn ($a) => $a->get('key'))->all()];
    $nd = $cfg->nextActivity($o->fresh())->firstWhere('key', 'nd_no_bin');
    $out['nd_completes_order'] = $nd->completesOrder();
    $o->updateActivity($nd);
    $f = $o->fresh();
    $out['after_nd'] = [$f->status, $cfg->nextActivity($f)->map(fn ($a) => $a->get('key'))->all()];
    $out['tracking_rows'] = DB::table('tracking_statuses')->where('tracking_number_uuid', $o->tracking_number_uuid)->orderBy('created_at')->pluck('code')->all();
    $o->updateActivity($cfg->nextActivity($f)->firstWhere('key', 'returned_to_kitchen'));
    $out['after_return'] = [$o->fresh()->status, $cfg->nextActivity($o->fresh())->count()];
} finally {
    DB::rollBack();
    Cache::forget('order:' . $o->uuid . ':tracker');
}
$out['after_rollback'] = Order::withoutGlobalScopes()->where('uuid', $o->uuid)->first(['status', 'started'])->only(['status', 'started']);
$out['tracking_after_rollback'] = DB::table('tracking_statuses')->where('tracking_number_uuid', $o->tracking_number_uuid)->pluck('code')->all();
echo json_encode($out, JSON_UNESCAPED_UNICODE), "\n";
