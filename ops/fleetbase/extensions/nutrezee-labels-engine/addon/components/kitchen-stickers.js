import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import { fitLabels } from './order-label';

// A97 — the drivers' manager keeps the kitchen's WhatsApp stickers here instead of a Publisher file:
// a list, a form and the sticker itself drawn next to it while typing. Saved stickers print from
// Batch Labels → WhatsApp → Kitchen stickers on every delivery day from their first day.
const DASH = '-';
const FIELDS = [
    'name', 'mobile', 'box', 'area', 'block', 'street', 'house', 'address_details', 'meals_per_day',
    'snacks_per_day', 'breakfast', 'protein_g', 'carb_g', 'notes', 'start_date', 'end_date',
];
const ERRORS = {
    required: 'This field is required. / الخانة دي لازم تتملى.',
    eight_digits: 'Mobile must be 8 digits. / الموبايل لازم 8 أرقام.',
    too_long: 'Too long. / الكلام طويل.',
    before_start: 'The end date is before the start date. / تاريخ النهاية قبل البداية.',
    mobile_has_sticker: 'This mobile already has a sticker. Open it from the list. / الموبايل ده عنده ستيكر، افتحه من القايمة.',
    already_active: 'Already printing. / شغال بالفعل.',
    already_stopped: 'Already stopped. / متوقف بالفعل.',
};
const LABELS = {
    name: 'Name / الاسم', mobile: 'Mobile / الموبايل', box: 'BOX', area: 'Area / المنطقة', block: 'Block',
    street: 'Street', house: 'House / Building', address_details: 'Direction / تفاصيل العنوان',
    meals_per_day: 'Meals / وجبات', snacks_per_day: 'Snacks / سناك', breakfast: 'Breakfast / فطار',
    protein_g: 'Protein (g)', carb_g: 'Carb (g)', notes: 'Notes / الملاحظات', start_date: 'Start date / تاريخ البداية',
    end_date: 'End date / تاريخ النهاية',
};

function blank(today) {
    return Object.fromEntries(FIELDS.map((field) => [field, field === 'start_date' ? (today ?? '') : '']));
}

function fromSticker(sticker) {
    return Object.fromEntries(FIELDS.map((field) => [field, sticker[field] === null || sticker[field] === undefined ? '' : String(sticker[field])]));
}

function formatDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return DASH;
    const date = new Date(`${day}T00:00:00Z`);
    const n = date.getUTCDate();
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(date);
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(date);
    return `${weekday} ${n}${suffix} ${month} ${date.getUTCFullYear()}`;
}

