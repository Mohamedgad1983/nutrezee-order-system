#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_INPUT = 'docs/evidence/legacy_full_migration/exports/normalized';

const EXPECTED = {
  customers: 'customers.normalized.jsonl',
  customer_addresses: 'customer_addresses.normalized.jsonl',
  orders: 'orders.normalized.jsonl',
  order_details: 'order_details.normalized.jsonl',
  payments: 'payments.normalized.jsonl',
  deliveries: 'deliveries.normalized.jsonl',
  master_data: 'master_data.normalized.jsonl',
};

const VALID_ORDER_STATUSES = new Set([
  'draft', 'pending_review', 'approved', 'active', 'paused',
  'completed', 'expired', 'cancelled', 'rejected',
]);
const VALID_PAYMENT_STATUSES = new Set([
  'unpaid', 'link_sent', 'paid', 'failed', 'cod_pending',
  'collected', 'refund_requested', 'refunded',
]);
const VALID_DELIVERY_STATUSES = new Set([
  'scheduled', 'kitchen_queued', 'in_preparation', 'ready_to_pack',
  'packed', 'assigned_to_driver', 'out_for_delivery', 'delivered',
  'failed', 'rescheduled', 'skipped', 'cancelled_day',
]);

const inputDir = argValue('--input') ?? DEFAULT_INPUT;
const format = argValue('--format') ?? 'markdown';
const entities = {};
const issues = [];

for (const [entity, filename] of Object.entries(EXPECTED)) {
  const path = join(inputDir, filename);
  if (!existsSync(path)) {
    entities[entity] = [];
    issue('P0', entity, null, 'missing_file', `Missing normalized file: ${path}`);
    continue;
  }
  entities[entity] = readJsonl(path, entity);
}

const customerIds = idSet(entities.customers, ['legacy_id', 'legacy_customer_id', 'id']);
const orderIds = idSet(entities.orders, ['legacy_id', 'legacy_order_id', 'order_number']);
const packageIds = new Set(
  entities.master_data
    .filter((r) => String(r.entity ?? r.kind ?? '').toLowerCase() === 'package')
    .map((r) => stringValue(r.legacy_id ?? r.legacy_package_id ?? r.id))
    .filter(Boolean),
);

checkDuplicateLegacyIds('customers', entities.customers, ['legacy_id', 'legacy_customer_id', 'id']);
checkDuplicateLegacyIds('customer_addresses', entities.customer_addresses, ['legacy_id', 'legacy_address_id', 'id']);
checkDuplicateLegacyIds('orders', entities.orders, ['legacy_id', 'legacy_order_id', 'order_number']);
checkDuplicateLegacyIds('order_details', entities.order_details, ['legacy_id', 'legacy_order_detail_id', 'id']);
checkDuplicateLegacyIds('payments', entities.payments, ['legacy_id', 'legacy_payment_id', 'id']);
checkDuplicateLegacyIds('deliveries', entities.deliveries, ['legacy_id', 'legacy_delivery_id', 'id']);

checkCustomers();
checkAddresses();
checkOrders();
checkOrderDetails();
checkPayments();
checkDeliveries();

const summary = {
  inputDir,
  counts: Object.fromEntries(Object.entries(entities).map(([k, rows]) => [k, rows.length])),
  issueCounts: countIssues(),
  checksums: Object.fromEntries(Object.entries(entities).map(([k, rows]) => [k, aggregateChecksum(rows)])),
  issues,
};

if (format === 'json') {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printMarkdown(summary);
}

if (summary.issueCounts.P0 > 0) process.exitCode = 2;
else if (summary.issueCounts.P1 > 0 || summary.issueCounts.P2 > 0) process.exitCode = 1;

function checkCustomers() {
  const phones = new Map();
  for (const row of entities.customers) {
    const id = legacyId(row, ['legacy_id', 'legacy_customer_id', 'id']);
    const name = stringValue(row.name ?? row.full_name_en ?? row.fullNameEn);
    const phone = stringValue(row.phone_normalized ?? row.phone ?? row.phone_raw);
    if (!name) issue('P0', 'customers', id, 'missing_customer_name', 'Customer name is missing');
    if (!phone) issue('P1', 'customers', id, 'missing_phone', 'Customer phone is missing');
    else {
      const list = phones.get(phone) ?? [];
      list.push(id ?? '(missing-id)');
      phones.set(phone, list);
    }
    checkDate(row.dob, 'customers', id, 'dob', false);
  }
  for (const [phone, ids] of phones.entries()) {
    if (ids.length > 1) issue('P1', 'customers', ids.join(','), 'duplicate_phone', `Duplicate normalized phone: ${phone}`);
  }
}

