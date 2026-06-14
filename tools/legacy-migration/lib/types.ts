// Shared types for the legacy→new migration toolkit.

/** Confidence in an extracted/normalized value or row. Drives the review queue. */
export type Confidence = 'VERIFIED' | 'INFERRED' | 'NEEDS_MANUAL_REVIEW';

/** A legacy entity we can extract. */
export type EntityKey =
  | 'customers' | 'subscriptions' | 'orders' | 'packages' | 'products'
  | 'areas' | 'delivery_slots' | 'delivery_methods' | 'payment_methods'
  | 'coupons' | 'settings' | 'reports';

/** One raw row scraped from a legacy screen (column-key → cell text). */
export interface RawRow {
  [field: string]: string | null;
}

/** A normalized record ready (or nearly ready) for the new system, with provenance. */
export interface NormalizedRecord<T = Record<string, unknown>> {
  /** Stable legacy key for idempotency (→ sync_record.legacy_key). */
  legacy_id: string | null;
  /** The new-system-shaped payload (snake_case, per physical_schema_design.md). */
  data: T;
  /** Per-record confidence; NEEDS_MANUAL_REVIEW rows must not be auto-applied. */
  confidence: Confidence;
  /** Human-readable reasons for INFERRED / NEEDS_MANUAL_REVIEW (never auto-dropped). */
  notes: string[];
}

/** Result of extracting one entity. */
export interface ExtractionResult {
  entity: EntityKey;
  /** Legacy screen actually visited (from config), for the evidence trail. */
  source: string;
  extracted_at: string;
  /** Rows counted on the legacy screen(s). */
  row_count: number;
  raw: RawRow[];
  normalized: NormalizedRecord[];
  /** Roll-up confidence across rows. */
  confidence_breakdown: Record<Confidence, number>;
  /** Pagination pages walked. */
  pages: number;
  /** Screenshot evidence paths (never contain secrets). */
  screenshots: string[];
  /** True if this was a dry-run (no detail-page deep-dive / throttled). */
  dry_run: boolean;
  /** Set when extraction could not run (e.g. no legacy access yet). */
  skipped_reason?: string;
}

/** Result of comparing one entity legacy↔new. */
export interface ComparisonResult {
  entity: EntityKey;
  compared_at: string;
  legacy_count: number;
  new_count: number;
  /** legacy rows matched to a new-system row (by the entity's key). */
  matched: number;
  /** legacy rows with no new-system counterpart (candidates to import). */
  only_in_legacy: number;
  /** new-system rows with no legacy counterpart (already-new / drift). */
  only_in_new: number;
  /** legacy fields with no mapping target in the new schema. */
  unmapped_legacy_fields: string[];
  /** new fields the new system requires that legacy does not expose. */
  missing_required_new_fields: string[];
  /** sample of per-field diffs on matched rows (capped). */
  field_diffs: Array<{ key: string; field: string; legacy: unknown; new: unknown }>;
  /** migration blockers surfaced for this entity. */
  blockers: string[];
}
