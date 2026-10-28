"""Hotfix: 'Piers only' foundation (no continuous concrete) + pier shape (round Sonotube / square formed / precast block).
Default for new plans, saved plans keep their type, continuous concrete selectable + deletable (plan + 3D) and restorable,
pier shape global + per pier, ZIP 59833 frost (36 in) → square = max(frost + margin, 12), precast = NOT frost-protected,
Price check / $ inspect / sheets follow the choice.     python3 tests/piers_only.py [base_url]"""
import sys, os, re, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from verify import world_to_page

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/hotfix/'; os.makedirs(SH, exist_ok=True)
EX = 'content-v4/reference/example-20x16.model.json'
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
M = 'window.__layout.getModel()'
FND = f"(() => {{ const f = {M}.layers.find(l => l.id === 'foundation'); return {{ p: f.params, objs: f.objects.map(o => ({{ id: o.id, type: o.type, role: o.props.role || null, ckey: o.props.ckey || null, shape: o.props.shape || null, z: o.z, h: o.height, label: o.props.label || '' }})), flags: (f.flags || []).concat(f.objects.flatMap(o => [])) }}; }})()"
def fnd(pg): return pg.evaluate(FND)
def cont(d): return [o for o in d['objs'] if o['ckey']]
def piers(d): return [o for o in d['objs'] if o['type'] == 'pier']
def zip_skip(pg):
    try: pg.wait_for_selector('#zipModal #zmSkip', timeout=2500); pg.click('#zipModal #zmSkip'); pg.wait_for_timeout(250)
    except Exception: pass
def fresh(pg, example=None):
    pg.goto(BASE); pg.wait_for_timeout(300); pg.evaluate("() => localStorage.clear()")
    if example: pg.evaluate("""async (u) => { const m = await (await fetch(u, {cache:'no-store'})).json(); localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""", example)
    pg.reload(); pg.wait_for_timeout(1200); zip_skip(pg)
def open_fnd(pg):
    pg.click('#menuBtn'); pg.wait_for_timeout(150); pg.click('#menu [data-menu="foundation"]'); pg.wait_for_timeout(400)
def estimate(pg):
    return pg.evaluate("""async () => { const mod = await import('./js/estimate.js'); const c = await import('./js/content.js'); const C = await c.getContentCached(); const r = mod.runEstimate(window.__layout.getModel(), C);
       const raw = r.raw || r; return { lines: (raw.lines || []).map(l => ({ id: l.id, desc: l.desc, ext: l.ext, ref: l.price_ref, note: l.note || '' })), flags: raw.flags || [], total: raw.totals ? raw.totals.total : null, report: raw.report || {} }; }""")
def set_frost(pg, v):
    pg.evaluate("(v) => { const f = window.__layout.getModel().layers.find(l => l.id === 'foundation'); f.params.frostDepthIn = v; window.__layout.regenerate('foundation'); }", v); pg.wait_for_timeout(300)
