#!/usr/bin/env python3
"""Generate content/prices-placeholder.json — a MADE-UP price table so the report can run
before Remodel Guide's dated Home Depot snapshot exists. Every entry is placeholder:true and
the app labels each one "placeholder, not a real Home Depot price". Do not edit by hand;
re-run this script."""
import json, os
items = {}
def add(id, name, unit, price, search):
    items[id] = {'name': name, 'unit': unit, 'price': round(price, 2), 'search': search, 'placeholder': True}
per_ft = {'2x4': 0.55, '2x6': 0.85, '2x8': 1.10, '2x10': 1.45, '2x12': 1.90}
for size, pf in per_ft.items():
    for L in [8, 10, 12, 14, 16, 20]:
        add(f'lumber-{size}-{L}', f'{size} × {L} ft SPF/Doug fir lumber', 'ea', pf * L, f'{size} {L} ft lumber')
        add(f'lumber-pt-{size}-{L}', f'{size} × {L} ft pressure-treated lumber', 'ea', pf * L * 1.3, f'{size} {L} ft pressure treated')
    for pc, label in [('92', '92-5/8 in'), ('104', '104-5/8 in'), ('116', '116-5/8 in')]:
        ft = {'92': 7.72, '104': 8.72, '116': 9.72}[pc]
        add(f'lumber-{size}-precut{pc}', f'{size} × {label} precut stud', 'ea', pf * ft * 0.95, f'{size} {label} stud')
for dia in [6, 8, 10, 12, 14, 16, 18, 20, 24]:
    add(f'sonotube-{dia}in-4ft', f'Concrete form tube {dia} in × 4 ft', 'ea', 4 + dia * 1.05, f'{dia} in x 4 ft concrete form tube')
for size, pr in {'2x6': 1.2, '2x8': 1.5, '2x10': 1.9, '2x12': 2.4}.items():
    add(f'joist-hanger-{size}', f'Face-mount joist hanger for {size}', 'ea', pr, f'{size} joist hanger')
for k, (n, u, pr, q) in {
    'concrete-80lb': ('Concrete mix, 80 lb bag', 'bag', 6.00, '80 lb concrete mix'),
    'rebar-4-20ft': ('#4 rebar, 1/2 in × 20 ft', 'ea', 14.00, '#4 rebar 20 ft'),
    'rebar-tie-wire': ('Rebar tie wire roll', 'roll', 8.00, 'rebar tie wire'),
    'anchor-bolt-1-2x10': ('Anchor bolt 1/2 in × 10 in with nut & washer', 'ea', 1.75, '1/2 in x 10 in anchor bolt'),
    'plywood-3-4-form-4x8': ('3/4 in plywood 4×8 (forms)', 'sheet', 48.00, '3/4 in plywood 4x8'),
    'poly-6mil-10x100': ('6 mil poly sheeting 10 × 100 ft', 'roll', 60.00, '6 mil plastic sheeting 10 x 100'),
    'wire-mesh-5x150': ('Welded wire mesh 5 × 150 ft', 'roll', 150.00, 'welded wire mesh concrete 5 x 150'),
    'sill-gasket-50ft': ('Foam sill gasket 5-1/2 in × 50 ft', 'roll', 12.00, 'sill seal gasket 5-1/2 in'),
    'hanger-nails-1lb': ('Joist hanger nails 1 lb', 'box', 9.00, 'joist hanger nails'),
    'subfloor-3-4-tg-4x8': ('3/4 in T&G subfloor panel 4×8', 'sheet', 52.00, '3/4 in tongue and groove subfloor 4x8'),
    'adhesive-subfloor-28oz': ('Subfloor adhesive 28 oz', 'tube', 9.00, 'subfloor adhesive 28 oz'),
    'screws-2in-5lb': ('#8 × 2 in construction screws 5 lb', 'box', 38.00, '#8 2 in construction screws 5 lb'),
    'nails-16d-5lb': ('16d framing nails 5 lb', 'box', 22.00, '16d framing nails 5 lb'),
    'nails-8d-5lb': ('8d sheathing nails 5 lb', 'box', 20.00, '8d common nails 5 lb'),
    'osb-7-16-4x8': ('7/16 in OSB sheathing 4×8', 'sheet', 18.00, '7/16 in OSB 4x8'),
    'housewrap-9x150': ('House wrap 9 × 150 ft', 'roll', 180.00, 'house wrap 9 x 150'),
    'housewrap-tape': ('House wrap seam tape', 'roll', 14.00, 'house wrap tape'),
    'hurricane-tie': ('Hurricane tie (rafter to plate)', 'ea', 1.10, 'hurricane tie'),
    'underlayment-synthetic-10sq': ('Synthetic roof underlayment 10 sq (1000 sq ft)', 'roll', 120.00, 'synthetic roofing underlayment'),
    'shingles-bundle': ('Architectural shingles (1/3 square)', 'bundle', 40.00, 'architectural shingles bundle'),
    'starter-strip-bundle': ('Starter strip shingles', 'bundle', 50.00, 'starter strip shingles'),
    'ridge-cap-bundle': ('Hip & ridge cap shingles', 'bundle', 70.00, 'hip and ridge shingles'),
    'drip-edge-10ft': ('Drip edge 10 ft', 'ea', 9.00, 'drip edge 10 ft'),
    'roofing-nails-5lb': ('Roofing nails 1-1/4 in 5 lb', 'box', 18.00, 'roofing nails 1-1/4 in'),
    'door-ext-*': ('Exterior prehung door {key} in', 'ea', 350.00, 'exterior prehung door'),
    'door-int-*': ('Interior prehung door {key} in', 'ea', 120.00, 'interior prehung door'),
    'window-*': ('Vinyl window {key} in', 'ea', 260.00, 'vinyl window'),
}.items():
    add(k, n, u, pr, q)
doc = {
    'schema': 'layout-price-table/1',
    'placeholder': True,
    'label': 'PLACEHOLDER prices — made up for layout testing, NOT real Home Depot prices',
    'store': None,
    'snapshotDate': None,
    'createdDate': '2026-10-28',
    'currency': 'USD',
    'searchUrlTemplate': 'https://www.homedepot.com/s/{q}',
    'items': items,
}
out = os.path.join(os.path.dirname(__file__), '..', 'content', 'prices-placeholder.json')
json.dump(doc, open(out, 'w'), indent=1, ensure_ascii=False)
print(len(items), 'placeholder items ->', os.path.normpath(out))
