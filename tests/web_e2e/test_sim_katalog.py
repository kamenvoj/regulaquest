# Katalog simulací ve Studiu: Subjekty (pole podle typu, výrobky, kusy, vztahy), Produkty (vlastnosti s podmínkou,
# výrobky – dědění a přepsání, „kdo s výrobkem pracuje“), Nastavení polí. Spouštět po test_anotace.py (migrace 29).
import time, psycopg
from playwright.sync_api import sync_playwright
DSN = "host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
c = psycopg.connect(DSN, autocommit=True)
c.execute("delete from sim_relations where subject_id in (select id from sim_subjects where name like 'Test%%')")
c.execute("delete from sim_units where model_id in (select id from sim_models where name like 'Test%%')")
c.execute("delete from sim_models where name like 'Test%%'"); c.execute("delete from sim_subjects where name like 'Test%%'"); c.execute("delete from sim_products where name like 'Test%%'")
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1500, 'height': 1000}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.8)
    p.click('#spaces [data-space=sim]'); time.sleep(0.6)
    print('menu simulací:', [t.strip() for t in p.locator('.rail .nav-item[data-space=sim]').all_inner_texts()])
    p.click('.nav-item[data-page=simsub]'); time.sleep(1)
    print('subjekty – skupiny:', p.locator('.sc-grp').all_inner_texts())
    p.click('.sc-item:has-text("Krajská nemocnice Lipovec")'); time.sleep(0.5)
    print('Lipovec – kusy:', p.locator('.sc-detail .sc-tbl').nth(0).locator('tr').count() - 1, '| pole:', p.locator('.sc-detail .sc-fields .sc-f').count())
    p.screenshot(path='/tmp/k1-subjekt.png', full_page=True)
    # nový distributor + vztah k výrobku
    p.select_option('[data-typef]', 'distributor'); time.sleep(0.4); p.click('[data-newsub]'); time.sleep(1)
    p.fill('.sc-detail [data-fk=name]', 'Test Distribuce s.r.o.'); p.locator('.sc-detail [data-fk=name]').dispatch_event('change'); time.sleep(0.6)
    p.check('.sc-detail [data-fk=iszp]'); time.sleep(0.8)
    p.select_option('[data-newrel-k]', 'distribuuje'); time.sleep(0.2); p.select_option('[data-newrel-t]', 'v-infusim-p3'); p.click('[data-newrel]'); time.sleep(1.2)
    p.locator('#scDlg [data-fk=od]').fill('2026-01-01'); p.locator('#scDlg [data-fk=od]').dispatch_event('change'); time.sleep(0.5)
    p.click('#scDlg [data-x]'); time.sleep(1)
    print('vztahy distributora:', p.locator('.sc-detail .sc-tbl').last.inner_text().replace('\n', ' | ')[:160])
    # produkty
    p.click('.nav-item[data-page=simprod]'); time.sleep(1)
    print('produkty:', p.locator('#simProdContent .sc-list .sc-item').all_inner_texts())
    p.click('.sc-item:has-text("Volumetrická infuzní pumpa")'); time.sleep(0.5)
    p.locator('details.sc-model').first.locator('summary').click(); time.sleep(0.3)
    print('kdo s P3 pracuje:', p.locator('details.sc-model').first.locator('.sc-who').inner_text().replace('\n', ' | '))
    p.screenshot(path='/tmp/k2-produkt.png', full_page=True)
    # vlastnost s podmínkou: měřicí funkce → stanovené měřidlo
    p.click('[data-newprod]'); time.sleep(1)
    p.fill('.sc-prod-main [data-fk=name]', 'Test teploměr'); p.locator('.sc-prod-main [data-fk=name]').dispatch_event('change'); time.sleep(0.5)
    before = p.locator('.sc-prod-main [data-fk=stanovene]').count()
    p.check('.sc-prod-main [data-fk=mereni]'); time.sleep(1)
    print('stanovené měřidlo – před/po zaškrtnutí měřicí funkce:', before, p.locator('.sc-prod-main [data-fk=stanovene]').count())
    p.check('.sc-prod-main [data-fk=stanovene]'); time.sleep(0.8)
    p.select_option('[data-newmodel-m]', 's-medivia'); p.fill('[data-newmodel-n]', 'Test TermoSIM'); p.click('[data-newmodel]'); time.sleep(1.2)
    card = p.locator('details.sc-model', has_text='Test TermoSIM'); card.locator('summary').click(); time.sleep(0.3)
    card.locator('tr:has-text("Stanovené měřidlo") [data-over]').click(); time.sleep(1.2)
    card = p.locator('details.sc-model', has_text='Test TermoSIM')
    if not card.evaluate('d => d.open'): card.locator('summary').click(); time.sleep(0.3)
    card.locator('tr:has-text("Stanovené měřidlo") input[type=checkbox]').uncheck(); time.sleep(1)
    print('DB výrobek:', c.execute("select m.data, p.data from sim_models m join sim_products p on p.id = m.product_id where m.name = 'Test TermoSIM'").fetchone())
    print('DB vztah:', c.execute("select r.kind, r.target_id, r.data from sim_relations r join sim_subjects s on s.id = r.subject_id where s.name = 'Test Distribuce s.r.o.'").fetchone())
    # nastavení polí
    p.click('.nav-item[data-page=simcfg]'); time.sleep(1)
    print('nastavení – typů subjektů:', p.locator('details.se-card').count(), '| polí produktu:', p.locator('[data-cf^="product_fields."][data-cf$=".label"]').count())
    p.screenshot(path='/tmp/k3-pole.png', full_page=True)
print('chyby:', errs or 'žádné')
