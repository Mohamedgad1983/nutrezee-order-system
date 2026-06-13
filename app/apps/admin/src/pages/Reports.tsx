import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage } from '../api';

// WP-UI-03b — reports browse (read-only). The 3 MVP reports projected from the
// outbox (M15): intake funnel, daily ops, kitchen day-list. GET /reports/:name
// (per-report report.view.* perm) + JSON export via POST /exports (report.export).
// Reports rebuild from outbox each call, so empty sections are a demo-data gap,
// not a failure — the screen renders zeros cleanly.

const REPORTS = [
  { key: 'intake-funnel', label: 'Intake funnel' },
  { key: 'daily-ops', label: 'Daily ops' },
  { key: 'kitchen-day-list', label: 'Kitchen day-list' },
] as const;
type ReportKey = (typeof REPORTS)[number]['key'];

interface IntakeFunnel {
  drafts_created: number; submitted: number; returned: number;
  approved: number; rejected: number; by_channel: Record<string, number>;
}
interface DailyOps {
  orders_approved: number; orders_cancelled: number; payment_paid: number;
  payment_failed: number; fulfillment_by_status: Record<string, number>;
}
interface KitchenDay {
  tickets_generated: number; unrouted: number;
  per_section: Record<string, number>; ready_to_pack: number; packed: number;
}
interface KitchenDayList { by_date: Record<string, KitchenDay> }

function Metrics({ rows }: { rows: Array<[string, number]> }): React.JSX.Element {
  return (
    <dl className="kv">
      {rows.map(([label, val]) => <div key={label}><dt>{label}</dt><dd>{val.toLocaleString()}</dd></div>)}
    </dl>
  );
}

function Breakdown({ title, record }: { title: string; record: Record<string, number> }): React.JSX.Element {
  const entries = Object.entries(record ?? {});
  return (
    <>
      <strong>{title}</strong>
      {entries.length === 0 ? <p className="emptyLine">none yet — demo-data gap, not a failure.</p> : (
        <table className="table">
          <thead><tr><th>{title}</th><th>Count</th></tr></thead>
          <tbody>{entries.map(([k, v]) => <tr key={k}><td>{k.replaceAll('_', ' ')}</td><td>{v.toLocaleString()}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}

export function ReportsPage(): React.JSX.Element {
  const [report, setReport] = useState<ReportKey>('intake-funnel');
  const [date, setDate] = useState('');
  const [data, setData] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  const query = report === 'kitchen-day-list' && date ? `?date=${date}` : '';

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<{ report: string; data: unknown }>(`/reports/${report}${query}`)
      .then((d) => { if (seq.current === mine) setData(d.data); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [report, query]);

  useEffect(() => { reload(); }, [reload]);

  async function doExport(): Promise<void> {
    setExporting(true);
    setError(null);
    try {
      const res = await api<{ report: string; format: string; generated_at: string; data: unknown }>('/exports', {
        method: 'POST',
        body: JSON.stringify({ report, date: date || undefined }),
      });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report}-${res.generated_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section>
      <div className="segmented">
        {REPORTS.map((r) => (
          <button key={r.key} type="button" className={report === r.key ? 'on' : ''} onClick={() => setReport(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <section className="toolbar">
        {report === 'kitchen-day-list' ? (
          <label>
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : null}
        <button type="button" onClick={reload} disabled={busy}>Refresh</button>
        <button type="button" onClick={() => void doExport()} disabled={exporting}>{exporting ? 'Exporting…' : 'Export JSON'}</button>
        <span className="countLine">{busy ? 'Loading…' : 'Projected from the outbox'}</span>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {!busy && !error && data ? <ReportBody report={report} date={date} data={data} /> : null}
    </section>
  );
}

function ReportBody({ report, date, data }: { report: ReportKey; date: string; data: unknown }): React.JSX.Element {
  if (report === 'intake-funnel') {
    const f = data as IntakeFunnel;
    return (
      <section className="card">
        <Metrics rows={[
          ['Drafts created', f.drafts_created], ['Submitted', f.submitted], ['Returned', f.returned],
          ['Approved', f.approved], ['Rejected', f.rejected],
        ]} />
        <Breakdown title="By channel" record={f.by_channel} />
      </section>
    );
  }
  if (report === 'daily-ops') {
    const d = data as DailyOps;
    return (
      <section className="card">
        <Metrics rows={[
          ['Orders approved', d.orders_approved], ['Orders cancelled', d.orders_cancelled],
          ['Payments paid', d.payment_paid], ['Payments failed', d.payment_failed],
        ]} />
        <Breakdown title="Fulfillment by status" record={d.fulfillment_by_status} />
      </section>
    );
  }
  // kitchen-day-list
  if (date) {
    const k = data as KitchenDay;
    return (
      <section className="card">
        <Metrics rows={[
          ['Tickets generated', k.tickets_generated], ['Unrouted', k.unrouted],
          ['Ready to pack', k.ready_to_pack], ['Packed', k.packed],
        ]} />
        <Breakdown title="Per section" record={k.per_section} />
      </section>
    );
  }
  const list = data as KitchenDayList;
  const dates = Object.entries(list.by_date ?? {});
  return (
    <section className="card">
      {dates.length === 0 ? (
        <p className="emptyLine">No kitchen activity yet — generate kitchen tickets to populate this (demo-data gap, not a failure).</p>
      ) : (
        <table className="table">
          <thead><tr><th>Date</th><th>Tickets</th><th>Unrouted</th><th>Ready</th><th>Packed</th></tr></thead>
          <tbody>
            {dates.map(([d, row]) => (
              <tr key={d}>
                <td>{d}</td><td>{row.tickets_generated}</td><td>{row.unrouted}</td>
                <td>{row.ready_to_pack}</td><td>{row.packed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
