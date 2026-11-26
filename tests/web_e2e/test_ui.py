import sys, time
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8765/studio/'
errors=[]
def shot(p,n): p.screenshot(path=f'/tmp/{n}.png',full_page=False)
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    p=b.new_page(viewport={'width':1440,'height':900})
    p.on('console',lambda m: m.type=='error' and errors.append(m.text))
    p.on('pageerror',lambda e: errors.append('PAGEERROR '+str(e)))
    p.on('dialog',lambda d: d.accept())
    p.goto(BASE); p.fill('#rqUser','vojta'); p.fill('#rqPass','Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.5); shot(p,'01-home')
    def toast_text(): return p.inner_text('#toast')
    def submit_dialog(vals, selects={}):
        for k,v in vals.items(): p.fill(f'#modalContent [name={k}]',v)
        for k,v in selects.items(): p.select_option(f'#modalContent [name={k}]',v)
        p.click('#modalContent button[type=submit]'); time.sleep(0.6)
    # nový dokument
    p.click('#homeNewDoc'); submit_dialog({'title':'Nařízení (EU) 2017/745','family':'MDR','version':'19. 7. 2026'})
    print('doc:',toast_text())
    p.click('[data-home-document]'); time.sleep(0.4)
    # dvě části
    for label,heading in (('Článek 10','Obecné povinnosti výrobců'),('Článek 61','Klinické hodnocení')):
        p.click('#newUnit'); submit_dialog({'label':label,'heading':heading,'locator':label},{'kind':'article'})
    print('units:',toast_text())
    p.click('.unit-entry >> text=Článek 10'); time.sleep(0.3)
    # editor obsahu
    p.click('#rqEditContent'); time.sleep(0.4)
    ed=p.locator('[data-rq-editable-text]').first; ed.click(); p.keyboard.type('Výrobci provedou klinické hodnocení v souladu s článkem 61.')
    p.click('#rqSaveContent'); time.sleep(0.8); print('content:',toast_text())
    shot(p,'02-unit')
    p.click('#verifyText'); time.sleep(0.8); print('verify:',toast_text())
    p.click('.unit-entry >> text=Článek 61'); time.sleep(0.3)
    p.click('#rqEditContent'); time.sleep(0.4); p.locator('[data-rq-editable-text]').first.click(); p.keyboard.type('Klinické hodnocení se plánuje, provádí a dokumentuje.')
    p.click('#rqSaveContent'); time.sleep(0.8); p.click('#verifyText'); time.sleep(0.8)
    # struktura
    p.click('#rqEditStructure'); time.sleep(0.3); p.fill('#rqHeading','Klinické hodnocení a klinické zkoušky'); p.click('#rqSave'); time.sleep(0.8); print('structure:',toast_text())
    # vazba z čl. 10 na čl. 61
    p.click('.unit-entry >> text=Článek 10'); time.sleep(0.3)
    p.click('#addLink'); time.sleep(0.3)
    p.select_option('#relationDocument',index=1); time.sleep(0.2)
    p.select_option('#relationTarget',label='Článek 61 – Klinické hodnocení a klinické zkoušky')
    p.select_option('#relationType','references'); p.fill('#relationRationale','Výslovný odkaz na článek 61.')
    p.click('#relationSave'); time.sleep(0.8); print('relation:',toast_text())
    # komentář
    p.click('#addNote'); submit_dialog({'body':'Klinické hodnocení není totéž co klinická zkouška.'})
    print('comment:',toast_text())
    # schválení
    p.click('.nav-item[data-page=review]'); time.sleep(0.4); shot(p,'03-review')
    p.click('[data-r-approve]'); time.sleep(0.8); p.click('[data-c-approve]'); time.sleep(0.8); print('approve:',toast_text())
    # historie změn
    p.click('.nav-item[data-page=library]'); time.sleep(0.3); p.click('.unit-entry >> text=Článek 61'); time.sleep(0.3)
    p.click('#rqHistory'); time.sleep(0.3); p.click('[data-rq-history]'); time.sleep(0.6); shot(p,'04-history')
    print('history:',p.locator('.rq-history-item').count(),'items; compare:',p.locator('.rq-history-compare').count())
    p.click('#rqHistoryClose')
    # publikace
    p.click('.nav-item[data-page=publish]'); time.sleep(0.5); print('publishInfo:',p.inner_text('#publishInfo')[:120])
    p.fill('#publishNote','první zkouška'); p.click('#publishBtn'); time.sleep(1); print('publish:',toast_text())
    time.sleep(0.5); shot(p,'05-publish'); print('history pubs:',p.locator('#publishHistory .history-row').count())
    # přístupy
    p.click('.nav-item[data-page=access]'); time.sleep(0.8); shot(p,'06-access'); print('access tables:',p.locator('#accessContent table').count())
    # konflikt verzí: druhý admin mezitím změní
    print('errors:',errors)
    b.close()
