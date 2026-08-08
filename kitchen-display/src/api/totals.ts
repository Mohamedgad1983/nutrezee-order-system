import type { KdsMealTotal, KdsSectionTotal, KdsSectionTotals } from '../contracts.js';
import {
  PartnerSourceError,
  type PartnerDay,
  type PartnerSection,
  type PartnerSourceGateway,
} from './partner-source.js';

export type TotalsErrorCode =
  | 'auth_failed'
  | 'not_configured'
  | 'response_invalid'
  | 'unavailable';

export class TotalsError extends Error {
  constructor(readonly code: TotalsErrorCode) {
    super(code);
    this.name = 'TotalsError';
  }
}

interface MutableSection extends Omit<KdsSectionTotal, 'meals'> {
  meals: Map<string, KdsMealTotal>;
}

const UNROUTED: PartnerSection = {
  sectionId: 'unrouted',
  code: 'unrouted',
  nameEn: 'Unrouted',
  nameAr: 'غير موجّه',
  stepNo: null,
  isPacking: false,
};
const QUANTITY_SCALE = 1_000_000;

export class TotalsService {
  constructor(
    private readonly source: PartnerSourceGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async totals(deliveryDate: string, kitchen: string): Promise<KdsSectionTotals> {
    try {
      const day = await this.source.itemsForDay(deliveryDate, kitchen);
      return aggregateDay(day, deliveryDate, kitchen, this.now().toISOString());
    } catch (error) {
      if (error instanceof TotalsError) throw error;
      if (!(error instanceof PartnerSourceError)) throw error;
      if (error.code === 'auth_failed') throw new TotalsError('auth_failed');
      if (error.code === 'not_configured') throw new TotalsError('not_configured');
      if (error.code === 'response_invalid' || error.code === 'pagination_invalid') {
        throw new TotalsError('response_invalid');
      }
      throw new TotalsError('unavailable');
    }
  }
}

/** Converts detailed Partner rows into a deliberately PII-free totals projection. */
export function aggregateDay(
  day: PartnerDay,
  deliveryDate: string,
  kitchen: string,
  generatedAt: string,
): KdsSectionTotals {
  const sections = new Map<string, MutableSection>();
  const sectionIdToCode = new Map<string, string>();
  const sectionCodeToId = new Map<string, string>();
  const mealMetadata = new Map<string, { nameEn: string | null; nameAr: string | null }>();
  let sourceQuantity = 0;
  let assignmentQuantity = 0;
  let unroutedQuantity = 0;

  for (const item of day.items) {
    mergeMealMetadata(mealMetadata, item.mealId, item.nameEn, item.nameAr);
    sourceQuantity = add(sourceQuantity, item.quantity);
    const routes = item.sections.length > 0 ? item.sections : [UNROUTED];
    if (item.sections.length === 0) unroutedQuantity = add(unroutedQuantity, item.quantity);

    for (const route of routes) {
      if (route !== UNROUTED) validateSectionIdentity(sectionIdToCode, sectionCodeToId, route);
      assignmentQuantity = add(assignmentQuantity, item.quantity);
      const sectionKey = `${route.sectionId}\u0000${route.code}`;
      let section = sections.get(sectionKey);
      if (!section) {
        section = {
          section_id: route === UNROUTED ? null : route.sectionId,
          code: route.code,
          name_en: route.nameEn,
          name_ar: route.nameAr,
          step_no: route.stepNo,
          is_packing: route.isPacking,
          unrouted: route === UNROUTED,
          total_qty: 0,
          meals: new Map(),
        };
        sections.set(sectionKey, section);
      } else {
        mergeSectionMetadata(section, route);
      }
      section.total_qty = add(section.total_qty, item.quantity);

      const mealKey = `${item.mealId}\u0000${item.portionSize ?? ''}`;
      const meal = section.meals.get(mealKey);
      if (meal) {
        if ((meal.name_en && item.nameEn && meal.name_en !== item.nameEn)
          || (meal.name_ar && item.nameAr && meal.name_ar !== item.nameAr)) {
          throw new TotalsError('response_invalid');
        }
        meal.total_qty = add(meal.total_qty, item.quantity);
        meal.name_en ??= item.nameEn;
        meal.name_ar ??= item.nameAr;
      } else {
        section.meals.set(mealKey, {
          meal_id: item.mealId,
          name_en: item.nameEn,
          name_ar: item.nameAr,
          portion_size: item.portionSize,
          total_qty: item.quantity,
        });
      }
    }
  }

  return {
    delivery_date: deliveryDate,
    kitchen,
    generated_at: generatedAt,
    source_server_time: day.serverTime,
    summary: {
      source_item_rows: day.items.length,
      source_quantity_total: sourceQuantity,
      section_assignment_quantity_total: assignmentQuantity,
      unrouted_quantity_total: unroutedQuantity,
    },
    sections: [...sections.values()]
      .sort(sectionSort)
      .map((section) => ({
        ...section,
        meals: [...section.meals.values()].map((meal) => {
          const metadata = mealMetadata.get(meal.meal_id);
          return {
            ...meal,
            name_en: metadata?.nameEn ?? meal.name_en,
            name_ar: metadata?.nameAr ?? meal.name_ar,
          };
        }).sort(mealSort),
      })),
  };
}

function validateSectionIdentity(
  idToCode: Map<string, string>,
  codeToId: Map<string, string>,
  route: PartnerSection,
): void {
  const knownCode = idToCode.get(route.sectionId);
  const knownId = codeToId.get(route.code);
  if ((knownCode && knownCode !== route.code) || (knownId && knownId !== route.sectionId)) {
    throw new TotalsError('response_invalid');
  }
  idToCode.set(route.sectionId, route.code);
  codeToId.set(route.code, route.sectionId);
}

function mergeMealMetadata(
  metadata: Map<string, { nameEn: string | null; nameAr: string | null }>,
  mealId: string,
  nameEn: string | null,
  nameAr: string | null,
): void {
  const known = metadata.get(mealId);
  if (!known) {
    metadata.set(mealId, { nameEn, nameAr });
    return;
  }
  if ((known.nameEn && nameEn && known.nameEn !== nameEn)
    || (known.nameAr && nameAr && known.nameAr !== nameAr)) {
    throw new TotalsError('response_invalid');
  }
  known.nameEn ??= nameEn;
  known.nameAr ??= nameAr;
}

function mergeSectionMetadata(section: MutableSection, route: PartnerSection): void {
  if ((section.name_en && route.nameEn && section.name_en !== route.nameEn)
    || (section.name_ar && route.nameAr && section.name_ar !== route.nameAr)
    || (section.step_no !== null && route.stepNo !== null && section.step_no !== route.stepNo)
    || section.is_packing !== route.isPacking) {
    throw new TotalsError('response_invalid');
  }
  section.name_en ??= route.nameEn;
  section.name_ar ??= route.nameAr;
  section.step_no ??= route.stepNo;
}

function add(left: number, right: number): number {
  const leftUnits = left * QUANTITY_SCALE;
  const rightUnits = right * QUANTITY_SCALE;
  if (!Number.isSafeInteger(leftUnits) || !Number.isSafeInteger(rightUnits)) {
    throw new TotalsError('response_invalid');
  }
  const resultUnits = leftUnits + rightUnits;
  if (!Number.isSafeInteger(resultUnits)) throw new TotalsError('response_invalid');
  return resultUnits / QUANTITY_SCALE;
}

function sectionSort(a: MutableSection, b: MutableSection): number {
  if (a.unrouted !== b.unrouted) return a.unrouted ? 1 : -1;
  const aStep = a.step_no ?? Number.MAX_SAFE_INTEGER;
  const bStep = b.step_no ?? Number.MAX_SAFE_INTEGER;
  return aStep - bStep || a.code.localeCompare(b.code);
}

function mealSort(a: KdsMealTotal, b: KdsMealTotal): number {
  const aName = a.name_en ?? a.name_ar ?? a.meal_id;
  const bName = b.name_en ?? b.name_ar ?? b.meal_id;
  return aName.localeCompare(bName) || (a.portion_size ?? '').localeCompare(b.portion_size ?? '');
}
