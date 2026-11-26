import time, psycopg
from playwright.sync_api import sync_playwright
DB="host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox']);p=b.new_page(viewport={'width':1400,'height':900})
    err=[];p.on('pageerror',lambda e:err.append(str(e)));p.on('dialog',lambda d:d.accept())
    p.goto('http://127.0.0.1:8765/studio/');p.fill('#rqUser','vojta');p.fill('#rqPass','Heslo12345AB');p.click('button[type=submit]');p.wait_for_selector('#page-home');time.sleep(0.5)
    p.click('#homeNewDoc')
    for k,v in {'title':'MDR','family':'MDR','version':'x'}.items(): p.fill(f'#modalContent [name={k}]',v)
    p.click('#modalContent button[type=submit]');time.sleep(0.8)
    def imp(path,shot):
        p.click('#homeImport' if p.is_visible('#homeImport') else '#importBtn');time.sleep(0.3)
        p.set_input_files('#impFile',path);p.click('#impCheck');p.wait_for_function("!document.querySelector('#impGo').disabled || document.querySelector('#impReport').textContent.includes('Chyba')",timeout=20000)
        print(p.inner_text('#impReport')[:700].replace('\n',' | '));p.screenshot(path=f'/tmp/{shot}.png')
        t=time.time();p.click('#impGo')
        try: p.wait_for_function("!document.querySelector('#modal').open",timeout=90000)
        except Exception: print('STILL OPEN:',p.inner_text('#impReport')[:500]); raise;print('import s',round(time.time()-t,1),'toast:',p.inner_text('#toast'))
    imp('podklady/MDR_CS_20260719.html','10-import-check')
    with psycopg.connect(DB) as c:
        print('units',c.execute("select count(*), count(*) filter (where text_status='needs_review') from units").fetchone(),
              'amend',c.execute("select count(*) from amendments").fetchone()[0],'marks',c.execute("select count(*) from unit_amendments").fetchone()[0],
              'src',c.execute("select storage_path from source_files").fetchone(),'doc',c.execute("select version,url from documents").fetchone(),
              'log',c.execute("select added,protected from import_log").fetchall())
        # ověřit čl. 1 a čl. 2 přímo (simulace práce redaktora)
        c.execute("update units set text_status='verified' where label in ('Článek 1','Článek 2')")
    p.click('#refreshTop');time.sleep(1.5)
    imp('/tmp/MDR_CS_upraveno.html','11-import-update')
    with psycopg.connect(DB) as c:
        print(c.execute("select label,text_status,archived from units where label in ('Článek 1','Článek 2','Článek 123') and kind='article' order by sort_order").fetchall())
        print('hist',c.execute("select event,count(*) from unit_edit_history group by 1").fetchall(),'log',c.execute("select added,replaced,protected,warnings->>-1 from import_log order by id").fetchall())
    p.screenshot(path='/tmp/12-after.png')
    print('errors',err)
