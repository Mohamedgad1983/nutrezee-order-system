import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// TS-U (WP-LBL-A97) — the Kitchen Stickers page: the live sticker drawn from the form.
const file = new URL('../../../ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/kitchen-stickers.js', import.meta.url);
function load() {
  const source = readFileSync(file, 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/@(?:tracked|service) /g, '')
    .replace(/^\s*@action\s*$/gm, '')
    .replace(/^\s*@action /gm, '')
    .replace(/export function /g, 'function ')
    .replace('export default class', 'const Page = class');
  return new Function('Component', 'fitLabels', `${source}\nreturn { Page, daysLeft, stickerPackage };`)(class {}, vi.fn());
}

describe('TS-U A97 kitchen stickers page', () => {
  const { Page, daysLeft, stickerPackage } = load();

  it('counts delivery days without Fridays and writes the plan line like the sync', () => {
    expect(daysLeft('2026-10-19', '2026-10-25')).toBe(6); // Fri 23rd skipped
    expect(daysLeft('2026-10-19', '2026-10-18')).toBeNull();
    expect(daysLeft('2026-10-19', '')).toBeNull();
    expect(stickerPackage({ protein_g: '150', carb_g: '300', breakfast: '0' })).toBe('Protein 150g / Carb 300g');
    expect(stickerPackage({ protein_g: '', carb_g: '90', breakfast: '1' })).toBe('Carb 90g · Breakfast 1');
  });

  it('draws the sticker from what is typed and lists, searches and opens stickers', () => {
    Page.prototype.load = vi.fn();
    const page = new Page();
    page.data = {
      delivery_date: '2026-10-20', today: '2026-10-19',
      areas: [{ label: 'Salam', driver: 'Arsad' }],
      stickers: [
        { id: 's1', name: 'Omar', mobile: '66818181', box: '9027', area: 'Salam', active: true, end_date: '2026-10-22', notes: 'DRY FOOD', start_date: '2026-10-19', meals_per_day: 2, snacks_per_day: 1, breakfast: 0, protein_g: 150, carb_g: 300 },
        { id: 's2', name: 'Old', mobile: '50000000', box: '1', area: 'Adan', active: false, end_date: null },
      ],
    };
    expect(page.stickers.map((s: { id: string }) => s.id)).toEqual(['s1']);
    page.toggleStopped();
    expect(page.stickers.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
    page.searchList({ target: { value: '9027' } });
    expect(page.stickers.map((s: { id: string }) => s.id)).toEqual(['s1']);

    page.open(page.data.stickers[0]);
    expect(page.preview).toMatchObject({
      fullName: 'Omar', subscription: 'Tuesday 20th October 2026', daysRemaining: '3', legacyUserId: '9027',
      orderNumber: 'WA-66818181', packageName: 'Protein 150g / Carb 300g', mealsPerDay: '2', notes: 'DRY FOOD', hasNotes: true,
    });
    expect(page.areaDriver).toContain('Arsad');
    page.update('notes', { target: { value: '' } });
    expect(page.preview.hasNotes).toBe(false);
    page.startNew();
    expect(page.isNew).toBe(true);
    expect(page.form.start_date).toBe('2026-10-20');
    expect(page.preview.fullName).toBe('-');
  });
});
