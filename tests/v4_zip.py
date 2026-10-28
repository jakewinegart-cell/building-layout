"""v4 startup ZIP pop-up tests (content-v4/zip-popup-spec.md): copy + validation, county picker, verified/source
badges, what 'Use these values' writes, pier depth = max(frost + margin, 12), 59833 total $9,017.45 in Price check
and the same ZIP values in the $ inspect popup, unknown-ZIP fallback (48 in + flags), Skip, phone layout.
   python3 tests/v4_zip.py [base_url]"""
import sys, json, re, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from verify import Touch

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v3/'
os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
def money(t): m = re.search(r'\$([0-9,]+\.\d\d)', t or ''); return float(m.group(1).replace(',', '')) if m else None
M = 'window.__layout.getModel()'
def fnd(pg): return pg.evaluate(f"(() => {{ const f = {M}.layers.find(l => l.id === 'foundation'); const ps = f.objects.filter(o => o.type === 'pier'); return {{ p: f.params, site: {M}.site || null, est: {M}.estimate || null, bottoms: [...new Set(ps.map(o => Math.round(-o.z * 12)))], n: ps.length }}; }})()")
def fresh(pg, example=None):
    pg.goto(BASE); pg.wait_for_timeout(300)
    pg.evaluate("(u) => { localStorage.clear(); }")
    if example:
        pg.evaluate("""async (u) => { const m = await (await fetch(u, {cache:'no-store'})).json(); localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""", example)
    pg.reload(); pg.wait_for_timeout(1200)
def run_price_check(pg):
    pg.click('#doneBtn'); pg.wait_for_selector('#pcRun', timeout=15000)
    if pg.locator('.pc-skip[data-skip="beam"]').count(): pg.click('.pc-skip[data-skip="beam"]')
    pg.click('#pcRun'); pg.wait_for_selector('#rpTotal', timeout=20000); pg.wait_for_timeout(400)
    return money(pg.inner_text('#rpTotal'))
def close_report(pg): pg.click('#rpClose'); pg.wait_for_timeout(300)

