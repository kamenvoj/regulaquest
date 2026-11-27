"""Prezentace: import .pptx, editor (odkaz klepnutím do náhledu), zpřístupnění, nová verze, čtečka (po test_anotace.py).
Ukázkový soubor .pptx se do gitu nedává: cesta v RQ_PPTX (výchozí /tmp/pp/bme.pptx)."""
import os, time, zipfile, shutil, psycopg
from playwright.sync_api import sync_playwright
PPTX = os.environ.get('RQ_PPTX', '/tmp/pp/bme.pptx')
DSN = 'host=/tmp/pg port=5544 user=postgres dbname=rqe2e'
with psycopg.connect(DSN, autocommit=True) as c:
    c.execute('delete from presentations')
    if not c.execute("select 1 from student_groups where name = 'Testovací skupina'").fetchone():
        c.execute("insert into student_groups(name) values ('Testovací skupina')")
    unit = c.execute("select id from units where label = 'Článek 10' limit 1").fetchone()[0]
# „nová verze“: kopie s jiným nadpisem 2. snímku a bez posledního snímku
v2 = '/tmp/pp/bme-v2.pptx'
with zipfile.ZipFile(PPTX) as zi, zipfile.ZipFile(v2, 'w', zipfile.ZIP_DEFLATED) as zo:
    for it in zi.infolist():
        data = zi.read(it.filename)
        if it.filename == 'ppt/slides/slide3.xml': data = data.replace('Od IVDD k IVDR'.encode(), 'Od IVDD k IVDR (aktualizováno)'.encode())
        if it.filename == 'ppt/slides/slide4.xml': data = data.replace('za účelem poskytnout informace'.encode(), 'za účelem poskytnout údaje'.encode())
        zo.writestr(it, data)
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1500, 'height': 950}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.6)
    p.click('.nav-item[data-page=pres]'); time.sleep(0.5)
    p.set_input_files('#prImport', PPTX); p.wait_for_selector('#prStage', timeout=20000); time.sleep(0.6)
    print('import:', p.locator('.pr-th').count(), 'snímků | nadpis:', p.inner_text('#presContent h1'))
    p.locator('.pr-th').nth(3).click(); time.sleep(0.4)
    p.locator('#prStage .sl-card').first.click(); time.sleep(0.3)
    p.fill('#prLinkPop [data-uq]', 'článek 10'); time.sleep(0.3); p.locator('#prLinkPop [data-u]').first.click(); time.sleep(0.3)
    p.locator('#prStage .sl-key').click(); time.sleep(0.3); p.locator('#prLinkPop [data-tab=s]').click(); p.locator('#prLinkPop [data-s]').nth(1).click(); time.sleep(0.3)
    p.fill('.pr-form [data-f=notes]', 'Upravená poznámka.')
    print('odkazy v náhledu:', p.locator('#prStage .sl-go').count(), '| neuloženo:', p.locator('.pr-dirty').is_visible())
    p.click('#prSave'); time.sleep(1)
    p.screenshot(path='/tmp/p1-editor.png')
    p.locator('.pr-meta > summary').click(); time.sleep(0.2)
    p.select_option('#prStatus', 'ready'); p.click('#prSaveMeta'); time.sleep(1)
    p.locator('.pr-meta > summary').click(); time.sleep(0.2)
    p.locator('[data-g]').first.check(); time.sleep(0.8)
    # nová verze
    p.set_input_files('#prReimport', v2); p.wait_for_selector('#riGo', timeout=20000); time.sleep(0.3)
    print('nová verze:', p.locator('.pr-sum li').all_inner_texts())
    print('nepřenesené:', p.locator('#modalContent .notice li').all_inner_texts()[:3])
    p.screenshot(path='/tmp/p2-reimport.png')
    p.click('#riGo'); time.sleep(1.5)
    print('po nové verzi:', p.locator('.pr-th').count(), 'snímků | odkazy na snímku 4:', end=' ')
    p.locator('.pr-th').nth(3).click(); time.sleep(0.4); print(p.locator('#prStage .sl-go').count())
    # řádek Prezentace v textu dokumentu
    p.evaluate(f"openUnit('{unit}')"); time.sleep(1.2)
    print('u ustanovení:', p.locator('#rqPresRow .role-chip').all_inner_texts())
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni#/prezentace'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.8)
    print('čtečka seznam:', r.locator('.prcard strong').all_inner_texts())
    if r.locator('.prcard').count():
        r.locator('.prcard').first.click(); time.sleep(0.8)
        [ (r.keyboard.press('ArrowRight'), time.sleep(0.35)) for _ in range(3) ]
        print('snímek:', r.inner_text('.pv-count'), '| odkazy:', r.locator('.pv-stage .sl-go').count(), '| poznámky (admin):', r.locator('.pv-notes').count())
        r.screenshot(path='/tmp/p3-reader.png')
        r.locator('.pv-stage .sl-go[data-link*=unit]').first.click(); time.sleep(0.8)
        print('po klepnutí:', r.url.split('#')[1], '| lišta zpět:', r.locator('.cs-backbar').inner_text()[:45])
        print('souvislosti:', 'V prezentacích' in r.inner_text('.context'))
        r.locator('.cs-backbar a').first.click(); time.sleep(0.6); print('zpět:', r.url.split('#')[1])
    b.close()
print('chyby:', errs or 'žádné')
# odkaz snímek → snímek a návrat
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R2 ' + str(e)))
    with psycopg.connect(DSN, autocommit=True) as c:
        pid, sid = c.execute("select presentation_id, id from presentation_slides where data::text like '%%\"slide\"%%' limit 1").fetchone()
    r.goto(f'http://127.0.0.1:8765/ctecka/?nahled=pracovni#/prezentace/{pid}/{sid}'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.pv-stage'); time.sleep(0.6)
    before = r.inner_text('.pv-bottom .pv-count'); r.locator('.pv-stage .sl-go[data-link*=slide]').first.click(); time.sleep(0.6)
    print('snímek → snímek:', before, '→', r.inner_text('.pv-bottom .pv-count'), '| zpět:', r.locator('.pv-backbar').inner_text())
    r.locator('.pv-backbar a').click(); time.sleep(0.6); print('po návratu:', r.inner_text('.pv-bottom .pv-count'), '| lišta:', r.locator('.pv-backbar').count())
    r.click('#pvGrid'); time.sleep(0.4); print('přehled snímků:', r.locator('.pv-thumb').count())
    r.screenshot(path='/tmp/p4-grid.png')
    b.close()
print('chyby:', errs or 'žádné')
