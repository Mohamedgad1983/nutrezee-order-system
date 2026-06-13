import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// WP-UI-02d — Finance payment review queue (WF-13). Finance confirms PAID (or
// rejects) requested payment-status changes here; payment is never auto-confirmed
// in MVP. Reject pulls a payment_fail reason code. Refunds stay disabled (not_enabled).

interface ReasonCode { id: string; code: string; label_en: string }
interface PaymentReview {
  id: string;
  order_id: string;
  requested_status: string;
  state: string;
  evidence_note?: string | null;
  created_at?: string;
}

const fmtTs = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');
const short = (s: string | null | undefined): string => (s ? (s.length > 12 ? `${s.slice(0, 12)}…` : s) : '—');

export function PaymentsPage(): React.JSX.Element {
  const [state, setState] = useState('');
  const [items, setItems] = useState<PaymentReview[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PaymentReview | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<PaymentReview>>(state ? `/payment-reviews?state=${state}` : '/payment-reviews')
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [state]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section>
      <section className="toolbar">
        <label>
          <span>State</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">all</option>
            {['waiting', 'in_review', 'decided'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} in queue`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && items.length === 0 ? <p className="emptyLine">Payment review queue is empty — requested status changes appear here for Finance.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Order</th><th>Requested</th><th>State</th><th>Raised</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="mono">{short(p.order_id)}</td>
                <td><span className={`badge st-${p.requested_status}`}>{p.requested_status}</span></td>
                <td><span className={`badge st-${p.state}`}>{p.state.replaceAll('_', ' ')}</span></td>
                <td>{fmtTs(p.created_at)}</td>
                <td><button type="button" onClick={() => setOpen(p)} disabled={p.state === 'decided'}>Decide</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {open ? <DecidePanel review={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} /> : null}
    </section>
  );
}

function DecidePanel({
  review, onClose, onDone,
}: {
  review: PaymentReview;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [transactionRef, setTransactionRef] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (mode !== 'reject') return;
    setReasonCode('');
    api<ListResponse<ReasonCode>>('/settings/reason-codes?domain=payment_fail')
      .then((d) => setReasonCodes(d.items))
      .catch(() => setReasonCodes([]));
  }, [mode]);

  async function decide(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/payment-reviews/${review.id}/decisions`, {
        method: 'POST',
        body: JSON.stringify({
          decision: mode === 'approve' ? 'approve' : 'reject',
          transaction_ref: mode === 'approve' ? (transactionRef || undefined) : undefined,
          evidence_note: evidenceNote || undefined,
          reason_code: mode === 'reject' ? reasonCode : undefined,
          note: note || undefined,
        }),
      });
      onDone();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Payment review — order <span className="mono">{short(review.order_id)}</span></h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <dl className="kv">
        <div><dt>Requested status</dt><dd><span className={`badge st-${review.requested_status}`}>{review.requested_status}</span></dd></div>
        <div><dt>Queue state</dt><dd>{review.state.replaceAll('_', ' ')}</dd></div>
        {review.evidence_note ? <div><dt>Evidence</dt><dd>{review.evidence_note}</dd></div> : null}
      </dl>

      <div className="segmented">
        <button type="button" className={mode === 'approve' ? 'on' : ''} onClick={() => setMode('approve')}>Approve (confirm)</button>
        <button type="button" className={mode === 'reject' ? 'on' : ''} onClick={() => setMode('reject')}>Reject</button>
      </div>

      {mode === 'approve' ? (
        <div className="decideRow">
          <label className="field"><span>Transaction reference (optional)</span><input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} /></label>
          <label className="field"><span>Evidence note (optional)</span><input value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} /></label>
        </div>
      ) : (
        <div className="decideRow">
          <label className="field">
            <span>Failure reason</span>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">— select —</option>
              {reasonCodes.map((rc) => <option key={rc.id} value={rc.code}>{rc.label_en}</option>)}
            </select>
            {reasonCodes.length === 0 ? <span className="hintLine">No payment_fail reason codes configured yet (workshop seeds them).</span> : null}
          </label>
          <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
      )}

      <div className="row">
        <button type="button" className="primary" onClick={() => void decide()} disabled={busy || (mode === 'reject' && !reasonCode)}>
          Confirm {mode === 'approve' ? 'payment' : 'rejection'}
        </button>
      </div>
    </section>
  );
}
