import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

/** Native disclosure keeps keyboard/Tab behavior without Ember's native-select timing issue. */
export default class BatchFilterSelectComponent extends Component {
    @tracked query = '';

    get selectedLabel() {
        return (this.args.options ?? []).find((option) => option.id === this.args.value)?.label
            ?? 'Choose… / اختر';
    }

    get choices() {
        const query = this.query.trim().toLocaleLowerCase();
        return (this.args.options ?? [])
            .filter((option) => String(option.label).toLocaleLowerCase().includes(query))
            .map((option) => ({ ...option, selected: option.id === this.args.value }));
    }

    @action
    search(event) {
        this.query = event.target.value;
    }

    @action
    toggle(event) {
        const details = event.currentTarget;
        if (this.args.disabled) details.open = false;
        if (!details.open) this.query = '';
        else details.querySelector('input')?.focus();
    }

    @action
    preventDisabled(event) {
        if (this.args.disabled) event.preventDefault();
    }

    @action
    keydown(event) {
        if (event.key !== 'Escape') return;
        const details = event.currentTarget;
        details.open = false;
        details.querySelector('summary')?.focus();
    }

    @action
    choose(id, event) {
        if (this.args.disabled) return;
        const details = event.currentTarget.closest('details');
        details.open = false;
        details.querySelector('summary')?.focus();
        this.query = '';
        this.args.onChange(id);
    }
}
