import { useEffect, useState } from 'react';
import { api, ApiError, humanMessage, type ListResponse, type OrderListItem } from '../api';

// WP-UI-03a — customer admin: search by phone, guided-create (dup block/warn),
// view profile (PII/HEALTH masked per the caller's grants — the server decides),
// edit core fields, add an address. Replaces legacy /users/list/3 + the customer
// search inside /orders/create. The merge-review screen waits on WP-API-02 wiring.

interface SubscriptionFields {
  subscription_status?: string;
  subscription_expire_date?: string | null;
  days_remaining?: number | null;
  is_expired?: boolean;
  is_expiring_soon?: boolean;
}
interface CustomerHit extends SubscriptionFields { id: string; full_name_en?: string; phone_normalized?: string; status?: string; masked?: boolean }

// Subscription expiry summary (from fulfillment_day; see subscription_expiry foundation).
function subscriptionLabel(s: SubscriptionFields): string {
  if (!s.subscription_expire_date || s.subscription_status === 'unknown' || !s.subscription_status) return '—';
  const days = typeof s.days_remaining === 'number' ? ` (${s.days_remaining}d)` : '';
  return `${s.subscription_expire_date} · ${s.subscription_status}${days}`;
}
interface CustomerList extends ListResponse<CustomerHit> { page: { limit: number; offset?: number; total?: number } }
const PAGE = 50;
interface Phone { phone_normalized?: string; label?: string | null; is_primary?: boolean; whatsapp?: boolean }
interface Address { id: string; label?: string | null; area_id?: string | null; address_text?: string; active?: boolean }
interface Profile {
  id: string;
  full_name_en?: string;
  full_name_ar?: string | null;
  email?: string | null;
  dob?: string | null;
  language?: string;
  status?: string;
  notes?: string | null;
  phones?: Phone[];
  addresses?: Address[];
  allergies?: Array<{ name_en?: string; severity?: string | null; note?: string | null }>;
  subscription?: SubscriptionFields & { source_confidence?: string };
  masked?: boolean;
}

function CustomerTable({ rows, onOpen }: { rows: CustomerHit[]; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <table className="table">
      <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Subscription</th><th></th></tr></thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.id}>
            <td>{h.full_name_en ?? '—'}</td>
            <td className="mono">{h.phone_normalized ?? '—'}</td>
            <td>{h.status ?? '—'}</td>
            <td>{subscriptionLabel(h)}</td>
            <td><button type="button" onClick={() => onOpen(h.id)}>Open</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CustomersPage(): React.JSX.Element {
  const [phone, setPhone] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [list, setList] = useState<CustomerHit[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);

  async function loadList(off: number): Promise<void> {
    setBusy(true); setError(null);
    try {
      const res = await api<CustomerList>(`/customers?limit=${PAGE}&offset=${off}`);
      setList(res.items); setTotal(res.page.total ?? res.items.length); setOffset(off);
    } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }

  useEffect(() => { void loadList(0); }, []);

  async function search(): Promise<void> {
    if (!phone) return;
    setBusy(true); setError(null); setProfile(null);
    try {
      const res = await api<ListResponse<CustomerHit>>(`/customers?phone=${encodeURIComponent(phone)}`);
      setHits(res.items);
    } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }

  async function openProfile(id: string): Promise<void> {
    setBusy(true); setError(null);
    try {
      setProfile(await api<Profile>(`/customers/${id}`));
    } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }

  function backToList(): void { setHits(null); setProfile(null); setCreating(false); setMerging(false); setPhone(''); }

  const showList = !creating && !merging && !profile && !hits;
  return (
    <section className="intake">
      <section className="toolbar">
        <input placeholder="Search by phone" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} style={{ minHeight: 40, border: '1px solid #cbd5d1', borderRadius: 6, padding: '0 10px' }} />
        <button type="button" onClick={() => void search()} disabled={busy || !phone}>Search</button>
        <button type="button" onClick={backToList}>All customers</button>
        <button type="button" onClick={() => { setCreating(true); setProfile(null); setHits(null); setMerging(false); }}>New customer</button>
        <button type="button" onClick={() => { setMerging(true); setProfile(null); setHits(null); setCreating(false); }}>Merge duplicates</button>
      </section>
      {error ? <p className="error">{error}</p> : null}

      {creating ? (
        <NewCustomer onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); void openProfile(id); }} />
      ) : null}

      {hits && !profile ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Search results ({hits.length})</strong>
            <button type="button" className="linkBtn" onClick={backToList}>← All customers</button>
          </div>
          {hits.length === 0 ? <p className="emptyLine">No match — try New customer.</p> : <CustomerTable rows={hits} onOpen={(id) => void openProfile(id)} />}
        </>
      ) : null}

      {showList ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>All customers</strong>
            <span className="hintLine">{total ? `${offset + 1}–${Math.min(offset + list.length, total)} of ${total.toLocaleString()}` : ''}</span>
          </div>
          {list.length === 0 ? <p className="emptyLine">{busy ? 'Loading…' : 'No customers yet.'}</p> : <CustomerTable rows={list} onOpen={(id) => void openProfile(id)} />}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" onClick={() => void loadList(Math.max(offset - PAGE, 0))} disabled={busy || offset === 0}>← Prev</button>
            <button type="button" onClick={() => void loadList(offset + PAGE)} disabled={busy || offset + list.length >= total}>Next →</button>
          </div>
        </>
      ) : null}

      {merging ? <MergePanel onClose={() => setMerging(false)} /> : null}

      {profile ? <ProfileCard profile={profile} onReload={() => void openProfile(profile.id)} onClose={() => setProfile(null)} /> : null}
    </section>
  );
}

