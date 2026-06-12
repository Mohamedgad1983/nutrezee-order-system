import { useEffect, useMemo, useState } from 'react';
import { api, humanMessage } from '../api';

interface KitchenTicket {
  id: string;
  fulfillment_day_id: string;
  order_id: string;
  date: string;
  section_id: string | null;
  section_code: string | null;
  section_name_en: string | null;
  unrouted: boolean;
  status: 'queued' | 'in_progress' | 'prepared' | 'blocked';
  allergy_marker: boolean;
  item_refs: Array<{ name_en?: string; qty?: number; allergen_count?: number }>;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function KitchenBoardPage(): React.JSX.Element {
  const [date, setDate] = useState(today());
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => {
    const grouped = new Map<string, KitchenTicket[]>();
    for (const ticket of tickets) {
      const key = ticket.unrouted ? 'unrouted' : (ticket.section_code ?? 'section');
      grouped.set(key, [...(grouped.get(key) ?? []), ticket]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tickets]);

  async function loadBoard(nextDate = date): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ items: KitchenTicket[] }>(`/kitchen/board?date=${encodeURIComponent(nextDate)}`);
      setTickets(data.items);
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadBoard(date);
  }, []);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api('/kitchen/generate-tickets', {
        method: 'POST',
        body: JSON.stringify({ date, generation_batch: `manual:${date}` }),
      });
      await loadBoard(date);
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  async function transition(ticket: KitchenTicket, to: KitchenTicket['status']): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/tickets/${ticket.id}/transitions`, {
        method: 'POST',
        body: JSON.stringify({
          to,
          reason_code: to === 'blocked' ? 'other' : undefined,
          device_session: 'kitchen-board',
          name_tap: 'Kitchen',
        }),
      });
      await loadBoard(date);
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  async function pack(dayId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/kitchen/fulfillment-days/${dayId}/pack`, { method: 'POST', body: '{}' });
      await loadBoard(date);
    } catch (e) {
      setError(humanMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="kitchen">
      <section className="toolbar" aria-label="Kitchen board controls">
        <label>
          <span>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              void loadBoard(e.target.value);
            }}
          />
        </label>
        <button type="button" onClick={() => void generate()} disabled={busy}>Generate</button>
        <button type="button" onClick={() => void loadBoard(date)} disabled={busy}>Refresh</button>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <section className="board" aria-busy={busy}>
        {sections.length === 0 ? <p className="emptyLine">No tickets</p> : null}
        {sections.map(([section, items]) => (
          <article className="lane" key={section}>
            <header>
              <h2>{section === 'unrouted' ? 'Unrouted' : (items[0]?.section_name_en ?? section)}</h2>
              <span>{items.length}</span>
            </header>
            {items.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                busy={busy}
                onTransition={transition}
                onPack={pack}
              />
            ))}
          </article>
        ))}
      </section>
    </section>
  );
}

function TicketCard({
  ticket,
  busy,
  onTransition,
  onPack,
}: {
  ticket: KitchenTicket;
  busy: boolean;
  onTransition: (ticket: KitchenTicket, to: KitchenTicket['status']) => Promise<void>;
  onPack: (dayId: string) => Promise<void>;
}): React.JSX.Element {
  const itemText = ticket.item_refs.map((item) => `${item.qty ?? 1}x ${item.name_en ?? 'Item'}`).join(', ');
  return (
    <section className={`ticket ${ticket.status}`}>
      <div className="ticketHead">
        <strong>{ticket.status.replaceAll('_', ' ')}</strong>
        {ticket.allergy_marker ? <span className="marker">Allergy</span> : null}
      </div>
      <p>{itemText}</p>
      <div className="actions">
        {ticket.status === 'queued' || ticket.status === 'blocked'
          ? <button type="button" disabled={busy} onClick={() => void onTransition(ticket, 'in_progress')}>Start</button>
          : null}
        {ticket.status === 'in_progress'
          ? <button type="button" disabled={busy} onClick={() => void onTransition(ticket, 'prepared')}>Prepared</button>
          : null}
        {ticket.status !== 'prepared'
          ? <button type="button" disabled={busy} onClick={() => void onTransition(ticket, 'blocked')}>Block</button>
          : null}
        {ticket.status === 'prepared'
          ? <button type="button" disabled={busy} onClick={() => void onPack(ticket.fulfillment_day_id)}>Pack Day</button>
          : null}
      </div>
    </section>
  );
}
