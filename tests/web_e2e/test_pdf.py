import time, psycopg
from playwright.sync_api import sync_playwright
DB="host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox']);p=b.new_page(viewport={'width':1400,'height':900})
    err=[];p.on('pageerror',lambda e:err.append(str(e)));p.on('dialog',lambda d:d.accept());p.on('console',lambda m: m.type=='error' and err.append(m.text[:150]))
    p.goto('http://127.0.0.1:8765/studio/');p.fill('#rqUser','vojta');p.fill('#rqPass','Heslo12345AB');p.click('button[type=submit]');p.wait_for_selector('#page-home');time.sleep(0.8)
    p.click('#homeNewDoc')
    for k,v in {'title':'MDCG 2021-24 Rev.1 Guidance on classification of medical devices','family':'MDCG 2021-24','version':'Rev.1, April 2026'}.items(): p.fill(f'#modalContent [name={k}]',v)
    p.select_option('#modalContent [name=kind]','Metodický dokument');p.select_option('#modalContent [name=language]','en')
    p.click('#modalContent button[type=submit]');time.sleep(1)
    p.click('#homeImport');time.sleep(0.3);p.select_option('#modalContent [name=doc]',label=p.locator('#modalContent [name=doc] option',has_text='MDCG').first.inner_text())
    p.set_input_files('#impFile','podklady/MDCG_2021-24_rev1.pdf');p.click('#impCheck')
    p.wait_for_function("!document.querySelector('#impGo').disabled || document.querySelector('#impReport').textContent.includes('Chyba')",timeout=60000)
    print(p.inner_text('#impReport')[:400].replace('\n',' | '))
    t=time.time();p.click('#impGo')
    try: p.wait_for_function("!document.querySelector('#modal').open",timeout=120000)
    except Exception: print('STILL OPEN',p.inner_text('#impReport')[:300]); raise
    print('import s',round(time.time()-t,1),p.inner_text('#toast'))
    with psycopg.connect(DB) as c:
        print(c.execute("select count(*), count(*) filter (where content_blocks is not null) from units u join documents d on d.id=u.document_id where d.family like 'MDCG%%'").fetchone())
        print(c.execute("select storage_path,mime from source_files where storage_path like '%%.pdf'").fetchall())
    p.fill('#filter','Rule 5');time.sleep(0.5);p.locator('.unit-entry',has_text='Rule 5').first.click();time.sleep(0.8)
    p.screenshot(path='/tmp/20-mdcg-rule5.png',full_page=False)
    p.fill('#filter','Invasive devices');time.sleep(0.5);p.locator('.unit-entry',has_text='Invasive devices').first.click();time.sleep(0.6)
    print('figs in reader',p.locator('#reader img[data-fig]').count())
    p.click('#rqEditContent');time.sleep(0.6);p.screenshot(path='/tmp/21-editor-fig.png');print('editor figs',p.locator('#rqBlocks img[data-fig]').count())
    print(err)
