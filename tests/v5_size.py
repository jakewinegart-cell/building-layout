"""v5 'Size of your build' pop-up: shows after the ZIP pop-up on first run, presets + ft/in custom, wall height,
attached side, roof, Piers only, exact footprint; Start new plan…; footprint Resize; never blocks a share link; phone fit.
   python3 tests/v5_size.py [base_url]"""
import sys, os, re
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v5/'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
M = 'window.__layout.getModel()'
def st(pg): return pg.evaluate(f"""(() => {{ const m = {M}; const L = (id) => m.layers.find(l => l.id === id); const xs = m.footprint.map(p => p[0]), ys = m.footprint.map(p => p[1]);
  return {{ w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), n: m.footprint.length, wall: L('walls').params.plateHeightFt, ftype: L('foundation').params.type,
    roof: L('roof').params.shape, pitch: L('roof').params.pitch, shed: L('roof').params.shed || null, attach: m.attachToExistingWallId || null,
    house: L('site').objects.filter(o => o.props && o.props.label === 'House').length, ops: L('walls').objects.filter(o => o.type === 'opening').map(o => o.props.kind + '@' + o.geometry.wallId),
    zip: (m.site || {{}}).zip || null, frost: L('foundation').params.frostDepthIn, piers: L('foundation').objects.filter(o => o.type === 'pier').length }}; }})()""")
