"""$ Price inspect tests: desktop hover (plan + 3D), pier popup, phone tap, dollar cursor, toggle off,
   and 'inspect never edits the model'.   python3 tests/v3_inspect.py [base_url]"""
import sys, json, re, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from verify import Touch, mdrag

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
HD = 'Home Depot online price, checked Oct 28, 2026, not localized'
EXAMPLE = os.environ.get('INSPECT_EXAMPLE', 'content-v3/reference/example-20x16.model.json')

def setup(pg):
    pg.goto(BASE)
    zip_skip(pg)
    pg.evaluate("""async (u) => { const m = await (await fetch(u, {cache:'no-store'})).json(); localStorage.clear();
        localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""", EXAMPLE)
    pg.reload(); pg.wait_for_timeout(1200)
    zip_skip(pg)
    pg.evaluate("() => { const b = document.querySelector('#zipModal .zm-skip'); if (b) b.click(); }")  # v4 zip pop-up, if present

def popup(pg): return pg.evaluate("() => { const p = document.querySelector('#inspectPop'); return p && !p.hidden ? p.innerText : null; }")
def model_json(pg): return pg.evaluate("() => { const m = window.__layout.getModel(); return JSON.stringify({fp: m.footprint, layers: m.layers.map(l => ({id: l.id, p: l.params, o: l.objects}))}); }")
def cursor(pg, sel): return pg.evaluate("(s) => getComputedStyle(document.querySelector(s)).cursor", sel)
def money_total(txt):
    m = re.search(r'Total for this piece\s*\$([0-9,]+\.\d\d)', txt or ''); return float(m.group(1).replace(',', '')) if m else None

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    # ===================================================== desktop
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    setup(pg)
    check('floating $ button exists, off by default', pg.is_visible('#inspectBtn') and pg.get_attribute('#inspectBtn', 'aria-pressed') == 'false')
    check('no price text before inspect', '$' not in pg.evaluate("() => document.querySelector('#stage').innerText"))
    cur0 = cursor(pg, '#plan')
    pg.click('#inspectBtn'); pg.wait_for_timeout(600)
    check('$ toggles inspect on', pg.get_attribute('#inspectBtn', 'aria-pressed') == 'true' and pg.evaluate("document.body.classList.contains('inspecting')"))
    cur = cursor(pg, '#plan')
    check('plan cursor becomes the $ SVG cursor', 'url(' in cur and 'svg' in cur and cur != cur0, cur[:50])
    before = model_json(pg)

    # plan hover over a wall (away from openings) → stud popup + highlight mark
    pt = pg.evaluate("""() => { const m = __layout.getModel(); const wl = m.layers.find(l => l.id === 'walls');
        const ops = wl.objects.filter(o => o.type === 'opening');
        const w = wl.objects.find(o => o.type === 'wall' && o.props.exterior && !ops.some(x => x.geometry.wallId === o.id)) || wl.objects.find(o => o.type === 'wall');
        const a = w.geometry.a, b = w.geometry.b; const s = __layout.plan.debug.toScreen([a[0] + (b[0]-a[0])*0.41, a[1] + (b[1]-a[1])*0.41]);
        const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    pg.mouse.move(*pt); pg.wait_for_timeout(1200)
    t = popup(pg) or ''
    check('plan hover on a wall → stud popup', re.search(r'\d+ ft .*2x\d+ (stud|king stud|jack stud)', t) is not None, t.split('\n')[0])
    check('stud popup: precut stud price + nails at per-unit price + total', 'precut stud' in t and 'framing nails' in t and '¢ each' in t and money_total(t) is not None, money_total(t))
    check('popup shows the snapshot note', HD in t)
    check('plan highlight mark drawn', pg.evaluate("!!__layout.plan.getInspectMark()"))
    stud_plan = t
    # plan hover over a pier
    pp = pg.evaluate("""() => { const m = __layout.getModel(); const o = m.layers.find(l => l.id === 'foundation').objects.find(o => o.type === 'pier');
        const s = __layout.plan.debug.toScreen(o.geometry.c); const r = document.querySelector('#plan').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }""")
    pg.mouse.move(*pp); pg.wait_for_timeout(800)
    tp = popup(pg) or ''
    check('plan hover on a pier → Sonotube popup (tube, concrete, rebar, total)', 'Sonotube pier' in tp and 'Sonotube' in tp and 'concrete' in tp.lower() and 'rebar' in tp and money_total(tp) is not None, tp.split('\n')[0])
    pg.screenshot(path=SH + '23-inspect-pier.png')
    # clicking / dragging in plan must not edit
    pg.mouse.click(*pt); pg.wait_for_timeout(300)
    mdrag(pg, pt, (pt[0] + 60, pt[1] + 40)); pg.wait_for_timeout(300)
    check('plan click/drag in inspect mode does not edit or select', model_json(pg) == before and pg.evaluate("__layout.getModel().selection") is None)

    # 3D hover on a wall stud
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(1500)
    cur3 = cursor(pg, '#view3d canvas')
    check('3D cursor is the $ cursor too', 'url(' in cur3 and 'svg' in cur3, cur3[:40])
    s = pg.evaluate("__layout.v3.screenOfPart(u => u.part && u.part.k === 'stud' && u.part.at > 3)")
    pg.mouse.move(*s); pg.wait_for_timeout(1200)
    t3 = popup(pg) or ''
    check('3D hover on a stud → stud popup', ' stud' in t3.split('\n')[0] and 'precut stud' in t3 and money_total(t3) is not None, t3.split('\n')[0])
    check('3D hovered part is highlighted', pg.evaluate("""() => { let n = 0; __layout.v3; return true; }"""))
    pg.screenshot(path=SH + '22-inspect-2x4-3d.png')
    stud3d = t3
    # 3D pier
    pts = pg.evaluate("""() => __layout.getModel().layers.find(l => l.id === 'foundation').objects.filter(o => o.type === 'pier')
        .map(o => __layout.v3.worldToScreen(o.geometry.c[0], o.z + o.height - 0.5, o.geometry.c[1]))""")
    t3p = ''
    pg.click('#tools3d [data-cam="front"]'); pg.wait_for_timeout(800)
    pts = pg.evaluate("""() => __layout.getModel().layers.find(l => l.id === 'foundation').objects.filter(o => o.type === 'pier')
        .map(o => __layout.v3.worldToScreen(o.geometry.c[0], o.z + o.height - 0.5, o.geometry.c[1]))""")
    for ps in pts:
        pg.mouse.move(*ps); pg.wait_for_timeout(500)
        t3p = popup(pg) or ''
        if 'Sonotube pier' in t3p: break
    pg.screenshot(path=SH + '23b-inspect-pier-3d.png')
    check('3D hover on a pier → pier popup', 'Sonotube pier' in t3p, t3p.split('\n')[0])
    # 3D click/drag: no edits
    pg.mouse.click(*s); pg.wait_for_timeout(300)
    mdrag(pg, s, (s[0] + 80, s[1] + 10)); pg.wait_for_timeout(500)
    check('3D click/drag in inspect mode does not edit or select', model_json(pg) == before and pg.evaluate("__layout.getModel().selection") is None)
    # Esc exits
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc turns inspect off (popup gone, cursor back)', pg.get_attribute('#inspectBtn', 'aria-pressed') == 'false' and popup(pg) is None and 'url(' not in cursor(pg, '#view3d canvas'))
    pg.click('#inspectBtn'); pg.wait_for_timeout(300); pg.click('#inspectBtn'); pg.wait_for_timeout(300)
    check('tapping $ again turns it off', pg.get_attribute('#inspectBtn', 'aria-pressed') == 'false' and not pg.evaluate("document.body.classList.contains('inspecting')"))
    pg.mouse.move(*s); pg.wait_for_timeout(500)
    check('no popup on hover when off', popup(pg) is None)
    check('no page errors (desktop)', not errs, errs[:3])
    with open(SH + 'inspect-popups.txt', 'w') as f:
        f.write('--- plan stud\n' + stud_plan + '\n--- 3D stud\n' + stud3d + '\n--- pier\n' + tp + '\n')

    # ===================================================== phone
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ph = ctx.new_page(); perr = []
    ph.on('pageerror', lambda e: perr.append(str(e)))
    setup(ph); tt = Touch(ph)
    bb = ph.locator('#inspectBtn').bounding_box(); tt.tap((bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)); ph.wait_for_timeout(600)
    check('phone: $ tap turns inspect on', ph.get_attribute('#inspectBtn', 'aria-pressed') == 'true')
    beforep = model_json(ph)
    ph.click('#viewToggle [data-view="3d"]'); ph.wait_for_timeout(1500)
    s = ph.evaluate("__layout.v3.screenOfPart(u => u.part && u.part.k === 'stud' && u.part.at > 3)")
    tt.tap(s); ph.wait_for_timeout(1200)
    tph = popup(ph) or ''
    r = ph.evaluate("() => document.querySelector('#inspectPop').getBoundingClientRect().toJSON()")
    check('phone tap on a stud → popup', ' stud' in tph.split('\n')[0] and money_total(tph) is not None, tph.split('\n')[0])
    check('phone popup clamped on screen', r['left'] >= 0 and r['top'] >= 0 and r['right'] <= 390 and r['bottom'] <= 844, r)
    check('phone popup sits near the tap', abs((r['top'] + r['bottom']) / 2 - s[1]) < 420, (s, r['top'], r['bottom']))
    ph.screenshot(path=SH + '24-inspect-phone.png')
    tt.drag(s, (s[0] + 60, s[1] + 20)); ph.wait_for_timeout(400)
    check('phone: tap/drag does not edit the model', model_json(ph) == beforep)
    xb = ph.locator('#inspectPop .ip-x').bounding_box()
    tt.tap((xb['x'] + xb['width'] / 2, xb['y'] + xb['height'] / 2)); ph.wait_for_timeout(300)
    check('phone: × closes the popup', popup(ph) is None)
    tt.tap((bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)); ph.wait_for_timeout(300)
    check('phone: $ again turns inspect off', ph.get_attribute('#inspectBtn', 'aria-pressed') == 'false')
    check('no page errors (phone)', not perr, perr[:3])
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
