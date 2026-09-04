import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';
import { useAuth } from '../auth';

// Delivery dashboard (m21-delivery). Three views: Drivers (list + add), Unassigned (assign packed
// orders to a driver by area/capacity), and Routes (status + per-stop tracking). All actions hit the
// governed /drivers and /delivery API; driver phone + customer name are masked server-side.

interface Driver { id: string; name: string; phone: string | null; active: boolean; capacity_per_slot: number; areas?: Array<{ area: string; priority: number }>; masked?: boolean }
interface Unassigned { order_id: string; customer_id: string | null; customer_name?: string | null; area: string | null; delivery_time_frozen: string | null; packing_status: string | null; masked?: boolean }
interface Route { id: string; driver_id: string | null; driver_name?: string | null; delivery_date: string; delivery_time: string | null; area_group: string | null; status: string; stop_count?: number; delivered_count?: number }
interface Stop { id: string; order_id: string; customer_name?: string | null; area: string | null; status: string; stop_sequence: number | null; masked?: boolean }
interface CredentialDriver { id: string; name: string; phone_hint: string | null; status: string | null; online: boolean }
interface ReassignmentDriver { id: string; name: string; status: string | null; online: boolean }
interface ReassignmentOrder {
  id: string;
  tracking: string | null;
  status: string;
  scheduled_at: string | null;
  dispatched: boolean;
  eligible: boolean;
  blocked_reason: 'started' | 'current_job' | 'terminal' | 'invalid_record' | null;
}
interface ReassignmentResult {
  reassignment_id: string;
  status: 'completed' | 'partial' | 'failed';
  requested_count: number;
  completed_count: number;
  failed_count: number;
  failed_orders: Array<{ id: string; reason: string }>;
}

const today = (): string => new Date().toISOString().slice(0, 10);
type Tab = 'drivers' | 'unassigned' | 'routes' | 'credentials' | 'reassign';

export function DeliveryPage(): React.JSX.Element {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('unassigned');
  const canRotateCredentials = me?.roles.some((role) => role === 'logistics_manager' || role === 'super_admin') === true;
  const canReassignOrders = canRotateCredentials;
  const canOperateDelivery = me?.roles.some((role) => ['logistics_manager', 'ops_manager', 'admin', 'super_admin'].includes(role)) === true;
  const tabs: Tab[] = canOperateDelivery
    ? [
      ...(['unassigned', 'routes', 'drivers'] as Tab[]),
      ...(canReassignOrders ? ['reassign' as Tab] : []),
      ...(canRotateCredentials ? ['credentials' as Tab] : []),
    ]
    : canRotateCredentials ? ['credentials'] : ['unassigned', 'routes', 'drivers'];
  const visibleTab = tabs.includes(tab) ? tab : tabs[0]!;
  return (
    <section>
      <section className="toolbar">
        {tabs.map((t) => (
          <button key={t} type="button" className={visibleTab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t === 'credentials' ? 'Driver passwords / كلمات المرور'
              : t === 'reassign' ? 'Reassign orders / نقل الأوردرات' : t}
          </button>
        ))}
      </section>
      {visibleTab === 'drivers' ? <Drivers /> : null}
      {visibleTab === 'unassigned' ? <UnassignedView /> : null}
      {visibleTab === 'routes' ? <Routes /> : null}
      {visibleTab === 'reassign' && canReassignOrders ? <DriverOrderReassignment /> : null}
      {visibleTab === 'credentials' && canRotateCredentials ? <DriverCredentials /> : null}
    </section>
  );
}

