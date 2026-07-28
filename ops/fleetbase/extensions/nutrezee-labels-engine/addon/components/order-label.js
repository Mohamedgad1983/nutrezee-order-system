import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';

const DASH = '-';

export default class OrderLabelComponent extends Component {
    @service session;

    @tracked label = null;
    @tracked history = [];
    @tracked loading = true;
    @tracked printing = false;
    @tracked error = null;
    @tracked notice = null;
    @tracked reprintReason = '';

    constructor() {
        super(...arguments);
        void this.load();
    }

    get order() {
        return this.args.order ?? this.args.resource;
    }

    get fleetbaseOrderId() {
        return this.order?.public_id ?? this.order?.id ?? null;
    }

    get isReprint() {
        return this.history.length > 0;
    }

    get actionText() {
        return this.isReprint ? 'Reprint label' : 'Print label';
    }

    get historyText() {
        if (this.history.length === 0) {
            return 'This label has not been printed yet.';
        }
        return `${this.history.length} recorded print${this.history.length === 1 ? '' : 's'} for this delivery.`;
    }

    async request(path, options = {}) {
        const token = this.session?.data?.authenticated?.token;
        if (!token) {
            throw new Error('Your Fleetbase session is not available. Please sign in again.');
        }
        const response = await window.fetch(path, {
            ...options,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(options.headers ?? {}),
            },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const code = body?.error_code ?? `http_${response.status}`;
            const reason = body?.detail?.reason;
            throw new Error(reason ? `${code}: ${reason}` : code);
        }
        return body;
    }

    async load() {
        this.loading = true;
        this.error = null;
        this.notice = null;
        try {
            if (!this.fleetbaseOrderId) {
                throw new Error('Fleetbase order id is missing.');
            }
            const encoded = encodeURIComponent(this.fleetbaseOrderId);
            const [document, history] = await Promise.all([
                this.request('/nz/fleet-ops/labels/render', {
                    method: 'POST',
                    body: JSON.stringify({ fleetbase_order_id: this.fleetbaseOrderId }),
                }),
                this.request(`/nz/fleet-ops/labels/${encoded}/print-history`),
            ]);
            this.label = normalizeLabel(document);
            this.history = Array.isArray(history?.items) ? history.items : [];
        } catch (error) {
            this.label = null;
            this.history = [];
            this.error = messageOf(error);
        } finally {
            this.loading = false;
        }
    }

    @action
    updateReason(event) {
        this.reprintReason = event.target.value;
    }

    @action
    async printLabel() {
        if (!this.label || this.printing) {
            return;
        }
        const reason = this.reprintReason.trim();
        if (this.isReprint && !reason) {
            this.error = 'A reprint reason is required. / سبب إعادة الطباعة مطلوب.';
            return;
        }

        this.printing = true;
        this.error = null;
        this.notice = null;
        try {
            const encoded = encodeURIComponent(this.fleetbaseOrderId);
            await this.request(`/nz/fleet-ops/labels/${encoded}/printed`, {
                method: 'POST',
                body: JSON.stringify({
                    kind: this.isReprint ? 'reprint' : 'print',
                    reason: this.isReprint ? reason : undefined,
                }),
            });
            this.notice = this.isReprint
                ? 'Reprint recorded. Opening print dialog…'
                : 'Print recorded. Opening print dialog…';
            this.reprintReason = '';
            document.body.classList.add('nutrezee-label-print-mode');
            window.print();
            document.body.classList.remove('nutrezee-label-print-mode');
            const history = await this.request(
                `/nz/fleet-ops/labels/${encoded}/print-history`
            );
            this.history = Array.isArray(history?.items) ? history.items : [];
        } catch (error) {
            document.body.classList.remove('nutrezee-label-print-mode');
            this.error = messageOf(error);
        } finally {
            this.printing = false;
        }
    }
}

function normalizeLabel(document) {
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

function messageOf(error) {
    return error instanceof Error ? error.message : 'Unable to load the Nutrezee label.';
}
