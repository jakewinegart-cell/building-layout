"""Feature C: per-layer "Complete" checks + partial Price check (only completed layers are priced).
   Also: Remodel Guide fastener-schedule popups and roofing fixes on the 20x16 example @ ZIP 59833.
   python3 tests/v3_complete.py [base_url]   (preview server must be up)"""
import sys, re, os, glob
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v3/'
os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
def money(t): m = re.search(r'\$([0-9,]+\.\d\d)', t or ''); return float(m.group(1).replace(',', '')) if m else None
M = 'window.__layout.getModel()'
EX = 'content-v4/reference/example-20x16.model.json'
PRICED = ['site', 'foundation', 'floor', 'walls', 'roof']

def complete_ids(pg): return pg.evaluate(f"{M}.layers.filter(l => l.complete).map(l => l.id)")
def states(pg): return {e.get_attribute('data-layer'): (e.locator('.lprice').get_attribute('data-pricestate') if e.locator('.lprice').count() else None) for e in pg.locator('.lrow[data-layer]').all()}
def open_precheck(pg):
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun', timeout=15000)
    if pg.locator('.pc-skip[data-skip="beam"]').count(): pg.click('.pc-skip[data-skip="beam"]')
def run(pg):
    pg.click('#pcRun'); pg.wait_for_selector('#rpTotal', timeout=20000); pg.wait_for_timeout(300)
    return money(pg.inner_text('#rpTotal'))
