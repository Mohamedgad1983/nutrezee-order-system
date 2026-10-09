// WP-OPS-A85 — read-only: is Partner's live day list equal to the legacy screen reading taken a moment ago
// (membership + driver)? Order numbers and driver ids only. Run inside nutrezee-api; screen manifest at /tmp/screen.json.
import fs from 'node:fs';
const key = (process.env.NUTREEZE_PARTNER_DAILY_API_KEY ?? process.env.NUTREEZE_PARTNER_LABEL_API_KEY ?? '').trim();
const base = process.env.NUTREEZE_PARTNER_LABEL_API_BASE?.trim() || 'https://nutreeze.com/integration';
const date = process.argv[2];
const m = JSON.parse(fs.readFileSync('/tmp/screen.json', 'utf8'));
const t = Date.now();
const r = await fetch(`${base}/daily-deliveries?delivery_date=${date}&limit=1000`, { headers: { Accept: 'application/json', 'X-Api-Key': key } });
const b = await r.json();
const rows = b.data.filter((x) => !x.is_cancelled && !x.is_on_hold);
const api = new Map(rows.map((x) => [String(x.order_number), x.driver?.id == null ? null : String(x.driver.id)]));
const screen = new Set(m.order_numbers.map(String)); const sd = m.drivers || {};
const onlyApi = [...api.keys()].filter((n) => !screen.has(n)); const onlyScreen = [...screen].filter((n) => !api.has(n));
let same = 0, diff = [], apiNull = 0, screenNull = 0;
for (const n of screen) { if (!api.has(n)) continue; const a = api.get(n), s = sd[n] == null ? null : String(sd[n]); if (a === null) apiNull++; if (s === null) screenNull++; if (a === s) same++; else if (diff.length < 12) diff.push([n, 'api', a, 'screen', s]); }
console.log(JSON.stringify({ date, ms: Date.now() - t, server_time: b.server_time, screen_captured: m.captured_at, api_rows: b.data.length, api_active: rows.length, cancelled: b.data.filter((x) => x.is_cancelled).length, on_hold: b.data.filter((x) => x.is_on_hold).length, screen: screen.size, onlyApi, onlyScreen, driver_same: same, apiNull, screenNull, diff }));
