import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage } from '../api';

// WP-UI-03c — settings / masters admin. View + add the four ops-master kinds and
// reason codes over the M16 settings API (GET/POST /settings/masters/:kind,
// GET/POST /settings/reason-codes). Reads need settings.read; adds need
// settings.update.ops. Settings-registry / feature-flag editing stays out of this
// sub-unit (gate keys are higher-risk) — masters + reason codes are the daily-ops parity.

interface FieldDef { k: string; l: string; t?: 'text' | 'number' | 'time'; opt?: boolean }
interface KindDef { kind: string; label: string; cols: string[]; fields: FieldDef[] }

const MASTER_KINDS: KindDef[] = [
  { kind: 'area', label: 'Areas', cols: ['code', 'name_en', 'name_ar', 'active'],
    fields: [{ k: 'code', l: 'Code' }, { k: 'name_en', l: 'Name (EN)' }, { k: 'name_ar', l: 'Name (AR)' }] },
  { kind: 'delivery_slot', label: 'Delivery slots', cols: ['label_en', 'label_ar', 'start_time', 'end_time', 'capacity', 'active'],
    fields: [{ k: 'label_en', l: 'Label (EN)' }, { k: 'label_ar', l: 'Label (AR)' },
      { k: 'start_time', l: 'Start', t: 'time' }, { k: 'end_time', l: 'End', t: 'time' },
      { k: 'capacity', l: 'Capacity', t: 'number', opt: true }] },
  { kind: 'delivery_method', label: 'Delivery methods', cols: ['name_en', 'name_ar', 'active'],
    fields: [{ k: 'name_en', l: 'Name (EN)' }, { k: 'name_ar', l: 'Name (AR)' }] },
  { kind: 'section_master', label: 'Kitchen sections', cols: ['code', 'name_en', 'name_ar', 'active'],
    fields: [{ k: 'code', l: 'Code' }, { k: 'name_en', l: 'Name (EN)' }, { k: 'name_ar', l: 'Name (AR)' }] },
];

const REASON_DOMAINS = [
  'rejection', 'return_to_draft', 'cancellation', 'day_cancel',
  'payment_fail', 'ticket_block', 'escalation', 'complaint', 'merge',
];

const cell = (v: unknown): string =>
  (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

function useRows<T>(path: string): { items: T[]; busy: boolean; error: string | null; reload: () => void } {
  const [items, setItems] = useState<T[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<{ items: T[] }>(path)
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { items, busy, error, reload };
}

export function SettingsPage(): React.JSX.Element {
  const [tab, setTab] = useState<'masters' | 'reason-codes'>('masters');
  return (
    <section>
      <div className="segmented">
        {(['masters', 'reason-codes'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'masters' ? 'Masters' : 'Reason codes'}
          </button>
        ))}
      </div>
      {tab === 'masters' ? <MastersTab /> : <ReasonCodesTab />}
    </section>
  );
}

function MastersTab(): React.JSX.Element {
  const [kindKey, setKindKey] = useState('area');
  const def = MASTER_KINDS.find((k) => k.kind === kindKey) as KindDef;
  const list = useRows<Record<string, unknown>>(`/settings/masters/${def.kind}`);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <section className="toolbar">
        <label>
          <span>Kind</span>
          <select value={kindKey} onChange={(e) => { setKindKey(e.target.value); setAdding(false); }}>
            {MASTER_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={list.reload} disabled={list.busy}>Refresh</button>
        <button type="button" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : `Add ${def.label.replace(/s$/, '').toLowerCase()}`}</button>
        <span className="countLine">{list.busy ? 'Loading…' : `${list.items.length} ${list.items.length === 1 ? 'row' : 'rows'}`}</span>
      </section>
      {list.error ? <p className="error">{list.error}</p> : null}

      {adding ? (
        <AddMaster key={def.kind} def={def} onAdded={() => { setAdding(false); list.reload(); }} />
      ) : null}

      {!list.busy && !list.error && list.items.length === 0 ? <p className="emptyLine">No {def.label.toLowerCase()} yet — add one above.</p> : null}
      {list.items.length > 0 ? (
        <table className="table">
          <thead><tr>{def.cols.map((c) => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={String(row.id)}>
                {def.cols.map((c) => <td key={c} className={c === 'code' ? 'mono' : undefined} dir={c === 'name_ar' || c === 'label_ar' ? 'rtl' : undefined}>{cell(row[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function AddMaster({ def, onAdded }: { def: KindDef; onAdded: () => void }): React.JSX.Element {
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const columns: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = (form[f.k] ?? '').trim();
      if (!v) {
        if (!f.opt) { setError(`${f.l} is required.`); return; }
        continue;
      }
      columns[f.k] = f.t === 'number' ? Number(v) : v;
    }
    setBusy(true);
    setError(null);
    try {
      await api<{ id: string }>(`/settings/masters/${def.kind}`, { method: 'POST', body: JSON.stringify({ columns }) });
      onAdded();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Add {def.label.replace(/s$/, '').toLowerCase()}</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid2">
        {def.fields.map((f) => (
          <label key={f.k} className="field">
            <span>{f.l}{f.opt ? ' (optional)' : ''}</span>
            <input
              type={f.t === 'time' ? 'time' : f.t === 'number' ? 'number' : 'text'}
              dir={f.k.endsWith('_ar') ? 'rtl' : undefined}
              value={form[f.k] ?? ''}
              onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>Add</button>
      </div>
    </section>
  );
}

interface ReasonCode { id: string; code: string; label_en: string; label_ar?: string | null; active?: boolean }

function ReasonCodesTab(): React.JSX.Element {
  const [domain, setDomain] = useState('rejection');
  const list = useRows<ReasonCode>(`/settings/reason-codes?domain=${domain}`);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <section className="toolbar">
        <label>
          <span>Domain</span>
          <select value={domain} onChange={(e) => { setDomain(e.target.value); setAdding(false); }}>
            {REASON_DOMAINS.map((d) => <option key={d} value={d}>{d.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <button type="button" onClick={list.reload} disabled={list.busy}>Refresh</button>
        <button type="button" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add reason code'}</button>
        <span className="countLine">{list.busy ? 'Loading…' : `${list.items.length} ${list.items.length === 1 ? 'code' : 'codes'}`}</span>
      </section>
      {list.error ? <p className="error">{list.error}</p> : null}

      {adding ? <AddReasonCode domain={domain} onAdded={() => { setAdding(false); list.reload(); }} /> : null}

      {!list.busy && !list.error && list.items.length === 0 ? <p className="emptyLine">No reason codes in “{domain.replaceAll('_', ' ')}” yet — add one above.</p> : null}
      {list.items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Code</th><th>Label (EN)</th><th>Label (AR)</th><th>Active</th></tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td>{r.label_en}</td>
                <td dir="rtl">{cell(r.label_ar)}</td>
                <td>{cell(r.active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function AddReasonCode({ domain, onAdded }: { domain: string; onAdded: () => void }): React.JSX.Element {
  const [code, setCode] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!code.trim() || !labelEn.trim()) { setError('Code and Label (EN) are required.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api('/settings/reason-codes', {
        method: 'POST',
        body: JSON.stringify({ domain, code: code.trim(), label_en: labelEn.trim(), label_ar: labelAr.trim() || undefined }),
      });
      onAdded();
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Add reason code · <span className="mono">{domain}</span></h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid2">
        <label className="field"><span>Code</span><input value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label className="field"><span>Label (EN)</span><input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></label>
        <label className="field"><span>Label (AR) (optional)</span><input dir="rtl" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} /></label>
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>Add</button>
      </div>
    </section>
  );
}
