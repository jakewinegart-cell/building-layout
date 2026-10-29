"""Layout v3 tests (phone 390x844, touch): 3D editing, Price check flow, report, Remodel Guide cross-check.
   python3 tests/v3.py [base_url]   (preview server must be up)"""
import sys, json, re, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from verify import Touch

def zip_skip(pg):
    """v4: dismiss the startup ZIP pop-up (Skip for now) so older suites run unchanged."""
    try:
        pg.wait_for_selector('#zipModal #zmSkip', timeout=2500)
        pg.click('#zipModal #zmSkip'); pg.wait_for_timeout(250)
    except Exception:
        pass


BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v3/'
os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))

M = "window.__layout.getModel()"
HD_LABEL = 'Home Depot online price, checked Oct 28, 2026, not localized'
money = lambda s: float(re.sub(r'[^0-9.\-]', '', s))

def new_page(p, b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.goto(BASE); pg.wait_for_timeout(1000)
    zip_skip(pg)
    return ctx, pg, errs

def set_zip(pg, z):
    pg.evaluate("() => window.__layout.zipModal.open()"); pg.wait_for_selector('#zmZip')
    pg.fill('#zmZip', z); pg.click('#zmContinue'); pg.wait_for_selector('#zmUse'); pg.click('#zmUse'); pg.wait_for_timeout(400)

def load_example(pg, name):
    pg.evaluate("""async (n) => { const m = await (await fetch('content-v4/reference/' + n, {cache:'no-store'})).json();
        localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); localStorage.removeItem('layout-app.priceCheck.v3'); }""", name)
    pg.reload(); pg.wait_for_timeout(1000)
    zip_skip(pg)

def precheck(pg, loc=None, tax=None, frost=None, beam=None, skip=()):
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun', timeout=15000)
    if loc is not None: pg.fill('#pcLoc', loc)
    if tax is not None: pg.fill('#pcTaxPct', str(tax))
    if frost is not None: pg.fill('#pcFrostIn', str(frost))
    for k in skip: pg.click(f'.pc-skip[data-skip="{k}"]')
    if beam: pg.check(f'input[name=pcBeam][value={beam}]')

def run_check(pg):
    mark_all_complete(pg); pg.click('#pcRun'); pg.wait_for_selector('#rp-total', timeout=30000); pg.wait_for_timeout(200)
    return money(pg.inner_text('#rpTotal'))

def close_report(pg):
    pg.click('#rpClose'); pg.wait_for_timeout(300)

def mark_all_complete(pg):
    """Feature C: Price check prices only layers marked Complete; older suites price the whole plan."""
    for i in [e.get_attribute('data-complete') for e in pg.locator('#pcLayers input[data-complete]:not(:checked)').all()]:
        pg.check(f'#pcLayers input[data-complete="{i}"]'); pg.wait_for_timeout(60)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    import _skipsize; _skipsize.patch(b)

    # ================================================================ 1. no price before Price check + 3D editing
    ctx, pg, errs = new_page(p, b)
    t = Touch(pg)
    check('button is labeled "Price check"', pg.inner_text('#doneBtn').strip() == 'Price check', pg.inner_text('#doneBtn'))
    check("no 'I'm done' label left", "I'm done" not in pg.content())
    def no_price(tag):
        txt = pg.evaluate("() => Array.from(document.body.children).filter(e => e.id !== 'report').map(e => e.innerText).join('\\n')")
        check(f'no price shown before Price check ({tag})', '$' not in txt and not pg.is_visible('#report'), re.findall(r'.{20}\$.{10}', txt)[:2])
    no_price('plan')
    pg.screenshot(path=SH + '01-price-check-button.png')

    pg.evaluate("window.__layout.setView('3d')"); pg.wait_for_timeout(600)
    no_price('3D')
    # orbit on empty space (top of canvas = sky)
    cam0 = pg.evaluate("window.__layout.v3.debug.camera()")
    r = pg.evaluate("(() => { const b = document.getElementById('view3d').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()")
    t.drag((50, 205), (220, 215), steps=12)
    pg.wait_for_timeout(300)
    check('drag on empty space orbits the camera', pg.evaluate("window.__layout.v3.debug.camera()") != cam0)
    s = pg.evaluate("window.__layout.v3.screenOf('w-ext-2')")
    t.tap(s); pg.wait_for_timeout(300)
    sel = pg.evaluate(f"{M}.selection")
    check('3D touch tap selects the wall', sel and sel.get('objectId') == 'w-ext-2', sel)
    hs = pg.evaluate("window.__layout.v3.debug.handles()")
    check('selected wall shows a move handle', any(h['kind'] == 'move' for h in hs), [h['kind'] for h in hs])
    pg.screenshot(path=SH + '02-3d-select-move-handle.png')
    check('selection sync: properties panel opens for the 3D selection', pg.is_visible('#propsPane') and len(pg.inner_text('#propsPane')) > 10)
    fp0 = pg.evaluate(f"{M}.footprint")
    h = [x for x in hs if x['kind'] == 'move'][0]['screen']
    t.ev('touchStart', [h])
    for i in range(1, 11): t.ev('touchMove', [(h[0], h[1] + i * 6)])
    pg.wait_for_timeout(250)
    ed = pg.evaluate("window.__layout.v3.debug.editing()"); dims = pg.evaluate("window.__layout.v3.debug.dims()")
    check('3D touch drag starts an edit with live dims', ed and ed.get('started') and len(dims) > 0, (ed, dims[:2]))
    pg.screenshot(path=SH + '03-3d-drag-live-dims.png')
    t.ev('touchEnd', []); pg.wait_for_timeout(400)
    fp1 = pg.evaluate(f"{M}.footprint")
    check('3D drag moved the wall', fp1 != fp0, (fp0, fp1))
    snapped = all(abs(v * 12 - round(v * 12)) < 1e-6 for pt in fp1 for v in pt)
    check('3D drag result is snapped (whole inches)', snapped, fp1)
    pg.evaluate("window.__layout.setView('plan')"); pg.wait_for_timeout(300)
    check('selection sync: selection kept when switching 3D → plan', (pg.evaluate(f"{M}.selection") or {}).get('objectId') == 'w-ext-2')
    pg.evaluate("window.__layout.setView('3d')"); pg.wait_for_timeout(500)
    # add + delete a door in 3D
    n0 = pg.evaluate(f"{M}.layers.find(l => l.id==='walls').objects.filter(o => o.type==='opening').length")
    pg.click('#door3dBtn'); pg.wait_for_timeout(150)
    s = pg.evaluate("window.__layout.v3.screenOf('w-ext-1')"); t.tap(s); pg.wait_for_timeout(400)
    n1 = pg.evaluate(f"{M}.layers.find(l => l.id==='walls').objects.filter(o => o.type==='opening').length")
    check('add a door in 3D (tap a wall)', n1 == n0 + 1, (n0, n1))
    pg.click('#sel3dBtn'); pg.wait_for_timeout(100)
    sel = pg.evaluate(f"{M}.selection")
    if not sel or not str(sel.get('objectId', '')).startswith(('op', 'o')):
        oid = pg.evaluate(f"{M}.layers.find(l => l.id==='walls').objects.filter(o => o.type==='opening').slice(-1)[0].id")
        pg.evaluate(f"window.__layout.app.select({{layerId:'walls', objectId:'{oid}'}})")
    pg.click('#del3dBtn'); pg.wait_for_timeout(400)
    n2 = pg.evaluate(f"{M}.layers.find(l => l.id==='walls').objects.filter(o => o.type==='opening').length")
    check('delete in 3D removes it', n2 == n0, (n0, n2))
    pg.click('#xrayBtn'); pg.wait_for_timeout(400)
    check('X-ray toggles see-through layers', len(pg.evaluate("window.__layout.v3.debug.xrayLayers()")) > 0)
    pg.screenshot(path=SH + '05-3d-xray.png')
    pg.click('#xrayBtn'); pg.wait_for_timeout(200)
    pg.evaluate("window.__layout.app.select({layerId:'walls', objectId:'w-ext-2'})"); pg.wait_for_timeout(200)
    pg.click('.tabs button[data-tab="props"]'); pg.wait_for_timeout(400)
    check('3D edit panel open for the 3D selection', pg.is_visible('#propsPane') and 'Wall' in pg.inner_text('#propsPane'))
    pg.screenshot(path=SH + '04-3d-edit-panel.png')
    no_price('after edits')
    check('no console errors (3D section)', not errs, errs[:3])
    ctx.close()

    # ================================================================ 2. pre-check, skip flags, report sections, labels
    ctx, pg, errs = new_page(p, b)
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun', timeout=15000)
    check('Price check opens the pre-check (not a priced report)', pg.is_visible('#pcTax') and pg.is_visible('#pcFrost') and pg.query_selector('#rp-total') is None)
    check('pre-check: frost depth blank by default', pg.input_value('#pcFrostIn') == '')
    check('pre-check: tax blank by default (no assumed location)', pg.input_value('#pcTaxPct') == '' and pg.input_value('#pcLoc') == '')
    check('pre-check: beam question shown when the model has a mid beam', pg.is_visible('#pcBeam'))
    check('nothing priced on the pre-check screen', '$' not in pg.inner_text('#report'))
    pg.screenshot(path=SH + '06-precheck.png', full_page=False)
    pg.locator('#pcBeam').scroll_into_view_if_needed(); pg.screenshot(path=SH + '07-precheck-beam.png')
    for k in ('tax', 'frost', 'beam'): pg.click(f'.pc-skip[data-skip="{k}"]')
    check('skip marks each item skipped', pg.locator('.pc-card.skipped').count() == 3)
    total_skip = run_check(pg)
    check('report shows a total after running', total_skip > 0, total_skip)
    check('skipped tax → flag + 0% used', pg.locator('#rpFlagTax[data-skipped="tax"]').count() == 1 and 'rate unknown' in pg.inner_text('#rpTaxRow'))
    check('skipped frost → 48 in conservative placeholder flag (v4 unknown-ZIP fallback)', pg.locator('#rpFrost[data-skipped="frost"]').count() == 1 and '48 in' in pg.inner_text('#rpFrost'))
    check('skipped beam → unsupported-beam FLAGGED', pg.locator('#rpBeam[data-skipped="beam"]').count() == 1 and 'FLAGGED' in pg.inner_text('#rpBeam'))
    check('no piers silently added under the beam', pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').objects.filter(o=>o.props&&o.props.beamSupport).length") == 0)
    for sid in ['rp-total', 'rp-check', 'rp-mat', 'rp-A1', 'rp-S1', 'rp-S2', 'rp-S3', 'rp-S4', 'rp-3d', 'rp-steps', 'rp-disc']:
        check(f'report section #{sid} present', pg.locator('#' + sid).count() == 1)
    check('concrete alternatives priced (no NaN)', 'NaN' not in pg.inner_text('#rp-total') and 'bags' in pg.inner_text('#rp-total'))
    check('per-layer breakdown rows', pg.locator('#rpBreak tr[data-group]').count() >= 5)
    check('sheets have drawings (svg)', all(pg.locator(f'#rp-{k} svg').count() >= 1 for k in ['A1', 'S1', 'S2', 'S3', 'S4']))
    check('S3 has one elevation per wall', pg.locator('#rp-S3 .rp-sheet').count() >= 4)
    check('3D views rendered', pg.locator('#rp-3d img').count() == 5)
    check('build steps rendered from instructions.md (8+ phases, no raw template)', pg.locator('#rp-steps .rp-phase').count() >= 8 and '{' not in pg.inner_text('#rp-steps') and '[if' not in pg.inner_text('#rp-steps'))
    disc = pg.inner_text('#rpDiscText')
    check('disclaimer verbatim with snapshot date', disc.startswith('This is an estimate, not stamped plans. Material prices come from a homedepot.com snapshot taken 2026-10-28 (America/Denver).'), disc[:120])
    check('price source label at top', HD_LABEL in pg.inner_text('#rpPriceSrc'))
    real = pg.locator('#rp-mat .ph.real'); est_rows = pg.locator('#rp-mat tr.st-estimate')
    check('verified lines carry the HD label', real.count() > 20 and all(real.nth(i).inner_text() == HD_LABEL for i in range(real.count())), real.count())
    check('estimate lines marked est. with their source', est_rows.count() > 0 and all(est_rows.nth(i).locator('.ph.est').count() == 1 and 'Estimate source:' in est_rows.nth(i).inner_text() for i in range(est_rows.count())), est_rows.count())
    check('verified lines link to homedepot.com', all('homedepot.com' in (pg.locator('#rp-mat tr.st-hd').nth(i).locator('a').first.get_attribute('href') or '') for i in range(pg.locator('#rp-mat tr.st-hd').count())))
    check('no placeholder price labels when HD data is wired', 'PLACEHOLDER — not a real' not in pg.inner_text('#rp-mat'))
    hdr = pg.inner_text('#rp-mat thead')
    check('material list columns: qty, unit, unit price, line total, link', all(x.lower() in hdr.lower() for x in ['Qty', 'Unit', 'Unit price', 'Line total', 'Link']))
    # report section screenshots
    pg.screenshot(path=SH + '10-report-total-top.png')
    for i, (sid, nm) in enumerate([('rp-total', 'total-breakdown'), ('rp-check', 'check-flags'), ('rp-mat', 'material-list'), ('rp-A1', 'A1-plan'), ('rp-S1', 'S1-foundation'), ('rp-S2', 'S2-floor'), ('rp-S3', 'S3-walls'), ('rp-S4', 'S4-roof'), ('rp-3d', 'A2-3d-views'), ('rp-steps', 'build-steps'), ('rp-disc', 'disclaimer')]):
        if True:   # phone viewport scrolled to the section start (element shots of a scrolled overlay come out clipped)
            pg.evaluate("(id) => { const r = document.getElementById('report'); r.scrollTop = document.getElementById(id).offsetTop - 100; }", sid); pg.wait_for_timeout(150)
            pg.screenshot(path=SH + f'{11 + i:02d}-report-{nm}.png')
        else:
            pg.locator('#' + sid).screenshot(path=SH + f'{11 + i:02d}-report-{nm}.png')
    pg.evaluate("() => { const r = document.getElementById('report'); const e = document.querySelector('#rp-mat tr.st-estimate'); r.scrollTop = e.getBoundingClientRect().top + r.scrollTop - 200; }"); pg.wait_for_timeout(150)
    pg.screenshot(path=SH + '13b-report-material-list-estimates.png')
    pg.evaluate("() => { const r = document.getElementById('report'); const e = document.getElementById('rpTaxRow'); r.scrollTop = e.getBoundingClientRect().top + r.scrollTop - 420; }"); pg.wait_for_timeout(150)
    pg.screenshot(path=SH + '11b-report-breakdown-tax-total.png')
    pg.evaluate("document.getElementById('report').scrollTop = 0")
    # tax editable in report, rate shown in the total
    pg.fill('#rpTax', '7.5'); pg.press('#rpTax', 'Tab'); pg.wait_for_timeout(300)
    check('tax rate editable; total states the rate used', '7.5%' in pg.inner_text('#rp-total') and money(pg.inner_text('#rpTotal')) > total_skip)

    # ---- stale: edit while the report is open → Out of date, total frozen
    tot_before = pg.inner_text('#rpTotal')
    pg.evaluate(f"() => {{ const m = {M}; m.footprint[1][0] += 2; m.footprint[2][0] += 2; window.__layout.regenerate('footprint'); }}")
    pg.wait_for_timeout(300)
    check('edit after running → report marked Out of date', pg.is_visible('#rpStale') and 'out of date' in pg.inner_text('#rpStale').lower())
    check('Re-run price check button shown', pg.is_visible('#rpRerun'))
    check('never recalculated silently (total unchanged)', pg.inner_text('#rpTotal') == tot_before)
    pg.locator('#rpStale').scroll_into_view_if_needed(); pg.evaluate("document.getElementById('report').scrollTop = 0")
    pg.screenshot(path=SH + '08-report-out-of-date.png')
    close_report(pg)
    no_price('after closing report')
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun')
    check('pre-check shows last report as out of date', 'out of date' in pg.inner_text('#report'))
    pg.click('#pcViewLast'); pg.wait_for_selector('#rpStale')
    pg.click('#rpRerun'); pg.wait_for_selector('#pcRun')
    t2 = run_check(pg)
    check('re-run prices the current plan (no longer stale, total changed)', not pg.is_visible('#rpStale') and abs(t2 - money(tot_before)) > 1, (tot_before, t2))
    check('no console errors (report section)', not errs, errs[:3])
    ctx.close()

    # ================================================================ 3. beam choice + Remodel Guide v4 reference cross-check (ZIP 59833: 0% tax, 36 in frost)
    ctx, pg, errs = new_page(p, b)
    load_example(pg, 'example-20x16.model.json'); set_zip(pg, '59833')
    precheck(pg, skip=('beam',))
    base = run_check(pg)
    # Remodel Guide reference (fastener-schedule.json) = $9,066.74; the app adds Remodel Guide's roofing fixes
    # (2 ice-barrier courses, 19/32 roof OSB at 24 in o.c., H-clips PRICE NEEDED) = +$232.83 → $9,299.57
    check('REFERENCE base 20x16 piers, ZIP 59833 = $9,299.57 ($9,066.74 reference + roofing fixes)', abs(base - 9299.57) < 0.005, base)
    exp = pg.evaluate("async () => (await (await fetch('content-v4/reference/example-20x16.takeoff.json')).json())")
    nf = pg.evaluate("""async () => { const [{getContent}, {runEstimate}] = await Promise.all([import('./js/report.js'), import('./js/estimate.js')]);
        const e = runEstimate(window.__layout.getModel(), await getContent(), { noRoofingFixes: true }); return { groups: Object.fromEntries(e.groups.map(g => [g.id, g.total])), total: e.totals.total }; }""")
    check('without the roofing fixes the app engine = reference $9,066.74', abs(nf['total'] - exp['base']['totals']['total']) < 0.005, nf['total'])
    eg = exp['base']['groups']
    check('per-layer groups match the reference (no roofing fixes)', all(abs(nf['groups'].get('fasteners' if k == 'all' else k, -1) - v) < 0.005 for k, v in eg.items()), (nf['groups'], eg))
    br = {r.get_attribute('data-group'): money(r.locator('td.n').inner_text()) for r in pg.locator('#rpBreak tr[data-group]').all()}
    check('report roof group = reference roof + fixes ($2,160.23)', abs(br.get('roof', 0) - 2160.23) < 0.005, br.get('roof'))
    rows = pg.inner_text('#rpBreak')
    check('materials $8,454.15 · tax $0.00 (0%, ZIP lookup) · contingency $845.42', all(x in rows for x in ['$8,454.15', '$0.00', '$845.42']) and 'zip 59833 lookup' in rows, rows[-400:])
    # quantities line by line through the app pipeline
    q = pg.evaluate("""async () => { const [{getContent}, {runEstimate}] = await Promise.all([import('./js/report.js'), import('./js/estimate.js')]);
        const C = await getContent(); const e = runEstimate(window.__layout.getModel(), C, { noRoofingFixes: true });
        return { lines: e.lines.map(l => [l.id, l.qty, l.total]), report: e.report, mode: C.mode, status: C.status.remodelGuide }; }""")
    check('Remodel Guide content wired (mode hd)', q['mode'] == 'hd' and q['status'] == 'wired', (q['mode'], q['status']))
    el = [[l['id'], l['buy'], l['ext']] for l in exp['base']['lines']]   # ids repeat (e.g. two site.layout lines) → compare in order
    mism = [(a, b_) for a, b_ in zip(q['lines'], el) if a != b_]
    check('takeoff quantities + line totals match the reference line-by-line', not mism and len(q['lines']) == len(el), mism[:3])
    rep = q['report']
    check('takeoff quantities for 20x16 @ 59833: 14 piers 36 in deep, 4.87 yd, 16 bolts, 11/22/15 sheets', (rep['pierCount'], rep['pierBottomBelowGradeIn'], rep['requiredPierDepthIn'], rep['concreteYd'], rep['anchorBolts'], rep['floorSheets'], rep['wallSheets'], rep['roofSheets']) == (14, 36, 36, 4.87, 16, 11, 22, 15), rep)
    pg.select_option('#rpConc', 'bags80'); pg.wait_for_timeout(300)
    check('REFERENCE bags80 = $9,902.81 ($9,669.98 reference + roofing fixes)', abs(money(pg.inner_text('#rpTotal')) - 9902.81) < 0.005 and abs(exp['deltas']['bagged80lbInsteadOfReadyMix']['total'] - 9669.98) < 0.005, pg.inner_text('#rpTotal'))
    pg.select_option('#rpConc', 'auto'); pg.wait_for_timeout(200)
    close_report(pg)
    check('frost from ZIP → no placeholder flag, 36 in (zip 59833 lookup)', pg.locator('#rpFrost[data-skipped]').count() == 0 and '36 in' in pg.inner_text('#rpFrost') and 'zip 59833' in pg.inner_text('#rpFrost'))
    # beam choice: piers
    precheck(pg, beam='piers')
    tp = run_check(pg)
    nbp = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').objects.filter(o=>o.props&&o.props.beamSupport).length")
    check('beam choice "Add piers under the beam" adds piers and changes the takeoff', nbp >= 2 and tp > base and pg.locator('#rpBeam[data-choice="piers"]').count() == 1, (nbp, tp))
    pc = pg.evaluate("""async () => { const [{getContent}, {runEstimate}] = await Promise.all([import('./js/report.js'), import('./js/estimate.js')]);
        return runEstimate(window.__layout.getModel(), await getContent()).report.pierCount; }""")
    check('pier count in the takeoff includes the beam piers', pc == 14 + nbp, pc)
    pg.evaluate("() => { const r = document.getElementById('report'); r.scrollTop = document.getElementById('rp-check').offsetTop - 100; }"); pg.wait_for_timeout(150)
    pg.screenshot(path=SH + '09-report-beam-piers.png')
    close_report(pg)
    # beam choice: 2x12 clear span (starting again from the example)
    load_example(pg, 'example-20x16.model.json'); set_zip(pg, '59833')
    precheck(pg, beam='clearspan')
    tc = run_check(pg)
    check('REFERENCE 2x12 clear-span choice = $9,170.35 ($8,937.52 reference + roofing fixes)', abs(tc - 9170.35) < 0.005 and abs(exp['deltas']['clearSpan2x12NoBeam']['total'] - 8937.52) < 0.005, tc)
    fl = pg.evaluate(f"(() => {{ const f = {M}.layers.find(l=>l.id==='floor'); return [f.params.joistSize, f.objects.filter(o=>o.props&&o.props.role==='girder').length]; }})()")
    check('clear-span choice: 2x12 joists, no mid beam', fl == ['2x12', 0], fl)
    check('beam question skipped when the model has no mid beam', (close_report(pg), pg.click('#doneBtn'), pg.wait_for_selector('#pcRun'), pg.locator('#pcBeam').count() == 0)[-1])
    pg.click('#pcCancel'); pg.wait_for_timeout(200)
    # the clear-span example model itself, loaded from Remodel Guide's file
    load_example(pg, 'example-20x16-2x12-clearspan-frost36.model.json'); set_zip(pg, '59833')
    precheck(pg)
    check('REFERENCE clear-span example model = $9,170.35', abs(run_check(pg) - 9170.35) < 0.005)
    close_report(pg)
    load_example(pg, 'example-20x16-frost36.model.json'); set_zip(pg, '59833')
    precheck(pg, skip=('beam',))
    check('REFERENCE frost36 example model = $9,299.57', abs(run_check(pg) - 9299.57) < 0.005)
    check('no console errors (cross-check section)', not errs, errs[:3])
    ctx.close()
    b.close()

n = sum(1 for r in results if r[1])
print(f'\nv3: {n}/{len(results)} passed')
with open(SH + 'results.json', 'w') as f: json.dump(results, f, indent=1)
sys.exit(0 if n == len(results) else 1)