function checkAddresses() {
  for (const row of entities.customer_addresses) {
    const id = legacyId(row, ['legacy_id', 'legacy_address_id', 'id']);
    const customerId = stringValue(row.customer_legacy_id ?? row.legacy_customer_id ?? row.customer_id);
    if (!customerId) issue('P0', 'customer_addresses', id, 'address_without_customer', 'Address has no customer reference');
    else if (!customerIds.has(customerId)) issue('P0', 'customer_addresses', id, 'unknown_customer', `Unknown customer reference: ${customerId}`);
    if (!stringValue(row.address_text ?? row.address)) issue('P1', 'customer_addresses', id, 'missing_address_text', 'Address text is missing');
  }
}

function checkOrders() {
  const orderNumbers = new Map();
  for (const row of entities.orders) {
    const id = legacyId(row, ['legacy_id', 'legacy_order_id', 'order_number']);
    const orderNumber = stringValue(row.order_number ?? row.number);
    const customerId = stringValue(row.customer_legacy_id ?? row.legacy_customer_id ?? row.customer_id);
    const status = normalized(row.status);
    const packageId = stringValue(row.package_legacy_id ?? row.legacy_package_id ?? row.package_id);
    if (orderNumber) {
      const list = orderNumbers.get(orderNumber) ?? [];
      list.push(id ?? '(missing-id)');
      orderNumbers.set(orderNumber, list);
    }
    if (!customerId) issue('P0', 'orders', id, 'order_without_customer', 'Order has no customer reference');
    else if (!customerIds.has(customerId)) issue('P0', 'orders', id, 'unknown_customer', `Unknown customer reference: ${customerId}`);
    if (!status || status === 'unknown_legacy_status' || !VALID_ORDER_STATUSES.has(status)) {
      issue('P1', 'orders', id, 'unknown_status', `Unknown order status: ${row.status ?? '(missing)'}`);
    }
    checkDate(row.start_date ?? row.delivery_date, 'orders', id, 'start_or_delivery_date', true);
    checkDate(row.end_date, 'orders', id, 'end_date', false);
    checkMoney(row.total ?? row.amount, 'orders', id, 'total', false);
    checkMoney(row.discount, 'orders', id, 'discount', false);
    if (packageId && packageIds.size > 0 && !packageIds.has(packageId)) {
      issue('P1', 'orders', id, 'missing_package_reference', `Unknown package reference: ${packageId}`);
    }
  }
  for (const [orderNumber, ids] of orderNumbers.entries()) {
    if (ids.length > 1) issue('P0', 'orders', ids.join(','), 'duplicate_order', `Duplicate order number: ${orderNumber}`);
  }
}

function checkOrderDetails() {
  for (const row of entities.order_details) {
    const id = legacyId(row, ['legacy_id', 'legacy_order_detail_id', 'id']);
    const orderId = stringValue(row.order_legacy_id ?? row.legacy_order_id ?? row.order_id);
    if (!orderId) issue('P0', 'order_details', id, 'detail_without_order', 'Order detail has no order reference');
    else if (!orderIds.has(orderId)) issue('P0', 'order_details', id, 'unknown_order', `Unknown order reference: ${orderId}`);
    const qty = Number(row.qty ?? row.quantity ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) issue('P0', 'order_details', id, 'invalid_quantity', `Invalid quantity: ${row.qty ?? row.quantity}`);
    checkMoney(row.unit_price ?? row.price, 'order_details', id, 'unit_price', false);
  }
}

function checkPayments() {
  const orderPayment = new Map();
  for (const row of entities.payments) {
    const id = legacyId(row, ['legacy_id', 'legacy_payment_id', 'id']);
    const orderId = stringValue(row.order_legacy_id ?? row.legacy_order_id ?? row.order_id);
    const status = normalized(row.status ?? row.payment_status);
    const amount = moneyNumber(row.amount ?? row.paid_amount);
    if (!orderId) issue('P0', 'payments', id, 'payment_without_order', 'Payment has no order reference');
    else if (!orderIds.has(orderId)) issue('P0', 'payments', id, 'unknown_order', `Unknown order reference: ${orderId}`);
    else orderPayment.set(orderId, { status, amount, id });
    if (!status || status === 'unknown_legacy_status' || !VALID_PAYMENT_STATUSES.has(status)) {
      issue('P1', 'payments', id, 'unknown_status', `Unknown payment status: ${row.status ?? row.payment_status ?? '(missing)'}`);
    }
    checkMoney(row.amount ?? row.paid_amount, 'payments', id, 'amount', false);
    if (status === 'paid' && (!amount || amount <= 0)) issue('P0', 'payments', id, 'paid_zero_amount', 'Paid payment has zero amount');
  }
  for (const order of entities.orders) {
    const id = legacyId(order, ['legacy_id', 'legacy_order_id', 'order_number']);
    const status = normalized(order.status);
    const payment = orderPayment.get(id);
    if (status === 'cancelled' && payment && payment.amount > 0) {
      issue('P1', 'orders', id, 'cancelled_with_payment', 'Cancelled order has a payment amount');
    }
  }
}

