"""Headless verification for the Building Layout draft. Run with the preview server up:
   python3 tests/verify.py [base_url]"""
import sys, json, math
from playwright.sync_api import sync_playwright

def zip_skip(pg):
    """v4: dismiss the startup ZIP pop-up (Skip for now) so older suites run unchanged."""
    try:
        pg.wait_for_selector('#zipModal #zmSkip', timeout=2500)
        pg.click('#zipModal #zmSkip'); pg.wait_for_timeout(250)
    except Exception:
        pass


BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SHOTS = 'screenshots/'
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))

def world_to_page(pg, x, y):
    return pg.evaluate("""([x,y]) => { const c = document.getElementById('plan').getBoundingClientRect();
        const s = window.__layout.plan.debug.toScreen([x,y]); return [c.left + s[0], c.top + s[1]]; }""", [x, y])

class Touch:
    def __init__(self, pg):
        self.cdp = pg.context.new_cdp_session(pg)
    def ev(self, typ, pts):
        self.cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': p[0], 'y': p[1], 'id': i} for i, p in enumerate(pts)]})
    def drag(self, a, b, steps=8):
        self.ev('touchStart', [a])
        for i in range(1, steps + 1):
            t = i / steps; self.ev('touchMove', [(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)])
        self.ev('touchEnd', [])
    def tap(self, a):
        self.ev('touchStart', [a]); self.ev('touchEnd', [])
    def pinch(self, c, d0, d1, steps=8):
        self.ev('touchStart', [(c[0]-d0, c[1]), (c[0]+d0, c[1])])
        for i in range(1, steps + 1):
            d = d0 + (d1-d0)*i/steps; self.ev('touchMove', [(c[0]-d, c[1]), (c[0]+d, c[1])])
        self.ev('touchEnd', [])

def mdrag(pg, a, b, steps=10):
    pg.mouse.move(*a); pg.mouse.down()
    for i in range(1, steps + 1):
        t = i / steps; pg.mouse.move(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)
    pg.mouse.up()

M = "window.__layout.getModel()"

