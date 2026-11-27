"""Trasy: založení ve Studiu, přidání kroků (celé ustanovení, místo v textu, samostatný text), průchod ve čtečce."""
import time
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8765/'
errors = []
def select_text(p, root_sel, needle):
    p.evaluate("""([sel, needle]) => { const root = document.querySelector(sel); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(needle); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); root.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); return; } } throw new Error('nenalezeno'); }""", [root_sel, needle])
    time.sleep(0.3)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900})
    p.on('pageerror', lambda e: errors.append(str(e))); p.on('dialog', lambda d: d.accept('Klasifikace softwaru') if d.type == 'prompt' else d.accept())
    p.goto(BASE + 'studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    def submit(vals, selects={}):
        for k, v in vals.items(): p.fill(f'#modalContent [name={k}]', v)
        for k, v in selects.items(): p.select_option(f'#modalContent [name={k}]', v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.7)
    p.click('#homeNewDoc'); submit({'title': 'Nařízení (EU) 2017/745', 'family': 'MDR', 'version': '2026'})
    p.click('[data-home-document]'); time.sleep(0.3)
    for lab, txt in (('Článek 2', 'Pro účely tohoto nařízení se rozumí software jako prostředek.'), ('Článek 51', 'Prostředky se rozdělují do tříd I, IIa, IIb a III podle přílohy VIII.')):
        p.click('#newUnit'); submit({'label': lab, 'heading': '', 'locator': lab}, {'kind': 'article'})
        p.click(f'.unit-entry >> text={lab}'); time.sleep(0.3); p.click('#rqEditContent'); time.sleep(0.4)
        p.locator('[data-rq-editable-text]').first.click(); p.keyboard.type(txt); p.click('#rqSaveContent'); time.sleep(0.8); p.click('#verifyText'); time.sleep(0.7)
    # krok 1: celé ustanovení (nová trasa)
    p.click('.unit-entry >> text=Článek 2'); time.sleep(0.3); p.click('#rqToPath'); time.sleep(0.3)
    p.fill('#apNew', 'Klasifikace softwaru'); p.fill('#apNote', 'Nejdřív definice.'); p.click('#apGo'); time.sleep(1)
    # krok 2: místo v textu
    p.click('.unit-entry >> text=Článek 51'); time.sleep(0.4)
    select_text(p, '#reader [data-anchor-root]', 'podle přílohy VIII'); p.click('#rqSelBar [data-k=path]'); time.sleep(0.3)
    print('předvybraná trasa:', p.locator('#apPath option:checked').inner_text()); p.fill('#apNote', 'Pravidla jsou v příloze VIII.'); p.click('#apGo'); time.sleep(1)
    # stránka Trasy
    p.click('.nav-item[data-page=paths]'); time.sleep(0.5)
    print('kroky ve Studiu:', p.locator('.step-row').count(), p.locator('.step-row .anchor-preview').count())
    p.click('#pAddText'); time.sleep(0.9)
    p.locator('.step-row').last.locator('[data-move="-1"]').click(); time.sleep(0.8)
    print('pořadí:', [x.strip()[:30] for x in p.locator('.step-where').all_inner_texts()])
    p.fill('#pDesc', 'Jak se zařazuje software.'); p.select_option('[name=pStatus]', 'published'); p.click('#pSave'); time.sleep(0.9)
    p.screenshot(path='/tmp/t1-studio.png')
    r = b.new_page(viewport={'width': 1440, 'height': 900}); r.on('pageerror', lambda e: errors.append('R ' + str(e)))
    r.goto(BASE + 'ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('.appnav'); time.sleep(0.6)
    r.locator('.tile[href="#/trasy"]').click(); time.sleep(0.4)
    print('rozcestník → trasy, karty:', r.locator('.card.path').count())
    r.locator('.card.path').first.click(); time.sleep(0.5)
    print('úvod trasy:', r.locator('.path-overview li').count(), r.inner_text('.path-box .pb-top').replace('\n', ' '))
    r.click('.path-pager .next'); time.sleep(0.5); r.click('.path-pager .next'); time.sleep(0.5); r.click('.path-pager .next'); time.sleep(0.6)
    print('krok 3:', r.inner_text('.path-box .pb-top').replace('\n', ' '), '| zaměřeno:', r.locator('#panelText .rq-focus').count(), '| hotovo:', r.locator('.pb-dots a.done').count())
    r.screenshot(path='/tmp/t2-reader.png')
    print('levý panel:', r.locator('.path-steps li').count(), r.locator('.path-steps li.done').count())
    b.close()
print('chyby:', errors or 'žádné')
