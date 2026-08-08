import type {
  KdsMealTotalContract, KdsSectionTotalContract, KdsSectionTotalsContract,
} from '@nutrezee/shared';
import {
  PartnerKdsSourceError, type PartnerKdsDay, type PartnerKdsSection,
  type PartnerKdsSourceGateway,
} from './partner-kds-source';

export type KitchenTotalsErrorCode =
  | 'auth_failed'
  | 'not_configured'
  | 'response_invalid'
  | 'unavailable';

export class KitchenTotalsError extends Error {
  constructor(readonly code: KitchenTotalsErrorCode) {
    super(code);
    this.name = 'KitchenTotalsError';
  }
}

type MutableMeal = KdsMealTotalContract;

interface MutableSection extends Omit<KdsSectionTotalContract, 'meals'> {
  meals: Map<string, MutableMeal>;
}

const UNROUTED: PartnerKdsSection = {
  sectionId: 'unrouted',
  code: 'unrouted',
  nameEn: 'Unrouted',
  nameAr: 'غير موجّه',
  stepNo: null,
  isPacking: false,
};

export class KitchenTotalsService {
  constructor(
    private readonly source: PartnerKdsSourceGateway | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async totals(deliveryDate: string, kitchen: string): Promise<KdsSectionTotalsContract> {
    if (!this.source) throw new KitchenTotalsError('not_configured');
    try {
      const day = await this.source.itemsForDay(deliveryDate, kitchen);
      return aggregateKitchenDay(day, deliveryDate, kitchen, this.now().toISOString());
    } catch (error) {
      if (!(error instanceof PartnerKdsSourceError)) throw error;
      if (error.code === 'auth_failed') throw new KitchenTotalsError('auth_failed');
      if (error.code === 'not_configured') throw new KitchenTotalsError('not_configured');
      if (error.code === 'response_invalid' || error.code === 'pagination_invalid') {
        throw new KitchenTotalsError('response_invalid');
      }
      throw new KitchenTotalsError('unavailable');
    }
  }
}

/** Converts detailed Partner order items into a deliberately PII-free section projection. */
export function aggregateKitchenDay(
  day: PartnerKdsDay,
  deliveryDate: string,
  kitchen: string,
  generatedAt: string,
): KdsSectionTotalsContract {
  const sections = new Map<string, MutableSection>();
  let sourceQuantity = 0;
  let assignmentQuantity = 0;
  let unroutedQuantity = 0;

  for (const item of day.items) {
    sourceQuantity = add(sourceQuantity, item.quantity);
    const routes = item.sections.length > 0 ? item.sections : [UNROUTED];
    if (item.sections.length === 0) unroutedQuantity = add(unroutedQuantity, item.quantity);

    for (const route of routes) {
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
          throw new KitchenTotalsError('response_invalid');
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
        meals: [...section.meals.values()].sort(mealSort),
      })),
  };
}

function mergeSectionMetadata(section: MutableSection, route: PartnerKdsSection): void {
  if ((section.name_en && route.nameEn && section.name_en !== route.nameEn)
    || (section.name_ar && route.nameAr && section.name_ar !== route.nameAr)
    || (section.step_no !== null && route.stepNo !== null && section.step_no !== route.stepNo)
    || section.is_packing !== route.isPacking) {
    throw new KitchenTotalsError('response_invalid');
  }
  section.name_en ??= route.nameEn;
  section.name_ar ??= route.nameAr;
  section.step_no ??= route.stepNo;
}

function add(left: number, right: number): number {
  return Number((left + right).toFixed(6));
}

function sectionSort(a: MutableSection, b: MutableSection): number {
  if (a.unrouted !== b.unrouted) return a.unrouted ? 1 : -1;
  const aStep = a.step_no ?? Number.MAX_SAFE_INTEGER;
  const bStep = b.step_no ?? Number.MAX_SAFE_INTEGER;
  return aStep - bStep || a.code.localeCompare(b.code);
}

function mealSort(a: MutableMeal, b: MutableMeal): number {
  const aName = a.name_en ?? a.name_ar ?? a.meal_id;
  const bName = b.name_en ?? b.name_ar ?? b.meal_id;
  return aName.localeCompare(bName) || (a.portion_size ?? '').localeCompare(b.portion_size ?? '');
}
