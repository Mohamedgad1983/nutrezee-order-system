import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

export default class DriverLocationsComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked saving = false;
    @tracked items = [];
    @tracked selectedId = '';
    @tracked latitude = '';
    @tracked longitude = '';
    @tracked reason = '';
    @tracked error = null;
    @tracked notice = null;

    constructor() {
        super(...arguments);
        void this.load();
    }

    get selected() {
        return this.items.find((item) => item.id === this.selectedId) ?? null;
    }

    async request(path, options = {}) {
        const token = this.session?.data?.authenticated?.token;
        if (!token) throw new Error('Your Fleetbase session is not available. Please sign in again.');
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

    @action
    async load() {
        this.loading = true;
        this.error = null;
        try {
            const response = await this.request('/nz/fleet-ops/driver-locations');
            this.items = Array.isArray(response?.items) ? response.items : [];
            if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) this.clearSelection();
        } catch (error) {
            this.items = [];
            this.error = messageOf(error);
        } finally {
            this.loading = false;
        }
    }

    @action
    select(item) {
        this.selectedId = item.id;
        this.latitude = String(item.latitude);
        this.longitude = String(item.longitude);
        this.reason = '';
        this.error = null;
        this.notice = null;
    }

    @action updateLatitude(event) { this.latitude = event.target.value; }
    @action updateLongitude(event) { this.longitude = event.target.value; }
    @action updateReason(event) { this.reason = event.target.value; }

    @action
    async saveCorrection() {
        if (!this.selected || this.saving) return;
        const latitude = Number(this.latitude);
        const longitude = Number(this.longitude);
        const reason = this.reason.trim();
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !reason) {
            this.error = 'Valid Kuwait coordinates and a correction reason are required. / الإحداثيات الصحيحة وسبب التصحيح مطلوبان.';
            return;
        }
        this.saving = true;
        this.error = null;
        this.notice = null;
        try {
            await this.request(`/nz/fleet-ops/driver-locations/${encodeURIComponent(this.selected.id)}/correct`, {
                method: 'POST',
                body: JSON.stringify({ latitude, longitude, reason }),
            });
            this.notice = 'Correction recorded; the previous location remains in the audit trail. / تم حفظ التصحيح مع الاحتفاظ بالسجل السابق.';
            this.clearSelection();
            await this.load();
        } catch (error) {
            this.error = messageOf(error);
        } finally {
            this.saving = false;
        }
    }

    clearSelection() {
        this.selectedId = '';
        this.latitude = '';
        this.longitude = '';
        this.reason = '';
    }
}

function messageOf(error) {
    return error instanceof Error ? error.message : 'Unable to load driver locations.';
}
