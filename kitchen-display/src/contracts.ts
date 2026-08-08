export interface KdsMealTotal {
  meal_id: string;
  name_en: string | null;
  name_ar: string | null;
  portion_size: string | null;
  total_qty: number;
}

export interface KdsSectionTotal {
  section_id: string | null;
  code: string;
  name_en: string | null;
  name_ar: string | null;
  step_no: number | null;
  is_packing: boolean;
  unrouted: boolean;
  total_qty: number;
  meals: KdsMealTotal[];
}

export interface KdsSectionTotals {
  delivery_date: string;
  kitchen: string;
  generated_at: string;
  source_server_time: string;
  summary: {
    source_item_rows: number;
    source_quantity_total: number;
    section_assignment_quantity_total: number;
    unrouted_quantity_total: number;
  };
  sections: KdsSectionTotal[];
}

export interface KdsDisplayConfig {
  kitchens: string[];
  refresh_seconds: number;
}

export interface KdsApiError {
  error_code: string;
}
