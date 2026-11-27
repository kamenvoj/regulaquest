"""Přehled: připnuté a naposledy upravované dokumenty (CS/EN v jednom řádku), katalog s filtrem stavu."""
import time
from playwright.sync_api import sync_playwright
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errors.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    def submit(vals, selects={}):
        for k, v in vals.items(): p.fill(f'#modalContent [name={k}]', v)
        for k, v in selects.items(): p.select_option(f'#modalContent [name={k}]', v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.7)
    for i in range(7):
        p.click('#homeNewDoc'); submit({'title': f'Dokument {i}', 'family': f'D{i}', 'version': '1'})
    print('na Přehledu:', p.locator('#homeDocuments .doc-group').count(), '|', p.inner_text('#homeAllDocs'))
    p.locator('#homeDocuments [data-pin]').nth(2).click(); time.sleep(0.3)
    print('připnuté:', p.locator('.dg-title').all_inner_texts(), p.locator('#homeDocuments .doc-group').count())
    p.screenshot(path='/tmp/d1-home.png', full_page=True)
    p.fill('#homeDocSearch', 'D3'); p.press('#homeDocSearch', 'Enter'); time.sleep(0.4)
    print('katalog hledání:', p.locator('#documentOverview .doc-group').count())
    p.fill('#documentListSearch', ''); p.dispatch_event('#documentListSearch', 'input'); time.sleep(0.3)
    p.select_option('#catalogStatus', 'pinned'); time.sleep(0.3); print('katalog připnuté:', p.locator('#documentOverview .doc-group').count())
    p.select_option('#catalogStatus', 'new'); time.sleep(0.3); print('katalog nezačaté:', p.locator('#documentOverview .doc-group').count())
    p.screenshot(path='/tmp/d2-catalog.png')
    b.close()
print('chyby:', errors or 'žádné')
