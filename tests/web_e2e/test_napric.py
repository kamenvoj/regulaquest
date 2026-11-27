# Hledání napříč obsahem, prezentace ve vyhledávači, pojmy ve snímku, Souvisí ve Studiu, upozornění před publikací.
# Spouštět po test_pripady.py, test_odkazy.py a test_prezentace.py.
import time, psycopg
from playwright.sync_api import sync_playwright
DSN = "host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
c = psycopg.connect(DSN, autocommit=True)
pres = c.execute("select id from presentations order by id limit 1").fetchone()[0]
c.execute("update presentations set status='ready' where id=%s", (pres,))
# publikovaný případ s odkazem na neověřenou část → upozornění na stránce Publikování
cs = c.execute("select id from cases where status='published' limit 1").fetchone()[0]
uv = c.execute("select id from units where label = 'Článek 2' limit 1").fetchone()[0]
c.execute("insert into case_links(case_id, unit_id) values (%s, %s) on conflict do nothing", (cs, uv))
c.execute("update units set text_status = 'needs_review' where id = %s", (uv,))   # dočasně neověřená
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append('S ' + str(e)))
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.5)
    unit = c.execute("select id from units where label = 'Článek 10' limit 1").fetchone()[0]
    p.evaluate(f"openUnit('{unit}')"); time.sleep(1.5)
    print('Souvisí:', p.locator('#rqRelBox summary').inner_text().replace('\n', ' '), '| zavřeno:', not p.locator('#rqRelBox').evaluate('d => d.open'))
    p.click('.nav-item[data-page=publish]'); time.sleep(1.5)
    print('info:', p.locator('.pub-info summary').inner_text(), '| upozornění:', p.locator('.pub-warn li').count())
    print('text upozornění:', p.locator('.pub-warn li').all_inner_texts())
    p.screenshot(path='/tmp/n1-publish.png', full_page=True)
    c.execute("update units set text_status = 'verified' where id = %s", (uv,))
    p.reload(); p.wait_for_selector('#page-home'); time.sleep(0.5); p.click('.nav-item[data-page=publish]'); time.sleep(1.2)
    p.on('dialog', lambda d: d.accept()); p.click('#publishBtn'); time.sleep(1.5)
    print('po publikaci upozornění:', p.locator('.pub-warn li').count())
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.8)
    word = r.evaluate("(PR.list[0]?.slides.find(s => (s.text||'').length > 40)?.text || '').split(/\\s+/).find(w => w.length > 6) || ''")
    print('slovo ze snímku:', word)
    r.fill('#search', word); r.press('#search', 'Enter'); time.sleep(0.6)
    print('hledání – sekce:', r.locator('#panelText h2.block-title').all_inner_texts())
    r.fill('#search', 'EUDAMED'); r.press('#search', 'Enter'); time.sleep(0.6)
    print('EUDAMED – sekce:', r.locator('#panelText h2.block-title').all_inner_texts())
    r.screenshot(path='/tmp/n2-search.png', full_page=True)
    r.goto(f'http://127.0.0.1:8765/ctecka/?nahled=pracovni#/najit?q={word}'); time.sleep(0.8)
    print('vyhledávač – sekce:', r.locator('.fresults .sec h2').all_inner_texts())
    r.goto(f'http://127.0.0.1:8765/ctecka/?nahled=pracovni#/prezentace/{pres}'); time.sleep(1.2)
    t = r.locator('#pvStage .rq-term')
    print('pojmy ve snímku:', t.count())
    if t.count(): t.first.click(); time.sleep(0.3); print('definice:', r.locator('#pvTerm .h').inner_text()[:80])
    r.screenshot(path='/tmp/n3-slide.png')
print('chyby:', errs or 'žádné')
