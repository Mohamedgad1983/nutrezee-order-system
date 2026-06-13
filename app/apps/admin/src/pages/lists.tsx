import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  humanMessage,
  type DraftListItem,
  type ListResponse,
  type OrderListItem,
} from '../api';

// Read-only list screens (WP-UI-01). Detail/action screens arrive in WP-UI-02.

function useList<T>(buildPath: () => string): {
  items: T[];
  busy: boolean;
  error: string | null;
  reload: () => void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const path = buildPath();

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<T>>(path)
      .then((data) => {
        if (seq.current === mine) setItems(data.items);
      })
      .catch((e: unknown) => {
        if (seq.current === mine) setError(humanMessage(e));
      })
      .finally(() => {
        if (seq.current === mine) setBusy(false);
      });
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, busy, error, reload };
}

function ListChrome({
  busy,
  error,
  count,
  emptyText,
  onReload,
  filter,
  children,
}: {
  busy: boolean;
  error: string | null;
  count: number;
  emptyText: string;
  onReload: () => void;
  filter?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <section className="toolbar">
        {filter}
        <button type="button" onClick={onReload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${count} record${count === 1 ? '' : 's'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {!busy && !error && count === 0 ? <p className="emptyLine">{emptyText}</p> : null}
      {count > 0 ? children : null}
    </section>
  );
}

const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 10)}…` : id);
const fmtTs = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export function DraftsPage(): React.JSX.Element {
  const [state, setState] = useState('');
  const list = useList<DraftListItem>(() => (state ? `/drafts?state=${state}` : '/drafts'));
  return (
    <ListChrome
      busy={list.busy}
      error={list.error}
      count={list.items.length}
      emptyText="No drafts yet — intake starts here once agents begin capturing orders."
      onReload={list.reload}
      filter={
        <label>
          <span>State</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">all</option>
            {['open', 'submitted', 'returned', 'converted', 'rejected', 'cancelled', 'expired'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>Draft</th><th>State</th><th>Channel</th><th>Customer</th><th>Start</th>
            <th>Items</th><th>Missing</th><th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((d) => (
            <tr key={d.id}>
              <td className="mono">{shortId(d.id)}</td>
              <td><span className={`badge st-${d.state}`}>{d.state}</span></td>
              <td>{d.channel}</td>
              <td>{d.unverified_customer ? 'unverified' : (d.customer_id ? shortId(d.customer_id) : '—')}</td>
              <td>{d.start_date ?? '—'}</td>
              <td>{d.items.length}</td>
              <td>{d.completeness.missing.length === 0 ? '—' : d.completeness.missing.join(', ')}</td>
              <td>{fmtTs(d.submitted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListChrome>
  );
}


export function OrdersPage(): React.JSX.Element {
  const [status, setStatus] = useState('');
  const list = useList<OrderListItem>(() => (status ? `/orders?status=${status}` : '/orders'));
  return (
    <ListChrome
      busy={list.busy}
      error={list.error}
      count={list.items.length}
      emptyText="No orders yet — approved drafts become orders."
      onReload={list.reload}
      filter={
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">all</option>
            {['approved', 'active', 'paused', 'completed', 'expired', 'cancelled', 'rejected'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>Order</th><th>Status</th><th>Customer</th><th>Start</th><th>End</th><th>Total</th><th>Source draft</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((o) => (
            <tr key={o.id}>
              <td className="mono">{o.order_number}</td>
              <td><span className={`badge st-${o.status}`}>{o.status}</span></td>
              <td className="mono">{shortId(o.customer_id)}</td>
              <td>{o.start_date}</td>
              <td>{o.end_date}</td>
              <td>{typeof o.total === 'number' ? o.total.toLocaleString() : o.total}</td>
              <td className="mono">{o.source_draft_id ? shortId(o.source_draft_id) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListChrome>
  );
}
