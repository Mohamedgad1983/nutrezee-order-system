import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse, type OrderListItem } from '../api';

// WP-UI-02c — order detail + lifecycle actions (WF-12 cancel, WF-14 exception,
// WF-15 change request). List → open → summary + fulfillment days, then act. Order/
// day transitions go through the config engine (server validates the target state);
// money is PAYMENT-masked server-side.

const ORDER_STATUSES = ['approved', 'active', 'paused', 'completed', 'expired', 'cancelled', 'rejected'];
const EXCEPTION_TYPES = ['allergy_incident', 'wrong_item', 'missing_item', 'late', 'quality', 'payment', 'other'];

interface ReasonCode { id: string; code: string; label_en: string }
interface OrderDetail {
  id: string;
  order_number?: string;
  status: string;
  customer_id: string | null;
  start_date?: string;
  end_date?: string;
  total?: number | string;
  masked?: boolean;
}
interface Day { id: string; date: string; status: string }
interface PaymentInfo { id: string; status: string; method?: string | null; link_ref?: string | null; transaction_ref?: string | null; masked?: boolean }
const PAYMENT_REQUEST_TARGETS = ['paid', 'link_sent', 'cod_pending', 'collected', 'failed'];

const short = (s: string | null | undefined): string => (s ? (s.length > 12 ? `${s.slice(0, 12)}…` : s) : '—');

