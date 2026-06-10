import { ulid } from 'ulid';

// DM-01: time-sortable ULID ids, app-generated, never reused.
export function newId(): string {
  return ulid();
}
