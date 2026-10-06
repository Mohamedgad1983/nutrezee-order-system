"""WP-OPS-A71 — WhatsApp-system subscribers who receive a delivery on one day (read-only).

Run with the ERPNext bench python as the frappe user:
    env/bin/python wa_subscribers_export.py <site> <YYYY-MM-DD> <output.json>

A subscriber is on the day's list when an NTZ POS Subscription of theirs (submitted, not removed,
not a return, not an add-on) covers the day and the day is not inside a freeze period. Friday has
no deliveries. Customers are the "WhatsApp" source of the report Subscriptions → Customer details
and addresses, so the list and that report always agree. Nothing is written to ERPNext.
"""
import json
import os
import sys
from datetime import date

import frappe


def main(site, day_text, output):
    day = date.fromisoformat(day_text)
    frappe.init(site=site)
    frappe.connect()
    frappe.set_user('Administrator')
    from nutreeze_subscriptions.customer_details import _digits, customer_rows

    rows, skipped = [], {'friday': 0, 'frozen': 0, 'no_phone': 0, 'duplicate_phone': 0}
    if day.weekday() == 4:
        skipped['friday'] = 1
    else:
        customers = {r['customer']: r for r in customer_rows({'source': 'WhatsApp'})}
        subscriptions = frappe.db.sql(
            """select customer, item_name, custom_ntz_freeze_log as freeze_log
               from `tabNTZ POS Subscription`
               where removed=0 and invoice_status=1 and is_return=0
                 and ifnull(custom_ntz_addon_for,'')='' and start_date<=%s and end_date>=%s
               order by end_date desc, name asc""", (day, day), as_dict=True)
        plans, frozen = {}, set()
        for sub in subscriptions:
            if sub.customer not in customers:
                continue
            periods = json.loads(sub.freeze_log or '[]')
            if any(p['from_date'] <= day_text <= p['to_date'] for p in periods):
                frozen.add(sub.customer)
                continue
            plans.setdefault(sub.customer, sub.item_name)
        skipped['frozen'] = len(frozen - set(plans))
        seen = set()
        for customer, plan in sorted(plans.items()):
            row = customers[customer]
            phone = _digits(row['phone'])
            if not 6 <= len(phone) <= 15:
                skipped['no_phone'] += 1
                continue
            if phone in seen:
                skipped['duplicate_phone'] += 1
                continue
            seen.add(phone)
            parts = [('Block', row['block']), ('Street', row['street']), ('House', row['house'])]
            address = ', '.join(f'{label} {value}' for label, value in parts if value)
            if row['details']:
                address = f"{address}, {row['details']}" if address else row['details']
            rows.append({
                'ref': phone,
                'order_number': f'WA-{phone}',
                'customer_name': row['customer_name'],
                'customer_phone': f'+965{phone}' if len(phone) == 8 else f'+{phone}',
                'area': (row['area'] or '').strip(),
                'address_text': address,
                'plan': (plan or '').split('|')[0].strip(),
                'has_address': bool(row['address']),
            })
    if not rows and day.weekday() != 4 and os.environ.get('WA_ALLOW_EMPTY') != 'yes':
        # An empty list on a delivery day would cancel every subscriber's order: refuse instead.
        print(json.dumps({'event': 'export_refused', 'delivery_date': day_text, 'reason': 'no_active_subscribers'}))
        sys.exit(3)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump({'delivery_date': day_text, 'rows': rows}, handle, ensure_ascii=False)
    print(json.dumps({'event': 'export', 'delivery_date': day_text, 'rows': len(rows),
                      'missing_address': sum(not r['has_address'] for r in rows), 'skipped': skipped}))


if __name__ == '__main__':
    main(*sys.argv[1:4])
