"""v4 Wizard: typed chat box (no mic), proxy call (MOCKED: CORS only allows the github.io origin), local commands,
preview on a model copy with cost change, Apply / Cancel, 20-step undo/redo, 429/503 messages, wizard-tests.json phrases.
    python3 tests/v4_wizard.py [base_url]"""
import sys, os, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8850/'
SH = 'screenshots/v4/'; os.makedirs(SH, exist_ok=True)
URL = 'https://building-layout-wizard-proxy.jakewinegart.workers.dev/chat'
TESTS = json.load(open('wizard-v1/wizard-tests.json'))['tests']
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail else ''))
M = 'window.__layout.getModel()'
def roofp(pg): return pg.evaluate(f"(() => {{ const p = {M}.layers.find(l => l.id === 'roof').params; return {{ shape: p.shape, pitch: p.pitch, shed: p.shed, covering: p.roofing && p.roofing.covering }}; }})()")
def fndp(pg): return pg.evaluate(f"(() => {M}.layers.find(l => l.id === 'foundation').params)()")
calls = []; replies = {}; status = {'code': 200}
def tool_for(t):
    if t['tool'] == 'propose_edit': return {'name': 'propose_edit', 'arguments': {'edits': [{'intent': t['intent'], 'slots': t['slots']}]}}
    if t['tool'] == 'ask_clarification': c = t.get('clarification') or {}; return {'name': 'ask_clarification', 'arguments': {'intent': t['intent'], 'question': c.get('question', 'Which one?'), 'options': c.get('options', ['A', 'B']), 'slots_so_far': t['slots']}}
    if t['tool'] == 'answer_question': return {'name': 'answer_question', 'arguments': {'intent': t['intent'], 'topic': t['slots'].get('topic', ''), 'answer_draft': 'MOCK ANSWER: ' + t['phrase']}}
    return {'name': 'meta', 'arguments': {'intent': t['intent']}}
