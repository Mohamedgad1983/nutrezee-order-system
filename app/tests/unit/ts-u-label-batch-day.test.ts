import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { CollectionError, CollectionService } from '../../apps/api/src/modules/m25-label/collection.service';

// A54 — the Fleet-Ops Batch Labels page prints a chosen delivery day. The server's Kuwait date
// anchors a fixed window (yesterday … +7 days); the client can never widen it.

function service(today: string): CollectionService {
  return new CollectionService(
    {} as unknown as Pool,
    {} as never,
    {} as never,
    {} as never,
    async () => today,
  );
}

async function errorOf(promise: Promise<unknown>): Promise<CollectionError> {
  try {
    await promise;
  } catch (e) {
    return e as CollectionError;
  }
  throw new Error('expected rejection');
}

describe('TS-U A54 batch delivery-day window', () => {
  it('defaults to the Kuwait date and reports the window', async () => {
    const day = await service('2026-09-05').batchDay();
    expect(day).toEqual({ deliveryDate: '2026-09-05', today: '2026-09-05', from: '2026-09-04', to: '2026-09-12' });
    expect((await service('2026-09-05').batchDay('   ')).deliveryDate).toBe('2026-09-05');
  });

  it('accepts tomorrow for the Saturday-night Sunday run and the edges of the window', async () => {
    const svc = service('2026-09-05');
    expect((await svc.batchDay('2026-09-06')).deliveryDate).toBe('2026-09-06');
    expect((await svc.batchDay('2026-09-04')).deliveryDate).toBe('2026-09-04');
    expect((await svc.batchDay('2026-09-12')).deliveryDate).toBe('2026-09-12');
  });

  it('crosses month and year boundaries without drift', async () => {
    expect((await service('2026-12-30').batchDay()).to).toBe('2027-01-06');
    expect((await service('2026-03-01').batchDay()).from).toBe('2026-02-28');
  });

  it('refuses dates outside the window as forbidden, naming the window', async () => {
    const error = await errorOf(service('2026-09-05').batchDay('2026-09-13'));
    expect(error).toBeInstanceOf(CollectionError);
    expect(error.code).toBe('forbidden');
    expect(error.detail).toMatchObject({ reason: 'delivery_date_out_of_window', from: '2026-09-04', to: '2026-09-12' });
    expect((await errorOf(service('2026-09-05').batchDay('2026-09-03'))).code).toBe('forbidden');
  });

  it('refuses malformed or impossible dates as validation failures', async () => {
    for (const bad of ['05-09-2026', '2026-9-5', '2026-02-30', 'tomorrow']) {
      expect((await errorOf(service('2026-09-05').batchDay(bad))).code).toBe('validation_failed');
    }
  });
});
