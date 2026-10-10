import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import normalizeLabel, { describeFreshness } from '../utils/normalize-label';
import { printDetached, fitLabels } from './order-label';

export default class BatchLabelsComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked preparing = false;
    @tracked confirming = false;
    @tracked options = null;
    @tracked filterType = 'driver';
    @tracked filterValue = '';
    @tracked orderValue = '';
    // A79: '' = every delivery time; otherwise one time slot inside the chosen driver or area.
    @tracked timeValue = '';
    @tracked searches = {};
    previewRevision = 0;
    optionsRevision = 0;
    // A54: the operator picks the delivery day (Kuwait). '' means "server's today".
    @tracked deliveryDate = '';
    @tracked today = '';
    @tracked dateWindow = null;
    @tracked selectionIds = [];
    @tracked preview = null;
    @tracked reprintReason = '';
    @tracked freshness = null;
    // A85: the page's own "matches the legacy admin" state. Nobody presses anything: the page asks
    // for a fresh check when it opens, watches it, and reloads the labels when a new result lands.
    @tracked printCheck = null;
    printCheckTimer = null;
    printCheckSeen = '';
    @tracked awaitingConfirmation = false;
    @tracked error = null;
    @tracked notice = null;

    constructor() {
        super(...arguments);
        void this.loadOptions();
    }

    willDestroy() {
        super.willDestroy(...arguments);
        this.stopPrintCheckWatch();
    }

    get printCheckTone() {
        const check = this.printCheck;
        if (!check || this.selectedDate < this.today) return '';
        if (check.verified) return 'ok';
        if (check.pending) return 'busy';
        if (check.latest && check.latest.fresh && check.latest.status !== 'ok') return 'bad';
        return 'busy';
    }

    get printCheckText() {
        const check = this.printCheck;
        const tone = this.printCheckTone;
        if (!tone) return '';
        const latest = check.latest;
        const minutes = latest ? Math.max(0, Math.round(latest.age_seconds / 60)) : null;
        if (tone === 'ok') {
            const waiting = latest.without_driver ? ` · ${latest.without_driver} without a driver yet / من غير سواق لسه` : '';
            return `✔ Matches the legacy admin: ${latest.labels} = ${latest.screen_orders}, checked ${minutes} min ago / `
                + `مطابق للسيستم القديم، آخر مراجعة من ${minutes} دقيقة${waiting}`;
        }
        if (tone === 'bad') {
            return latest.status === 'failed'
                ? '✖ The legacy admin could not be read. Print from the legacy admin until this line turns green. / '
                    + 'السيستم القديم ما اتقراش. اطبع من السيستم القديم لحد ما السطر ده يبقى أخضر.'
                : `✖ Not matching the legacy admin yet (${latest.differences} difference(s)); it is being repaired and this page `
                    + 'refreshes by itself. Print from the legacy admin until this line turns green. / '
                    + `لسه مش مطابق للسيستم القديم (${latest.differences} فرق) وجاري التصليح والصفحة هتتحدث لوحدها. `
                    + 'اطبع من السيستم القديم لحد ما السطر ده يبقى أخضر.';
        }
        return 'Checking against the legacy admin now (about 3 minutes). The labels refresh by themselves. / '
            + 'جاري المراجعة مع السيستم القديم دلوقتي (حوالي 3 دقايق). الملصقات هتتحدث لوحدها.';
    }

    /** POST when the day opens (records the need for a fresh check), then a quiet watch every 20 s. */
    async watchPrintCheck() {
        this.stopPrintCheckWatch();
        const date = this.selectedDate;
        if (!date || typeof window === 'undefined') return;
        this.printCheckSeen = '';
        await this.readPrintCheck('POST', date);
        this.printCheckTimer = window.setInterval(() => { void this.tickPrintCheck(date); }, 20000);
    }

    stopPrintCheckWatch() {
        if (this.printCheckTimer && typeof window !== 'undefined') window.clearInterval(this.printCheckTimer);
        this.printCheckTimer = null;
    }

    async tickPrintCheck(date) {
        if (this.isDestroyed || this.isDestroying || date !== this.selectedDate) return this.stopPrintCheckWatch();
        const stale = !this.printCheck?.pending && !this.printCheck?.latest?.fresh;
        await this.readPrintCheck(stale ? 'POST' : 'GET', date);
    }

    async readPrintCheck(method, date) {
        try {
            const state = method === 'POST'
                ? await this.request('/nz/fleet-ops/labels/print-check', { method, body: JSON.stringify({ delivery_date: date }) })
                : await this.request(`/nz/fleet-ops/labels/print-check?delivery_date=${encodeURIComponent(date)}`);
            if (this.isDestroyed || this.isDestroying || date !== this.selectedDate) return;
            this.printCheck = state;
            const finished = state?.latest?.finished_at ?? '';
            const first = this.printCheckSeen === '';
            if (finished && finished !== this.printCheckSeen) {
                this.printCheckSeen = finished;
                // A newer result means drivers or orders may have changed: show them without a click.
                if (!first) await this.refreshKeepingSelection();
            } else if (first) {
                this.printCheckSeen = finished || '-';
            }
        } catch (error) {
            // The status line is extra safety; the page keeps working without it.
        }
    }

    /** Re-read the day and keep the operator's driver / area / time choice; never during a print. */
    async refreshKeepingSelection() {
        if (this.loading || this.preparing || this.confirming || this.awaitingConfirmation) return;
        const keep = { type: this.filterType, value: this.filterValue, time: this.timeValue, order: this.orderValue };
        try {
            const query = `?delivery_date=${encodeURIComponent(this.selectedDate)}`;
            const options = await this.request(`/nz/fleet-ops/labels/batch/options${query}`);
            if (this.isDestroyed || this.isDestroying || options.delivery_date !== this.selectedDate) return;
            if (this.loading || this.preparing || this.confirming || this.awaitingConfirmation) return;
            this.options = options;
            this.filterType = this.filterTypes.some((option) => option.id === keep.type) ? keep.type : (this.filterTypes[0]?.id ?? 'area');
            this.filterValue = this.filterOptions.some((option) => option.id === keep.value) ? keep.value : (this.filterOptions[0]?.id ?? '');
            this.timeValue = this.timeOptions.some((option) => option.id === keep.time) ? keep.time : '';
            this.orderValue = this.orderOptions.some((option) => option.id === keep.order) ? keep.order : (this.isOrderFilter ? (this.orderOptions[0]?.id ?? '') : '');
            this.resetPreview();
            this.selectAllFiltered();
            await this.showSelection();
        } catch (error) {
            // keep what is on screen; the next result tries again
        }
    }

    get filtersDisabled() {
        return this.loading || this.confirming || !this.isReady;
    }

    get dropdowns() {
        const fields = [{ name: 'group', label: 'Filter by / الاختيار حسب', options: this.filterTypes, value: this.filterType }];
        if (!this.isOrderFilter) fields.push({ name: 'scope', label: this.filterLabel, options: this.filterOptions, value: this.filterValue });
        if (this.showTimeDropdown) fields.push({ name: 'time', label: 'Delivery time / وقت التوصيل', options: this.timeOptions, value: this.timeValue });
        fields.push({ name: 'order', label: 'Orders / الطلبات', options: this.orderOptions, value: this.orderValue });
        return fields.map((field) => {
            const query = this.searches[field.name] ?? '';
            return {
                ...field, query,
                selectedLabel: field.options.find((option) => option.id === field.value)?.label ?? 'Choose… / اختر',
                choices: field.options
                    .filter((option) => String(option.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
                    .map((option) => ({ ...option, selected: option.id === field.value })),
            };
        });
    }

    @action
    searchDropdown(name, event) {
        this.searches = { ...this.searches, [name]: event.target.value };
    }

    @action
    toggleDropdown(name, event) {
        const details = event.currentTarget;
        if (this.filtersDisabled) details.open = false;
        if (!details.open) this.searches = { ...this.searches, [name]: '' };
        else details.querySelector('input')?.focus();
    }

    @action
    preventDisabledDropdown(event) {
        if (this.filtersDisabled) event.preventDefault();
    }

    @action
    closeDropdown(event) {
        if (event.key !== 'Escape') return;
        const details = event.currentTarget;
        details.open = false;
        details.querySelector('summary')?.focus();
    }

    @action
    chooseDropdown(name, id, event) {
        if (this.filtersDisabled) return;
        const details = event.currentTarget.closest('details');
        details.open = false;
        details.querySelector('summary')?.focus();
        this.searches = {};
        if (name === 'group') this.chooseFilterType(id);
        else if (name === 'scope') this.chooseFilterValue(id);
        else if (name === 'time') this.chooseTime(id);
        else if (name === 'order') this.chooseOrder(id);
    }

    get filterTypes() {
        return [
            { id: 'driver', label: 'Driver / السائق' },
            { id: 'area', label: 'Area / المنطقة' },
            { id: 'time', label: 'Delivery time / وقت التوصيل' },
            { id: 'source', label: 'WhatsApp subscribers / مشتركين الواتساب' },
            { id: 'order', label: 'Orders / الطلبات' },
        ].filter((option) => (option.id !== 'driver' || this.hasDriverOptions) && (option.id !== 'time' || this.timeSlots.length > 0)
            && (option.id !== 'source' || this.sources.length > 0));
    }

    get isOrderFilter() {
        return this.filterType === 'order';
    }

    get filterLabel() {
        if (this.filterType === 'time') return 'Delivery time / وقت التوصيل';
        if (this.filterType === 'source') return 'Group / المجموعة';
        return this.filterType === 'driver' ? 'Driver / السائق' : 'Area / المنطقة';
    }

    /** A83: WhatsApp subscribers are printed as their own group, never mixed into the legacy lists. */
    get sources() {
        return (this.options?.sources ?? []).map((source) => ({ id: source.id, label: `${source.label} (${source.count})` }));
    }

    get timeSlots() {
        return (this.options?.time_slots ?? []).map((slot) => ({ id: slot.id, label: `${slot.label} (${slot.count})` }));
    }

    /** Inside a driver or an area the day can still be split by time slot, as on the legacy screen. */
    get showTimeDropdown() {
        return (this.filterType === 'driver' || this.filterType === 'area') && this.timeSlots.length > 1;
    }

    get timeOptions() {
        return [{ id: '', label: 'All times / كل الأوقات' }, ...(this.options?.time_slots ?? []).map((slot) => ({ id: slot.id, label: slot.label }))];
    }

    get filterOptions() {
        if (!this.options || this.isOrderFilter) return [];
        if (this.filterType === 'time') return this.timeSlots;
        if (this.filterType === 'source') return this.sources;
        return (this.filterType === 'driver' ? this.options.drivers : this.options.areas) ?? [];
    }

    get scopedOrders() {
        const orders = Array.isArray(this.options?.orders) ? this.options.orders : [];
        if (this.isOrderFilter) return orders;
        const byDriverThenArea = (a, b) =>
            String(a.driver_label ?? '').localeCompare(String(b.driver_label ?? '')) || String(a.area ?? '').localeCompare(String(b.area ?? ''));
        if (this.filterType === 'source') return orders.filter((order) => order.source === this.filterValue).sort(byDriverThenArea);
        const legacy = orders.filter((order) => order.source !== 'whatsapp');
        if (this.filterType === 'time') {
            // One time slot across the day prints grouped by driver, then area.
            return legacy.filter((order) => order.time_id === this.filterValue).sort(byDriverThenArea);
        }
        return legacy.filter((order) => (
            this.filterType === 'driver' ? order.driver_id === this.filterValue : order.area_id === this.filterValue
        ) && (!this.showTimeDropdown || !this.timeValue || order.time_id === this.timeValue));
    }

    get orderOptions() {
        const orders = this.scopedOrders.map((order) => ({
            id: order.selection_id,
            label: `#${order.order_number} · ${order.area} · ${order.driver_label || 'Unassigned / غير معين'}`,
        }));
        return this.isOrderFilter ? orders : [
            { id: '', label: `All ${orders.length} orders / كل الطلبات` }, ...orders,
        ];
    }

    get filteredOrders() {
        return this.scopedOrders
            .filter((order) => !this.orderValue || order.selection_id === this.orderValue)
            .map((order) => ({ ...order, selected: this.selectionIds.includes(order.selection_id) }));
    }

    get selectedOrder() {
        return this.scopedOrders.find((order) => order.selection_id === this.orderValue);
    }

    get selectedCount() {
        return this.selectionIds.length;
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
        if (this.selectedOrder) return `#${this.selectedOrder.order_number} · ${this.selectedOrder.area}`;
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
        const revision = ++this.optionsRevision;
        this.resetPreview();
        this.selectionIds = [];
        this.orderValue = '';
        this.timeValue = '';
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
            const options = await this.request(`/nz/fleet-ops/labels/batch/options${query}`);
            if (revision !== this.optionsRevision || this.isDestroyed || this.isDestroying) return;
            this.options = options;
            this.today = this.options.today ?? '';
            this.dateWindow = this.options.window ?? null;
            this.deliveryDate = this.options.delivery_date ?? this.deliveryDate;
            const freshness = await this.request(
                `/nz/fleet-ops/labels/freshness?delivery_date=${encodeURIComponent(this.selectedDate)}`
            ).catch(() => null);
            if (revision !== this.optionsRevision || this.isDestroyed || this.isDestroying) return;
            this.freshness = freshness;
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
            if (revision !== this.optionsRevision) return;
            this.options = null;
            this.error = messageOf(error);
        } finally {
            if (revision === this.optionsRevision) this.loading = false;
        }
        if (revision === this.optionsRevision) await this.showSelection();
        if (revision === this.optionsRevision && this.options) void this.watchPrintCheck();
    }

    /** A54: the chosen driver's (or area's) labels for the chosen day appear as a view at once. */
    async showSelection() {
        if (!this.loading && this.isReady && this.selectedCount > 0) {
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
        if (this.loading || this.confirming || !this.filterTypes.some((option) => option.id === filterType)) return;
        if (filterType === 'driver' && !this.hasDriverOptions) return;
        this.filterType = filterType;
        this.orderValue = '';
        this.timeValue = '';
        const first = this.filterOptions[0];
        this.filterValue = first?.id ?? '';
        if (this.isOrderFilter) this.orderValue = this.orderOptions[0]?.id ?? '';
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    chooseFilterValue(filterValue) {
        if (this.loading || this.confirming) return;
        const value = String(filterValue ?? '');
        if (!value || !this.filterOptions.some((option) => option.id === value)) return;
        this.filterValue = value;
        this.orderValue = '';
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    chooseTime(value) {
        if (this.loading || this.confirming || !this.timeOptions.some((option) => option.id === value)) return;
        // Kept while the operator moves from driver to driver, so one slot is printed car by car.
        this.timeValue = value;
        this.orderValue = '';
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    chooseOrder(value) {
        if (this.loading || this.confirming || !this.orderOptions.some((option) => option.id === value)) return;
        this.orderValue = value;
        this.resetPreview();
        this.selectAllFiltered();
        void this.showSelection();
    }

    @action
    updateReason(event) {
        this.reprintReason = event.target.value;
    }

    @action
    async prepareLabels() {
        if (this.loading || !this.isReady || this.selectedCount === 0) {
            return;
        }
        const revision = ++this.previewRevision;
        const payload = this.batchPayload();
        this.preparing = true;
        this.error = null;
        this.notice = null;
        this.awaitingConfirmation = false;
        try {
            const response = await this.request('/nz/fleet-ops/labels/batch/preview', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            if (revision !== this.previewRevision || this.isDestroyed || this.isDestroying) return;
            this.preview = {
                ...response,
                items: (response.items ?? []).map((item) => ({
                    ...item,
                    label: normalizeLabel(item.label),
                })),
            };
            this.notice = `${response.count} label(s) for ${this.selectedDate} shown below. No print has been recorded yet.`;
            // A88: once the labels are on the page, make every customer column fit above its barcode.
            if (typeof window !== 'undefined') window.requestAnimationFrame(() => fitLabels());
        } catch (error) {
            if (revision !== this.previewRevision) return;
            this.preview = null;
            this.error = messageOf(error);
        } finally {
            if (revision === this.previewRevision) this.preparing = false;
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
        // Orders mode reuses the exact order's server-validated area scope; no new API authority.
        const order = this.isOrderFilter ? this.selectedOrder : null;
        return {
            delivery_date: this.selectedDate,
            filter_type: this.isOrderFilter ? 'area' : this.filterType,
            filter_value: this.isOrderFilter ? order?.area_id : this.filterValue,
            selection_ids: this.selectionIds,
        };
    }

    selectAllFiltered() {
        this.selectionIds = this.filteredOrders.map((order) => order.selection_id);
    }

    resetPreview() {
        ++this.previewRevision;
        this.preparing = false;
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
