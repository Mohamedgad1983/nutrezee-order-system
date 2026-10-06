import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

// A72 — order status by customer phone. Read-only: one GET to /nz/fleet-ops/order-status.
const STATE_TEXT = {
    delivered: 'Delivered / اتسلّم',
    on_the_way: 'On the way to the customer / في الطريق للعميل',
    with_driver: 'With the driver, not delivered yet / مع السواق ولسه ماتسلمش',
    not_dispatched: 'Not sent out yet / لسه ماخرجش',
};
const NO_ESTIMATE_TEXT = {
    driver_position_missing: "No distance or time: the driver's app has never sent a location. / مفيش مسافة ولا وقت: تطبيق السواق مابعتش موقع.",
    driver_position_stale: "No distance or time: the driver's app is not open now. / مفيش مسافة ولا وقت: تطبيق السواق مش مفتوح دلوقتي.",
    customer_pin_missing: 'No distance or time: this customer has no location on the map. / مفيش مسافة ولا وقت: العميل مالوش موقع على الخريطة.',
    already_delivered: '',
};

function shiftDay(day, offset) {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

export default class OrderStatusComponent extends Component {
    @service session;

    @tracked phone = '';
    @tracked day = '';
    @tracked today = '';
    @tracked loading = false;
    @tracked error = null;
    @tracked result = null;

    get isToday() { return this.result && this.result.delivery_date === this.result.today; }
    get isTomorrow() { return this.result && this.result.delivery_date === shiftDay(this.result.today, 1); }
    get isYesterday() { return this.result && this.result.delivery_date === shiftDay(this.result.today, -1); }

    get customerNames() { return (this.result?.customer_names ?? []).join(' · '); }

    get deliveries() {
        return (this.result?.deliveries ?? []).map((item) => {
            const live = item.live;
            return {
                ...item,
                stateText: STATE_TEXT[item.state] ?? item.state,
                stateClass: `nz-status-pill nz-status-pill--${item.state}`,
                driverText: item.driver
                    ? [item.driver.name, item.driver.phone, item.driver.vehicle_number].filter(Boolean).join(' · ')
                    : 'No driver / مفيش سواق',
                driverLoad: item.driver
                    ? `${item.driver_orders_delivered} of ${item.driver_orders_total} delivered / اتسلّم ${item.driver_orders_delivered} من ${item.driver_orders_total}`
                    : '',
                printedText: item.label_printed ? 'Printed / اتطبع' : 'Not printed yet / لسه ماتطبعش',
                hasLive: Boolean(live),
                distanceText: live ? `${live.distance_km} km / كم` : '',
                etaText: live ? `${live.eta_minutes} min / دقيقة` : '',
                aheadText: live ? String(live.orders_ahead) : '',
                liveNote: live
                    ? [
                          `Driver location from ${live.position_age_minutes} min ago. / موقع السواق من ${live.position_age_minutes} دقيقة.`,
                          live.exact_pin ? '' : 'Customer location is the area centre, not the exact house. / موقع العميل هو وسط المنطقة مش البيت بالظبط.',
                          live.orders_unranked ? `${live.orders_unranked} other orders have no map location and are not counted. / ${live.orders_unranked} طلب تاني مالوش موقع ومش محسوب.` : '',
                      ].filter(Boolean).join(' ')
                    : '',
                noEstimateText: live ? '' : NO_ESTIMATE_TEXT[item.live_unavailable] ?? '',
            };
        });
    }

    get emptyText() {
        if (!this.result) return '';
        if (!this.result.customer_found) return 'No customer has this phone number. / مفيش عميل بالرقم ده.';
        if (!this.result.deliveries.length) {
            return `${this.customerNames}: no delivery on ${this.result.delivery_date}. / مالوش توصيل في اليوم ده.`;
        }
        return '';
    }

    async request(path) {
        const token = this.session?.data?.authenticated?.token;
        if (!token) throw new Error('Your Fleetbase session is not available. Please sign in again.');
        const response = await window.fetch(path, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const code = body?.error_code ?? `http_${response.status}`;
            if (code === 'validation_failed') throw new Error('Type the customer phone (at least 7 digits). / اكتب تليفون العميل (7 أرقام على الأقل).');
            const reason = body?.detail?.reason;
            throw new Error(reason ? `${code}: ${reason}` : code);
        }
        return body;
    }

    @action updatePhone(event) { this.phone = event.target.value; }

    @action
    submit(event) {
        event?.preventDefault?.();
        void this.search(this.day);
    }

    @action searchToday() { void this.search(''); }
    @action searchTomorrow() { if (this.today) void this.search(shiftDay(this.today, 1)); }
    @action searchYesterday() { if (this.today) void this.search(shiftDay(this.today, -1)); }

    async search(day) {
        if (this.loading) return;
        this.loading = true;
        this.error = null;
        try {
            const query = new URLSearchParams({ phone: this.phone });
            if (day) query.set('delivery_date', day);
            const result = await this.request(`/nz/fleet-ops/order-status?${query.toString()}`);
            this.result = result;
            this.today = result.today;
            this.day = result.delivery_date === result.today ? '' : result.delivery_date;
        } catch (error) {
            this.result = null;
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
        }
    }
}
