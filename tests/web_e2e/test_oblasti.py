"""Oblasti: správa ve Studiu, zařazení dokumentů s rolí, filtr v katalogu a stránka oblasti ve čtečce (spouštět po test_anotace.py)."""
import time
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errs.append(str(e))); p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    def submit(vals):
        for k, v in vals.items(): p.fill(f'#modalContent [name={k}]', v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.7)
    p.click('#homeNewDoc'); submit({'title': 'Zákon o metrologii', 'family': 'Metrologie', 'version': '1'})
    p.click('#homeAllDocs'); time.sleep(0.4)
    p.click('#manageAreas'); time.sleep(0.4); print('oblastí:', p.locator('.area-def').count()); p.click('#arClose'); time.sleep(0.2)
    # MDR → ZP hlavní
    p.locator('.doc-group:has-text("MDR") [data-edit-metadata]').first.click(); time.sleep(0.3)
    p.select_option('[data-new-area]', 'zp'); p.click('[data-add]'); time.sleep(0.9)
    p.fill('#modalContent [name=short_title]', 'MDR – Nařízení o zdravotnických prostředcích'); p.check('#modalContent [name=featured]')
    p.click('#modalContent button[type=submit]'); time.sleep(0.8)
    # Metrologie → metrologie hlavní + ZP situace
    p.locator('.doc-group:has-text("Metrologie") [data-edit-metadata]').first.click(); time.sleep(0.3)
    p.select_option('[data-new-area]', 'metrologie'); p.click('[data-add]'); time.sleep(0.9)
    p.select_option('[data-new-area]', 'zp'); p.select_option('[data-new-role]', 'situational'); p.fill('[data-new-note]', 'Zdravotnické prostředky s měřicí funkcí (třída Im)'); p.click('[data-add]'); time.sleep(0.9)
    print('zařazení:', p.locator('#docAreas .area-row[data-area]').count()); p.screenshot(path='/tmp/o1-meta.png')
    p.click('#cancelMetadata'); time.sleep(0.3)
    p.select_option('#catalogArea', 'zp'); time.sleep(0.3); print('katalog ZP:', p.locator('#documentOverview .doc-group').count(), p.locator('.area-chip').all_inner_texts())
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errs.append('R ' + str(e)))
    r.goto('http://127.0.0.1:8765/ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.5)
    r.click('.navb[data-nav=docs]'); time.sleep(0.3); print('oblasti ve čtečce:', r.locator('.area-switch .chipb').all_inner_texts())
    r.click('.area-switch [data-area=zp]'); time.sleep(0.3); print('sekce:', r.locator('.sec h2').all_inner_texts(), '| kdy:', r.locator('.situ').all_inner_texts())
    r.screenshot(path='/tmp/o2-area.png', full_page=True)
    r.click('.navb[data-nav=home]'); time.sleep(0.3); print('přehled:', r.inner_text('.sec h2'))
    b.close()
print('chyby:', errs or 'žádné')
