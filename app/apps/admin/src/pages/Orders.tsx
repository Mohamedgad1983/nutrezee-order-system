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

export function OrdersPage(): React.JSX.Element {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ order: OrderDetail; days: Day[] } | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<OrderListItem>>(status ? `/orders?status=${status}` : '/orders')
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [status]);

  useEffect(() => { reload(); }, [reload]);

  async function openOrder(id: string): Promise<void> {
    setError(null);
    try {
      const [order, daysRes] = await Promise.all([
        api<OrderDetail>(`/orders/${id}`),
        api<ListResponse<Day>>(`/orders/${id}/fulfillment-days`),
      ]);
      setOpen({ order, days: daysRes.items });
    } catch (e) {
      setError(humanMessage(e));
    }
  }

  return (
    <section>
      <section className="toolbar">
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">all</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} order${items.length === 1 ? '' : 's'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && items.length === 0 ? <p className="emptyLine">No orders yet — approved drafts become orders.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Order</th><th>Status</th><th>Customer</th><th>Start</th><th>End</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.order_number}</td>
                <td><span className={`badge st-${o.status}`}>{o.status}</span></td>
                <td className="mono">{short(o.customer_id)}</td>
                <td>{o.start_date}</td>
                <td>{o.end_date}</td>
                <td>{typeof o.total === 'number' ? o.total.toLocaleString() : o.total}</td>
                <td><button type="button" onClick={() => void openOrder(o.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {open ? (
        <OrderPanel order={open.order} days={open.days} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />
      ) : null}
    </section>
  );
}

function OrderPanel({
  order, days, onClose, onDone,
}: {
  order: OrderDetail;
  days: Day[];
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'view' | 'transition' | 'change' | 'exception' | 'payment'>('view');

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
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Order <span className="mono">{order.order_number ?? short(order.id)}</span></h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <dl className="kv">
        <div><dt>Status</dt><dd><span className={`badge st-${order.status}`}>{order.status}</span></dd></div>
        <div><dt>Customer</dt><dd className="mono">{short(order.customer_id)}</dd></div>
        <div><dt>Start</dt><dd>{order.start_date ?? '—'}</dd></div>
        <div><dt>End</dt><dd>{order.end_date ?? '—'}</dd></div>
        <div><dt>Total</dt><dd>{typeof order.total === 'number' ? order.total.toLocaleString() : (order.total ?? '—')}</dd></div>
      </dl>

      <strong>Fulfillment days ({days.length})</strong>
      {days.length === 0 ? <p className="emptyLine">No days generated.</p> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Status</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.id}><td>{d.date}</td><td><span className={`badge st-${d.status}`}>{d.status}</span></td></tr>)}</tbody>
        </table>
      )}

      <div className="segmented" style={{ marginTop: 12 }}>
        {(['view', 'transition', 'change', 'exception', 'payment'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {({ view: 'Details', transition: 'Change status', change: 'Change request', exception: 'Raise exception', payment: 'Payment' } as const)[t]}
          </button>
        ))}
      </div>

      {tab === 'transition' ? (
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
  );
}
