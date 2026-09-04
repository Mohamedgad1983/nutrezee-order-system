import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { OrderController } from '../../apps/api/src/modules/m03-orders/order.controller';
import type { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { AuthError, type SessionService, type StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(orders: Partial<OrderService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
    visibilityGrants: vi.fn().mockResolvedValue(new Set(['pii', 'health', 'payment'])),
  } as unknown as AccessService;
  return new OrderController(sessions, access, orders as OrderService);
}

describe('TS-C API contract — orders controller (WP-09)', () => {
  it('blocks order list reads without a valid session', async () => {
    const c = controllerWith({ listOrdersRich: vi.fn() });
    await expect(c.list({ cookies: {} } as unknown as Request)).rejects.toBeInstanceOf(UnauthorizedException);

    const sessions = { validate: vi.fn().mockRejectedValue(new AuthError('expired')) } as unknown as SessionService;
    const access = {
      decide: vi.fn(),
      visibilityGrants: vi.fn(),
    } as unknown as AccessService;
    const expired = new OrderController(sessions, access, { listOrdersRich: vi.fn() } as unknown as OrderService);
    await expect(expired.list(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates an order from an approved draft using POST /orders', async () => {
    const createFromApprovedDraft = vi.fn().mockResolvedValue({ id: 'order-1', replay: false });
    const c = controllerWith({ createFromApprovedDraft });
    await expect(c.createFromDraft(req, { draft_id: 'draft-1' })).resolves.toEqual({ id: 'order-1', replay: false });
    expect(createFromApprovedDraft).toHaveBeenCalledWith(ctx, 'draft-1');
  });

  it('requires draft_id on order creation', async () => {
    const c = controllerWith({ createFromApprovedDraft: vi.fn() });
    await expect(c.createFromDraft(req, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps list and fulfillment-day reads to read contracts', async () => {
    const listOrdersRich = vi.fn().mockResolvedValue({ rows: [{ id: 'order-1' }], total: 1 });
    const listDays = vi.fn().mockResolvedValue([{ id: 'day-1' }]);
    const c = controllerWith({ listOrdersRich, listDays });
    await expect(c.list(req, 'approved', 'NUT', 'cust-1', '25', '10')).resolves.toEqual({
      items: [{ id: 'order-1', masked: false }],
      page: { limit: 25, offset: 10, total: 1 },
    });
    await expect(c.listDays(req, 'order-1')).resolves.toEqual({ items: [{ id: 'day-1' }], page: { limit: 100 } });
    expect(listOrdersRich).toHaveBeenCalledWith({ status: 'approved', q: 'NUT', customerId: 'cust-1', limit: 25, offset: 10 });
    expect(listDays).toHaveBeenCalledWith('order-1');
  });

  it('masks order list PII and payment fields when grants are absent', async () => {
    const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
    const access = {
      decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
      visibilityGrants: vi.fn().mockResolvedValue(new Set<string>()),
    } as unknown as AccessService;
    const listOrdersRich = vi.fn().mockResolvedValue({
      rows: [{
        id: 'order-1',
        customer_name: 'Private Customer',
        customer_phone: '+96550000000',
        total: 12345,
      }],
      total: 1,
    });
    const c = new OrderController(sessions, access, { listOrdersRich } as unknown as OrderService);
    const res = await c.list(req);
    expect(res.items[0].customer_name).not.toBe('Private Customer');
    expect(res.items[0].customer_phone).not.toBe('+96550000000');
    expect(res.items[0].total).not.toBe(12345);
    expect(res.items[0].masked).toBe(true);
  });

  it('lists exceptions with the state filter and returns the read contract', async () => {
    const listExceptions = vi.fn().mockResolvedValue([
      { id: 'ex-1', type_code: 'other', order_id: 'order-1', refs: { order_id: 'order-1' }, severity: 'high', state: 'open', owner_id: 'ops-1', resolution_code: null, notes: 'note', created_at: 't', updated_at: null },
    ]);
    const c = controllerWith({ listExceptions });
    const res = await c.listExceptions(req, 'open');
    expect(listExceptions).toHaveBeenCalledWith({ state: 'open' });
    expect(res.page).toEqual({ limit: 100 });
    expect(res.items[0]).toMatchObject({ id: 'ex-1', notes: 'note', masked: false });
  });

  it('PII-masks exception notes when the caller lacks the pii grant', async () => {
    const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
    const access = {
      decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
      visibilityGrants: vi.fn().mockResolvedValue(new Set<string>()),
    } as unknown as AccessService;
    const listExceptions = vi.fn().mockResolvedValue([
      { id: 'ex-1', type_code: 'other', order_id: null, refs: {}, severity: 'warn', state: 'open', owner_id: null, resolution_code: null, notes: 'secret', created_at: 't', updated_at: null },
    ]);
    const c = new OrderController(sessions, access, { listExceptions } as unknown as OrderService);
    const res = await c.listExceptions(req, undefined);
    expect(res.items[0].notes).not.toBe('secret');
    expect(res.items[0].masked).toBe(true);
  });

  it('maps order and fulfillment transitions to config-engine service calls', async () => {
    const transitionOrder = vi.fn().mockResolvedValue(undefined);
    const transitionDay = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ transitionOrder, transitionDay });
    await expect(c.transitionOrder(req, 'order-1', { to: 'cancelled', reason_code: 'other', note: 'customer request' }))
      .resolves.toEqual({ ok: true });
    await expect(c.transitionDay(req, 'day-1', { to: 'cancelled_day', reason_code: 'other' }))
      .resolves.toEqual({ ok: true });
    expect(transitionOrder).toHaveBeenCalledWith(ctx, 'order-1', 'cancelled', { code: 'other', note: 'customer request' });
    expect(transitionDay).toHaveBeenCalledWith(ctx, 'day-1', 'cancelled_day', { code: 'other', note: undefined });
  });

  it('maps change request decisions and exception resolution', async () => {
    const createChangeRequest = vi.fn().mockResolvedValue('cr-1');
    const decideChangeRequest = vi.fn().mockResolvedValue(undefined);
    const createException = vi.fn().mockResolvedValue('ex-1');
    const resolveException = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ createChangeRequest, decideChangeRequest, createException, resolveException });

    await expect(c.createChangeRequest(req, 'order-1', { diff: { end_date: '2099-01-10' } }))
      .resolves.toEqual({ id: 'cr-1' });
    await expect(c.decideChangeRequest(req, 'cr-1', { decision: 'approve' })).resolves.toEqual({ ok: true });
    await expect(c.createException(req, 'order-1', {
      type_code: 'allergy_incident',
      refs: { fulfillment_day_id: 'day-1' },
      notes: 'kitchen raised',
    })).resolves.toEqual({ id: 'ex-1' });
    await expect(c.resolveException(req, 'ex-1', { resolution_code: 'other', notes: 'closed' })).resolves.toEqual({ ok: true });

    expect(createChangeRequest).toHaveBeenCalledWith(ctx, 'order-1', { end_date: '2099-01-10' });
    expect(decideChangeRequest).toHaveBeenCalledWith(ctx, 'cr-1', true);
    expect(createException).toHaveBeenCalledWith(ctx, {
      typeCode: 'allergy_incident',
      refs: { fulfillment_day_id: 'day-1', order_id: 'order-1' },
      severity: undefined,
      notes: 'kitchen raised',
    });
    expect(resolveException).toHaveBeenCalledWith(ctx, 'ex-1', { resolutionCode: 'other', notes: 'closed' });
  });
});
