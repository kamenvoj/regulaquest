# Připomínky studentů a přehled využívání: student ve čtečce pošle připomínku, čtečka zaznamená čas a co otevřel,
# Studio ukáže připomínku a souhrnný přehled. Spouštět po test_napric.py (potřebuje publikaci a prezentaci).
import time, uuid, psycopg
from playwright.sync_api import sync_playwright
DSN = "host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
SID = str(uuid.UUID(int=3)); ADMIN = str(uuid.UUID(int=1))
c = psycopg.connect(DSN, autocommit=True)
g = c.execute("select id from student_groups order by created_at limit 1").fetchone()
g = g[0] if g else c.execute("insert into student_groups(name) values ('Testovací skupina') returning id").fetchone()[0]
c.execute("insert into auth.users(id, email) values (%s, 'rq-test01@studenti.regulaquest.invalid') on conflict do nothing", (SID,))
c.execute("insert into profiles(user_id, username, role, group_id) values (%s, 'rq-test01', 'student', %s) on conflict (user_id) do update set group_id = excluded.group_id, active = true", (SID, g))
c.execute("truncate feedback, usage_days, usage_content, usage_search restart identity")
c.execute("select set_config('request.jwt.claim.sub', %s, false)", (ADMIN,)); c.execute("set role authenticated")
c.execute("select rq_publish('test využívání')"); c.execute("reset role")
pres = c.execute("select id from presentations order by id limit 1").fetchone()
if pres: c.execute("insert into presentation_groups(presentation_id, group_id, visible_from) values (%s, %s, current_date) on conflict do nothing", (pres[0], g)); c.execute("update presentations set status='ready' where id=%s", (pres[0],))
unit = c.execute("select id from units where label = 'Článek 10' limit 1").fetchone()[0]
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/'); r.fill('#rqUser', 'rq-test01'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.5)
    r.evaluate(f"location.hash = '#/u/{unit}'"); time.sleep(0.5)
    print('tlačítko u ustanovení:', r.locator('.fb-btn').count())
    r.click('.fb-btn'); time.sleep(0.2)
    print('dialog:', r.locator('#fbDlg .fb-target').inner_text())
    r.check('#fbDlg input[value=error]'); r.fill('#fbText', 'V bodě 3 chybí odkaz na přílohu.'); r.click('#fbSend'); time.sleep(0.6)
    print('po odeslání dialog:', r.locator('#fbDlg').count())
    r.screenshot(path='/tmp/v1-reader.png')
    if pres:
        r.evaluate(f"location.hash = '#/prezentace/{pres[0]}'"); time.sleep(1)
        print('tlačítko u snímku:', r.locator('.fb-btn').count())
    r.fill('#search', 'kvantovy laser'); time.sleep(0.5)
    for i in range(4): r.mouse.move(300, 300 + i); time.sleep(4.5)        # aktivita ~18 s (měří se po 15 s)
    r.evaluate('utSearchDone(); utFlush()'); time.sleep(1)               # dávka (jinak se odesílá jednou za minutu)
    print('záznam účtu:', c.execute("select seconds > 0, visits from usage_days where user_id = %s", (SID,)).fetchone())
    print('obsah:', c.execute("select kind, target_id, n from usage_content order by kind").fetchall())
    print('hledání:', c.execute("select query, n, misses from usage_search").fetchall())
    p = b.new_page(viewport={'width': 1440, 'height': 1000}); p.on('pageerror', lambda e: errs.append('S ' + str(e)))
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(2)
    print('nové připomínky v panelu:', p.locator('#navFeedback').inner_text())
    p.click('.nav-item[data-page=feedback]'); time.sleep(0.6)
    print('připomínka:', p.locator('.fb-list .fb-meta').first.inner_text(), '|', p.locator('.fb-msg').first.inner_text())
    print('odkaz:', p.locator('.fb-list a').first.get_attribute('href'))
    p.screenshot(path='/tmp/v2-feedback.png', full_page=True)
    p.click('[data-set=done]'); time.sleep(0.6); print('po vyřešení nové:', p.locator('#navFeedback').inner_text() or '0')
    p.click('.nav-item[data-page=usage]'); time.sleep(1)
    print('dlaždice:', [t.replace('\n', ' ') for t in p.locator('.us-tile').all_inner_texts()])
    print('malá skupina:', p.locator('.notice').count(), '| bez výsledku:', p.locator('.us-card:has-text("bez výsledku") .us-l').all_inner_texts())
    p.screenshot(path='/tmp/v3-usage.png', full_page=True)
print('chyby:', errs or 'žádné')
