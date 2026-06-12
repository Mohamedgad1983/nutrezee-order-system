export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    body: string,
  ) {
    super(body || errorCode);
  }
}

// Sessions slide-expire after 60 idle minutes; any 401 mid-use means the
// session is gone and the shell must fall back to the login screen. The auth
// provider registers itself here so api() stays dependency-free.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

const FRIENDLY: Record<string, string> = {
  no_session: 'Your session has expired — please sign in again.',
  forbidden: 'You do not have permission for this action.',
};

export function humanMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return FRIENDLY[e.errorCode] ?? `Request failed (${e.errorCode}).`;
  }
  return 'Request failed — network error.';
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let code = `http_${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error_code?: string };
      if (parsed.error_code) code = parsed.error_code;
    } catch {
      // non-JSON error body — keep the http_<status> code
    }
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, code, text);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  staff_id: string;
  name: string;
  email?: string;
  locale: string;
  roles: string[];
  masked?: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: { limit: number };
}

export interface CompletenessWarning {
  field: string;
  rule: string;
  detail?: unknown;
}

export interface DraftListItem {
  id: string;
  state: 'open' | 'submitted' | 'returned' | 'converted' | 'rejected' | 'cancelled' | 'expired';
  channel: string;
  customer_id: string | null;
  unverified_customer: boolean;
  start_date: string | null;
  end_date: string | null;
  expected_payment_method: string | null;
  completeness: { missing: string[]; warnings: CompletenessWarning[]; checked_at: string };
  submitted_at: string | null;
  version: number;
  items: Array<{ id: string; product_id: string; qty: number; note: string | null }>;
  whatsapp_ref_attached: boolean;
  masked: boolean;
}

export interface ReviewQueueListItem {
  id: string;
  draft_id: string;
  entered_at: string;
  sla_due_at: string;
  sla_late: boolean;
  reviewer_id: string | null;
  queue_state: 'waiting' | 'in_review' | 'decided';
  draft_state: string;
  channel: string;
  missing: string[];
  warnings: CompletenessWarning[];
  masked: boolean;
}

export interface OrderListItem {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
  start_date: string;
  end_date: string;
  source_draft_id: string | null;
  total: number | string;
  masked: boolean;
}
