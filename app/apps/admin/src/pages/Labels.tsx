import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';
import { LabelSheet, type LabelDocument } from '../components/LabelSheet';

// Label printing (m25-label, A27). Renders the exact legacy label for one order or for a whole
// delivery date / driver, then prints via the browser — which is also the "Save as PDF" path, so
// no PDF library is needed. A reprint always requires a reason; every print is recorded server
// side against the order and the barcode that was printed.
//
// Rendering is POST /labels/render (not GET): building a label issues the customer's permanent
// barcode on first use, and a GET must never mutate state.

interface PrintEvent {
  id: string; print_kind: string; reason: string | null;
  printed_by: string; printed_at: string; barcode_value: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const fmtTs = (iso: string): string => new Date(iso).toLocaleString();

export function LabelsPage(): React.JSX.Element {
  const [date, setDate] = useState(today());
  const [orderId, setOrderId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [docs, setDocs] = useState<LabelDocument[]>([]);
  const [history, setHistory] = useState<PrintEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const seq = useRef(0);

  const loadHistory = useCallback((oid: string, d: string) => {
    if (!oid || !d) { setHistory([]); return; }
    api<ListResponse<PrintEvent>>(`/labels/${encodeURIComponent(oid)}/print-history?date=${d}`)
      .then((r) => setHistory(r.items))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    if (docs.length === 1) loadHistory(docs[0]!.order_id, date);
  }, [docs, date, loadHistory]);

  async function renderOne(): Promise<void> {
    const mine = ++seq.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const doc = await api<LabelDocument>('/labels/render', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId.trim(), delivery_date: date }),
      });
      if (seq.current === mine) setDocs([doc]);
    } catch (e) {
      if (seq.current === mine) { setError(humanMessage(e)); setDocs([]); }
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }

  async function renderBatch(): Promise<void> {
    const mine = ++seq.current;
    setBusy(true); setError(null); setNotice(null); setHistory([]);
    try {
      const res = await api<ListResponse<LabelDocument>>('/labels/batch', {
        method: 'POST',
        body: JSON.stringify({ delivery_date: date, driver_id: driverId.trim() || undefined }),
      });
      if (seq.current === mine) setDocs(res.items);
    } catch (e) {
      if (seq.current === mine) { setError(humanMessage(e)); setDocs([]); }
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }

  /** Record the print(s) first, then hand off to the browser's print dialog. */
  async function print(kind: 'print' | 'reprint'): Promise<void> {
    if (docs.length === 0) return;
    if (kind === 'reprint' && !reason.trim()) {
      setError('A reprint reason is required. / سبب إعادة الطباعة مطلوب.');
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    const batchRef = docs.length > 1 ? `batch-${date}-${Date.now()}` : undefined;
    try {
      for (const doc of docs) {
        await api(`/labels/${encodeURIComponent(doc.order_id)}/printed`, {
          method: 'POST',
          body: JSON.stringify({
            delivery_date: doc.delivery_date, kind,
            reason: kind === 'reprint' ? reason.trim() : undefined,
            batch_ref: batchRef,
          }),
        });
      }
      setNotice(`${docs.length} label${docs.length === 1 ? '' : 's'} recorded as ${kind}. Opening the print dialog…`);
      setReason('');
      if (docs.length === 1) loadHistory(docs[0]!.order_id, date);
      window.print();
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const missingDish = docs.filter((d) => d.meal_source === 'no_dish_source').length;

  return (
    <section className="labelsPage">
      <section className="toolbar">
        <label>
          <span>Delivery date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Order id</span>
          <input placeholder="single label" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        </label>
        <button type="button" className="primary" disabled={busy || !orderId.trim()} onClick={() => void renderOne()}>
          Preview label
        </button>
        <label>
          <span>Driver id</span>
          <input placeholder="all drivers" value={driverId} onChange={(e) => setDriverId(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={() => void renderBatch()}>
          Preview batch
        </button>
        <span className="countLine">
          {busy ? 'Loading…' : `${docs.length} label${docs.length === 1 ? '' : 's'}`}
        </span>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="emptyLine">{notice}</p> : null}
      {missingDish > 0 ? (
        <p className="error">
          {missingDish} of {docs.length} label{docs.length === 1 ? '' : 's'} have no recorded dish
          detail for this date — the meals table prints empty rather than showing unverified values.
        </p>
      ) : null}

      {docs.length > 0 ? (
        <section className="toolbar">
          <button type="button" className="primary" disabled={busy} onClick={() => void print('print')}>
            Print {docs.length > 1 ? `${docs.length} labels` : 'label'}
          </button>
          <label>
            <span>Reprint reason</span>
            <input
              placeholder="required for a reprint"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void print('reprint')}>
            Reprint
          </button>
          <span className="countLine">Print → &ldquo;Save as PDF&rdquo; produces the PDF.</span>
        </section>
      ) : null}

      {history.length > 0 ? (
        <table className="table">
          <caption>Print history for this order and date</caption>
          <thead>
            <tr><th>When</th><th>Kind</th><th>Barcode</th><th>Reason</th><th>By</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{fmtTs(h.printed_at)}</td>
                <td>{h.print_kind}</td>
                <td>{h.barcode_value}</td>
                <td>{h.reason ?? '—'}</td>
                <td>{h.printed_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/* Only this subtree is visible when printing (see labelSheet.css @media print). */}
      <div className="labelPrintRoot">
        {docs.map((doc) => (
          <div className="labelPreviewFrame" key={`${doc.order_id}-${doc.delivery_date}`}>
            <LabelSheet doc={doc} />
          </div>
        ))}
      </div>
    </section>
  );
}
