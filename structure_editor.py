"""RegulaQuest Studio 0.2.15: source-preserving structure and table editor.

No existing units, comments or relationships are deleted. Every edit is audited.
The student export receives rich blocks only after explicit verification.
"""
from __future__ import annotations
from html import escape as html_escape
from html.parser import HTMLParser
import datetime as dt
import json
import re
import secrets
import sqlite3

MIGRATION = '''
CREATE TABLE IF NOT EXISTS unit_rich_content (
 unit_id TEXT PRIMARY KEY REFERENCES units(id),
 blocks_json TEXT NOT NULL,
 updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS unit_editor_flags (
 unit_id TEXT PRIMARY KEY REFERENCES units(id),
 archived INTEGER NOT NULL DEFAULT 0,
 merged_into TEXT DEFAULT '',
 updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS unit_edit_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 unit_id TEXT NOT NULL REFERENCES units(id),
 event TEXT NOT NULL,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_unit_edit_history ON unit_edit_history(unit_id,id);
'''


def migrate(con):
    con.executescript(MIGRATION)


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='microseconds')


class InlineHTML(HTMLParser):
    """Only basic, inert inline formatting is accepted; pasted active HTML is discarded."""
    TAGS={'b','strong','i','em','u','br'}
    SKIP={'script','style','iframe','object','svg','math','form','template'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out=[];self.text=[];self.opened=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        tag=tag.lower()
        if tag in self.SKIP:
            self.skip+=1;return
        if self.skip:return
        if tag=='br':self.out.append('<br>');self.text.append('\n')
        elif tag in self.TAGS:self.out.append('<'+tag+'>');self.opened.append(tag)
        elif tag in ('p','div') and self.text and self.text[-1]!='\n':
            self.out.append('<br>');self.text.append('\n')
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
    def handle_endtag(self,tag):
        tag=tag.lower()
        if tag in self.SKIP:
            self.skip=max(0,self.skip-1);return
        if self.skip:return
        if tag in ('div','p'):
            if self.text and self.text[-1]!='\n':self.out.append('<br>');self.text.append('\n')
        if tag in self.opened:
            while self.opened:
                last=self.opened.pop();self.out.append('</'+last+'>')
                if last==tag:break
    def handle_data(self,data):
        if not self.skip:
            self.out.append(html_escape(data,quote=False));self.text.append(data)
    def close(self):
        super().close()
        while self.opened:self.out.append('</'+self.opened.pop()+'>')


def clean_html(source):
    if not isinstance(source,str) or len(source)>750_000:raise ValueError('Neplatný nebo příliš dlouhý formátovaný text')
    parser=InlineHTML();parser.feed(source);parser.close()
    return ''.join(parser.out),''.join(parser.text).strip('\n')


def validate_blocks(blocks):
    if not isinstance(blocks,list) or len(blocks)>100:raise ValueError('Obsah musí mít nejvýše 100 textových a tabulkových bloků')
    result=[];texts=[]
    for block in blocks:
        if not isinstance(block,dict):raise ValueError('Neplatný blok obsahu')
        kind=block.get('type')
        if kind=='text':
            html,plain=clean_html(block.get('html',''))
            result.append({'type':'text','html':html});texts.append(plain)
        elif kind=='table':
            rows=block.get('rows')
            if not isinstance(rows,list) or not (1<=len(rows)<=80):raise ValueError('Tabulka musí mít 1 až 80 řádků')
            newrows=[];used={};maxcol=0
            for r,row in enumerate(rows):
                if not isinstance(row,list) or len(row)>35:raise ValueError('Neplatný řádek tabulky')
                newrow=[];col=0
                for cell in row:
                    while (r,col) in used:col+=1
                    if not isinstance(cell,dict):raise ValueError('Neplatná buňka tabulky')
                    cs=cell.get('colspan',1);rs=cell.get('rowspan',1)
                    if type(cs)!=int or type(rs)!=int or not 1<=cs<=30 or not 1<=rs<=30 or r+rs>len(rows):
                        raise ValueError('Neplatné sloučení buněk')
                    if col+cs>35:raise ValueError('Tabulka může mít nejvýše 35 sloupců')
                    for rr in range(r,r+rs):
                        for cc in range(col,col+cs):
                            if (rr,cc) in used:raise ValueError('Buňky tabulky se překrývají')
                            used[(rr,cc)]=True
                    value=cell.get('text','')
                    if not isinstance(value,str) or len(value)>10000:raise ValueError('Neplatný text buňky')
                    align=cell.get('align','left')
                    if align not in ('left','center','right'):raise ValueError('Neznámé zarovnání')
                    newrow.append({'text':value,'header':bool(cell.get('header',False)),
                                   'align':align,'colspan':cs,'rowspan':rs})
                    col+=cs
                maxcol=max(maxcol,col)
                newrows.append(newrow)
            if not maxcol or maxcol>35:raise ValueError('Prázdná nebo příliš široká tabulka')
            # Every occupied grid position must be covered, and row widths must agree.
            for r in range(len(rows)):
                for c in range(maxcol):
                    if (r,c) not in used:raise ValueError('Tabulka obsahuje mezeru v mřížce; upravte sloučené buňky')
            caption=block.get('caption','');notes=block.get('notes','')
            if not isinstance(caption,str) or not isinstance(notes,str) or len(caption)>400 or len(notes)>4000:
                raise ValueError('Příliš dlouhý nadpis nebo poznámka tabulky')
            result.append({'type':'table','caption':caption,'rows':newrows,'notes':notes})
            texts.append('\n'.join([caption]+[' | '.join(cell['text'] for cell in row) for row in newrows]+[notes]).strip())
        else:raise ValueError('Nepodporovaný typ bloku')
    body='\n\n'.join(t for t in texts if t.strip()).strip()
    if len(body)>450_000:raise ValueError('Obsah je příliš dlouhý')
    return result,body


def unit_state(con,unit_id):
    u=con.execute('SELECT * FROM units WHERE id=?',(unit_id,)).fetchone()
    if not u:raise ValueError('Ustanovení neexistuje')
    rich=con.execute('SELECT blocks_json FROM unit_rich_content WHERE unit_id=?',(unit_id,)).fetchone()
    flags=con.execute('SELECT archived,merged_into FROM unit_editor_flags WHERE unit_id=?',(unit_id,)).fetchone()
    return {'unit':dict(u), 'blocks':json.loads(rich['blocks_json']) if rich else None,
            'archived':bool(flags['archived']) if flags else False,
            'merged_into':flags['merged_into'] if flags else ''}


def assert_current(con,id,expected):
    s=unit_state(con,id)
    if s['archived']:raise ValueError('Tato část je po sloučení archivovaná')
    if not expected or s['unit']['updated_at']!=expected:
        raise ValueError('Ustanovení se mezitím změnilo. Načtěte jeho aktuální znění.')
    return s


def log(con,unit_id,event,before,after,reason):
    con.execute('INSERT INTO unit_edit_history(unit_id,event,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?)',
                (unit_id,event,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),reason,stamp()))


