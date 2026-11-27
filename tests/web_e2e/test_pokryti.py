"""Přehled pokrytí – spouštět po test_anotace.py (používá jeho data)."""
import time
from playwright.sync_api import sync_playwright
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900}); p.on('pageerror', lambda e: errors.append(str(e)))
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    p.click('.nav-item[data-page=coverage]'); time.sleep(0.5)
    print('řádky:', p.locator('.cov-row:not(.head)').count(), '|', [x.replace('\n', ' ') for x in p.locator('.cov-metric').all_inner_texts()])
    print('řádek:', p.locator('.cov-row:not(.head)').first.inner_text().replace('\n', ' | '))
    p.screenshot(path='/tmp/c1-coverage.png')
    p.click('[data-f=nocomments]'); time.sleep(0.3); print('bez výkladu:', p.locator('.cov-row:not(.head)').count())
    p.click('[data-f=all]'); p.locator('.cov-row:not(.head)').first.click(); time.sleep(0.5)
    print('otevřeno:', p.is_visible('#page-library'))
    b.close()
print('chyby:', errors or 'žádné')
