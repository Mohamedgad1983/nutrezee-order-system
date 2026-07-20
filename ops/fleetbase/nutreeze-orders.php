#!/usr/bin/env php
<?php

declare(strict_types=1);

use Fleetbase\FleetOps\Models\Contact;
use Fleetbase\FleetOps\Models\Order;
use Fleetbase\FleetOps\Models\OrderConfig;
use Fleetbase\FleetOps\Models\Payload;
use Fleetbase\FleetOps\Models\Place;
use Fleetbase\FleetOps\Models\TrackingNumber;
use Fleetbase\FleetOps\Models\TrackingStatus;
use Fleetbase\FleetOps\Support\LiveCacheService;
use Fleetbase\FleetOps\Support\Utils as FleetOpsUtils;
use Fleetbase\LaravelMysqlSpatial\Types\Point;
use Fleetbase\Support\ApiModelCache;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Milon\Barcode\Facades\DNS2DFacade as DNS2D;
use Spatie\ResponseCache\Facades\ResponseCache;

ini_set('display_errors', '0');
error_reporting(E_ALL);

try {
    require '/fleetbase/api/vendor/autoload.php';
    $app = require '/fleetbase/api/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
} catch (Throwable) {
    fwrite(STDOUT, "{\"event\":\"fatal\",\"stage\":\"bootstrap\",\"error_class\":\"BootstrapError\",\"error_code\":\"internal_error\"}\n");
    exit(1);
}

const VENDOR_BASE = 'https://nutreeze.com/integration';
const DEFAULT_PREFIX = 'NUTREEZE-PARTNER';
const DEFAULT_DAILY_PREFIX = 'NUTREEZE-PARTNER-DAY';
const DEFAULT_LIMIT = 200;
const MAPPING_VERSION = 1;
const DAILY_MAPPING_VERSION = 1;
const INTEGRATION_CONFIG_ROOT = '/fleetbase/api/storage/app/integrations/config';
const DAILY_DISPATCHABLE_MEAL_STATUSES = ['ordered', 'driver_assigned'];
const DAILY_DISPATCHABLE_ORDER_STATUSES = ['success'];
const DAILY_PROVEN_HISTORY_FLOOR = '2026-01-01T00:00:00+03:00';
// Sponsor amendment A19 authorizes address/area fallback dispatch for this
// delivery date only. A matching runtime confirmation is still mandatory, and
// the unattended timer deliberately never supplies it.
const ADDRESS_CALL_AUTHORIZED_DATES = ['2026-07-20'];
const ADDRESS_CALL_AUTHORIZATION = 'A19';
const ADDRESS_CALL_INSTRUCTION = 'NO EXACT PIN - CALL CUSTOMER / لا يوجد موقع دقيق - اتصل بالعميل';
const ADDRESS_CALL_PLACE_PREFIX = 'CALL CUSTOMER FIRST / اتصل بالعميل أولا - ';

// Approximate area-level centroids (lat, lng) used ONLY when the vendor feed has no
// location_pin. Fleetbase service_areas/zones were checked first (2026-07-12): the only
// geometry present is soft-deleted DEMO data, so a minimal in-script lookup is used,
// covering exactly the areas observed in null-pin vendor rows. 'farwaniya' matches the
// demo "Zone - Farwaniya" centroid as a cross-check. Places created from this map are
// ALWAYS flagged meta.pin_source = 'area_fallback' and the original null pin is
// preserved in payload meta.source_location_pin — a driver drop-pin is still required.
const AREA_FALLBACK_CENTROIDS = [
    'ardhiya' => [29.3006, 47.8964],
    'bayan' => [29.3033, 48.0489],
    'farwaniya' => [29.2775, 47.9586],
    'fahad al ahmed' => [29.0839, 48.1289],
    'south abdullah al mubarak' => [29.2280, 47.8770],
];
// Last resort for areas not in the map (logged so operators can extend the map):
// Kuwait City centroid, flagged fallback_scope = 'country'.
const COUNTRY_FALLBACK_CENTROID = [29.3759, 47.9774];

/**
 * Resolve the effective dropoff pin for a validated vendor row.
 * Vendor pin wins untouched; otherwise an area-level (or country-level) fallback
 * centroid is returned, tagged with its provenance so it is never mistaken for a
 * real customer pin.
 */
function resolveEffectivePin(array $row): array
{
    if ($row['pin'] !== null) {
        return [
            'lat' => $row['pin']['lat'],
            'lng' => $row['pin']['lng'],
            'pin_source' => 'vendor',
            'fallback_scope' => null,
        ];
    }
    foreach ([$row['area_en'], $row['area_ar'], $row['routing_area']] as $candidate) {
        if (is_string($candidate) && $candidate !== '') {
            $key = mb_strtolower(trim($candidate));
            if (isset(AREA_FALLBACK_CENTROIDS[$key])) {
                return [
                    'lat' => AREA_FALLBACK_CENTROIDS[$key][0],
                    'lng' => AREA_FALLBACK_CENTROIDS[$key][1],
                    'pin_source' => 'area_fallback',
                    'fallback_scope' => 'area',
                ];
            }
        }
    }
    return [
        'lat' => COUNTRY_FALLBACK_CENTROID[0],
        'lng' => COUNTRY_FALLBACK_CENTROID[1],
        'pin_source' => 'area_fallback',
        'fallback_scope' => 'country',
    ];
}

function addressCallInstruction(array $row, bool $allowAddressCall = false): ?string
{
    return rowRequiresCustomerCall($row, $allowAddressCall)
        ? ADDRESS_CALL_INSTRUCTION
        : null;
}

function sourceOrderNotes(array $row, bool $allowAddressCall = false): string
{
    $notes = 'Vendor order ' . $row['order_number'] . ' | Area (AR): ' . ($row['area_ar'] ?? '');
    $instruction = addressCallInstruction($row, $allowAddressCall);
    return $instruction === null ? $notes : $notes . ' | ' . $instruction;
}

function sourcePlaceName(array $row, bool $allowAddressCall = false): string
{
    $name = 'Vendor Order ' . $row['order_number'] . ' - ' . $row['routing_area'];
    return rowRequiresCustomerCall($row, $allowAddressCall)
        ? ADDRESS_CALL_PLACE_PREFIX . $name
        : $name;
}

function safeLog(string $event, array $fields = []): void
{
    $safe = ['event' => $event] + $fields;
    fwrite(STDOUT, json_encode($safe, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
}

function kuwaitNow(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->format(DateTimeInterface::ATOM);
}

function metaArray(mixed $value): array
{
    if (is_array($value)) {
        return $value;
    }
    if (is_object($value)) {
        return json_decode(json_encode($value, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
    return [];
}

function saveWithoutActivity(object $model): bool
{
    if (method_exists($model, 'getActivitylogOptions') && !method_exists($model, 'disableLogging')) {
        throw new RuntimeException('activity_logging_cannot_disable');
    }
    if (method_exists($model, 'disableLogging')) {
        $model->disableLogging();
    }
    if (($model->exists ?? false) && method_exists($model, 'isDirty') && !$model->isDirty()) {
        return false;
    }
    if (!($model->exists ?? false)) {
        if (method_exists($model, 'generateUuid') && empty($model->uuid)) {
            $model->setAttribute('uuid', $model::generateUuid());
        }
        if (method_exists($model, 'generatePublicId') && empty($model->public_id)) {
            $model->setAttribute('public_id', $model::generatePublicId());
        }
    }
    $saved = $model::withoutEvents(fn (): bool => (bool) $model->save());
    if (!$saved) {
        throw new RuntimeException('fleetbase_save_rejected');
    }
    return true;
}

function deleteWithoutActivity(object $model): bool
{
    if (method_exists($model, 'getActivitylogOptions') && !method_exists($model, 'disableLogging')) {
        throw new RuntimeException('activity_logging_cannot_disable');
    }
    if (method_exists($model, 'disableLogging')) {
        $model->disableLogging();
    }
    if (!($model->exists ?? false)) {
        return false;
    }
    $deleted = $model::withoutEvents(fn (): bool => (bool) $model->forceDelete());
    if (!$deleted) {
        throw new RuntimeException('fleetbase_delete_rejected');
    }
    return true;
}

function hasForbiddenContactReference(array $contactUuids): bool
{
    if ($contactUuids === []) {
        return false;
    }
    $references = [
        ['categories', 'owner_uuid'],
        ['files', 'subject_uuid'],
        ['ledger_invoices', 'customer_uuid'],
        ['orders', 'facilitator_uuid'],
        ['purchase_rates', 'customer_uuid'],
        ['reviews', 'customer_uuid'],
        ['tracking_numbers', 'owner_uuid'],
        ['transactions', 'customer_uuid'],
        ['transactions', 'owner_uuid'],
        ['vendor_personnels', 'contact_uuid'],
        ['votes', 'customer_uuid'],
    ];
    foreach ($references as [$table, $column]) {
        if (Schema::hasTable($table)
            && Schema::hasColumn($table, $column)
            && DB::table($table)->whereIn($column, $contactUuids)->exists()) {
            return true;
        }
    }
    return false;
}

function hasForeignOperationalContactReference(array $contactUuids, string $companyUuid, string $prefix, ?array $allowedPayloadUuids = null): bool
{
    if ($contactUuids === []) {
        return false;
    }
    if ($allowedPayloadUuids === null) {
        $allowedPayloadUuids = DB::table('payloads')
            ->where('company_uuid', $companyUuid)
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $prefix)
            ->pluck('uuid')
            ->all();
    }
    foreach (['entities', 'waypoints'] as $table) {
        if (!Schema::hasTable($table)
            || !Schema::hasColumn($table, 'customer_uuid')
            || !Schema::hasColumn($table, 'payload_uuid')) {
            continue;
        }
        $query = DB::table($table)->whereIn('customer_uuid', $contactUuids);
        if ($allowedPayloadUuids === []) {
            if ($query->exists()) {
                return true;
            }
            continue;
        }
        if ($query->where(function ($reference) use ($allowedPayloadUuids) {
            $reference->whereNull('payload_uuid')->orWhereNotIn('payload_uuid', $allowedPayloadUuids);
        })->exists()) {
            return true;
        }
    }
    return false;
}

function placeHasForeignReference(string $placeUuid, string $allowedPayloadUuid, bool $forDeletion = false): bool
{
    $payloadReferences = DB::table('payloads')
        ->where(function ($query) use ($placeUuid) {
            $query->where('pickup_uuid', $placeUuid)
                ->orWhere('dropoff_uuid', $placeUuid)
                ->orWhere('return_uuid', $placeUuid);
        })
        ->get(['uuid', 'pickup_uuid', 'dropoff_uuid', 'return_uuid']);
    foreach ($payloadReferences as $reference) {
        if ($reference->uuid !== $allowedPayloadUuid
            || $reference->pickup_uuid === $placeUuid
            || $reference->return_uuid === $placeUuid
            || ($reference->dropoff_uuid === $placeUuid && $forDeletion)) {
            return true;
        }
    }
    $directReferences = [
        ['assets', 'current_place_uuid'],
        ['companies', 'place_uuid'],
        ['contacts', 'place_uuid'],
        ['manifest_stops', 'place_uuid'],
        ['vendors', 'place_uuid'],
    ];
    foreach ($directReferences as [$table, $column]) {
        if (Schema::hasTable($table)
            && Schema::hasColumn($table, $column)
            && DB::table($table)->where($column, $placeUuid)->exists()) {
            return true;
        }
    }
    if (Schema::hasTable('waypoints') && Schema::hasColumn('waypoints', 'place_uuid')) {
        $waypoints = DB::table('waypoints')->where('place_uuid', $placeUuid);
        if ($forDeletion || $waypoints->where(function ($query) use ($allowedPayloadUuid) {
            $query->whereNull('payload_uuid')->orWhere('payload_uuid', '!=', $allowedPayloadUuid);
        })->exists()) {
            if ($forDeletion && $waypoints->exists()) {
                return true;
            }
            if (!$forDeletion) {
                return true;
            }
        }
    }
    return false;
}

function resolveCompanyUuid(): string
{
    $configured = getenv('FLEETBASE_COMPANY_UUID') ?: null;
    $companies = DB::table('companies')
        ->when($configured, fn ($query) => $query->where('uuid', $configured))
        ->pluck('uuid');
    if ($companies->count() !== 1) {
        throw new RuntimeException('fleetbase_company_scope');
    }
    return (string) $companies->first();
}

function latestCustomerRows(array $rows): array
{
    $latest = [];
    foreach ($rows as $row) {
        $ref = $row['customer_ref'];
        if (!isset($latest[$ref])
            || parseTimestamp($row['updated_at'], 'updated_at') > parseTimestamp($latest[$ref]['updated_at'], 'updated_at')) {
            $latest[$ref] = $row;
        }
    }
    return $latest;
}

function parseTimestamp(string $value, string $field): DateTimeImmutable
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\+03:00$/', $value, $parts)
        || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
        || (int) $parts[4] > 23
        || (int) $parts[5] > 59
        || (int) $parts[6] > 59) {
        throw new RuntimeException('contract_timestamp_' . $field);
    }
    try {
        return new DateTimeImmutable($value);
    } catch (Throwable) {
        throw new RuntimeException('contract_timestamp_' . $field);
    }
}

function parsePin(mixed $value): ?array
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value) || !preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/', $value, $matches)) {
        return null;
    }
    $lat = (float) $matches[1];
    $lng = (float) $matches[2];
    // The Partner integration is Kuwait-only. Global-range validation would
    // incorrectly treat 0,0, transposed 48,29, or another country's coordinates
    // as a routable customer pin.
    if (($lat === 0.0 && $lng === 0.0)
        || $lat < 28.4
        || $lat > 30.2
        || $lng < 46.4
        || $lng > 48.6) {
        return null;
    }
    return ['lat' => $lat, 'lng' => $lng];
}

function pinHoldReason(array $row): ?string
{
    if (($row['pin'] ?? null) !== null) {
        return null;
    }
    $raw = $row['location_pin'] ?? null;
    return $raw === null || $raw === ''
        ? 'no_real_location_pin'
        : 'invalid_source_location_pin';
}

function dailyHoldReason(array $row): ?string
{
    if (($row['source_order_status'] ?? null) === 'cancel') {
        return 'source_order_canceled';
    }
    if (!in_array((string) ($row['source_order_status'] ?? ''), DAILY_DISPATCHABLE_ORDER_STATUSES, true)) {
        return 'unapproved_order_status';
    }
    if (!in_array((string) ($row['meal_status'] ?? ''), DAILY_DISPATCHABLE_MEAL_STATUSES, true)) {
        return 'unapproved_meal_status';
    }
    return pinHoldReason($row);
}

function rowHasAddressCallContext(array $row): bool
{
    return is_string($row['address_text'] ?? null)
        && trim($row['address_text']) !== ''
        && is_string($row['customer_phone'] ?? null)
        && trim($row['customer_phone']) !== '';
}

function rowRequiresCustomerCall(array $row, bool $allowAddressCall = false): bool
{
    if (!$allowAddressCall
        || !in_array((string) ($row['delivery_date'] ?? ''), ADDRESS_CALL_AUTHORIZED_DATES, true)
        || !in_array(dailyHoldReason($row), ['no_real_location_pin', 'invalid_source_location_pin'], true)
        || !rowHasAddressCallContext($row)) {
        return false;
    }
    $effectivePin = resolveEffectivePin($row);
    return $effectivePin['pin_source'] === 'area_fallback'
        && $effectivePin['fallback_scope'] === 'area';
}

function rowIsDailyRoutable(array $row, bool $allowAddressCall = false): bool
{
    return dailyHoldReason($row) === null || rowRequiresCustomerCall($row, $allowAddressCall);
}

function resolveAddressCallAuthorization(?string $deliveryDate, mixed $confirmation): bool
{
    if ($confirmation === null) {
        return false;
    }
    if ($deliveryDate === null
        || !is_string($confirmation)
        || !hash_equals($deliveryDate, $confirmation)) {
        throw new RuntimeException('daily_address_call_confirmation_guard');
    }
    if (!in_array($deliveryDate, ADDRESS_CALL_AUTHORIZED_DATES, true)) {
        throw new RuntimeException('daily_address_call_date_not_authorized');
    }
    return true;
}

function dailyHeldOrderStatus(?string $holdReason): string
{
    return in_array($holdReason, ['source_order_canceled', 'source_row_missing'], true)
        ? 'canceled'
        : 'created';
}

function dailyHeldTrackingCode(?string $holdReason): string
{
    return dailyHeldOrderStatus($holdReason) === 'canceled' ? 'CANCELED' : 'ON_HOLD';
}

/**
 * FleetbaseWriter's generic contract intentionally skips canceled rows. Daily
 * reconciliation must retain them as explicit, unassigned tombstones, so present
 * them to the base mapper as pending while preserving the original source status
 * and source hash for DailyDispatchWriter.
 */
function dailyRowsForBaseWriter(array $dailyRows): array
{
    return array_map(function (array $row): array {
        if (!in_array((string) ($row['source_order_status'] ?? ''), DAILY_DISPATCHABLE_ORDER_STATUSES, true)) {
            $row['status'] = 'pending';
        }
        return $row;
    }, $dailyRows);
}

function requiredString(array $row, string $field, int $max = 2000): string
{
    if (!array_key_exists($field, $row) || !is_string($row[$field])) {
        throw new RuntimeException('contract_string_' . $field);
    }
    $value = trim($row[$field]);
    if ($value === '' || mb_strlen($value) > $max) {
        throw new RuntimeException('contract_string_' . $field);
    }
    return $value;
}

function optionalArea(array $row, string $field): ?string
{
    if (!array_key_exists($field, $row) || $row[$field] === null || $row[$field] === '') {
        return null;
    }
    if (!is_string($row[$field]) || mb_strlen(trim($row[$field])) > 255) {
        throw new RuntimeException('contract_area_' . $field);
    }
    $value = trim($row[$field]);
    return $value === '' ? null : $value;
}

function validateRow(array $row): array
{
    if (!isset($row['order_id']) || !is_int($row['order_id']) || $row['order_id'] <= 0) {
        throw new RuntimeException('contract_order_id');
    }
    $status = requiredString($row, 'status', 32);
    if (!in_array($status, ['success', 'pending', 'cancel', 'ongoing', 'active'], true)) {
        throw new RuntimeException('contract_status');
    }
    $customerRef = requiredString($row, 'customer_ref', 120);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $customerRef)) {
        throw new RuntimeException('contract_customer_ref');
    }
    $areaEn = optionalArea($row, 'area_en');
    $areaAr = optionalArea($row, 'area_ar');
    $routingArea = $areaEn ?? $areaAr;
    if ($routingArea === null) {
        throw new RuntimeException('contract_routing_area');
    }
    $createdAt = requiredString($row, 'created_at', 64);
    $updatedAt = requiredString($row, 'updated_at', 64);
    $createdTime = parseTimestamp($createdAt, 'created_at');
    $updatedTime = parseTimestamp($updatedAt, 'updated_at');
    if ($createdTime > $updatedTime) {
        throw new RuntimeException('contract_timestamp_order');
    }
    $rawPin = $row['location_pin'] ?? null;
    if ($rawPin !== null && $rawPin !== '' && !is_string($rawPin)) {
        throw new RuntimeException('contract_location_pin_type');
    }
    $pin = parsePin($rawPin);

    $normalized = [
        'order_id' => $row['order_id'],
        'order_number' => requiredString($row, 'order_number', 255),
        'status' => $status,
        'area_en' => $areaEn,
        'area_ar' => $areaAr,
        'routing_area' => $routingArea,
        'location_pin' => $rawPin,
        'pin' => $pin,
        'pin_quality' => $pin !== null
            ? 'exact_kuwait'
            : ($rawPin === null || $rawPin === '' ? 'missing' : 'invalid_or_outside_kuwait'),
        'customer_ref' => $customerRef,
        'customer_name' => requiredString($row, 'customer_name', 255),
        'customer_phone' => requiredString($row, 'customer_phone', 64),
        'address_text' => requiredString($row, 'address_text', 2000),
        'created_at' => $createdAt,
        'updated_at' => $updatedAt,
    ];
    $normalized['_source_hash'] = hash('sha256', json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    return $normalized;
}