def body_change(con,id,new_body,source_note='Redakční úprava struktury nebo obsahu'):
    old=con.execute('SELECT source_note FROM units WHERE id=?',(id,)).fetchone()
    oldnote=old['source_note'] if old else ''
    if oldnote and 'Původní zdroj:' not in oldnote:
        source_note+=' · Původní zdroj: '+oldnote[:600]
    elif oldnote and 'Původní zdroj:' in oldnote:
        source_note=oldnote[:900]
    con.execute("UPDATE units SET body=?,text_status=?,source_note=?,updated_at=? WHERE id=?",
                (new_body,'needs_review' if new_body.strip() else 'missing',source_note,stamp(),id))


def invalidate_approval(con,affected_ids):
    """Preserve IDs and history, but re-review annotations affected by changed content."""
    if not affected_ids:return
    pl=','.join('?' for _ in affected_ids)
    rels=con.execute(f"SELECT * FROM relations WHERE status='approved' AND (source_id IN ({pl}) OR target_id IN ({pl}))",
                     (*affected_ids,*affected_ids)).fetchall()
    for item in rels:
        old=dict(item)
        con.execute("UPDATE relations SET status='proposed',updated_at=? WHERE id=?",(stamp(),item['id']))
        after=dict(con.execute('SELECT * FROM relations WHERE id=?',(item['id'],)).fetchone())
        con.execute('INSERT INTO relation_history(relation_id,event_type,before_json,after_json,created_at) VALUES(?,?,?,?,?)',
                    (item['id'],'unit_content_changed',json.dumps(old,ensure_ascii=False),json.dumps(after,ensure_ascii=False),stamp()))
    # Pending revisions based on the old approved content are now stale.
    for item in rels:
        con.execute("UPDATE relation_revisions SET status='rejected',reviewed_at=? WHERE relation_id=? AND status='proposed'",(stamp(),item['id']))
    comments=con.execute(f"SELECT * FROM comments WHERE status='approved' AND unit_id IN ({pl})",affected_ids).fetchall()
    for item in comments:
        old=dict(item)
        con.execute("UPDATE comments SET status='draft',updated_at=? WHERE id=?",(stamp(),item['id']))
        after=dict(con.execute('SELECT * FROM comments WHERE id=?',(item['id'],)).fetchone())
        con.execute('INSERT INTO comment_history(comment_id,event_type,before_json,after_json,created_at) VALUES(?,?,?,?,?)',
                    (item['id'],'unit_content_changed',json.dumps(old,ensure_ascii=False),json.dumps(after,ensure_ascii=False),stamp()))
        con.execute("UPDATE comment_revisions SET status='rejected',reviewed_at=? WHERE comment_id=? AND status='proposed'",(stamp(),item['id']))


