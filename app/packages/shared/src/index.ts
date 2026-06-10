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
