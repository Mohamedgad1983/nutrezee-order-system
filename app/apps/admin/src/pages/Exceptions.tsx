import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// WP-UI-03c — exceptions view (WF-14). Lists order exception cases over the new
// GET /orders/exceptions (notes PII-masked server-side) and resolves open ones via
// POST /orders/exceptions/:id/resolve with an escalation-domain reason code. Raising
// exceptions stays on the order-detail screen; this is the ops triage queue.

interface ExceptionItem {
  id: string; type_code: string; order_id: string | null; severity: string;
  state: string; owner_id: string | null; resolution_code: string | null;
  notes: string | null; created_at: string; masked?: boolean;
}
interface ReasonCode { id: string; code: string; label_en: string }

const short = (s: string | null | undefined): string => (s ? (s.length > 12 ? `${s.slice(0, 12)}…` : s) : '—');
const fmtTs = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export function ExceptionsPage(): React.JSX.Element {
  const [state, setState] = useState('');
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ExceptionItem | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<ExceptionItem>>(state ? `/orders/exceptions?state=${state}` : '/orders/exceptions')
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
            {['open', 'in_progress', 'resolved'].map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} ${items.length === 1 ? 'exception' : 'exceptions'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && !error && items.length === 0 ? <p className="emptyLine">No exceptions — raised from the order detail screen (WF-14). A clean queue is a good thing.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Type</th><th>Severity</th><th>State</th><th>Order</th><th>Notes</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{x.type_code}</td>
                <td><span className={`badge${x.severity === 'high' ? ' st-rejected' : ''}`}>{x.severity}</span></td>
                <td><span className="badge">{x.state.replaceAll('_', ' ')}</span></td>
                <td className="mono">{short(x.order_id)}</td>
                <td>{x.notes ?? '—'}{x.masked ? ' 🔒' : ''}</td>
                <td>{fmtTs(x.created_at)}</td>
                <td>{x.state !== 'resolved' ? <button type="button" onClick={() => setResolving(x)}>Resolve</button> : <span className="badge st-decided">done</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {resolving ? (
        <ResolvePanel exception={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); reload(); }} />
      ) : null}
    </section>
  );
}

function ResolvePanel({ exception, onClose, onDone }: { exception: ExceptionItem; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ListResponse<ReasonCode>>('/settings/reason-codes?domain=escalation')
      .then((d) => setCodes(d.items))
      .catch(() => setCodes([]));
  }, []);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/exceptions/${exception.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution_code: code || undefined, notes: notes || undefined }),
      });
      onDone();
    } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Resolve exception <span className="mono">{short(exception.id)}</span></h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <dl className="kv">
        <div><dt>Type</dt><dd>{exception.type_code}</dd></div>
        <div><dt>Severity</dt><dd>{exception.severity}</dd></div>
        <div><dt>Order</dt><dd className="mono">{short(exception.order_id)}</dd></div>
      </dl>
      <div className="decideRow">
        <label className="field">
          <span>Resolution reason</span>
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">— select —</option>
            {codes.map((rc) => <option key={rc.id} value={rc.code}>{rc.label_en}</option>)}
          </select>
          {codes.length === 0 ? <span className="hintLine">No escalation reason codes configured (Settings → Reason codes).</span> : null}
        </label>
        <label className="field"><span>Notes (optional)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="row">
          <button type="button" className="primary" onClick={() => void submit()} disabled={busy || !code}>Mark resolved</button>
        </div>
      </div>
    </section>
  );
}
