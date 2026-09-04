import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// Packing dashboard (m20-packing). Build a batch by delivery date/time/area, see its orders,
// mark each packed / flag an issue, preview a label, then hand the batch to driver assignment.
// All actions hit the governed /packing API; PII (customer name on labels) is masked server-side.

interface Batch {
  id: string; delivery_date: string; delivery_time: string | null; area: string | null;
  status: string; order_count?: number; packed_count?: number; created_at: string;
}
interface BatchOrder {
  id: string; order_id: string; customer_id: string | null; package_name: string | null;
  delivery_method_frozen: string | null; delivery_time_frozen: string | null; delivery_area_frozen: string | null;
  packing_status: string; customer_name?: string | null; masked?: boolean;
}
interface Label {
  order_id: string; label_code: string; customer_display_name: string | null; package_name: string | null;
  delivery_time: string | null; area: string | null; allergy_warning: string | null; masked?: boolean;
}

const fmtTs = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');
const today = (): string => new Date().toISOString().slice(0, 10);

export function PackingPage(): React.JSX.Element {
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('');
  const [area, setArea] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true); setError(null);
    api<ListResponse<Batch>>(`/packing/batches${date ? `?date=${date}` : ''}`)
      .then((d) => { if (seq.current === mine) setBatches(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [date]);
  useEffect(() => { reload(); }, [reload]);

  async function createBatch(): Promise<void> {
    setError(null);
    try {
      const res = await api<{ batch: Batch; included: number }>('/packing/batches', {
        method: 'POST',
        body: JSON.stringify({ delivery_date: date, delivery_time: time || undefined, area: area || undefined }),
      });
      setSelected(res.batch.id);
      reload();
    } catch (e) { setError(humanMessage(e)); }
  }

  return (
    <section>
      <section className="toolbar">
        <label><span>Delivery date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>Time</span><input placeholder="e.g. Morning" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label><span>Area</span><input placeholder="e.g. Salmiya" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <button type="button" className="primary" onClick={() => void createBatch()}>Create batch</button>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && batches.length === 0 ? <p className="emptyLine">No packing batches for this date — create one by delivery date/time/area.</p> : null}
      {batches.length > 0 ? (
        <table className="table">
          <thead><tr><th>Date</th><th>Time</th><th>Area</th><th>Status</th><th>Packed</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{b.delivery_date}</td>
                <td>{b.delivery_time ?? '—'}</td>
                <td>{b.area ?? '—'}</td>
                <td><span className="badge">{b.status.replaceAll('_', ' ')}</span></td>
                <td className="mono">{b.packed_count ?? 0}/{b.order_count ?? 0}</td>
                <td>{fmtTs(b.created_at)}</td>
                <td><button type="button" onClick={() => setSelected(b.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {selected ? <BatchDetail batchId={selected} onClose={() => setSelected(null)} onChange={reload} /> : null}
    </section>
  );
}

function BatchDetail({ batchId, onClose, onChange }: { batchId: string; onClose: () => void; onChange: () => void }): React.JSX.Element {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [orders, setOrders] = useState<BatchOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<Label | null>(null);
  const [issuing, setIssuing] = useState<BatchOrder | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current; setBusy(true); setError(null);
    api<{ batch: Batch; orders: BatchOrder[] }>(`/packing/batches/${batchId}`)
      .then((d) => { if (seq.current === mine) { setBatch(d.batch); setOrders(d.orders); } })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [batchId]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    try { await fn(); load(); onChange(); } catch (e) { setError(humanMessage(e)); }
  }
  async function preview(orderId: string): Promise<void> {
    setError(null);
    try { setLabel(await api<Label>(`/packing/labels/${orderId}/preview`, { method: 'POST' })); } catch (e) { setError(humanMessage(e)); }
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Batch {batch ? `${batch.delivery_date} · ${batch.area ?? 'all areas'} · ${batch.delivery_time ?? 'all times'}` : '…'}</h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {batch ? (
        <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span className="badge">{batch.status.replaceAll('_', ' ')}</span>
          <button type="button" className="primary" disabled={batch.status === 'handed_to_driver' || batch.status === 'cancelled'}
            onClick={() => void act(() => api(`/packing/batches/${batchId}/handoff`, { method: 'POST' }))}>
            Hand off to driver
          </button>
        </div>
      ) : null}
      {busy ? <p className="emptyLine">Loading…</p> : null}
      {orders.length > 0 ? (
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Package</th><th>Area</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.order_id.slice(-8)}</td>
                <td>{o.customer_name ?? '—'}{o.masked ? ' 🔒' : ''}</td>
                <td>{o.package_name ?? '—'}</td>
                <td>{o.delivery_area_frozen ?? '—'}</td>
                <td><span className={`badge${o.packing_status === 'issue' || o.packing_status === 'missing_item' ? ' st-rejected' : ''}`}>{o.packing_status.replaceAll('_', ' ')}</span></td>
                <td className="row" style={{ gap: 4 }}>
                  <button type="button" disabled={o.packing_status === 'packed' || o.packing_status === 'handed_to_driver'}
                    onClick={() => void act(() => api(`/packing/batches/${batchId}/orders/${o.order_id}/mark-packed`, { method: 'POST' }))}>Pack</button>
                  <button type="button" disabled={o.packing_status === 'handed_to_driver'} onClick={() => setIssuing(o)}>Issue</button>
                  <button type="button" onClick={() => void preview(o.order_id)}>Label</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!busy ? <p className="emptyLine">No orders in this batch.</p> : null)}

      {label ? <LabelPreview label={label} onClose={() => setLabel(null)}
        onPrint={() => void act(async () => { await api(`/packing/labels/${label.order_id}/mark-printed`, { method: 'POST' }); setLabel(null); })} /> : null}
      {issuing ? <IssuePanel order={issuing} onClose={() => setIssuing(null)}
        onDone={() => void act(async () => { setIssuing(null); })} batchId={batchId} /> : null}
    </section>
  );
}

function LabelPreview({ label, onClose, onPrint }: { label: Label; onClose: () => void; onPrint: () => void }): React.JSX.Element {
  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="panelHead"><h2>Label preview</h2><button type="button" className="linkBtn" onClick={onClose}>Close</button></div>
      <dl className="kv">
        <div><dt>Code</dt><dd className="mono">{label.label_code}</dd></div>
        <div><dt>Customer</dt><dd>{label.customer_display_name ?? '—'}{label.masked ? ' 🔒' : ''}</dd></div>
        <div><dt>Package</dt><dd>{label.package_name ?? '—'}</dd></div>
        <div><dt>Time</dt><dd>{label.delivery_time ?? '—'}</dd></div>
        <div><dt>Area</dt><dd>{label.area ?? '—'}</dd></div>
        {label.allergy_warning ? <div><dt>Allergy</dt><dd className="error">{label.allergy_warning}</dd></div> : null}
      </dl>
      <div className="row"><button type="button" className="primary" onClick={onPrint}>Mark printed</button></div>
    </section>
  );
}

function IssuePanel({ order, batchId, onClose, onDone }: { order: BatchOrder; batchId: string; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [status, setStatus] = useState('missing_item');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(): Promise<void> {
    setBusy(true); setError(null);
    try {
      await api(`/packing/batches/${batchId}/orders/${order.order_id}/issue`, {
        method: 'POST', body: JSON.stringify({ status, reason: reason || undefined, notes: notes || undefined }),
      });
      onDone();
    } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }
  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="panelHead"><h2>Flag issue · <span className="mono">{order.order_id.slice(-8)}</span></h2><button type="button" className="linkBtn" onClick={onClose}>Close</button></div>
      {error ? <p className="error">{error}</p> : null}
      <div className="decideRow">
        <label className="field"><span>Type</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="missing_item">missing item</option>
            <option value="issue">issue</option>
          </select>
        </label>
        <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="row"><button type="button" className="primary" onClick={() => void submit()} disabled={busy}>Flag</button></div>
      </div>
    </section>
  );
}
