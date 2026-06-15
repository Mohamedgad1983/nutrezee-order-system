import { defineExtractor } from './base.ts';
import { normalizeCustomers } from '../normalizers/customers.normalizer.ts';

// Legacy customers (e.g. /users/list/3). Read-only; paginated; PII redacted in logs.
export const extractCustomers = defineExtractor('customers', normalizeCustomers);