EX = 'content-v4/reference/example-20x16.model.json'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    # ------------------------------------------------ first launch: modal + copy + validation
    fresh(pg, EX)
    check('first launch (no ZIP) shows the "Where are you building?" modal', pg.is_visible('#zipModal #zmEntry') and 'Where are you building?' in pg.inner_text('#zmTitle'))
    t = pg.inner_text('#zmEntry')
    check('spec copy: code, frost depth, snow-load, sales tax, nearest Home Depot + ZIP caveat', all(x in t for x in ["frost depth (how deep piers must go)", 'snow-load info', 'sales tax', 'nearest Home Depot', "A ZIP isn't a code boundary"]))
    attrs = pg.evaluate("() => { const i = document.querySelector('#zmZip'); return [i.inputMode, i.autocomplete, i.maxLength, i.placeholder]; }")
    check('ZIP field: inputmode numeric, autocomplete postal-code, maxlength 10, placeholder e.g. 59833', attrs == ['numeric', 'postal-code', 10, 'e.g. 59833'], attrs)
    check('Continue disabled while empty; Skip for now present', pg.is_disabled('#zmContinue') and pg.is_visible('#zmSkip'))
    pg.fill('#zmZip', '598'); pg.locator('#zmZip').blur(); pg.wait_for_timeout(100)
    check('invalid ZIP → "Enter a 5-digit ZIP code." and Continue stays disabled', pg.is_visible('#zmErr') and 'Enter a 5-digit ZIP code.' in pg.inner_text('#zmErr') and pg.is_disabled('#zmContinue'))
    pg.fill('#zmZip', '59833-1234'); pg.wait_for_timeout(100)
    check('ZIP+4 accepted (only the first 5 digits are used)', not pg.is_disabled('#zmContinue') and not pg.is_visible('#zmErr'))
    pg.fill('#zmZip', '59833'); pg.wait_for_timeout(100)
    pg.screenshot(path=SH + '27-zip-popup-desktop.png')
    pg.click('#zmContinue'); pg.wait_for_selector('#zmResult')
    r = pg.inner_text('#zmResult')
    check('result card rows: place, county, code, permit, frost, snow, ice, tax, store, call first',
          all(pg.locator(f'#zmResult [data-row="{k}"]').count() == 1 for k in ['place', 'county', 'code', 'permit', 'frost', 'snow', 'ice', 'tax', 'store', 'call']))
    check('59833 values: Florence CDP, Ravalli County, 2024 IRC eff. 2026-09-26, permit not required, 36 in frost, 0% tax, Missoula #3102, (406) 841-2056',
          all(x in r for x in ['Florence', 'unincorporated CDP', 'Ravalli County', '2024 IRC', '2026-09-26', 'Not required', '36 in', '0%', 'Missoula #3102', '(406) 841-2056', 'NOT localized']), r[:300])
    check('county picker shown (ZIP crosses 2 jurisdictions), Ravalli default checked', pg.locator('input[name=zmJur]').count() == 2 and pg.is_checked('input[name=zmJur][value="mt-state-ravalli-unincorporated"]'))
    check('every row has a source link', pg.locator('#zmResult .zm-row[data-row] .zm-src').count() >= 9)
    check('verified badges + snow load UNVERIFIED badge', pg.locator('#zmResult [data-row="frost"] .zm-badge.ok').count() == 1 and pg.locator('#zmResult [data-row="tax"] .zm-badge.ok').count() == 1 and pg.locator('#zmResult [data-row="snow"] .zm-badge.bad').count() == 1)
    check('footer: checked date + "your building official has the final say"', '2026-10-28' in pg.inner_text('#zmFoot') and 'your building official has the final say' in pg.inner_text('#zmFoot'))
    check('buttons: Use these values · Edit · Back', all(pg.is_visible(s) for s in ['#zmUse', '#zmEdit', '#zmBack']))
    pg.screenshot(path=SH + '28-zip-result-59833-desktop.png', full_page=True)
    # county switch updates jurisdiction-specific rows
    pg.check('input[name=zmJur][value="missoula-county"]'); pg.wait_for_timeout(150)
    check('picking Missoula County updates the rows (Missoula County authority)', 'Missoula' in pg.inner_text('#zmResult [data-row="code"]') or 'Missoula' in pg.inner_text('#zmResult [data-row="call"]'))
    pg.check('input[name=zmJur][value="mt-state-ravalli-unincorporated"]'); pg.wait_for_timeout(150)
    # Edit → shallower warning
    pg.click('#zmEdit'); pg.wait_for_selector('#zmFrostIn')
    pg.fill('#zmFrostIn', '30'); pg.wait_for_timeout(100)
    check('Edit: frost shallower than published → warning', pg.is_visible('#zmFrostWarn') and "That's shallower than the 36 in published" in pg.inner_text('#zmFrostWarn'))
    pg.fill('#zmFrostIn', '36'); pg.wait_for_timeout(100)
    pg.click('#zmUse'); pg.wait_for_timeout(800)
    check('modal closes after Use these values', not pg.is_visible('#zipModal'))
    f = fnd(pg)
    s = f['site'] or {}
    check('writes m.site {zip, jurisdictionId, lookupVersion, confirmedAt, frostSource lookup, taxSource lookup}',
          s.get('zip') == '59833' and s.get('jurisdictionId') == 'mt-state-ravalli-unincorporated' and s.get('lookupVersion') and s.get('confirmedAt') and s.get('frostSource') == 'lookup' and s.get('taxSource') == 'lookup', s)
    check('writes frostDepthIn 36, taxRatePct null (= use lookup), iceBarrier true, store label', f['p']['frostDepthIn'] == 36 and f['est'].get('taxRatePct') is None and f['est'].get('iceBarrier') is True and 'Missoula #3102' in (f['est'].get('storeLabel') or ''), (f['p']['frostDepthIn'], f['est']))
    check('piers regenerated: bottom 36 in below grade (= max(36 + 0, 12))', f['bottoms'] == [36] and f['n'] == 14, f['bottoms'])
    check('no frost-unknown flag on the foundation layer', pg.locator('#frostFlag').count() == 0)
    check('layer panel shows the location line', 'ZIP 59833' in pg.inner_text('#locLine'))
    # ------------------------------------------------ Price check with the ZIP values
    tot = run_price_check(pg)
    check('Price check 20x16 @ 59833 = $9,017.45', abs((tot or 0) - 9017.45) < 0.005, tot)
    rows = pg.inner_text('#rpBreak')
    check('materials $8,197.68 · tax $0.00 @ 0% (zip 59833 lookup) · contingency $819.77', all(x in rows for x in ['$8,197.68', '$0.00', '$819.77', 'zip 59833 lookup']), rows[-300:])
    check('no Denver default anywhere in the report', 'Denver store' not in pg.inner_text('#report') and '9.15' not in pg.inner_text('#report'))
    check('frost card: 36 in from the zip lookup, no placeholder', '36 in' in pg.inner_text('#rpFrost') and pg.locator('#rpFrost[data-skipped]').count() == 0)
    check('engine flags: snow load UNVERIFIED + multi-jurisdiction', 'snow load' in pg.inner_text('#rp-check') and 'more than one code jurisdiction' in pg.inner_text('#rp-check'))
    check('disclaimer names the nearest store (not localized)', 'Missoula #3102' in pg.inner_text('#rpDiscText'))
    pg.evaluate("() => { const r = document.getElementById('report'); r.scrollTop = 0; }"); pg.wait_for_timeout(150)
    pg.screenshot(path=SH + '30-zip-59833-price-check.png')
    close_report(pg)
    # ------------------------------------------------ $ inspect uses the same ZIP values
    pg.click('#inspectBtn'); pg.wait_for_timeout(300)
    c = pg.evaluate("""() => { const o = __layout.getModel().layers.find(l => l.id === 'foundation').objects.find(o => o.type === 'pier');
        const s = __layout.plan.debug.toScreen(o.geometry.c); const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    if c:
        pg.mouse.move(c[0], c[1]); pg.wait_for_timeout(900)
    txt = pg.evaluate("() => { const p = document.querySelector('#inspectPop'); return p && !p.hidden ? p.innerText : ''; }")
    check('$ pier popup: 4 ft 6 in pier (36 in below grade + 18 in), frost 36 in from zip lookup, tax 0% (zip 59833 lookup)', 'Sonotube pier, 4 ft 6 in tall' in txt and 'frost 36 in' in txt and 'zip 59833 lookup' in txt, txt[:400])
    with open(SH + 'inspect-pier-59833.txt', 'w') as fh: fh.write(txt)
    pg.screenshot(path=SH + '31-inspect-pier-59833.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # ------------------------------------------------ reload: no modal (ZIP set), Location reachable from the menu
    pg.reload(); pg.wait_for_timeout(1300)
    check('later launch with a ZIP: no modal', not pg.is_visible('#zipModal'))
    pg.click('#menuBtn'); pg.click('#menu [data-menu="zip"]'); pg.wait_for_selector('#zmZip')
    check('Location (ZIP) reachable from the menu, prefilled', pg.input_value('#zmZip') == '59833')
    # ------------------------------------------------ unknown ZIP fallback
    pg.fill('#zmZip', '10001'); pg.click('#zmContinue'); pg.wait_for_selector('#zmUnknown')
    u = pg.inner_text('#zmUnknown')
    check('unknown ZIP → "We don\'t have local data for 10001 yet." + frost/tax helpers + call your building department',
          "We don't have local data for 10001 yet." in u and 'Ask your city or county building department' in u and 'combined state + local rate' in u and 'Call your building department' in u and pg.locator('#zmUnknown a[href*="10001%20building%20department"]').count() == 1)
    pg.screenshot(path=SH + '32-zip-unknown-fallback.png')
    pg.click('#zmUseU'); pg.wait_for_timeout(800)
    f = fnd(pg); s = f['site']
    check('unknown + blanks → frost null, frostSource fallback, taxSource unknown, ZIP kept', s['zip'] == '10001' and f['p']['frostDepthIn'] is None and s['frostSource'] == 'fallback' and s['taxSource'] == 'unknown', s)
    check('unknown → piers drawn at the conservative 48 in (not 24)', f['bottoms'] == [48], f['bottoms'])
    check('red frost banner on the foundation layer', pg.is_visible('#frostFlag') and 'Piers drawn at 48 in as a conservative placeholder' in pg.inner_text('#frostFlag'))
    pg.screenshot(path=SH + '33-unknown-zip-layer-flag.png')
    tot_u = run_price_check(pg)
    check('report: frost unknown placeholder flag (48 in) + tax unknown flag (0%)', '48 in' in pg.inner_text('#rpFrost') and pg.locator('#rpFlagTax[data-skipped="tax"]').count() == 1 and 'rate unknown' in pg.inner_text('#rpTaxRow'), tot_u)
    close_report(pg)
    # entered values on an unknown ZIP; 12 in minimum
    pg.evaluate("() => __layout.zipModal.open()"); pg.wait_for_selector('#zmZip')
    pg.fill('#zmZip', '10001'); pg.click('#zmContinue'); pg.wait_for_selector('#zmUFrost')
    pg.fill('#zmUFrost', '6'); pg.fill('#zmUTax', '8.875'); pg.click('#zmUseU'); pg.wait_for_timeout(800)
    f = fnd(pg)
    check('user frost 6 in → piers 12 in deep (IRC R403.1.4 minimum), sources = user', f['bottoms'] == [12] and f['site']['frostSource'] == 'user' and f['site']['taxSource'] == 'user', (f['bottoms'], f['site']))
    tot_t = run_price_check(pg)
    check('user tax 8.875% used and labeled "your rate"', '8.875%' in pg.inner_text('#rpTaxRow') and 'your rate' in pg.inner_text('#rpTaxRow'), pg.inner_text('#rpTaxRow'))
    close_report(pg)
    # ------------------------------------------------ Skip for now
    fresh(pg, EX)
    pg.click('#zmSkip'); pg.wait_for_timeout(700)
    f = fnd(pg)
    check('Skip for now → fallback (48 in, flagged) and asks again next launch', f['bottoms'] == [48] and f['site'].get('skipped') and pg.is_visible('#frostFlag'), f['site'])
    pg.reload(); pg.wait_for_timeout(1300)
    check('skipped → modal shows again on the next launch', pg.is_visible('#zipModal #zmEntry'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc = Skip (modal closes)', not pg.is_visible('#zipModal'))
    check('pre-check card 1 "Location" offers Enter ZIP', (pg.click('#doneBtn'), pg.wait_for_selector('#pcZipBtn'), 'Enter ZIP' in pg.inner_text('#pcZipBtn'))[-1])
    pg.click('#pcZipBtn'); pg.wait_for_selector('#zmZip'); pg.fill('#zmZip', '59833'); pg.click('#zmContinue'); pg.wait_for_selector('#zmUse'); pg.click('#zmUse'); pg.wait_for_timeout(800)
    check('ZIP entered from the pre-check refreshes the card (59833, 0% from ZIP, 36 in)', 'ZIP 59833' in pg.inner_text('#pcLocInfo') and pg.input_value('#pcFrostIn') == '36')
    pg.click('#pcCancel'); pg.wait_for_timeout(200)
    check('no console errors (desktop)', not errs, errs[:3])
    pg.close()

    # ------------------------------------------------ phone
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    fresh(pg, EX)
    check('phone: modal visible and fits the screen', pg.is_visible('#zmEntry') and pg.evaluate("() => { const r = document.querySelector('.zm-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }"))
    pg.fill('#zmZip', '59833')
    pg.screenshot(path=SH + '29-zip-popup-phone.png')
    pg.tap('#zmContinue'); pg.wait_for_selector('#zmResult'); pg.wait_for_timeout(200)
    check('phone: result card scrolls inside the screen, rows stack', pg.evaluate("() => { const c = document.querySelector('.zm-card'); const r = c.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight + 1 && c.scrollHeight > c.clientHeight; }"))
    pg.screenshot(path=SH + '29b-zip-result-phone.png')
    pg.tap('#zmUse'); pg.wait_for_timeout(800)
    check('phone: Use these values applies 59833 (piers 36 in)', fnd(pg)['bottoms'] == [36])
    check('no page errors (phone)', not errs, errs[:3])
    ctx.close()
    b.close()

n = sum(1 for r in results if r[1])
print(f'\nv4 zip: {n}/{len(results)} passed')
sys.exit(0 if n == len(results) else 1)
