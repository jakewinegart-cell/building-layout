"""v5 Plans menu: migrate the existing plan, autosave, Save as / Open / Rename / Duplicate / Delete (confirm),
Start new plan, share link (deflate + base64url in the hash, j. fallback), opening a link = read-only copy
with 'Save to my plans' (never overwrites), long-link warning, .json export/import, navigator.share.
   python3 tests/v5_plans.py [base_url]"""
import sys, os, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v5/'; os.makedirs(SH, exist_ok=True)
EX = 'content-v4/reference/example-20x16.model.json'
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
answers = []  # queued prompt / confirm answers
def on_dialog(d):
    a = answers.pop(0) if answers else True
    if a is False: d.dismiss()
    elif d.type == 'prompt': d.accept(a if isinstance(a, str) else d.default_value)
    else: d.accept()
store = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('buildingLayout.plans.v1'))")
names = lambda pg: sorted(x['name'] for x in store(pg)['plans'] if x['model'])
cur = lambda pg: pg.evaluate("window.__layout.plans.current() && window.__layout.plans.current().name")
width = lambda pg: pg.evaluate("(() => { const xs = window.__layout.getModel().footprint.map(p => p[0]); return Math.max(...xs) - Math.min(...xs); })()")
wallh = lambda pg: pg.evaluate("window.__layout.getModel().layers.find(l => l.id === 'walls').params.plateHeightFt")
def set_wall(pg, h): pg.evaluate(f"(() => {{ window.__layout.getModel().layers.find(l => l.id === 'walls').params.plateHeightFt = {h}; window.__layout.app.commit('walls'); }})()"); pg.wait_for_timeout(400)
def panel(pg):
    if not pg.locator('#plansPanel:not([hidden])').count(): pg.click('#plansBtn'); pg.wait_for_selector('#plansPanel:not([hidden])')