def run(p, label, vp, phone):
    print(f'\n=== {label} {vp} ===')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if phone else 1, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.goto(BASE); pg.wait_for_timeout(1000)
    zip_skip(pg)
    touch = Touch(pg) if phone else None
    drag = (lambda a, c: touch.drag(a, c)) if phone else (lambda a, c: mdrag(pg, a, c))
    tap = (lambda a: touch.tap(a)) if phone else (lambda a: pg.mouse.click(*a))
    sfx = 'phone' if phone else 'desktop'

    # 1. draw a new footprint (rectangle tool)
    pg.click('[data-tool="rect"]')
    drag(world_to_page(pg, 0, 0), world_to_page(pg, 36, 28))
    pg.wait_for_timeout(300)
    fp = pg.evaluate(f'{M}.footprint')
    check(f'{label}: draw footprint 36x28', abs(fp[1][0] - fp[0][0] - 36) < 0.01 and abs(fp[2][1] - fp[1][1] - 28) < 0.01, fp)

    # 2. edit footprint: drag the east exterior wall out 4 ft (Select tool, Walls active)
    pg.click('[data-tool="select"]')
    pg.evaluate(f"{M}.activeLayerId = 'walls'")
    drag(world_to_page(pg, 35.9, 21), world_to_page(pg, 39.9, 21))
    pg.wait_for_timeout(300)
    fp = pg.evaluate(f'{M}.footprint')
    banner = pg.inner_text('#regenBanner') if pg.is_visible('#regenBanner') else ''
    check(f'{label}: drag east wall +4 ft', abs(max(x for x, _ in fp) - 40) < 0.01, fp)
    check(f'{label}: regen note after wall move', 'Updated from walls' in banner and 'Foundation' in banner and 'Roof' in banner, banner)

    # pinch zoom (phone) / wheel zoom (desktop)
    s0 = pg.evaluate('window.__layout.plan.debug.view.scale')
    c = world_to_page(pg, 20, 14)
    if phone: touch.pinch(c, 40, 90)
    else: pg.mouse.move(*c); pg.mouse.wheel(0, -300)
    pg.wait_for_timeout(200)
    s1 = pg.evaluate('window.__layout.plan.debug.view.scale')
    check(f'{label}: {"pinch" if phone else "wheel"} zoom', s1 > s0 * 1.3, f'{s0:.1f} → {s1:.1f}')
    # touch pan / drag pan
    ox0 = pg.evaluate('window.__layout.plan.debug.view.ox')
    drag(world_to_page(pg, 20, 14), (world_to_page(pg, 20, 14)[0] + 40, world_to_page(pg, 20, 14)[1]))
    ox1 = pg.evaluate('window.__layout.plan.debug.view.ox')
    check(f'{label}: one-finger/drag pan on empty floor', abs(ox1 - ox0 - 40) < 2, f'{ox0:.0f} → {ox1:.0f}')
    pg.evaluate('window.__layout.plan.fit()')

    # 3. select an opening, set active layer = Floor framing, toggle Plan ↔ 3D
    pg.evaluate("""() => { const m = window.__layout.getModel(); m.activeLayerId='walls'; }""")
    win = pg.evaluate(f"{M}.layers.find(l=>l.id==='walls').objects.find(o=>o.id==='op-win1')")
    wl = pg.evaluate(f"(() => {{ const w = {M}.layers.find(l=>l.id==='walls').objects.find(o=>o.id==='{win['geometry']['wallId']}'); return w.geometry; }})()")
    L = math.dist(wl['a'], wl['b']); t = win['geometry']['t'] / L
    pt = (wl['a'][0] + (wl['b'][0]-wl['a'][0])*t, wl['a'][1] + (wl['b'][1]-wl['a'][1])*t)
    tap(world_to_page(pg, *pt)); pg.wait_for_timeout(200)
    sel = pg.evaluate(f'{M}.selection')
    check(f'{label}: tap selects window in plan', sel and sel['objectId'] == 'op-win1', sel)
    # make Floor framing active via the layer panel
    if phone: pg.click('#layersBtn'); pg.wait_for_timeout(300)
    else: pg.click('.tabs [data-tab="layers"]')
    pg.click('.lrow[data-layer="floor"] .name')
    pg.wait_for_timeout(200)
    act = pg.evaluate(f'{M}.activeLayerId')
    check(f'{label}: layer panel sets active layer', act == 'floor', act)
    if phone:
        pg.screenshot(path=SHOTS + 'layer-panel-phone.png')
        pg.click('#sheetHandle'); pg.wait_for_timeout(300)
    else:
        pg.screenshot(path=SHOTS + 'plan-desktop.png')
    if phone: pg.screenshot(path=SHOTS + 'plan-phone.png')
    st_plan = pg.inner_text('#status')
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(1500)
    sel3, act3 = pg.evaluate(f'[{M}.selection, {M}.activeLayerId]')
    st_3d = pg.inner_text('#status')
    check(f'{label}: Plan→3D keeps selection + active layer', sel3 == sel and act3 == 'floor' and 'Floor framing' in st_3d and 'op-win1' in st_3d, st_3d)
    stats = pg.evaluate('window.__layout.v3.stats()')
    check(f'{label}: 3D built all v1 layers', all(k in stats and stats[k]['meshes'] > 0 for k in ['site', 'foundation', 'floor', 'walls', 'roof']), stats)
    pg.screenshot(path=SHOTS + f'3d-{sfx}.png')
    pg.click('#viewToggle [data-view="plan"]'); pg.wait_for_timeout(300)
    selp, actp = pg.evaluate(f'[{M}.selection, {M}.activeLayerId]')
    check(f'{label}: 3D→Plan keeps selection + active layer', selp == sel and actp == 'floor')

    # 3D pick selects the same object in plan
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(600)
    pg.click('[data-cam="top"]'); pg.wait_for_timeout(600)
    target = pg.evaluate("window.__layout.v3.screenOf('ridge')")
    tap(tuple(target)); pg.wait_for_timeout(300)
    sel_pick = pg.evaluate(f'{M}.selection')
    check(f'{label}: click a member in 3D selects it', sel_pick == {'layerId': 'roof', 'objectId': 'ridge'}, sel_pick)
    pg.click('#viewToggle [data-view="plan"]'); pg.wait_for_timeout(300)
    check(f'{label}: 3D pick shows as selection in Plan', 'Ridge' in pg.inner_text('#status') and pg.evaluate(f'{M}.selection') == sel_pick)
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(400)
    pg.click('[data-cam="aerial"]')

    # exploded view
    pg.click('#explodeBtn'); pg.wait_for_timeout(800)
    ys = pg.evaluate('window.__layout.v3.stats()')
    check(f'{label}: exploded spreads layers', ys['roof']['y'] > ys['walls']['y'] > ys['floor']['y'] > ys['foundation']['y'], {k: v['y'] for k, v in ys.items()})
    if not phone: pg.screenshot(path=SHOTS + '3d-exploded-desktop.png')
    else: pg.screenshot(path=SHOTS + '3d-exploded-phone.png')
    pg.click('#explodeBtn'); pg.wait_for_timeout(200)
    pg.click('#viewToggle [data-view="plan"]'); pg.wait_for_timeout(300)

    # 4. layer controls: show/hide, lock, ghost, isolate
    if phone: pg.click('#layersBtn'); pg.wait_for_timeout(300)
    else: pg.click('.tabs [data-tab="layers"]')
    def row_click(lid, act):
        pg.click(f'.lrow[data-layer="{lid}"] [data-act="{act}"]'); pg.wait_for_timeout(120)
    row_click('roof', 'vis'); v = pg.evaluate(f"{M}.layers.find(l=>l.id==='roof').visible")
    check(f'{label}: hide roof', v is False)
    row_click('roof', 'vis'); check(f'{label}: show roof', pg.evaluate(f"{M}.layers.find(l=>l.id==='roof').visible") is True)
    row_click('site', 'ghost'); check(f'{label}: ghost site', pg.evaluate(f"{M}.layers.find(l=>l.id==='site').ghost") is True)
    row_click('site', 'ghost')
    row_click('foundation', 'iso'); check(f'{label}: isolate foundation', pg.evaluate(f'{M}.isolateLayerId') == 'foundation')
    row_click('foundation', 'iso'); check(f'{label}: un-isolate', pg.evaluate(f'{M}.isolateLayerId') is None)
    row_click('walls', 'lock'); check(f'{label}: lock walls', pg.evaluate(f"{M}.layers.find(l=>l.id==='walls').locked") is True)
    pg.click('.lrow[data-layer="walls"] .name'); pg.wait_for_timeout(150)
    if phone: pg.click('#sheetHandle'); pg.wait_for_timeout(300)
    before = pg.evaluate(f'{M}.footprint')
    drag(world_to_page(pg, 39.9, 21), world_to_page(pg, 43.9, 21)); pg.wait_for_timeout(200)
    after = pg.evaluate(f'{M}.footprint')
    check(f'{label}: locked walls block edits', before == after)
    if phone: pg.click('#layersBtn'); pg.wait_for_timeout(300)
    pg.click('.tabs [data-tab="layers"]')
    row_click('walls', 'lock')
    pg.click('.lrow[data-layer="foundation"] .name'); pg.wait_for_timeout(150)

    # 5. foundation → piers (Properties tab, foundation active)
    pg.click('.tabs [data-tab="props"]'); pg.wait_for_timeout(150)
    pg.select_option('#layerCard select[data-k="type"]', 'piers'); pg.wait_for_timeout(400)
    res = pg.evaluate("""() => {
      const m = window.__layout.getModel();
      const walls = m.layers.find(l=>l.id==='walls').objects.filter(o=>o.type==='wall' && (o.props.exterior||o.props.bearing));
      const piers = m.layers.find(l=>l.id==='foundation').objects.filter(o=>o.type==='pier');
      const d2 = (p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy);t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
      const off = piers.map(p=>Math.min(...walls.map(w=>d2(p.geometry.c,w.geometry.a,w.geometry.b))));
      const notes = Object.fromEntries(m.layers.filter(l=>l.note).map(l=>[l.id,l.note.text]));
      // max gap between neighbouring piers along each wall
      let maxGap = 0;
      walls.forEach(w=>{const on=piers.filter(p=>d2(p.geometry.c,w.geometry.a,w.geometry.b)<1e-3).map(p=>Math.hypot(p.geometry.c[0]-w.geometry.a[0],p.geometry.c[1]-w.geometry.a[1])).sort((a,b)=>a-b);for(let i=1;i<on.length;i++)maxGap=Math.max(maxGap,on[i]-on[i-1]);});
      return { n: piers.length, maxOff: Math.max(...off), notes, maxGap };
    }""")
    check(f'{label}: piers only under wall lines', res['n'] > 4 and res['maxOff'] < 1e-3, res)
    check(f'{label}: pier spacing ≤ 6–8 ft', res['maxGap'] <= 8.0001, res['maxGap'])
    banner = pg.inner_text('#regenBanner') if pg.is_visible('#regenBanner') else ''
    check(f'{label}: regen note after piers', 'Updated from foundation' in banner and res['notes'].get('floor') == 'Updated from foundation', banner)
    if phone:
        pg.click('#sheetHandle'); pg.wait_for_timeout(300)
        pg.screenshot(path=SHOTS + 'regen-note-phone.png')
    else:
        pg.screenshot(path=SHOTS + 'regen-note-desktop.png')
        pg.click('.tabs [data-tab="layers"]'); pg.wait_for_timeout(150)
        pg.screenshot(path=SHOTS + 'layer-panel-desktop.png')
    # piers in 3D (exploded)
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(800)
    if not phone:
        pg.click('#explodeBtn'); pg.wait_for_timeout(800)
        pg.screenshot(path=SHOTS + '3d-exploded-piers-desktop.png')
        pg.click('#explodeBtn')

    # persistence
    pg.reload(); pg.wait_for_timeout(1000)
    zip_skip(pg)
    ft = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').params.type")
    check(f'{label}: model persists in localStorage', ft == 'piers' and pg.evaluate(f'{M}.view') == '3d', ft)
    check(f'{label}: no console errors', not errs, errs)
    b.close()

if __name__ == '__main__':
    with sync_playwright() as p:
        run(p, 'phone', {'width': 390, 'height': 844}, True)
        run(p, 'desktop', {'width': 1280, 'height': 800}, False)
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
    sys.exit(1 if fails else 0)