// WP-UI-05 — surfaces the WP-API-02 merge/undo API. Pick a winner + a duplicate by
// phone; merge re-parents the duplicate's children/drafts/orders to the winner and
// deactivates it; undo restores within merge_undo_days.
function CustomerPicker({ label, selected, onSelect }: {
  label: string; selected: { id: string; name: string } | null; onSelect: (c: { id: string; name: string } | null) => void;
}): React.JSX.Element {
  const [phone, setPhone] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(): Promise<void> {
    if (!phone) return;
    setBusy(true);
    try {
      const res = await api<ListResponse<CustomerHit>>(`/customers?phone=${encodeURIComponent(phone)}`);
      setHits(res.items);
    } catch { setHits([]); } finally { setBusy(false); }
  }

  return (
    <label className="field">
      <span>{label}</span>
      {selected ? (
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <strong>{selected.name}</strong>
          <button type="button" className="linkBtn" onClick={() => onSelect(null)}>change</button>
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <input placeholder="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button type="button" onClick={() => void find()} disabled={busy || !phone}>Find</button>
          </div>
          {hits ? (
            hits.length === 0 ? <span className="hintLine">no match</span> : (
              <ul className="hits">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="linkBtn" onClick={() => onSelect({ id: h.id, name: h.full_name_en ?? h.id })}>
                      {h.full_name_en ?? '—'} · <span className="mono">{h.phone_normalized ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      )}
    </label>
  );
}

function MergePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const [loser, setLoser] = useState<{ id: string; name: string } | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [done, setDone] = useState<'merged' | 'undone' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge(): Promise<void> {
    if (!winner || !loser) return;
    setBusy(true); setError(null);
    try {
      const { id } = await api<{ id: string }>('/customers/merge', {
        method: 'POST', body: JSON.stringify({ winner_id: winner.id, loser_id: loser.id }),
      });
      setMergeId(id); setDone('merged');
    } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }

  async function undo(): Promise<void> {
    if (!mergeId) return;
    setBusy(true); setError(null);
    try {
      await api(`/customers/merge/${mergeId}/undo`, { method: 'POST' });
      setDone('undone');
    } catch (e) { setError(humanMessage(e)); } finally { setBusy(false); }
  }

  const sameId = !!winner && !!loser && winner.id === loser.id;
  return (
    <section className="card">
      <div className="panelHead">
        <h2>Merge duplicate customers</h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="hintLine">The duplicate's phones, addresses, drafts and orders move to the kept customer; the duplicate is deactivated. Undo is available within the merge-undo window.</p>
      <div className="grid2">
        <CustomerPicker label="Keep (winner)" selected={winner} onSelect={setWinner} />
        <CustomerPicker label="Remove (duplicate)" selected={loser} onSelect={setLoser} />
      </div>
      {done === 'merged' ? (
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="badge st-decided">merged</span>
          <button type="button" onClick={() => void undo()} disabled={busy}>Undo merge</button>
        </div>
      ) : done === 'undone' ? (
        <div className="row"><span className="badge">merge undone</span></div>
      ) : (
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <button type="button" className="primary" disabled={busy || !winner || !loser || sameId} onClick={() => void merge()}>Merge</button>
          {sameId ? <span className="hintLine">pick two different customers</span> : null}
        </div>
      )}
    </section>
  );
}

function NewCustomer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  async function create(): Promise<void> {
    if (!name || !phone) { setError('Name and phone are required.'); return; }
    setBusy(true); setError(null); setWarn(null);
    try {
      const { id } = await api<{ id: string }>('/customers', {
        method: 'POST',
        body: JSON.stringify({ full_name_en: name, phone, email: email || undefined, force }),
      });
      onCreated(id);
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === 'duplicate_phone') {
        setError('A customer with this phone already exists — search for them instead.');
      } else if (e instanceof ApiError && e.errorCode === 'possible_duplicate') {
        setWarn('A similar name+DOB may already exist. Tick "create anyway" to proceed, or search first.');
      } else { setError(humanMessage(e)); }
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>New customer</h2>
      {error ? <p className="error">{error}</p> : null}
      {warn ? <p className="hintLine">{warn}</p> : null}
      <div className="grid2">
        <label className="field"><span>Full name (EN)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>Email (optional)</span><input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      {warn ? <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} style={{ minHeight: 'auto' }} /><span style={{ textTransform: 'none' }}>Create anyway (override duplicate warning)</span></label> : null}
      <div className="row">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="primary" onClick={() => void create()} disabled={busy || !name || !phone}>Create</button>
      </div>
    </section>
  );
}

function ProfileCard({ profile, onReload, onClose }: { profile: Profile; onReload: () => void; onClose: () => void }): React.JSX.Element {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name_en: profile.full_name_en ?? '',
    email: profile.email ?? '',
    dob: profile.dob ?? '',
    notes: profile.notes ?? '',
  });

  async function save(): Promise<void> {
    setBusy(true); setError(null);
    try {
      await api(`/customers/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name_en: form.full_name_en || undefined,
          email: form.email || undefined,
          dob: form.dob || undefined,
          notes: form.notes || undefined,
        }),
      });
      setEdit(false);
      onReload();
    } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>{profile.full_name_en ?? 'Customer'} {profile.masked ? <span className="badge">masked</span> : null}</h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {!edit ? (
        <>
          <dl className="kv">
            <div><dt>Name (EN)</dt><dd>{profile.full_name_en ?? '—'}</dd></div>
            <div><dt>Email</dt><dd>{profile.email ?? '—'}</dd></div>
            <div><dt>DOB</dt><dd>{profile.dob ?? '—'}</dd></div>
            <div><dt>Status</dt><dd>{profile.status ?? '—'}</dd></div>
            <div><dt>Subscription expires</dt><dd>{profile.subscription ? subscriptionLabel(profile.subscription) : '—'}</dd></div>
            <div><dt>Notes</dt><dd>{profile.notes ?? '—'}</dd></div>
          </dl>
          <strong>Phones</strong>
          <ul className="hits">
            {(profile.phones ?? []).map((p, i) => <li key={i}><span className="mono">{p.phone_normalized ?? '—'}{p.is_primary ? ' · primary' : ''}{p.whatsapp ? ' · whatsapp' : ''}</span></li>)}
            {(profile.phones ?? []).length === 0 ? <li><span>—</span></li> : null}
          </ul>
          <strong>Addresses</strong>
          <ul className="hits">
            {(profile.addresses ?? []).map((a) => <li key={a.id}><span>{a.address_text ?? '—'}{a.active === false ? ' (inactive)' : ''}</span></li>)}
            {(profile.addresses ?? []).length === 0 ? <li><span>—</span></li> : null}
          </ul>
          <AddAddressForm customerId={profile.id} onAdded={onReload} />
          {profile.allergies !== undefined ? (
            <>
              <strong>Allergies</strong>
              <ul className="hits">
                {(profile.allergies ?? []).map((a, i) => <li key={i}><span>{a.name_en ?? '—'}{a.severity ? ` · ${a.severity}` : ''}</span></li>)}
                {(profile.allergies ?? []).length === 0 ? <li><span>none recorded</span></li> : null}
              </ul>
            </>
          ) : null}
          <CustomerOrderHistory customerId={profile.id} />
          <div className="row"><button type="button" className="primary" onClick={() => setEdit(true)}>Edit</button></div>
        </>
      ) : (
        <div className="decideRow">
          <div className="grid2">
            <label className="field"><span>Name (EN)</span><input value={form.full_name_en} onChange={(e) => setForm({ ...form, full_name_en: e.target.value })} /></label>
            <label className="field"><span>Email</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span>DOB</span><input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></label>
          </div>
          <label className="field"><span>Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="row">
            <button type="button" onClick={() => setEdit(false)} disabled={busy}>Cancel</button>
            <button type="button" className="primary" onClick={() => void save()} disabled={busy}>Save</button>
          </div>
        </div>
      )}
    </section>
  );
}

function AddAddressForm({ customerId, onAdded }: { customerId: string; onAdded: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    if (!address.trim()) {
      setError('Address text is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${customerId}/addresses`, {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim() || undefined,
          address_text: address.trim(),
          delivery_notes: notes.trim() || undefined,
        }),
      });
      setLabel('');
      setAddress('');
      setNotes('');
      setBusy(false);
      setOpen(false);
      onAdded();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="linkBtn" onClick={() => setOpen(true)}>+ Add address</button>;
  }

  return (
    <div className="decideRow" style={{ marginTop: 8 }}>
      <strong>Add address</strong>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid2">
        <label className="field"><span>Label</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Home, office, branch" /></label>
        <label className="field"><span>Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
      </div>
      <label className="field"><span>Delivery notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="row">
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>Cancel</button>
        <button type="button" className="primary" onClick={() => void add()} disabled={busy || !address.trim()}>Save address</button>
      </div>
      <p className="hintLine">Area stays optional until the workshop supplies the final area list.</p>
    </div>
  );
}