def row_act(pg, name, act): pg.locator('.pl-row', has=pg.locator('.pl-name', has_text=name)).first.locator(f'[data-act="{act}"]').click(); pg.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}, accept_downloads=True); ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    ctx.add_init_script("window.__SKIP_SIZE_POPUP = true; window.__shared = []; navigator.share = (d) => { window.__shared.push({ url: d.url || null, files: (d.files || []).length }); return Promise.resolve(); }; navigator.canShare = () => true;")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('dialog', on_dialog)
    # P1 an existing (pre-v5) saved plan becomes "My plan"
    pg.goto(BASE); pg.evaluate("localStorage.clear(); sessionStorage.clear()")
    pg.evaluate("""async (u) => { const m = await (await fetch(u, {cache:'no-store'})).json(); m.site = { zip: '59833', skipped: false }; localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""", EX)
    pg.reload(); pg.wait_for_timeout(1500)
    if pg.locator('#zipModal:not([hidden])').count(): pg.click('#zmSkip'); pg.wait_for_timeout(300)
    s = store(pg)
    check('P1 existing plan migrated into "My plan"', s and len(s['plans']) == 1 and s['plans'][0]['name'] == 'My plan' and width(pg) == 20, s and [x['name'] for x in s['plans']])
    # P2 autosave
    set_wall(pg, 9)
    check('P2 edits autosave into the open plan', [x for x in store(pg)['plans'] if x['name'] == 'My plan'][0]['model']['layers'][3 if False else 0] is not None and json.dumps(store(pg)).count('"plateHeightFt": 9') + json.dumps(store(pg)).count('"plateHeightFt":9') >= 1)
    # P3 panel + Save as
    panel(pg); txt = pg.inner_text('#plansPanel')
    check('P3 panel: actions listed', all(k in txt for k in ['Save as', 'Start new plan', 'Copy share link', 'Share', 'Export .json file', 'Import .json file', 'My plan', 'Open', 'Rename', 'Duplicate', 'Delete']), txt[:160])
    answers.append('Garage idea'); pg.click('[data-act="save"]'); pg.wait_for_timeout(400)
    check('P4 Save as… → named copy, now open', names(pg) == ['Garage idea', 'My plan'] and cur(pg) == 'Garage idea', names(pg))
    set_wall(pg, 10)
    pl = {x['name']: x for x in store(pg)['plans']}
    h = lambda x: [l for l in x['model']['layers'] if l['id'] == 'walls'][0]['params']['plateHeightFt']
    check('P5 autosave goes to the open plan only', h(pl['Garage idea']) == 10 and h(pl['My plan']) == 9)
    # P6 Open
    panel(pg); row_act(pg, 'My plan', 'open')
    check('P6 Open switches the model', cur(pg) == 'My plan' and wallh(pg) == 9 and pg.evaluate("window.__layout.history().undo.length") == 0)
    # P7 Rename, Duplicate
    panel(pg); answers.append('Back addition'); row_act(pg, 'My plan', 'rename')
    check('P7 Rename', 'Back addition' in names(pg) and cur(pg) == 'Back addition', names(pg))
    row_act(pg, 'Garage idea', 'dup'); check('P8 Duplicate', 'Garage idea copy' in names(pg) and len(names(pg)) == 3, names(pg))
    pg.screenshot(path=SH + 'plans-menu.png')
    # P9 Delete with confirm
    answers.append(False); row_act(pg, 'Garage idea copy', 'del'); check('P9 Delete cancelled → kept', 'Garage idea copy' in names(pg))
    answers.append(True); row_act(pg, 'Garage idea copy', 'del'); check('P10 Delete confirmed → gone', names(pg) == ['Back addition', 'Garage idea'], names(pg))
    # P11 Start new plan (size pop-up even with the skip flag, since the user asked)
    pg.click('[data-act="new"]'); pg.wait_for_selector('#sizeModal:not([hidden])', timeout=4000)
    pg.click('[data-preset="12x12"]'); pg.click('#szCreate'); pg.wait_for_timeout(700)
    check('P11 Start new plan… → 12×12 plan saved, others kept', width(pg) == 12 and len(names(pg)) == 3 and cur(pg).startswith('12×12'), names(pg))
    # P12 share link
    panel(pg); pg.click('[data-act="link"]'); pg.wait_for_timeout(600)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check('P12 Copy share link → clipboard, compressed hash', '#plan=z.' in clip and pg.input_value('#plLink') == clip, clip[:80])
    check('P13 link is small (< 8000 chars), no warning', len(clip) < 8000 and pg.locator('#plLongWarn').count() == 0, len(clip))
    pg.click('[data-act="share"]'); pg.wait_for_timeout(400)
    check('P14 Share… uses navigator.share with the link', pg.evaluate("window.__shared.length && window.__shared[0].url && window.__shared[0].url.includes('#plan=z.')"))
    # P15 open the link on another device that has its own plans
    c2 = b.new_context(viewport={'width': 1280, 'height': 860}); c2.add_init_script("window.__SKIP_SIZE_POPUP = true;")
    p2 = c2.new_page(); e2 = []; p2.on('pageerror', lambda e: e2.append(str(e)))
    p2.goto(BASE); p2.evaluate("localStorage.clear()"); p2.reload(); p2.wait_for_timeout(1200)
    if p2.locator('#zipModal:not([hidden])').count(): p2.click('#zmSkip'); p2.wait_for_timeout(300)
    pm = lambda pg: json.dumps([(x['name'], x['model']) for x in store(pg)['plans']], sort_keys=True)
    before = pm(p2)
    p2.goto(clip); p2.wait_for_timeout(1500)
    check('P15 link opens: 12×12 shown with a Save banner', width(p2) == 12 and p2.locator('#shareBanner:not([hidden])').count() == 1 and 'Save to my plans' in p2.inner_text('#shareBanner'))
    set_wall(p2, 11)
    check('P16 shared copy never overwrites saved plans (even after an edit)', pm(p2) == before and p2.evaluate("JSON.parse(localStorage.getItem('buildingLayout.model.v1')).layers.find(l => l.id === 'walls').params.plateHeightFt") != 11)
    p2.screenshot(path=SH + 'share-link-opened.png')
    p2.click('#sbSave'); p2.wait_for_timeout(500)
    s2 = store(p2)
    check('P17 Save to my plans → added as a new plan, hash cleared', len([x for x in s2['plans'] if x['model']]) == 2 and p2.evaluate("location.hash") == '' and p2.locator('#shareBanner:not([hidden])').count() == 0 and wallh(p2) == 11, [x['name'] for x in s2['plans']])
    # P18 Close on a shared link returns to your own plan
    p2.goto(clip); p2.wait_for_timeout(1200); p2.click('#sbClose'); p2.wait_for_timeout(500)
    check('P18 Close → back to my plan, nothing added', len([x for x in store(p2)['plans'] if x['model']]) == 2 and p2.locator('#shareBanner:not([hidden])').count() == 0)
    # P19 uncompressed fallback link + broken link
    j = pg.evaluate("(async () => { const pl = await import('./js/plans.js'); const c = await pl.encodePlan('Plain', window.__layout.getModel(), { noCompress: true }); const d = await pl.decodePlan(c); return [c.slice(0, 2), d.name, d.model.footprint.length]; })()")
    check('P19 j. (no CompressionStream) fallback encodes + decodes', j == ['j.', 'Plain', 4], j)
    p2.goto(BASE + '#plan=z.not-a-plan'); p2.wait_for_timeout(1200)
    check('P20 broken link: message, own plan kept, no crash', not e2 and p2.locator('#shareBanner:not([hidden])').count() == 0 and width(p2) == 12, e2[:2])
    c2.close()
    # P21 long-link warning
    pg.evaluate("""(() => { const m = window.__layout.getModel(); const s = m.layers.find(l => l.id === 'site'); const pts = []; for (let i = 0; i < 900; i++) pts.push([Math.random() * 1000, Math.random() * 1000]); s.objects.push({ id: 'big', type: 'area', geometry: { pts }, props: { role: 'note', label: 'noise' } }); window.__layout.app.commit('site'); })()""")
    panel(pg); pg.click('[data-act="link"]'); pg.wait_for_timeout(600)
    check('P21 long link (> 8000 chars) → warning offers the file', pg.locator('#plLongWarn').is_visible() and 'Export the .json file' in pg.inner_text('#plLongWarn'), len(pg.input_value('#plLink')))
    pg.evaluate("(() => { const s = window.__layout.getModel().layers.find(l => l.id === 'site'); s.objects = s.objects.filter(o => o.id !== 'big'); window.__layout.app.commit('site'); })()")
    # P22 export / import
    panel(pg)
    with pg.expect_download() as dl: pg.locator('.pl-acts [data-act="export"]').click()
    path = dl.value.path(); data = json.load(open(path))
    check('P22 Export .json → plan file', data.get('app') == 'building-layout' and data['model']['footprint'] and dl.value.suggested_filename.endswith('.layout.json'), dl.value.suggested_filename)
    data['name'] = 'From a friend'; data['model']['footprint'] = [[0, 0], [18, 0], [18, 14], [0, 14]]
    fp = '/tmp/friend.layout.json'; json.dump(data, open(fp, 'w'))
    panel(pg); pg.set_input_files('#plFile', fp); pg.wait_for_timeout(800)
    check('P23 Import .json → new plan opened', cur(pg) == 'From a friend' and width(pg) == 18 and len(names(pg)) == 4, names(pg))
    open('/tmp/bad.json', 'w').write('{"hello": 1}'); panel(pg); pg.set_input_files('#plFile', '/tmp/bad.json'); pg.wait_for_timeout(500)
    check('P24 Import of a non-plan file → refused, nothing added', len(names(pg)) == 4 and cur(pg) == 'From a friend')
    # P25 reload keeps the open plan
    pg.reload(); pg.wait_for_timeout(1500)
    check('P25 reload reopens the last plan', cur(pg) == 'From a friend' and width(pg) == 18)
    check('P26 no console errors', not errs, errs[:3])
    # P27 phone: Plans button fits, panel usable
    ph = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True); ph.add_init_script("window.__SKIP_SIZE_POPUP = true;")
    q = ph.new_page(); q.goto(BASE); q.wait_for_timeout(1200)
    if q.locator('#zipModal:not([hidden])').count(): q.click('#zmSkip'); q.wait_for_timeout(300)
    q.tap('#plansBtn'); q.wait_for_selector('#plansPanel:not([hidden])')
    bx = q.evaluate("(() => { const r = document.querySelector('#plCard').getBoundingClientRect(); const t = document.querySelector('#plansBtn').getBoundingClientRect(); return [r.left, r.right, t.right, document.documentElement.scrollWidth]; })()")
    check('P27 phone: Plans button on screen, panel fits', bx[0] >= 0 and bx[1] <= 390 and bx[2] <= 390 and bx[3] <= 390, bx)
    q.screenshot(path=SH + 'plans-menu-phone.png')
    b.close()
n = sum(1 for r in results if r[1]); print(f'\n{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
