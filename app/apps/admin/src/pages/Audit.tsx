import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// WP-UI-03c — read-only audit log over the new GET /audit (audit.read). before/after
// blobs are server-masked unless the caller has full visibility. Filter by severity /
// entity type / event type; expand a row to see the change detail. Closes WP-UI-03c.

interface AuditItem {
  id: string; event_type: string; actor_id: string | null; actor_role: string | null;
  entity_type: string; entity_id: string; severity: string; reason: string | null;
  occurred_at: string; related_refs: Record<string, unknown>; before: unknown; after: unknown; masked?: boolean;
}

const short = (s: string | null | undefined): string => (s ? (s.length > 12 ? `${s.slice(0, 12)}…` : s) : '—');
const fmtTs = (iso: string): string => new Date(iso).toLocaleString();
const sevClass = (s: string): string => (s === 'high' ? ' st-rejected' : s === 'warn' ? ' st-waiting' : '');
const blob = (v: unknown): string => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));

export function AuditPage(): React.JSX.Element {
  const [form, setForm] = useState({ severity: '', entity_type: '', event_type: '' });
  const [applied, setApplied] = useState({ severity: '', entity_type: '', event_type: '' });
  const [items, setItems] = useState<AuditItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const params = new URLSearchParams();
  if (applied.severity) params.set('severity', applied.severity);
  if (applied.entity_type) params.set('entity_type', applied.entity_type);
  if (applied.event_type) params.set('event_type', applied.event_type);
  const qs = params.toString();
  const path = qs ? `/audit?${qs}` : '/audit';

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<AuditItem>>(path)
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [path]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <section>
      <section className="toolbar">
        <label>
          <span>Severity</span>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="">all</option>
            {['info', 'warn', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label><span>Entity type</span><input value={form.entity_type} placeholder="e.g. staff_user" onChange={(e) => setForm({ ...form, entity_type: e.target.value })} /></label>
        <label><span>Event type</span><input value={form.event_type} placeholder="e.g. rbac.role_assigned" onChange={(e) => setForm({ ...form, event_type: e.target.value })} /></label>
        <button type="button" className="primary" onClick={() => setApplied(form)} disabled={busy}>Search</button>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} event${items.length === 1 ? '' : 's'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && !error && items.length === 0 ? <p className="emptyLine">No audit events match.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Time</th><th>Event</th><th>Severity</th><th>Entity</th><th>Actor</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {items.map((a) => (
              <Fragment key={a.id}>
                <tr>
                  <td>{fmtTs(a.occurred_at)}</td>
                  <td className="mono">{a.event_type}</td>
                  <td><span className={`badge${sevClass(a.severity)}`}>{a.severity}</span></td>
                  <td>{a.entity_type} <span className="mono">{short(a.entity_id)}</span></td>
                  <td>{a.actor_role ?? 'system'}</td>
                  <td>{a.reason ?? '—'}</td>
                  <td><button type="button" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Detail'}</button></td>
                </tr>
                {open === a.id ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="decideRow">
                        {a.masked ? <p className="hintLine">🔒 before/after detail is masked — needs full PII/health/payment visibility.</p> : null}
                        <div className="grid2">
                          <div><strong>Before</strong><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{blob(a.before)}</pre></div>
                          <div><strong>After</strong><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{blob(a.after)}</pre></div>
                        </div>
                        {Object.keys(a.related_refs ?? {}).length > 0 ? (
                          <div><strong>Refs</strong> <span className="mono">{JSON.stringify(a.related_refs)}</span></div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
