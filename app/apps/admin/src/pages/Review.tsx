import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse, type ReviewQueueListItem } from '../api';

// WP-UI-02b — Ops Manager review-queue actions (WF-03..06). List submitted drafts,
// open one, claim it, then approve / return / reject. Reject+return require a reason
// code (rejection / return_to_draft domains); approving past warnings requires a
// reason per warning field (the server enforces both).

interface ReasonCode { id: string; domain: string; code: string; label_en: string }
interface DraftWarning { field: string; rule: string; detail?: unknown }
interface DraftDetail {
  id: string;
  state: string;
  channel: string;
  customer_id: string | null;
  unverified_customer: boolean;
  items: Array<{ product_id: string; qty: number }>;
  completeness?: { missing: string[]; warnings: DraftWarning[] };
}

const fmtTs = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');
const short = (s: string | null): string => (s ? (s.length > 10 ? `${s.slice(0, 10)}…` : s) : '—');

export function ReviewPage(): React.JSX.Element {
  const [state, setState] = useState('');
  const [items, setItems] = useState<ReviewQueueListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ item: ReviewQueueListItem; draft: DraftDetail } | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<ReviewQueueListItem>>(state ? `/review-queue?state=${state}` : '/review-queue')
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [state]);

  useEffect(() => { reload(); }, [reload]);

  async function openItem(item: ReviewQueueListItem): Promise<void> {
    setError(null);
    try {
      const draft = await api<DraftDetail>(`/drafts/${item.draft_id}`);
      setOpen({ item, draft });
    } catch (e) {
      setError(humanMessage(e));
    }
  }

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
      {!busy && items.length === 0 ? <p className="emptyLine">Review queue is empty — submitted drafts appear here.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Draft</th><th>Queue state</th><th>Channel</th><th>Entered</th><th>SLA due</th><th>Warnings</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className="mono">{short(r.draft_id)}</td>
                <td><span className={`badge st-${r.queue_state}`}>{r.queue_state.replaceAll('_', ' ')}</span></td>
                <td>{r.channel}</td>
                <td>{fmtTs(r.entered_at)}</td>
                <td>{fmtTs(r.sla_due_at)}{r.sla_late ? <span className="badge late">late</span> : null}</td>
                <td>{r.warnings.length === 0 ? '—' : r.warnings.length}</td>
                <td><button type="button" onClick={() => void openItem(r)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {open ? (
        <ReviewPanel
          item={open.item}
          draft={open.draft}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); reload(); }}
        />
      ) : null}
    </section>
  );
}

function ReviewPanel({
  item, draft, onClose, onDone,
}: {
  item: ReviewQueueListItem;
  draft: DraftDetail;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'return' | 'reject'>('view');
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const warnings = draft.completeness?.warnings ?? [];
  const warningFields = [...new Set(warnings.map((w) => w.field))];
  const claimed = item.queue_state === 'in_review';

  // Load the right reason-code domain when entering return/reject mode.
  useEffect(() => {
    if (mode === 'view') return;
    const domain = mode === 'reject' ? 'rejection' : 'return_to_draft';
    setReasonCode('');
    api<ListResponse<ReasonCode>>(`/settings/reason-codes?domain=${domain}`)
      .then((d) => setReasonCodes(d.items))
      .catch(() => setReasonCodes([]));
  }, [mode]);

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

  const claim = (): Promise<void> => run(() => api(`/review-queue/${draft.id}/claim`, { method: 'POST' }));

  const approve = (): Promise<void> => run(() => api(`/drafts/${draft.id}/decisions`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'approve',
      warnings_overridden: warningFields.map((f) => ({ field: f, reason: overrides[f] ?? '' })),
    }),
  }));

  const decide = (decision: 'return' | 'reject'): Promise<void> => run(() => api(`/drafts/${draft.id}/decisions`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason_code: reasonCode, note: note || undefined }),
  }));

  const allWarningsHaveReason = warningFields.every((f) => (overrides[f] ?? '').trim().length > 0);

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Review draft <span className="mono">{short(draft.id)}</span></h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <dl className="kv">
        <div><dt>State</dt><dd>{draft.state}</dd></div>
        <div><dt>Channel</dt><dd>{draft.channel}</dd></div>
        <div><dt>Customer</dt><dd>{draft.unverified_customer ? 'unverified' : short(draft.customer_id)}</dd></div>
        <div><dt>Items</dt><dd>{draft.items?.length ?? 0}</dd></div>
      </dl>

      {warnings.length > 0 ? (
        <div className="warnBox">
          <strong>Warnings</strong>
          <ul>{warnings.map((w, i) => <li key={`${w.field}-${i}`}>{w.field.replaceAll('_', ' ')}: {w.rule}</li>)}</ul>
        </div>
      ) : null}

      {!claimed ? (
        <div className="row">
          <button type="button" className="primary" onClick={() => void claim()} disabled={busy}>Claim for review</button>
          <span className="hintLine">Claim before deciding.</span>
        </div>
      ) : mode === 'view' ? (
        <div className="decideRow">
          {warningFields.length > 0 ? (
            <div className="overrides">
              <strong>Override warnings to approve</strong>
              {warningFields.map((f) => (
                <label key={f} className="field">
                  <span>{f.replaceAll('_', ' ')} — reason</span>
                  <input value={overrides[f] ?? ''} onChange={(e) => setOverrides({ ...overrides, [f]: e.target.value })} />
                </label>
              ))}
            </div>
          ) : null}
          <div className="row">
            <button type="button" className="primary" onClick={() => void approve()} disabled={busy || (warningFields.length > 0 && !allWarningsHaveReason)}>Approve</button>
            <button type="button" onClick={() => setMode('return')} disabled={busy}>Return</button>
            <button type="button" onClick={() => setMode('reject')} disabled={busy}>Reject</button>
          </div>
        </div>
      ) : (
        <div className="decideRow">
          <label className="field">
            <span>{mode === 'reject' ? 'Rejection' : 'Return'} reason</span>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">— select —</option>
              {reasonCodes.map((rc) => <option key={rc.id} value={rc.code}>{rc.label_en}</option>)}
            </select>
          </label>
          {reasonCodes.length === 0 ? <p className="hintLine">No reason codes configured for this domain yet (workshop seeds them).</p> : null}
          <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row">
            <button type="button" onClick={() => setMode('view')} disabled={busy}>Back</button>
            <button type="button" className="primary" onClick={() => void decide(mode)} disabled={busy || !reasonCode}>
              Confirm {mode}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