def erase_rich(con,id):
    con.execute('DELETE FROM unit_rich_content WHERE unit_id=?',(id,))


def change_content(con,payload):
    id=payload.get('unit_id','');before=assert_current(con,id,payload.get('expected_updated_at'))
    blocks,body=validate_blocks(payload.get('blocks'))
    if body==before['unit']['body'] and blocks==before['blocks']:
        return {'changed':False}
    con.execute('INSERT INTO unit_rich_content(unit_id,blocks_json,updated_at) VALUES(?,?,?) ON CONFLICT(unit_id) DO UPDATE SET blocks_json=excluded.blocks_json,updated_at=excluded.updated_at',
                (id,json.dumps(blocks,ensure_ascii=False),stamp()))
    body_change(con,id,body)
    invalidate_approval(con,[id])
    log(con,id,'edit_content',before,unit_state(con,id),payload.get('reason','Úprava obsahu a tabulek')[:400])
    return {'changed':True}


def modify_structure(con,payload):
    id=payload.get('unit_id','');before=assert_current(con,id,payload.get('expected_updated_at'))
    u=before['unit'];doc=u['document_id']
    label=str(payload.get('label',u['label'])).strip()
    heading=str(payload.get('heading',u['heading'])).strip()
    locator=str(payload.get('locator',u['locator'])).strip()
    kind=str(payload.get('kind',u['kind'])).strip()
    parent=payload.get('parent_id') or None
    if kind not in ('article','paragraph','annex','rule','section','chapter','part','point','other'):
        raise ValueError('Nepodporovaný typ části')
    if not label or len(label)>240 or len(heading)>500 or len(locator)>300:raise ValueError('Neplatné označení či nadpis')
    if parent:
        p=con.execute('SELECT id,parent_id,document_id FROM units WHERE id=?',(parent,)).fetchone()
        if not p or p['document_id']!=doc:raise ValueError('Rodič musí být ve stejném dokumentu')
        seen={id}
        while p:
            if p['id'] in seen:raise ValueError('Struktura by obsahovala cyklus')
            seen.add(p['id']);p=con.execute('SELECT id,parent_id,document_id FROM units WHERE id=?',(p['parent_id'],)).fetchone() if p['parent_id'] else None
    order=payload.get('sort_order',u['sort_order'])
    if type(order)!=int or abs(order)>9_000_000_000_000_000:raise ValueError('Neplatné pořadí')
    changed=any([label!=u['label'],heading!=u['heading'],locator!=u['locator'],kind!=u['kind'],parent!=u['parent_id'],order!=u['sort_order']])
    if not changed:return {'changed':False}
    con.execute('UPDATE units SET label=?,heading=?,locator=?,kind=?,parent_id=?,sort_order=?,text_status=?,updated_at=? WHERE id=?',
                (label,heading,locator,kind,parent,order,'needs_review' if u['body'].strip() else 'missing',stamp(),id))
    # Manual structural fixes must not be overwritten as 'automatic import' later.
    con.execute("UPDATE units SET source_note=? WHERE id=?",('Redakčně upravená struktura; původní zdroj: '+(u['source_note'] or '')[:700],id))
    # A relocated/renamed ancestor can also change the interpretation of its children.
    # Keep their IDs, but require fresh verification and review of associated annotations.
    affected=[id]
    if parent!=u['parent_id'] or label!=u['label'] or kind!=u['kind']:
        queue=[id]
        while queue:
            current=queue.pop(0)
            for row in con.execute('SELECT id FROM units WHERE parent_id=?',(current,)).fetchall():
                child_id=row['id']
                if child_id not in affected:
                    affected.append(child_id);queue.append(child_id)
        for child_id in affected[1:]:
            childbefore=unit_state(con,child_id)
            if childbefore['unit']['text_status']=='verified':
                con.execute('UPDATE units SET text_status=?,updated_at=? WHERE id=?',
                            ('needs_review' if childbefore['unit']['body'].strip() else 'missing',stamp(),child_id))
            log(con,child_id,'ancestor_structure_changed',childbefore,unit_state(con,child_id),
                'Změna nadřazené části '+id)
    invalidate_approval(con,affected)
    log(con,id,'edit_structure',before,unit_state(con,id),payload.get('reason','Úprava struktury')[:400])
    return {'changed':True,'affected':affected}


