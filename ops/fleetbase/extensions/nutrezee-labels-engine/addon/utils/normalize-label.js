import { htmlSafe } from '@ember/template';

const DASH = '-';
const DRIVER_COLORS = new Set([
    'red', 'blue', 'green', 'orange', 'purple', 'teal', 'pink', 'navy',
    'brown', 'cyan', 'olive', 'amber', 'magenta', 'slate', 'lime', 'coral',
]);

export default function normalizeLabel(document) {
    const value = (input) =>
        input === null || input === undefined || input === '' ? DASH : String(input);
    const numberValue = (input) =>
        input === null || input === undefined ? DASH : String(input);
    const meals = Array.isArray(document?.meals)
        ? document.meals.map((meal) => ({
              dishName: value(meal.dish_name),
              qty: numberValue(meal.qty),
              protein: numberValue(meal.protein),
              carbs: numberValue(meal.carbs),
              fat: numberValue(meal.fat),
              calories: numberValue(meal.calories),
          }))
        : [];
    const driverColor = DRIVER_COLORS.has(document?.driver_color)
        ? document.driver_color
        : null;
    return {
        ...document,
        fullName: value(document?.full_name),
        subscription: value(document?.subscription_date_display),
        deliveryTime: value(document?.delivery_time),
        daysRemaining: numberValue(document?.days_remaining),
        deliveryMethod: value(document?.delivery_method),
        packageName: value(document?.package_name),
        mealsPerDay: numberValue(document?.meals_per_day),
        snacksPerDay: numberValue(document?.snacks_per_day),
        legacyUserId: value(document?.legacy_user_id),
        driverRef: value(document?.driver_ref),
        driverPhone: value(document?.driver_phone),
        vehicleNumber: value(document?.vehicle_number),
        driverColorClass: driverColor ? `nz-driver-color--${driverColor}` : '',
        orderNumber: value(document?.order_number),
        area: value(document?.address?.area),
        block: value(document?.address?.block),
        street: value(document?.address?.street),
        building: value(document?.address?.building),
        floor: value(document?.address?.floor),
        flat: value(document?.address?.flat),
        direction: value(document?.address?.direction),
        phone: value(document?.phone),
        notes: value(document?.notes),
        meals,
        hasMeals: meals.length > 0,
        nutritionMissing: document?.meal_source === 'no_dish_source',
        totalProtein: numberValue(document?.totals?.protein),
        totalCarbs: numberValue(document?.totals?.carbs),
        totalFat: numberValue(document?.totals?.fat),
        totalCalories: numberValue(document?.totals?.calories),
        barcodeValue: value(document?.barcode_value),
        barcodeSvg: htmlSafe(document?.barcode_svg ?? ''),
    };
}