def first_run(pg):
    pg.goto(BASE); pg.wait_for_timeout(200); pg.evaluate("localStorage.clear(); sessionStorage.clear()"); pg.reload(); pg.wait_for_selector('#zipModal:not([hidden])', timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('dialog', lambda d: d.accept())
    # S1 order: ZIP first, size pop-up only after it
    first_run(pg)
    check('S1 ZIP pop-up first, size pop-up not yet', pg.locator('#sizeModal:not([hidden])').count() == 0)
    pg.fill('#zmZip', '59833'); pg.click('#zmContinue'); pg.wait_for_selector('#zmUse', timeout=8000); pg.click('#zmUse')
    pg.wait_for_selector('#sizeModal:not([hidden])', timeout=5000)
    txt = pg.inner_text('#sizeModal')
    check('S2 size pop-up opens right after the ZIP pop-up', 'Size of your build' in txt)
    check('S3 copy: type, presets, wall heights, side, roof, piers', all(k in txt for k in ['Addition attached to the house', 'Freestanding', '12×12', '16×20', '20×16', '24×24', 'Custom', '8 ft', '9 ft', '10 ft', 'Which side of the house', 'Roof (optional)', 'Piers only']), txt[:200])
    pg.screenshot(path=SH + 'size-popup-desktop.png')
    # S4 preset 16×20, 9 ft walls, attached at back, default roof → exact plan
    pg.click('[data-preset="16x20"]'); pg.click('[data-wall="9"]'); pg.check('input[name=szSide][value=back]')
    pg.click('#szCreate'); pg.wait_for_timeout(700)
    s = st(pg)
    check('S4 16×20 exact footprint', (s['w'], s['d'], s['n']) == (16, 20, 4), s)
    check('S5 9 ft walls, Piers only, gable 4/12', s['wall'] == 9 and s['ftype'] == 'piersOnly' and s['roof'] == 'gable' and s['pitch'] == 4, s)
    check('S6 attached at back: house drawn on south wall, door opposite (north)', s['attach'] == 'w-ext-2' and s['house'] == 1 and 'door@w-ext-0' in s['ops'], s)
    check('S7 ZIP values kept (59833 frost)', s['zip'] == '59833' and s['frost'] and s['frost'] > 0, s)
    check('S8 piers generated for the new size', s['piers'] >= 4, s['piers'])
    check('S9 plan named after the size', pg.evaluate("window.__layout.plans.current().name") == '16×20 addition')
    check('S10 sample openings gone (1 door + 1 window)', sorted(o.split('@')[0] for o in s['ops']) == ['door', 'window'], s['ops'])
    # S11 reload: no pop-ups again, plan kept
    pg.reload(); pg.wait_for_timeout(1200)
    check('S11 reload: no size pop-up, 16×20 kept', pg.locator('#sizeModal:not([hidden])').count() == 0 and pg.locator('#zipModal:not([hidden])').count() == 0 and st(pg)['w'] == 16)
    # S12 Start new plan… custom ft/in freestanding, shed 2/12, 10 ft
    pg.click('#menuBtn'); pg.click('[data-menu="newplan"]'); pg.wait_for_selector('#sizeModal:not([hidden])', timeout=4000)
    pg.check('input[name=szType][value=free]')
    check('S12 freestanding hides the house-side question', pg.locator('#szSideBox').is_hidden())
    pg.click('[data-preset="custom"]'); pg.fill('#szWFt', '14'); pg.fill('#szWIn', '6'); pg.fill('#szDFt', '10'); pg.fill('#szDIn', '0')
    pg.click('[data-wall="10"]'); pg.locator('.sz-more summary').click(); pg.select_option('#szRoof', 'shed'); pg.select_option('#szPitch', '2')
    pg.click('#szCreate'); pg.wait_for_timeout(700); s = st(pg)
    check('S13 custom 14 ft 6 in × 10 ft exact', abs(s['w'] - 14.5) < 1e-6 and s['d'] == 10, s)
    check('S14 freestanding: no house, door on south', s['attach'] is None and s['house'] == 0 and 'door@w-ext-2' in s['ops'], s)
    check('S15 10 ft walls, shed 2/12', s['wall'] == 10 and s['roof'] == 'shed' and s['shed'] and abs(s['shed']['highPlateFt'] - (10 + 2 * 10 / 12)) < 0.01, s)
    check('S16 two plans saved', len([x for x in pg.evaluate("window.__layout.plans.list()") if x['model']]) == 2)
    # S17 validation
    pg.click('#menuBtn'); pg.click('[data-menu="newplan"]'); pg.wait_for_selector('#sizeModal:not([hidden])', timeout=4000)
    pg.fill('#szWFt', '2'); pg.wait_for_timeout(100)
    check('S17 too small → error + Create disabled', pg.locator('#szErr').is_visible() and pg.locator('#szCreate').is_disabled())
    pg.click('[data-preset="12x12"]'); check('S18 preset fixes it', not pg.locator('#szCreate').is_disabled())
    # S19 'Keep the sample plan' on New plan → sample 32×24
    pg.click('#szSkip'); pg.wait_for_timeout(500); s = st(pg)
    check('S19 skip on New plan → 32×24 sample, location kept', (s['w'], s['d']) == (32, 24) and s['frost'] == 36, s)
    # S20 Resize button: width/depth only, clamps openings, undoable
    pg.click('#resizeBtn'); pg.wait_for_selector('#sizeModal:not([hidden])', timeout=4000)
    check('S20 Resize shows current size, no type/roof questions', pg.input_value('#szWFt') == '32' and pg.input_value('#szDFt') == '24' and pg.locator('input[name=szType]').count() == 0)
    pg.fill('#szWFt', '20'); pg.fill('#szDFt', '12'); pg.click('#szCreate'); pg.wait_for_timeout(600); s = st(pg)
    ok_ops = pg.evaluate(f"""(() => {{ const m = {M}; return m.layers.find(l => l.id === 'walls').objects.filter(o => o.type === 'opening').every(o => {{ const i = +o.geometry.wallId.split('-')[2]; const a = m.footprint[i], c = m.footprint[(i+1)%4]; return o.geometry.t >= 0 && o.geometry.t <= Math.hypot(c[0]-a[0], c[1]-a[1]); }}); }})()""")
    check('S21 resized to 20×12, openings inside walls', (s['w'], s['d']) == (20, 12) and ok_ops, s)
    check('S22 resize undoable', pg.evaluate("window.__layout.history().undo.slice(-1)[0]") == 'resize to 20 × 12')
    pg.evaluate("window.__layout.undo()"); pg.wait_for_timeout(300); check('S23 undo restores 32×24', st(pg)['w'] == 32)
    # S24 share link opens without ZIP / size pop-ups even on a fresh device
    url = pg.evaluate("window.__layout.plans.shareUrl()")
    c2 = b.new_context(viewport={'width': 1280, 'height': 860}); pg2 = c2.new_page(); pg2.goto(url); pg2.wait_for_timeout(1800)
    check('S24 share link on a fresh device: no ZIP/size pop-up, banner shown', pg2.locator('#sizeModal:not([hidden])').count() == 0 and pg2.locator('#zipModal:not([hidden])').count() == 0 and pg2.locator('#shareBanner:not([hidden])').count() == 1)
    c2.close()
    # S25 skip flag
    pg3 = b.new_page(viewport={'width': 1280, 'height': 860}); pg3.goto(BASE); pg3.evaluate("localStorage.clear(); localStorage.setItem('buildingLayout.skipSizePopup','1')"); pg3.reload(); pg3.wait_for_selector('#zipModal:not([hidden])'); pg3.click('#zmSkip'); pg3.wait_for_timeout(500)
    check('S25 skip flag: no size pop-up', pg3.locator('#sizeModal:not([hidden])').count() == 0); pg3.close()
    check('S26 no console errors (desktop)', not errs, errs[:3])
    # S27 phone
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True); ph = ctx.new_page(); perr = []
    ph.on('pageerror', lambda e: perr.append(str(e)))
    first_run(ph); ph.click('#zmSkip'); ph.wait_for_selector('#sizeModal:not([hidden])', timeout=5000)
    box = ph.evaluate("(() => { const r = document.querySelector('#szCard').getBoundingClientRect(); return [r.left, r.right, document.documentElement.scrollWidth]; })()")
    check('S27 phone: card fits the width', box[0] >= 0 and box[1] <= 390 and box[2] <= 390, box)
    ph.screenshot(path=SH + 'size-popup-phone.png')
    ph.tap('[data-preset="12x12"]'); ph.locator('#szCreate').scroll_into_view_if_needed(); ph.tap('#szCreate'); ph.wait_for_timeout(700)
    check('S28 phone: 12×12 created', (st(ph)['w'], st(ph)['d']) == (12, 12))
    check('S29 phone: no errors', not perr, perr[:3])
    b.close()
n = sum(1 for r in results if r[1]); print(f'\n{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
