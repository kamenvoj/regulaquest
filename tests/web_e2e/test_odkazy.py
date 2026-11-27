"""Užitečné odkazy: správa ve Studiu a záložka Odkazy ve čtečce (po test_anotace.py)."""
import time, psycopg
from playwright.sync_api import sync_playwright
with psycopg.connect('host=/tmp/pg port=5544 user=postgres dbname=rqe2e', autocommit=True) as c:
    c.execute("delete from links where title like 'NANDO%%'"); c.execute("update links set status = 'draft'")
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.6)
    p.click('.nav-item[data-page=links]'); time.sleep(0.6)
    print('výchozí:', p.locator('.nw-item[data-id]').count(), '| kategorie:', p.locator('.lk-cat').all_inner_texts())
    p.click('#lkNew'); time.sleep(0.2)
    p.fill('[data-form=new] [data-f=title]', 'NANDO – oznámené subjekty'); p.fill('[data-form=new] [data-f=url]', 'https://example.org/nando')
    p.fill('[data-form=new] [data-f=description]', 'Seznam oznámených subjektů a jejich rozsahu.'); p.fill('[data-form=new] [data-f=category]', 'Databáze a registry')
    p.select_option('[data-form=new] [data-f=status]', 'published'); p.click('[data-form=new] [data-save]'); time.sleep(0.8)
    for t in ['SÚKL', 'EUDAMED', 'EUR-Lex']:
        p.locator(f'.nw-item[data-id]:has-text("{t}") [data-pub]').click(); time.sleep(0.6)
    p.locator('.nw-item[data-id]:has-text("NANDO") [data-mv="-1"]').click(); time.sleep(0.6)
    print('zveřejněné:', p.locator('.lk-st.published').count(), '| Databáze:', p.locator('.lk-cat:has-text("Databáze") + .nw-list .nw-title').all_inner_texts())
    p.screenshot(path='/tmp/l1-studio.png', full_page=True)
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni#/odkazy'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.lk-cards'); time.sleep(0.3)
    print('čtečka:', r.locator('.card.lk strong').all_inner_texts(), '| sekce:', r.locator('.sec h2').all_inner_texts())
    print('nové okno:', r.locator('.card.lk a.btn').first.get_attribute('target'))
    r.click('[data-lk=cat][data-v="Legislativa"]'); time.sleep(0.2); print('filtr Legislativa:', r.locator('.card.lk').count())
    r.click('[data-lk=cat][data-v=""]'); r.fill('#lkQ', 'oznámen'); time.sleep(0.4); print('hledání:', r.locator('.card.lk strong').all_inner_texts())
    r.fill('#lkQ', ''); time.sleep(0.4); r.screenshot(path='/tmp/l2-reader.png', full_page=True)
    b.close()
print('chyby:', errs or 'žádné')
