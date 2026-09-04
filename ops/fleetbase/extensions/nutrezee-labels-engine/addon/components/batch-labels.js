import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import normalizeLabel, { describeFreshness } from '../utils/normalize-label';
import { printDetached } from './order-label';

export default class BatchLabelsComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked preparing = false;
    @tracked confirming = false;
    @tracked options = null;
    @tracked filterType = 'driver';
    @tracked filterValue = '';
    // A54: the operator picks the delivery day (Kuwait). '' means "server's today".
    @tracked deliveryDate = '';
    @tracked today = '';
    @tracked dateWindow = null;
    @tracked selectionIds = [];
    @tracked preview = null;
    @tracked reprintReason = '';
    @tracked freshness = null;
    @tracked awaitingConfirmation = false;
    @tracked error = null;
    @tracked notice = null;

    constructor() {
        super(...arguments);
        void this.loadOptions();
    }

    get filterOptions() {
        if (!this.options) {
            return [];
        }
        return this.filterType === 'driver' ? this.options.drivers : this.options.areas;
    }

    get filteredOrders() {
        const orders = Array.isArray(this.options?.orders) ? this.options.orders : [];
        return orders
            .filter((order) =>
                this.filterType === 'driver'
                    ? order.driver_id === this.filterValue
                    : order.area_id === this.filterValue
            )
            .map((order) => ({
                ...order,
                selected: this.selectionIds.includes(order.selection_id),
            }));
    }

    get selectedCount() {
        return this.selectionIds.length;
    }

    get allSelected() {
        return (
            this.filteredOrders.length > 0 &&
            this.selectionIds.length === this.filteredOrders.length
        );
    }

    get selectedDate() {
        return this.options?.delivery_date ?? this.deliveryDate ?? '';
    }

    get tomorrow() {
        return this.today ? shiftDate(this.today, 1) : '';
    }

    get isToday() {
        return Boolean(this.today) && this.selectedDate === this.today;
    }

    get isTomorrow() {
        return Boolean(this.tomorrow) && this.selectedDate === this.tomorrow;
    }

    get dayLabel() {
        if (!this.selectedDate) return '';
        if (this.isToday) return 'Today / اليوم';
        if (this.isTomorrow) return 'Tomorrow / غدًا';
        return weekdayOf(this.selectedDate);
    }

    get currentFilterLabel() {
        const match = this.filterOptions.find((option) => option.id === this.filterValue);
        return match?.label ?? '';
    }

    get hasDriverOptions() {
        return (this.options?.drivers?.length ?? 0) > 0;
    }

    get hasAreaOptions() {
        return (this.options?.areas?.length ?? 0) > 0;
    }

    get freshnessText() {
        return describeFreshness(this.freshness);
    }

    get hasReprints() {
        return (this.preview?.reprint_count ?? 0) > 0;
    }

    get isReady() {
        return this.options?.ready === true;
    }

    get printButtonText() {
        const count = this.preview?.count ?? 0;
        return `Print all ${count} labels / طباعة ${count} ملصق`;
    }

    get confirmButtonText() {
        const count = this.preview?.count ?? 0;
        return `Confirm ${count} printed / تأكيد طباعة ${count}`;
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

    async loadOptions(requestedDate) {
        this.loading = true;
        this.error = null;
        this.notice = null;
        this.preview = null;
        this.awaitingConfirmation = false;
        if (typeof requestedDate === 'string') {
            this.deliveryDate = requestedDate;
        }
        try {
            const query = this.deliveryDate ? `?delivery_date=${encodeURIComponent(this.deliveryDate)}` : '';
            this.options = await this.request(`/nz/fleet-ops/labels/batch/options${query}`);
            this.today = this.options.today ?? '';
            this.dateWindow = this.options.window ?? null;
            this.deliveryDate = this.options.delivery_date ?? this.deliveryDate;
            this.freshness = await this.request(
                `/nz/fleet-ops/labels/freshness?delivery_date=${encodeURIComponent(this.selectedDate)}`
            ).catch(() => null);
            // Drivers first: the sticker run is per driver. Areas only when nobody is assigned yet.
            if (this.isReady && this.hasDriverOptions) {
                this.filterType = 'driver';
                this.filterValue = this.options.drivers[0].id;
            } else if (this.isReady && this.hasAreaOptions) {
                this.filterType = 'area';
                this.filterValue = this.options.areas[0].id;
            } else {
                this.filterValue = '';
            }
            this.selectAllFiltered();
        } catch (error) {
            this.options = null;
            this.error = messageOf(error);
        } finally {
            this.loading = false;
        }
        await this.showSelection();
    }

    /** A54: the chosen driver's (or area's) labels for the chosen day appear as a view at once. */
    async showSelection() {
        if (this.isReady && this.filterValue && this.selectedCount > 0) {
            await this.prepareLabels();
        }
    }

    @action
    reload() {
        void this.loadOptions();
    }

    @action
    updateDate(event) {
        const value = String(event.target.value ?? '').trim();
        if (value && value !== this.selectedDate) {
            void this.loadOptions(value);
        }
    }

    @action
    showToday() {
        if (this.today && !this.isToday) {
            void this.loadOptions(this.today);
        }
    }

    @action
    showTomorrow() {
        if (this.tomorrow && !this.isTomorrow) {
            void this.loadOptions(this.tomorrow);
        }
    }

    @action
    chooseFilterType(filterType) {
        if (filterType !== 'driver' && filterType !== 'area') return;
        if (filterType === 'driver' && !this.hasDriverOptions) return;
        this.filterType = filterType;
        const first = this.filterOptions[0];
        this.filterValue = first?.id ?? '';
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    chooseFilterValue(filterValue) {
        const value = String(filterValue ?? '');
        if (!value || !this.filterOptions.some((option) => option.id === value)) return;
        if (value === this.filterValue && this.preview) return;
        this.filterValue = value;
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    toggleOrder(event) {
        const id = event.target.value;
        this.selectionIds = event.target.checked
            ? [...new Set([...this.selectionIds, id])]
            : this.selectionIds.filter((selectionId) => selectionId !== id);
        this.resetPreview();
    }

    @action
    toggleAll(event) {
        this.selectionIds = event.target.checked
            ? this.filteredOrders.map((order) => order.selection_id)
            : [];
        this.resetPreview();
    }

    @action
    updateReason(event) {
        this.reprintReason = event.target.value;
    }

    @action
    async prepareLabels() {
        if (!this.isReady || this.preparing || this.selectedCount === 0) {
            return;
        }
        this.preparing = true;
        this.error = null;
        this.notice = null;
        this.awaitingConfirmation = false;
        try {
            const response = await this.request('/nz/fleet-ops/labels/batch/preview', {
                method: 'POST',
                body: JSON.stringify(this.batchPayload()),
            });
            this.preview = {
                ...response,
                items: (response.items ?? []).map((item) => ({
                    ...item,
                    label: normalizeLabel(item.label),
                })),
            };
            this.notice = `${response.count} label(s) for ${this.selectedDate} shown below. No print has been recorded yet.`;
        } catch (error) {
            this.preview = null;
            this.error = messageOf(error);
        } finally {
            this.preparing = false;
        }
    }

    @action
    openPrintDialog() {
        if (!this.preview?.items?.length) {
            return;
        }
        // A48: reprints are unlimited; the reason is optional free text kept on the trail.
        this.error = null;
        this.notice = null;
        try {
            printDetached('.nz-batch-panel .nz-batch-labels', 'nutrezee-batch-print-mode');
        } catch (error) {
            this.error = messageOf(error);
            return;
        }
        this.awaitingConfirmation = true;
        this.notice =
            'If the printer completed the batch, confirm below. If you cancelled, do not confirm.';
    }

    @action
    async confirmPrinted() {
        if (!this.awaitingConfirmation || this.confirming) {
            return;
        }
        this.confirming = true;
        this.error = null;
        try {
            const response = await this.request('/nz/fleet-ops/labels/batch/printed', {
                method: 'POST',
                body: JSON.stringify({
                    ...this.batchPayload(),
                    reason: this.hasReprints && this.reprintReason.trim() ? this.reprintReason.trim() : undefined,
                }),
            });
            this.awaitingConfirmation = false;
            this.notice = `${response.printed} print(s) and ${response.reprinted} reprint(s) recorded in batch ${response.batch_ref}.`;
            this.reprintReason = '';
            await this.prepareLabels();
        } catch (error) {
            this.error = messageOf(error);
        } finally {
            this.confirming = false;
        }
    }

    @action
    cancelConfirmation() {
        this.awaitingConfirmation = false;
        this.notice = 'Print confirmation cancelled. Nothing was recorded.';
    }

    batchPayload() {
        return {
            delivery_date: this.selectedDate,
            filter_type: this.filterType,
            filter_value: this.filterValue,
            selection_ids: this.selectionIds,
        };
    }

    selectAllFiltered() {
        this.selectionIds = this.filteredOrders.map((order) => order.selection_id);
    }

    resetPreview() {
        this.preview = null;
        this.awaitingConfirmation = false;
        this.notice = null;
        this.error = null;
    }
}

function messageOf(error) {
    return error instanceof Error ? error.message : 'Unable to load batch labels.';
}

/** Calendar arithmetic on YYYY-MM-DD in UTC — no local-timezone drift. */
function shiftDate(date, days) {
    const [y, m, d] = String(date).split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    if (!y || !m || !d) return '';
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const en = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday];
    const ar = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][weekday];
    return `${en} / ${ar}`;
}