/** Delivery days left from `day` to `end` (Friday is never a delivery day), as the label counts them. */
export function daysLeft(day, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? '') || end < day) return null;
    let count = 0;
    for (let d = new Date(`${day}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() !== 5) count += 1;
    }
    return count;
}

/** The plan line as the WhatsApp sync writes it (A95). */
export function stickerPackage(form) {
    const grams = [form.protein_g !== '' ? `Protein ${form.protein_g}g` : '', form.carb_g !== '' ? `Carb ${form.carb_g}g` : '']
        .filter(Boolean).join(' / ');
    const breakfast = form.breakfast !== '' && form.breakfast !== '0' ? `Breakfast ${form.breakfast}` : '';
    return [grams, breakfast].filter(Boolean).join(' · ');
}

export default class KitchenStickersComponent extends Component {
    @service session;

    @tracked loading = true;
    @tracked saving = false;
    @tracked error = null;
    @tracked notice = null;
    @tracked data = null;
    @tracked selectedId = null;
    @tracked form = blank('');
    @tracked fieldError = null;
    @tracked search = '';
    @tracked showStopped = false;

    constructor() {
        super(...arguments);
        void this.load();
    }

    get stickers() {
        const query = this.search.trim().toLowerCase();
        return (this.data?.stickers ?? [])
            .filter((s) => (this.showStopped || s.active)
                && (!query || [s.name, s.mobile, s.box, s.area].some((v) => String(v ?? '').toLowerCase().includes(query))))
            .map((s) => ({
                ...s,
                rowClass: `nz-kitchen-row${s.id === this.selectedId ? ' nz-kitchen-row--chosen' : ''}${s.active ? '' : ' nz-kitchen-row--stopped'}`,
                ended: s.end_date && this.data && s.end_date < this.data.today,
            }));
    }

    get activeCount() { return (this.data?.stickers ?? []).filter((s) => s.active).length; }
    get stoppedCount() { return (this.data?.stickers ?? []).filter((s) => !s.active).length; }
    get selected() { return (this.data?.stickers ?? []).find((s) => s.id === this.selectedId) ?? null; }
    get isNew() { return this.selectedId === 'new'; }
    get editing() { return this.selectedId !== null; }
    get areaOptions() { return this.data?.areas ?? []; }

    get areaDriver() {
        const key = this.form.area.trim().toLowerCase();
        const hit = this.areaOptions.find((a) => a.label.trim().toLowerCase() === key);
        if (!key) return 'Choose an area to see its driver / اختار المنطقة عشان يظهر السواق';
        if (!hit) return 'Area not in tomorrow\'s legacy list — the driver is found by spelling / المنطقة مش في قايمة بكره';
        return hit.driver ? `Driver tomorrow: ${hit.driver} / سواق بكره` : 'No driver in that area tomorrow yet / مفيش سواق للمنطقة دي بكره لسه';
    }

    get fields() {
        return FIELDS.filter((f) => f !== 'notes').map((field) => ({
            field, label: LABELS[field], value: this.form[field],
            type: field.endsWith('_date') ? 'date' : ['meals_per_day', 'snacks_per_day', 'breakfast', 'protein_g', 'carb_g'].includes(field) ? 'number' : 'text',
            list: field === 'area' ? 'nz-kitchen-areas' : null,
            invalid: this.fieldError?.field === field,
        }));
    }

    /** The sticker drawn from the form, with the same markup and fit rules as Batch Labels. */
    get preview() {
        const f = this.form;
        const v = (value) => (String(value ?? '').trim() === '' ? DASH : String(value).trim());
        const day = this.data?.delivery_date ?? '';
        const left = daysLeft(day, f.end_date);
        return {
            fullName: v(f.name), subscription: formatDay(day), deliveryTime: DASH,
            daysRemaining: left === null ? DASH : String(left), deliveryMethod: DASH,
            packageName: v(stickerPackage(f)), mealsPerDay: v(f.meals_per_day), snacksPerDay: v(f.snacks_per_day),
            legacyUserId: v(f.box), orderNumber: f.mobile ? `WA-${f.mobile.replace(/\D/g, '').slice(-8)}` : DASH,
            area: v(f.area), block: v(f.block), street: v(f.street), building: v(f.house), floor: DASH, flat: DASH,
            direction: v(f.address_details), phone: v(f.mobile),
            notes: v(f.notes), hasNotes: String(f.notes ?? '').trim() !== '',
        };
    }

    async request(path, options = {}) {
        const token = this.session?.data?.authenticated?.token;
        if (!token) throw new Error('Your Fleetbase session is not available. Please sign in again.');
        const response = await window.fetch(path, {
            ...options,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const detail = body?.detail ?? {};
            const message = ERRORS[detail.reason] ?? (detail.field ? 'Check this field. / راجع الخانة دي.' : body?.error_code ?? `http_${response.status}`);
            const error = new Error(detail.field ? `${LABELS[detail.field] ?? detail.field}: ${message}` : message);
            error.field = detail.field ?? null;
            throw error;
        }
        return body;
    }

    async load(quiet = false) {
        if (!quiet) this.loading = true;
        this.error = null;
        try {
            this.data = await this.request('/nz/fleet-ops/kitchen-stickers');
        } catch (error) {
            if (!quiet) this.data = null;
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.fit();
        }
    }

    fit() {
        // Shrink the notes the same way the printed sticker does, after the preview is drawn.
        if (typeof window !== 'undefined') window.requestAnimationFrame?.(() => fitLabels());
    }

    @action reload() { void this.load(); }
    @action toggleStopped() { this.showStopped = !this.showStopped; }
    @action searchList(event) { this.search = event.target.value; }

    @action
    open(sticker) {
        this.notice = null;
        this.error = null;
        this.fieldError = null;
        this.selectedId = sticker.id;
        this.form = fromSticker(sticker);
        this.fit();
    }

    @action
    startNew() {
        this.notice = null;
        this.error = null;
        this.fieldError = null;
        this.selectedId = 'new';
        this.form = blank(this.data?.delivery_date);
        this.fit();
    }

    @action
    copy() {
        // A new sticker that starts from the open one (another member of the same family, a new plan…).
        this.selectedId = 'new';
        this.form = { ...this.form, name: '', mobile: '', box: '' };
        this.notice = 'Copied. Fill in the new name, mobile and BOX. / اتنسخ. اكتب الاسم والموبايل والـ BOX الجداد.';
    }

    @action close() { this.selectedId = null; this.fieldError = null; }

    @action
    update(field, event) {
        this.form = { ...this.form, [field]: event.target.value };
        if (this.fieldError?.field === field) this.fieldError = null;
        if (field === 'notes') this.fit();
    }

    @action
    async save(event) {
        event?.preventDefault?.();
        if (this.saving) return;
        this.saving = true;
        this.error = null;
        this.fieldError = null;
        try {
            const saved = await this.request(
                this.isNew ? '/nz/fleet-ops/kitchen-stickers' : `/nz/fleet-ops/kitchen-stickers/${encodeURIComponent(this.selectedId)}`,
                { method: 'POST', body: JSON.stringify(this.form) },
            );
            this.notice = 'Saved. Batch Labels shows it within 2 minutes (WhatsApp → Kitchen stickers). / اتحفظ. هيظهر في Batch Labels في خلال دقيقتين (واتساب ← ستيكرات المطبخ).';
            await this.load(true);
            this.open(saved);
            this.notice = 'Saved. Batch Labels shows it within 2 minutes (WhatsApp → Kitchen stickers). / اتحفظ. هيظهر في Batch Labels في خلال دقيقتين (واتساب ← ستيكرات المطبخ).';
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.fieldError = error?.field ? { field: error.field } : null;
        } finally {
            this.saving = false;
        }
    }

    @action
    async setActive(active) {
        if (this.saving || !this.selected) return;
        this.saving = true;
        this.error = null;
        try {
            const saved = await this.request(
                `/nz/fleet-ops/kitchen-stickers/${encodeURIComponent(this.selectedId)}/${active ? 'restore' : 'stop'}`,
                { method: 'POST', body: '{}' },
            );
            await this.load(true);
            this.open(saved);
            this.notice = active
                ? 'Printing again from tomorrow\'s labels. / رجع يتطبع من ملصقات بكره.'
                : 'Stopped. It no longer prints; it stays in the list under "Stopped". / اتوقف. مش هيتطبع تاني، وهيفضل في القايمة تحت "متوقف".';
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.saving = false;
        }
    }
}
