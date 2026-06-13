import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ListResponse } from '../api';

// WP-UI-03c — dashboard. A read-only overview that aggregates already-wired
// endpoints: the M15 report projections (intake funnel + daily ops) and live queue
// counts (review / payment-review / orders). No new API, no seed dependency — each
// source degrades to '—' on its own if it fails, so one bad fetch never blanks the page.

interface IntakeFunnel { drafts_created: number; submitted: number; returned: number; approved: number; rejected: number }
interface DailyOps { orders_approved: number; orders_cancelled: number; payment_paid: number; payment_failed: number }
interface Dash {
  intake: IntakeFunnel | null;
  ops: DailyOps | null;
  reviewsWaiting: number | null;
  paymentsWaiting: number | null;
  orders: number | null;
}

const n = (v: number | null | undefined): string => (typeof v === 'number' ? v.toLocaleString() : '—');

async function get<T>(path: string): Promise<T | null> {
  // Swallow per-source errors for graceful degradation; api() still fires the central
  // 401 handler before throwing, so an expired session still redirects to login.
  try { return await api<T>(path); } catch { return null; }
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  const hot = accent && value !== '—' && value !== '0';
  return (
    <div className="card" style={{ flex: '1 1 150px', minWidth: 150, borderLeft: hot ? '3px solid #c2410c' : undefined }}>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: hot ? '#c2410c' : undefined }}>{value}</div>
      <div style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.6, opacity: 0.7, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section style={{ marginTop: 8 }}>
      <strong>{title}</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>{children}</div>
    </section>
  );
}

export function DashboardPage(): React.JSX.Element {
  const [dash, setDash] = useState<Dash | null>(null);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    Promise.all([
      get<{ data: IntakeFunnel }>('/reports/intake-funnel'),
      get<{ data: DailyOps }>('/reports/daily-ops'),
      get<ListResponse<unknown>>('/review-queue?state=waiting'),
      get<ListResponse<unknown>>('/payment-reviews?state=waiting'),
      get<ListResponse<unknown>>('/orders'),
    ]).then(([intake, ops, rev, pay, ord]) => {
      if (seq.current !== mine) return;
      setDash({
        intake: intake?.data ?? null,
        ops: ops?.data ?? null,
        reviewsWaiting: rev ? rev.items.length : null,
        paymentsWaiting: pay ? pay.items.length : null,
        orders: ord ? ord.items.length : null,
      });
    }).finally(() => { if (seq.current === mine) setBusy(false); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section>
      <section className="toolbar">
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : 'Live overview — projections + queue counts'}</span>
      </section>

      <Group title="Needs attention">
        <StatCard label="Reviews waiting" value={n(dash?.reviewsWaiting)} accent />
        <StatCard label="Payments to confirm" value={n(dash?.paymentsWaiting)} accent />
      </Group>

      <Group title="Intake funnel">
        <StatCard label="Drafts created" value={n(dash?.intake?.drafts_created)} />
        <StatCard label="Submitted" value={n(dash?.intake?.submitted)} />
        <StatCard label="Approved" value={n(dash?.intake?.approved)} />
        <StatCard label="Rejected" value={n(dash?.intake?.rejected)} />
      </Group>

      <Group title="Orders & payments">
        <StatCard label="Orders" value={n(dash?.orders)} />
        <StatCard label="Orders approved" value={n(dash?.ops?.orders_approved)} />
        <StatCard label="Payments paid" value={n(dash?.ops?.payment_paid)} />
      </Group>
    </section>
  );
}
