// Contract types are mirrored from 11_API_Design/module_api_contracts.md from WP-01
// onward. The markdown contract document is the single source of truth; if code and
// document diverge, log an amendment and fix the types.

export interface HealthStatus {
  status: 'ok';
  service: string;
}

export type DraftChannel = 'whatsapp' | 'phone' | 'walk_in' | 'staff' | 'other';
export type DraftState = 'open' | 'submitted' | 'returned' | 'converted' | 'rejected' | 'cancelled' | 'expired';

export interface DraftItemContract {
  product_id: string;
  qty?: number;
  note?: string;
}

export interface DraftAddressInlineContract {
  label?: string;
  areaId?: string;
  addressText?: string;
  deliveryNotes?: string;
  contactPhone?: string;
}

export interface WhatsappRefContract {
  sender_phone: string;
  message_at: string;
  ref_note?: string;
}

export interface DraftCreateContract {
  channel: DraftChannel;
  customer_id?: string;
  unverified_customer?: boolean;
  unverified_reason?: string;
  package_id?: string;
  start_date?: string;
  end_date?: string;
  address_id?: string;
  address_inline?: DraftAddressInlineContract;
  slot_id?: string;
  method_id?: string;
  coupon_code?: string;
  expected_payment_method?: string;
  price_estimate?: number;
  notes?: string;
  items?: DraftItemContract[];
  whatsapp_ref?: WhatsappRefContract;
}

export interface DraftCompletenessContract {
  missing: string[];
  warnings: Array<{ field: string; rule: string; detail?: unknown }>;
  checked_at: string;
}

export interface DraftContract {
  id: string;
  state: DraftState;
  channel: DraftChannel;
  completeness: DraftCompletenessContract;
  whatsapp_ref_attached: boolean;
  version: number;
}

export type ReviewQueueState = 'waiting' | 'in_review' | 'decided';
export type ReviewDecision = 'approve' | 'reject' | 'return' | 'hold';

export interface ReviewQueueItemContract {
  id: string;
  draft_id: string;
  entered_at: string;
  sla_due_at: string;
  sla_late: boolean;
  reviewer_id: string | null;
  queue_state: ReviewQueueState;
  draft_state: DraftState | string;
  channel: DraftChannel | string;
  missing: string[];
  warnings: DraftCompletenessContract['warnings'];
}

