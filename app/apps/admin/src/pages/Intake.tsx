import { useEffect, useState } from 'react';
import { api, ApiError, humanMessage, type ListResponse } from '../api';
import { navigate } from '../router';

// WP-UI-02a — staff intake draft form, replacing legacy /orders/create. Creates a
// draft via POST /drafts (idempotency-keyed), shows the server completeness verdict,
// then submits. Every option list comes from a live API (catalog + ops-masters);
// the mandatory set is defined by the API (validation_rules_binding BR-003).

type Channel = 'phone' | 'whatsapp' | 'walk_in' | 'staff' | 'other';
const CHANNELS: Channel[] = ['phone', 'whatsapp', 'walk_in', 'staff', 'other'];
// expected_payment_method is a free string [NC — S3/PAY_METHOD]; these are Proposed.
const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'online_link'];

interface Named { id: string; name_en?: string; label_en?: string }
interface CatalogNamed { id: string; nameEn?: string }
interface CustomerHit { id: string; full_name_en?: string; phone_normalized?: string; masked?: boolean }
interface CompletenessWarning { field: string; rule: string }
interface CreatedDraft {
  id: string;
  state: string;
  completeness?: { missing: string[]; warnings: CompletenessWarning[] };
}

const today = (): string => new Date().toISOString().slice(0, 10);
const label = (o: Named): string => o.label_en ?? o.name_en ?? o.id;

