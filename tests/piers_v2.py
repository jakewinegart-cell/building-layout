"""Piers v2 (Sonotubes): spacing control, place-pier tool, select/drag/edit, regen + flagging.
Runs on the phone viewport (390x844) with real CDP touch events. Preview server must be up:
   python3 tests/piers_v2.py [base_url]"""
import sys, math, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, 'tests')
from verify import world_to_page, Touch, check, results  # reuse helpers (verify.run only runs under __main__)

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SHOTS = 'screenshots/v2/'
M = 'window.__layout.getModel()'
WALL = 0.22916666666666666           # 2x6 exterior wall centerline inset from the footprint (ft)

PIERS_JS = """() => { const m = window.__layout.getModel(); return m.layers.find(l=>l.id==='foundation').objects
   .filter(o=>o.type==='pier').map(o=>({id:o.id, c:o.geometry.c, auto:!!o.derivedFrom, slot:o.props.autoSlot||null,
     dia:o.props.diaIn, flags:o.props.flags||[], onWall:o.props.onWall||null, topIn:o.props.topIn??null, depthIn:o.props.depthIn??null, h:o.height})); }"""
GAPS_JS = """() => { const m = window.__layout.getModel();
  const walls = m.layers.find(l=>l.id==='walls').objects.filter(o=>o.type==='wall' && (o.props.exterior||o.props.bearing));
  const piers = m.layers.find(l=>l.id==='foundation').objects.filter(o=>o.type==='pier' && o.derivedFrom);
  const d2 = (p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy);t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  return walls.map(w=>{const on=piers.filter(p=>d2(p.geometry.c,w.geometry.a,w.geometry.b)<1e-3).map(p=>Math.hypot(p.geometry.c[0]-w.geometry.a[0],p.geometry.c[1]-w.geometry.a[1])).sort((a,b)=>a-b);
    const g=[];for(let i=1;i<on.length;i++)g.push(on[i]-on[i-1]);return {id:w.id,len:Math.hypot(w.geometry.b[0]-w.geometry.a[0],w.geometry.b[1]-w.geometry.a[1]),gaps:g};}); }"""

def piers(pg): return pg.evaluate(PIERS_JS)
def by_id(pg, pid): return next((p for p in piers(pg) if p['id'] == pid), None)
def sel(pg): return pg.evaluate(f'{M}.selection')
def view(pg): return pg.evaluate('[window.__layout.plan.debug.view.ox, window.__layout.plan.debug.view.oy, window.__layout.plan.debug.view.scale]')

def set_spacing(pg, ft, inch):
    pg.fill('#spFt', str(ft)); pg.dispatch_event('#spFt', 'change'); pg.wait_for_timeout(150)
    pg.fill('#spIn', str(inch)); pg.dispatch_event('#spIn', 'change'); pg.wait_for_timeout(250)