function validateDeliveryDate(string $value, string $field = 'delivery_date'): string
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts)
        || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
        throw new RuntimeException('contract_' . $field);
    }
    return $value;
}

function optionalMealName(array $row, string $field): ?string
{
    if (!array_key_exists($field, $row) || $row[$field] === null || $row[$field] === '') {
        return null;
    }
    if (!is_string($row[$field]) || mb_strlen(trim($row[$field])) > 255) {
        throw new RuntimeException('contract_' . $field);
    }
    $value = trim($row[$field]);
    return $value === '' ? null : $value;
}

function validateMealHistoryRow(array $row): array
{
    $customerRef = requiredString($row, 'customer_ref', 120);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $customerRef)) {
        throw new RuntimeException('contract_meal_customer_ref');
    }
    $mealId = $row['meal_id'] ?? null;
    if (is_int($mealId)) {
        $mealId = (string) $mealId;
    }
    if (!is_string($mealId) || !preg_match('/^[A-Za-z0-9._-]+$/', $mealId)) {
        throw new RuntimeException('contract_meal_id');
    }
    $qty = $row['qty'] ?? null;
    if (!is_int($qty) || $qty < 1 || $qty > 1000000) {
        throw new RuntimeException('contract_meal_qty');
    }
    return [
        'customer_ref' => $customerRef,
        'order_number' => requiredString($row, 'order_number', 255),
        'delivery_date' => validateDeliveryDate(requiredString($row, 'delivery_date', 10)),
        'status' => requiredString($row, 'status', 64),
        'meal_id' => $mealId,
        'meal_name_ar' => optionalMealName($row, 'meal_name_ar'),
        'meal_name_en' => optionalMealName($row, 'meal_name_en'),
        'qty' => $qty,
        'updated_at' => requiredString($row, 'updated_at', 64),
        '_updated_time' => parseTimestamp(requiredString($row, 'updated_at', 64), 'meal_updated_at'),
    ];
}

/**
 * Join a day's meal rows to the canonical order endpoint. The order endpoint owns
 * customer/address/routing identity; meal-history supplies the delivery date and
 * one-to-many meal detail. Current (2024+) order_number values are unique, but we
 * still fail closed if the source violates that contract.
 */
function buildDailyRows(array $rawMeals, array $rawOrders, string $deliveryDate): array
{
    $deliveryDate = validateDeliveryDate($deliveryDate);
    $mealGroups = [];
    foreach ($rawMeals as $rawMeal) {
        if (!is_array($rawMeal)) {
            throw new RuntimeException('contract_meal_row_object');
        }
        $meal = validateMealHistoryRow($rawMeal);
        if ($meal['delivery_date'] !== $deliveryDate) {
            continue;
        }
        $key = $meal['order_number'];
        if (!isset($mealGroups[$key])) {
            $mealGroups[$key] = [
                'customer_ref' => $meal['customer_ref'],
                'status' => $meal['status'],
                'meal_item_count' => 0,
                'meal_qty' => 0,
                'updated_at' => $meal['updated_at'],
                '_updated_time' => $meal['_updated_time'],
            ];
        }
        $group = &$mealGroups[$key];
        if ($group['customer_ref'] !== $meal['customer_ref']
            || $group['status'] !== $meal['status']) {
            throw new RuntimeException('contract_daily_group_conflict');
        }
        // The documented feed is one row per meal item per delivery date.
        // meal_id is a catalog reference, not a row identity, so the same meal
        // may legitimately appear more than once for an order/date.
        $group['meal_item_count']++;
        $group['meal_qty'] += $meal['qty'];
        if ($meal['_updated_time'] > $group['_updated_time']) {
            $group['_updated_time'] = $meal['_updated_time'];
            $group['updated_at'] = $meal['updated_at'];
        }
        unset($group);
    }
    $ordersByNumber = [];
    foreach ($rawOrders as $rawOrder) {
        if (!is_array($rawOrder)) {
            throw new RuntimeException('contract_row_object');
        }
        if (!isset($rawOrder['order_number']) || !is_string($rawOrder['order_number'])) {
            throw new RuntimeException('contract_string_order_number');
        }
        $number = trim($rawOrder['order_number']);
        if (!isset($mealGroups[$number])) {
            continue;
        }
        $order = validateRow($rawOrder);
        if (isset($ordersByNumber[$number])
            && $ordersByNumber[$number]['order_id'] !== $order['order_id']) {
            throw new RuntimeException('contract_daily_order_number_not_unique');
        }
        if (!isset($ordersByNumber[$number])) {
            $ordersByNumber[$number] = $order;
            continue;
        }
        $candidateTime = parseTimestamp($order['updated_at'], 'updated_at');
        $existingTime = parseTimestamp($ordersByNumber[$number]['updated_at'], 'updated_at');
        if ($candidateTime > $existingTime) {
            $ordersByNumber[$number] = $order;
        } elseif ($candidateTime == $existingTime
            && $order['_source_hash'] !== $ordersByNumber[$number]['_source_hash']) {
            throw new RuntimeException('contract_daily_conflicting_order_snapshot');
        }
    }

    $daily = [];
    $seenOrderIds = [];
    foreach ($mealGroups as $number => $group) {
        $order = $ordersByNumber[$number] ?? null;
        if ($order === null) {
            throw new RuntimeException('daily_order_context_missing');
        }
        if ($order['customer_ref'] !== $group['customer_ref']) {
            throw new RuntimeException('daily_customer_ref_mismatch');
        }
        $orderIdKey = (string) $order['order_id'];
        if (isset($seenOrderIds[$orderIdKey])) {
            throw new RuntimeException('contract_daily_order_id_not_unique');
        }
        $seenOrderIds[$orderIdKey] = true;
        $daily[] = $order + [
            'delivery_date' => $deliveryDate,
            'source_order_status' => $order['status'],
            'meal_status' => $group['status'],
            'meal_item_count' => $group['meal_item_count'],
            'meal_qty' => $group['meal_qty'],
            'meal_updated_at' => $group['updated_at'],
        ];
    }
    usort($daily, fn (array $a, array $b): int => $a['order_id'] <=> $b['order_id']);
    return $daily;
}

function loadLockedJson(string $path, string $errorPrefix): array
{
    $root = INTEGRATION_CONFIG_ROOT;
    if (!is_dir($root)
        || is_link($root)
        || realpath($root) !== $root
        || fileowner($root) !== 0
        || (fileperms($root) & 0777) !== 0700
        || dirname($path) !== $root
        || is_link($path)
        || !is_file($path)
        || realpath($path) !== $path
        || fileowner($path) !== 0
        || (fileperms($path) & 0777) !== 0600
        || filesize($path) === false
        || filesize($path) < 2
        || filesize($path) > 65536) {
        throw new RuntimeException($errorPrefix . '_file_guard');
    }
    try {
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        throw new RuntimeException($errorPrefix . '_json');
    }
    if (!is_array($decoded)) {
        throw new RuntimeException($errorPrefix . '_json');
    }
    return $decoded;
}

function loadDriverRoster(string $path, string $companyUuid): array
{
    $config = loadLockedJson($path, 'driver_roster');
    $publicIds = $config['driver_public_ids'] ?? null;
    $expected = $config['expected_count'] ?? null;
    if (!is_array($publicIds)
        || !is_int($expected)
        || $expected !== 11
        || count($publicIds) !== $expected
        || count(array_unique($publicIds)) !== $expected) {
        throw new RuntimeException('driver_roster_shape');
    }
    foreach ($publicIds as $publicId) {
        if (!is_string($publicId) || !preg_match('/^driver_[A-Za-z0-9]{6,40}$/', $publicId)) {
            throw new RuntimeException('driver_roster_public_id');
        }
    }
    $rows = DB::table('drivers as d')
        ->join('users as u', 'u.uuid', '=', 'd.user_uuid')
        ->join('company_users as cu', function ($join) {
            $join->on('cu.user_uuid', '=', 'u.uuid')
                ->on('cu.company_uuid', '=', 'd.company_uuid');
        })
        ->where('d.company_uuid', $companyUuid)
        ->where('u.company_uuid', $companyUuid)
        ->whereIn('d.public_id', $publicIds)
        ->whereNull('d.deleted_at')
        ->whereNull('u.deleted_at')
        ->whereNull('cu.deleted_at')
        ->where('d.status', 'available')
        ->where('u.type', 'driver')
        ->where(function ($query) {
            $query->whereNull('u.status')->orWhere('u.status', 'active');
        })
        ->where('cu.status', 'active')
        ->whereNotNull('u.password')
        ->where('u.password', '!=', '')
        ->distinct()
        ->get(['d.uuid', 'd.public_id'])
        ->map(fn ($row): array => ['uuid' => (string) $row->uuid, 'public_id' => (string) $row->public_id])
        ->all();
    if (count($rows) !== $expected) {
        throw new RuntimeException('driver_roster_resolution');
    }
    usort($rows, fn (array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));
    return $rows;
}

function loadPickupConfig(string $path): array
{
    $config = loadLockedJson($path, 'pickup_config');
    $maxLengths = [
        'name' => 255,
        'street1' => 255,
        'city' => 191,
        'country' => 2,
        'dispatch_time' => 5,
    ];
    foreach ($maxLengths as $field => $maxLength) {
        if (!isset($config[$field]) || !is_string($config[$field]) || trim($config[$field]) === '') {
            throw new RuntimeException('pickup_config_' . $field);
        }
        if (mb_strlen(trim($config[$field])) > $maxLength
            || preg_match('/[\x00-\x1F\x7F]/u', $config[$field])) {
            throw new RuntimeException('pickup_config_' . $field);
        }
    }
    if (!preg_match('/^\d{2}:\d{2}$/', $config['dispatch_time'])
        || !preg_match('/^[A-Z]{2}$/', $config['country'])) {
        throw new RuntimeException('pickup_config_format');
    }
    [$hour, $minute] = array_map('intval', explode(':', $config['dispatch_time']));
    if ($hour > 23 || $minute > 59) {
        throw new RuntimeException('pickup_config_time');
    }
    foreach (['lat', 'lng'] as $field) {
        if (!isset($config[$field]) || !is_float($config[$field]) && !is_int($config[$field])) {
            throw new RuntimeException('pickup_config_' . $field);
        }
    }
    $lat = (float) $config['lat'];
    $lng = (float) $config['lng'];
    if ($lat < 28.4 || $lat > 30.2 || $lng < 46.4 || $lng > 48.6) {
        throw new RuntimeException('pickup_config_coordinate');
    }
    $coordinateSource = is_string($config['coordinate_source'] ?? null)
        ? trim($config['coordinate_source'])
        : 'operator_config';
    if ($coordinateSource === ''
        || mb_strlen($coordinateSource) > 128
        || preg_match('/[\x00-\x1F\x7F]/u', $coordinateSource)) {
        throw new RuntimeException('pickup_config_coordinate_source');
    }
    return [
        'name' => trim($config['name']),
        'street1' => trim($config['street1']),
        'city' => trim($config['city']),
        'country' => $config['country'],
        'lat' => $lat,
        'lng' => $lng,
        'dispatch_time' => $config['dispatch_time'],
        'coordinate_source' => $coordinateSource,
    ];
}

/**
 * Keep each routing area together using rendezvous hashing over the fixed driver
 * roster. Unlike snapshot-global greedy balancing, an unrelated cancellation or
 * missing row cannot reshuffle another area's already-dispatched driver. This is
 * a staging handover default until operations supplies a signed area-to-driver map.
 */
function allocateDailyDrivers(array $dailyRows, array $drivers, bool $allowAddressCall = false): array
{
    if ($drivers === []) {
        throw new RuntimeException('driver_roster_empty');
    }
    $areas = [];
    foreach ($dailyRows as $row) {
        if (!rowIsDailyRoutable($row, $allowAddressCall)) {
            continue;
        }
        $area = mb_strtolower(trim((string) $row['routing_area']));
        if ($area === '') {
            throw new RuntimeException('daily_allocation_area');
        }
        $areas[$area] ??= [];
        $areas[$area][] = $row['order_id'];
    }
    ksort($areas);
    usort($drivers, fn (array $a, array $b): int => strcmp($a['public_id'], $b['public_id']));
    $loads = [];
    foreach ($drivers as $driver) {
        $loads[$driver['public_id']] = 0;
    }
    $assignments = [];
    foreach ($areas as $area => $orderIds) {
        $driver = null;
        $bestScore = null;
        foreach ($drivers as $candidate) {
            $score = hash('sha256', $area . "\0" . $candidate['public_id']);
            if ($bestScore === null || strcmp($score, $bestScore) > 0) {
                $driver = $candidate;
                $bestScore = $score;
            }
        }
        if ($driver === null) {
            throw new RuntimeException('daily_allocation_driver');
        }
        foreach ($orderIds as $orderId) {
            if (isset($assignments[(string) $orderId])) {
                throw new RuntimeException('daily_allocation_duplicate_order');
            }
            $assignments[(string) $orderId] = $driver['uuid'];
        }
        $loads[$driver['public_id']] += count($orderIds);
    }
    return ['assignments' => $assignments, 'loads' => $loads];
}

function dailyMealHash(array $row): string
{
    return hash('sha256', json_encode([
        'delivery_date' => $row['delivery_date'],
        'meal_status' => $row['meal_status'],
        'meal_item_count' => $row['meal_item_count'],
        'meal_qty' => $row['meal_qty'],
        'meal_updated_at' => $row['meal_updated_at'],
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
}

function dailySourceDigest(array $dailyRows): string
{
    $context = hash_init('sha256');
    foreach ($dailyRows as $row) {
        hash_update($context, (string) $row['order_id']);
        hash_update($context, "\0");
        hash_update($context, $row['_source_hash']);
        hash_update($context, "\0");
        hash_update($context, dailyMealHash($row));
        hash_update($context, "\n");
    }
    return hash_final($context);
}

/**
 * Once an order is dispatched its source snapshot and deterministic driver are
 * immutable. This preflight runs before FleetbaseWriter so a changed feed cannot
 * modify a live job even transiently; the outer transaction is the second guard.
 */
function guardDailyOperationalRows(
    string $prefix,
    array $dailyRows,
    array $drivers,
    string $companyUuid,
    bool $allowAddressCall = false,
): void
{
    $byInternalId = [];
    foreach ($dailyRows as $row) {
        $byInternalId[$prefix . '-ORDER-' . $row['order_id']] = $row;
    }
    $allocation = allocateDailyDrivers($dailyRows, $drivers, $allowAddressCall);
    $existing = Order::withoutGlobalScopes()
        ->where('company_uuid', $companyUuid)
        ->where('internal_id', 'like', $prefix . '-ORDER-%')
        ->whereNull('deleted_at')
        ->get([
            'internal_id',
            'status',
            'dispatched',
            'driver_assigned_uuid',
            'scheduled_at',
            'started',
            'started_at',
            'meta',
        ]);
    foreach ($existing as $order) {
        if (!isset($byInternalId[$order->internal_id])) {
            $meta = metaArray($order->meta);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $prefix) {
                throw new RuntimeException('daily_foreign_order');
            }
            if ((bool) $order->started || $order->started_at !== null) {
                throw new RuntimeException('daily_started_source_missing');
            }
            if (!in_array((string) $order->status, ['created', 'dispatched', 'canceled'], true)) {
                throw new RuntimeException('daily_missing_source_state_guard');
            }
            // DailyDispatchWriter will atomically convert an unstarted missing
            // source row to an unassigned cancellation tombstone.
            continue;
        }
        if ((string) $order->status === 'created'
            && !(bool) $order->dispatched
            && !(bool) $order->started
            && $order->started_at === null) {
            // Created orders have not entered the operational lifecycle. The
            // outer transaction may safely assign, repair, unassign, or hold.
            continue;
        }
        $row = $byInternalId[$order->internal_id];
        if ((string) $order->status === 'canceled'
            && !(bool) $order->dispatched
            && !(bool) $order->started
            && $order->started_at === null
            && dailyHoldReason($row) === 'source_order_canceled') {
            // An explicit source cancellation is an idempotent terminal
            // tombstone. It is never silently reactivated.
            continue;
        }
        if ((string) $order->status !== 'dispatched' || !(bool) $order->dispatched) {
            throw new RuntimeException('daily_operational_state_guard');
        }
        $meta = metaArray($order->meta);
        if (($meta['call_customer_required'] ?? false) === true
            && !$allowAddressCall
            && in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )) {
            throw new RuntimeException('daily_address_call_confirmation_required');
        }
        $expectedDriver = $allocation['assignments'][(string) $row['order_id']] ?? null;
        if (!rowIsDailyRoutable($row, $allowAddressCall)) {
            if ((bool) $order->started || $order->started_at !== null) {
                throw new RuntimeException('daily_started_snapshot_changed');
            }
            // A dispatched-but-not-started order whose pin disappeared or whose
            // meal status left the verified allowlist is atomically revoked and
            // converted to an unassigned held row.
            continue;
        }
        if ($expectedDriver === null
            || $order->driver_assigned_uuid !== $expectedDriver
            || ($meta['daily_source_hash'] ?? null) !== $row['_source_hash']
            || ($meta['daily_meal_hash'] ?? null) !== dailyMealHash($row)) {
            throw new RuntimeException('daily_dispatched_snapshot_changed');
        }
    }
}

/**
 * The integration suppresses Eloquent events to avoid notifications/webhooks, so
 * it must explicitly perform the cache invalidation those observers normally do.
 */
function invalidateDailyCaches(string $prefix, string $companyUuid): array
{
    $previousCompany = session('company');
    try {
        session(['company' => $companyUuid]);
        LiveCacheService::invalidateMultiple([
            'orders',
            'routes',
            'coordinates',
            'drivers',
            'places',
            'operations-monitor',
        ]);
        $apiCacheModels = [
            Order::class,
            Payload::class,
            Contact::class,
            Place::class,
            TrackingNumber::class,
            TrackingStatus::class,
        ];
        foreach ($apiCacheModels as $modelClass) {
            ApiModelCache::invalidateModelCache(new $modelClass(), $companyUuid);
        }
        ResponseCache::clear();

        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $companyUuid)
            ->where('internal_id', 'like', $prefix . '-ORDER-%')
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $prefix)
            ->whereNull('deleted_at')
            ->get();
        $payloadUuids = $orders->pluck('payload_uuid')->filter()->unique()->values()->all();
        $customerUuids = $orders->pluck('customer_uuid')->filter()->unique()->values()->all();
        $payloads = $payloadUuids === []
            ? collect()
            : Payload::withoutGlobalScopes()->whereIn('uuid', $payloadUuids)->get();
        $placeUuids = $payloads
            ->flatMap(fn (Payload $payload): array => array_values(array_filter([
                $payload->pickup_uuid,
                $payload->dropoff_uuid,
            ])))
            ->unique()
            ->values()
            ->all();
        $contacts = $customerUuids === []
            ? collect()
            : Contact::withoutGlobalScopes()->whereIn('uuid', $customerUuids)->get();
        $places = $placeUuids === []
            ? collect()
            : Place::withoutGlobalScopes()->whereIn('uuid', $placeUuids)->get();
        foreach ([$orders, $payloads, $contacts, $places] as $models) {
            foreach ($models as $model) {
                if (method_exists($model, 'flushAttributesCache')) {
                    $model->flushAttributesCache();
                }
            }
        }
        foreach ($orders as $order) {
            Cache::forget('order:' . $order->uuid . ':tracker');
        }
        return [
            'live_endpoints_invalidated' => 6,
            'api_model_tables_invalidated' => count($apiCacheModels),
            'http_response_cache_cleared' => true,
            'order_attribute_caches_flushed' => $orders->count(),
            'payload_attribute_caches_flushed' => $payloads->count(),
            'contact_attribute_caches_flushed' => $contacts->count(),
            'place_attribute_caches_flushed' => $places->count(),
            'tracker_caches_forgotten' => $orders->count(),
        ];
    } catch (Throwable) {
        throw new RuntimeException('daily_cache_invalidation');
    } finally {
        if ($previousCompany === null) {
            session()->forget('company');
        } else {
            session(['company' => $previousCompany]);
        }
    }
}