function checkDeliveries() {
  for (const row of entities.deliveries) {
    const id = legacyId(row, ['legacy_id', 'legacy_delivery_id', 'id']);
    const orderId = stringValue(row.order_legacy_id ?? row.legacy_order_id ?? row.order_id);
    const status = normalized(row.status ?? row.delivery_status);
    if (!orderId) issue('P0', 'deliveries', id, 'delivery_without_order', 'Delivery has no order reference');
    else if (!orderIds.has(orderId)) issue('P0', 'deliveries', id, 'unknown_order', `Unknown order reference: ${orderId}`);
    if (!status || status === 'unknown_legacy_status' || !VALID_DELIVERY_STATUSES.has(status)) {
      issue('P1', 'deliveries', id, 'unknown_status', `Unknown delivery status: ${row.status ?? row.delivery_status ?? '(missing)'}`);
    }
    checkDate(row.date ?? row.delivery_date, 'deliveries', id, 'delivery_date', true);
  }
}

function readJsonl(path, entity) {
  const text = readFileSync(path, 'utf8');
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      issue('P0', entity, null, 'invalid_jsonl', `${path}:${index + 1}: ${error.message}`);
    }
  }
  return rows;
}

function checkDuplicateLegacyIds(entity, rows, keys) {
  const seen = new Map();
  for (const row of rows) {
    const id = legacyId(row, keys);
    if (!id) {
      issue('P0', entity, null, 'missing_legacy_id', 'Record is missing a legacy id');
      continue;
    }
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
  }
  for (const [id, count] of seen.entries()) {
    if (count > 1) issue('P0', entity, id, 'duplicate_legacy_id', `Duplicate legacy id appears ${count} times`);
  }
}

function checkDate(value, entity, id, field, required) {
  if (value === undefined || value === null || value === '') {
    if (required) issue('P0', entity, id, `missing_${field}`, `Missing ${field}`);
    return;
  }
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) issue('P0', entity, id, `invalid_${field}`, `Invalid date: ${text}`);
}

function checkMoney(value, entity, id, field, required) {
  if (value === undefined || value === null || value === '') {
    if (required) issue('P0', entity, id, `missing_${field}`, `Missing ${field}`);
    return;
  }
  const n = moneyNumber(value);
  if (n === null || n < 0) issue('P0', entity, id, `invalid_${field}`, `Invalid money value: ${value}`);
}

function moneyNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function idSet(rows, keys) {
  return new Set(rows.map((row) => legacyId(row, keys)).filter(Boolean));
}

function legacyId(row, keys) {
  for (const key of keys) {
    const value = stringValue(row[key]);
    if (value) return value;
  }
  return null;
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalized(value) {
  return stringValue(value).toLowerCase();
}

function issue(severity, entity, legacyIdValue, code, message) {
  issues.push({ severity, entity, legacy_id: legacyIdValue, code, message });
}

function countIssues() {
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const item of issues) counts[item.severity] += 1;
  return counts;
}

function aggregateChecksum(rows) {
  const h = createHash('sha256');
  for (const row of rows.map(stable).sort()) h.update(row).update('\n');
  return h.digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function printMarkdown(summary) {
  console.log('# Legacy Full Migration Normalized Validation');
  console.log('');
  console.log(`Input: \`${summary.inputDir}\``);
  console.log('');
  console.log('| Entity | Rows | Aggregate checksum |');
  console.log('| --- | ---: | --- |');
  for (const [entity, count] of Object.entries(summary.counts)) {
    console.log(`| ${entity} | ${count} | \`${summary.checksums[entity]}\` |`);
  }
  console.log('');
  console.log('| Severity | Count |');
  console.log('| --- | ---: |');
  for (const sev of ['P0', 'P1', 'P2']) console.log(`| ${sev} | ${summary.issueCounts[sev]} |`);
  console.log('');
  if (summary.issues.length > 0) {
    console.log('| Severity | Entity | Legacy ID | Code | Message |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const item of summary.issues) {
      console.log(`| ${item.severity} | ${item.entity} | ${item.legacy_id ?? ''} | ${item.code} | ${String(item.message).replaceAll('|', '\\|')} |`);
    }
  } else {
    console.log('No validation issues found.');
  }
}

function argValue(name) {
  const arg = process.argv.find((item) => item === name || item.startsWith(`${name}=`));
  if (!arg) return null;
  if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
  const index = process.argv.indexOf(arg);
  return process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : '';
}
