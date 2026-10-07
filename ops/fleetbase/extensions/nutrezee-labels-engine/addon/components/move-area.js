import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';

// A77 — move one area from a loaded driver to another for ONE delivery day.
// The page only records the decision; the Fleetbase sync applies it within a few minutes and keeps it.
function shiftDay(day, offset) {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

const ERRORS = {
    area_not_in_day: 'This area has no orders on that day. / المنطقة دي مالهاش طلبات في اليوم ده.',
    driver_not_found: 'Driver not found. / السواق مش موجود.',
    driver_without_phone_or_vehicle: 'This driver has no phone or vehicle plate, so labels cannot be printed for him. / السواق ده مالوش تليفون أو رقم عربية، فالملصقات مش هتتطبع له.',
    area_already_with_driver: 'This area is already with that driver. / المنطقة دي مع السواق ده فعلا.',
    past_day: 'A past day cannot be changed. / مينفعش تغيير يوم فات.',
    already_cancelled: 'This move was already undone. / النقل ده اتلغى قبل كده.',
};

export default class MoveAreaComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked saving = false;
    @tracked error = null;
    @tracked notice = null;
    @tracked data = null;
    @tracked day = '';
    @tracked sourceId = '';
    @tracked areaKey = '';
    @tracked targetId = '';

    timer = null;

    constructor() {
        super(...arguments);
        void this.load('');
    }

    willDestroy() {
        super.willDestroy(...arguments);
        if (this.timer) window.clearTimeout(this.timer);
    }

    get today() { return this.data?.today ?? ''; }
    get isToday() { return this.data && this.data.delivery_date === this.today; }
    get isTomorrow() { return this.data && this.data.delivery_date === shiftDay(this.today, 1); }
    get isAfterTomorrow() { return this.data && this.data.delivery_date === shiftDay(this.today, 2); }
    get canEdit() { return Boolean(this.data?.can_edit); }

    get maxOrders() { return Math.max(1, ...(this.data?.drivers ?? []).map((driver) => driver.orders)); }

    get drivers() {
        return (this.data?.drivers ?? []).map((driver) => ({
            ...driver,
            title: driver.name || driver.id,
            subtitle: [driver.vehicle_number, driver.phone].filter(Boolean).join(' · '),
            barStyle: htmlSafe(`width: ${Math.round((driver.orders / this.maxOrders) * 100)}%`),
            cardClass: `nz-move-driver${driver.id === this.sourceId ? ' nz-move-driver--source' : ''}${driver.id === this.targetId ? ' nz-move-driver--target' : ''}`,
            isSource: driver.id === this.sourceId,
        }));
    }

    get source() { return (this.data?.drivers ?? []).find((driver) => driver.id === this.sourceId) ?? null; }
    get target() { return (this.data?.drivers ?? []).find((driver) => driver.id === this.targetId) ?? null; }

    get sourceAreas() {
        return (this.source?.areas ?? []).map((area) => ({
            ...area,
            rowClass: `nz-move-area${area.area_key === this.areaKey ? ' nz-move-area--chosen' : ''}`,
        }));
    }

    get area() { return (this.source?.areas ?? []).find((area) => area.area_key === this.areaKey) ?? null; }

    get targets() {
        return this.drivers
            .filter((driver) => driver.id !== this.sourceId)
            .map((driver) => ({ ...driver, usable: Boolean(driver.phone && driver.vehicle_number) }))
            .sort((a, b) => a.orders - b.orders);
    }

    get summary() {
        if (!this.source || !this.area || !this.target) return null;
        return {
            text: `${this.area.area_label} (${this.area.orders})`,
            from: `${this.source.name || this.source.id}: ${this.source.orders} → ${this.source.orders - this.area.orders}`,
            to: `${this.target.name || this.target.id}: ${this.target.orders} → ${this.target.orders + this.area.orders}`,
        };
    }

    get moves() {
        return (this.data?.moves ?? []).map((move) => {
            const done = move.orders_now > 0 && move.orders_with_target === move.orders_now;
            return {
                ...move,
                done,
                line: `${move.area_label}: ${move.from_driver_name || '—'} → ${move.to_driver_name || move.to_driver_id}`,
                status: done
                    ? `Done: ${move.orders_with_target} of ${move.orders_now} orders are with the new driver. / تم: ${move.orders_with_target} من ${move.orders_now} طلب مع السواق الجديد.`
                    : `Applying… ${move.orders_with_target} of ${move.orders_now} so far; this takes up to 5 minutes. / جاري التنفيذ… ${move.orders_with_target} من ${move.orders_now}؛ بياخد لحد 5 دقايق.`,
                statusClass: `nz-move-status${done ? ' nz-move-status--done' : ''}`,
            };
        });
    }

    get hasPending() { return this.moves.some((move) => !move.done); }

    async request(path, options = {}) {
        const token = this.session?.data?.authenticated?.token;
        if (!token) throw new Error('Your Fleetbase session is not available. Please sign in again.');
        const response = await window.fetch(path, {
            ...options,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const reason = body?.detail?.reason;
            throw new Error(ERRORS[reason] ?? (reason ? `${body?.error_code}: ${reason}` : body?.error_code ?? `http_${response.status}`));
        }
        return body;
    }

    async load(day, quiet = false) {
        if (!quiet) this.loading = true;
        this.error = null;
        try {
            const query = day ? `?delivery_date=${encodeURIComponent(day)}` : '';
            this.data = await this.request(`/nz/fleet-ops/area-moves${query}`);
            this.day = this.data.delivery_date;
            if (!this.source) this.clearChoice();
        } catch (error) {
            if (!quiet) this.data = null;
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            if (this.timer) window.clearTimeout(this.timer);
            if (this.hasPending) this.timer = window.setTimeout(() => void this.load(this.day, true), 30000);
        }
    }

    clearChoice() {
        this.sourceId = '';
        this.areaKey = '';
        this.targetId = '';
    }

    @action reload() { void this.load(this.day); }
    @action showToday() { this.clearChoice(); void this.load(''); }
    @action showTomorrow() { this.clearChoice(); if (this.today) void this.load(shiftDay(this.today, 1)); }
    @action showAfterTomorrow() { this.clearChoice(); if (this.today) void this.load(shiftDay(this.today, 2)); }

    @action
    chooseSource(driver) {
        this.notice = null;
        this.sourceId = driver.id === this.sourceId ? '' : driver.id;
        this.areaKey = '';
        this.targetId = '';
    }

    @action chooseArea(area) { this.areaKey = area.area_key; this.targetId = ''; }
    @action chooseTarget(driver) { if (driver.usable) this.targetId = driver.id; }
    @action cancelChoice() { this.clearChoice(); }

    @action
    async confirmMove() {
        if (!this.summary || this.saving) return;
        this.saving = true;
        this.error = null;
        try {
            await this.request('/nz/fleet-ops/area-moves', {
                method: 'POST',
                body: JSON.stringify({ delivery_date: this.day, area_key: this.areaKey, to_driver_id: this.targetId }),
            });
            this.notice = 'Saved. The orders move within 5 minutes and the labels follow. / اتسجل. الطلبات هتتنقل في خلال 5 دقايق والملصقات هتمشي معاها.';
            this.clearChoice();
            await this.load(this.day, true);
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.saving = false;
        }
    }

    @action
    async undo(move) {
        if (this.saving) return;
        this.saving = true;
        this.error = null;
        try {
            await this.request(`/nz/fleet-ops/area-moves/${encodeURIComponent(move.id)}/cancel`, { method: 'POST', body: '{}' });
            this.notice = 'Undone. The area goes back to its usual driver within 5 minutes. / اتلغى. المنطقة هترجع لسواقها المعتاد في خلال 5 دقايق.';
            await this.load(this.day, true);
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.saving = false;
        }
    }
}
