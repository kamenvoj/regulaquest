"""Aktuality: načtení ze zdrojů (náhrada pg_net), zpracování ve Studiu, propojení s ustanovením a zobrazení ve čtečce (po test_anotace.py)."""
import time, psycopg
from playwright.sync_api import sync_playwright
DSN = 'host=/tmp/pg port=5544 user=postgres dbname=rqe2e'
RSS = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title>'
       + ''.join(f'<item><title>Zpráva {i} o zdravotnických prostředcích</title><link>https://example.org/z{i}</link><description><![CDATA[<p>Výtah {i}</p>]]></description>'
                 f'<pubDate>Thu, {10+i} Nov 2026 12:00:00 +0000</pubDate></item>' for i in range(1, 5)) + '</channel></rss>')
with psycopg.connect(DSN, autocommit=True) as c:
    c.execute('create schema if not exists net')
    c.execute('create table if not exists net._http_response(id bigint, status_code int, content text, timed_out boolean, error_msg text)')
    c.execute('create table if not exists net.fake(url text, body text, code int)')
    c.execute("""create or replace function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds int) returns bigint
        language plpgsql as $f$ declare i bigint := (select coalesce(max(id),0)+1 from net._http_response); begin
        insert into net._http_response select i, f.code, f.body, false, null from net.fake f where f.url = http_get.url; return i; end $f$""")
    c.execute('truncate news_items, net.fake, net._http_response')
    c.execute("update news_sources set active = (url like 'https://sukl%%')")
    c.execute("insert into net.fake select url, %s, 200 from news_sources where url like 'https://sukl%%'", (RSS,))
    unit = c.execute("select id from units where label = 'Článek 10' limit 1").fetchone()[0]
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.6)
    p.click('.nav-item[data-page=news]'); time.sleep(0.6)
    print('upozornění:', p.locator('#newsContent .notice').all_inner_texts())
    p.click('#nwFetch'); p.wait_for_function("document.querySelectorAll('.nw-item').length >= 4", timeout=30000); time.sleep(0.3)
    print('nové:', p.locator('.nw-item').count(), '| odznak:', p.inner_text('#navNews'))
    first = p.locator('.nw-item').first
    first.locator('[data-ed]').click(); time.sleep(0.3)
    p.fill('.nw-edit [data-f=comment]', 'Důležité pro výrobce.')
    p.locator('.nw-edit [data-pick=t] summary').click(); p.locator('.nw-edit [data-pick=t] input[value=role_vyrobce]').check(); p.locator('.nw-edit [data-pick=t] summary').click()
    p.click('.nw-edit [data-save]'); time.sleep(0.8)
    print('po úpravě (přečtené přesunuto):', p.locator('.nw-item').count())
    p.click('[data-tab=read]'); time.sleep(0.3); p.locator('.nw-item').first.locator('[data-st=published]').click(); time.sleep(0.8)
    p.click('[data-tab=new]'); time.sleep(0.3); p.check('#nwAll'); time.sleep(0.2); p.click('[data-bulk=rejected]'); time.sleep(0.8)
    print('po hromadném zamítnutí nové:', p.locator('.nw-item:not(.nw-empty)').count())
    p.click('#nwAdd'); time.sleep(0.2); p.fill('#naUrl', 'https://example.org/eudamed'); p.fill('#naTitle', 'EUDAMED: povinné moduly'); p.fill('#naSrc', 'Evropská komise')
    p.click('#naSave'); time.sleep(0.8); p.locator('.nw-item').first.locator('[data-st=published]').click(); time.sleep(0.8)
    p.click('[data-tab=published]'); time.sleep(0.3); print('zveřejněné:', p.locator('.nw-title').all_inner_texts())
    p.screenshot(path='/tmp/a1-studio.png', full_page=True)
    p.click('#nwSources'); time.sleep(0.3); print('zdroje:', p.locator('.nw-src[data-id]').count()); p.click('#nsClose')
    # propojení z textu dokumentu
    p.evaluate(f"openUnit('{unit}')"); time.sleep(1)
    p.click('#rqRelBox summary'); time.sleep(0.2); p.click('#rqNewsAdd'); time.sleep(0.3); p.fill('#rqNewsQ', 'EUDAMED'); time.sleep(0.2); p.locator('[data-news-add]').first.click(); time.sleep(1)
    print('u ustanovení:', p.locator('#rqNewsRow .role-chip').all_inner_texts())
    p.screenshot(path='/tmp/a2-unit.png')
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.5)
    print('čtečka – odznak:', r.inner_text('#navUpd'), '| přehled:', r.locator('.home .upd-title').count())
    r.click('.navb[data-nav=updates]'); time.sleep(0.3)
    print('stránka:', r.locator('.upd-title').all_inner_texts(), '| komentář:', r.locator('.upd-com').all_inner_texts(), '| odznak po:', repr(r.inner_text('#navUpd')))
    r.screenshot(path='/tmp/a3-reader.png', full_page=True)
    r.fill('#updQ', 'eudamed'); time.sleep(0.5); print('hledání:', r.locator('.upd-title').count())
    r.goto(f'http://127.0.0.1:8765/ctecka/?nahled=pracovni#/u/{unit}'); time.sleep(1.2)
    print('souvislosti:', r.locator('.context .ctx-section h3').all_inner_texts())
    r.screenshot(path='/tmp/a4-ctx.png')
    b.close()
print('chyby:', errs or 'žádné')

# stránkování a řazení (30 dalších zveřejněných položek)
with psycopg.connect(DSN, autocommit=True) as c:
    c.execute("""insert into news_items(source_name, guid, url, title, published_at, status, published_on)
                 select 'Test', 'g'||i, 'https://example.org/p'||i, 'Položka '||lpad(i::text,2,'0'), now() - (i||' days')::interval, 'published', now()
                 from generate_series(1,30) i on conflict do nothing""")
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.6); p.click('.nav-item[data-page=news]'); time.sleep(0.6); p.click('[data-tab=published]'); time.sleep(0.3)
    p.select_option('#nwPer', '10'); time.sleep(0.3)
    print('Studio 10/str.:', p.locator('.nw-item').count(), '| stránek:', p.locator('.nw-pager [data-pg]').count() - 2, '| první:', p.locator('.nw-title').first.inner_text())
    p.locator('.nw-pager [data-pg="3"]').click(); time.sleep(0.3); print('stránka 4:', p.locator('.nw-item').count())
    p.select_option('#nwSort', 'old'); time.sleep(0.3); print('nejstarší první:', p.locator('.nw-title').first.inner_text())
    p.check('#nwAll'); time.sleep(0.2); print('vybráno:', p.locator('.nw-sel:checked').count())
    p.screenshot(path='/tmp/a5-pager.png', full_page=True)
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni#/aktuality'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.upd-list'); time.sleep(0.4)
    print('čtečka:', r.locator('.upd').count(), '| stránky:', r.locator('.upd-pager [data-up]').count()); r.locator('.upd-pager [data-up="1"]').first.click(); time.sleep(0.3); print('čtečka str. 2:', r.locator('.upd-title').first.inner_text())
    b.close()
print('chyby:', errs or 'žádné')
