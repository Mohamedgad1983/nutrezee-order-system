"""Draws the Kitchen Stickers screen from the page's own markup, with sample data only."""
import re
import sys

hbs_path, out = sys.argv[1:3]
hbs = open(hbs_path, encoding='utf-8').read()
art = hbs[hbs.index('<article class="nz-legacy-label'):hbs.index('</article>') + len('</article>')]
notes = 'DRY FOOD - 2 Meals Chicken + Rice - 1 Salad (Green salad only) - Sauce on the Side - No Buffalo chicken'
vals = {
    'fullName': 'Sample Customer', 'subscription': 'Tuesday 20th October 2026', 'deliveryTime': '-', 'daysRemaining': '12',
    'deliveryMethod': '-', 'packageName': 'Protein 150g / Carb 150g · Breakfast 1', 'mealsPerDay': '3', 'snacksPerDay': '2',
    'legacyUserId': '9001', 'orderNumber': 'WA-50000000', 'area': 'Salam', 'block': '6', 'street': '25', 'building': '60',
    'floor': '-', 'flat': '-', 'direction': '-', 'phone': '50000000', 'notes': notes,
}
art = re.sub(r"\{\{if this\.preview\.hasNotes '([^']*)'\}\}", r"\1", art)
art = re.sub(r"\{\{#if this\.preview\.hasNotes\}\}(.*?)\{\{/if\}\}", r"\1", art, flags=re.S)
art = re.sub(r"\{\{#unless this\.preview\.hasNotes\}\}.*?\{\{/unless\}\}", "", art, flags=re.S)
for key, value in vals.items():
    art = art.replace('{{this.preview.' + key + '}}', value)
assert '{{' not in art, re.findall(r'\{\{[^}]*\}\}', art)[:5]
rows = [('9001', 'Sample Customer', 'Salam · 50000000', True), ('9002', 'Customer Two', 'Adan · 50000001', False),
        ('9003', 'Customer Three', 'Bayan · 50000002', False), ('9004', 'Customer Four', 'Surra · 50000003', False)]
lst = ''.join(
    f'<button class="nz-kitchen-row{" nz-kitchen-row--chosen" if chosen else ""}"><span class="nz-kitchen-row__box">{box}</span>'
    f'<span class="nz-kitchen-row__name">{name}</span><span class="nz-kitchen-row__sub">{sub}</span></button>'
    for box, name, sub, chosen in rows)
fields = [('name', 'Name / الاسم', 'Sample Customer'), ('mobile', 'Mobile / الموبايل', '50000000'), ('box', 'BOX', '9001'),
          ('area', 'Area / المنطقة', 'Salam'), ('block', 'Block', '6'), ('street', 'Street', '25'),
          ('house', 'House / Building', '60'), ('address_details', 'Direction / تفاصيل العنوان', ''),
          ('meals_per_day', 'Meals / وجبات', '3'), ('snacks_per_day', 'Snacks / سناك', '2'),
          ('breakfast', 'Breakfast / فطار', '1'), ('protein_g', 'Protein (g)', '150'), ('carb_g', 'Carb (g)', '150'),
          ('start_date', 'Start date / تاريخ البداية', '2026-10-19'), ('end_date', 'End date / تاريخ النهاية', '2026-11-05')]
form = ''.join(f'<label class="nz-kitchen-field nz-kitchen-field--{f}"><span>{label}</span><input value="{v}"></label>'
               for f, label, v in fields)
page = f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="addon.css"><style>
*,*::before,*::after{{box-sizing:border-box}}
body{{margin:0;background:#fff;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;width:1560px}}
.btn{{display:inline-block;padding:.35rem .75rem;border-radius:.4rem;border:1px solid #cfd4dc;background:#fff;font-size:.85rem}}
.btn-primary{{background:#1f6feb;color:#fff;border-color:#1f6feb}} .btn-sm{{font-size:.78rem}}
</style></head><body><section class="nz-kitchen-panel">
<header class="nz-label-panel__header"><div><h2>Kitchen Stickers / ستيكرات المطبخ</h2><p>WhatsApp subscribers' stickers… / ستيكرات مشتركين الواتساب…</p></div>
<div class="nz-kitchen-actions"><button class="btn btn-primary btn-sm">+ New sticker / ستيكر جديد</button><button class="btn btn-sm">Reload / تحديث</button></div></header>
<div class="nz-kitchen-layout"><aside class="nz-kitchen-list"><input class="nz-kitchen-search" placeholder="Search name, mobile, BOX, area… / ابحث"><div class="nz-kitchen-count">16 printing / بيتطبعوا</div>{lst}</aside>
<form class="nz-kitchen-editor"><h3>Sample Customer</h3><div class="nz-kitchen-fields">{form}<p class="nz-kitchen-driver">Driver tomorrow: Driver Name / سواق بكره</p>
<label class="nz-kitchen-field nz-kitchen-field--notes"><span>Notes / الملاحظات</span><textarea rows="5">{notes}</textarea></label></div>
<div class="nz-kitchen-buttons"><button class="btn btn-primary">Save / حفظ</button><button class="btn">Copy as new / انسخ كجديد</button><button class="btn">Stop printing / وقف الطباعة</button><button class="btn">Close / قفل</button></div></form>
<div class="nz-kitchen-preview"><div class="nz-kitchen-preview__title">The sticker as it prints on 2026-10-20 / شكل الستيكر وقت الطباعة</div><div class="nz-label-preview">{art}</div></div></div></section></body></html>'''
open(out, 'w', encoding='utf-8').write(page)
