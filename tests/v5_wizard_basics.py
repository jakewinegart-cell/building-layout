"""v5 wizard basics: the 24 everyday phrases from the diagnosis, in order, on the 32×24 sample.
Mode 'replay' (default) answers proxy calls with the REAL llama-4-scout replies recorded from the live proxy
before the fix (tests/fixtures/v5_live_before.json: invented slot names, text-only tool calls, missing answer_draft…);
mode 'offline' fails every proxy call (503) to prove the local rule parser alone does the basics.
Every phrase must produce a visible reply (never silent), and edits must really change the plan after Apply.
   python3 tests/v5_wizard_basics.py [base_url] [replay|offline]"""
import sys, os, json, re
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://127.0.0.1:8850/'
MODE = next((a for a in sys.argv[1:] if a in ('replay', 'offline')), 'replay')
SH = 'screenshots/v5/'; os.makedirs(SH, exist_ok=True)
URL = 'https://building-layout-wizard-proxy.jakewinegart.workers.dev/chat'
REC = json.load(open('tests/fixtures/v5_live_before.json'))
results = []; table = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
cnt = lambda ops, k: ops.split(',').count(k) if ops else 0
kinds = lambda ops, c: sum(1 for x in ops.split(',') if x and x[0] == c)
# phrase → (expected outcome, check(before, after, text, report))
E = [
 ('make it 20 by 16', 'edit', lambda b, a, t, r: a['fp'] == [20, 16]),
 ('make the addition 24 ft wide', 'edit', lambda b, a, t, r: a['fp'][0] == 24),
 ('add a window on the north wall', 'edit', lambda b, a, t, r: cnt(a['ops'], 'w:0') == cnt(b['ops'], 'w:0') + 1),
 ('add a door', 'ask→edit', lambda b, a, t, r: kinds(a['ops'], 'd') == kinds(b['ops'], 'd') + 1),
 ('move the door to the east wall', 'ask→edit', lambda b, a, t, r: cnt(a['ops'], 'd:1') == cnt(b['ops'], 'd:1') + 1),
 ('delete the window', 'ask→edit', lambda b, a, t, r: kinds(a['ops'], 'w') == kinds(b['ops'], 'w') - 1),
 ('make the walls 9 ft', 'edit', lambda b, a, t, r: a['plate'] == 9),
 ('gable roof', 'says already', lambda b, a, t, r: a == b and 'already' in t.lower()),
 ('make the roof steeper', 'edit', lambda b, a, t, r: a['pitch'] > b['pitch']),
 ('add a pier', 'explains + options', lambda b, a, t, r: 'under walls' in t or a['fnd'] != b['fnd']),
 ('piers 6 ft apart', 'edit / already', lambda b, a, t, r: a['fnd'].endswith('sp72') and (a != b or 'already' in t.lower())),
 ('undo', 'undo', lambda b, a, t, r: a != b or 'undone' in t.lower()),
 ('price check', 'opens Price check', lambda b, a, t, r: r),
 ('what does this cost', 'answer', lambda b, a, t, r: '$' in t),
 ('make it a deck', "can't + suggestions", lambda b, a, t, r: a == b and ("can't" in t.lower() or 'can’t' in t.lower())),
 ('shed roof', 'ask→edit', lambda b, a, t, r: a['shape'] == 'shed'),
 ('make it 12x12', 'edit', lambda b, a, t, r: a['fp'] == [12, 12]),
 ('remove the door', 'ask→edit', lambda b, a, t, r: kinds(a['ops'], 'd') == kinds(b['ops'], 'd') - 1),
 ('add a 36 inch door on the south wall', 'edit', lambda b, a, t, r: cnt(a['ops'], 'd:2') == cnt(b['ops'], 'd:2') + 1),
 ('how tall are the walls', 'answer', lambda b, a, t, r: bool(re.search(r"\b9\b|9'|9 ft", t))),
 ('redo', 'redo / nothing to redo', lambda b, a, t, r: len(t) > 3),
 ('make the walls 10 feet tall', 'edit', lambda b, a, t, r: a['plate'] == 10),
 ('change the roof to a 6/12 pitch', 'edit', lambda b, a, t, r: a['pitch'] == 6),
 ('make the overhang 12 inches', 'edit / already', lambda b, a, t, r: a['oh'] == 12 and (a != b or 'already' in t.lower())),
]
SHOTS = {'make it 20 by 16': 'wizard-edit-1-resize.png', 'add a window on the north wall': 'wizard-edit-2-window.png', 'make the walls 9 ft': 'wizard-edit-3-walls.png'}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}); ctx.add_init_script("window.__SKIP_SIZE_POPUP = true;")
    pg = ctx.new_page(); errs = []; calls = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)  # recorded 502s are expected network noise; pg.on('dialog', lambda d: d.accept())
    def handler(route):
        req = route.request; h = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST'})
        last = json.loads(req.post_data or '{}')['messages'][-1]['content']; calls.append(last)
        rec = REC.get(last) if MODE == 'replay' else None
        if rec: return route.fulfill(status=rec[0]['status'], headers=h, body=rec[0]['body'])
        route.fulfill(status=503, headers=h, body='{"error":"busy"}')
    pg.route(URL, handler)
    pg.goto(BASE); pg.wait_for_timeout(300); pg.evaluate("localStorage.clear(); sessionStorage.clear()"); pg.reload(); pg.wait_for_timeout(1300)
    try: pg.click('#zipModal #zmSkip', timeout=2500); pg.wait_for_timeout(300)
    except Exception: pass
    pg.click('#wizardBtn'); pg.wait_for_timeout(300)
    def state():
        return pg.evaluate("""() => { const m = window.__layout.getModel(); const L = (id) => m.layers.find(l => l.id === id); const xs = m.footprint.map(p => p[0]), ys = m.footprint.map(p => p[1]); const R = L('roof').params;
          return { fp: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], plate: L('walls').params.plateHeightFt, shape: R.shape, pitch: R.pitch, oh: R.overhangIn,
            ops: L('walls').objects.filter(o => o.type === 'opening').map(o => o.props.kind[0] + ':' + o.geometry.wallId.slice(-1)).join(','), fnd: L('foundation').params.type + ' sp' + L('foundation').params.pierSpacingIn }; }""")
    nbots = lambda: pg.evaluate("() => document.querySelectorAll('#wzLog .wz-msg.bot').length")
    def wait_reply(n0):
        try: pg.wait_for_function(f"() => document.querySelectorAll('#wzLog .wz-msg.bot').length > {n0} && !document.querySelector('#wzLog .wz-dots')", timeout=12000)
        except Exception: pass
        pg.wait_for_timeout(350)
    def apply_preview(shot=None):
        if not pg.evaluate("() => !!document.querySelector('#wzPreview')"): return None
        try: pg.wait_for_function("() => { const c = document.querySelector('#wzPreview #wzCost'); return c && !/working/.test(c.innerText); }", timeout=8000)
        except Exception: pass
        if shot: pg.screenshot(path=SH + shot)
        if pg.is_disabled('#wzApply'): return 'blocked'
        pg.click('#wzApply'); pg.wait_for_timeout(500); return 'applied'
    for i, (ph, kind, ok) in enumerate(E, 1):
        bf = state(); n0 = nbots(); c0 = len(calls); e0 = len(errs)
        pg.fill('#wzInput', ph); pg.press('#wzInput', 'Enter'); wait_reply(n0)
        texts = pg.evaluate(f"() => [...document.querySelectorAll('#wzLog .wz-msg.bot')].slice({n0}).map(x => x.innerText.replace(/\\s+/g, ' '))")
        steps = []
        res = apply_preview(SHOTS.get(ph))
        if res: steps.append('preview→' + res)
        elif kind.startswith('ask') and pg.locator('#wzLog .wz-msg.bot:last-child .wz-chip').count():
            chip = pg.locator('#wzLog .wz-msg.bot:last-child .wz-chip').first; ct = chip.inner_text(); n1 = nbots(); chip.click(); wait_reply(n1)
            steps.append(f'chip "{ct}"'); res = apply_preview()
            if res: steps.append('preview→' + res)
            texts += pg.evaluate(f"() => [...document.querySelectorAll('#wzLog .wz-msg.bot')].slice({n1}).map(x => x.innerText.replace(/\\s+/g, ' '))")
        rep = pg.evaluate("() => !document.querySelector('#report').hidden")
        if rep: pg.evaluate("() => window.__layout.closeReport()"); pg.wait_for_timeout(300)
        af = state(); t = ' '.join(texts)
        good = ok(bf, af, t, rep)
        check(f'W{i:02d} "{ph}" → {kind}', good and t.strip() and not errs[e0:], (steps, t[:160], errs[e0:][:1]) if not good else '')
        check(f'W{i:02d}b never silent', len(t.strip()) > 3)
        table.append({'n': i, 'phrase': ph, 'ok': bool(good), 'ai_calls': len(calls) - c0, 'steps': steps, 'reply': t[:200]})
    pg.screenshot(path=SH + f'wizard-basics-{MODE}.png')
    check('W25 no console errors', not errs, errs[:3])
    b.close()
json.dump(table, open(f'/tmp/v5_wizard_{MODE}.json', 'w'), indent=1)
print('AI calls:', sum(r['ai_calls'] for r in table), '· phrases OK:', sum(r['ok'] for r in table), '/', len(table))
n = sum(1 for r in results if r[1]); print(f'\n{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
