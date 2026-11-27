"""Úvodní stránka (aktivita, pokračovat) a nápověda – spouštět po test_anotace.py."""
import time
from playwright.sync_api import sync_playwright
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errors.append(str(e)))
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.5)
    print('aktivita:', p.locator('.act-list li').count(), '|', p.locator('.act-list li').first.inner_text().replace('\n', ' ')[:100])
    p.locator('[data-home-document]').first.click(); time.sleep(0.4); p.locator('.unit-entry').first.click(); time.sleep(0.4)
    p.click('.nav-item[data-page=home]'); time.sleep(0.4)
    print('pokračovat:', p.locator('#homeContinue').count(), p.locator('.home-card').first.inner_text().replace('\n', ' ')[:90])
    p.screenshot(path='/tmp/h1-home.png', full_page=True)
    p.click('#helpTop'); time.sleep(0.4)
    print('nápověda:', p.locator('#rqHelp.open').count(), p.locator('.help-toc button.on').inner_text())
    p.click('#rqHelpClose'); p.click('#homeContinue'); time.sleep(0.4); p.click('#helpTop'); time.sleep(0.4)
    print('kontext:', p.locator('.help-toc button.on').inner_text()); p.screenshot(path='/tmp/h2-help.png')
    b.close()
print('chyby:', errors or 'žádné')
