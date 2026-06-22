import { afterEach, describe, expect, it } from 'vitest';
// The daily expiry report script exposes its query builder + config reader for testing.
// buildReportSql is a pure function (cfg -> {sql, params}); no DB needed for these unit checks.
import { buildReportSql, readConfig } from '../../scripts/expiring-subscription-email.mjs';

const base = {
  tz: 'Asia/Kuwait', daysAhead: 3, inclusive: true, windowMode: 'exact',
  includeContact: true, excludeStatuses: ['rejected'],
};

describe('TS-U unit — expiry report mode (per-order vs per-customer)', () => {
  const prev = { ...process.env };
  afterEach(() => { process.env = { ...prev }; });

  it('per_order reads the order-grain view and excludes rejected orders', () => {
    const { sql, params } = buildReportSql({ ...base, reportMode: 'per_order' });
    expect(sql).toContain('analytics.order_subscription_periods');
    expect(sql).not.toContain('analytics.customer_subscription_status');
    expect(sql).toContain('osp.order_status <> ALL');
    expect(params).toContainEqual(['rejected']); // the excluded-status array is a bound param
  });

  it('per_customer reads the customer-grain view with no raw order-status filter', () => {
    const { sql, params } = buildReportSql({ ...base, reportMode: 'per_customer' });
    expect(sql).toContain('analytics.customer_subscription_status');
    expect(sql).not.toContain('order_subscription_periods');
    expect(sql).not.toContain('order_status <> ALL');
    expect(params).toHaveLength(3); // tz, loOff, hiOff — no status array appended
  });

  it('the status exclusion is configurable and can be disabled', () => {
    const { sql } = buildReportSql({ ...base, reportMode: 'per_order', excludeStatuses: [] });
    expect(sql).not.toContain('order_status <> ALL');
  });

  it('inclusive exact window targets a single day = today + (daysAhead - 1)', () => {
    const { params } = buildReportSql({ ...base, reportMode: 'per_order', daysAhead: 3, inclusive: true, windowMode: 'exact' });
    expect(params[1]).toBe(2); // loOff
    expect(params[2]).toBe(2); // hiOff (exact => loOff == hiOff)
  });

  it('inclusive within window spans today .. today + (daysAhead - 1)', () => {
    const { params } = buildReportSql({ ...base, reportMode: 'per_order', daysAhead: 3, inclusive: true, windowMode: 'within' });
    expect(params[1]).toBe(0); // loOff (from today)
    expect(params[2]).toBe(2); // hiOff
  });

  it('exclusive counting (legacy mode) targets today + daysAhead', () => {
    const { params } = buildReportSql({ ...base, reportMode: 'per_customer', daysAhead: 3, inclusive: false, windowMode: 'exact' });
    expect(params[2]).toBe(3);
  });

  it('both modes expose the legacy order number + start date for the call-centre report', () => {
    for (const reportMode of ['per_order', 'per_customer'] as const) {
      const { sql } = buildReportSql({ ...base, reportMode });
      expect(sql).toContain('AS legacy_order_number');
      expect(sql).toContain('AS subscription_start_date');
    }
  });

  it('readConfig defaults to per_order and rejects an invalid mode', () => {
    delete process.env.EXPIRY_REPORT_MODE;
    expect(readConfig().reportMode).toBe('per_order');
    process.env.EXPIRY_REPORT_MODE = 'bogus';
    expect(() => readConfig()).toThrow(/EXPIRY_REPORT_MODE/);
  });

  it('readConfig parses EXPIRING_SUBSCRIPTION_EXCLUDE_STATUSES (default rejected)', () => {
    delete process.env.EXPIRING_SUBSCRIPTION_EXCLUDE_STATUSES;
    expect(readConfig().excludeStatuses).toEqual(['rejected']);
    process.env.EXPIRING_SUBSCRIPTION_EXCLUDE_STATUSES = 'rejected, cancelled';
    expect(readConfig().excludeStatuses).toEqual(['rejected', 'cancelled']);
  });
});
