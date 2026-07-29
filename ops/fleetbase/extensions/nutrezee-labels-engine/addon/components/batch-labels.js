import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import normalizeLabel from '../utils/normalize-label';

export default class BatchLabelsComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked preparing = false;
    @tracked confirming = false;
    @tracked options = null;
    @tracked filterType = 'area';
    @tracked filterValue = '';
    @tracked selectionIds = [];
    @tracked preview = null;
    @tracked reprintReason = '';
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

    get hasDriverOptions() {
        return (this.options?.drivers?.length ?? 0) > 0;
    }

    get hasAreaOptions() {
        return (this.options?.areas?.length ?? 0) > 0;
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

    async loadOptions() {
        this.loading = true;
        this.error = null;
        this.notice = null;
        this.preview = null;
        this.awaitingConfirmation = false;
        try {
            this.options = await this.request('/nz/fleet-ops/labels/batch/options');
            if (this.isReady && this.hasAreaOptions) {
                this.filterType = 'area';
                this.filterValue = this.options.areas[0].id;
            } else if (this.isReady && this.hasDriverOptions) {
                this.filterType = 'driver';
                this.filterValue = this.options.drivers[0].id;
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
    }

    @action
    updateFilterType(event) {
        this.filterType = event.target.value;
        const first = this.filterOptions[0];
        this.filterValue = first?.id ?? '';
        this.resetPreview();
        this.selectAllFiltered();
    }

    @action
    updateFilterValue(event) {
        this.filterValue = event.target.value;
        this.resetPreview();
        this.selectAllFiltered();
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
            this.notice = `${response.count} real current-day label(s) prepared. No print has been recorded yet.`;
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
        const reason = this.reprintReason.trim();
        if (this.hasReprints && !reason) {
            this.error = 'A reprint reason is required. / سبب إعادة الطباعة مطلوب.';
            return;
        }
        this.error = null;
        this.notice = null;
        document.body.classList.add('nutrezee-batch-print-mode');
        window.print();
        document.body.classList.remove('nutrezee-batch-print-mode');
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
                    reason: this.hasReprints ? this.reprintReason.trim() : undefined,
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