def handler(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST'})
    body = json.loads(req.post_data or '{}'); calls.append(body)
    last = body['messages'][-1]['content']
    h = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    if status['code'] != 200: return route.fulfill(status=status['code'], headers=h, body=json.dumps({'error': 'x'}))
    tc = replies.get(last) or {'name': 'answer_question', 'arguments': {'intent': 'ask.value', 'topic': 'x', 'answer_draft': 'MOCK ANSWER'}}
    route.fulfill(status=200, headers=h, body=json.dumps({'tool_call': tc}))
for t in TESTS: replies.setdefault(t['phrase'], tool_for(t))

def fresh(pg):
    pg.goto(BASE); pg.wait_for_timeout(300); pg.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    pg.evaluate("""async () => { const m = await (await fetch('content-v4/reference/example-20x16.model.json', {cache:'no-store'})).json(); localStorage.setItem('buildingLayout.model.v1', JSON.stringify(m)); }""")
    pg.reload(); pg.wait_for_timeout(1200)
    try: pg.wait_for_selector('#zipModal #zmSkip', timeout=2500); pg.click('#zipModal #zmSkip'); pg.wait_for_timeout(250)
    except Exception: pass
def say(pg, text, wait=500):
    pg.fill('#wzInput', text); pg.press('#wzInput', 'Enter'); pg.wait_for_timeout(wait)
def last_bot(pg): return pg.evaluate("() => { const b = [...document.querySelectorAll('#wzLog .wz-msg.bot')]; return b.length ? b[b.length-1].innerText : ''; }")
def preview_on(pg): return pg.evaluate("() => !!document.querySelector('#wzPreview')")
def wait_cost(pg):
    try: pg.wait_for_function("() => { const c = document.querySelector('#wzPreview #wzCost'); return c && !/working/.test(c.innerText); }", timeout=8000)
    except Exception: pass

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: d.accept())
    pg.route(URL, handler)
    fresh(pg)
    # ---- UI
    check('top bar has a visible "Wizard" button', pg.is_visible('#wizardBtn') and 'Wizard' in pg.inner_text('#wizardBtn'))
    pg.click('#wizardBtn'); pg.wait_for_timeout(300)
    check('Wizard opens a panel with a visible typing box + Send', pg.is_visible('#wizard') and pg.is_visible('#wzInput') and pg.is_visible('#wzSend'))
    check('no mic / speech code in the wizard', pg.evaluate("() => !document.querySelector('#wizard [class*=mic], #wizard [id*=mic]')") and 'speech' not in open('js/wizard.js').read().lower() and 'getUserMedia' not in open('js/wizard.js').read())
    pg.screenshot(path=SH + '45-wizard-open.png')
    # ---- price check: local, no AI call
    n = len(calls); say(pg, 'price check', 1500)
    check('"price check" opens Price check locally (no AI call)', len(calls) == n and not pg.is_hidden('#report'))
    pg.evaluate("() => window.__layout.closeReport()"); pg.wait_for_timeout(300)
    # ---- Jake's phrase: local shed parse → ask side → preview → apply
    n = len(calls); say(pg, 'roof 10 ft at one end to 8 ft at the other')
    check('"roof 10 ft at one end to 8 ft at the other" → asks which side is high (chips)', 'high' in last_bot(pg).lower() and pg.locator('#wzLog .wz-chip').count() >= 4, last_bot(pg)[:120])
    pg.locator('#wzLog .wz-chip', has_text='North').last.click(); pg.wait_for_timeout(600); wait_cost(pg)
    check('chip "North" → preview card (not applied)', preview_on(pg) and roofp(pg)['shape'] != 'shed')
    txt = pg.inner_text('#wzPreview')
    check('preview: shed 10\' → 8\' on the north wall, 2:12 over 16 ft... (20×16 → 1.5:12)', '1.5:12' in txt and 'north' in txt.lower(), txt[:160])
    check('preview shows the cost change', 'Cost change' in txt and '$' in txt, pg.inner_text('#wzCost')[:120])
    check('preview runs on a model COPY: Plan/3D show it, real model unchanged', pg.evaluate("() => window.__layout.app.getModel().layers.find(l=>l.id==='roof').params.shape === 'shed' && window.__layout.getModel().layers.find(l=>l.id==='roof').params.shape !== 'shed'"))
    check('1.5:12 with shingles is blocked (V-ROOF-01) → Apply disabled + fix chips', pg.is_disabled('#wzApply') and pg.locator('#wzPreview .wz-chip').count() == 3)
    pg.screenshot(path=SH + '46-wizard-preview.png')
    pg.locator('#wzPreview .wz-chip', has_text='Standing seam').click(); pg.wait_for_timeout(600); wait_cost(pg)
    check('fix chip "Standing seam metal" → new preview, Apply enabled', preview_on(pg) and not pg.is_disabled('#wzApply'))
    pg.click('#wzApply'); pg.wait_for_timeout(600)
    r = roofp(pg)
    check('Apply → shed, high north, 10/8, pitch 1.5, standing seam', r['shape'] == 'shed' and r['shed']['highWallId'] == 'w-ext-0' and abs(r['shed']['highPlateFt'] - 10) < .01 and abs(r['shed']['lowPlateFt'] - 8) < .01 and abs(r['pitch'] - 1.5) < .01 and r['covering'] == 'metal_standing_seam', r)
    check('Jake\'s phrase used no AI call (local parse)', len(calls) == n)
    # ---- undo / redo
    say(pg, 'undo'); check('"undo" restores the gable', roofp(pg)['shape'] == 'gable')
    say(pg, 'redo'); check('"redo" brings the shed back', roofp(pg)['shape'] == 'shed')
    pg.click('#plan'); pg.keyboard.press('Control+z'); pg.wait_for_timeout(400)
    check('Ctrl-Z undoes too', roofp(pg)['shape'] == 'gable')
    # ---- 20-step cap
    pg.evaluate("() => { const m = window.__layout.getModel(); for (let i = 0; i < 25; i++) { m.estimate.deliveryUsd = i + 1; window.__layout.app.commit('site'); } }")
    check('undo history keeps the last 20 steps', len(pg.evaluate("() => window.__layout.history().undo")) == 20)
    # ---- piers only / square piers (local)
    pg.evaluate("() => { const f = window.__layout.getModel().layers.find(l=>l.id==='foundation'); f.params.type = 'crawlspace'; window.__layout.app.commit('foundation'); }")
    n = len(calls); say(pg, 'piers only', 700); wait_cost(pg)
    check('"piers only" → preview (no AI call)', preview_on(pg) and len(calls) == n and 'Piers only' in pg.inner_text('#wzPreview'))
    pg.click('#wzApply'); pg.wait_for_timeout(500)
    check('apply → foundation type piersOnly', fndp(pg)['type'] == 'piersOnly')
    say(pg, 'make the piers square', 700); wait_cost(pg); pg.click('#wzApply'); pg.wait_for_timeout(500)
    check('"make the piers square" → square formed piers', fndp(pg)['pierShape'] == 'square' and fndp(pg)['pierSquareIn'] in (12, 16))
    say(pg, 'cancel')
    # ---- slope phrases
    say(pg, 'make the roof 6:12', 700); wait_cost(pg)
    check('"make the roof 6:12" previews a 6:12 pitch', preview_on(pg) and '6:12' in pg.inner_text('#wzPreview'))
    say(pg, 'cancel', 300); check('"cancel" discards the preview', not preview_on(pg) and abs(roofp(pg)['pitch'] - 4) < .01)
    # ---- 429 / 503 / network
    status['code'] = 429; say(pg, 'what is a sill plate?', 800); check('429 → "try again in a minute"', 'try again in a minute' in last_bot(pg).lower(), last_bot(pg))
    status['code'] = 503; say(pg, 'what is a sill plate?', 800); check('503 → "daily free AI limit reached"', 'daily free ai limit reached' in last_bot(pg).lower(), last_bot(pg))
    status['code'] = 200
    # ---- request shape
    say(pg, 'what pitch is that?', 800)
    bd = calls[-1]
    check('POST body = {messages, summary} with the §2.3 summary keys', isinstance(bd.get('messages'), list) and all(k in bd['summary'] for k in ('footprint', 'walls', 'plateHeightFt', 'roof', 'foundation', 'floor', 'openings')), list(bd.get('summary', {}).keys()))
    check('answer_question shows the answer', 'MOCK ANSWER' in last_bot(pg))
    # ---- wizard-tests.json phrases through the (mocked) AI
    ok = 0; bad = []
    for t in TESTS:
        fresh(pg); pg.click('#wizardBtn'); pg.wait_for_timeout(150)
        if 'existing house' in (t.get('context') or ''): pg.evaluate("() => { const m = window.__layout.getModel(); m.attachToExistingWallId = 'w-ext-0'; window.__layout.app.commit('site'); }")
        say(pg, t['phrase'], 900)
        bot = last_bot(pg); pv = preview_on(pg)
        exp = t['tool']
        good = (exp == 'propose_edit' and (pv or t['id'] in ('T17', 'T23', 'T08'))) or (exp == 'ask_clarification' and pg.locator('#wzLog .wz-chip').count() >= 2) or (exp == 'answer_question' and bool(bot)) or (exp == 'meta' and bool(bot))
        if t['id'] == 'T23': good = 'hip' in bot.lower() and not pv
        if t['id'] == 'T17': good = 'under walls' in bot.lower()
        if t['id'] == 'T08': good = pv or 'pitch' in bot.lower()
        if pv:
            wait_cost(pg)
            if pg.is_disabled('#wzApply'): m = pg.evaluate("() => window.__layout.app.getModel()")  # blocked (e.g. shingles under 2:12): check the preview copy
            else: pg.click('#wzApply'); pg.wait_for_timeout(400); m = pg.evaluate(f"() => {M}")
            if t['id'] == 'T03': r = [l for l in m['layers'] if l['id'] == 'roof'][0]['params']; good = good and r['shed']['highWallId'] == 'w-ext-1' and abs(r['pitch'] - 1.2) < .01 and r['shape'] == 'shed'
            if t['id'] == 'T09': good = good and [l for l in m['layers'] if l['id'] == 'walls'][0]['params']['plateHeightFt'] == 9
            if t['id'] == 'T11': good = good and max(x for x, y in m['footprint']) - min(x for x, y in m['footprint']) == 22
            if t['id'] == 'T13': good = good and any(o['type'] == 'opening' and o['geometry']['wallId'] == 'w-ext-3' and o['props']['widthIn'] == 36 for o in [l for l in m['layers'] if l['id'] == 'walls'][0]['objects'])
            if t['id'] == 'T15': good = good and any(o['type'] == 'opening' and o['props']['kind'] == 'door' and o['props']['widthIn'] == 96 for o in [l for l in m['layers'] if l['id'] == 'walls'][0]['objects'])
            if t['id'] == 'T18': good = good and [l for l in m['layers'] if l['id'] == 'foundation'][0]['params']['frostDepthIn'] == 36
            if t['id'] == 'T19': good = good and [l for l in m['layers'] if l['id'] == 'floor'][0]['params']['joistSize'] == '2x12'
            if t['id'] == 'T24': good = good and abs(m['estimate']['taxRatePct'] - 8.81) < .001
        ok += good
        if not good: bad.append((t['id'], bot[:90]))
    check(f'wizard-tests.json: {ok}/{len(TESTS)} phrases handled as expected', ok == len(TESTS), bad)
    # ---- phone: box opens as a bottom sheet
    ph = b.new_page(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True); ph.route(URL, handler)
    ph.goto(BASE); ph.wait_for_timeout(1200)
    try: ph.click('#zipModal #zmSkip', timeout=2000)
    except Exception: pass
    check('phone: Wizard button visible in the top bar', ph.is_visible('#wizardBtn'))
    ph.click('#wizardBtn'); ph.wait_for_timeout(300)
    bx = ph.evaluate("() => { const r = document.querySelector('#wizard').getBoundingClientRect(); return [r.left, r.bottom, r.width, innerWidth, innerHeight]; }")
    check('phone: wizard opens as a bottom sheet with the typing box visible', ph.is_visible('#wzInput') and bx[1] >= bx[4] - 2 and bx[2] >= bx[3] - 2, bx)
    ph.screenshot(path=SH + '45b-wizard-phone.png')
    check('no page errors', not errs, errs[:3])
    b.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed'); sys.exit(1 if fails else 0)