def open_props(pg):
    if not pg.evaluate("document.getElementById('sheet').classList.contains('open')") :
        pg.click('#layersBtn'); pg.wait_for_timeout(300)
    pg.click('.tabs [data-tab="props"]'); pg.wait_for_timeout(150)

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.goto(BASE); pg.wait_for_timeout(1000)
        t = Touch(pg)
        L = 'phone'

        # --- Foundation → piers, spacing control -------------------------------------------------------
        pg.click('#layersBtn'); pg.wait_for_timeout(300)
        pg.click('.lrow[data-layer="foundation"] .name'); pg.wait_for_timeout(150)
        pg.click('.tabs [data-tab="props"]'); pg.wait_for_timeout(150)
        pg.select_option('#layerCard select[data-k="type"]', 'piers'); pg.wait_for_timeout(400)
        g = pg.evaluate(GAPS_JS)
        check(f'{L}: default max 6\'-0" spacing, equal gaps ≤ 6 ft', pg.input_value('#spFt') == '6' and all(max(w['gaps']) <= 6.0001 and max(w['gaps']) - min(w['gaps']) < 1e-6 for w in g), [(w['id'], round(w['gaps'][0], 3), len(w['gaps'])) for w in g])
        n6 = len(piers(pg))
        # exact o.c. 4'-6"
        pg.click('[data-spmode="exact"]'); pg.wait_for_timeout(250)
        set_spacing(pg, 4, 6)
        fp = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').params")
        g = pg.evaluate(GAPS_JS)
        ok = all(all(abs(x - 4.5) < 1e-6 for x in w['gaps'][:-1]) and w['gaps'][-1] <= 4.5 + 2/12 + 1e-6 for w in g)
        check(f'{L}: exact 4\'-6" o.c. re-lays auto piers (only the closing gap differs, ≤ +2")', ok and fp['pierSpacingMode'] == 'exact' and fp['pierSpacingIn'] == 54, [(w['id'], [round(x, 3) for x in w['gaps']][-2:]) for w in g])
        pg.locator('#pierSpacing').scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=SHOTS + 'a-spacing-control-phone.png')
        # max 8'-0"
        pg.click('[data-spmode="max"]'); pg.wait_for_timeout(250)
        set_spacing(pg, 8, 0)
        g = pg.evaluate(GAPS_JS); n8 = len(piers(pg))
        check(f'{L}: max 8\'-0" re-lays fewer, equal gaps ≤ 8 ft', n8 < n6 and all(max(w['gaps']) <= 8.0001 and max(w['gaps']) - min(w['gaps']) < 1e-6 for w in g), f'{n6} → {n8}')
        set_spacing(pg, 6, 0)
        check(f'{L}: back to 6 ft restores the original layout', len(piers(pg)) == n6)
        check(f'{L}: Place pier button arms the tool and drops the sheet', (pg.click('#pierToolBtn') or True) and pg.wait_for_timeout(300) is None
              and pg.evaluate("window.__layout.plan.getTool()") == 'pier'
              and pg.is_visible('#pierOpts'))

        # --- drop with snap (touch) --------------------------------------------------------------------
        t.pinch(world_to_page(pg, 8, 3), 30, 75); pg.wait_for_timeout(200)
        before = {p['id'] for p in piers(pg)}
        a = world_to_page(pg, 8.1, 0.65)                  # near the north wall line, between auto slots
        t.ev('touchStart', [a])
        for i in range(1, 6): t.ev('touchMove', [(a[0] + i, a[1] + i * 0.5)])
        pg.wait_for_timeout(150)
        pg.screenshot(path=SHOTS + 'b-dropping-pier-phone.png')
        t.ev('touchEnd', []); pg.wait_for_timeout(300)
        pg.evaluate('window.__layout.plan.fit()'); pg.wait_for_timeout(150)
        new = [p for p in piers(pg) if p['id'] not in before]
        dp = new[0] if len(new) == 1 else None
        check(f'{L}: touch drop snaps onto the wall line, 6" grid along the wall', dp and not dp['auto'] and abs(dp['c'][1] - WALL) < 1e-6
              and abs(((dp['c'][0] - WALL) / 0.5) - round((dp['c'][0] - WALL) / 0.5)) < 1e-6 and dp['onWall'] == 'w-ext-0' and dp['dia'] == 12, dp)
        check(f'{L}: dropped pier is selected with its edit panel open', dp and sel(pg) == {'layerId': 'foundation', 'objectId': dp['id']} and pg.is_visible('#pierPanel') and 'Manual' in pg.inner_text('#pierPanel'))
        before = {p['id'] for p in piers(pg)}
        pg.click('#pierOpts [data-placedia="16"]'); pg.wait_for_timeout(100)
        t.tap(world_to_page(pg, 16.2, 12.1)); pg.wait_for_timeout(300)
        new = [p for p in piers(pg) if p['id'] not in before]
        gp = new[0] if len(new) == 1 else None
        check(f'{L}: drop in the open snaps to the 6" grid, uses chosen Ø16"', gp and abs(gp['c'][0] - 16) < 1e-6 and abs(gp['c'][1] - 12) < 1e-6 and gp['dia'] == 16 and not gp['onWall'], gp)
        before = {p['id'] for p in piers(pg)}
        t.tap(world_to_page(pg, 16.1, 12.0)); pg.wait_for_timeout(300)
        check(f'{L}: pier tool tap on an existing pier selects it (no duplicate drop)', {p['id'] for p in piers(pg)} == before and sel(pg)['objectId'] == gp['id'])
        pg.click('#pierOpts [data-placedia="12"]')

        # --- select + edit panel -----------------------------------------------------------------------
        pg.click('[data-tool="select"]'); pg.wait_for_timeout(100)
        pg.click('#pierPanel [data-pp="close"]'); pg.wait_for_timeout(100)
        t.tap(world_to_page(pg, *dp['c'])); pg.wait_for_timeout(300)
        check(f'{L}: tap selects a pier in Plan (Select tool)', sel(pg) == {'layerId': 'foundation', 'objectId': dp['id']} and pg.is_visible('#pierPanel'))
        pg.click('#pierPanel [data-dia="10"]'); pg.wait_for_timeout(200)
        pg.fill('#pierPanel [data-xy="x"][data-part="ft"]', '9'); pg.fill('#pierPanel [data-xy="x"][data-part="in"]', '3')
        pg.press('#pierPanel [data-xy="x"][data-part="in"]', 'Enter'); pg.wait_for_timeout(200)
        pg.fill('#pierPanel [data-pk="depthIn"]', '42'); pg.dispatch_event('#pierPanel [data-pk="depthIn"]', 'change'); pg.wait_for_timeout(200)
        e = by_id(pg, dp['id'])
        check(f'{L}: panel edits Ø, exact X (9\'-3") and depth', e and e['dia'] == 10 and abs(e['c'][0] - 9.25) < 1e-6 and abs(e['c'][1] - WALL) < 1e-6 and e['depthIn'] == 42, e)
        pg.screenshot(path=SHOTS + 'c-selected-pier-panel-phone.png')

        # duplicate + delete
        n0 = len(piers(pg)); nm0 = sum(not p['auto'] for p in piers(pg))
        pg.click('#pierPanel [data-pp="dup"]'); pg.wait_for_timeout(250)
        s = sel(pg); d = by_id(pg, s['objectId'])
        check(f'{L}: duplicate adds a manual copy 2 ft along the wall and selects it', sum(not p['auto'] for p in piers(pg)) == nm0 + 1 and d and d['id'] != dp['id'] and not d['auto'] and abs(d['c'][0] - 11.25) < 1e-6 and abs(d['c'][1] - WALL) < 1e-6 and d['dia'] == 10, d)
        pg.click('#pierPanel [data-pp="del"]'); pg.wait_for_timeout(250)
        check(f'{L}: delete removes the copy and closes the panel', len(piers(pg)) == n0 and by_id(pg, d['id']) is None and not pg.is_visible('#pierPanel'))

        # --- drag an auto pier (touch): converts to manual, moves pier not canvas, live dims ----------------
        ap = by_id(pg, 'pa_23_1200') or next(p for p in piers(pg) if p['auto'] and abs(p['c'][0] - WALL) < 1e-6 and 10 < p['c'][1] < 14)
        t.pinch(world_to_page(pg, 3, 13), 30, 75); pg.wait_for_timeout(200)
        v0 = view(pg)
        a = world_to_page(pg, *ap['c']); bpt = world_to_page(pg, ap['c'][0], ap['c'][1] + 2.4)
        t.ev('touchStart', [a])
        for i in range(1, 9): t.ev('touchMove', [(a[0] + (bpt[0] - a[0]) * i / 8, a[1] + (bpt[1] - a[1]) * i / 8)])
        pg.wait_for_timeout(150)
        dragging_panel_hidden = not pg.is_visible('#pierPanel')
        pg.screenshot(path=SHOTS + 'd-drag-live-dims-phone.png')
        t.ev('touchEnd', []); pg.wait_for_timeout(300)
        v1 = view(pg); pg.evaluate('window.__layout.plan.fit()'); pg.wait_for_timeout(150)
        s = sel(pg); cp = by_id(pg, s['objectId'])
        check(f'{L}: touch drag starting on a pier moves the pier, not the canvas', v1 == v0 and cp and abs(cp['c'][1] - (ap['c'][1] + 2.4)) < 0.26 and abs(((23.770833333333332 - cp['c'][1]) / 0.5) % 1) < 1e-6 and abs(cp['c'][0] - WALL) < 1e-6, (v0, v1, cp))
        check(f'{L}: dragging an auto pier converts it to manual (keeps its auto slot)', cp and not cp['auto'] and cp['slot'] and cp['id'] != ap['id'] and by_id(pg, ap['id']) is None and 'Manual' in pg.inner_text('#pierPanel'))
        check(f'{L}: edit panel hides during the drag', dragging_panel_hidden)

        # --- manual piers survive regen ----------------------------------------------------------------
        manual_ids = {p['id'] for p in piers(pg) if not p['auto']}
        open_props(pg); set_spacing(pg, 5, 0)
        after = piers(pg)
        check(f'{L}: spacing change keeps every manual pier (and its edits)', manual_ids <= {p['id'] for p in after} and by_id(pg, dp['id'])['dia'] == 10 and by_id(pg, cp['id'])['c'] == cp['c'])
        check(f'{L}: converted slot is not re-generated under the moved pier', not any(p['auto'] and math.dist(p['c'], cp['c']) < 1 for p in after))
        set_spacing(pg, 6, 0)
        check(f'{L}: restore-auto button counts converted piers', pg.is_visible('#restoreAuto'))
        pg.click('#sheetHandle'); pg.wait_for_timeout(300)

        # --- flagging after a footprint edit ------------------------------------------------------------
        pg.click('[data-tool="pier"]'); pg.wait_for_timeout(100)
        t.tap(world_to_page(pg, 31.6, 9.1)); pg.wait_for_timeout(300)
        ep = by_id(pg, sel(pg)['objectId'])
        check(f'{L}: drop on east wall snaps to it', ep and not ep['auto'] and ep['onWall'] == 'w-ext-1' and abs(ep['c'][0] - (32 - WALL)) < 1e-6, ep)
        pg.click('[data-tool="select"]'); pg.wait_for_timeout(100)
        pg.click('#pierPanel [data-pp="close"]'); pg.wait_for_timeout(100)
        pg.evaluate(f"{M}.activeLayerId = 'walls'")
        t.drag(world_to_page(pg, 31.9, 15.3), world_to_page(pg, 27.9, 15.3)); pg.wait_for_timeout(400)
        fpx = pg.evaluate(f'Math.max(...{M}.footprint.map(p=>p[0]))')
        ep2 = by_id(pg, ep['id'])
        lnote = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').note")
        check(f'{L}: footprint shrink keeps the now-outside pier and flags it', abs(fpx - 28) < 0.01 and ep2 is not None and any('outside' in f for f in ep2['flags']), (fpx, ep2 and ep2['flags']))
        check(f'{L}: off-wall flag too, and layer flag note', ep2 and any('wall' in f for f in ep2['flags']) and 'FLAGGED' in json.dumps(pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation')")), lnote)
        check(f'{L}: in-footprint manual piers are not flagged', all(not by_id(pg, i)['flags'] for i in [dp['id'], cp['id'], gp['id']]))
        pg.evaluate(f"{M}.activeLayerId = 'foundation'")
        t.tap(world_to_page(pg, *ep2['c'])); pg.wait_for_timeout(300)
        check(f'{L}: flagged pier shows its flag in the panel', 'outside' in pg.inner_text('#pierPanel').lower())
        pg.screenshot(path=SHOTS + 'e-flagged-pier-phone.png')
        # moving it back inside clears the flag
        pg.fill('#pierPanel [data-xy="x"][data-part="ft"]', '27'); pg.fill('#pierPanel [data-xy="x"][data-part="in"]', '9.25')
        pg.press('#pierPanel [data-xy="x"][data-part="in"]', 'Enter'); pg.wait_for_timeout(250)
        check(f'{L}: moving a flagged pier back onto the wall clears the flag', not by_id(pg, ep['id'])['flags'], by_id(pg, ep['id']))
        pg.evaluate(f"{M}.activeLayerId = 'walls'")
        pg.click('#pierPanel [data-pp="close"]')
        t.drag(world_to_page(pg, 27.9, 15.3), world_to_page(pg, 31.9, 15.3)); pg.wait_for_timeout(400)
        pg.evaluate(f"{M}.activeLayerId = 'foundation'")

        # --- reset to auto + delete auto + restore ------------------------------------------------------
        t.tap(world_to_page(pg, *cp['c'])); pg.wait_for_timeout(300)
        pg.click('#pierPanel [data-pp="reset"]'); pg.wait_for_timeout(300)
        rs = sel(pg); r = by_id(pg, rs['objectId']) if rs else None
        check(f'{L}: Reset to auto puts the auto pier back at its slot', by_id(pg, cp['id']) is None and r and r['auto'] and math.dist(r['c'], ap['c']) < 1e-6, r)
        na = sum(p['auto'] for p in piers(pg))
        pg.click('#pierPanel [data-pp="del"]'); pg.wait_for_timeout(300)
        pg.evaluate("window.__layout.regenerate('foundation')"); pg.wait_for_timeout(200)
        check(f'{L}: deleting an auto pier keeps it deleted across regen', sum(p['auto'] for p in piers(pg)) == na - 1 and not any(math.dist(p['c'], ap['c']) < 1e-6 for p in piers(pg)))
        open_props(pg); pg.locator('#restoreAuto').scroll_into_view_if_needed()
        pg.click('#restoreAuto'); pg.wait_for_timeout(300)
        check(f'{L}: Restore auto layout brings deleted slots back, keeps hand-placed piers', sum(p['auto'] for p in piers(pg)) == na and all(by_id(pg, i) for i in [dp['id'], gp['id'], ep['id']]))
        pg.click('#sheetHandle'); pg.wait_for_timeout(300)

        # --- persistence ---------------------------------------------------------------------------------
        open_props(pg); pg.click('[data-spmode="exact"]'); pg.wait_for_timeout(200); set_spacing(pg, 5, 6)
        snap = piers(pg)
        pg.reload(); pg.wait_for_timeout(1200)
        fpp = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').params")
        check(f'{L}: piers + spacing persist across reload', fpp['pierSpacingMode'] == 'exact' and fpp['pierSpacingIn'] == 66
              and sorted((p['id'], tuple(round(x, 6) for x in p['c']), p['dia']) for p in piers(pg)) == sorted((p['id'], tuple(round(x, 6) for x in p['c']), p['dia']) for p in snap))
        pg.evaluate(f"(() => {{ {M}.selection = null; }})()")

        # --- 3D: manual vs auto colours, pick, drop ------------------------------------------------------
        pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(1500)
        pg.click('[data-cam="aerial"]'); pg.wait_for_timeout(600)
        pg.screenshot(path=SHOTS + 'f-3d-full-phone.png')
        pg.click('#layersBtn'); pg.wait_for_timeout(300); pg.click('.tabs [data-tab="layers"]')
        pg.click('.lrow[data-layer="foundation"] [data-act="iso"]'); pg.wait_for_timeout(150)
        pg.click('#sheetHandle'); pg.wait_for_timeout(600)
        pg.screenshot(path=SHOTS + 'f-3d-manual-vs-auto-phone.png')
        pos = pg.evaluate(f"window.__layout.v3.screenOf('{gp['id']}')")
        t.tap(tuple(pos)); pg.wait_for_timeout(300)
        check(f'{L}: tap a pier in 3D selects it and opens the pier panel', sel(pg) == {'layerId': 'foundation', 'objectId': gp['id']} and pg.is_visible('#pierPanel'), sel(pg))
        pg.click('#pierPanel [data-pp="close"]')
        pg.click('#pier3dBtn'); pg.wait_for_timeout(100)
        before = {p['id'] for p in piers(pg)}
        gy = pg.evaluate("window.__layout.v3.stats().foundation.y") or 0
        t.tap(tuple(pg.evaluate(f"window.__layout.v3.worldToScreen(22.1, {gy}, 6.2)"))); pg.wait_for_timeout(400)
        new = [p for p in piers(pg) if p['id'] not in before]
        check(f'{L}: 3D drop mode drops a snapped pier where tapped', len(new) == 1 and abs(new[0]['c'][0] - 22) < 1e-6 and abs(new[0]['c'][1] - 6) < 1e-6, new)
        pg.click('#pier3dBtn')
        pg.screenshot(path=SHOTS + 'g-3d-dropped-phone.png')

        check(f'{L}: no console errors', not errs, errs)
        b.close()

if __name__ == '__main__':
    main()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f'\n{passed}/{len(results)} pier checks passed')
    sys.exit(0 if passed == len(results) else 1)