export function IntakePage(): React.JSX.Element {
  // reference data
  const [areas, setAreas] = useState<Named[]>([]);
  const [slots, setSlots] = useState<Named[]>([]);
  const [methods, setMethods] = useState<Named[]>([]);
  const [packages, setPackages] = useState<CatalogNamed[]>([]);
  const [products, setProducts] = useState<CatalogNamed[]>([]);

  // form state
  const [channel, setChannel] = useState<Channel>('phone');
  const [custMode, setCustMode] = useState<'search' | 'new' | 'unverified'>('search');
  const [searchPhone, setSearchPhone] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [unverifiedReason, setUnverifiedReason] = useState('');

  const [packageId, setPackageId] = useState('');
  const [itemProduct, setItemProduct] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [items, setItems] = useState<Array<{ product_id: string; qty: number; label: string }>>([]);

  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [areaId, setAreaId] = useState('');
  const [addressText, setAddressText] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [slotId, setSlotId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');

  // whatsapp ref (channel === 'whatsapp')
  const [waSender, setWaSender] = useState('');
  const [waAt, setWaAt] = useState('');
  const [waNote, setWaNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreatedDraft | null>(null);

  useEffect(() => {
    void (async () => {
      const safe = async <T,>(p: string): Promise<T[]> => {
        try {
          return (await api<ListResponse<T>>(p)).items;
        } catch {
          return [];
        }
      };
      setAreas(await safe<Named>('/settings/masters/area?active=true'));
      setSlots(await safe<Named>('/settings/masters/delivery_slot?active=true'));
      setMethods(await safe<Named>('/settings/masters/delivery_method?active=true'));
      setPackages(await safe<CatalogNamed>('/catalog/packages?active=true'));
      setProducts(await safe<CatalogNamed>('/catalog/products?active=true'));
    })();
  }, []);

  async function searchCustomer(): Promise<void> {
    if (!searchPhone) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ListResponse<CustomerHit>>(`/customers?phone=${encodeURIComponent(searchPhone)}`);
      setHits(res.items);
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createCustomer(): Promise<void> {
    if (!newName || !newPhone) {
      setError('Name and phone are required to create a customer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/customers', {
        method: 'POST',
        body: JSON.stringify({ full_name_en: newName, phone: newPhone }),
      });
      setCustomer({ id, label: `${newName} (${newPhone})` });
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === 'duplicate_phone') {
        setError('A customer with this phone already exists — search for them instead.');
      } else if (e instanceof ApiError && e.errorCode === 'possible_duplicate') {
        setError('A similar customer may exist — search by phone to confirm before creating.');
      } else {
        setError(humanMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function addItem(): void {
    if (!itemProduct) return;
    const p = products.find((x) => x.id === itemProduct);
    setItems([...items, { product_id: itemProduct, qty: itemQty, label: p?.nameEn ?? itemProduct }]);
    setItemProduct('');
    setItemQty(1);
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      channel,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      slot_id: slotId || undefined,
      method_id: methodId || undefined,
      expected_payment_method: paymentMethod || undefined,
      notes: notes || undefined,
    };
    if (custMode === 'unverified') {
      body.unverified_customer = true;
      body.unverified_reason = unverifiedReason || undefined;
    } else if (customer) {
      body.customer_id = customer.id;
    }
    if (packageId) body.package_id = packageId;
    if (items.length > 0) body.items = items.map((i) => ({ product_id: i.product_id, qty: i.qty }));
    if (areaId || addressText) {
      body.address_inline = {
        areaId: areaId || undefined,
        addressText: addressText || '',
        deliveryNotes: deliveryNotes || undefined,
      };
    }
    if (channel === 'whatsapp' && waSender) {
      body.whatsapp_ref = { sender_phone: waSender, message_at: waAt, ref_note: waNote || undefined };
    }
    return body;
  }

  async function createDraft(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/drafts', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(buildBody()),
      });
      const full = await api<CreatedDraft>(`/drafts/${id}`);
      setDraft(full);
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitDraft(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/drafts/${draft.id}/submit`, { method: 'POST' });
      navigate('/app/review-queue');
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  const customerChosen = custMode === 'unverified' ? !!unverifiedReason : !!customer;
  const missing = draft?.completeness?.missing ?? [];
  const complete = !!draft && missing.length === 0;

  return (
    <section className="intake">
      {error ? <p className="error">{error}</p> : null}

      <section className="card">
        <h2>Channel &amp; customer</h2>
        <label className="field">
          <span>Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
          </select>
        </label>

        <div className="segmented" role="tablist" aria-label="Customer mode">
          {(['search', 'new', 'unverified'] as const).map((m) => (
            <button key={m} type="button" className={custMode === m ? 'on' : ''} onClick={() => setCustMode(m)}>
              {m === 'search' ? 'Find customer' : m === 'new' ? 'New customer' : 'Unverified'}
            </button>
          ))}
        </div>

        {custMode === 'search' ? (
          <div className="row">
            <input placeholder="Search by phone" value={searchPhone} onChange={(e) => setSearchPhone(e.target.value)} />
            <button type="button" onClick={() => void searchCustomer()} disabled={busy || !searchPhone}>Search</button>
          </div>
        ) : null}
        {custMode === 'search' && hits ? (
          hits.length === 0 ? <p className="emptyLine">No match — try New customer.</p> : (
            <ul className="hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <span>{h.full_name_en ?? '—'} · {h.phone_normalized ?? '—'}</span>
                  <button type="button" onClick={() => setCustomer({ id: h.id, label: h.full_name_en ?? h.id })}>Select</button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {custMode === 'new' ? (
          <div className="row">
            <input placeholder="Full name (EN)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <button type="button" onClick={() => void createCustomer()} disabled={busy || !newName || !newPhone}>Create</button>
          </div>
        ) : null}

        {custMode === 'unverified' ? (
          <label className="field">
            <span>Reason customer is unverified</span>
            <input value={unverifiedReason} onChange={(e) => setUnverifiedReason(e.target.value)} placeholder="e.g. WhatsApp order, profile pending" />
          </label>
        ) : null}

        {customer ? <p className="chosen">Customer: <strong>{customer.label}</strong></p> : null}
      </section>

      {channel === 'whatsapp' ? (
        <section className="card">
          <h2>WhatsApp reference</h2>
          <div className="grid2">
            <label className="field"><span>Sender phone</span><input value={waSender} onChange={(e) => setWaSender(e.target.value)} /></label>
            <label className="field"><span>Message time</span><input value={waAt} onChange={(e) => setWaAt(e.target.value)} placeholder="ISO timestamp" /></label>
          </div>
          <label className="field"><span>Reference note</span><input value={waNote} onChange={(e) => setWaNote(e.target.value)} /></label>
        </section>
      ) : null}

      <section className="card">
        <h2>Selection</h2>
        <label className="field">
          <span>Package</span>
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">— none —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.nameEn ?? p.id}</option>)}
          </select>
        </label>
        <p className="orLine">or add individual items</p>
        <div className="row">
          <select value={itemProduct} onChange={(e) => setItemProduct(e.target.value)}>
            <option value="">— product —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.nameEn ?? p.id}</option>)}
          </select>
          <input type="number" min={1} value={itemQty} onChange={(e) => setItemQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
          <button type="button" onClick={addItem} disabled={!itemProduct}>Add</button>
        </div>
        {items.length > 0 ? (
          <ul className="hits">
            {items.map((i, idx) => (
              <li key={`${i.product_id}-${idx}`}>
                <span>{i.qty}× {i.label}</span>
                <button type="button" onClick={() => setItems(items.filter((_, n) => n !== idx))}>Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card">
        <h2>Schedule &amp; delivery</h2>
        <div className="grid2">
          <label className="field"><span>Start date</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="field"><span>End date</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="field">
            <span>Area</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">— select —</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Delivery slot</span>
            <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
              <option value="">— select —</option>
              {slots.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Delivery method</span>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">— select —</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Payment method</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">— select —</option>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Address</span><input value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Street, building, etc." /></label>
        <label className="field"><span>Delivery notes</span><input value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} /></label>
        <label className="field"><span>Internal notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>

      <section className="card actionsBar">
        {!draft ? (
          <button type="button" className="primary" onClick={() => void createDraft()} disabled={busy || !customerChosen}>
            {busy ? 'Saving…' : 'Create draft'}
          </button>
        ) : (
          <div className="completeness">
            <p>Draft <span className="mono">{draft.id.slice(0, 10)}…</span> saved ({draft.state}).</p>
            {complete ? (
              <p className="ok">All required fields present — ready to submit.</p>
            ) : (
              <div>
                <p className="warn">Incomplete — fill these to submit:</p>
                <ul className="missing">{missing.map((m) => <li key={m}>{m.replaceAll('_', ' ')}</li>)}</ul>
              </div>
            )}
            <div className="row">
              <button type="button" onClick={() => setDraft(null)} disabled={busy}>Keep editing</button>
              <button type="button" className="primary" onClick={() => void submitDraft()} disabled={busy || !complete}>Submit for review</button>
            </div>
          </div>
        )}
        {!customerChosen ? <p className="hintLine">Select or create a customer to begin.</p> : null}
      </section>
    </section>
  );
}