function deduplicateRows(array $rows): array
{
    $byId = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            throw new RuntimeException('contract_row_object');
        }
        $candidate = validateRow($row);
        $id = $candidate['order_id'];
        if (!isset($byId[$id])) {
            $byId[$id] = $candidate;
            continue;
        }
        $existingTime = parseTimestamp($byId[$id]['updated_at'], 'updated_at');
        $candidateTime = parseTimestamp($candidate['updated_at'], 'updated_at');
        if ($candidateTime > $existingTime) {
            $byId[$id] = $candidate;
        } elseif ($candidateTime == $existingTime && $candidate['_source_hash'] !== $byId[$id]['_source_hash']) {
            throw new RuntimeException('contract_conflicting_duplicate');
        }
    }
    ksort($byId, SORT_NUMERIC);
    return array_values($byId);
}

function maxUpdatedAt(array $rows): ?string
{
    $max = null;
    $maxTime = null;
    foreach ($rows as $row) {
        $time = parseTimestamp($row['updated_at'], 'updated_at');
        if ($maxTime === null || $time > $maxTime) {
            $maxTime = $time;
            $max = $row['updated_at'];
        }
    }
    return $max;
}

final class VendorClient
{
    public function __construct(private string $token)
    {
        if (strlen($token) < 8 || strlen($token) > 4096 || preg_match('/[\x00-\x1F\x7F]/', $token)) {
            throw new RuntimeException('vendor_token_invalid');
        }
    }

    public function fetchAll(string $since, int $limit, ?int $failAfterPage = null): array
    {
        $rows = [];
        $cursor = null;
        $seen = [];
        $page = 0;

        do {
            $page++;
            if ($page > 10000) {
                throw new RuntimeException('vendor_page_guard');
            }
            $query = ['since' => $since, 'limit' => $limit];
            if ($cursor !== null) {
                $query['cursor'] = $cursor;
            }
            $url = VENDOR_BASE . '/orders?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
            $handle = curl_init($url);
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT => 45,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_HTTPHEADER => [
                    'X-Api-Key: ' . $this->token,
                    'Accept: application/json',
                ],
            ]);
            $requestTime = kuwaitNow();
            $raw = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
            $curlFailed = $raw === false;
            curl_close($handle);

            if ($curlFailed) {
                throw new RuntimeException('vendor_network');
            }
            if ($status === 401 || $status === 403) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/orders', 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown', 'watermark' => $since]);
                throw new RuntimeException('vendor_auth');
            }
            if ($status !== 200) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/orders', 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown', 'watermark' => $since]);
                throw new RuntimeException('vendor_http');
            }

            try {
                $payload = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                throw new RuntimeException('vendor_json');
            } finally {
                $raw = null;
            }
            if (!is_array($payload)
                || !isset($payload['data'])
                || !is_array($payload['data'])
                || !array_key_exists('count', $payload)
                || !is_int($payload['count'])
                || $payload['count'] < 0
                || $payload['count'] !== count($payload['data'])
                || !isset($payload['server_time'])
                || !is_string($payload['server_time'])
                || !array_key_exists('next_cursor', $payload)) {
                throw new RuntimeException('vendor_envelope');
            }
            parseTimestamp($payload['server_time'], 'server_time');
            $next = $payload['next_cursor'];
            if ($next !== null && !is_int($next) && !is_string($next)) {
                throw new RuntimeException('vendor_cursor_type');
            }
            if (is_string($next) && $next === '') {
                throw new RuntimeException('vendor_cursor_type');
            }
            if ($next !== null && $payload['data'] === []) {
                throw new RuntimeException('vendor_cursor_no_progress');
            }
            safeLog('vendor_page', [
                'request_time' => $requestTime,
                'endpoint' => '/orders',
                'http_status' => 200,
                'page' => $page,
                'row_count' => count($payload['data']),
                'cursor_state' => $next === null ? 'null' : 'present',
                'watermark' => $since,
            ]);
            array_push($rows, ...$payload['data']);

            if ($failAfterPage !== null && $page >= $failAfterPage) {
                throw new RuntimeException('test_failure_after_page');
            }
            if ($next !== null) {
                if (isset($seen[$next])) {
                    throw new RuntimeException('vendor_cursor_loop');
                }
                $seen[$next] = true;
            }
            $cursor = $next;
        } while ($cursor !== null);

        return ['rows' => $rows, 'pages' => $page];
    }

    public function fetchDailySource(string $deliveryDate, string $mealSince, int $limit): array
    {
        $deliveryDate = validateDeliveryDate($deliveryDate);
        parseTimestamp($mealSince, 'meal_since');
        $meals = $this->fetchEndpoint(
            'meal-history',
            ['since' => $mealSince],
            $limit,
            function (mixed $raw) use ($deliveryDate): ?array {
                if (!is_array($raw)) {
                    throw new RuntimeException('contract_meal_row_object');
                }
                $rowDate = validateDeliveryDate(requiredString($raw, 'delivery_date', 10));
                if ($rowDate !== $deliveryDate) {
                    return null;
                }
                validateMealHistoryRow($raw);
                return $raw;
            },
            2000,
        );
        $wanted = [];
        foreach ($meals['rows'] as $meal) {
            $wanted[(string) $meal['order_number']] = true;
        }
        if ($wanted === []) {
            return [
                'meal_rows' => [],
                'order_rows' => [],
                'meal_pages' => $meals['pages'],
                'meal_response_rows' => $meals['response_rows'],
                'order_pages' => 0,
                'order_response_rows' => 0,
            ];
        }
        $orders = $this->fetchEndpoint(
            'orders',
            [],
            $limit,
            function (mixed $raw) use ($wanted): ?array {
                if (!is_array($raw)) {
                    throw new RuntimeException('contract_row_object');
                }
                $orderNumber = requiredString($raw, 'order_number', 255);
                if (!isset($wanted[$orderNumber])) {
                    return null;
                }
                validateRow($raw);
                return $raw;
            },
            // The documented orders endpoint has no order-number batch filter.
            // Bound the unfiltered context pass so future source growth fails
            // explicitly instead of turning into an unbounded job.
            1000,
        );
        return [
            'meal_rows' => $meals['rows'],
            'order_rows' => $orders['rows'],
            'meal_pages' => $meals['pages'],
            'meal_response_rows' => $meals['response_rows'],
            'order_pages' => $orders['pages'],
            'order_response_rows' => $orders['response_rows'],
        ];
    }

    /**
     * Cursor walker shared by the daily endpoints. The transform validates the
     * selector on every row and the full contract on the day's relevant subset, so
     * unrelated historical anomalies cannot block a daily run and historical PII is
     * never written to disk or accumulated in memory.
     */
    private function fetchEndpoint(
        string $endpoint,
        array $baseQuery,
        int $limit,
        callable $transform,
        int $maxPages,
    ): array
    {
        if (!in_array($endpoint, ['orders', 'meal-history'], true)) {
            throw new RuntimeException('vendor_endpoint');
        }
        $rows = [];
        $cursor = null;
        $seen = [];
        $page = 0;
        $responseRows = 0;
        do {
            $page++;
            if ($page > $maxPages) {
                throw new RuntimeException('vendor_page_guard');
            }
            $query = $baseQuery + ['limit' => $limit];
            if ($cursor !== null) {
                $query['cursor'] = $cursor;
            }
            $url = VENDOR_BASE . '/' . $endpoint . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
            $attempt = 0;
            do {
                $attempt++;
                $handle = curl_init($url);
                curl_setopt_array($handle, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_FOLLOWLOCATION => false,
                    CURLOPT_CONNECTTIMEOUT => 10,
                    CURLOPT_TIMEOUT => 120,
                    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                    CURLOPT_HTTPHEADER => [
                        'X-Api-Key: ' . $this->token,
                        'Accept: application/json',
                    ],
                ]);
                $requestTime = kuwaitNow();
                $raw = curl_exec($handle);
                $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
                $curlFailed = $raw === false;
                curl_close($handle);
                $retryable = $curlFailed || $status === 429 || ($status >= 500 && $status <= 599);
                if (!$retryable || $attempt >= 3) {
                    break;
                }
                safeLog('vendor_retry', [
                    'request_time' => $requestTime,
                    'endpoint' => '/' . $endpoint,
                    'http_status' => $status,
                    'page' => $page,
                    'attempt' => $attempt,
                ]);
                $raw = null;
                usleep(1000000 * $attempt);
            } while (true);
            if ($curlFailed) {
                throw new RuntimeException('vendor_network');
            }
            if ($status === 401 || $status === 403) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/' . $endpoint, 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown']);
                throw new RuntimeException('vendor_auth');
            }
            if ($status !== 200) {
                safeLog('vendor_page', ['request_time' => $requestTime, 'endpoint' => '/' . $endpoint, 'http_status' => $status, 'page' => $page, 'row_count' => 0, 'cursor_state' => 'unknown']);
                throw new RuntimeException('vendor_http');
            }
            try {
                $payload = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                throw new RuntimeException('vendor_json');
            } finally {
                $raw = null;
            }
            if (!is_array($payload)
                || !isset($payload['data'])
                || !is_array($payload['data'])
                || !array_key_exists('count', $payload)
                || !is_int($payload['count'])
                || $payload['count'] < 0
                || $payload['count'] !== count($payload['data'])
                || !isset($payload['server_time'])
                || !is_string($payload['server_time'])
                || !array_key_exists('next_cursor', $payload)) {
                throw new RuntimeException('vendor_envelope');
            }
            parseTimestamp($payload['server_time'], 'server_time');
            $next = $payload['next_cursor'];
            if ($next !== null && !is_int($next) && !is_string($next)) {
                throw new RuntimeException('vendor_cursor_type');
            }
            if (is_string($next) && $next === '') {
                throw new RuntimeException('vendor_cursor_type');
            }
            if ($next !== null && $payload['data'] === []) {
                throw new RuntimeException('vendor_cursor_no_progress');
            }
            $responseRows += count($payload['data']);
            foreach ($payload['data'] as $sourceRow) {
                $selected = $transform($sourceRow);
                if ($selected !== null) {
                    $rows[] = $selected;
                }
            }
            safeLog('vendor_page', [
                'request_time' => $requestTime,
                'endpoint' => '/' . $endpoint,
                'http_status' => 200,
                'page' => $page,
                'row_count' => count($payload['data']),
                'selected_count' => count($rows),
                'cursor_state' => $next === null ? 'null' : 'present',
            ]);
            if ($next !== null) {
                $nextKey = (string) $next;
                if (isset($seen[$nextKey])) {
                    throw new RuntimeException('vendor_cursor_loop');
                }
                $seen[$nextKey] = true;
            }
            $cursor = $next;
        } while ($cursor !== null);
        return ['rows' => $rows, 'pages' => $page, 'response_rows' => $responseRows];
    }
}

final class WatermarkStore
{
    public function __construct(private string $path)
    {
        $root = '/fleetbase/api/storage/app/integrations/state';
        if (!file_exists($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
            throw new RuntimeException('watermark_directory');
        }
        $directory = dirname($this->path);
        if ($directory !== $root
            || is_link($directory)
            || realpath($directory) !== $root
            || !preg_match('/^[a-z0-9][a-z0-9-]{2,80}\.json$/', basename($this->path))
            || is_link($this->path)) {
            throw new RuntimeException('watermark_path_invalid');
        }
    }

    public function read(): ?string
    {
        if (!is_file($this->path)) {
            return null;
        }
        $decoded = json_decode((string) file_get_contents($this->path), true);
        if (!is_array($decoded) || !isset($decoded['updated_at']) || !is_string($decoded['updated_at'])) {
            throw new RuntimeException('watermark_invalid');
        }
        parseTimestamp($decoded['updated_at'], 'watermark');
        return $decoded['updated_at'];
    }

    public function write(string $updatedAt): void
    {
        parseTimestamp($updatedAt, 'watermark');
        $directory = dirname($this->path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('watermark_directory');
        }
        chmod($directory, 0700);
        $temporary = tempnam($directory, '.watermark-');
        if ($temporary === false || is_link($temporary)) {
            throw new RuntimeException('watermark_temporary');
        }
        $contents = json_encode(['updated_at' => $updatedAt, 'committed_at' => kuwaitNow()], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        if (file_put_contents($temporary, $contents, LOCK_EX) === false) {
            throw new RuntimeException('watermark_write');
        }
        chmod($temporary, 0600);
        if (!rename($temporary, $this->path)) {
            @unlink($temporary);
            throw new RuntimeException('watermark_rename');
        }
        chmod($this->path, 0600);
    }

    public function remove(): void
    {
        if (is_link($this->path)) {
            throw new RuntimeException('watermark_path_invalid');
        }
        if (is_file($this->path)) {
            if (!unlink($this->path)) {
                throw new RuntimeException('watermark_remove');
            }
        }
    }
}

final class FleetbaseWriter
{
    private string $companyUuid;
    private string $orderConfigUuid;
    private array $customerCache = [];
    private ?array $verificationResult = null;
    private array $touchedSubjectIds = ['order' => [], 'contact' => [], 'payload' => [], 'place' => []];
    private array $stats = [
        'orders_created' => 0,
        'orders_updated' => 0,
        'orders_unchanged' => 0,
        'customers_created' => 0,
        'customers_updated' => 0,
        'customers_unchanged' => 0,
        'payloads_created' => 0,
        'payloads_updated' => 0,
        'payloads_unchanged' => 0,
        'places_created' => 0,
        'places_updated' => 0,
        'places_unchanged' => 0,
        'places_removed' => 0,
        'null_pin_orders' => 0,
        'non_null_pin_orders' => 0,
        'area_fallback_places' => 0,
        'tracking_numbers_created' => 0,
        'tracking_numbers_adopted' => 0,
        'tracking_statuses_created' => 0,
    ];
    private string $trackingNumberPrefix;

    public function __construct(
        private string $prefix,
        private bool $allowAddressCall = false,
    )
    {
        $this->companyUuid = resolveCompanyUuid();
        // Native tracking numbers are prefixed with the first 3 letters of the company
        // name (TrackingNumber::generateTrackingNumber). session('company') is empty in
        // CLI, so derive the prefix explicitly from the resolved company.
        $companyName = (string) (DB::table('companies')->where('uuid', $this->companyUuid)->value('name') ?? '');
        $derived = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $companyName) ?? '', 0, 3));
        $this->trackingNumberPrefix = strlen($derived) === 3 ? $derived : 'FLB';

