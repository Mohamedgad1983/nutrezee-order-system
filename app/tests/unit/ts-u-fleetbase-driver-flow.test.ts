import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// TS-U guard for A61: the Transport driver flow (Start → Delivered | not-delivered reason →
// retry | returned to kitchen) and the daily closure rule that keeps non-delivery honest.
const root = join(__dirname, '..', '..', '..', 'ops', 'fleetbase', 'driver-flow', 'a61');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

type Activity = {
  key: string;
  code: string;
  status: string;
  complete: boolean;
  logic: unknown[];
  events: unknown[];
  activities: string[];
  require_pod: boolean;
};

describe('TS-U fleetbase driver flow a61', () => {
  const flow = JSON.parse(read('transport.flow.json')) as Record<string, Activity>;
  const keys = Object.keys(flow);
  const reasons = keys.filter((k) => k.startsWith('nd_'));

  it('keeps the lifecycle and offers one decision after start', () => {
    expect(flow.created.activities).toEqual(['dispatched']);
    expect(flow.dispatched.activities).toEqual(['started']);
    expect(flow.started.activities[0]).toBe('completed');
    expect(flow.started.activities.slice(1)).toEqual(reasons);
    expect(keys).not.toContain('enroute');
    expect(reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('models not-delivered as an open state with retry or return', () => {
    for (const key of reasons) {
      expect(flow[key].code).toBe('not_delivered');
      expect(flow[key].complete).toBe(false);
      expect(flow[key].activities).toEqual(['completed', 'returned_to_kitchen']);
      expect(flow[key].status).toMatch(/^Not delivered — .+ \/ .+/u);
    }
    expect(flow.returned_to_kitchen.code).toBe('returned_to_kitchen');
    expect(flow.returned_to_kitchen.complete).toBe(false);
    expect(flow.returned_to_kitchen.activities).toEqual([]);
  });

  it('has exactly one completing activity, no logic/events, no forced proof, and no dangling child', () => {
    expect(keys.filter((k) => flow[k].complete)).toEqual(['completed']);
    for (const key of keys) {
      expect(flow[key].key).toBe(key);
      expect(flow[key].logic).toEqual([]);
      expect(flow[key].events).toEqual([]);
      expect(flow[key].require_pod).toBe(false);
      for (const child of flow[key].activities) expect(keys).toContain(child);
    }
  });

  it('closure script maps every open status to an honest terminal state', () => {
    const script = read('nutreeze-complete-past-orders.php');
    expect(script).toMatch(/'dispatched'\s*=> \['completed', 'COMPLETED'/);
    expect(script).toMatch(/'started'\s*=> \['completed', 'COMPLETED', .*'a61_started_not_completed'/);
    expect(script).toMatch(/'not_delivered'\s*=> \['expired', 'EXPIRED'/);
    expect(script).toMatch(/'returned_to_kitchen'\s*=> \['expired', 'EXPIRED'/);
    expect(script).toContain("->whereIn('status', array_keys(RULES))");
    expect(script).toContain("--confirm=NUTREEZE");
    const wrapper = read('run-daily-completion.sh');
    expect(wrapper).toContain("status IN ('dispatched','started','not_delivered','returned_to_kitchen')");
    expect(wrapper).toContain('--apply --confirm=NUTREEZE');
  });

  it('apply script validates before writing and requires explicit confirmation', () => {
    const apply = read('apply-transport-flow.php');
    expect(apply).toContain("if ($completeKeys !== ['completed'])");
    expect(apply).toContain('unreachable from created');
    expect(apply).toContain("in_array('--confirm=NUTREEZE', $argv, true)");
    expect(apply.indexOf('invalid_flow')).toBeLessThan(apply.indexOf("require '/fleetbase/api/vendor/autoload.php'"));
  });
});

describe('TS-U fleetbase driver flow a61.2 polish', () => {
  it('keeps activity titles short enough for the Navigator sheet and clears the driver current job on close', () => {
    const flow = JSON.parse(readFileSync(join(root, 'transport.flow.json'), 'utf8')) as Record<string, { status: string }>;
    for (const key of Object.keys(flow)) expect(flow[key].status.length).toBeLessThanOrEqual(48);
    const script = readFileSync(join(root, 'nutreeze-complete-past-orders.php'), 'utf8');
    expect(script).toContain("->where('current_job_uuid', $order->uuid)");
    expect(script).toContain("'current_job_cleared' => 0");
  });
});
