import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage } from '../api';

// WP-UI-03c — staff & roles admin (M12 staff + M13 grants). List staff (email/phone
// PII-masked server-side per the caller's grants), grant/revoke roles, deactivate, and
// view the RBAC matrix. All over existing endpoints — GET /staff, GET /rbac/matrix,
// POST /staff, /rbac/grants, /rbac/revoke, /staff/:id/deactivate. Replaces legacy /users.

interface StaffRow {
  id: string; name_en?: string; name_ar?: string | null; email?: string | null;
  phone?: string | null; active?: boolean; locale?: string; roles?: string[]; masked?: boolean;
}
type Matrix = Record<string, { permissions: string[]; dormant: boolean }>;

export function StaffPage(): React.JSX.Element {
  const [tab, setTab] = useState<'staff' | 'roles'>('staff');
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    api<Matrix>('/rbac/matrix').then(setMatrix).catch(() => setMatrix(null));
  }, []);
  const roleCodes = matrix ? Object.keys(matrix) : [];

  return (
    <section>
      <div className="segmented">
        {(['staff', 'roles'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'staff' ? 'Staff' : 'Roles (RBAC matrix)'}
          </button>
        ))}
      </div>
      {tab === 'staff' ? <StaffTab roleCodes={roleCodes} /> : <RolesTab matrix={matrix} />}
    </section>
  );
}

function StaffTab({ roleCodes }: { roleCodes: string[] }): React.JSX.Element {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<StaffRow[]>('/staff')
      .then((d) => { if (seq.current === mine) setRows(d); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const manage = rows.find((r) => r.id === manageId) ?? null;

  return (
    <>
      <section className="toolbar">
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <button type="button" onClick={() => { setCreating((c) => !c); setManageId(null); }}>{creating ? 'Close' : 'New staff'}</button>
        <span className="countLine">{busy ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'member' : 'members'}`}</span>
      </section>
      {error ? <p className="error">{error}</p> : null}

      {creating ? <NewStaff onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} /> : null}

      {rows.length > 0 ? (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name_en ?? '—'}</td>
                <td>{r.email ?? '—'}{r.masked ? ' 🔒' : ''}</td>
                <td>{(r.roles ?? []).map((role) => <span key={role} className="badge" style={{ marginRight: 4 }}>{role}</span>)}</td>
                <td>{r.active ? 'yes' : 'no'}</td>
                <td><button type="button" onClick={() => setManageId(r.id === manageId ? null : r.id)}>{r.id === manageId ? 'Close' : 'Manage'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {manage ? <ManageStaff staff={manage} roleCodes={roleCodes} onChanged={reload} onClose={() => setManageId(null)} /> : null}
    </>
  );
}

function ManageStaff({ staff, roleCodes, onChanged, onClose }: {
  staff: StaffRow; roleCodes: string[]; onChanged: () => void; onClose: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantRole, setGrantRole] = useState('');
  const current = staff.roles ?? [];
  const grantable = roleCodes.filter((r) => !current.includes(r));

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>{staff.name_en ?? 'Staff'} {staff.active === false ? <span className="badge">inactive</span> : null}</h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <strong>Roles</strong>
      <ul className="hits">
        {current.length === 0 ? <li><span>no roles</span></li> : null}
        {current.map((role) => (
          <li key={role}>
            <span className="badge">{role}</span>{' '}
            <button type="button" className="linkBtn" disabled={busy} onClick={() => void run(() => api('/rbac/revoke', { method: 'POST', body: JSON.stringify({ staff_id: staff.id, role }) }))}>revoke</button>
          </li>
        ))}
      </ul>

      <div className="decideRow">
        <label className="field">
          <span>Grant role</span>
          <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)}>
            <option value="">— select —</option>
            {grantable.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={busy || !grantRole}
            onClick={() => void run(() => api('/rbac/grants', { method: 'POST', body: JSON.stringify({ staff_id: staff.id, role: grantRole }) }).then(() => setGrantRole('')))}>
            Grant
          </button>
          {staff.active !== false ? (
            <button type="button" disabled={busy}
              onClick={() => { if (confirm(`Deactivate ${staff.name_en ?? 'this staff member'}?`)) void run(() => api(`/staff/${staff.id}/deactivate`, { method: 'POST' })); }}>
              Deactivate
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function NewStaff({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }): React.JSX.Element {
  const [nameEn, setNameEn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    if (!nameEn.trim() || !email.trim()) { setError('Name and email are required.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api<{ id: string }>('/staff', {
        method: 'POST',
        body: JSON.stringify({ name_en: nameEn.trim(), email: email.trim(), phone: phone.trim() || undefined, password: password || undefined }),
      });
      onCreated();
    } catch (e) { setError(humanMessage(e)); setBusy(false); }
  }

  return (
    <section className="card">
      <h2>New staff</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid2">
        <label className="field"><span>Name (EN)</span><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
        <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Phone (optional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>Password (optional)</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </div>
      <p className="hintLine">A staff member without a password can’t sign in until one is set.</p>
      <div className="row">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="primary" onClick={() => void create()} disabled={busy || !nameEn || !email}>Create</button>
      </div>
    </section>
  );
}

function RolesTab({ matrix }: { matrix: Matrix | null }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  if (!matrix) return <p className="emptyLine">Loading the RBAC matrix…</p>;
  const roles = Object.entries(matrix).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <p className="hintLine">Read-only — the role→permission matrix from the server (M13). Dormant roles are seeded but unused until the workshop legitimises them.</p>
      <table className="table">
        <thead><tr><th>Role</th><th>Permissions</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {roles.map(([role, info]) => (
            <Fragment key={role}>
              <tr>
                <td className="mono">{role}</td>
                <td>{info.permissions.length}</td>
                <td>{info.dormant ? <span className="badge">dormant</span> : <span className="badge st-active">active</span>}</td>
                <td><button type="button" onClick={() => setOpen(open === role ? null : role)}>{open === role ? 'Hide' : 'View'}</button></td>
              </tr>
              {open === role ? (
                <tr>
                  <td colSpan={4}>
                    <div className="hits" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {info.permissions.length === 0 ? <span className="emptyLine">no permissions</span> : info.permissions.map((p) => <span key={p} className="badge" style={{ marginRight: 4 }}>{p}</span>)}
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