function CustomerOrderHistory({ customerId }: { customerId: string }): React.JSX.Element {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    api<ListResponse<OrderListItem>>(`/orders?customer_id=${encodeURIComponent(customerId)}&limit=10`)
      .then((d) => {
        if (cancelled) return;
        setOrders(d.items);
        setTotal(d.page.total ?? d.items.length);
      })
      .catch((e) => { if (!cancelled) setError(humanMessage(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [customerId]);

  return (
    <div>
      <strong>Order history</strong>
      {error ? <p className="hintLine">Order history unavailable: {error}</p> : null}
      {!error && busy ? <p className="emptyLine">Loading orders…</p> : null}
      {!error && !busy && orders.length === 0 ? <p className="emptyLine">No orders for this customer yet.</p> : null}
      {orders.length > 0 ? (
        <table className="table">
          <thead><tr><th>Order</th><th>Dates</th><th>Payment</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.order_number}</td>
                <td>{o.start_date} → {o.end_date}</td>
                <td>{o.payment_status ? <span className={`badge st-${o.payment_status}`}>{o.payment_status}</span> : '—'}</td>
                <td><span className={`badge st-${o.status}`}>{o.status}</span></td>
                <td>{typeof o.total === 'number' ? (o.total / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) : o.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {total > orders.length ? <p className="hintLine">Showing latest {orders.length} of {total.toLocaleString()} orders.</p> : null}
    </div>
  );
}