export interface ReviewDecisionContract {
  decision: ReviewDecision;
  reason_code?: string;
  note?: string;
  warnings_overridden?: Array<{ field: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// WP-LBL-A27 — exact legacy label, permanent customer barcode, box collection
// ---------------------------------------------------------------------------

// NOTE: this package publishes TYPES ONLY — `main` points at raw TypeScript, so a value import
// of it from the compiled API would fail at runtime. The Code 128 encoder and barcode-value codec
// therefore live in apps/api/src/modules/m25-label/code128.ts, and the admin SPA consumes the
// server-rendered `barcode_svg` string rather than re-implementing the encoder.

export type BarcodeStatus = 'active' | 'alias' | 'disabled';

export interface CustomerBarcodeContract {
  id: string;
  customer_id: string;
  barcode_value: string;
  status: BarcodeStatus;
  issued_at: string;
  replacement_reason: string | null;
}

/** One row of the label's meals table. Every number comes from a stored source — never inferred. */
export interface LabelMealRowContract {
  dish_name: string;
  qty: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
}

/** Column sums of the rendered rows. `complete` is false when any row lacked a stored value. */
export interface LabelNutritionTotalsContract {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
  complete: boolean;
}

/**
 * Why a label has no meal rows. `no_dish_source` is the honest state for a delivery date whose
 * dish detail was never captured — the label prints an explicit marker instead of invented values.
 */
export type LabelMealSource = 'dish_day' | 'partner_api_v2' | 'no_dish_source';

export interface LabelAddressContract {
  area: string | null;
  block: string | null;
  street: string | null;
  building: string | null;
  floor: string | null;
  flat: string | null;
  direction: string | null;
}

/** The complete, render-ready legacy label. Field order mirrors the printed label exactly. */
export interface LabelDocumentContract {
  order_id: string;
  customer_id: string;
  delivery_date: string;
  full_name: string;
  subscription_date_display: string;
  delivery_time: string | null;
  days_remaining: number | null;
  delivery_method: string | null;
  package_name: string | null;
  meals_per_day: number | null;
  snacks_per_day: number | null;
  legacy_user_id: string | null;
  driver_ref: string | null;
  order_number: string;
  address: LabelAddressContract;
  phone: string | null;
  notes: string | null;
  meals: LabelMealRowContract[];
  meal_source: LabelMealSource;
  totals: LabelNutritionTotalsContract;
  barcode_value: string;
  barcode_svg: string;
}

export type CollectionOutcome =
  | 'accepted'
  | 'duplicate'
  | 'wrong_driver'
  | 'no_delivery_today'
  | 'cancelled'
  | 'unknown_barcode'
  | 'ambiguous_delivery';

export interface CollectionScanRequestContract {
  barcode: string;
  delivery_date?: string;
  device_ref?: string;
}

export interface CollectionScanResultContract {
  outcome: CollectionOutcome;
  /** Present for every outcome that resolved to a real customer (i.e. all but unknown_barcode). */
  customer_name?: string | null;
  customer_id?: string | null;
  order_number?: string | null;
  delivery_date?: string | null;
  delivery_time?: string | null;
  area?: string | null;
  /** Returned only after Fleetbase proves this delivery is assigned to the current driver. */
  phone?: string | null;
  collected_at?: string | null;
  /** For wrong_driver: the driver the delivery actually belongs to. */
  assigned_driver_ref?: string | null;
  message_en: string;
  message_ar: string;
}

export interface CollectionManifestEntryContract {
  customer_id: string;
  customer_name: string | null;
  order_number: string;
  area: string | null;
  delivery_time: string | null;
  phone: string | null;
  collected: boolean;
  collected_at: string | null;
}

export interface CollectionManifestContract {
  delivery_date: string;
  driver_ref: string | null;
  total: number;
  collected: number;
  remaining: number;
  entries: CollectionManifestEntryContract[];
}

// ---------------------------------------------------------------------------
// WP-LOC-A30 — assigned-driver missing-location recovery
// ---------------------------------------------------------------------------

export type DriverLocationCaptureMethod = 'current_gps' | 'shared_coordinates';
export type DriverLocationOutcome = 'accepted' | 'already_captured' | 'partner_pin_available';
export type DriverLocationFallbackSource = 'known_stop_anchor' | 'area_centroid';

export interface DriverLocationPointContract {
  latitude: number;
  longitude: number;
}

export interface DriverLocationFallbackContract extends DriverLocationPointContract {
  source: DriverLocationFallbackSource;
  label_en: string;
  label_ar: string;
}

export interface DriverLocationManifestEntryContract {
  fleetbase_order_id: string;
  order_number: string | null;
  customer_name: string | null;
  area: string | null;
  phone: string | null;
  state: 'needs_capture' | 'captured' | 'blocked';
  blocked_reason: 'missing_customer_reference' | 'fallback_unavailable' | null;
  fallback: DriverLocationFallbackContract | null;
  exact_location: (DriverLocationPointContract & {
    captured_at: string;
    capture_method: DriverLocationCaptureMethod | 'operator_correction';
  }) | null;
}

export interface DriverLocationManifestContract {
  delivery_date: string;
  driver_ref: string;
  total: number;
  pending: number;
  captured: number;
  blocked: number;
  entries: DriverLocationManifestEntryContract[];
}

export interface DriverLocationCaptureRequestContract extends DriverLocationPointContract {
  fleetbase_order_id: string;
  delivery_date?: string;
  capture_method: DriverLocationCaptureMethod;
  accuracy_meters?: number;
}

export interface DriverLocationCaptureResultContract extends DriverLocationPointContract {
  outcome: DriverLocationOutcome;
  fleetbase_order_id: string;
  captured_at: string | null;
  message_en: string;
  message_ar: string;
}

export interface FleetOpsDriverLocationContract extends DriverLocationPointContract {
  id: string;
  partner_customer_ref: string;
  fleetbase_order_id: string;
  source_order_number: string | null;
  delivery_date: string;
  fleetbase_driver_id: string | null;
  capture_method: DriverLocationCaptureMethod | 'operator_correction';
  accuracy_meters: number | null;
  supersedes_id: string | null;
  correction_reason: string | null;
  captured_at: string;
}
