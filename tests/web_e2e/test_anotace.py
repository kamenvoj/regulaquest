"""Poznámky k vybranému textu: výběr → Zvýraznit / Poznámka / Pozor ve Studiu, zobrazení ve čtečce (pracovní náhled)."""
import time
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8765/'
errors = []
TEXT = ('Výrobci provedou klinické hodnocení v souladu s článkem 61.\n'
        'Klinické hodnocení musí být aktualizováno po celou dobu životního cyklu prostředku.')

def select_text(p, root_sel, needle, nth=0):
    p.evaluate("""([sel, needle, nth]) => {
      const root = document.querySelector(sel); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n, k = 0; while ((n = w.nextNode())) { let i = -1;
        while ((i = n.nodeValue.indexOf(needle, i + 1)) >= 0) { if (k++ === nth) {
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
          root.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); return; } } }
      throw new Error('nenalezeno ' + needle); }""", [root_sel, needle, nth])
    time.sleep(0.3)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    p = b.new_page(viewport={'width': 1440, 'height': 900})
    p.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    p.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    p.on('dialog', lambda d: d.accept())
    p.goto(BASE + 'studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.4)
    def submit(vals, selects={}):
        for k, v in vals.items(): p.fill(f'#modalContent [name={k}]', v)
        for k, v in selects.items(): p.select_option(f'#modalContent [name={k}]', v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.7)
    p.click('#homeNewDoc'); submit({'title': 'Nařízení (EU) 2017/745', 'family': 'MDR', 'version': '2026'})
    p.click('[data-home-document]'); time.sleep(0.3)
    p.click('#newUnit'); submit({'label': 'Článek 10', 'heading': 'Povinnosti výrobců', 'locator': 'Článek 10'}, {'kind': 'article'})
    p.click('.unit-entry >> text=Článek 10'); time.sleep(0.3)
    p.click('#rqEditContent'); time.sleep(0.4)
    p.locator('[data-rq-editable-text]').first.click(); p.keyboard.type(TEXT)
    p.click('#rqSaveContent'); time.sleep(0.8); p.click('#verifyText'); time.sleep(0.8)

    # 1) Zvýraznit (druhý výskyt „Klinické hodnocení“ – s velkým K je jen jeden; použijeme „klinické hodnocení“ = 1. výskyt)
    select_text(p, '#reader [data-anchor-root]', 'po celou dobu životního cyklu')
    assert p.is_visible('#rqSelBar'), 'lišta výběru se nezobrazila'
    p.screenshot(path='/tmp/a1-selbar.png')
    p.click('#rqSelBar [data-k=key]'); time.sleep(0.9)
    print('key:', p.inner_text('#toast'), '| zvýraznění:', p.locator('#reader .rq-key').count())
    # 2) Poznámka k výběru
    select_text(p, '#reader [data-anchor-root]', 'klinické hodnocení')
    p.click('#rqSelBar [data-k=explanation]'); time.sleep(0.4)
    print('dialog:', p.inner_text('#modalContent h2'), '|', p.inner_text('#modalContent .anchor-preview'))
    submit({'body': 'Klinické hodnocení (čl. 61) není totéž co klinická zkouška.'})
    # 3) Pozor
    select_text(p, '#reader [data-anchor-root]', 'článkem 61')
    p.click('#rqSelBar [data-k=warning]'); time.sleep(0.4)
    submit({'body': 'Odkaz platí včetně přílohy XIV.'})
    # 4) vrstva Povinnost
    select_text(p, '#reader [data-anchor-root]', 'Výrobci provedou')
    p.click('#rqSelBar [data-k=duty]'); time.sleep(0.9)
    print('povinnost:', p.locator('#reader .hl-duty').count())
    print('studio: kotvy', p.locator('#reader .rq-anc').count(), 'ikonky', p.locator('#reader .rq-mk').count(),
          'značky v osnově', p.locator('.tree-marks .m').count(), 'citace vpravo', p.locator('#context .anchor-q').count())
    p.screenshot(path='/tmp/a2-studio.png')
    # klik na ikonku → detail komentáře
    p.locator('#reader .rq-mk').first.click(); time.sleep(0.4)
    print('detail:', p.inner_text('#modalContent .anchor-preview'))
    p.click('#closeComment'); time.sleep(0.2)

    # pojmy: čl. 2 s definicemi
    p.click('#newUnit'); submit({'label': 'Článek 2', 'heading': 'Definice', 'locator': 'Článek 2'}, {'kind': 'article'})
    p.click('.unit-entry >> text=Článek 2'); time.sleep(0.3)
    p.click('#rqEditContent'); time.sleep(0.4); p.locator('[data-rq-editable-text]').first.click()
    defs = 'Pro účely tohoto nařízení se rozumí:\n' + '\n'.join(f'{i}) „{w}“ definice číslo {i};' for i, w in enumerate(['zdravotnickým prostředkem','výrobcem','klinickým hodnocením','rizikem','uživatelem','systémem'], 1))
    p.keyboard.type(defs); p.click('#rqSaveContent'); time.sleep(0.8); p.click('#verifyText'); time.sleep(0.8)
    p.click('#rqTerms'); time.sleep(0.4); p.click('#tmImport'); time.sleep(1.2)
    print('pojmy:', p.locator('.tm-row').count(), p.locator('.tm-forms').evaluate_all('e=>e.map(x=>x.value)')[:3])
    p.check('#tmAll'); p.click('[data-bulk=approved]'); time.sleep(1)
    print('schválené:', p.locator('.tm-row .tag.good').count())
    p.screenshot(path='/tmp/a6-terms.png'); p.click('#tmClose')
    p.click('.unit-entry >> text=Článek 10'); time.sleep(0.5)
    print('studio pojmy v textu:', p.locator('#reader .rq-term').all_inner_texts())
    # čtečka – pracovní náhled
    r = b.new_page(viewport={'width': 1440, 'height': 900})
    r.on('pageerror', lambda e: errors.append('READER ' + str(e)))
    r.goto(BASE + 'ctecka/?nahled=pracovni'); r.fill('#rqUser', 'vojta'); r.fill('#rqPass', 'Heslo12345AB'); r.click('button[type=submit]')
    r.wait_for_selector('#docSelect'); time.sleep(0.5)
    r.click('.tree a:has-text("Článek 10")'); time.sleep(0.5)
    print('čtečka: zvýraznění', r.locator('#panelText .rq-key').count(), 'poznámky', r.locator('#panelText .rq-mk').count(),
          'značky v osnově', r.locator('.tree .marks .m').count())
    print('vrstvy:', r.locator('.layer-bar .lb').all_inner_texts(), 'pojmy:', r.locator('#panelText .rq-term').count())
    r.locator('.lb-duty').click(); time.sleep(0.2)
    r.locator('#panelText .rq-term').first.click(); time.sleep(0.3)
    print('definice:', r.inner_text('#panelText .rq-pop')[:90])
    r.screenshot(path='/tmp/a7-reader-terms.png')
    r.locator('#panelText .rq-mk').first.click(); time.sleep(0.3)
    print('rozbaleno:', r.inner_text('#panelText .rq-pop')[:80])
    r.screenshot(path='/tmp/a3-reader.png')
    print('souvislosti:', [h.strip() for h in r.locator('#panelContext h3').all_inner_texts()])
    r.click('#legendBtn'); time.sleep(0.2); r.screenshot(path='/tmp/a4-legend.png')
    # hledání: zvýraznění výsledku je jiné než klíčová pasáž
    r.fill('#search', 'životního'); time.sleep(0.5); r.locator('.result').first.click(); time.sleep(0.5)
    print('hledání: mark', r.locator('#panelText mark').count(), 'key', r.locator('#panelText .rq-key').count())
    r.screenshot(path='/tmp/a5-search.png')
    b.close()
print('chyby:', errors or 'žádné')