def close_report(pg): pg.click('#rpClose'); pg.wait_for_timeout(300)
def hover_popup(pg, js):
    pt = pg.evaluate(js); pg.mouse.move(*pt); pg.wait_for_timeout(1100)
    return pg.evaluate("() => { const p = document.querySelector('#inspectPop'); return p && !p.hidden ? p.innerText : ''; }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.goto(BASE); pg.wait_for_timeout(300); pg.evaluate("localStorage.clear()")
    pg.evaluate("""async (u) => { const m = await (await fetch(u, {cache:'no-store'})).json(); localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""", EX)
    pg.reload(); pg.wait_for_timeout(1200)
    pg.evaluate("() => __layout.zipModal.open()"); pg.wait_for_selector('#zmZip'); pg.fill('#zmZip', '59833'); pg.click('#zmContinue'); pg.wait_for_selector('#zmUse'); pg.click('#zmUse'); pg.wait_for_timeout(500)

    # ---------- layer rows
    ids = [e.get_attribute('data-complete') for e in pg.locator('.lrow input[data-complete]').all()]
    check('every buildable layer row has a Complete box (stubs do not)', ids == PRICED or sorted(ids) == sorted(PRICED), ids)
    check('nothing is Complete by default', complete_ids(pg) == [])
    # ---------- none checked → friendly message, Run disabled
    open_precheck(pg)
    check('pre-check with no layer complete: "Check a layer complete first" + Run disabled', 'Check a layer complete first' in pg.inner_text('#pcNone') and pg.is_disabled('#pcRun'), pg.inner_text('#pcLayers')[:120])
    check('nothing priced on the pre-check screen', pg.locator('#rpTotal').count() == 0)
    pg.click('#pcCancel'); pg.wait_for_timeout(300)
    # ---------- tick 3 layers on the layer rows; persisted
    for i in ['site', 'foundation', 'floor']:
        pg.check(f'.lrow input[data-complete="{i}"]'); pg.wait_for_timeout(120)
    pg.wait_for_timeout(400); pg.reload(); pg.wait_for_timeout(1200)
    check('Complete checks persist across reload', sorted(complete_ids(pg)) == ['floor', 'foundation', 'site'] and pg.is_checked('.lrow input[data-complete="floor"]'), complete_ids(pg))
    check('before any price check: completed layers say "not priced yet"', all(states(pg)[i] == 'unpriced' for i in ['site', 'foundation', 'floor']), states(pg))
    # ---------- partial price check
    open_precheck(pg)
    check('pre-check lists the layers to price (3 of 5 complete)', '3 of 5 complete' in pg.inner_text('#pcLayers') and not pg.is_disabled('#pcRun'))
    tot = run(pg)
    part = pg.inner_text('#rpPartial')
    check('partial total labelled: "Partial total — 3 of 5 layers priced"', 'Partial total — 3 of 5 layers priced' in part and 'Partial total' in pg.inner_text('#rp-total'), part[:120])
    check('unchecked layers listed as "Not priced yet (not marked complete)"', 'Not priced yet (not marked complete)' in part and 'Walls' in pg.inner_text('#rpNotPriced') and 'Roof framing' in pg.inner_text('#rpNotPriced'))
    br = {r.get_attribute('data-group'): money(r.locator('td.n').inner_text()) for r in pg.locator('#rpBreak tr[data-group]').all()}
    check('breakdown has only completed layers (+ their fastener share)', set(br) <= {'site', 'foundation', 'floor', 'fasteners'} and 'walls' not in br and 'roof' not in br, br)
    check('breakdown rows for Walls/Roof say not priced', pg.locator('#rpBreak tr[data-notpriced="walls"]').count() == 1 and pg.locator('#rpBreak tr[data-notpriced="roof"]').count() == 1)
    full = pg.evaluate("""async () => { const E = await import('./js/estimate.js'); const { getContent } = await import('./js/report.js'); const C = await getContent(); const e = E.runEstimate(__layout.getModel(), C); const g = Object.fromEntries(e.groups.map(x => [x.id, x.total])); return { g, total: e.totals.total, fast: e.fasteners }; }""")
    check('partial groups equal the full estimate for those layers', all(abs(br[k] - full['g'][k]) < 0.005 for k in ['site', 'foundation', 'floor']), (br, full['g']))
    exp_mat = round(br['site'] + br['foundation'] + br['floor'] + br['fasteners'], 2)
    check('partial total = completed groups + fastener share + 10% contingency (0% tax)', abs(tot - round(exp_mat + round(exp_mat * 0.10, 2), 2)) < 0.02 and tot < full['total'], (tot, exp_mat, full['total']))
    check('material list marks the others "not included"', pg.locator('#rp-mat tr[data-notpriced="walls"]').count() == 1 and 'not included' in pg.inner_text('#rp-mat tr[data-notpriced="roof"]').lower())
    check('sheets S3 (walls) and S4 (roof) replaced by "Not included"', pg.locator('#rp-S3 .rp-notinc').count() == 1 and pg.locator('#rp-S4 .rp-notinc').count() == 1 and pg.locator('#rp-S1 .rp-notinc').count() == 0 and pg.locator('#rp-S1 svg').count() >= 1)
    check('build steps for walls/roof marked not included; foundation/floor steps shown', pg.locator('.rp-phase[data-notinc="walls"]').count() >= 1 and pg.locator('.rp-phase[data-notinc="roof"]').count() >= 1 and pg.locator('.rp-phase[data-notinc="floor"]').count() == 0)
    fn = pg.inner_text('#rpFastNote')
    check('fasteners: full box purchase $404.99 + used $239.06 labelled, partial share stated', 'Full box purchase: $404.99' in fn and 'actually used by the pieces: $239.06' in fn and 'Partial total includes' in fn, fn)
    pg.evaluate("() => { document.getElementById('report').scrollTop = 0; }"); pg.wait_for_timeout(150)
    pg.screenshot(path=SH + '26-partial-price-report.png')
    partial_total = tot
    close_report(pg)
    check('after the run: the 3 completed layers say "priced"', all(states(pg)[i] == 'priced' for i in ['site', 'foundation', 'floor']) and states(pg)['walls'] is None, states(pg))
    # ---------- edit a completed layer: check stays, that layer goes stale
    pg.evaluate(f"() => {{ {M}.layers.find(l => l.id === 'floor').params.joistOcIn = 12; __layout.regenerate('floor'); }}"); pg.wait_for_timeout(500)
    st = states(pg)
    check('editing Floor keeps its Complete check but marks its price stale (others stay priced)', pg.is_checked('.lrow input[data-complete="floor"]') and st['floor'] == 'stale' and st['foundation'] == 'priced' and st['site'] == 'priced', st)
    pg.locator('#layersPane').scroll_into_view_if_needed()
    pg.screenshot(path=SH + '25-layers-complete-checks.png')
    open_precheck(pg)
    check('pre-check says the last report is out of date', 'out of date' in pg.inner_text('#report').lower())
    pg.click('#pcViewLast'); pg.wait_for_selector('#rpStale')
    check('Out of date banner names the stale layer + Re-run button', 'floor framing' in pg.inner_text('#rpStale').lower() and 'price stale' in pg.inner_text('#rpStale').lower() and pg.is_visible('#rpRerun'), pg.inner_text('#rpStale')[:200])
    check('stale report still shows the old partial total (nothing re-priced silently)', money(pg.inner_text('#rpTotal')) == partial_total)
    pg.click('#rpRerun'); pg.wait_for_selector('#pcRun')
    if pg.locator('.pc-skip[data-skip="beam"]').count(): pg.click('.pc-skip[data-skip="beam"]')
    t2 = run(pg)
    check('Re-run prices the edited floor (no longer stale, total changed)', pg.locator('#rpStale').count() == 0 and t2 != partial_total, (partial_total, t2))
    close_report(pg)
    check('after Re-run Floor is "priced" again', states(pg)['floor'] == 'priced', states(pg))
    # ---------- changing which layers are complete makes the report out of date
    pg.check('.lrow input[data-complete="walls"]'); pg.wait_for_timeout(200)
    check('newly checked Walls says "not priced yet"', states(pg)['walls'] == 'unpriced', states(pg))
    open_precheck(pg); pg.click('#pcViewLast'); pg.wait_for_selector('#rpStale')
    check('changing the Complete set marks the report out of date', 'changed which layers are marked complete' in pg.inner_text('#rpStale').lower())
    close_report(pg)
    # ---------- all complete → full estimate (fastener schedule + roofing fixes)
    pg.evaluate(f"() => {{ {M}.layers.find(l => l.id === 'floor').params.joistOcIn = 16; __layout.regenerate('floor'); }}"); pg.wait_for_timeout(400)
    pg.check('.lrow input[data-complete="roof"]'); pg.wait_for_timeout(200)
    open_precheck(pg)
    check('all 5 complete: "full estimate" note', '5 of 5 complete' in pg.inner_text('#pcLayers') and 'full estimate' in pg.inner_text('#pcLayers'))
    tf = run(pg)
    check('all layers complete → full total $9,299.57, no partial label', abs(tf - 9299.57) < 0.005 and pg.locator('#rpPartial').count() == 0 and pg.locator('[data-notinc]').count() == 0, tf)
    rf = pg.inner_text('#rpRoofFix')
    check('roofing fixes listed (19/32 OSB at 24 in, 2 ice-barrier courses)', '19/32' in rf and '2 course' in rf, rf)
    guide = pg.inner_text('#rp-steps')
    check('build steps say 19/32 roof OSB (not 7/16) when the fix applies', 'sheets of 19/32 OSB' in guide and 'sheets of 7/16 OSB' not in guide)
    check('H-clips for 19/32 flagged as needing a price', 'H-clip' in pg.inner_text('#report') and 'PRICE NEEDED' in pg.inner_text('#report') or 'needs a price' in pg.inner_text('#report').lower())
    close_report(pg)
    # ---------- $ popups on the 59833 example (fastener-schedule.json hover copy)
    pg.click('#inspectBtn'); pg.wait_for_timeout(400)
    stud = hover_popup(pg, """() => { const m = __layout.getModel(); const wl = m.layers.find(l => l.id === 'walls');
        const ops = wl.objects.filter(o => o.type === 'opening');
        const w = wl.objects.find(o => o.type === 'wall' && o.props.exterior && !ops.some(x => x.geometry.wallId === o.id)) || wl.objects.find(o => o.type === 'wall');
        const a = w.geometry.a, b = w.geometry.b; const s = __layout.plan.debug.toScreen([a[0] + (b[0]-a[0])*0.41, a[1] + (b[1]-a[1])*0.41]);
        const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    check('stud popup (59833): Common stud $6.14 + 6 x 3-1/4x.131 nail @ $0.026 = $0.16, total $6.30', '2x6 Common stud, 7 ft 7.5 in · $6.14 EXAMPLE · 6 x 3-1/4x.131 nail @ $0.026 each = $0.16 · total $6.30 EXAMPLE' in stud and '$6.30' in stud, stud[:200])
    pier = hover_popup(pg, """() => { const o = __layout.getModel().layers.find(l => l.id === 'foundation').objects.find(o => o.type === 'pier');
        const s = __layout.plan.debug.toScreen(o.geometry.c); const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    PIER_HOVER = 'Concrete pier, 4 ft 6 in · 56 in of 12 in Sonotube = $23.31 · 3.89 cu ft ready-mix concrete (Ø12 in × 4 ft 6 in, +10% waste) = $21.60 est. · 20.0 ft #4 rebar (EXAMPLE) = $14.33 · 2 x wire tie @ $0.098 each = $0.20 · total $59.44 est.'
    check('pier popup (59833): 4 ft 6 in pier, tube/concrete/rebar share + 2 x wire tie @ $0.098 = $0.20, hover total = full pier $59.44 est.', 'Sonotube pier, 4 ft 6 in tall' in pier and PIER_HOVER in pier and re.search(r'Total for this piece\s*\$59\.44', pier), [x for x in pier.split('\n') if x.startswith('Concrete pier')][:1])
    with open(SH + 'inspect-popups-59833.txt', 'w') as fh:
        fh.write('--- stud (plan hover, 20x16 example, ZIP 59833)\n' + stud + '\n--- pier\n' + pier + '\n')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # ---------- no mic / no typed command input
    src = ''.join(open(f).read() for f in glob.glob('js/*.js') + ['index.html'])
    check('no microphone / speech APIs anywhere (no mic)', not re.search(r'SpeechRecognition|getUserMedia|webkitSpeech|speechSynthesis', src))
    check('no console errors', not errs, errs[:3])
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
