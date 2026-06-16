import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ListResponse, type ReviewQueueListItem } from '../api';

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
  orders_by_channel: Record<string, number>;
  payment_by_status: Record<string, number>;
  fulfillment_by_status: Record<string, number>;
  kitchen_tickets_by_status: Record<string, number>;
  orders_last_14_days: Array<{ date: string; count: number }>;
  top_packages: Array<{ name: string; count: number }>;
  revenue_by_currency: Array<{ currency: string; amount_minor: number; payments: number }>;
  upcoming_fulfillment_days: number;
}

interface IntakeFunnel {
  drafts_created: number;
  submitted: number;
  returned: number;
  approved: number;
  rejected: number;
  by_channel: Record<string, number>;
}

interface DailyOps {
  orders_approved: number;
  orders_cancelled: number;
  payment_paid: number;
  payment_failed: number;
  fulfillment_by_status: Record<string, number>;
}

interface KitchenDay {
  tickets_generated: number;
  unrouted: number;
  per_section: Record<string, number>;
  ready_to_pack: number;
  packed: number;
}

interface KitchenReport {
  by_date: Record<string, KitchenDay>;
}

interface PaymentReview {
  id: string;
  order_id: string;
  requested_status: string;
  state: string;
  evidence_note?: string | null;
  created_at?: string;
}

interface Dash {
  ov: Overview | null;
  intake: IntakeFunnel | null;
  daily: DailyOps | null;
  kitchen: KitchenReport | null;
  reviewsWaiting: ReviewQueueListItem[] | null;
  paymentsWaiting: PaymentReview[] | null;
}

interface DetailRow {
  label: string;
  value: string;
  share?: string;
}

const MINOR_UNITS: Record<string, number> = {
  BHD: 1000,
  IQD: 1000,
  JOD: 1000,
  KWD: 1000,
  LYD: 1000,
  OMR: 1000,
  TND: 1000,
};

const statusTone: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  active: 'good',
  approved: 'good',
  paid: 'good',
  collected: 'good',
  completed: 'good',
  packed: 'good',
  prepared: 'good',
  ready_to_pack: 'good',
  submitted: 'warn',
  waiting: 'warn',
  pending_review: 'warn',
  cod_pending: 'warn',
  link_sent: 'warn',
  queued: 'warn',
  in_progress: 'warn',
  in_preparation: 'warn',
  failed: 'bad',
  rejected: 'bad',
  cancelled: 'bad',
  cancelled_day: 'bad',
  blocked: 'bad',
  expired: 'neutral',
  paused: 'neutral',
  scheduled: 'neutral',
  skipped: 'neutral',
};

async function get<T>(path: string): Promise<T | null> {
  try { return await api<T>(path); } catch { return null; }
}

const num = (v: number | null | undefined): string => (typeof v === 'number' ? v.toLocaleString() : '—');
const label = (s: string): string => s.replaceAll('_', ' ');
const sumRecord = (r: Record<string, number> | null | undefined): number =>
  Object.values(r ?? {}).reduce((total, v) => total + v, 0);
const percent = (part: number | null | undefined, whole: number | null | undefined): string => {
  if (!whole || typeof part !== 'number') return '—';
  return `${Math.round((part / whole) * 100)}%`;
};
const safeRatio = (part: number | null | undefined, whole: number | null | undefined): number =>
  !whole || typeof part !== 'number' ? 0 : Math.max(0, Math.min(100, (part / whole) * 100));
const fmtTs = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');
const short = (s: string | null | undefined, len = 12): string => (s ? (s.length > len ? `${s.slice(0, len)}…` : s) : '—');