const TABS: Array<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'expired', label: 'Expired' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'rejected', label: 'Pending' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
];
const PAGE = 50;
const kwd = (v: number | string | null | undefined): string => {
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? (num / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
};

type PanelTab = 'view' | 'schedule' | 'transition' | 'change' | 'exception' | 'payment';

export function OrdersPage(): React.JSX.Element {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ order: OrderDetail; days: Day[]; tab: PanelTab } | null>(null);
  const seq = useRef(0);

  const load = useCallback((st: string, query: string, off: number) => {
    const mine = ++seq.current;
    setBusy(true); setError(null);
    const params = new URLSearchParams();
    if (st) params.set('status', st);
    if (query.trim()) params.set('q', query.trim());
    params.set('limit', String(PAGE)); params.set('offset', String(off));
    api<ListResponse<OrderListItem>>(`/orders?${params.toString()}`)
      .then((d) => { if (seq.current !== mine) return; setItems(d.items); setTotal(d.page.total ?? d.items.length); setOffset(off); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, []);

  useEffect(() => { load(status, submittedQ, 0); }, [load, status, submittedQ]);

  async function openOrder(id: string, tab: PanelTab = 'view'): Promise<void> {
    setError(null);
    try {
      const [order, daysRes] = await Promise.all([
        api<OrderDetail>(`/orders/${id}`),
        api<ListResponse<Day>>(`/orders/${id}/fulfillment-days`),
      ]);
      setOpen({ order, days: daysRes.items, tab });
    } catch (e) { setError(humanMessage(e)); }
  }

  function exportCsv(): void {
    const head = ['Order', 'Customer', 'Phone', 'Package', 'Start', 'End', 'Payment', 'Status', 'Amount(KWD)'];
    const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(items.map((o) => [
      o.order_number, o.customer_name ?? o.customer_id, o.customer_phone ?? '', o.package_name ?? '',
      o.start_date, o.end_date, o.payment_status ?? '', o.status, kwd(o.total),
    ].map(esc).join(',')));
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${status || 'all'}-${offset + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section>
      <div className="ordersTabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tabBtn${status === t.key ? ' on' : ''}`} onClick={() => setStatus(t.key)}>{t.label}</button>
        ))}
      </div>
      <section className="toolbar">
        <input
          placeholder="Search order #, name or phone" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setSubmittedQ(q); }}
          style={{ minHeight: 40, border: '1px solid var(--line)', borderRadius: 8, padding: '0 12px', minWidth: 260 }}
        />
        <button type="button" onClick={() => setSubmittedQ(q)} disabled={busy}>Search</button>
        {submittedQ ? <button type="button" onClick={() => { setQ(''); setSubmittedQ(''); }}>Clear</button> : null}
        <button type="button" onClick={() => load(status, submittedQ, offset)} disabled={busy}>↻ Refresh</button>
        <button type="button" onClick={exportCsv} disabled={!items.length}>⬇ CSV</button>
        <span className="countLine">{busy ? 'Loading…' : `${total.toLocaleString()} order${total === 1 ? '' : 's'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && items.length === 0 ? <p className="emptyLine">No orders match this filter.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Package</th><th>Start</th><th>End</th><th>Payment</th><th>Status</th><th>Amount</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.order_number}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{o.customer_name ?? short(o.customer_id)}</div>
                  {o.customer_phone ? <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{o.customer_phone}</div> : null}
                </td>
                <td>{o.package_name ?? '—'}</td>
                <td>{o.start_date}</td>
                <td>{o.end_date}</td>
                <td>{o.payment_status ? <span className={`badge st-${o.payment_status}`}>{o.payment_status}</span> : '—'}</td>
                <td><span className={`badge st-${o.status}`}>{o.status}</span></td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{kwd(o.total)}</td>
                <td>
                  <div className="rowOps">
                    <button type="button" className="iconBtn view" title="View order" aria-label="View order" onClick={() => void openOrder(o.id, 'view')}>👁</button>
                    <button type="button" className="iconBtn sched" title="Day schedule" aria-label="Day schedule" onClick={() => void openOrder(o.id, 'schedule')}>🗓</button>
                    <button type="button" className="iconBtn ops" title="Day operations" aria-label="Day operations" onClick={() => void openOrder(o.id, 'transition')}>⚙️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {total > PAGE ? (
        <div className="row" style={{ padding: '4px 24px 24px', gap: 10, alignItems: 'center' }}>
          <button type="button" onClick={() => load(status, submittedQ, Math.max(offset - PAGE, 0))} disabled={busy || offset === 0}>← Prev</button>
          <span className="countLine">{offset + 1}–{Math.min(offset + items.length, total)} of {total.toLocaleString()}</span>
          <button type="button" onClick={() => load(status, submittedQ, offset + PAGE)} disabled={busy || offset + items.length >= total}>Next →</button>
        </div>
      ) : null}

      {open ? (
        <OrderPanel order={open.order} days={open.days} initialTab={open.tab} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(status, submittedQ, offset); }} />
      ) : null}
    </section>
  );
}

function OrderPanel({
  order, days, onClose, onDone, initialTab,
}: {
  order: OrderDetail;
  days: Day[];
  onClose: () => void;
  onDone: () => void;
  initialTab: PanelTab;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>(initialTab);

  // transition
  const [target, setTarget] = useState('');
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  // change request
  const [newEnd, setNewEnd] = useState(order.end_date ?? '');
  // exception
  const [exType, setExType] = useState('other');
  const [exNotes, setExNotes] = useState('');
  // payment
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [linkRef, setLinkRef] = useState('');
  const [reqStatus, setReqStatus] = useState('');
  const [evidence, setEvidence] = useState('');
  const [payMsg, setPayMsg] = useState<string | null>(null);

  // Cancelling needs a cancellation reason code; load them when targeting cancelled.
  useEffect(() => {
    if (tab !== 'transition' || target !== 'cancelled') { setReasonCodes([]); setReasonCode(''); return; }
    api<ListResponse<ReasonCode>>('/settings/reason-codes?domain=cancellation')
      .then((d) => setReasonCodes(d.items))
      .catch(() => setReasonCodes([]));
  }, [tab, target]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  const doTransition = (): Promise<void> => run(() => api(`/orders/${order.id}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ to: target, reason_code: reasonCode || undefined, note: note || undefined }),
  }));
  const doChange = (): Promise<void> => run(() => api(`/orders/${order.id}/change-requests`, {
    method: 'POST',
    body: JSON.stringify({ diff: { end_date: newEnd } }),
  }));
  const doException = (): Promise<void> => run(() => api(`/orders/${order.id}/exceptions`, {
    method: 'POST',
    body: JSON.stringify({ type_code: exType, notes: exNotes || undefined }),
  }));

  // Payment actions stay in-panel (reload the payment, don't close like the others).
  const loadPayment = useCallback(() => {
    api<{ payment: PaymentInfo | null }>(`/orders/${order.id}/payments`)
      .then((d) => setPayment(d.payment))
      .catch(() => setPayment(null));
  }, [order.id]);
  useEffect(() => { if (tab === 'payment') loadPayment(); }, [tab, loadPayment]);

  async function runPayment(fn: () => Promise<unknown>, ok: string): Promise<void> {
    setBusy(true);
    setError(null);
    setPayMsg(null);
    try { await fn(); loadPayment(); setPayMsg(ok); } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }
  const doLinkSent = (): Promise<void> => runPayment(() => api(`/orders/${order.id}/payments/link-sent`, {
    method: 'POST', body: JSON.stringify({ link_ref: linkRef }),
  }), 'Payment link recorded.');
  const doStatusRequest = (): Promise<void> => runPayment(() => api(`/orders/${order.id}/payments/status-requests`, {
    method: 'POST', body: JSON.stringify({ requested_status: reqStatus, evidence_note: evidence || undefined }),
  }), 'Requested — sent to Finance review.');

  return (
    <div className="modalOverlay" onClick={onClose} role="presentation">
      <section className="card reviewPanel modalCard" onClick={(e) => e.stopPropagation()}>
      <div className="panelHead">
        <h2>Order <span className="mono">{order.order_number ?? short(order.id)}</span></h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close ✕</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <div className="segmented" style={{ marginTop: 4 }}>
        {(['view', 'schedule', 'transition', 'change', 'exception', 'payment'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {({ view: 'Details', schedule: 'Schedule', transition: 'Change status', change: 'Change request', exception: 'Raise exception', payment: 'Payment' } as const)[t]}
          </button>
        ))}
      </div>

      {tab === 'view' ? (
        <dl className="kv">
          <div><dt>Order #</dt><dd className="mono">{order.order_number ?? '—'}</dd></div>
          <div><dt>Status</dt><dd><span className={`badge st-${order.status}`}>{order.status}</span></dd></div>
          <div><dt>Customer</dt><dd className="mono">{short(order.customer_id)}</dd></div>
          <div><dt>Start</dt><dd>{order.start_date ?? '—'}</dd></div>
          <div><dt>End</dt><dd>{order.end_date ?? '—'}</dd></div>
          <div><dt>Total</dt><dd>{typeof order.total === 'number' ? order.total.toLocaleString() : (order.total ?? '—')}</dd></div>
        </dl>
      ) : tab === 'schedule' ? (
        <div>
          <strong>Fulfillment days ({days.length})</strong>
          {days.length === 0 ? <p className="emptyLine">No days generated for this order.</p> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Status</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.id}><td>{d.date}</td><td><span className={`badge st-${d.status}`}>{d.status}</span></td></tr>)}</tbody>
            </table>
          )}
        </div>
      ) : tab === 'transition' ? (
        <div className="decideRow">
          <label className="field">
            <span>New status</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— select —</option>
              {ORDER_STATUSES.filter((s) => s !== order.status).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {target === 'cancelled' ? (
            <label className="field">
              <span>Cancellation reason</span>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                <option value="">— select —</option>
                {reasonCodes.map((rc) => <option key={rc.id} value={rc.code}>{rc.label_en}</option>)}
              </select>
              {reasonCodes.length === 0 ? <span className="hintLine">No cancellation reason codes configured yet (workshop seeds them).</span> : null}
            </label>
          ) : null}
          <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row">
            <button type="button" className="primary" onClick={() => void doTransition()} disabled={busy || !target || (target === 'cancelled' && !reasonCode)}>Apply status change</button>
          </div>
        </div>
      ) : tab === 'change' ? (
        <div className="decideRow">
          <label className="field"><span>New end date</span><input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></label>
          <div className="row">
            <button type="button" className="primary" onClick={() => void doChange()} disabled={busy || !newEnd}>Submit change request</button>
          </div>
        </div>
      ) : tab === 'exception' ? (
        <div className="decideRow">
          <label className="field">
            <span>Type</span>
            <select value={exType} onChange={(e) => setExType(e.target.value)}>
              {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          <label className="field"><span>Notes</span><input value={exNotes} onChange={(e) => setExNotes(e.target.value)} /></label>
          <div className="row">
            <button type="button" className="primary" onClick={() => void doException()} disabled={busy}>Raise exception</button>
          </div>
          {exType === 'allergy_incident' ? <p className="hintLine">Allergy incidents auto-escalate to the Ops Manager at HIGH severity.</p> : null}
        </div>
      ) : tab === 'payment' ? (
        <div className="decideRow">
          <dl className="kv">
            <div><dt>Payment status</dt><dd><span className={`badge st-${payment?.status ?? ''}`}>{payment?.status ?? '…'}</span>{payment?.masked ? ' 🔒' : ''}</dd></div>
            <div><dt>Method</dt><dd>{payment?.method ?? '—'}</dd></div>
            <div><dt>Link ref</dt><dd className="mono">{payment?.link_ref ?? '—'}</dd></div>
          </dl>
          {payMsg ? <p className="hintLine">{payMsg}</p> : null}
          <strong>Record payment link sent</strong>
          <label className="field"><span>Link reference</span><input value={linkRef} onChange={(e) => setLinkRef(e.target.value)} placeholder="payment-link URL or ref" /></label>
          <div className="row"><button type="button" onClick={() => void doLinkSent()} disabled={busy || !linkRef.trim()}>Record link sent</button></div>
          <strong style={{ marginTop: 8 }}>Request a status change → Finance review</strong>
          <label className="field">
            <span>Requested status</span>
            <select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)}>
              <option value="">— select —</option>
              {PAYMENT_REQUEST_TARGETS.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          <label className="field"><span>Evidence note (optional)</span><input value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
          <div className="row"><button type="button" className="primary" onClick={() => void doStatusRequest()} disabled={busy || !reqStatus}>Request status change</button></div>
        </div>
      ) : null}
      </section>
    </div>
  );
}
