"""Archivace, obnovení a trvalé smazání dokumentu ve Studiu."""
import time
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8765/'
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900})
    p.on('pageerror', lambda e: errors.append(str(e)))
    p.on('dialog', lambda d: d.accept())
    p.goto(BASE + 'studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    def submit(vals):
        for k, v in vals.items(): p.fill(f'#modalContent [name={k}]', v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.7)
    for t, f in (('Zkušební dokument A', 'ZKA'), ('Zkušební dokument B', 'ZKB')):
        p.click('#homeNewDoc'); submit({'title': t, 'family': f, 'version': '1'})
    print('dokumenty:', p.locator('[data-home-document]').count())
    p.click('.nav [data-page=documents]') if p.locator('.nav [data-page=documents]').count() else p.click('#homeOpenDocs')
    time.sleep(0.4)
    p.locator('[data-edit-metadata]').first.click(); time.sleep(0.3)
    p.click('#archiveDoc'); time.sleep(1)
    print('po archivaci:', p.locator('[data-home-document]').count(), p.locator('.home-archived summary').inner_text())
    p.click('.home-archived summary'); p.click('[data-restore-doc]'); time.sleep(1)
    print('po obnovení:', p.locator('[data-home-document]').count())
    p.click('#homeOpenDocs'); time.sleep(0.4)
    p.locator('[data-edit-metadata]').first.click(); time.sleep(0.3)
    title = p.input_value('#modalContent [name=title]')
    p.click('#deleteDoc'); time.sleep(0.3)
    print('tlačítko bez potvrzení zakázané:', p.is_disabled('#delGo'))
    p.fill('#delTitle', title); p.click('#delGo'); time.sleep(1.2)
    print('po smazání:', p.locator('[data-home-document]').count(), p.inner_text('#toast'))
    b.close()
print('chyby:', errors or 'žádné')