def _same_document(a,b):
    if a['unit']['document_id']!=b['unit']['document_id']:raise ValueError('Přesun je dovolen pouze uvnitř jednoho dokumentu')


def _text_surgery(con,change_set,event,reason,allow_flatten=False):
    # Editing the plain text cannot preserve separately structured tables or styles.
    # The operator must explicitly accept format flattening; tables require the block editor.
    for original,_,_,_ in change_set:
        blocks=original['blocks'] or []
        if any(b.get('type')=='table' for b in blocks):
            raise ValueError('Ustanovení obsahuje strukturovanou tabulku. Přesun/rozdělení přes surový text by ji zničil; upravte obsah v Editoru textu a tabulek.')
        if blocks and not allow_flatten:
            raise ValueError('Text má základní formátování. Pro převod na prostý text je nutné explicitní potvrzení.')
    affected=[]
    for original,body,archived,target in change_set:
        id=original['unit']['id']
        erase_rich(con,id)
        body_change(con,id,body)
        if archived:
            con.execute('INSERT INTO unit_editor_flags(unit_id,archived,merged_into,updated_at) VALUES(?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET archived=excluded.archived, merged_into=excluded.merged_into,updated_at=excluded.updated_at',
                        (id,1,target,stamp()))
        affected.append(id)
    invalidate_approval(con,affected)
    for original,_,_,_ in change_set:
        id=original['unit']['id'];log(con,id,event,original,unit_state(con,id),reason)
    return {'changed':True,'affected':affected}