function money(minor: number | null | undefined, currency = 'KWD'): string {
  if (typeof minor !== 'number') return '—';
  const divisor = MINOR_UNITS[currency] ?? 100;
  return `${(minor / divisor).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;
}

function primaryRevenue(ov: Overview | null | undefined): { value: string; sub: string } {
  const first = ov?.revenue_by_currency?.[0];
  if (!first) return { value: money(ov?.revenue_minor), sub: `${num(ov?.payments)} payments` };
  return {
    value: money(first.amount_minor, first.currency),
    sub: `${num(first.payments)} payments · ${first.currency}`,
  };
}

function sortedEntries(record: Record<string, number> | null | undefined): Array<[string, number]> {
  return Object.entries(record ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function detailRows(rows: Array<[string, number]>, total = rows.reduce((sum, [, value]) => sum + value, 0)): DetailRow[] {
  return rows.map(([name, value]) => ({
    label: label(name),
    value: num(value),
    share: percent(value, total),
  }));
}

function MetricCard({
  label: text, value, context, tone = 'neutral', details,
}: {
  label: string;
  value: string;
  context?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'brand';
  details?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (!details) {
    return (
      <article className={`card metricCard tone-${tone}`}>
        <span className="metricLabel">{text}</span>
        <strong>{value}</strong>
        {context ? <span className="metricContext">{context}</span> : null}
      </article>
    );
  }

  return (
    <article className={`card metricCard metricAction tone-${tone}${open ? ' isOpen' : ''}`}>
      <button type="button" className="metricButton" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="metricLabel">{text}</span>
        <strong>{value}</strong>
        {context ? <span className="metricContext">{context}</span> : null}
        <span className="metricDetailCue">{open ? 'Hide details' : 'Details'}</span>
      </button>
      {open ? <div className="metricDetailDrop">{details}</div> : null}
    </article>
  );
}

function MetricDetailTable({ rows }: { rows: DetailRow[] }): React.JSX.Element {
  return (
    <table className="detailTable">
      <thead>
        <tr><th>Metric</th><th>Value</th><th>Share</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.value}</td>
            <td>{row.share ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttentionDetail({
  reviews, payments,
}: {
  reviews: ReviewQueueListItem[] | null;
  payments: PaymentReview[] | null;
}): React.JSX.Element {
  const reviewItems = reviews ?? [];
  const paymentItems = payments ?? [];
  return (
    <div className="attentionDetail">
      <section>
        <h3>Reviews waiting <span>{num(reviewItems.length)}</span></h3>
        {reviewItems.length === 0 ? <p className="emptyLine compact">No waiting reviews.</p> : (
          <table className="detailTable itemTable">
            <thead>
              <tr><th>Draft</th><th>Channel</th><th>SLA due</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {reviewItems.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{short(item.draft_id)}</td>
                  <td>{item.channel}</td>
                  <td>{fmtTs(item.sla_due_at)}{item.sla_late ? ' late' : ''}</td>
                  <td>{item.missing.length + item.warnings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3>Payments to confirm <span>{num(paymentItems.length)}</span></h3>
        {paymentItems.length === 0 ? <p className="emptyLine compact">No waiting payment reviews.</p> : (
          <table className="detailTable itemTable">
            <thead>
              <tr><th>Order</th><th>Requested</th><th>Raised</th><th>Evidence</th></tr>
            </thead>
            <tbody>
              {paymentItems.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{short(item.order_id)}</td>
                  <td>{label(item.requested_status)}</td>
                  <td>{fmtTs(item.created_at)}</td>
                  <td>{item.evidence_note ? short(item.evidence_note, 24) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AnalyticsPanel({
  title, children, details, className = '',
}: {
  title: string;
  children: React.ReactNode;
  details: DetailRow[];
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section className={`analyticsPanel ${className}${open ? ' isOpen' : ''}`}>
      <h2 className="panelHeading">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span>{title}</span>
          <span className="detailCue">{open ? 'Hide details' : 'Details'}</span>
        </button>
      </h2>
      {children}
      {open ? (
        <div className="detailDrop">
          {details.length === 0 ? <p className="emptyLine compact">No detail rows available.</p> : (
            <table className="detailTable">
              <thead>
                <tr><th>Metric</th><th>Value</th><th>Share</th></tr>
              </thead>
              <tbody>
                {details.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.value}</td>
                    <td>{row.share ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProgressRow({
  name, value, max, tone,
}: {
  name: string;
  value: number;
  max: number;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}): React.JSX.Element {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div className={`progressRow tone-${tone ?? statusTone[name] ?? 'neutral'}`}>
      <div className="progressTop">
        <span>{label(name)}</span>
        <strong>{num(value)}</strong>
      </div>
      <div className="progressTrack" aria-hidden>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function RecordBars({
  title, rows, empty, limit = 7,
}: {
  title: string;
  rows: Array<[string, number]>;
  empty: string;
  limit?: number;
}): React.JSX.Element {
  const shown = rows.slice(0, limit);
  const max = shown.length ? Math.max(...shown.map(([, value]) => value)) : 0;
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  return (
    <AnalyticsPanel title={title} details={detailRows(rows, total)}>
      <div className="analyticsBody">
        {shown.length === 0 ? <p className="emptyLine compact">{empty}</p> : null}
        {shown.map(([name, value]) => <ProgressRow key={name} name={name} value={value} max={max} />)}
      </div>
    </AnalyticsPanel>
  );
}

function TrendBars({ rows }: { rows: Array<{ date: string; count: number }> }): React.JSX.Element {
  const max = rows.length ? Math.max(1, ...rows.map((r) => r.count)) : 1;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <AnalyticsPanel
      title="14-day order trend"
      className="trendPanel"
      details={rows.map((row) => ({ label: row.date, value: num(row.count), share: percent(row.count, total) }))}
    >
      <div className="trendBars" aria-label="Orders created during the last 14 days">
        {rows.map((r) => (
          <span
            key={r.date}
            title={`${r.date}: ${r.count.toLocaleString()} orders`}
            style={{ height: `${Math.max(6, (r.count / max) * 100)}%` }}
          >
            <i>{r.count}</i>
          </span>
        ))}
      </div>
    </AnalyticsPanel>
  );
}

function FunnelPanel({ intake }: { intake: IntakeFunnel | null }): React.JSX.Element {
  const rows: Array<[string, number]> = [
    ['Drafts created', intake?.drafts_created ?? 0],
    ['Submitted', intake?.submitted ?? 0],
    ['Approved', intake?.approved ?? 0],
    ['Returned', intake?.returned ?? 0],
    ['Rejected', intake?.rejected ?? 0],
  ];
  const max = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <AnalyticsPanel title="Intake funnel" details={detailRows(rows, intake?.drafts_created ?? 0)}>
      <div className="analyticsBody">
        {rows.map(([name, value]) => (
          <ProgressRow
            key={name}
            name={name}
            value={value}
            max={max}
            tone={name === 'Approved' ? 'good' : name === 'Rejected' ? 'bad' : 'warn'}
          />
        ))}
      </div>
    </AnalyticsPanel>
  );
}

function KitchenPanel({
  ov, kitchen,
}: {
  ov: Overview | null;
  kitchen: KitchenReport | null;
}): React.JSX.Element {
  const tickets = ov?.kitchen_tickets_by_status ?? {};
  const totalTickets = sumRecord(tickets);
  const today = new Date().toISOString().slice(0, 10);
  const todayKitchen = kitchen?.by_date[today];
  const packed = tickets.prepared ?? 0;
  const ticketRows = sortedEntries(tickets);
  const kitchenDetails: DetailRow[] = [
    { label: 'Prepared tickets', value: num(packed), share: percent(packed, totalTickets) },
    { label: 'Upcoming fulfillment days', value: num(ov?.upcoming_fulfillment_days), share: 'next 7 days' },
    { label: 'Today tickets generated', value: num(todayKitchen?.tickets_generated), share: `${num(todayKitchen?.unrouted)} unrouted` },
    ...detailRows(ticketRows, totalTickets),
  ];
  return (
    <AnalyticsPanel title="Kitchen readiness" className="opsFocus" details={kitchenDetails}>
      <div className="opsRows">
        <MetricCard label="Ticket readiness" value={percent(packed, totalTickets)}
          context={`${num(packed)} prepared of ${num(totalTickets)} tickets`} tone={packed > 0 ? 'good' : 'neutral'} />
        <MetricCard label="Upcoming fulfillment" value={num(ov?.upcoming_fulfillment_days)}
          context="next 7 calendar days" tone="brand" />
        <MetricCard label="Today generated" value={num(todayKitchen?.tickets_generated)}
          context={`${num(todayKitchen?.unrouted)} unrouted`} tone={(todayKitchen?.unrouted ?? 0) > 0 ? 'warn' : 'neutral'} />
      </div>
      <div className="analyticsBody flush">
        {ticketRows.length === 0 ? <p className="emptyLine compact">No kitchen tickets yet.</p> : null}
        {ticketRows.map(([name, value]) => (
          <ProgressRow key={name} name={name} value={value} max={Math.max(1, totalTickets)} />
        ))}
      </div>
    </AnalyticsPanel>
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
      get<{ data: IntakeFunnel }>('/reports/intake-funnel'),
      get<{ data: DailyOps }>('/reports/daily-ops'),
      get<{ data: KitchenReport }>('/reports/kitchen-day-list'),
      get<ListResponse<unknown>>('/review-queue?state=waiting'),
      get<ListResponse<unknown>>('/payment-reviews?state=waiting'),
    ]).then(([ov, intake, daily, kitchen, rev, pay]) => {
      if (seq.current !== mine) return;
      setDash({
        ov: ov?.data ?? null,
        intake: intake?.data ?? null,
        daily: daily?.data ?? null,
        kitchen: kitchen?.data ?? null,
        reviewsWaiting: rev ? rev.items as ReviewQueueListItem[] : null,
        paymentsWaiting: pay ? pay.items as PaymentReview[] : null,
      });
    }).finally(() => { if (seq.current === mine) setBusy(false); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const ov = dash?.ov ?? null;
  const intake = dash?.intake ?? null;
  const daily = dash?.daily ?? null;
  const kitchen = dash?.kitchen ?? null;
  const revenue = primaryRevenue(ov);
  const reviewsWaiting = dash?.reviewsWaiting ?? [];
  const paymentsWaiting = dash?.paymentsWaiting ?? [];
  const needAttention = reviewsWaiting.length + paymentsWaiting.length;
  const paymentTotal = Math.max(ov?.payments ?? 0, sumRecord(ov?.payment_by_status));
  const paidPayments = (ov?.payment_by_status.paid ?? 0) + (ov?.payment_by_status.collected ?? 0);
  const customerConversion = percent(ov?.customers_with_order, ov?.customers);
  const approvalRate = percent(intake?.approved, intake?.drafts_created);
  const cancelRate = percent(daily?.orders_cancelled, (daily?.orders_approved ?? 0) + (daily?.orders_cancelled ?? 0));
  const avgOrder = ov?.orders ? Math.round((ov.revenue_minor ?? 0) / ov.orders) : null;
  const orderStatuses = useMemo(() => sortedEntries(ov?.orders_by_status), [ov]);
  const paymentStatuses = useMemo(() => sortedEntries(ov?.payment_by_status), [ov]);
  const orderChannels = useMemo(() => sortedEntries(ov?.orders_by_channel), [ov]);
  const fulfillmentStatuses = useMemo(
    () => sortedEntries(ov?.fulfillment_by_status).length ? sortedEntries(ov?.fulfillment_by_status) : sortedEntries(daily?.fulfillment_by_status),
    [ov, daily],
  );
  const totalOrders = ov?.orders ?? 0;
  const totalCustomers = ov?.customers ?? 0;
  const convertedCustomers = ov?.customers_with_order ?? 0;
  const unconvertedCustomers = Math.max(0, totalCustomers - convertedCustomers);

  return (
    <main className="dash analyticsDash">
      <section className="dashHeader">
        <div>
          <p className="sectionTitle">Executive snapshot</p>
          <h2>Live operations analytics</h2>
        </div>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
      </section>

      <section className="insightStrip">
        <MetricCard label="Total orders" value={num(ov?.orders)}
          context={`${num(ov?.orders_by_status.active ?? 0)} active · ${num(ov?.orders_by_status.approved ?? 0)} approved`}
          tone="brand"
          details={<>
            <MetricDetailTable rows={[
              { label: 'All orders', value: num(ov?.orders), share: '100%' },
              ...detailRows(orderStatuses, totalOrders),
            ]} />
            {orderChannels.length > 0 ? <MetricDetailTable rows={detailRows(orderChannels, totalOrders)} /> : null}
          </>} />
        <MetricCard label="Recorded revenue" value={revenue.value} context={revenue.sub} tone="good"
          details={<MetricDetailTable rows={[
            { label: 'Recorded revenue', value: revenue.value, share: 'all currencies' },
            ...(ov?.revenue_by_currency ?? []).map((row) => ({
              label: row.currency,
              value: money(row.amount_minor, row.currency),
              share: `${num(row.payments)} payments`,
            })),
          ]} />} />
        <MetricCard label="Needs attention" value={num(needAttention)}
          context={`${num(reviewsWaiting.length)} Reviews waiting · ${num(paymentsWaiting.length)} Payments to confirm`}
          tone={needAttention > 0 ? 'warn' : 'good'}
          details={<AttentionDetail reviews={dash?.reviewsWaiting ?? null} payments={dash?.paymentsWaiting ?? null} />} />
        <MetricCard label="Customer conversion" value={customerConversion}
          context={`${num(ov?.customers_with_order)} of ${num(ov?.customers)} customers with orders`}
          details={<MetricDetailTable rows={[
            { label: 'Customers with orders', value: num(convertedCustomers), share: percent(convertedCustomers, totalCustomers) },
            { label: 'Customers without orders', value: num(unconvertedCustomers), share: percent(unconvertedCustomers, totalCustomers) },
            { label: 'Delivery addresses', value: num(ov?.addresses), share: `${num(ov?.areas)} areas` },
          ]} />} />
      </section>

      <section className="healthGrid">
        <MetricCard label="Drafts created" value={num(intake?.drafts_created)}
          context={`${approvalRate} approved from intake`} tone="brand"
          details={<MetricDetailTable rows={detailRows([
            ['Drafts created', intake?.drafts_created ?? 0],
            ['Submitted', intake?.submitted ?? 0],
            ['Approved', intake?.approved ?? 0],
            ['Returned', intake?.returned ?? 0],
            ['Rejected', intake?.rejected ?? 0],
          ], intake?.drafts_created ?? 0)} />} />
        <MetricCard label="Average order value" value={avgOrder === null ? '—' : money(avgOrder, ov?.revenue_by_currency[0]?.currency ?? 'KWD')}
          context="recorded revenue / orders"
          details={<MetricDetailTable rows={[
            { label: 'Recorded revenue', value: revenue.value, share: `${num(ov?.payments)} payments` },
            { label: 'Total orders', value: num(ov?.orders), share: 'denominator' },
            { label: 'Average order value', value: avgOrder === null ? '—' : money(avgOrder, ov?.revenue_by_currency[0]?.currency ?? 'KWD'), share: 'revenue / orders' },
          ]} />} />
        <MetricCard label="Payment paid rate" value={percent(paidPayments, paymentTotal)}
          context={`${num(paidPayments)} paid or collected of ${num(paymentTotal)}`} tone={safeRatio(paidPayments, paymentTotal) >= 80 ? 'good' : 'warn'}
          details={<MetricDetailTable rows={[
            { label: 'Paid or collected', value: num(paidPayments), share: percent(paidPayments, paymentTotal) },
            ...detailRows(paymentStatuses, paymentTotal),
          ]} />} />
        <MetricCard label="Cancellation pressure" value={cancelRate}
          context={`${num(daily?.orders_cancelled)} cancelled in projections`} tone={(daily?.orders_cancelled ?? 0) > 0 ? 'bad' : 'neutral'}
          details={<MetricDetailTable rows={[
            { label: 'Orders approved', value: num(daily?.orders_approved), share: percent(daily?.orders_approved, (daily?.orders_approved ?? 0) + (daily?.orders_cancelled ?? 0)) },
            { label: 'Orders cancelled', value: num(daily?.orders_cancelled), share: cancelRate },
          ]} />} />
      </section>

      <section className="analyticsGrid wideLeft">
        <RecordBars title="Orders & payments" rows={orderStatuses} empty={busy ? 'Loading orders…' : 'No orders yet.'} />
        <RecordBars title="Payment status mix" rows={paymentStatuses} empty={busy ? 'Loading payments…' : 'No payments yet.'} />
      </section>

      <section className="analyticsGrid">
        <FunnelPanel intake={intake} />
        <TrendBars rows={ov?.orders_last_14_days ?? []} />
      </section>

      <section className="analyticsGrid wideRight">
        <RecordBars title="Fulfillment pipeline" rows={fulfillmentStatuses} empty={busy ? 'Loading fulfillment…' : 'No fulfillment days yet.'} />
        <KitchenPanel ov={ov} kitchen={kitchen} />
      </section>

      <section className="analyticsGrid">
        <RecordBars title="Top delivery areas" rows={(ov?.top_areas ?? []).map((a) => [a.name, a.count])}
          empty={busy ? 'Loading areas…' : 'No address areas yet.'} limit={6} />
        <RecordBars title="Top packages" rows={(ov?.top_packages ?? []).map((p) => [p.name, p.count])}
          empty={busy ? 'Loading packages…' : 'No package orders yet.'} limit={6} />
      </section>
    </main>
  );
}
