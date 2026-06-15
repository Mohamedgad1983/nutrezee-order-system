import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ListResponse } from '../api';

// Live enterprise overview — real DB aggregates from /reports/overview plus the live
// queue counts. Each source degrades to '—' on its own if it fails.

interface Overview {
  customers: number;
  customers_with_order: number;
  orders: number;
  orders_by_status: Record<string, number>;
  payments: number;
  revenue_minor: number;
  addresses: number;
  areas: number;
  top_areas: Array<{ name: string; count: number }>;
}
interface Dash {
  ov: Overview | null;
  reviewsWaiting: number | null;
  paymentsWaiting: number | null;
}

const n = (v: number | null | undefined): string => (typeof v === 'number' ? v.toLocaleString() : '—');
const kwd = (minor: number | null | undefined): string =>
  typeof minor === 'number' ? `${(minor / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} KWD` : '—';

async function get<T>(path: string): Promise<T | null> {
  try { return await api<T>(path); } catch { return null; }
}

function Stat({ icon, val, lbl, sub, hot, brand }: {
  icon: string; val: string; lbl: string; sub?: string; hot?: boolean; brand?: boolean;
}): React.JSX.Element {
  return (
    <div className={`stat${hot ? ' hot' : ''}${brand ? ' brandcard' : ''}`}>
      <div className="ico" aria-hidden>{icon}</div>
      <div className="val">{val}</div>
      <div className="lbl">{lbl}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
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
      get<{ data: Overview }>('/reports/overview'),
      get<ListResponse<unknown>>('/review-queue?state=waiting'),
      get<ListResponse<unknown>>('/payment-reviews?state=waiting'),
    ]).then(([ov, rev, pay]) => {
      if (seq.current !== mine) return;
      setDash({
        ov: ov?.data ?? null,
        reviewsWaiting: rev ? rev.items.length : null,
        paymentsWaiting: pay ? pay.items.length : null,
      });
    }).finally(() => { if (seq.current === mine) setBusy(false); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const ov = dash?.ov;
  const statuses = ov ? Object.entries(ov.orders_by_status).sort((a, b) => b[1] - a[1]) : [];
  const maxOrders = statuses.length ? Math.max(...statuses.map((s) => s[1])) : 1;
  const needAttention = (dash?.reviewsWaiting ?? 0) + (dash?.paymentsWaiting ?? 0);

  return (
    <div className="dash">
      <section className="toolbar" style={{ margin: 0, padding: 0, border: 'none', background: 'none' }}>
        <button type="button" onClick={reload} disabled={busy}>↻ Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : 'Live overview — real-time from the database'}</span>
      </section>

      <div className="statGrid">
        <Stat brand icon="👥" val={n(ov?.customers)} lbl="Customers"
          sub={ov ? `${n(ov.customers_with_order)} with an order` : undefined} />
        <Stat icon="🧾" val={n(ov?.orders)} lbl="Total orders"
          sub={ov ? `${n(ov.orders_by_status.active ?? 0)} active` : undefined} />
        <Stat icon="💰" val={kwd(ov?.revenue_minor)} lbl="Recorded revenue"
          sub={ov ? `${n(ov.payments)} payments` : undefined} />
        <Stat icon="📍" val={n(ov?.addresses)} lbl="Delivery addresses"
          sub={ov ? `${n(ov.areas)} areas` : undefined} />
        <Stat hot={needAttention > 0} icon="🔔" val={n(needAttention)} lbl="Needs attention"
          sub={`${n(dash?.reviewsWaiting)} reviews · ${n(dash?.paymentsWaiting)} payments`} />
      </div>

      <div className="panelGrid">
        <div className="panel">
          <h3>Orders by status</h3>
          <div className="body">
            {statuses.length === 0
              ? <span className="emptyLine" style={{ padding: 0 }}>{busy ? 'Loading…' : 'No orders yet.'}</span>
              : statuses.map(([s, c]) => (
                <div className={`bar s-${s}`} key={s}>
                  <div className="barTop"><span className="cap">{s}</span><span className="num">{c.toLocaleString()}</span></div>
                  <div className="track"><div className="fill" style={{ width: `${Math.max(3, (c / maxOrders) * 100)}%` }} /></div>
                </div>
              ))}
          </div>
        </div>
        <div className="panel">
          <h3>Top delivery areas</h3>
          <div className="body">
            {(ov?.top_areas ?? []).length === 0
              ? <span className="emptyLine" style={{ padding: 0 }}>{busy ? 'Loading…' : 'No areas yet.'}</span>
              : (ov?.top_areas ?? []).map((a, i) => (
                <div className="areaRow" key={i}><span>{a.name}</span><span className="cnt">{a.count.toLocaleString()}</span></div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
