# Editor scénářů simulací ve Studiu: všechny záložky ukázkového scénáře, nový scénář složený jen klikáním (bez JSON),
# skládačka podmínek, efekty, šablony balíčku, uložení a kontrola výsledné definice. Spouštět po test_simulace.py.
import json, time, psycopg
from playwright.sync_api import sync_playwright
DSN = "host=/tmp/pg port=5544 user=postgres dbname=rqe2e"
c = psycopg.connect(DSN, autocommit=True)
c.execute("delete from sim_scenarios where id <> 'vigilance-infuzni-pumpa'")
errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': 1500, 'height': 1000}); p.on('pageerror', lambda e: errs.append(str(e)))
    p.on('dialog', lambda d: d.accept())
    p.goto('http://127.0.0.1:8765/studio/'); p.fill('#rqUser', 'vojta'); p.fill('#rqPass', 'Heslo12345AB'); p.click('button[type=submit]')
    p.wait_for_selector('#page-home'); time.sleep(0.8)
    p.click('#spaces [data-space=sim]'); time.sleep(1)
    p.click('.sim-sc [data-edit]'); time.sleep(0.6)
    seen = []
    for t in ['base', 'ind', 'msg', 'act', 'ev', 'rule', 'time', 'json']:
        p.click(f'.se-tabs [data-tab={t}]'); time.sleep(0.3); seen.append(t + ':' + str(p.locator('.se-body').inner_text().__len__() > 50))
    print('záložky:', ' '.join(seen), '| kontrola:', p.locator('.se-check .ok').count() == 1)
    p.click('.se-tabs [data-tab=ev]'); time.sleep(0.3); p.locator('.se-card summary').nth(3).click(); time.sleep(0.3)
    p.screenshot(path='/tmp/e1-events.png', full_page=True)
    p.click('.se-tabs [data-tab=time]'); time.sleep(0.3); p.screenshot(path='/tmp/e2-timeline.png', full_page=True)
    p.click('[data-back]'); time.sleep(0.6)
    # nový scénář jen klikáním
    p.click('#simNew'); time.sleep(0.3); p.select_option('#snMod', 'vigilance'); p.click('[data-blank]'); time.sleep(0.5)
    p.fill('[data-k="title"]', 'Testovací scénář z editoru'); p.fill('[data-k="role"]', 'Výrobce')
    p.fill('[data-k="time.rate"]', '6'); p.locator('[data-k="time.rate"]').dispatch_event('change'); time.sleep(0.3)
    print('rychlost:', p.locator('.se-body .fine').first.inner_text())
    p.click('.se-tabs [data-tab=ind]'); p.click('[data-addind]'); time.sleep(0.3)
    p.fill('[data-k="indicators.0.var"]', 'rozpocet'); p.fill('[data-k="indicators.0.label"]', 'Rozpočet'); p.fill('[data-k="indicators.0.start"]', '100000')
    p.click('.se-tabs [data-tab=msg]'); time.sleep(0.3); p.locator('.se-card summary').first.click()
    p.fill('[data-k="messages.m1.subject"]', 'Hlášení z nemocnice'); p.fill('[data-k="messages.m1.body"]', 'Pumpa podala vyšší dávku.')
    p.click('[data-addmsg]'); time.sleep(0.3); p.fill('[data-k="messages.m2.subject"]', 'Druhá nemocnice hlásí totéž')
    p.click('.se-tabs [data-tab=act]'); time.sleep(0.3)
    p.select_option('[data-tpl]', label='Podat hlášení příslušnému orgánu (SÚKL)'); time.sleep(0.4)
    p.select_option('[data-tpl]', label='Zahájit bezpečnostní nápravné opatření (FSCA)'); time.sleep(0.4)
    # efekt akce FSCA: sníží rozpočet
    fsca = p.locator('details.se-card', has_text='Zahájit bezpečnostní nápravné')
    fsca.locator('[data-eff-add="add"]').last.select_option('rozpocet'); time.sleep(0.3)
    fsca = p.locator('details.se-card', has_text='Zahájit bezpečnostní nápravné')
    fsca.locator('[data-eff-num="rozpocet"]').fill('-40000'); fsca.locator('[data-eff-num="rozpocet"]').dispatch_event('change')
    print('akce:', p.locator('.se-card > summary b').all_inner_texts())
    p.click('.se-tabs [data-tab=ev]'); time.sleep(0.3); p.click('[data-addev]'); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    ev.locator('[data-k="events.0.label"]').fill('Druhá příhoda')
    ev.locator('[data-k="events.0.window_days.0"]').fill('5'); ev.locator('[data-k="events.0.window_days.1"]').fill('8')
    ev.locator('[data-prob="0"]').fill('70'); ev.locator('[data-prob="0"]').dispatch_event('change')
    ev.locator('[data-cond-on]').click(); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    ev.locator('[data-row-add]').select_option('act'); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    row = ev.locator('.se-row').first; row.locator('[data-r="a"]').select_option(label='Zahájit bezpečnostní nápravné opatření (FSCA)'); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    ev.locator('.se-row').first.locator('[data-r="op"]').select_option('notstarted'); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    ev.locator('[data-eff-add="messages"]').first.select_option(label='Druhá nemocnice hlásí totéž'); time.sleep(0.3)
    ev = p.locator('details.se-card').last
    ev.locator('[data-eff-add="set"]').first.fill('druha'); ev.locator('[data-eff-add="set"]').first.press('Enter'); time.sleep(0.3)
    p.click('.se-tabs [data-tab=rule]'); time.sleep(0.3); p.click('[data-addrule]'); time.sleep(0.3)
    ru = p.locator('details.se-card').last
    ru.locator('[data-k="rules.0.label"]').fill('Hlášení do 15 dnů')
    ru.locator('.se-cond').first.locator('[data-row-add]').select_option('act'); time.sleep(0.3)
    ru = p.locator('details.se-card').last
    r0 = ru.locator('.se-cond').first.locator('.se-row').first
    r0.locator('[data-r="a"]').select_option(label='Podat hlášení příslušnému orgánu (SÚKL)'); time.sleep(0.3)
    ru = p.locator('details.se-card').last; r0 = ru.locator('.se-cond').first.locator('.se-row').first
    r0.locator('[data-r="op"]').select_option('done_by'); time.sleep(0.3)
    ru = p.locator('details.se-card').last; r0 = ru.locator('.se-cond').first.locator('.se-row').first
    r0.locator('[data-r="d"]').fill('15'); r0.locator('[data-r="d"]').dispatch_event('change'); time.sleep(0.3)
    ru = p.locator('details.se-card').last
    ru.locator('.se-cond').first.locator('[data-row-add]').select_option('answer'); time.sleep(0.3)
    ru = p.locator('details.se-card').last; r1 = ru.locator('.se-cond').first.locator('.se-row').nth(1)
    r1.locator('[data-r="v"]').select_option(label='Podat hlášení příslušnému orgánu (SÚKL) → Klasifikace'); time.sleep(0.3)
    ru = p.locator('details.se-card').last; r1 = ru.locator('.se-cond').first.locator('.se-row').nth(1)
    r1.locator('[data-r="val"]').select_option('serious'); time.sleep(0.3)
    ru = p.locator('details.se-card').last
    ru.locator('[data-addref="0"]').fill('MDR|Článek 87'); ru.locator('[data-addref="0"]').press('Enter'); time.sleep(0.3)
    p.screenshot(path='/tmp/e3-rule.png', full_page=True)
    print('kontrola nového:', p.locator('.se-check').inner_text().replace('\n', ' | ')[:300])
    p.click('[data-save]'); time.sleep(1)
    d = c.execute("select definition from sim_scenarios where title = 'Testovací scénář z editoru'").fetchone()[0]
    print('uloženo – akce:', [a['label'] for a in d['actions']])
    print('událost:', json.dumps(d['events'][0], ensure_ascii=False))
    print('pravidlo:', json.dumps(d['rules'][0]['ok'], ensure_ascii=False), d['rules'][0].get('refs'))
    print('efekt FSCA:', [a.get('add') for a in d['actions'] if 'FSCA' in a['label']], '| ukazatel:', d['indicators'])
    print('stav po uložení:', p.locator('.se-top .fine').inner_text())
print('chyby:', errs or 'žádné')
