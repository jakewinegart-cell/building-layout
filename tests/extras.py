"""Extra smoke checks: L-shaped polygon footprint, interior bearing wall + piers, door, custom layer line, solid walls."""
import sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, 'tests')
from verify import world_to_page, mdrag, check, results, M, BASE

def zip_skip(pg):
    """v4: dismiss the startup ZIP pop-up (Skip for now) so older suites run unchanged."""
    try:
        pg.wait_for_selector('#zipModal #zmSkip', timeout=2500)
        pg.click('#zipModal #zmSkip'); pg.wait_for_timeout(250)
    except Exception:
        pass


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    import _skipsize; _skipsize.patch(b)
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_timeout(800)
    zip_skip(pg)
    pg.click('[data-tool="poly"]')
    for pt in [(0, 0), (30, 0), (30, 16), (18, 16), (18, 26), (0, 26)]:
        pg.mouse.click(*world_to_page(pg, *pt)); pg.wait_for_timeout(60)
    pg.click('#polyDone'); pg.wait_for_timeout(300)
    check('L-shape footprint (6 corners)', len(pg.evaluate(f'{M}.footprint')) == 6)
    check('roof flags non-rectangular', any('Non-rectangular' in f for f in pg.evaluate(f"{M}.layers.find(l=>l.id==='roof').flags")))
    pg.click('[data-tool="wall"]')
    mdrag(pg, world_to_page(pg, 10, 0.5), world_to_page(pg, 10, 25.5)); pg.wait_for_timeout(200)
    iw = pg.evaluate(f"{M}.layers.find(l=>l.id==='walls').objects.filter(o=>o.type==='wall'&&!o.props.exterior).length")
    check('interior wall drawn', iw == 1)
    pg.click('.tabs [data-tab="props"]'); pg.check('#selCard input[data-k="bearing"]'); pg.wait_for_timeout(200)
    pg.click('[data-tool="door"]'); pg.mouse.click(*world_to_page(pg, 10, 8)); pg.wait_for_timeout(200)
    check('door placed on interior wall', pg.evaluate(f"{M}.selection && {M}.layers.find(l=>l.id==='walls').objects.find(o=>o.id==={M}.selection.objectId).props.kind") == 'door')
    pg.evaluate(f"{M}.activeLayerId='foundation'"); pg.click('.tabs [data-tab="layers"]'); pg.click('.lrow[data-layer="foundation"] .name')
    pg.click('.tabs [data-tab="props"]'); pg.select_option('#layerCard select[data-k="type"]', 'piers'); pg.wait_for_timeout(300)
    onInt = pg.evaluate(f"{M}.layers.find(l=>l.id==='foundation').objects.filter(o=>o.type==='pier'&&Math.abs(o.geometry.c[0]-10)<1e-6).length")
    check('piers under the bearing interior wall too', onInt >= 3, onInt)
    pg.click('.tabs [data-tab="layers"]'); pg.click('#presetRow [data-p="Deck"]'); pg.click('#nlAdd'); pg.wait_for_timeout(200)
    pg.click('[data-tool="line"]'); mdrag(pg, world_to_page(pg, 0, 30), world_to_page(pg, 18, 30)); pg.wait_for_timeout(200)
    cl = pg.evaluate(f"{M}.layers.find(l=>l.kind==='custom').objects.length")
    check('custom Deck layer + line', cl == 1)
    order = pg.evaluate(f"Array.from(document.querySelectorAll('.lrow')).map(r=>r.dataset.layer)")
    check('custom layer sorted by z between construction layers', order.index('floor') < [i for i, x in enumerate(order) if x.startswith('L-')][0] < order.index('foundation'), order)
    pg.click('#viewToggle [data-view="3d"]'); pg.wait_for_timeout(1200)
    pg.click('#wallModeBtn'); pg.wait_for_timeout(500)
    check('solid wall mode', pg.evaluate(f'{M}.wallMode') == 'solid')
    pg.screenshot(path='screenshots/extra-lshape-solid-3d.png')
    pg.click('#viewToggle [data-view="plan"]'); pg.wait_for_timeout(300)
    pg.screenshot(path='screenshots/extra-lshape-plan.png')
    check('no console errors (extras)', not errs, errs)
    b.close()
print(f"{sum(r[1] for r in results)}/{len(results)} extra checks passed")