        $companyConfigs = OrderConfig::withoutGlobalScopes()
            ->where('key', 'transport')
            ->whereNull('deleted_at')
            ->where('company_uuid', $this->companyUuid)
            ->get();
        $globalConfigs = OrderConfig::withoutGlobalScopes()
            ->where('key', 'transport')
            ->whereNull('deleted_at')
            ->whereNull('company_uuid')
            ->get();
        $configs = $companyConfigs->isNotEmpty() ? $companyConfigs : $globalConfigs;
        if ($configs->count() !== 1) {
            throw new RuntimeException('fleetbase_order_config');
        }
        $this->orderConfigUuid = (string) $configs->first()->uuid;
    }

    public function upsert(array $eligible, ?array $verifyRows = null): array
    {
        $activityIdBefore = (int) (DB::table('activity')->max('id') ?? 0);
        $cancelStateBefore = [];
        if ($verifyRows !== null) {
            foreach ($verifyRows as $row) {
                if ($row['status'] === 'cancel') {
                    $key = $this->prefix . '-ORDER-' . $row['order_id'];
                    $cancelStateBefore[$key] = Order::withoutGlobalScopes()
                        ->where('company_uuid', $this->companyUuid)
                        ->where('internal_id', $key)
                        ->exists();
                }
            }
        }
        DB::transaction(function () use ($eligible, $verifyRows, $cancelStateBefore, $activityIdBefore): void {
            foreach (latestCustomerRows($eligible) as $row) {
                $this->upsertCustomer($row);
            }
            foreach ($eligible as $row) {
                $this->upsertOne($row);
            }
            if ($verifyRows !== null) {
                $this->verificationResult = $this->verify($verifyRows, $cancelStateBefore);
            }
            $newTouchedActivity = DB::table('activity')
                ->where('id', '>', $activityIdBefore)
                ->where(function ($query) {
                    $query->where(function ($orderQuery) {
                        $orderQuery->where('subject_type', Order::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['order'])));
                    })->orWhere(function ($contactQuery) {
                        $contactQuery->where('subject_type', Contact::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['contact'])));
                    })->orWhere(function ($payloadQuery) {
                        $payloadQuery->where('subject_type', Payload::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['payload'])));
                    })->orWhere(function ($placeQuery) {
                        $placeQuery->where('subject_type', Place::class)->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['place'])));
                    });
                })
                ->count();
            $this->stats['activity_rows_created'] = $newTouchedActivity;
            if ($newTouchedActivity !== 0) {
                throw new RuntimeException('fleetbase_activity_log_write');
            }
        }, 1);
        return $this->stats;
    }

    public function verificationResult(): ?array
    {
        return $this->verificationResult;
    }

    private function assertOwned(object $model, string $kind): void
    {
        $meta = metaArray($model->meta ?? null);
        if (($model->company_uuid ?? null) !== $this->companyUuid
            || ($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($meta['integration_prefix'] ?? null) !== $this->prefix) {
            throw new RuntimeException('fleetbase_foreign_' . $kind);
        }
    }

    private function assertCustomerOwned(Contact $customer, array $row): void
    {
        $this->assertOwned($customer, 'customer');
        $meta = metaArray($customer->meta);
        if (($meta['source_customer_ref'] ?? null) !== $row['customer_ref']) {
            throw new RuntimeException('fleetbase_foreign_customer_ref');
        }
        $linkedOrders = DB::table('orders')
            ->where('customer_uuid', $customer->uuid)
            ->get(['company_uuid', 'internal_id', 'meta']);
        foreach ($linkedOrders as $linkedOrder) {
            $linkedMeta = metaArray($linkedOrder->meta ?? null);
            if (($linkedOrder->company_uuid ?? null) !== $this->companyUuid
                || ($linkedMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($linkedMeta['integration_prefix'] ?? null) !== $this->prefix
                || !is_string($linkedOrder->internal_id ?? null)
                || !str_starts_with($linkedOrder->internal_id, $this->prefix . '-ORDER-')) {
                throw new RuntimeException('fleetbase_shared_customer');
            }
        }
        $linkedPlaces = DB::table('places')
            ->where('owner_uuid', $customer->uuid)
            ->get(['uuid', 'company_uuid', 'meta']);
        foreach ($linkedPlaces as $linkedPlace) {
            $linkedMeta = metaArray($linkedPlace->meta ?? null);
            if (($linkedPlace->company_uuid ?? null) !== $this->companyUuid
                || ($linkedMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($linkedMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
            $linkedPayloads = DB::table('payloads')
                ->where('dropoff_uuid', $linkedPlace->uuid)
                ->get(['company_uuid', 'meta']);
            if ($linkedPayloads->count() !== 1) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
            $payloadMeta = metaArray($linkedPayloads->first()->meta ?? null);
            if (($linkedPayloads->first()->company_uuid ?? null) !== $this->companyUuid
                || ($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('fleetbase_shared_customer_place');
            }
        }
        if (!empty($customer->user_uuid)
            || !empty($customer->place_uuid)
            || !empty($customer->photo_uuid)
            || hasForbiddenContactReference([$customer->uuid])
            || hasForeignOperationalContactReference([$customer->uuid], $this->companyUuid, $this->prefix)) {
            throw new RuntimeException('fleetbase_shared_customer_reference');
        }
    }

    private function assertOrderOwned(Order $order, array $row): void
    {
        $this->assertOwned($order, 'order');
        $meta = metaArray($order->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('fleetbase_foreign_order_id');
        }
        $storedUpdated = $meta['source_updated_at'] ?? null;
        if (is_string($storedUpdated)
            && parseTimestamp($row['updated_at'], 'updated_at') < parseTimestamp($storedUpdated, 'stored_source_updated_at')) {
            throw new RuntimeException('fleetbase_stale_source');
        }
    }

    private function assertPayloadOwned(Payload $payload, Order $order, array $row): void
    {
        $this->assertOwned($payload, 'payload');
        $meta = metaArray($payload->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('fleetbase_foreign_payload_id');
        }
        if (DB::table('orders')->where('payload_uuid', $payload->uuid)->where('uuid', '!=', $order->uuid)->exists()) {
            throw new RuntimeException('fleetbase_shared_payload');
        }
    }

    private function assertPlaceOwned(Place $place, Payload $payload, Contact $customer, array $row): void
    {
        $this->assertOwned($place, 'place');
        $meta = metaArray($place->meta);
        if (($meta['source_order_id'] ?? null) !== $row['order_id']
            || ($meta['integration_key'] ?? null) !== $this->prefix . '-PLACE-' . $row['order_id']
            || $place->owner_uuid !== $customer->uuid
            || placeHasForeignReference($place->uuid, $payload->uuid)) {
            throw new RuntimeException('fleetbase_foreign_place_reference');
        }
    }

    private function upsertCustomer(array $row): Contact
    {
        $ref = $row['customer_ref'];
        if (isset($this->customerCache[$ref])) {
            return $this->customerCache[$ref];
        }
        $internalId = $this->prefix . '-CUSTOMER-' . $ref;
        $query = Contact::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('fleetbase_duplicate_customer_key');
        }
        $customer = $query->lockForUpdate()->first();
        $created = $customer === null;
        $customer ??= new Contact();
        if (!$created) {
            $this->assertCustomerOwned($customer, $row);
        }
        $meta = metaArray($customer->meta);
        if (!$created
            && ($meta['mapping_version'] ?? null) === MAPPING_VERSION
            && ($meta['source_updated_at'] ?? null) === $row['updated_at']
            && $customer->deleted_at === null
            && $customer->type === 'customer'
            && $customer->name === $row['customer_name']
            && $customer->phone === $row['customer_phone']) {
            $this->stats['customers_unchanged']++;
            return $this->customerCache[$ref] = $customer;
        }
        $customer->fill([
            'company_uuid' => $this->companyUuid,
            'internal_id' => $internalId,
            'name' => $row['customer_name'],
            'phone' => $row['customer_phone'],
            'type' => 'customer',
            'meta' => array_replace($meta, [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_customer_ref' => $ref,
                'source_updated_at' => $row['updated_at'],
            ]),
        ]);
        $customer->setAttribute('deleted_at', null);
        $changed = saveWithoutActivity($customer);
        $this->touchedSubjectIds['contact'][] = $customer->getKey();
        $this->stats[$created ? 'customers_created' : ($changed ? 'customers_updated' : 'customers_unchanged')]++;
        return $this->customerCache[$ref] = $customer;
    }

    private function upsertOne(array $row): void
    {
        $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
        $query = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('fleetbase_duplicate_order_key');
        }
        $order = $query->lockForUpdate()->first();
        $orderCreated = $order === null;
        $order ??= new Order();
        if (!$orderCreated) {
            $this->assertOrderOwned($order, $row);
        }

        $customer = $this->upsertCustomer($row);
        $payload = $order->payload_uuid
            ? Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first()
            : null;
        $payloadCreated = $payload === null;
        $payload ??= new Payload();
        if (!$payloadCreated) {
            $this->assertPayloadOwned($payload, $order, $row);
        }
        $existingPlace = $payload->dropoff_uuid
            ? Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first()
            : null;
        $effectivePin = resolveEffectivePin($row);
        if (!$orderCreated && !$payloadCreated) {
            $orderMeta = metaArray($order->meta);
            $payloadMeta = metaArray($payload->meta);
            $expectedNotes = sourceOrderNotes($row, $this->allowAddressCall);
            $expectedStreet2 = addressCallInstruction($row, $this->allowAddressCall);
            $mappingCurrent = $order->deleted_at === null
                && $payload->deleted_at === null
                && $order->order_config_uuid === $this->orderConfigUuid
                && $order->customer_uuid === $customer->uuid
                && $order->customer_type === Contact::class
                && $order->payload_uuid === $payload->uuid
                && $order->type === 'transport'
                && $order->notes === $expectedNotes
                && ($orderMeta['mapping_version'] ?? null) === MAPPING_VERSION
                && ($orderMeta['source_order_id'] ?? null) === $row['order_id']
                && ($orderMeta['source_order_number'] ?? null) === $row['order_number']
                && ($orderMeta['source_status'] ?? null) === $row['status']
                && ($orderMeta['source_created_at'] ?? null) === $row['created_at']
                && ($orderMeta['source_updated_at'] ?? null) === $row['updated_at']
                && ($orderMeta['routing_area'] ?? null) === $row['routing_area']
                && ($orderMeta['area_en'] ?? null) === $row['area_en']
                && ($orderMeta['area_ar'] ?? null) === $row['area_ar']
                && ($orderMeta['source_location_present'] ?? null) === ($row['pin'] !== null)
                && ($orderMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                && ($payloadMeta['mapping_version'] ?? null) === MAPPING_VERSION
                && ($payloadMeta['source_order_id'] ?? null) === $row['order_id']
                && ($payloadMeta['source_order_number'] ?? null) === $row['order_number']
                && ($payloadMeta['source_updated_at'] ?? null) === $row['updated_at']
                && ($payloadMeta['routing_area'] ?? null) === $row['routing_area']
                && ($payloadMeta['area_en'] ?? null) === $row['area_en']
                && ($payloadMeta['area_ar'] ?? null) === $row['area_ar']
                && ($payloadMeta['address_text'] ?? null) === $row['address_text']
                && ($payloadMeta['source_location_pin'] ?? null) === $row['location_pin']
                && ($payloadMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                && $this->trackingIntact($order);
            // Every eligible order must have a dropoff Place: the vendor pin when
            // present, otherwise the flagged area-fallback centroid.
            if ($existingPlace) {
                $this->assertPlaceOwned($existingPlace, $payload, $customer, $row);
                $placeMeta = metaArray($existingPlace->meta);
                $mappingCurrent = $mappingCurrent
                    && $existingPlace->deleted_at === null
                    && $existingPlace->owner_type === Contact::class
                    && $existingPlace->name === sourcePlaceName($row, $this->allowAddressCall)
                    && $existingPlace->street1 === $row['address_text']
                    && $existingPlace->street2 === $expectedStreet2
                    && $existingPlace->city === $row['routing_area']
                    && $existingPlace->district === $row['routing_area']
                    && $existingPlace->neighborhood === $row['area_ar']
                    && $existingPlace->country === 'KW'
                    && $existingPlace->phone === $row['customer_phone']
                    && $existingPlace->location instanceof Point
                    && abs($existingPlace->location->getLat() - $effectivePin['lat']) <= 0.000001
                    && abs($existingPlace->location->getLng() - $effectivePin['lng']) <= 0.000001
                    && ($placeMeta['mapping_version'] ?? null) === MAPPING_VERSION
                    && ($placeMeta['source_order_id'] ?? null) === $row['order_id']
                    && ($placeMeta['source_updated_at'] ?? null) === $row['updated_at']
                    && ($placeMeta['routing_area'] ?? null) === $row['routing_area']
                    && ($placeMeta['area_en'] ?? null) === $row['area_en']
                    && ($placeMeta['area_ar'] ?? null) === $row['area_ar']
                    && ($placeMeta['pin_source'] ?? null) === $effectivePin['pin_source']
                    && ($placeMeta['fallback_scope'] ?? null) === $effectivePin['fallback_scope'];
            } else {
                $mappingCurrent = false;
            }
            if ($mappingCurrent) {
                $this->stats['orders_unchanged']++;
                $this->stats['payloads_unchanged']++;
                $this->stats['places_unchanged']++;
                if ($row['pin'] === null) {
                    $this->stats['null_pin_orders']++;
                } else {
                    $this->stats['non_null_pin_orders']++;
                }
                return;
            }
        }
        $payload->fill([
            'company_uuid' => $this->companyUuid,
            'meta' => array_replace(metaArray($payload->meta), [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_order_id' => $row['order_id'],
                'source_order_number' => $row['order_number'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'address_text' => $row['address_text'],
                'source_location_pin' => $row['location_pin'],
                'pin_source' => $effectivePin['pin_source'],
            ]),
        ]);
        $payload->setAttribute('deleted_at', null);
        $payloadChanged = saveWithoutActivity($payload);
        $this->touchedSubjectIds['payload'][] = $payload->getKey();

        if ($row['pin'] === null) {
            $this->stats['null_pin_orders']++;
        } else {
            $this->stats['non_null_pin_orders']++;
        }
        $placeCreated = $existingPlace === null;
        $place = $existingPlace ?? new Place();
        if (!$placeCreated) {
            $this->assertPlaceOwned($place, $payload, $customer, $row);
        }
        $place->fill([
            'company_uuid' => $this->companyUuid,
            'owner_uuid' => $customer->uuid,
            'owner_type' => Contact::class,
            'name' => sourcePlaceName($row, $this->allowAddressCall),
            'street1' => $row['address_text'],
            'street2' => addressCallInstruction($row, $this->allowAddressCall),
            'city' => $row['routing_area'],
            'district' => $row['routing_area'],
            'neighborhood' => $row['area_ar'],
            'country' => 'KW',
            'phone' => $row['customer_phone'],
            'location' => new Point($effectivePin['lat'], $effectivePin['lng']),
            'meta' => array_replace(metaArray($place->meta), [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'integration_key' => $this->prefix . '-PLACE-' . $row['order_id'],
                'source_order_id' => $row['order_id'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'pin_source' => $effectivePin['pin_source'],
                'fallback_scope' => $effectivePin['fallback_scope'],
            ]),
        ]);
        $place->setAttribute('deleted_at', null);
        $placeChanged = saveWithoutActivity($place);
        $this->touchedSubjectIds['place'][] = $place->getKey();
        if ($effectivePin['pin_source'] === 'area_fallback') {
            $this->stats['area_fallback_places']++;
        }
        $payload->dropoff_uuid = $place->uuid;
        $payloadChanged = saveWithoutActivity($payload) || $payloadChanged;
        $this->stats[$placeCreated ? 'places_created' : ($placeChanged ? 'places_updated' : 'places_unchanged')]++;
        $this->stats[$payloadCreated ? 'payloads_created' : ($payloadChanged ? 'payloads_updated' : 'payloads_unchanged')]++;

        $orderMeta = metaArray($order->meta);
        $order->fill([
            'company_uuid' => $this->companyUuid,
            'internal_id' => $internalId,
            'order_config_uuid' => $this->orderConfigUuid,
            'customer_uuid' => $customer->uuid,
            'customer_type' => Contact::class,
            'payload_uuid' => $payload->uuid,
            'type' => 'transport',
            'status' => $orderCreated ? 'created' : $order->status,
            'notes' => sourceOrderNotes($row, $this->allowAddressCall),
            'meta' => array_replace($orderMeta, [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'mapping_version' => MAPPING_VERSION,
                'source_order_id' => $row['order_id'],
                'source_order_number' => $row['order_number'],
                'source_status' => $row['status'],
                'source_created_at' => $row['created_at'],
                'source_updated_at' => $row['updated_at'],
                'routing_area' => $row['routing_area'],
                'area_en' => $row['area_en'],
                'area_ar' => $row['area_ar'],
                'source_location_present' => $row['pin'] !== null,
                'pin_source' => $effectivePin['pin_source'],
            ]),
        ]);
        $order->setAttribute('deleted_at', null);
        $orderChanged = saveWithoutActivity($order);
        $this->touchedSubjectIds['order'][] = $order->getKey();
        $this->ensureTrackingRecords($order, $effectivePin, (string) ($place->country ?: 'KW'));
        $this->stats[$orderCreated ? 'orders_created' : ($orderChanged ? 'orders_updated' : 'orders_unchanged')]++;
    }

    /**
     * True when the order already has the tracking records the Fleet-Ops console
     * requires (OrderFilter::queryForInternal → whereHas trackingNumber +
     * trackingStatuses), and they belong to this company and this order.
     */
    private function trackingIntact(Order $order): bool
    {
        if (empty($order->tracking_number_uuid)) {
            return false;
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            return false;
        }
        return DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->exists();
    }

    /**
     * Create (idempotently) the tracking records a native Fleetbase order gets from
     * TrackingNumber::insertGetUuid(): one tracking_numbers row (owner = the order)
     * and one initial CREATED tracking_statuses row, then point
     * orders.tracking_number_uuid / tracking_numbers.status_uuid at them.
     *
     * Mirrors the native insert shape exactly (query-builder inserts — the native
     * path is also event-free) with two deliberate CLI adaptations:
     *  - company_uuid / tracking number prefix come from the resolved company
     *    (native reads session('company'), which is empty in CLI);
     *  - the initial status location is the order's dropoff pin instead of the
     *    native placeholder POINT(0 0), so no fake (0,0) coordinate is emitted.
     * No dispatch/webhook side effects: no Eloquent events fire at any point.
     */
    private function ensureTrackingRecords(Order $order, array $effectivePin, string $region): void
    {
        $trackingNumberUuid = $order->tracking_number_uuid ?: null;
        if ($trackingNumberUuid === null) {
            // Adopt an orphan tracking number from a prior partial run before creating.
            $orphan = DB::table('tracking_numbers')
                ->where('owner_uuid', $order->uuid)
                ->whereNull('deleted_at')
                ->orderBy('id')
                ->first(['uuid']);
            $trackingNumberUuid = $orphan->uuid ?? null;
            if ($trackingNumberUuid !== null) {
                $this->stats['tracking_numbers_adopted']++;
            }
        }
        if ($trackingNumberUuid !== null) {
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $trackingNumberUuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
            if (!$trackingNumber
                || $trackingNumber->company_uuid !== $this->companyUuid
                || $trackingNumber->owner_uuid !== $order->uuid) {
                throw new RuntimeException('fleetbase_foreign_tracking_number');
            }
        } else {
            $trackingNumberUuid = TrackingNumber::generateUuid();
            DB::table('tracking_numbers')->insert([
                'uuid' => $trackingNumberUuid,
                'public_id' => TrackingNumber::generatePublicId('track'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'owner_uuid' => $order->uuid,
                'owner_type' => Order::class,
                'region' => strtoupper($region),
                'tracking_number' => $this->generateUniqueTrackingNumber(strtoupper($region)),
                'qr_code' => DNS2D::getBarcodePNG($order->uuid, 'QRCODE'),
                'barcode' => DNS2D::getBarcodePNG($order->uuid, 'PDF417'),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_numbers_created']++;
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $trackingNumberUuid)
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        }

        $statusUuid = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumberUuid)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->value('uuid');
        if ($statusUuid === null) {
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumberUuid,
                'status' => 'Order Created',
                'details' => 'New order created.',
                'code' => 'CREATED',
                'complete' => 0,
                'location' => FleetOpsUtils::parsePointToWkt(new Point($effectivePin['lat'], $effectivePin['lng'])),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) === null) {
            DB::table('tracking_numbers')->where('uuid', $trackingNumberUuid)->update(['status_uuid' => $statusUuid]);
        }
        if ($order->tracking_number_uuid !== $trackingNumberUuid) {
            // Same silent write the native path uses after insertGetUuid.
            DB::table('orders')->where('uuid', $order->uuid)->update(['tracking_number_uuid' => $trackingNumberUuid]);
            $order->setAttribute('tracking_number_uuid', $trackingNumberUuid);
            $order->syncOriginalAttribute('tracking_number_uuid');
        }
    }

    /**
     * Company-prefixed tracking number, unique against existing rows (incl. trashed),
     * matching TrackingNumber::generateTrackingNumber()'s NNN##########RR shape.
     */
    private function generateUniqueTrackingNumber(string $region): string
    {
        $guard = 0;
        do {
            if (++$guard > 100) {
                throw new RuntimeException('tracking_number_generation');
            }
            $number = $this->trackingNumberPrefix;
            for ($i = 0; $i < 10; $i++) {
                $number .= random_int(0, 9);
            }
            $number .= $region;
        } while (DB::table('tracking_numbers')->where('tracking_number', $number)->exists());
        return $number;
    }

    /**
     * Re-run the current mapping (tracking records + always-a-dropoff-place) over the
     * integration-owned orders already persisted for this prefix, rebuilding each
     * vendor row from the metadata stored at import time and pushing it through the
     * exact same validateRow() → upsert() → verify() path a live vendor run uses.
     * Touches ONLY orders whose meta carries this integration's ownership markers.
     */
    public function backfillDisplay(): array
    {
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->where('meta->integration_owner', 'nutreeze_partner_orders')
            ->where('meta->integration_prefix', $this->prefix)
            ->whereNull('deleted_at')
            ->orderBy('internal_id')
            ->get();
        $rows = [];
        foreach ($orders as $order) {
            $meta = metaArray($order->meta);
            $payload = $order->payload_uuid
                ? Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first()
                : null;
            if (!$payload) {
                throw new RuntimeException('backfill_payload_missing');
            }
            $payloadMeta = metaArray($payload->meta);
            $customer = $order->customer_uuid
                ? Contact::withoutGlobalScopes()->where('uuid', $order->customer_uuid)->first()
                : null;
            if (!$customer) {
                throw new RuntimeException('backfill_customer_missing');
            }
            $customerMeta = metaArray($customer->meta);
            $rows[] = validateRow([
                'order_id' => $meta['source_order_id'] ?? null,
                'order_number' => $meta['source_order_number'] ?? null,
                'status' => $meta['source_status'] ?? null,
                'area_en' => $meta['area_en'] ?? null,
                'area_ar' => $meta['area_ar'] ?? null,
                'location_pin' => $payloadMeta['source_location_pin'] ?? null,
                'customer_ref' => $customerMeta['source_customer_ref'] ?? null,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'address_text' => $payloadMeta['address_text'] ?? null,
                'created_at' => $meta['source_created_at'] ?? null,
                'updated_at' => $meta['source_updated_at'] ?? null,
            ]);
        }
        $stats = $this->upsert($rows, $rows);
        return ['orders_scanned' => count($rows)] + $stats;
    }

    private function verify(array $deduplicated, array $cancelStateBefore): array
    {
        $eligible = array_values(array_filter($deduplicated, fn (array $row): bool => in_array($row['status'], ['success', 'pending'], true)));
        $canceled = array_values(array_filter($deduplicated, fn (array $row): bool => $row['status'] === 'cancel'));
        $expectedCustomers = count(array_unique(array_column($eligible, 'customer_ref')));
        // Every eligible order gets a dropoff Place (vendor pin or flagged area fallback).
        $expectedPlaces = count($eligible);
        $expectedOrderIds = array_map(fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'], $eligible);
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->whereIn('internal_id', $expectedOrderIds)
            ->get()
            ->keyBy('internal_id');
        if ($orders->count() !== count($eligible)) {
            throw new RuntimeException('verify_order_count');
        }
        $latestCustomerRows = latestCustomerRows($eligible);
        $districtCaseNormalizations = 0;
        $verifiedPlaceUuids = [];
        foreach ($eligible as $row) {
            $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
            $order = $orders->get($internalId);
            if (!$order) {
                throw new RuntimeException('verify_order_missing');
            }
            if ($order->tracking_number_uuid === null) {
                throw new RuntimeException('verify_tracking_number_missing');
            }
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $order->tracking_number_uuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
            if (!$trackingNumber
                || $trackingNumber->company_uuid !== $this->companyUuid
                || $trackingNumber->owner_uuid !== $order->uuid) {
                throw new RuntimeException('verify_tracking_number_owner');
            }
            if (!DB::table('tracking_statuses')
                ->where('tracking_number_uuid', $trackingNumber->uuid)
                ->whereNull('deleted_at')
                ->where('code', 'CREATED')
                ->exists()) {
                throw new RuntimeException('verify_tracking_status_missing');
            }
            $meta = metaArray($order->meta);
            if (($meta['source_order_id'] ?? null) !== $row['order_id']
                || ($meta['source_order_number'] ?? null) !== $row['order_number']
                || ($meta['source_status'] ?? null) !== $row['status']
                || ($meta['source_created_at'] ?? null) !== $row['created_at']
                || ($meta['source_updated_at'] ?? null) !== $row['updated_at']
                || ($meta['routing_area'] ?? null) !== $row['routing_area']
                || ($meta['area_ar'] ?? null) !== $row['area_ar']) {
                throw new RuntimeException('verify_order_mapping');
            }
            $customer = Contact::withoutGlobalScopes()->where('uuid', $order->customer_uuid)->first();
            $expectedCustomer = $latestCustomerRows[$row['customer_ref']];
            if (!$customer || $customer->name !== $expectedCustomer['customer_name'] || $customer->phone !== $expectedCustomer['customer_phone']) {
                throw new RuntimeException('verify_customer_mapping');
            }
            $customerMeta = metaArray($customer->meta);
            if (($customerMeta['source_customer_ref'] ?? null) !== $row['customer_ref']) {
                throw new RuntimeException('verify_customer_ref');
            }
            $payload = Payload::withoutGlobalScopes()->where('uuid', $order->payload_uuid)->first();
            if (!$payload) {
                throw new RuntimeException('verify_payload_missing');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['routing_area'] ?? null) !== $row['routing_area']
                || ($payloadMeta['area_en'] ?? null) !== $row['area_en']
                || ($payloadMeta['area_ar'] ?? null) !== $row['area_ar']
                || ($payloadMeta['address_text'] ?? null) !== $row['address_text']) {
                throw new RuntimeException('verify_payload_mapping');
            }
            // The original vendor pin (or its absence) must be preserved verbatim.
            if (!array_key_exists('source_location_pin', $payloadMeta)
                || $payloadMeta['source_location_pin'] !== $row['location_pin']) {
                throw new RuntimeException('verify_source_pin_not_preserved');
            }
            $expectedPin = resolveEffectivePin($row);
            $place = Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first();
            if (!$place || !$place->location instanceof Point) {
                throw new RuntimeException('verify_place_missing');
            }
            $placeMeta = metaArray($place->meta);
            if (($placeMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                || ($payloadMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                || (metaArray($order->meta)['pin_source'] ?? null) !== $expectedPin['pin_source']) {
                throw new RuntimeException('verify_pin_source');
            }
            if ($row['pin'] === null && ($placeMeta['fallback_scope'] ?? null) !== $expectedPin['fallback_scope']) {
                throw new RuntimeException('verify_fallback_scope');
            }
            if (abs($place->location->getLat() - $expectedPin['lat']) > 0.000001) {
                throw new RuntimeException('verify_place_latitude');
            }
            if (abs($place->location->getLng() - $expectedPin['lng']) > 0.000001) {
                throw new RuntimeException('verify_place_longitude');
            }
            if ($place->district !== $row['routing_area']) {
                if ($place->district === null || $place->district === '') {
                    throw new RuntimeException('verify_place_district_null');
                }
                if (trim((string) $place->district) === $row['routing_area']) {
                    throw new RuntimeException('verify_place_district_whitespace');
                }
                if (mb_strtolower((string) $place->district) === mb_strtolower($row['routing_area'])) {
                    $districtCaseNormalizations++;
                } else {
                    throw new RuntimeException('verify_place_district_different');
                }
            }
            if ($place->street1 !== $row['address_text']) {
                throw new RuntimeException('verify_place_address');
            }
            if ($place->street2 !== addressCallInstruction($row, $this->allowAddressCall)
                || $place->phone !== $row['customer_phone']
                || $place->name !== sourcePlaceName($row, $this->allowAddressCall)
                || $order->notes !== sourceOrderNotes($row, $this->allowAddressCall)) {
                throw new RuntimeException('verify_address_call_display');
            }
            $verifiedPlaceUuids[$place->uuid] = true;
        }
        foreach ($canceled as $row) {
            $key = $this->prefix . '-ORDER-' . $row['order_id'];
            $existsAfter = Order::withoutGlobalScopes()->where('company_uuid', $this->companyUuid)->where('internal_id', $key)->exists();
            if ($existsAfter !== ($cancelStateBefore[$key] ?? false)) {
                throw new RuntimeException('verify_cancel_changed');
            }
        }
        $expectedCustomerIds = array_values(array_unique(array_map(
            fn (array $row): string => $this->prefix . '-CUSTOMER-' . $row['customer_ref'],
            $eligible
        )));
        $customerCount = Contact::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->whereIn('internal_id', $expectedCustomerIds)
            ->count();
        if ($customerCount !== $expectedCustomers) {
            throw new RuntimeException('verify_customer_count');
        }
        $placeCount = count($verifiedPlaceUuids);
        if ($placeCount !== $expectedPlaces) {
            throw new RuntimeException('verify_place_count');
        }
        $nullPinCount = count(array_filter($eligible, fn (array $row): bool => $row['pin'] === null));
        return [
            'passed' => true,
            'orders' => count($eligible),
            'cancels_skipped' => count($canceled),
            'customers' => $customerCount,
            'null_pin_orders' => $nullPinCount,
            'non_null_pin_orders' => count($eligible) - $nullPinCount,
            'area_fallback_places' => $nullPinCount,
            'places' => $placeCount,
            'orders_with_tracking' => count($eligible),
            'district_case_normalizations' => $districtCaseNormalizations,
        ];
    }

    public static function cleanup(string $prefix, string $statePath): array
    {
        if (!str_starts_with($prefix, 'TEST-FB-NUTREEZE')) {
            throw new RuntimeException('cleanup_prefix_guard');
        }
        $companyUuid = resolveCompanyUuid();
        $counts = DB::transaction(function () use ($prefix, $companyUuid): array {
            $orders = DB::table('orders')
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-ORDER-%')
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'payload_uuid']);
            $payloads = $orders->pluck('payload_uuid')->filter()->unique()->values()->all();
            $ownedPayloads = $payloads === [] ? collect() : DB::table('payloads')
                ->where('company_uuid', $companyUuid)
                ->whereIn('uuid', $payloads)
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'dropoff_uuid']);
            if ($ownedPayloads->count() !== count($payloads)) {
                throw new RuntimeException('cleanup_foreign_payload');
            }
            $payloads = $ownedPayloads->pluck('uuid')->all();
            if ($payloads !== [] && DB::table('orders')->whereIn('payload_uuid', $payloads)->whereNotIn('uuid', $orders->pluck('uuid')->all())->exists()) {
                throw new RuntimeException('cleanup_shared_payload');
            }
            $places = $ownedPayloads->pluck('dropoff_uuid')->filter()->unique()->values()->all();
            $ownedPlaceCount = $places === [] ? 0 : DB::table('places')
                ->where('company_uuid', $companyUuid)
                ->whereIn('uuid', $places)
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->count();
            if ($ownedPlaceCount !== count($places)) {
                throw new RuntimeException('cleanup_foreign_place');
            }
            foreach ($ownedPayloads as $ownedPayload) {
                if ($ownedPayload->dropoff_uuid
                    && placeHasForeignReference($ownedPayload->dropoff_uuid, $ownedPayload->uuid)) {
                    throw new RuntimeException('cleanup_shared_place');
                }
            }
            $contacts = DB::table('contacts')
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-CUSTOMER-%')
                ->where('meta->integration_owner', 'nutreeze_partner_orders')
                ->where('meta->integration_prefix', $prefix)
                ->get(['uuid', 'user_uuid', 'place_uuid', 'photo_uuid']);
            if ($contacts->isNotEmpty()
                && DB::table('orders')->whereIn('customer_uuid', $contacts->pluck('uuid')->all())->whereNotIn('uuid', $orders->pluck('uuid')->all())->exists()) {
                throw new RuntimeException('cleanup_shared_customer');
            }
            $contactUuids = $contacts->pluck('uuid')->all();
            $contactPlaces = $contactUuids === [] ? collect() : DB::table('places')
                ->whereIn('owner_uuid', $contactUuids)
                ->get(['uuid', 'company_uuid', 'meta']);
            $allowedPlaceUuids = array_fill_keys($places, true);
            foreach ($contactPlaces as $contactPlace) {
                $placeMeta = metaArray($contactPlace->meta ?? null);
                if (!isset($allowedPlaceUuids[$contactPlace->uuid])
                    || ($contactPlace->company_uuid ?? null) !== $companyUuid
                    || ($placeMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                    || ($placeMeta['integration_prefix'] ?? null) !== $prefix) {
                    throw new RuntimeException('cleanup_shared_customer_place');
                }
            }
            foreach ($contacts as $contact) {
                if (!empty($contact->user_uuid) || !empty($contact->place_uuid) || !empty($contact->photo_uuid)) {
                    throw new RuntimeException('cleanup_shared_customer_reference');
                }
            }
            if (hasForbiddenContactReference($contactUuids)
                || hasForeignOperationalContactReference($contactUuids, $companyUuid, $prefix, $payloads)) {
                throw new RuntimeException('cleanup_shared_customer_reference');
            }
            $orderCount = $orders->count();
            if ($payloads !== []) {
                DB::table('payloads')->whereIn('uuid', $payloads)->update([
                    'pickup_uuid' => null,
                    'dropoff_uuid' => null,
                    'return_uuid' => null,
                    'current_waypoint_uuid' => null,
                ]);
            }
            if ($payloads !== []) {
                DB::table('entities')->whereIn('payload_uuid', $payloads)->delete();
                DB::table('waypoints')->whereIn('payload_uuid', $payloads)->delete();
            }
            // Tracking records created for these orders (owner_uuid = order uuid).
            $orderUuids = $orders->pluck('uuid')->all();
            $trackingNumberUuids = $orderUuids === [] ? [] : DB::table('tracking_numbers')
                ->whereIn('owner_uuid', $orderUuids)
                ->pluck('uuid')
                ->all();
            $trackingStatusesDeleted = $trackingNumberUuids === [] ? 0 : DB::table('tracking_statuses')
                ->whereIn('tracking_number_uuid', $trackingNumberUuids)
                ->delete();
            $trackingNumbersDeleted = $trackingNumberUuids === [] ? 0 : DB::table('tracking_numbers')
                ->whereIn('uuid', $trackingNumberUuids)
                ->delete();
            $orderDeleted = $orderCount === 0 ? 0 : DB::table('orders')->whereIn('uuid', $orderUuids)->delete();
            $payloadDeleted = $payloads === [] ? 0 : DB::table('payloads')->whereIn('uuid', $payloads)->delete();
            $placeCount = $places === [] ? 0 : DB::table('places')->whereIn('uuid', $places)->delete();
            $customerDeleted = $contacts->isEmpty() ? 0 : DB::table('contacts')->whereIn('uuid', $contacts->pluck('uuid')->all())->delete();
            return [
                'orders_found' => $orderCount,
                'orders_deleted' => $orderDeleted,
                'customers_deleted' => $customerDeleted,
                'payloads_deleted' => $payloadDeleted,
                'places_deleted' => $placeCount,
                'tracking_numbers_deleted' => $trackingNumbersDeleted,
                'tracking_statuses_deleted' => $trackingStatusesDeleted,
            ];
        }, 1);
        (new WatermarkStore($statePath))->remove();
        return $counts;
    }
}

/**
 * Add the daily dispatch contract to the integration-owned orders created by
 * FleetbaseWriter. Both writers run inside one outer transaction, and this
 * dispatch phase remains independently idempotent for safe retries. It never
 * rewrites an order after operations has moved it beyond the governed
 * created/dispatched/canceled states.
 */
final class DailyDispatchWriter
{
    private string $companyUuid;
    private ?array $verificationResult = null;
    private array $touchedSubjectIds = ['order' => [], 'payload' => [], 'place' => []];
    private array $stats = [
        'pickup_places_created' => 0,
        'pickup_places_updated' => 0,
        'pickup_places_unchanged' => 0,
        'orders_dispatched' => 0,
        'orders_dispatched_real_pin' => 0,
        'orders_dispatched_call_required' => 0,
        'orders_held_no_pin' => 0,
        'orders_held_invalid_pin' => 0,
        'orders_held_unapproved_order_status' => 0,
        'orders_held_unapproved_status' => 0,
        'orders_held_source_canceled' => 0,
        'orders_held_source_missing' => 0,
        'orders_unchanged' => 0,
        'payloads_updated' => 0,
        'payloads_unchanged' => 0,
        'tracking_statuses_created' => 0,
        'tracking_statuses_unchanged' => 0,
        'tracking_hold_statuses_created' => 0,
        'tracking_hold_statuses_unchanged' => 0,
        'tracking_cancel_statuses_created' => 0,
        'tracking_cancel_statuses_unchanged' => 0,
        'address_call_artifacts_cleared' => 0,
    ];

    public function __construct(
        private string $prefix,
        private array $pickup,
        private array $drivers,
        private bool $allowAddressCall = false,
    ) {
        $this->companyUuid = resolveCompanyUuid();
        if ($this->drivers === []) {
            throw new RuntimeException('driver_roster_empty');
        }
    }

    public function apply(array $dailyRows, bool $verify = true): array
    {
        if ($dailyRows === []) {
            throw new RuntimeException('daily_source_empty');
        }
        $allocation = allocateDailyDrivers($dailyRows, $this->drivers, $this->allowAddressCall);
        $expectedAssigned = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowIsDailyRoutable($row, $this->allowAddressCall),
        ));
        if (count($allocation['assignments']) !== $expectedAssigned
            || array_sum($allocation['loads']) !== $expectedAssigned) {
            throw new RuntimeException('daily_allocation_reconciliation');
        }
        $activityIdBefore = (int) (DB::table('activity')->max('id') ?? 0);

        DB::transaction(function () use ($dailyRows, $allocation, $verify, $activityIdBefore): void {
            $pickup = $this->upsertPickup();
            $this->neutralizeMissingSourceOrders($dailyRows);
            foreach ($dailyRows as $row) {
                $this->applyOne($row, $allocation['assignments'], $pickup);
            }
            if ($verify) {
                $this->verificationResult = $this->verify($dailyRows, $allocation, $pickup);
            }
            $newTouchedActivity = DB::table('activity')
                ->where('id', '>', $activityIdBefore)
                ->where(function ($query) {
                    $query->where(function ($orderQuery) {
                        $orderQuery->where('subject_type', Order::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['order'])));
                    })->orWhere(function ($payloadQuery) {
                        $payloadQuery->where('subject_type', Payload::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['payload'])));
                    })->orWhere(function ($placeQuery) {
                        $placeQuery->where('subject_type', Place::class)
                            ->whereIn('subject_id', array_values(array_unique($this->touchedSubjectIds['place'])));
                    });
                })
                ->count();
            $this->stats['activity_rows_created'] = $newTouchedActivity;
            if ($newTouchedActivity !== 0) {
                throw new RuntimeException('fleetbase_activity_log_write');
            }
        }, 1);

        $loads = array_values($allocation['loads']);
        $this->stats['drivers_configured'] = count($loads);
        $this->stats['drivers_used'] = count(array_filter($loads, fn (int $load): bool => $load > 0));
        $this->stats['driver_load_min'] = min($loads);
        $this->stats['driver_load_max'] = max($loads);
        return $this->stats;
    }

    public function verificationResult(): ?array
    {
        return $this->verificationResult;
    }

    private function scheduledAtUtc(string $deliveryDate): string
    {
        $local = new DateTimeImmutable(
            validateDeliveryDate($deliveryDate) . ' ' . $this->pickup['dispatch_time'] . ':00',
            new DateTimeZone('Asia/Kuwait'),
        );
        return $local->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function upsertPickup(): Place
    {
        $integrationKey = $this->prefix . '-PICKUP';
        $query = Place::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('meta->integration_key', $integrationKey);
        if ((clone $query)->count() > 1) {
            throw new RuntimeException('daily_duplicate_pickup');
        }
        $place = $query->lockForUpdate()->first();
        $created = $place === null;
        $place ??= new Place();
        if (!$created) {
            $meta = metaArray($place->meta);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix
                || ($place->company_uuid ?? null) !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_pickup');
            }
        }
        $place->fill([
            'company_uuid' => $this->companyUuid,
            'owner_uuid' => null,
            'owner_type' => null,
            'name' => $this->pickup['name'],
            'street1' => $this->pickup['street1'],
            'city' => $this->pickup['city'],
            'district' => $this->pickup['city'],
            'country' => $this->pickup['country'],
            'location' => new Point($this->pickup['lat'], $this->pickup['lng']),
            'meta' => array_replace(metaArray($place->meta), [
                'integration_owner' => 'nutreeze_partner_orders',
                'integration_prefix' => $this->prefix,
                'integration_key' => $integrationKey,
                'daily_mapping_version' => DAILY_MAPPING_VERSION,
                'coordinate_source' => $this->pickup['coordinate_source'],
                'shared_pickup' => true,
            ]),
        ]);
        $place->setAttribute('deleted_at', null);
        $changed = saveWithoutActivity($place);
        $this->touchedSubjectIds['place'][] = $place->getKey();
        $this->stats[$created
            ? 'pickup_places_created'
            : ($changed ? 'pickup_places_updated' : 'pickup_places_unchanged')]++;
        return $place;
    }

    /**
     * A delivery that was present in an earlier complete snapshot but is absent
     * from the current two-pass manifest is retained as an auditable tombstone.
     * Unstarted jobs are canceled, unscheduled, and unassigned in this same
     * transaction; an advanced job fails closed for operator intervention.
     */
    private function neutralizeMissingSourceOrders(array $dailyRows): void
    {
        $sourceIds = array_fill_keys(array_map(
            fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'],
            $dailyRows,
        ), true);
        $orders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->get();
        foreach ($orders as $order) {
            if (isset($sourceIds[(string) $order->internal_id])) {
                continue;
            }
            $meta = metaArray($order->meta);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_order');
            }
            if ((bool) $order->started || $order->started_at !== null) {
                throw new RuntimeException('daily_started_source_missing');
            }
            if (!in_array((string) $order->status, ['created', 'dispatched', 'canceled'], true)) {
                throw new RuntimeException('daily_missing_source_state_guard');
            }
            $holdReason = 'source_row_missing';
            $wasCallRequired = ($meta['call_customer_required'] ?? false) === true;
            $order->fill([
                'driver_assigned_uuid' => null,
                'scheduled_at' => null,
                'status' => dailyHeldOrderStatus($holdReason),
                'dispatched' => false,
                'dispatched_at' => null,
                'notes' => str_replace(
                    ' | ' . ADDRESS_CALL_INSTRUCTION,
                    '',
                    (string) $order->notes,
                ),
                'meta' => array_replace($meta, [
                    'assignment_mode' => 'none',
                    'dispatch_state' => 'held_' . $holdReason,
                    'hold_reason' => $holdReason,
                    'source_location_exception' => null,
                    'call_customer_required' => false,
                    'navigation_mode' => 'held',
                    'location_accuracy' => 'not_routable',
                    'address_call_authorization' => null,
                    'source_missing_detected_at' => $meta['source_missing_detected_at'] ?? kuwaitNow(),
                ]),
            ]);
            $changed = saveWithoutActivity($order);
            $this->touchedSubjectIds['order'][] = $order->getKey();
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->lockForUpdate()
                ->first();
            if (!$payload) {
                throw new RuntimeException('daily_payload_resolution');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_payload');
            }
            $payload->fill([
                'meta' => array_replace($payloadMeta, [
                    'source_location_exception' => null,
                    'call_customer_required' => false,
                    'navigation_mode' => 'held',
                    'location_accuracy' => 'not_routable',
                    'address_call_authorization' => null,
                ]),
            ]);
            saveWithoutActivity($payload);
            $this->touchedSubjectIds['payload'][] = $payload->getKey();

            $place = Place::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $payload->dropoff_uuid)
                ->lockForUpdate()
                ->first();
            if (!$place) {
                throw new RuntimeException('daily_verify_dropoff');
            }
            $placeMeta = metaArray($place->meta);
            if (($placeMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($placeMeta['integration_prefix'] ?? null) !== $this->prefix) {
                throw new RuntimeException('daily_foreign_place');
            }
            $placeName = (string) $place->name;
            if (str_starts_with($placeName, ADDRESS_CALL_PLACE_PREFIX)) {
                $placeName = substr($placeName, strlen(ADDRESS_CALL_PLACE_PREFIX));
            }
            $place->fill(['name' => $placeName, 'street2' => null]);
            saveWithoutActivity($place);
            $this->touchedSubjectIds['place'][] = $place->getKey();
            if ($wasCallRequired) {
                $this->stats['address_call_artifacts_cleared']++;
            }
            $this->ensureHeldTracking($order, $holdReason);
            $this->stats['orders_held_source_missing']++;
            if (!$changed) {
                $this->stats['orders_unchanged']++;
            }
        }
    }

    private function applyOne(array $row, array $assignments, Place $pickup): void
    {
        $internalId = $this->prefix . '-ORDER-' . $row['order_id'];
        $query = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', $internalId);
        if ((clone $query)->count() !== 1) {
            throw new RuntimeException('daily_order_resolution');
        }
        $order = $query->lockForUpdate()->first();
        if (!$order) {
            throw new RuntimeException('daily_order_resolution');
        }
        $orderMeta = metaArray($order->meta);
        if (($orderMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($orderMeta['integration_prefix'] ?? null) !== $this->prefix
            || ($orderMeta['source_order_id'] ?? null) !== $row['order_id']) {
            throw new RuntimeException('daily_foreign_order');
        }
        $sourceHoldReason = dailyHoldReason($row);
        $routable = rowIsDailyRoutable($row, $this->allowAddressCall);
        $callCustomerRequired = rowRequiresCustomerCall($row, $this->allowAddressCall);
        $holdReason = $routable ? null : $sourceHoldReason;
        $allowedStates = ['created', 'dispatched'];
        if ($sourceHoldReason === 'source_order_canceled') {
            $allowedStates[] = 'canceled';
        }
        if (!in_array((string) $order->status, $allowedStates, true)) {
            throw new RuntimeException('daily_operational_state_guard');
        }

        $payload = Payload::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('uuid', $order->payload_uuid)
            ->lockForUpdate()
            ->first();
        if (!$payload) {
            throw new RuntimeException('daily_payload_resolution');
        }
        $payloadMeta = metaArray($payload->meta);
        if (($payloadMeta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
            || ($payloadMeta['integration_prefix'] ?? null) !== $this->prefix
            || ($payloadMeta['source_order_id'] ?? null) !== $row['order_id']
            || DB::table('orders')->where('payload_uuid', $payload->uuid)->where('uuid', '!=', $order->uuid)->exists()) {
            throw new RuntimeException('daily_foreign_payload');
        }

        $payload->fill([
            'pickup_uuid' => $pickup->uuid,
            'meta' => array_replace($payloadMeta, [
                'daily_mapping_version' => DAILY_MAPPING_VERSION,
                'delivery_date' => $row['delivery_date'],
                'meal_status' => $row['meal_status'],
                'meal_item_count' => $row['meal_item_count'],
                'meal_qty' => $row['meal_qty'],
                'meal_updated_at' => $row['meal_updated_at'],
                'source_order_status' => $row['source_order_status'],
                'daily_source_hash' => $row['_source_hash'],
                'daily_meal_hash' => dailyMealHash($row),
                'pickup_coordinate_source' => $this->pickup['coordinate_source'],
                'source_location_exception' => $callCustomerRequired ? $sourceHoldReason : null,
                'call_customer_required' => $callCustomerRequired,
                'navigation_mode' => $callCustomerRequired
                    ? 'address_then_call_customer'
                    : ($routable ? 'verified_customer_pin' : 'held'),
                'location_accuracy' => $callCustomerRequired
                    ? 'area_fallback_not_customer_pin'
                    : ($routable ? 'customer_pin' : 'not_routable'),
                'address_call_authorization' => $callCustomerRequired ? ADDRESS_CALL_AUTHORIZATION : null,
            ]),
        ]);
        $payloadChanged = saveWithoutActivity($payload);
        $this->touchedSubjectIds['payload'][] = $payload->getKey();
        $this->stats[$payloadChanged ? 'payloads_updated' : 'payloads_unchanged']++;

        $assignment = $assignments[(string) $row['order_id']] ?? null;
        // Immediate bridge-owned dispatch is deliberate. Fleetbase's native
        // scheduler completes lifecycle work through a queue whose deployed
        // Redis prefix is currently mismatched; relying on it would leave
        // partially-dispatched orders.
        $shouldDispatch = $routable;
        if ($routable !== ($assignment !== null)) {
            throw new RuntimeException('daily_assignment_pin_guard');
        }
        $scheduledAt = $this->scheduledAtUtc($row['delivery_date']);
        $dispatchState = $shouldDispatch
            ? ($callCustomerRequired ? 'dispatched_call_customer_required' : 'dispatched')
            : 'held_' . $holdReason;
        $expectedDriver = $routable ? $assignment : null;
        if ($order->driver_assigned_uuid !== null
            && $order->driver_assigned_uuid !== $expectedDriver
            && ((string) $order->status === 'dispatched'
                && ((bool) $order->started || $order->started_at !== null))) {
            throw new RuntimeException('daily_existing_driver_conflict');
        }
        if ((string) $order->status === 'dispatched'
            && (!$routable || $order->driver_assigned_uuid !== $expectedDriver)
            && ((bool) $order->started || $order->started_at !== null)) {
            throw new RuntimeException('daily_existing_dispatch_conflict');
        }

        $order->fill([
            'driver_assigned_uuid' => $expectedDriver,
            // A null schedule is a second fail-safe for held rows: Fleetbase's
            // minute scheduler selects undispatched created/pending orders whose
            // scheduled_at is due.
            'scheduled_at' => $routable ? $scheduledAt : null,
            'status' => $shouldDispatch ? 'dispatched' : dailyHeldOrderStatus($holdReason),
            'dispatched' => $shouldDispatch,
            'dispatched_at' => $shouldDispatch
                ? ($order->dispatched_at ?? gmdate('Y-m-d H:i:s'))
                : null,
            'meta' => array_replace($orderMeta, [
                'daily_mapping_version' => DAILY_MAPPING_VERSION,
                'delivery_date' => $row['delivery_date'],
                'meal_status' => $row['meal_status'],
                'meal_item_count' => $row['meal_item_count'],
                'meal_qty' => $row['meal_qty'],
                'meal_updated_at' => $row['meal_updated_at'],
                'source_order_status' => $row['source_order_status'],
                'daily_source_hash' => $row['_source_hash'],
                'daily_meal_hash' => dailyMealHash($row),
                'assignment_mode' => $callCustomerRequired
                    ? 'routing_area_rendezvous_call_required_v1'
                    : ($routable ? 'routing_area_rendezvous_v1' : 'none'),
                'dispatch_state' => $dispatchState,
                'hold_reason' => $holdReason,
                'source_location_exception' => $callCustomerRequired ? $sourceHoldReason : null,
                'call_customer_required' => $callCustomerRequired,
                'navigation_mode' => $callCustomerRequired
                    ? 'address_then_call_customer'
                    : ($routable ? 'verified_customer_pin' : 'held'),
                'location_accuracy' => $callCustomerRequired
                    ? 'area_fallback_not_customer_pin'
                    : ($routable ? 'customer_pin' : 'not_routable'),
                'address_call_authorization' => $callCustomerRequired ? ADDRESS_CALL_AUTHORIZATION : null,
                'dispatch_time_local' => $this->pickup['dispatch_time'],
                'dispatch_timezone' => 'Asia/Kuwait',
                'pickup_coordinate_source' => $this->pickup['coordinate_source'],
            ]),
        ]);
        $orderChanged = saveWithoutActivity($order);
        $this->touchedSubjectIds['order'][] = $order->getKey();
        if ($shouldDispatch) {
            $this->ensureDispatchedTracking($order);
            $this->stats['orders_dispatched']++;
            $this->stats[$callCustomerRequired
                ? 'orders_dispatched_call_required'
                : 'orders_dispatched_real_pin']++;
        } else {
            $this->ensureHeldTracking($order, $holdReason);
            $holdStat = match ($holdReason) {
                'no_real_location_pin' => 'orders_held_no_pin',
                'invalid_source_location_pin' => 'orders_held_invalid_pin',
                'source_order_canceled' => 'orders_held_source_canceled',
                'unapproved_order_status' => 'orders_held_unapproved_order_status',
                default => 'orders_held_unapproved_status',
            };
            $this->stats[$holdStat]++;
        }
        if (!$orderChanged) {
            $this->stats['orders_unchanged']++;
        }
    }

    private function ensureDispatchedTracking(Order $order): void
    {
        if ($order->tracking_number_uuid === null) {
            throw new RuntimeException('daily_tracking_number_missing');
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            throw new RuntimeException('daily_tracking_number_owner');
        }
        $statuses = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->where('code', 'DISPATCHED')
            ->get(['uuid', 'company_uuid']);
        if ($statuses->count() > 1) {
            throw new RuntimeException('daily_duplicate_dispatch_status');
        }
        $statusUuid = $statuses->first()->uuid ?? null;
        if ($statusUuid !== null) {
            if ($statuses->first()->company_uuid !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_dispatch_status');
            }
            $this->stats['tracking_statuses_unchanged']++;
        } else {
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumber->uuid,
                'status' => 'Order Dispatched',
                'details' => 'Order has been dispatched.',
                'code' => 'DISPATCHED',
                'complete' => 0,
                // Native dispatch starts tracking at the assigned driver or
                // pickup—not at the customer's destination. The bridge has no
                // trustworthy live driver coordinate, so use the configured
                // kitchen pickup.
                'location' => FleetOpsUtils::parsePointToWkt(new Point(
                    $this->pickup['lat'],
                    $this->pickup['lng'],
                )),
                'created_at' => gmdate('Y-m-d H:i:s'),
            ]);
            $this->stats['tracking_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) !== $statusUuid) {
            DB::table('tracking_numbers')
                ->where('uuid', $trackingNumber->uuid)
                ->update(['status_uuid' => $statusUuid, 'updated_at' => gmdate('Y-m-d H:i:s')]);
        }
    }

    private function ensureHeldTracking(Order $order, ?string $holdReason): void
    {
        if ($order->tracking_number_uuid === null) {
            throw new RuntimeException('daily_tracking_number_missing');
        }
        $trackingNumber = DB::table('tracking_numbers')
            ->where('uuid', $order->tracking_number_uuid)
            ->whereNull('deleted_at')
            ->first(['uuid', 'company_uuid', 'owner_uuid', 'status_uuid']);
        if (!$trackingNumber
            || $trackingNumber->company_uuid !== $this->companyUuid
            || $trackingNumber->owner_uuid !== $order->uuid) {
            throw new RuntimeException('daily_tracking_number_owner');
        }
        $trackingCode = dailyHeldTrackingCode($holdReason);
        $statuses = DB::table('tracking_statuses')
            ->where('tracking_number_uuid', $trackingNumber->uuid)
            ->whereNull('deleted_at')
            ->where('code', $trackingCode)
            ->get(['uuid', 'company_uuid']);
        if ($statuses->count() > 1) {
            throw new RuntimeException('daily_duplicate_hold_status');
        }
        $statusUuid = $statuses->first()->uuid ?? null;
        if ($statusUuid !== null) {
            if ($statuses->first()->company_uuid !== $this->companyUuid) {
                throw new RuntimeException('daily_foreign_hold_status');
            }
            $this->stats[$trackingCode === 'CANCELED'
                ? 'tracking_cancel_statuses_unchanged'
                : 'tracking_hold_statuses_unchanged']++;
        } else {
            $isCanceled = $trackingCode === 'CANCELED';
            $details = match ($holdReason) {
                'source_order_canceled' => 'Order canceled by the Partner source.',
                'source_row_missing' => 'Order canceled because the source delivery is no longer present.',
                'unapproved_order_status' => 'Order held because the source order status is not approved for dispatch.',
                'unapproved_meal_status' => 'Order held because the source meal status is not approved for dispatch.',
                'invalid_source_location_pin' => 'Order held because the source location is invalid.',
                default => 'Order held because a real source location is unavailable.',
            };
            $statusUuid = TrackingStatus::generateUuid();
            DB::table('tracking_statuses')->insert([
                'uuid' => $statusUuid,
                'public_id' => TrackingStatus::generatePublicId('status'),
                '_key' => 'console',
                'company_uuid' => $this->companyUuid,
                'tracking_number_uuid' => $trackingNumber->uuid,
                'status' => $isCanceled ? 'Order Canceled' : 'Order On Hold',
                'details' => $details,
                'code' => $trackingCode,
                'complete' => $isCanceled ? 1 : 0,
                'location' => FleetOpsUtils::parsePointToWkt(new Point(
                    $this->pickup['lat'],
                    $this->pickup['lng'],
                )),
                'created_at' => gmdate('Y-m-d H:i:s'),
            ]);
            $this->stats[$trackingCode === 'CANCELED'
                ? 'tracking_cancel_statuses_created'
                : 'tracking_hold_statuses_created']++;
        }
        if (($trackingNumber->status_uuid ?? null) !== $statusUuid) {
            DB::table('tracking_numbers')
                ->where('uuid', $trackingNumber->uuid)
                ->update(['status_uuid' => $statusUuid, 'updated_at' => gmdate('Y-m-d H:i:s')]);
        }
    }

    private function verify(array $dailyRows, array $allocation, Place $pickup): array
    {
        $expectedIds = array_map(
            fn (array $row): string => $this->prefix . '-ORDER-' . $row['order_id'],
            $dailyRows,
        );
        $prefixOrders = Order::withoutGlobalScopes()
            ->where('company_uuid', $this->companyUuid)
            ->where('internal_id', 'like', $this->prefix . '-ORDER-%')
            ->whereNull('deleted_at')
            ->get();
        $expectedIdLookup = array_fill_keys($expectedIds, true);
        if ($prefixOrders->pluck('internal_id')->unique()->count() !== $prefixOrders->count()
            || array_diff($expectedIds, $prefixOrders->pluck('internal_id')->all()) !== []) {
            throw new RuntimeException('daily_verify_order_reconciliation');
        }
        $missingTombstones = $prefixOrders->filter(
            fn (Order $order): bool => !isset($expectedIdLookup[(string) $order->internal_id]),
        );
        foreach ($missingTombstones as $order) {
            $meta = metaArray($order->meta);
            $trackingNumber = DB::table('tracking_numbers')
                ->where('uuid', $order->tracking_number_uuid)
                ->where('company_uuid', $this->companyUuid)
                ->where('owner_uuid', $order->uuid)
                ->whereNull('deleted_at')
                ->first(['uuid', 'status_uuid']);
            if (($meta['integration_owner'] ?? null) !== 'nutreeze_partner_orders'
                || ($meta['integration_prefix'] ?? null) !== $this->prefix
                || ($meta['dispatch_state'] ?? null) !== 'held_source_row_missing'
                || ($meta['hold_reason'] ?? null) !== 'source_row_missing'
                || ($meta['call_customer_required'] ?? false) !== false
                || ($meta['address_call_authorization'] ?? null) !== null
                || ($meta['source_location_exception'] ?? null) !== null
                || ($meta['navigation_mode'] ?? null) !== 'held'
                || ($meta['location_accuracy'] ?? null) !== 'not_routable'
                || str_contains((string) $order->notes, ADDRESS_CALL_INSTRUCTION)
                || (string) $order->status !== 'canceled'
                || (bool) $order->dispatched
                || (bool) $order->started
                || $order->started_at !== null
                || $order->driver_assigned_uuid !== null
                || (string) $order->getRawOriginal('scheduled_at') !== ''
                || !$trackingNumber
                || !DB::table('tracking_statuses')
                    ->where('uuid', $trackingNumber->status_uuid)
                    ->where('tracking_number_uuid', $trackingNumber->uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('code', 'CANCELED')
                    ->whereNull('deleted_at')
                    ->exists()) {
                throw new RuntimeException('daily_verify_missing_tombstone');
            }
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->first();
            $payloadMeta = $payload ? metaArray($payload->meta) : [];
            $dropoff = $payload
                ? Place::withoutGlobalScopes()
                    ->where('company_uuid', $this->companyUuid)
                    ->where('uuid', $payload->dropoff_uuid)
                    ->first()
                : null;
            if (!$payload
                || !$dropoff
                || ($payloadMeta['call_customer_required'] ?? false) !== false
                || ($payloadMeta['address_call_authorization'] ?? null) !== null
                || ($payloadMeta['source_location_exception'] ?? null) !== null
                || ($payloadMeta['navigation_mode'] ?? null) !== 'held'
                || ($payloadMeta['location_accuracy'] ?? null) !== 'not_routable'
                || str_starts_with((string) $dropoff->name, ADDRESS_CALL_PLACE_PREFIX)
                || $dropoff->street2 === ADDRESS_CALL_INSTRUCTION) {
                throw new RuntimeException('daily_verify_missing_tombstone_policy');
            }
        }
        $orders = $prefixOrders->keyBy('internal_id');
        $pickupMeta = metaArray($pickup->meta);
        if (($pickupMeta['integration_key'] ?? null) !== $this->prefix . '-PICKUP'
            || !$pickup->location instanceof Point
            || abs($pickup->location->getLat() - $this->pickup['lat']) > 0.000001
            || abs($pickup->location->getLng() - $this->pickup['lng']) > 0.000001) {
            throw new RuntimeException('daily_verify_pickup');
        }
        $expectedDriverUuids = array_fill_keys(array_column($this->drivers, 'uuid'), true);
        $actualLoads = array_fill_keys(array_column($this->drivers, 'uuid'), 0);
        $assigned = 0;
        $assignedRealPin = 0;
        $assignedCallRequired = 0;
        $held = 0;
        foreach ($dailyRows as $row) {
            $order = $orders->get($this->prefix . '-ORDER-' . $row['order_id']);
            if (!$order) {
                throw new RuntimeException('daily_verify_order_missing');
            }
            $meta = metaArray($order->meta);
            $scheduledRaw = (string) $order->getRawOriginal('scheduled_at');
            $expectedRoutable = rowIsDailyRoutable($row, $this->allowAddressCall);
            $expectedCallRequired = rowRequiresCustomerCall($row, $this->allowAddressCall);
            $expectedNavigationMode = $expectedCallRequired
                ? 'address_then_call_customer'
                : ($expectedRoutable ? 'verified_customer_pin' : 'held');
            $expectedLocationAccuracy = $expectedCallRequired
                ? 'area_fallback_not_customer_pin'
                : ($expectedRoutable ? 'customer_pin' : 'not_routable');
            if (($meta['daily_mapping_version'] ?? null) !== DAILY_MAPPING_VERSION
                || ($meta['delivery_date'] ?? null) !== $row['delivery_date']
                || ($meta['meal_status'] ?? null) !== $row['meal_status']
                || ($meta['meal_item_count'] ?? null) !== $row['meal_item_count']
                || ($meta['meal_qty'] ?? null) !== $row['meal_qty']
                || ($meta['source_order_status'] ?? null) !== $row['source_order_status']
                || ($meta['daily_source_hash'] ?? null) !== $row['_source_hash']
                || ($meta['daily_meal_hash'] ?? null) !== dailyMealHash($row)
                || ($meta['call_customer_required'] ?? null) !== $expectedCallRequired
                || ($meta['navigation_mode'] ?? null) !== $expectedNavigationMode
                || ($meta['location_accuracy'] ?? null) !== $expectedLocationAccuracy
                || ($meta['source_location_exception'] ?? null) !== (
                    $expectedCallRequired ? dailyHoldReason($row) : null
                )
                || ($meta['address_call_authorization'] ?? null) !== (
                    $expectedCallRequired ? ADDRESS_CALL_AUTHORIZATION : null
                )) {
                throw new RuntimeException('daily_verify_order_mapping');
            }
            $payload = Payload::withoutGlobalScopes()
                ->where('company_uuid', $this->companyUuid)
                ->where('uuid', $order->payload_uuid)
                ->first();
            if (!$payload
                || $payload->pickup_uuid !== $pickup->uuid
                || $payload->dropoff_uuid === null) {
                throw new RuntimeException('daily_verify_payload');
            }
            $payloadMeta = metaArray($payload->meta);
            if (($payloadMeta['delivery_date'] ?? null) !== $row['delivery_date']
                || ($payloadMeta['meal_qty'] ?? null) !== $row['meal_qty']
                || ($payloadMeta['source_order_status'] ?? null) !== $row['source_order_status']
                || ($payloadMeta['daily_source_hash'] ?? null) !== $row['_source_hash']
                || ($payloadMeta['daily_meal_hash'] ?? null) !== dailyMealHash($row)
                || ($payloadMeta['call_customer_required'] ?? null) !== $expectedCallRequired
                || ($payloadMeta['navigation_mode'] ?? null) !== $expectedNavigationMode
                || ($payloadMeta['location_accuracy'] ?? null) !== $expectedLocationAccuracy
                || ($payloadMeta['source_location_exception'] ?? null) !== (
                    $expectedCallRequired ? dailyHoldReason($row) : null
                )
                || ($payloadMeta['address_call_authorization'] ?? null) !== (
                    $expectedCallRequired ? ADDRESS_CALL_AUTHORIZATION : null
                )) {
                throw new RuntimeException('daily_verify_payload_mapping');
            }
            $expectedDriver = $allocation['assignments'][(string) $row['order_id']] ?? null;
            if ($expectedRoutable) {
                if ($expectedDriver === null
                    || !isset($expectedDriverUuids[$expectedDriver])
                    || $order->driver_assigned_uuid !== $expectedDriver
                    || ($meta['hold_reason'] ?? null) !== null
                    || ($meta['assignment_mode'] ?? null) !== (
                        $expectedCallRequired
                            ? 'routing_area_rendezvous_call_required_v1'
                            : 'routing_area_rendezvous_v1'
                    )
                    || $scheduledRaw !== $this->scheduledAtUtc($row['delivery_date'])) {
                    throw new RuntimeException('daily_verify_dispatch');
                }
                if ((string) $order->status !== 'dispatched'
                    || !(bool) $order->dispatched
                    || $order->dispatched_at === null
                    || ($meta['dispatch_state'] ?? null) !== (
                        $expectedCallRequired ? 'dispatched_call_customer_required' : 'dispatched'
                    )) {
                    throw new RuntimeException('daily_verify_dispatch');
                }
                $trackingNumber = DB::table('tracking_numbers')
                    ->where('uuid', $order->tracking_number_uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('owner_uuid', $order->uuid)
                    ->whereNull('deleted_at')
                    ->first(['uuid', 'status_uuid']);
                if (!$trackingNumber
                    || !DB::table('tracking_statuses')
                        ->where('uuid', $trackingNumber->status_uuid)
                        ->where('tracking_number_uuid', $trackingNumber->uuid)
                        ->where('company_uuid', $this->companyUuid)
                        ->where('code', 'DISPATCHED')
                        ->whereNull('deleted_at')
                        ->exists()) {
                    throw new RuntimeException('daily_verify_tracking');
                }
                $dropoff = Place::withoutGlobalScopes()->where('uuid', $payload->dropoff_uuid)->first();
                $expectedPin = resolveEffectivePin($row);
                $dropoffMeta = $dropoff ? metaArray($dropoff->meta) : [];
                if (!$dropoff
                    || !$dropoff->location instanceof Point
                    || abs($dropoff->location->getLat() - $expectedPin['lat']) > 0.000001
                    || abs($dropoff->location->getLng() - $expectedPin['lng']) > 0.000001
                    || ($dropoffMeta['pin_source'] ?? null) !== $expectedPin['pin_source']
                    || ($dropoffMeta['fallback_scope'] ?? null) !== $expectedPin['fallback_scope']
                    || $dropoff->name !== sourcePlaceName($row, $this->allowAddressCall)
                    || $dropoff->street1 !== $row['address_text']
                    || $dropoff->street2 !== addressCallInstruction($row, $this->allowAddressCall)
                    || $dropoff->phone !== $row['customer_phone']
                    || $order->notes !== sourceOrderNotes($row, $this->allowAddressCall)) {
                    throw new RuntimeException('daily_verify_dropoff');
                }
                $actualLoads[$expectedDriver]++;
                $assigned++;
                if ($expectedCallRequired) {
                    $assignedCallRequired++;
                } else {
                    $assignedRealPin++;
                }
            } else {
                $expectedHoldReason = dailyHoldReason($row);
                if ($expectedDriver !== null
                    || $order->driver_assigned_uuid !== null
                    || (string) $order->status !== dailyHeldOrderStatus($expectedHoldReason)
                    || (bool) $order->dispatched
                    || $scheduledRaw !== ''
                    || ($meta['dispatch_state'] ?? null) !== 'held_' . $expectedHoldReason
                    || ($meta['hold_reason'] ?? null) !== $expectedHoldReason) {
                    throw new RuntimeException('daily_verify_hold');
                }
                $trackingNumber = DB::table('tracking_numbers')
                    ->where('uuid', $order->tracking_number_uuid)
                    ->where('company_uuid', $this->companyUuid)
                    ->where('owner_uuid', $order->uuid)
                    ->whereNull('deleted_at')
                    ->first(['uuid', 'status_uuid']);
                if (!$trackingNumber
                    || !DB::table('tracking_statuses')
                        ->where('uuid', $trackingNumber->status_uuid)
                        ->where('tracking_number_uuid', $trackingNumber->uuid)
                        ->where('company_uuid', $this->companyUuid)
                        ->where('code', dailyHeldTrackingCode($expectedHoldReason))
                        ->whereNull('deleted_at')
                        ->exists()) {
                    throw new RuntimeException('daily_verify_hold_tracking');
                }
                $held++;
            }
        }
        $expectedLoadsByUuid = [];
        foreach ($this->drivers as $driver) {
            $expectedLoadsByUuid[$driver['uuid']] = $allocation['loads'][$driver['public_id']] ?? -1;
        }
        ksort($actualLoads);
        ksort($expectedLoadsByUuid);
        if ($actualLoads !== $expectedLoadsByUuid
            || $assigned + $held !== count($dailyRows)) {
            throw new RuntimeException('daily_verify_load_reconciliation');
        }
        return [
            'passed' => true,
            'source_orders' => count($dailyRows),
            'fleetbase_orders' => $prefixOrders->count(),
            'source_missing_tombstones' => $missingTombstones->count(),
            'assigned_orders' => $assigned,
            'assigned_real_pin' => $assignedRealPin,
            'assigned_call_required' => $assignedCallRequired,
            'held_unroutable' => $held,
            'pickup_places' => 1,
            'scheduled_orders' => $assigned,
            'held_unscheduled_orders' => $held,
            'duplicate_internal_ids' => 0,
            'unexplained_orders' => 0,
        ];
    }
}

function acquireLock(string $prefix): string
{
    $companyUuid = resolveCompanyUuid();
    $name = 'nutreeze_orders_' . substr(hash('sha256', $prefix . '|' . $companyUuid), 0, 32);
    $row = DB::selectOne('SELECT GET_LOCK(?, 0) AS acquired', [$name]);
    if ((int) ($row->acquired ?? 0) !== 1) {
        throw new RuntimeException('integration_lock_busy');
    }
    return $name;
}

function releaseLock(?string $name): void
{
    if ($name !== null) {
        DB::selectOne('SELECT RELEASE_LOCK(?) AS released', [$name]);
    }
}

function runSelfTest(): array
{
    $base = [
        'order_number' => 'SAME-DISPLAY',
        'status' => 'success',
        'area_ar' => 'منطقة اختبار',
        'area_en' => 'Synthetic Area',
        'location_pin' => null,
        'customer_ref' => 'SYN-1',
        'customer_name' => 'Synthetic Customer',
        'customer_phone' => '+000000000',
        'address_text' => 'Synthetic Address',
        'created_at' => '2026-07-12T00:00:00+03:00',
        'updated_at' => '2026-07-12T00:00:00+03:00',
    ];
    $a = validateRow(['order_id' => 1] + $base);
    $b = validateRow(['order_id' => 2, 'customer_ref' => 'SYN-2', 'location_pin' => '29.3000,48.0000'] + $base);
    $fallback = validateRow(['order_id' => 3, 'customer_ref' => 'SYN-3', 'area_en' => null] + $base);
    $cancel = validateRow(['order_id' => 4, 'customer_ref' => 'SYN-4', 'status' => 'cancel'] + $base);
    $active = validateRow(['order_id' => 9, 'customer_ref' => 'SYN-9', 'status' => 'active'] + $base);
    if ($a['pin'] !== null
        || $b['pin'] === null
        || $fallback['routing_area'] !== 'منطقة اختبار'
        || $cancel['status'] !== 'cancel'
        || $active['status'] !== 'active') {
        throw new RuntimeException('self_test_mapping');
    }
    if (count(deduplicateRows([
        ['order_id' => 1] + $base,
        ['order_id' => 2, 'customer_ref' => 'SYN-2'] + $base,
    ])) !== 2) {
        throw new RuntimeException('self_test_order_number_identity');
    }
    $invalidPin = validateRow(['order_id' => 5, 'customer_ref' => 'SYN-5', 'location_pin' => '999,999'] + $base);
    $transposedPin = validateRow(['order_id' => 7, 'customer_ref' => 'SYN-7', 'location_pin' => '48.0000,29.3000'] + $base);
    $zeroPin = validateRow(['order_id' => 8, 'customer_ref' => 'SYN-8', 'location_pin' => '0,0'] + $base);
    if ($invalidPin['pin'] !== null
        || $transposedPin['pin'] !== null
        || $zeroPin['pin'] !== null
        || pinHoldReason($invalidPin) !== 'invalid_source_location_pin') {
        throw new RuntimeException('self_test_pin_validation');
    }
    $vendorPin = resolveEffectivePin($b);
    if ($vendorPin['pin_source'] !== 'vendor'
        || abs($vendorPin['lat'] - 29.3) > 0.000001
        || abs($vendorPin['lng'] - 48.0) > 0.000001) {
        throw new RuntimeException('self_test_vendor_pin_passthrough');
    }
    $areaPin = resolveEffectivePin(validateRow(['order_id' => 6, 'customer_ref' => 'SYN-6', 'area_en' => 'Farwaniya'] + $base));
    if ($areaPin['pin_source'] !== 'area_fallback'
        || $areaPin['fallback_scope'] !== 'area'
        || abs($areaPin['lat'] - AREA_FALLBACK_CENTROIDS['farwaniya'][0]) > 0.000001) {
        throw new RuntimeException('self_test_area_fallback');
    }
    $countryPin = resolveEffectivePin($a);
    if ($countryPin['pin_source'] !== 'area_fallback' || $countryPin['fallback_scope'] !== 'country') {
        throw new RuntimeException('self_test_country_fallback');
    }
    $mealBase = [
        'customer_ref' => 'SYN-1',
        'order_number' => 'DAILY-1',
        'delivery_date' => '2026-07-19',
        'status' => 'driver_assigned',
        'meal_id' => 101,
        'meal_name_ar' => 'وجبة',
        'meal_name_en' => 'Meal',
        'qty' => 2,
        'updated_at' => '2026-07-18T10:00:00+03:00',
    ];
    $dailyOrders = [
        ['order_id' => 11, 'order_number' => 'DAILY-1', 'location_pin' => '29.3000,48.0000'] + $base,
        ['order_id' => 12, 'order_number' => 'DAILY-2', 'customer_ref' => 'SYN-2'] + $base,
    ];
    $dailyMeals = [
        $mealBase,
        ['meal_id' => 102, 'qty' => 1] + $mealBase,
        ['customer_ref' => 'SYN-2', 'order_number' => 'DAILY-2', 'meal_id' => 201, 'qty' => 1] + $mealBase,
    ];
    $daily = buildDailyRows($dailyMeals, $dailyOrders, '2026-07-19');
    if (count($daily) !== 2
        || $daily[0]['meal_item_count'] !== 2
        || $daily[0]['meal_qty'] !== 3
        || $daily[1]['pin'] !== null) {
        throw new RuntimeException('self_test_daily_join');
    }
    $syntheticDrivers = [
        ['uuid' => 'driver-uuid-a', 'public_id' => 'driver_AAAAAA'],
        ['uuid' => 'driver-uuid-b', 'public_id' => 'driver_BBBBBB'],
    ];
    $allocation = allocateDailyDrivers($daily, $syntheticDrivers);
    $assignedDriver = $allocation['assignments']['11'] ?? null;
    $unrelatedArea = $daily[0];
    $unrelatedArea['order_id'] = 99;
    $unrelatedArea['routing_area'] = 'Unrelated Area';
    $expandedAllocation = allocateDailyDrivers([...$daily, $unrelatedArea], $syntheticDrivers);
    if (count($allocation['assignments']) !== 1
        || !in_array($assignedDriver, ['driver-uuid-a', 'driver-uuid-b'], true)
        || array_sum($allocation['loads']) !== 1
        || ($expandedAllocation['assignments']['11'] ?? null) !== $assignedDriver) {
        throw new RuntimeException('self_test_daily_allocation');
    }
    $canceledDaily = buildDailyRows(
        [$mealBase],
        [['status' => 'cancel'] + $dailyOrders[0]],
        '2026-07-19',
    );
    $canceledBase = dailyRowsForBaseWriter($canceledDaily);
    if (($canceledDaily[0]['source_order_status'] ?? null) !== 'cancel'
        || dailyHoldReason($canceledDaily[0]) !== 'source_order_canceled'
        || rowIsDailyRoutable($canceledDaily[0])
        || dailyHeldOrderStatus(dailyHoldReason($canceledDaily[0])) !== 'canceled'
        || dailyHeldTrackingCode(dailyHoldReason($canceledDaily[0])) !== 'CANCELED'
        || $canceledBase[0]['status'] !== 'pending'
        || $canceledBase[0]['_source_hash'] !== $canceledDaily[0]['_source_hash']) {
        throw new RuntimeException('self_test_daily_source_cancellation');
    }
    $unknownStatusDaily = buildDailyRows(
        [['status' => 'skipped'] + $mealBase],
        [$dailyOrders[0]],
        '2026-07-19',
    );
    $pendingOrderDaily = buildDailyRows(
        [$mealBase],
        [['status' => 'pending'] + $dailyOrders[0]],
        '2026-07-19',
    );
    if (dailyHoldReason($unknownStatusDaily[0]) !== 'unapproved_meal_status'
        || rowIsDailyRoutable($unknownStatusDaily[0])
        || allocateDailyDrivers($unknownStatusDaily, $syntheticDrivers)['assignments'] !== []
        || dailyHoldReason($pendingOrderDaily[0]) !== 'unapproved_order_status'
        || rowIsDailyRoutable($pendingOrderDaily[0])) {
        throw new RuntimeException('self_test_daily_status_allowlist');
    }
    $authorizedRealPin = $daily[0];
    $authorizedRealPin['delivery_date'] = '2026-07-20';
    $authorizedFallback = $daily[1];
    $authorizedFallback['delivery_date'] = '2026-07-20';
    $authorizedFallback['area_en'] = 'Farwaniya';
    $authorizedFallback['routing_area'] = 'Farwaniya';
    $authorizedInvalid = $authorizedFallback;
    $authorizedInvalid['order_id'] = 13;
    $authorizedInvalid['location_pin'] = '999,999';
    $authorizedCountryFallback = $daily[1];
    $authorizedCountryFallback['delivery_date'] = '2026-07-20';
    $authorizedUnapproved = $unknownStatusDaily[0];
    $authorizedUnapproved['delivery_date'] = '2026-07-20';
    $authorizedUnapproved['area_en'] = 'Farwaniya';
    $authorizedUnapproved['routing_area'] = 'Farwaniya';
    if (rowIsDailyRoutable($authorizedFallback)
        || !rowRequiresCustomerCall($authorizedFallback, true)
        || !rowRequiresCustomerCall($authorizedInvalid, true)
        || !rowIsDailyRoutable($authorizedFallback, true)
        || rowRequiresCustomerCall($authorizedRealPin, true)
        || rowRequiresCustomerCall($authorizedCountryFallback, true)
        || rowRequiresCustomerCall($authorizedUnapproved, true)
        || rowRequiresCustomerCall(['address_text' => ''] + $authorizedFallback, true)
        || rowRequiresCustomerCall(['customer_phone' => ''] + $authorizedFallback, true)
        || rowRequiresCustomerCall(['delivery_date' => '2026-07-21'] + $authorizedFallback, true)) {
        throw new RuntimeException('self_test_daily_address_call_policy');
    }
    $authorizedAllocation = allocateDailyDrivers(
        [$authorizedRealPin, $authorizedFallback, $authorizedInvalid],
        $syntheticDrivers,
        true,
    );
    if (count($authorizedAllocation['assignments']) !== 3
        || array_sum($authorizedAllocation['loads']) !== 3
        || addressCallInstruction($authorizedFallback, true) === null
        || !str_starts_with(sourcePlaceName($authorizedFallback, true), 'CALL CUSTOMER FIRST')
        || !str_contains(sourceOrderNotes($authorizedFallback, true), 'CALL CUSTOMER')) {
        throw new RuntimeException('self_test_daily_address_call_allocation');
    }
    if (!resolveAddressCallAuthorization('2026-07-20', '2026-07-20')
        || resolveAddressCallAuthorization('2026-07-20', null)) {
        throw new RuntimeException('self_test_daily_address_call_confirmation');
    }
    foreach ([
        ['2026-07-20', '2026-07-19', 'daily_address_call_confirmation_guard'],
        ['2026-07-21', '2026-07-21', 'daily_address_call_date_not_authorized'],
    ] as [$date, $confirmation, $expectedError]) {
        try {
            resolveAddressCallAuthorization($date, $confirmation);
            throw new RuntimeException('self_test_daily_address_call_confirmation_not_rejected');
        } catch (RuntimeException $exception) {
            if ($exception->getMessage() !== $expectedError) {
                throw $exception;
            }
        }
    }
    $repeatedMealItems = buildDailyRows([$mealBase, $mealBase], $dailyOrders, '2026-07-19');
    if (count($repeatedMealItems) !== 1
        || $repeatedMealItems[0]['meal_item_count'] !== 2
        || $repeatedMealItems[0]['meal_qty'] !== 4) {
        throw new RuntimeException('self_test_daily_repeated_meal_item');
    }
    $missingContextRejected = false;
    try {
        buildDailyRows([$mealBase], [], '2026-07-19');
    } catch (RuntimeException $exception) {
        $missingContextRejected = $exception->getMessage() === 'daily_order_context_missing';
    }
    if (!$missingContextRejected) {
        throw new RuntimeException('self_test_daily_missing_context');
    }
    $invalidDateRejected = false;
    try {
        validateDeliveryDate('2026-02-30');
    } catch (RuntimeException) {
        $invalidDateRejected = true;
    }
    if (!$invalidDateRejected) {
        throw new RuntimeException('self_test_daily_date');
    }
    if (dailySourceDigest($daily) !== dailySourceDigest($daily)
        || dailySourceDigest($daily) === dailySourceDigest(array_reverse($daily))) {
        throw new RuntimeException('self_test_daily_digest');
    }
    $conflictingOrderRejected = false;
    try {
        buildDailyRows(
            [$mealBase],
            [
                $dailyOrders[0],
                ['address_text' => 'Different Address'] + $dailyOrders[0],
            ],
            '2026-07-19',
        );
    } catch (RuntimeException $exception) {
        $conflictingOrderRejected = $exception->getMessage() === 'contract_daily_conflicting_order_snapshot';
    }
    if (!$conflictingOrderRejected) {
        throw new RuntimeException('self_test_daily_order_snapshot');
    }
    if (buildDailyRows([], [], '2026-07-19') !== []) {
        throw new RuntimeException('self_test_daily_zero');
    }
    return ['passed' => 22, 'total' => 22];
}

$stage = 'startup';
$lockName = null;
$token = null;

try {
    $options = getopt('', [
        'since:', 'limit:', 'prefix:', 'state-file:', 'token-stdin', 'dry-run', 'verify',
        'self-test', 'cleanup-prefix:', 'confirm-cleanup:', 'fail-after-page:', 'fail-before-watermark',
        'confirm-since-override:', 'backfill-display', 'confirm-backfill:',
        'delivery-date:', 'meal-since:', 'driver-roster:', 'pickup-config:',
        'expected-count:', 'expected-digest:', 'confirm-daily-sync:', 'confirm-zero-day:',
        'confirm-address-call-dispatch:',
    ]);

    if (isset($options['self-test'])) {
        $result = runSelfTest();
        safeLog('self_test', $result);
        exit(0);
    }

    $deliveryDate = isset($options['delivery-date'])
        ? validateDeliveryDate((string) $options['delivery-date'])
        : null;
    $allowAddressCall = resolveAddressCallAuthorization(
        $deliveryDate,
        $options['confirm-address-call-dispatch'] ?? null,
    );
    $dailyPrefix = $deliveryDate === null
        ? null
        : DEFAULT_DAILY_PREFIX . '-' . str_replace('-', '', $deliveryDate);
    $prefix = strtoupper((string) ($options['prefix'] ?? $options['cleanup-prefix'] ?? $dailyPrefix ?? DEFAULT_PREFIX));
    if (!preg_match('/^[A-Z0-9][A-Z0-9-]{2,60}$/', $prefix)) {
        throw new RuntimeException('prefix_invalid');
    }
    if ($deliveryDate !== null && !hash_equals((string) $dailyPrefix, $prefix)) {
        throw new RuntimeException('daily_prefix_override_guard');
    }
    if ($deliveryDate !== null
        && (isset($options['cleanup-prefix'])
            || isset($options['backfill-display'])
            || isset($options['since'])
            || isset($options['fail-after-page'])
            || isset($options['fail-before-watermark'])
            || isset($options['confirm-since-override']))) {
        throw new RuntimeException('daily_option_conflict');
    }
    $companyUuid = resolveCompanyUuid();
    $companyStateKey = substr(hash('sha256', $companyUuid), 0, 12);
    $expectedStatePath = '/fleetbase/api/storage/app/integrations/state/' . strtolower($prefix) . '-' . $companyStateKey . '.json';
    $statePath = (string) ($options['state-file'] ?? $expectedStatePath);
    if (!hash_equals($expectedStatePath, $statePath)) {
        throw new RuntimeException('watermark_prefix_mismatch');
    }
    $lockName = acquireLock($prefix);

    if (isset($options['cleanup-prefix'])) {
        $stage = 'cleanup';
        if (getenv('NUTREEZE_TEST_MODE') !== '1' || ($options['confirm-cleanup'] ?? null) !== $prefix) {
            throw new RuntimeException('cleanup_confirmation_guard');
        }
        $counts = FleetbaseWriter::cleanup($prefix, $statePath);
        safeLog('cleanup', $counts);
        releaseLock($lockName);
        exit(0);
    }

    if (isset($options['backfill-display'])) {
        // Re-apply the current mapping (tracking records + flagged fallback places) to
        // this prefix's already-imported orders. No vendor fetch, no watermark change.
        // Touches only rows carrying this integration's ownership markers.
        $stage = 'backfill_display';
        if (($options['confirm-backfill'] ?? null) !== $prefix) {
            throw new RuntimeException('backfill_confirmation_guard');
        }
        $writer = new FleetbaseWriter($prefix);
        $result = $writer->backfillDisplay();
        safeLog('backfill_display', $result);
        safeLog('verification', $writer->verificationResult() ?? ['passed' => false]);
        releaseLock($lockName);
        exit(0);
    }

    if ($deliveryDate === null && getenv('NUTREEZE_ALLOW_LEGACY_INCREMENTAL') !== '1') {
        throw new RuntimeException('legacy_incremental_disabled');
    }

    $stage = 'configuration';
    $limit = (int) ($options['limit'] ?? DEFAULT_LIMIT);
    if ($limit < 1 || $limit > 1000) {
        throw new RuntimeException('limit_invalid');
    }

    if (!isset($options['token-stdin'])) {
        throw new RuntimeException('vendor_token_stdin_required');
    }
    putenv('NUTREEZE_API_KEY');
    $tokenInput = (string) stream_get_contents(STDIN, 4097);
    if (strlen($tokenInput) > 4096) {
        throw new RuntimeException('vendor_token_too_long');
    }
    $token = trim($tokenInput);
    $tokenInput = null;
    if ($token === '') {
        throw new RuntimeException('vendor_token_missing');
    }

    if ($deliveryDate !== null) {
        $stage = 'daily_configuration';
        $mealSince = (string) ($options['meal-since'] ?? '');
        if ($mealSince === '') {
            throw new RuntimeException('daily_meal_since_required');
        }
        $mealSinceTime = parseTimestamp($mealSince, 'meal_since');
        if ($mealSinceTime > parseTimestamp(DAILY_PROVEN_HISTORY_FLOOR, 'daily_history_floor')) {
            throw new RuntimeException('daily_history_floor_too_recent');
        }
        $expectedCount = null;
        if (isset($options['expected-count'])) {
            $expectedRaw = (string) $options['expected-count'];
            if (!preg_match('/^(?:0|[1-9]\d{0,6})$/', $expectedRaw)) {
                throw new RuntimeException('daily_expected_count_invalid');
            }
            $expectedCount = (int) $expectedRaw;
        }
        $expectedDigest = null;
        if (isset($options['expected-digest'])) {
            $expectedDigest = strtolower((string) $options['expected-digest']);
            if (!preg_match('/^[a-f0-9]{64}$/', $expectedDigest)) {
                throw new RuntimeException('daily_expected_digest_invalid');
            }
        }

        $stage = 'daily_vendor_fetch';
        $fetched = (new VendorClient($token))->fetchDailySource($deliveryDate, $mealSince, $limit);
        $token = null;
        putenv('NUTREEZE_API_KEY');

        $stage = 'daily_contract_validation';
        $dailyRows = buildDailyRows($fetched['meal_rows'], $fetched['order_rows'], $deliveryDate);
        $futureLimit = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->modify('+5 minutes');
        foreach ($fetched['meal_rows'] as $rawMeal) {
            $meal = validateMealHistoryRow($rawMeal);
            if ($meal['_updated_time'] < $mealSinceTime) {
                throw new RuntimeException('vendor_since_violation');
            }
            if ($meal['_updated_time'] > $futureLimit) {
                throw new RuntimeException('vendor_future_timestamp');
            }
        }
        foreach ($dailyRows as $dailyRow) {
            if (parseTimestamp($dailyRow['updated_at'], 'updated_at') > $futureLimit
                || parseTimestamp($dailyRow['meal_updated_at'], 'meal_updated_at') > $futureLimit) {
                throw new RuntimeException('vendor_future_timestamp');
            }
        }
        $sourceRealPinCount = count(array_filter($dailyRows, fn (array $row): bool => $row['pin'] !== null));
        $routableCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $heldCount = count($dailyRows) - $routableCount;
        $sourceDigest = dailySourceDigest($dailyRows);
        $sourceMissingPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => pinHoldReason($row) === 'no_real_location_pin',
        ));
        $sourceInvalidPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => pinHoldReason($row) === 'invalid_source_location_pin',
        ));
        $addressCallCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => rowRequiresCustomerCall($row, $allowAddressCall),
        ));
        $locationAreaFallbackCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )
                && resolveEffectivePin($row)['fallback_scope'] === 'area',
        ));
        $locationCountryFallbackCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => in_array(
                dailyHoldReason($row),
                ['no_real_location_pin', 'invalid_source_location_pin'],
                true,
            )
                && resolveEffectivePin($row)['fallback_scope'] === 'country',
        ));
        $heldMissingPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'no_real_location_pin'
                && !rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $heldInvalidPinCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'invalid_source_location_pin'
                && !rowIsDailyRoutable($row, $allowAddressCall),
        ));
        $unapprovedStatusCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'unapproved_meal_status',
        ));
        $unapprovedOrderStatusCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'unapproved_order_status',
        ));
        $sourceCanceledCount = count(array_filter(
            $dailyRows,
            fn (array $row): bool => dailyHoldReason($row) === 'source_order_canceled',
        ));
        safeLog('daily_source_summary', [
            'delivery_date' => $deliveryDate,
            'meal_pages' => $fetched['meal_pages'],
            'meal_response_rows' => $fetched['meal_response_rows'],
            'daily_meal_rows' => count($fetched['meal_rows']),
            'order_pages' => $fetched['order_pages'],
            'order_response_rows' => $fetched['order_response_rows'],
            'daily_orders' => count($dailyRows),
            'orders_with_real_pin' => $sourceRealPinCount,
            'orders_dispatchable' => $routableCount,
            'orders_dispatchable_real_pin' => $routableCount - $addressCallCount,
            'orders_dispatchable_address_call' => $addressCallCount,
            'source_orders_missing_pin' => $sourceMissingPinCount,
            'source_orders_invalid_pin' => $sourceInvalidPinCount,
            'orders_location_area_fallback' => $locationAreaFallbackCount,
            'orders_location_country_fallback_held' => $locationCountryFallbackCount,
            'orders_held_missing_pin' => $heldMissingPinCount,
            'orders_held_invalid_pin' => $heldInvalidPinCount,
            'orders_held_unapproved_meal_status' => $unapprovedStatusCount,
            'orders_held_unapproved_order_status' => $unapprovedOrderStatusCount,
            'orders_held_source_canceled' => $sourceCanceledCount,
            'address_call_override' => $allowAddressCall,
            'address_call_authorization' => $allowAddressCall ? ADDRESS_CALL_AUTHORIZATION : null,
            'expected_count' => $expectedCount,
            'source_digest' => $sourceDigest,
            'expected_digest' => $expectedDigest,
            'manifest_checked' => $expectedCount !== null && $expectedDigest !== null,
            'reconciled' => $expectedCount !== null
                && $expectedDigest !== null
                && count($dailyRows) === $expectedCount
                && hash_equals($expectedDigest, $sourceDigest),
        ]);
        if ($expectedCount !== null && count($dailyRows) !== $expectedCount) {
            throw new RuntimeException('daily_expected_count_mismatch');
        }
        if ($expectedDigest !== null && !hash_equals($expectedDigest, $sourceDigest)) {
            throw new RuntimeException('daily_expected_digest_mismatch');
        }

        if (isset($options['dry-run'])) {
            safeLog('complete', [
                'dry_run' => true,
                'delivery_date' => $deliveryDate,
                'source_orders' => count($dailyRows),
                'fleetbase_written' => false,
            ]);
            releaseLock($lockName);
            exit(0);
        }
        if (!isset($options['confirm-daily-sync'])
            || !hash_equals($deliveryDate, (string) $options['confirm-daily-sync'])) {
            throw new RuntimeException('daily_confirmation_guard');
        }
        if ($expectedCount === null || $expectedDigest === null) {
            throw new RuntimeException('daily_source_manifest_required');
        }
        if ($dailyRows === []) {
            if (!isset($options['confirm-zero-day'])
                || !hash_equals($deliveryDate, (string) $options['confirm-zero-day'])) {
                throw new RuntimeException('daily_zero_day_confirmation_required');
            }
            $existingCount = Order::withoutGlobalScopes()
                ->where('company_uuid', $companyUuid)
                ->where('internal_id', 'like', $prefix . '-ORDER-%')
                ->whereNull('deleted_at')
                ->count();
            if ($existingCount !== 0) {
                throw new RuntimeException('daily_zero_source_existing_orders');
            }
            safeLog('daily_verification', [
                'passed' => true,
                'source_orders' => 0,
                'fleetbase_orders' => 0,
                'unexplained_orders' => 0,
                'duplicate_internal_ids' => 0,
            ]);
            safeLog('complete', [
                'dry_run' => false,
                'delivery_date' => $deliveryDate,
                'source_orders' => 0,
                'assigned_orders' => 0,
                'held_orders' => 0,
                'verified' => true,
                'watermark_committed' => false,
            ]);
            releaseLock($lockName);
            exit(0);
        }
        $driverRosterPath = (string) ($options['driver-roster'] ?? '');
        $pickupConfigPath = (string) ($options['pickup-config'] ?? '');
        if ($driverRosterPath === '' || $pickupConfigPath === '') {
            throw new RuntimeException('daily_config_paths_required');
        }
        $drivers = loadDriverRoster($driverRosterPath, $companyUuid);
        $pickup = loadPickupConfig($pickupConfigPath);
        guardDailyOperationalRows($prefix, $dailyRows, $drivers, $companyUuid, $allowAddressCall);
        $baseRows = dailyRowsForBaseWriter($dailyRows);

        $stage = 'daily_fleetbase_transaction';
        $dailyWrite = DB::transaction(function () use (
            &$stage,
            $prefix,
            $dailyRows,
            $baseRows,
            $pickup,
            $drivers,
            $allowAddressCall,
        ): array {
            $stage = 'daily_fleetbase_upsert';
            $writer = new FleetbaseWriter($prefix, $allowAddressCall);
            $writeStats = $writer->upsert($baseRows, $baseRows);

            $stage = 'daily_dispatch';
            $dispatchWriter = new DailyDispatchWriter($prefix, $pickup, $drivers, $allowAddressCall);
            $dispatchStats = $dispatchWriter->apply($dailyRows, true);
            return [
                'write_stats' => $writeStats,
                'base_verification' => $writer->verificationResult() ?? ['passed' => false],
                'dispatch_stats' => $dispatchStats,
                'daily_verification' => $dispatchWriter->verificationResult() ?? ['passed' => false],
            ];
        }, 1);
        safeLog('write_summary', $dailyWrite['write_stats']);
        safeLog('base_verification', $dailyWrite['base_verification']);
        safeLog('dispatch_summary', $dailyWrite['dispatch_stats']);
        safeLog('daily_verification', $dailyWrite['daily_verification']);
        $stage = 'daily_cache_invalidation';
        safeLog('cache_invalidation', invalidateDailyCaches($prefix, $companyUuid));
        safeLog('complete', [
            'dry_run' => false,
            'delivery_date' => $deliveryDate,
            'source_orders' => count($dailyRows),
            'assigned_orders' => $routableCount,
            'held_orders' => $heldCount,
            'verified' => true,
            'watermark_committed' => false,
        ]);
        releaseLock($lockName);
        exit(0);
    }

    $store = new WatermarkStore($statePath);
    $storedWatermark = $store->read();
    $explicitSince = isset($options['since']) ? (string) $options['since'] : null;
    $since = (string) ($explicitSince ?? $storedWatermark ?? getenv('NUTREEZE_INITIAL_SINCE') ?: '');
    if ($since === '') {
        throw new RuntimeException('initial_since_required');
    }
    $sinceTime = parseTimestamp($since, 'since');
    if ($storedWatermark !== null && $explicitSince !== null && $explicitSince !== $storedWatermark) {
        $confirmedTestOverride = getenv('NUTREEZE_TEST_MODE') === '1'
            && isset($options['confirm-since-override'])
            && hash_equals($explicitSince, (string) $options['confirm-since-override']);
        if (!$confirmedTestOverride) {
            throw new RuntimeException('since_override_guard');
        }
    }

    $failAfterPage = isset($options['fail-after-page']) ? (int) $options['fail-after-page'] : null;
    $failBeforeWatermark = isset($options['fail-before-watermark']);
    if (($failAfterPage !== null || $failBeforeWatermark) && getenv('NUTREEZE_TEST_MODE') !== '1') {
        throw new RuntimeException('failure_injection_guard');
    }

    $stage = 'vendor_fetch';
    $fetched = (new VendorClient($token))->fetchAll($since, $limit, $failAfterPage);
    $token = null;
    putenv('NUTREEZE_API_KEY');

    $stage = 'contract_validation';
    $deduplicated = deduplicateRows($fetched['rows']);
    $futureLimit = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->modify('+5 minutes');
    foreach ($deduplicated as $row) {
        $rowTime = parseTimestamp($row['updated_at'], 'updated_at');
        if ($rowTime < $sinceTime) {
            throw new RuntimeException('vendor_since_violation');
        }
        if ($rowTime > $futureLimit) {
            throw new RuntimeException('vendor_future_timestamp');
        }
    }
    $eligible = array_values(array_filter($deduplicated, fn (array $row): bool => in_array($row['status'], ['success', 'pending'], true)));
    $canceled = count($deduplicated) - count($eligible);
    $nextWatermark = maxUpdatedAt($deduplicated);
    safeLog('source_summary', [
        'pages' => $fetched['pages'],
        'response_rows' => count($fetched['rows']),
        'deduplicated_rows' => count($deduplicated),
        'eligible_rows' => count($eligible),
        'cancels_skipped' => $canceled,
        'watermark_before' => $since,
        'watermark_candidate' => $nextWatermark,
    ]);

    if (isset($options['dry-run'])) {
        safeLog('complete', ['dry_run' => true, 'watermark_committed' => false]);
        releaseLock($lockName);
        exit(0);
    }

    $stage = 'fleetbase_upsert';
    $writer = new FleetbaseWriter($prefix);
    $writeStats = $writer->upsert($eligible, isset($options['verify']) ? $deduplicated : null);
    safeLog('write_summary', $writeStats);

    if (isset($options['verify'])) {
        safeLog('verification', $writer->verificationResult() ?? ['passed' => false]);
    }

    if ($failBeforeWatermark) {
        throw new RuntimeException('test_failure_before_watermark');
    }

    $stage = 'watermark_commit';
    if ($nextWatermark !== null) {
        $store->write($nextWatermark);
    }
    safeLog('complete', [
        'dry_run' => false,
        'watermark_committed' => $nextWatermark !== null,
        'watermark_after' => $nextWatermark ?? $since,
    ]);
    releaseLock($lockName);
    exit(0);
} catch (Throwable $exception) {
    $token = null;
    putenv('NUTREEZE_API_KEY');
    $errorCode = $exception instanceof RuntimeException && preg_match('/^[a-z0-9_]+$/', $exception->getMessage())
        ? $exception->getMessage()
        : 'internal_error';
    safeLog('fatal', [
        'stage' => $stage,
        'error_class' => (new ReflectionClass($exception))->getShortName(),
        'error_code' => $errorCode,
    ]);
    releaseLock($lockName);
    exit(1);
}
