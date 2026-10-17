import { describe, expect, it } from 'vitest';
import { KITCHEN_STICKERS, LabelService, isKitchenSticker } from '../../apps/api/src/modules/m25-label/label.service';

// TS-U (WP-LBL-A96) — the WhatsApp tab's "Kitchen stickers" group on the API side.

const candidate = (selectionId: string, source: 'partner' | 'whatsapp', labelUserId?: string) =>
  ({ selectionId, source, labelUserId, driverId: 'd1', areaKey: 'a1', timeKey: 't1' }) as never;

describe('TS-U A96 kitchen stickers group', () => {
  it('is the WhatsApp labels that carry the kitchen box number', () => {
    expect(isKitchenSticker({ source: 'whatsapp', labelUserId: '8673' })).toBe(true);
    expect(isKitchenSticker({ source: 'whatsapp', labelUserId: null })).toBe(false);
    expect(isKitchenSticker({ source: 'partner', labelUserId: '8673' })).toBe(false);
  });

  it('selects only them, and the whole WhatsApp group still selects all', () => {
    const service = Object.create(LabelService.prototype) as LabelService;
    const all = [candidate('p1', 'partner'), candidate('w1', 'whatsapp', '8673'), candidate('w2', 'whatsapp')];
    const pick = (value: string) => service.selectBatchCandidates(all, {
      deliveryDate: '2026-10-19', filterType: 'source', filterValue: value, selectionIds: undefined,
    } as never).map((c) => (c as { selectionId: string }).selectionId);
    expect(pick(KITCHEN_STICKERS)).toEqual(['w1']);
    expect(pick('whatsapp')).toEqual(['w1', 'w2']);
  });
});
