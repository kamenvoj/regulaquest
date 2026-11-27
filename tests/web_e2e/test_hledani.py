"""Najít předpisy a průvodce: nastavení ve Studiu, vyhledávač a průvodce ve čtečce (spouštět po test_anotace.py a test_oblasti.py)."""
import time, psycopg
with psycopg.connect('host=/tmp/pg port=5544 user=postgres dbname=rqe2e', autocommit=True) as c:
    c.execute("delete from guide_questions where prompt like 'Jde o prostředek pro domácí%%'")
from playwright.sync_api import sync_playwright
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    p.click('.nav-item[data-page=guide]'); time.sleep(0.4)
    print('otázek:', p.locator('.gq-list > li').count(), '| skupiny polí:', p.locator('tr[data-g]').count())
    # pole „Koho se týká“ jen pro ZP
    row = p.locator('tr[data-g=role]'); row.locator('summary').click(); row.locator('input[value=zp]').check(); row.locator('summary').click()
    row.locator('[data-gsave]').click(); time.sleep(0.7)
    print('role → oblasti:', p.locator('tr[data-g=role] summary').inner_text())
    # nová otázka
    p.click('#gqNew'); time.sleep(0.2)
    p.fill('#gqPrompt', 'Jde o prostředek pro domácí použití?')
    p.locator('#gqOpts .gq-opt').nth(0).locator('[data-label]').fill('Ano, používá ho pacient doma')
    p.locator('#gqOpts .gq-opt').nth(1).locator('[data-label]').fill('Ne')
    p.click('#gqAddOpt'); p.locator('#gqOpts .gq-opt').nth(2).locator('[data-label]').fill('Nevím')
    o = p.locator('#gqOpts .gq-opt').nth(0); o.locator('[data-pick=ot0] summary').click(); o.locator('input[value=typ_software]').check(); o.locator('[data-pick=ot0] summary').click()
    q = p.locator('[data-pick=qa] summary'); q.click(); p.locator('[data-pick=qa] input[value=zp]').check(); q.click()
    p.screenshot(path='/tmp/h1-edit.png', full_page=True)
    p.click('#gqSave'); time.sleep(0.8)
    print('otázek po přidání:', p.locator('.gq-list > li').count(), '| poslední:', p.locator('.gq-list > li').last.locator('strong').inner_text())
    p.locator('.gq-list > li').last.locator('[data-up]').click(); time.sleep(0.7)
    print('předposlední po posunu:', p.locator('.gq-list > li').nth(4).locator('strong').inner_text())
    p.screenshot(path='/tmp/h2-studio.png', full_page=True)

    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.5)
    print('přehled – rozcestník:', r.locator('.tile[href="#/najit"]').inner_text().replace('\n', ' '))
    r.click('.navb[data-nav=finder]'); time.sleep(0.3)
    print('prázdný:', r.locator('.fresults .empty').count(), '| pole:', r.locator('.ff-h strong').all_inner_texts())
    r.click('[data-f=o][data-k=zp]'); time.sleep(0.3)
    print('po ZP pole:', r.locator('.ff-h strong').all_inner_texts(), '| dok:', r.locator('.fr-list:not(.units) strong').all_inner_texts(), '| proč:', r.locator('.fr-list:not(.units) .fr-why').all_inner_texts())
    r.click('[data-f=s][data-k=role_vyrobce]'); time.sleep(0.3)
    print('ustanovení:', r.locator('.fr-list.units strong').all_inner_texts(), '| adresa:', r.url.split('#')[1])
    r.fill('#frQ', 'zzzneexistuje'); time.sleep(0.6); print('se slovem:', r.locator('.fr-sum span').inner_text())
    r.fill('#frQ', ''); time.sleep(0.6)
    r.screenshot(path='/tmp/h3-finder.png', full_page=True)
    # sdílený odkaz otevře stejný výběr
    url = r.url; r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni#/'); time.sleep(0.4); r.goto(url); time.sleep(0.6)
    print('odkaz obnoví výběr:', r.locator('.chipb.on').all_inner_texts())
    # průvodce
    r.click('.fr-guide a[href="#/pruvodce"]'); time.sleep(0.3)
    seen = []
    for _ in range(12):
        if not r.locator('.g-opt').count(): break
        seen.append(r.locator('.guide h1').inner_text())
        multi = r.locator('.g-opts.multi').count()
        r.locator('.g-opt').first.click(); time.sleep(0.15)
        if multi: r.click('#gNext'); time.sleep(0.15)
        if len(seen) == 2: r.screenshot(path='/tmp/h4-guide.png', full_page=True)
    print('otázky průvodce:', seen)
    time.sleep(0.4)
    print('po průvodci:', r.url.split('#')[1], '| banner:', r.locator('.fr-guide').inner_text()[:40], '| ustanovení:', r.locator('.fr-list.units strong').all_inner_texts())
    r.screenshot(path='/tmp/h5-result.png', full_page=True)
    r.click('.fr-guide a:has-text("Upravit odpovědi")'); time.sleep(0.3)
    print('úprava odpovědí – vybraná:', r.locator('.g-opt.on').count(), '| shrnutí:', r.locator('.g-sofar > div').count())
    b.close()
print('chyby:', errs or 'žádné')
