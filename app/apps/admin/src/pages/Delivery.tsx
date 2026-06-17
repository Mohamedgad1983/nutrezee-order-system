import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// Delivery dashboard (m21-delivery). Three views: Drivers (list + add), Unassigned (assign packed
// orders to a driver by area/capacity), and Routes (status + per-stop tracking). All actions hit the
// governed /drivers and /delivery API; driver phone + customer name are masked server-side.

interface Driver { id: string; name: string; phone: string | null; active: boolean; capacity_per_slot: number; areas?: Array<{ area: string; priority: number }>; masked?: boolean }
interface Unassigned { order_id: string; customer_id: string | null; customer_name?: string | null; area: string | null; delivery_time_frozen: string | null; packing_status: string | null; masked?: boolean }
interface Route { id: string; driver_id: string | null; driver_name?: string | null; delivery_date: string; delivery_time: string | null; area_group: string | null; status: string; stop_count?: number; delivered_count?: number }
interface Stop { id: string; order_id: string; customer_name?: string | null; area: string | null; status: string; stop_sequence: number | null; masked?: boolean }

const today = (): string => new Date().toISOString().slice(0, 10);
type Tab = 'drivers' | 'unassigned' | 'routes';

export function DeliveryPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('unassigned');
  return (
    <section>
      <section className="toolbar">
        {(['unassigned', 'routes', 'drivers'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </section>
      {tab === 'drivers' ? <Drivers /> : null}
      {tab === 'unassigned' ? <UnassignedView /> : null}
      {tab === 'routes' ? <Routes /> : null}
    </section>
  );
}

function Drivers(): React.JSX.Element {
  const [items, setItems] = useState<Driver[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(() => {
    setBusy(true); setError(null);
    api<ListResponse<Driver>>('/drivers').then((d) => setItems(d.items)).catch((e: unknown) => setError(humanMessage(e))).finally(() => setBusy(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return (
    <section>
      <section className="toolbar">
        <button type="button" className="primary" onClick={() => setAdding(true)}>Add driver</button>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} drivers`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Capacity/slot</th><th>Areas</th><th>Active</th></tr></thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="mono">{d.phone ?? '—'}{d.masked ? ' 🔒' : ''}</td>
                <td className="mono">{d.capacity_per_slot || '∞'}</td>
                <td>{(d.areas ?? []).map((a) => a.area).join(', ') || '—'}</td>
                <td>{d.active ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!busy ? <p className="emptyLine">No drivers yet — add one with the areas they serve.</p> : null)}
      {adding ? <AddDriver onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} /> : null}
    </section>
  );
}

function AddDriver({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [capacity, setCapacity] = useState('10');
  const [areas, setAreas] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(): Promise<void> {
    setBusy(true); setError(null);
    try {
      await api('/drivers', {
        method: 'POST',
        body: JSON.stringify({
          name, phone: phone || undefined, capacity_per_slot: Number(capacity) || 0,
          areas: areas.split(',').map((a) => a.trim()).filter(Boolean).map((area, i) => ({ area, priority: (i + 1) * 10 })),
        }),
      });
      onDone();
    } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }
  return (
    <section className="card reviewPanel">
      <div className="panelHead"><h2>Add driver</h2><button type="button" className="linkBtn" onClick={onClose}>Close</button></div>
      {error ? <p className="error">{error}</p> : null}
      <div className="decideRow">
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+965…" /></label>
        <label className="field"><span>Capacity / slot</span><input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        <label className="field"><span>Areas (comma-sep)</span><input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Salmiya, Hawally" /></label>
        <div className="row"><button type="button" className="primary" onClick={() => void submit()} disabled={busy || !name}>Create</button></div>
      </div>
    </section>
  );
}

function UnassignedView(): React.JSX.Element {
  const [date, setDate] = useState(today());
  const [area, setArea] = useState('');
  const [items, setItems] = useState<Unassigned[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current; setBusy(true); setError(null);
    Promise.all([
      api<ListResponse<Unassigned>>(`/delivery/unassigned?date=${date}${area ? `&area=${area}` : ''}`),
      api<ListResponse<Driver>>('/drivers?active=true'),
    ]).then(([u, d]) => { if (seq.current === mine) { setItems(u.items); setDrivers(d.items); } })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [date, area]);
  useEffect(() => { reload(); }, [reload]);

  async function assign(orderId: string): Promise<void> {
    if (!driverId) { setError('Pick a driver first.'); return; }
    setError(null);
    try { await api('/delivery/assign', { method: 'POST', body: JSON.stringify({ order_id: orderId, driver_id: driverId, delivery_date: date, area: area || undefined }) }); reload(); }
    catch (e) { setError(humanMessage(e)); }
  }
  async function bulkAssign(): Promise<void> {
    if (!driverId) { setError('Pick a driver first.'); return; }
    setError(null);
    try {
      const r = await api<{ assigned: number; skipped: number }>('/delivery/bulk-assign', { method: 'POST', body: JSON.stringify({ driver_id: driverId, delivery_date: date, area: area || undefined }) });
      setError(`Assigned ${r.assigned}, skipped ${r.skipped}.`); reload();
    } catch (e) { setError(humanMessage(e)); }
  }

  return (
    <section>
      <section className="toolbar">
        <label><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>Area</span><input placeholder="all" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <label><span>Driver</span>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">— pick driver —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.capacity_per_slot || '∞'})</option>)}
          </select>
        </label>
        <button type="button" className="primary" onClick={() => void bulkAssign()} disabled={!items.length}>Bulk assign all</button>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} unassigned`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Area</th><th>Time</th><th>Packing</th><th></th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.order_id}>
                <td className="mono">{u.order_id.slice(-8)}</td>
                <td>{u.customer_name ?? '—'}{u.masked ? ' 🔒' : ''}</td>
                <td>{u.area ?? '—'}</td>
                <td>{u.delivery_time_frozen ?? '—'}</td>
                <td><span className="badge">{u.packing_status ? u.packing_status.replaceAll('_', ' ') : 'not packed'}</span></td>
                <td><button type="button" onClick={() => void assign(u.order_id)}>Assign</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!busy ? <p className="emptyLine">No unassigned orders for this date/area.</p> : null)}
    </section>
  );
}

function Routes(): React.JSX.Element {
  const [date, setDate] = useState(today());
  const [items, setItems] = useState<Route[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current; setBusy(true); setError(null);
    api<ListResponse<Route>>(`/delivery/routes${date ? `?date=${date}` : ''}`)
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [date]);
  useEffect(() => { reload(); }, [reload]);
  return (
    <section>
      <section className="toolbar">
        <label><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <span className="countLine">{busy ? 'Loading…' : `${items.length} routes`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Driver</th><th>Date</th><th>Area</th><th>Status</th><th>Delivered</th><th></th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.driver_name ?? '—'}</td>
                <td>{r.delivery_date}</td>
                <td>{r.area_group ?? '—'}</td>
                <td><span className={`badge${r.status === 'failed' ? ' st-rejected' : ''}`}>{r.status.replaceAll('_', ' ')}</span></td>
                <td className="mono">{r.delivered_count ?? 0}/{r.stop_count ?? 0}</td>
                <td><button type="button" onClick={() => setOpen(r.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!busy ? <p className="emptyLine">No routes for this date.</p> : null)}
      {open ? <RouteDetail routeId={open} onClose={() => setOpen(null)} onChange={reload} /> : null}
    </section>
  );
}

function RouteDetail({ routeId, onClose, onChange }: { routeId: string; onClose: () => void; onChange: () => void }): React.JSX.Element {
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current; setError(null);
    api<{ route: Route; stops: Stop[] }>(`/delivery/routes/${routeId}`)
      .then((d) => { if (seq.current === mine) { setRoute(d.route); setStops(d.stops); } })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); });
  }, [routeId]);
  useEffect(() => { load(); }, [load]);
  async function act(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    try { await fn(); load(); onChange(); } catch (e) { setError(humanMessage(e)); }
  }
  const ROUTE_NEXT: Record<string, string[]> = { draft: ['assigned', 'failed'], assigned: ['out_for_delivery', 'failed'], out_for_delivery: ['completed', 'failed'], completed: [], failed: [] };
  const STOP_NEXT: Record<string, string[]> = { assigned: ['picked_up', 'delivered', 'failed'], picked_up: ['delivered', 'failed'], delivered: [], failed: ['returned'], returned: [] };
  return (
    <section className="card reviewPanel">
      <div className="panelHead"><h2>Route {route ? `${route.delivery_date} · ${route.area_group ?? 'all'} · ${route.driver_name ?? 'unassigned'}` : '…'}</h2><button type="button" className="linkBtn" onClick={onClose}>Close</button></div>
      {error ? <p className="error">{error}</p> : null}
      {route ? (
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="badge">{route.status.replaceAll('_', ' ')}</span>
          {(ROUTE_NEXT[route.status] ?? []).map((to) => (
            <button key={to} type="button" onClick={() => void act(() => api(`/delivery/routes/${routeId}/status`, { method: 'POST', body: JSON.stringify({ to }) }))}>→ {to.replaceAll('_', ' ')}</button>
          ))}
        </div>
      ) : null}
      {stops.length > 0 ? (
        <table className="table">
          <thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Area</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {stops.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.stop_sequence ?? '—'}</td>
                <td className="mono">{s.order_id.slice(-8)}</td>
                <td>{s.customer_name ?? '—'}{s.masked ? ' 🔒' : ''}</td>
                <td>{s.area ?? '—'}</td>
                <td><span className={`badge${s.status === 'failed' ? ' st-rejected' : ''}`}>{s.status}</span></td>
                <td className="row" style={{ gap: 4 }}>
                  {(STOP_NEXT[s.status] ?? []).map((to) => (
                    <button key={to} type="button" onClick={() => void act(() => api(`/delivery/routes/${routeId}/stops/${s.order_id}/status`, { method: 'POST', body: JSON.stringify({ to }) }))}>{to}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="emptyLine">No stops on this route yet.</p>}
    </section>
  );
}