function DriverOrderReassignment(): React.JSX.Element {
  const [drivers, setDrivers] = useState<ReassignmentDriver[]>([]);
  const [orders, setOrders] = useState<ReassignmentOrder[]>([]);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(today());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReassignmentResult | null>(null);

  const loadDrivers = useCallback(() => {
    setLoading(true);
    setError(null);
    api<ListResponse<ReassignmentDriver>>('/driver-order-reassignments/drivers')
      .then((data) => setDrivers(data.items))
      .catch((e: unknown) => setError(humanMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const loadOrders = useCallback(() => {
    setSelected(new Set());
    setAcknowledged(false);
    if (!source) {
      setOrders([]);
      return;
    }
    setLoading(true);
    setError(null);
    api<{ items: ReassignmentOrder[] }>(
      `/driver-order-reassignments/drivers/${encodeURIComponent(source)}/orders?date=${encodeURIComponent(date)}`,
    )
      .then((data) => setOrders(data.items))
      .catch((e: unknown) => setError(humanMessage(e)))
      .finally(() => setLoading(false));
  }, [date, source]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const eligible = orders.filter((order) => order.eligible);
  const allEligibleSelected = eligible.length > 0 && eligible.every((order) => selected.has(order.id));

  function toggleOrder(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setAcknowledged(false);
  }

  function toggleAll(): void {
    setSelected(allEligibleSelected ? new Set() : new Set(eligible.map((order) => order.id)));
    setAcknowledged(false);
  }

  async function reassign(): Promise<void> {
    if (!source || !target || source === target || selected.size === 0 || !acknowledged) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api<ReassignmentResult>('/driver-order-reassignments', {
        method: 'POST',
        body: JSON.stringify({
          source_driver_id: source,
          target_driver_id: target,
          order_ids: [...selected],
        }),
      });
      setResult(response);
      setSelected(new Set());
      setAcknowledged(false);
      loadOrders();
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="hintLine reassignmentHint">
        <span>Select any number of not-started orders and move them to another driver. No customer details are shown.</span>
        <span lang="ar" dir="rtl">اختر أي عدد من الأوردرات التي لم يبدأ تنفيذها وانقلها لسائق آخر؛ لا تظهر بيانات العملاء.</span>
      </p>
      <section className="toolbar">
        <label className="field">
          <span>From driver / من السائق</span>
          <select value={source} onChange={(event) => { setSource(event.target.value); setResult(null); }} disabled={busy}>
            <option value="">Select / اختر</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>To driver / إلى السائق</span>
          <select value={target} onChange={(event) => { setTarget(event.target.value); setAcknowledged(false); setResult(null); }} disabled={busy}>
            <option value="">Select / اختر</option>
            {drivers.filter((driver) => driver.id !== source).map((driver) => (
              <option key={driver.id} value={driver.id}>{driver.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Delivery date / تاريخ التوصيل</span>
          <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setResult(null); }} disabled={busy} />
        </label>
        <button type="button" onClick={() => { loadDrivers(); loadOrders(); }} disabled={busy || loading}>
          Refresh / تحديث
        </button>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <section className="card">
          <p className={result.status === 'completed' ? 'hintLine' : 'error'}>
            Batch {result.reassignment_id}: {result.completed_count}/{result.requested_count} moved,
            {' '}{result.failed_count} failed or unconfirmed. / تم نقل {result.completed_count} من {result.requested_count}، وتعذر نقل أو تأكيد {result.failed_count}.
          </p>
          {result.failed_orders.length > 0 ? (
            <details>
              <summary>Failed or unconfirmed / لم تُنقل أو لم يتم تأكيدها ({result.failed_orders.length})</summary>
              <ul>{result.failed_orders.map((item) => <li key={item.id}><span className="mono">{item.id}</span> — {item.reason}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}
      <section className="toolbar">
        <button type="button" onClick={toggleAll} disabled={eligible.length === 0 || busy}>
          {allEligibleSelected ? 'Clear selection / إلغاء التحديد' : `Select all eligible (${eligible.length}) / تحديد الكل`}
        </button>
        <span className="countLine">
          {loading ? 'Loading… / جارٍ التحميل' : `${orders.length} orders; ${selected.size} selected / ${selected.size} محدد`}
        </span>
      </section>
      {orders.length > 0 ? (
        <table className="table reassignmentTable">
          <thead><tr><th></th><th>Order / الأوردر</th><th>Tracking / التتبع</th><th>Time / الوقت</th><th>Status / الحالة</th><th>Eligibility / قابلية النقل</th></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    disabled={!order.eligible || busy}
                    onChange={() => toggleOrder(order.id)}
                    aria-label={`Select ${order.id}`}
                  />
                </td>
                <td className="mono">{order.id}</td>
                <td className="mono">{order.tracking ?? '—'}</td>
                <td>{order.scheduled_at ? new Date(order.scheduled_at).toLocaleString() : '—'}</td>
                <td><span className="badge">{order.status}</span></td>
                <td>{order.eligible ? 'Ready / جاهز' : blockedReasonLabel(order.blocked_reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!loading && source ? <p className="emptyLine">No orders for this date. / لا توجد أوردرات لهذا التاريخ.</p> : null)}
      <section className="card reviewPanel" style={{ marginTop: 16 }}>
        <label className="row">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={selected.size === 0 || !target || source === target || busy}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I confirm moving {selected.size} selected orders to the target driver.
          {' '}أؤكد نقل {selected.size} أوردر محدد إلى السائق الآخر.
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => void reassign()}
          disabled={busy || !acknowledged || selected.size === 0 || !target || source === target}
        >
          {busy ? 'Reassigning… / جارٍ النقل' : `Reassign ${selected.size} orders / نقل الأوردرات`}
        </button>
      </section>
    </section>
  );
}

function blockedReasonLabel(reason: ReassignmentOrder['blocked_reason']): string {
  if (reason === 'started') return 'Started / بدأ التنفيذ';
  if (reason === 'current_job') return 'Current job / المهمة الحالية';
  if (reason === 'terminal') return 'Completed or canceled / مكتمل أو ملغي';
  return 'Unavailable / غير متاح';
}

function DriverCredentials(): React.JSX.Element {
  const [items, setItems] = useState<CredentialDriver[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<CredentialDriver | null>(null);

  const reload = useCallback(() => {
    setBusy(true);
    setError(null);
    api<ListResponse<CredentialDriver>>('/driver-credentials')
      .then((data) => setItems(data.items))
      .catch((e: unknown) => setError(humanMessage(e)))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <section>
      <section className="toolbar">
        <button type="button" onClick={reload} disabled={busy}>Refresh / تحديث</button>
        <span className="countLine">{busy ? 'Loading… / جارٍ التحميل' : `${items.length} Fleetbase drivers / سائق`}</span>
      </section>
      <p className="hintLine">
        Logistics Manager only. The current password stops working immediately; the new password is never stored or emailed.
        {' '}مدير الخدمات اللوجستية فقط — لا تُحفظ كلمة المرور ولا تُرسل بالبريد.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="hintLine">✓ {success}</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Driver / السائق</th><th>Phone / الهاتف</th><th>Status / الحالة</th><th>Online / متصل</th><th></th></tr></thead>
          <tbody>
            {items.map((driver) => (
              <tr key={driver.id}>
                <td>{driver.name}</td>
                <td className="mono">{driver.phone_hint ?? '—'}</td>
                <td><span className="badge">{driver.status ?? 'unknown'}</span></td>
                <td>{driver.online ? 'yes / نعم' : 'no / لا'}</td>
                <td><button type="button" onClick={() => { setSelected(driver); setSuccess(null); }}>Rotate password / تغيير</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!busy ? <p className="emptyLine">No Fleetbase driver accounts are available. / لا توجد حسابات سائقين.</p> : null)}
      {selected ? (
        <RotateDriverPassword
          driver={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSuccess(`Password rotated for ${selected.name}. / تم تغيير كلمة المرور للسائق ${selected.name}.`);
            setSelected(null);
          }}
        />
      ) : null}
    </section>
  );
}

function RotateDriverPassword({ driver, onClose, onDone }: {
  driver: CredentialDriver;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strong = password.length >= 12
    && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);

  async function rotate(): Promise<void> {
    if (!strong || password !== confirmation || !acknowledged) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/driver-credentials/${encodeURIComponent(driver.id)}/rotate`, {
        method: 'POST',
        body: JSON.stringify({ password, password_confirmation: confirmation }),
      });
      setPassword('');
      setConfirmation('');
      onDone();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  function generate(): void {
    const value = generateStrongPassword();
    setPassword(value);
    setConfirmation(value);
    setShow(true);
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>Rotate password / تغيير كلمة المرور — {driver.name}</h2>
        <button type="button" className="linkBtn" onClick={onClose} disabled={busy}>Close / إغلاق</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="hintLine">Minimum 12 characters with uppercase, lowercase, number, and symbol. / 12 خانة على الأقل مع حرف كبير وصغير ورقم ورمز.</p>
      <div className="grid2">
        <label className="field">
          <span>New password / كلمة المرور الجديدة</span>
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Confirm password / تأكيد كلمة المرور</span>
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={generate} disabled={busy}>Generate strong password / توليد كلمة قوية</button>
        <label><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} /> Show / إظهار</label>
      </div>
      <label className="row" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        I securely copied the new password and understand the current password will stop immediately.
        {' '}نسخت كلمة المرور الجديدة بأمان وأفهم أن القديمة ستتوقف فورًا.
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" onClick={onClose} disabled={busy}>Cancel / إلغاء</button>
        <button
          type="button"
          className="primary"
          onClick={() => void rotate()}
          disabled={busy || !strong || password !== confirmation || !acknowledged}
        >
          {busy ? 'Rotating… / جارٍ التغيير' : 'Rotate password / تغيير كلمة المرور'}
        </button>
      </div>
    </section>
  );
}

function generateStrongPassword(): string {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_'];
  const all = groups.join('');
  const random = new Uint32Array(20);
  crypto.getRandomValues(random);
  const chars = groups.map((group, index) => group[random[index]! % group.length]!);
  for (let index = groups.length; index < 18; index += 1) chars.push(all[random[index]! % all.length]!);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = random[index + 1]! % (index + 1);
    [chars[index], chars[swap]] = [chars[swap]!, chars[index]!];
  }
  return chars.join('');
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