def split_unit(con,payload):
    source=assert_current(con,payload.get('unit_id',''),payload.get('expected_updated_at'))
    u=source['unit'];index=payload.get('index')
    if type(index)!=int or index<=0 or index>=len(u['body']):raise ValueError('Vyberte místo rozdělení uvnitř textu')
    left=u['body'][:index].rstrip();right=u['body'][index:].lstrip()
    if not left or not right:raise ValueError('Obě části musí mít text')
    label=str(payload.get('new_label','')).strip()
    if not label or len(label)>240:raise ValueError('Zadejte označení nové části')
    heading=str(payload.get('new_heading','')).strip()[:500]
    newid='unit-'+secrets.token_hex(7)
    order=u['sort_order']+1
    # Insert a new sibling; keep parent and any attached relations at the original ID.
    con.execute('INSERT INTO units(id,document_id,parent_id,kind,label,heading,body,locator,text_status,source_note,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (newid,u['document_id'],u['parent_id'],u['kind'],label,heading,right,
                 str(payload.get('new_locator','')).strip()[:300] or u['locator'],'needs_review','Odděleno z '+u['id'],order,stamp()))
    _text_surgery(con,[(source,left,False,'')],'split_unit',payload.get('reason','Rozdělení ustanovení')[:400],payload.get('confirm_flatten_rich') is True)
    log(con,newid,'created_by_split',{'source_id':u['id']},unit_state(con,newid),payload.get('reason','Rozdělení ustanovení')[:400])
    return {'changed':True,'created_unit_id':newid}


def move_text(con,payload):
    source=assert_current(con,payload.get('unit_id',''),payload.get('expected_updated_at'))
    target=assert_current(con,payload.get('target_id',''),payload.get('target_updated_at'))
    _same_document(source,target)
    if source['unit']['id']==target['unit']['id']:raise ValueError('Nelze přesunout text do stejné části')
    fragment=payload.get('fragment','')
    if not isinstance(fragment,str) or not fragment.strip() or len(fragment)>300_000:raise ValueError('Vyberte úryvek k přesunu')
    text=source['unit']['body']
    if text.count(fragment)!=1:raise ValueError('Úryvek musí být ve zdroji přesně jednou; vyberte delší souvislou část')
    left=text.replace(fragment,'',1).strip()
    right=(target['unit']['body'].rstrip()+'\n\n'+fragment.strip()).strip()
    return _text_surgery(con,[(source,left,False,''),(target,right,False,'')],
                         'move_text',payload.get('reason','Přesun části textu')[:400],payload.get('confirm_flatten_rich') is True)


def merge_units(con,payload):
    source=assert_current(con,payload.get('unit_id',''),payload.get('expected_updated_at'))
    target=assert_current(con,payload.get('target_id',''),payload.get('target_updated_at'))
    _same_document(source,target)
    if source['unit']['id']==target['unit']['id']:raise ValueError('Nelze sloučit stejnou část')
    if con.execute('SELECT 1 FROM units WHERE parent_id=? LIMIT 1',(source['unit']['id'],)).fetchone():
        raise ValueError('Zdroj obsahuje podřazené části. Nejprve je přesuňte.')
    newbody='\n\n'.join(x for x in [target['unit']['body'].strip(),source['unit']['body'].strip()] if x)
    if not newbody:raise ValueError('Nelze sloučit dvě prázdné části')
    return _text_surgery(con,[(source,'',True,target['unit']['id']),(target,newbody,False,'')],
                         'merge_unit',payload.get('reason','Sloučení ustanovení')[:400],payload.get('confirm_flatten_rich') is True)


def enrich(con,data):
    rich={r['unit_id']:json.loads(r['blocks_json']) for r in con.execute('SELECT unit_id,blocks_json FROM unit_rich_content')}
    flags={r['unit_id']:dict(r) for r in con.execute('SELECT * FROM unit_editor_flags')}
    for u in data['units']:
        u['content_blocks']=rich.get(u['id'])
        u['editor_archived']=bool(flags.get(u['id'],{}).get('archived'))
        u['merged_into']=flags.get(u['id'],{}).get('merged_into','')
    data['unit_edit_history']=[dict(r) for r in con.execute('SELECT id,unit_id,event,reason,created_at FROM unit_edit_history ORDER BY id DESC LIMIT 250')]


def handle(con,payload):
    action=payload['action']
    if action=='save_unit_content':return change_content(con,payload)
    if action=='edit_unit_structure':return modify_structure(con,payload)
    if action=='split_unit':return split_unit(con,payload)
    if action=='move_unit_text':return move_text(con,payload)
    if action=='merge_units':return merge_units(con,payload)
    raise ValueError('Neznámá akce editoru')