def popup(pg): return pg.evaluate("() => { const p = document.querySelector('#inspectPop'); return p && !p.hidden ? p.innerText : null; }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())

    # ---------------- new plan: Piers only is the default, no continuous concrete
    fresh(pg)
    d = fnd(pg)
    check('new plan defaults to foundation type "piersOnly"', d['p']['type'] == 'piersOnly', d['p']['type'])
    check('new plan: zero continuous concrete (no grade beam / footing / stem / slab)', len(cont(d)) == 0 and not [o for o in d['objs'] if o['type'] in ('footing',) or o['role'] in ('gradeBeam', 'slab')], [o['ckey'] for o in cont(d)])
    check('new plan: individual piers are laid out', len(piers(d)) >= 4, len(piers(d)))
    check('new plan: pier shape default = round Sonotube', d['p']['pierShape'] == 'round' and all(o['shape'] in (None, 'round') for o in piers(d)))
    open_fnd(pg)
    check('menu "Foundation type" opens the Foundation card with the big type buttons', pg.is_visible('#fndType') and pg.is_visible('#fndType [data-ftype="piersOnly"]'))
    check('"Piers only" button is the selected one', 'on' in (pg.get_attribute('#fndType [data-ftype="piersOnly"]', 'class') or ''))
    check('pier shape toggle visible with Round / Square / Precast', pg.is_visible('#pierShape') and all(pg.locator(f'#pierShape [data-pshape="{k}"]').count() for k in ('round', 'square', 'precast')))
    t = pg.inner_text('#layerCard')
    check('existing types still offered in the type select', all(pg.locator(f'#layerCard select[data-k="type"] option[value="{k}"]').count() for k in ('piersOnly', 'piers', 'crawlspace', 'slab', 'basement')))
    e = estimate(pg)
    check('Price check (Piers only, round): no grade-beam or footing lines', not [l for l in e['lines'] if re.search(r'grade beam|footing|stem wall', l['desc'], re.I) and not re.search(r'no grade beam', l['desc'], re.I)], [l['desc'][:60] for l in e['lines'] if re.search(r'grade beam|footing', l['desc'], re.I)][:3])
    check('Price check: pier rebar = verticals only (no beam bars / corner L-bars)', any(l['id'] == 'found.rebar' and 'verticals only' in l['desc'] for l in e['lines']), [l['desc'][:80] for l in e['lines'] if l['id'] == 'found.rebar'])
    check('Price check: Sonotubes still priced for round piers', any(re.search(r'sonotube|form tube', l['desc'], re.I) and l['ext'] for l in e['lines']))
    check('Price check flags the Piers-only beam note', any('Piers only' in f for f in e['flags']))
    total_round = e['total']

    # ---------------- switch the whole plan to square formed piers
    pg.click('#pierShape [data-pshape="square"]'); pg.wait_for_timeout(500)
    d = fnd(pg)
    check('global toggle → layer pierShape "square"', d['p']['pierShape'] == 'square')
    check('"Square" button shows as selected', 'on' in (pg.get_attribute('#pierShape [data-pshape="square"]', 'class') or ''))
    check('square size chips 12 / 16 shown', pg.is_visible('#pierShape [data-psq="12"]') and pg.is_visible('#pierShape [data-psq="16"]'))
    pg.click('#pierShape [data-psq="16"]'); pg.wait_for_timeout(400)
    check('16×16 chip sets pierSquareIn 16', fnd(pg)['p']['pierSquareIn'] == 16)
    pg.click('#pierShape [data-psq="12"]'); pg.wait_for_timeout(400)
    set_frost(pg, 36)
    d = fnd(pg); depth = 36 + (d['p'].get('frostMarginIn') or 0)
    want = max(depth, 12)
    bots = sorted(set(round(-o['z'] * 12) for o in piers(d)))
    check(f'frost 36 in (ZIP 59833): square piers bottom = max(frost + margin, 12) = {want} in', bots == [want], bots)
    e = estimate(pg)
    check('Price check (square): square form boards line marked "needs a price" (no invented price)', any(l['id'] == 'found.squareForms' and l['ext'] is None and l['ref'] is None and 'needs a price' in l['desc'] for l in e['lines']))
    check('Price check (square): no Sonotube line', not any(re.search(r'sonotube|form tube', l['desc'], re.I) and l['ext'] for l in e['lines']), [l['desc'][:50] for l in e['lines'] if re.search('sonotube|tube', l['desc'], re.I)])
    check('Price check (square): concrete line includes square piers (Home Depot bag/ready-mix price)', any(l['id'] == 'conc.total' and 'square piers' in l['desc'] and l['ext'] for l in e['lines']))
    check('Price check (square): square pier verticals rebar priced', any(l['id'] == 'found.rebar' and 'square pier verticals' in l['desc'] and l['ext'] for l in e['lines']))
    check('Price check (square): still no grade-beam/footing lines', not [l for l in e['lines'] if re.search(r'grade beam|footing', l['desc'], re.I) and not re.search(r'no grade beam', l['desc'], re.I)])
    pg.evaluate("() => window.__layout.plan.fit && window.__layout.plan.fit()"); pg.wait_for_timeout(300)
    pg.screenshot(path=SH + '41-piers-only.png')
    # $ inspect on a square pier
    pg.click('#inspectBtn'); pg.wait_for_timeout(500)
    pp = pg.evaluate("""() => { const o = window.__layout.getModel().layers.find(l => l.id === 'foundation').objects.find(o => o.type === 'pier');
        const s = window.__layout.plan.debug.toScreen(o.geometry.c); const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    pg.mouse.move(*pp); pg.wait_for_timeout(900); tp = popup(pg) or ''
    check('$ inspect on a square pier: square-pier popup with form boards "needs a price" + concrete + rebar', 'Square pier' in tp and 'needs a price' in tp and 'concrete' in tp.lower() and 'rebar' in tp, tp.split('\n')[:2])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    if pg.get_attribute('#inspectBtn', 'aria-pressed') == 'true': pg.click('#inspectBtn'); pg.wait_for_timeout(200)
    # 3D cubes
    pg.evaluate("() => window.__layout.setView('3d')"); pg.wait_for_timeout(1500)
    pg.screenshot(path=SH + '42-cube-piers-3d.png')
    n3 = pg.evaluate("""() => { let n = 0, box = 0; const sc = window.__layout.v3 && (window.__layout.v3.scene || (window.__layout.v3.debug && window.__layout.v3.debug.scene)); if (!sc) return null;
        sc.traverse(o => { if (o.userData && o.userData.objectType === 'pier') { n++; if (o.geometry && o.geometry.type === 'BoxGeometry') box++; } }); return [n, box]; }""")
    check('3D: square piers are drawn as boxes (cubes), not cylinders', n3 is None or (n3[0] > 0 and n3[0] == n3[1]), n3)
    pg.evaluate("() => window.__layout.setView('plan')"); pg.wait_for_timeout(500)
    # sheets
    notes = pg.evaluate("async () => { const s = await import('./js/sheets.js'); return s.sheetFoundation(window.__layout.getModel()).notes.join('\\n'); }")
    check('plan sheet S1 says PIERS ONLY, no grade beam, lists square piers', 'PIERS ONLY' in notes and 'Square pier 12×12 in' in notes and 'grade beam on all bearing lines' not in notes, notes[:160])
    svg = pg.evaluate("async () => { const s = await import('./js/sheets.js'); return s.sheetFoundation(window.__layout.getModel()).svg; }")
    check('plan sheet S1 draws square piers as squares', '<rect' in svg and svg.count('<circle') < len(piers(fnd(pg))))

    # ---------------- precast blocks
    open_fnd(pg)
    pg.click('#pierShape [data-pshape="precast"]'); pg.wait_for_timeout(500)
    d = fnd(pg)
    check('precast: pier blocks sit on grade (z = 0, 8 in tall)', all(abs(o['z']) < 1e-6 and abs(o['h'] - 8 / 12) < 1e-6 for o in piers(d)), [(o['z'], o['h']) for o in piers(d)][:2])
    wt = pg.inner_text('#precastWarn') if pg.locator('#precastWarn').count() else ''
    check('precast: clear NOT FROST-PROTECTED warning with the 36 in frost depth', 'NOT FROST-PROTECTED' in wt and '36 in' in wt and 'R403.1.4' in wt, wt[:90])
    check('precast: "needs a price" shown on the card', 'needs a price' in pg.inner_text('#pierShape').lower())
    e = estimate(pg)
    check('Price check (precast): precast block line "needs a price"', any(l['id'] == 'found.precastBlocks' and l['ext'] is None and 'needs a price' in l['desc'] for l in e['lines']))
    check('Price check (precast): no poured concrete, no tubes, no rebar', not any(l['id'] in ('conc.total', 'found.rebar') and l['ext'] for l in e['lines']) and not any(re.search('sonotube|form tube', l['desc'], re.I) and l['ext'] for l in e['lines']), [l['id'] for l in e['lines'] if l['layer'] == 'foundation'] if False else '')
    check('Price check (precast): frost warning flag', any('NOT FROST-PROTECTED' in f for f in e['flags']))
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun', timeout=15000)
    if pg.locator('.pc-skip[data-skip="beam"]').count(): pg.click('.pc-skip[data-skip="beam"]')
    for i in [x.get_attribute('data-complete') for x in pg.locator('#pcLayers input[data-complete]:not(:checked)').all()]:
        pg.check(f'#pcLayers input[data-complete="{i}"]'); pg.wait_for_timeout(60)
    pg.click('#pcRun'); pg.wait_for_selector('#rpTotal', timeout=20000); pg.wait_for_timeout(500)
    rt = pg.inner_text('#report') if pg.locator('#report').count() else pg.inner_text('body')
    check('Price check report (UI): precast block row "needs a price" + NOT FROST-PROTECTED flag, no grade beam', 'Precast concrete pier / deck block' in rt and 'needs a price' in rt and 'NOT FROST-PROTECTED' in rt and not re.search(r'grade beam: ', rt, re.I))
    pg.screenshot(path=SH + '44-price-check-precast.png')
    pg.click('#rpClose'); pg.wait_for_timeout(300)
    # per-pier override: one pier back to round
    pid = piers(d)[0]['id']
    pg.evaluate("(id) => window.__layout.app.select({ layerId: 'foundation', objectId: id }, true)", pid); pg.wait_for_timeout(500)
    check('pier panel shows per-pier shape buttons', pg.locator('[data-oshape="round"]').count() > 0 and pg.locator('[data-oshape="square"]').count() > 0)
    check('pier panel (precast) shows the frost warning', pg.locator('#ppPrecastWarn').count() > 0 and 'NOT FROST-PROTECTED' in pg.inner_text('#ppPrecastWarn'))
    pg.click('[data-oshape="round"]'); pg.wait_for_timeout(500)
    d = fnd(pg); rp = [o for o in piers(d) if o['shape'] == 'round']
    check('per-pier: one pier set to round Sonotube, the rest stay precast', len(rp) == 1 and len([o for o in piers(d) if o['shape'] in (None, 'precast')]) == len(piers(d)) - 1 and round(-rp[0]['z'] * 12) == want, [(o['shape'], round(-o['z'] * 12)) for o in piers(d)][:3])
    e = estimate(pg)
    check('Price check (mixed): Sonotube for the round one + precast blocks unpriced', any(re.search('sonotube|form tube', l['desc'], re.I) and l['ext'] for l in e['lines']) and any(l['id'] == 'found.precastBlocks' for l in e['lines']))
    pg.evaluate("() => window.__layout.app.select(null, true)"); pg.wait_for_timeout(200)

    # ---------------- saved plan keeps its type; continuous concrete delete in plan + 3D; restore; switch
    fresh(pg, EX)
    d = fnd(pg)
    check('saved plan keeps foundation type "piers" (grade beam)', d['p']['type'] == 'piers')
    gbs = [o for o in cont(d) if o['role'] == 'gradeBeam']
    check('saved plan: grade beams are continuous concrete (ckey)', len(gbs) >= 4, len(gbs))
    pg.evaluate("() => { const m = window.__layout.getModel(); m.activeLayerId = 'foundation'; window.__layout.regenerate('foundation'); }"); pg.wait_for_timeout(500)
    # plan: click the middle of a grade beam
    mid = pg.evaluate("""() => { const f = window.__layout.getModel().layers.find(l => l.id === 'foundation');
        const ps = f.objects.filter(o => o.type === 'pier'); const g = f.objects.find(o => o.props.role === 'gradeBeam');
        // a point on the beam away from any pier
        let best = null; for (let t = 0.05; t < 0.95; t += 0.05) { const p = [g.geometry.a[0] + (g.geometry.b[0] - g.geometry.a[0]) * t, g.geometry.a[1] + (g.geometry.b[1] - g.geometry.a[1]) * t];
          const dmin = Math.min(...ps.map(q => Math.hypot(q.geometry.c[0] - p[0], q.geometry.c[1] - p[1]))); if (!best || dmin > best.d) best = { p, d: dmin }; }
        return { id: g.id, p: best.p }; }""")
    xy = world_to_page(pg, *mid['p']); pg.mouse.click(*xy); pg.wait_for_timeout(500)
    sel = pg.evaluate(f"{M}.selection")
    check('plan: a grade beam can be selected by clicking it', sel and sel.get('objectId') == mid['id'], sel)
    if not (sel and sel.get('objectId') == mid['id']):
        pg.evaluate("(id) => window.__layout.app.select({ layerId: 'foundation', objectId: id }, true)", mid['id']); pg.wait_for_timeout(300)
    check('props card for the grade beam shows "Delete this …" and "Switch to Piers only"', pg.locator('[data-del-concrete]').count() > 0 and pg.locator('[data-pionly]').count() > 0)
    pg.keyboard.press('Delete'); pg.wait_for_timeout(500)
    d = fnd(pg)
    check('plan: Delete key removes the grade beam and it stays deleted after regen', mid['id'] not in [o['id'] for o in d['objs']] and len(d['p']['deletedContinuous']) == 1 and len([o for o in cont(d) if o['role'] == 'gradeBeam']) == len(gbs) - 1, d['p']['deletedContinuous'])
    # props button delete
    g2 = [o for o in cont(d)][0]['id']
    pg.evaluate("(id) => window.__layout.app.select({ layerId: 'foundation', objectId: id }, true)", g2); pg.wait_for_timeout(300)
    pg.click('[data-del-concrete]'); pg.wait_for_timeout(500)
    check('props: "Delete this …" button removes it', g2 not in [o['id'] for o in fnd(pg)['objs']] and len(fnd(pg)['p']['deletedContinuous']) == 2)
    # 3D delete
    pg.evaluate("() => window.__layout.setView('3d')"); pg.wait_for_timeout(1200)
    g3 = [o for o in cont(fnd(pg))][0]['id']
    pg.evaluate("(id) => window.__layout.app.select({ layerId: 'foundation', objectId: id }, true)", g3); pg.wait_for_timeout(300)
    pg.keyboard.press('Delete'); pg.wait_for_timeout(600)
    check('3D: selected continuous concrete is deleted with the Delete key', g3 not in [o['id'] for o in fnd(pg)['objs']] and len(fnd(pg)['p']['deletedContinuous']) == 3)
    pg.evaluate("() => window.__layout.setView('plan')"); pg.wait_for_timeout(500)
    open_fnd(pg)
    check('Foundation card warns that continuous concrete remains + offers Piers only', pg.is_visible('#ccNote') and pg.is_visible('#toPiersOnly'))
    check('Restore button shown for the 3 deleted pieces', pg.is_visible('#restoreConcrete'))
    pg.click('#restoreConcrete'); pg.wait_for_timeout(500)
    d = fnd(pg)
    check('Restore brings the deleted concrete back', len(d['p']['deletedContinuous']) == 0 and len([o for o in cont(d) if o['role'] == 'gradeBeam']) == len(gbs))
    open_fnd(pg)
    pg.click('#toPiersOnly'); pg.wait_for_timeout(600)
    d = fnd(pg)
    check('"Switch to Piers only" removes all continuous concrete (saved plan can switch)', d['p']['type'] == 'piersOnly' and len(cont(d)) == 0 and len(piers(d)) > 0, len(cont(d)))
    open_fnd(pg)
    pg.click('#fndType [data-ftype="piers"]'); pg.wait_for_timeout(500)
    check('type buttons switch back to piers + grade beam', fnd(pg)['p']['type'] == 'piers' and len(cont(fnd(pg))) == len(gbs))
    pg.click('#fndType [data-ftype="piersOnly"]'); pg.wait_for_timeout(500)
    check('… and back to Piers only', fnd(pg)['p']['type'] == 'piersOnly' and len(cont(fnd(pg))) == 0)
    pg.reload(); pg.wait_for_timeout(1200); zip_skip(pg)
    check('Piers only survives a reload (localStorage)', fnd(pg)['p']['type'] == 'piersOnly' and len(cont(fnd(pg))) == 0)
    check('no page errors (desktop)', not errs, errs[:3])

    # ---------------- phone
    ph = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); perrs = []
    ph.on('pageerror', lambda e: perrs.append(str(e)))
    fresh(ph); open_fnd(ph)
    ph.click('#pierShape [data-pshape="square"]'); ph.wait_for_timeout(500)
    open_fnd(ph)
    ph.screenshot(path=SH + '43-piers-only-phone.png')
    bb = ph.locator('#fndType [data-ftype="piersOnly"]').bounding_box()
    check('phone: Piers only button fits the screen and is a real tap target (≥ 36 px)', bb and bb['x'] >= 0 and bb['x'] + bb['width'] <= 390 and bb['height'] >= 36, bb)
    check('phone: pier shape toggle visible', ph.is_visible('#pierShape [data-pshape="precast"]'))
    check('no page errors (phone)', not perrs, perrs[:3])
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
