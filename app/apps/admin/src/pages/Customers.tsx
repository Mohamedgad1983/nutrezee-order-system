import { useState } from 'react';
import { api, ApiError, humanMessage, type ListResponse } from '../api';

// WP-UI-03a — customer admin: search by phone, guided-create (dup block/warn),
// view profile (PII/HEALTH masked per the caller's grants — the server decides),
// edit core fields, add an address. Replaces legacy /users/list/3 + the customer
// search inside /orders/create. The merge-review screen waits on WP-API-02 wiring.

interface CustomerHit { id: string; full_name_en?: string; phone_normalized?: string; masked?: boolean }
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
  masked?: boolean;
}

export function CustomersPage(): React.JSX.Element {
  const [phone, setPhone] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);

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

  return (
    <section className="intake">
      <section className="toolbar">
        <input placeholder="Search by phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ minHeight: 40, border: '1px solid #cbd5d1', borderRadius: 6, padding: '0 10px' }} />
        <button type="button" onClick={() => void search()} disabled={busy || !phone}>Search</button>
        <button type="button" onClick={() => { setCreating(true); setProfile(null); setHits(null); }}>New customer</button>
      </section>
      {error ? <p className="error">{error}</p> : null}

      {creating ? (
        <NewCustomer onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); void openProfile(id); }} />
      ) : null}

      {hits && !profile ? (
        hits.length === 0 ? <p className="emptyLine">No match — try New customer.</p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th></th></tr></thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td>{h.full_name_en ?? '—'}</td>
                  <td className="mono">{h.phone_normalized ?? '—'}</td>
                  <td><button type="button" onClick={() => void openProfile(h.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {profile ? <ProfileCard profile={profile} onReload={() => void openProfile(profile.id)} onClose={() => setProfile(null)} /> : null}
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
          {profile.allergies !== undefined ? (
            <>
              <strong>Allergies</strong>
              <ul className="hits">
                {(profile.allergies ?? []).map((a, i) => <li key={i}><span>{a.name_en ?? '—'}{a.severity ? ` · ${a.severity}` : ''}</span></li>)}
                {(profile.allergies ?? []).length === 0 ? <li><span>none recorded</span></li> : null}
              </ul>
            </>
          ) : null}
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
