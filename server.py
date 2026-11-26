#!/usr/bin/env python3
"""RegulaQuest Studio – local-only redaction, structural audit, tables."""
from __future__ import annotations
import argparse
import base64
from importer import parse_source
from reference_suggest import suggest_explicit_links
from related_search import find_related, find_related_bulk
import structure_editor
import datetime as dt
from contextlib import contextmanager
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, parse_qs
import webbrowser
import threading

VERSION = '0.3.0'
ROOT = Path(__file__).resolve().parent
APP = ROOT / 'app'
READER = ROOT / 'reader'
READER_DATA = READER / 'data' / 'regulaquest-student-data.json'
DATA = ROOT / 'data'
DB = DATA / 'regulaquest.sqlite3'
CSRF = secrets.token_urlsafe(32)
SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, family TEXT NOT NULL, kind TEXT NOT NULL,
 language TEXT NOT NULL, version TEXT NOT NULL, valid_date TEXT DEFAULT '',
 publisher TEXT DEFAULT '', url TEXT DEFAULT '', status TEXT DEFAULT 'reference',
 created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS units (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
 parent_id TEXT REFERENCES units(id), kind TEXT NOT NULL, label TEXT NOT NULL,
 heading TEXT DEFAULT '', body TEXT NOT NULL DEFAULT '', locator TEXT DEFAULT '',
 text_status TEXT NOT NULL DEFAULT 'missing', source_note TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
 updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (
 id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id),
 kind TEXT NOT NULL, language TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft', author TEXT DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES units(id), target_id TEXT NOT NULL REFERENCES units(id),
 relation_type TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '', evidence TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'proposed', provenance TEXT DEFAULT 'manual', updated_at TEXT NOT NULL,
 UNIQUE(source_id, target_id, relation_type));
CREATE TABLE IF NOT EXISTS amendments (
 document_id TEXT NOT NULL REFERENCES documents(id), marker TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(document_id,marker));
CREATE TABLE IF NOT EXISTS unit_amendments (
 unit_id TEXT NOT NULL REFERENCES units(id), marker TEXT NOT NULL,
 PRIMARY KEY(unit_id,marker));
CREATE TABLE IF NOT EXISTS source_files (
 document_id TEXT PRIMARY KEY REFERENCES documents(id),
 sha256 TEXT NOT NULL, filename TEXT NOT NULL, saved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL,
 filename TEXT NOT NULL, sha256 TEXT NOT NULL, format TEXT NOT NULL,
 added INTEGER NOT NULL, updated INTEGER NOT NULL, protected INTEGER NOT NULL,
 warnings TEXT NOT NULL, imported_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_units_doc ON units(document_id,sort_order);
CREATE INDEX IF NOT EXISTS ix_comments_unit ON comments(unit_id);
CREATE INDEX IF NOT EXISTS ix_rel_src ON relations(source_id);
CREATE INDEX IF NOT EXISTS ix_rel_dst ON relations(target_id);
CREATE TABLE IF NOT EXISTS relation_revisions (
 id TEXT PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relations(id),
 change_type TEXT NOT NULL CHECK(change_type IN ('edit','archive')),
 source_id TEXT NOT NULL REFERENCES units(id), target_id TEXT NOT NULL REFERENCES units(id),
 relation_type TEXT NOT NULL, rationale TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '',
 change_reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
 base_updated_at TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_relation_revisions_relation ON relation_revisions(relation_id,status);
CREATE TABLE IF NOT EXISTS document_metadata (
 document_id TEXT PRIMARY KEY REFERENCES documents(id),
 group_key TEXT NOT NULL, jurisdiction TEXT NOT NULL DEFAULT 'other',
 document_type TEXT NOT NULL DEFAULT 'other', topics_json TEXT NOT NULL DEFAULT '[]',
 updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_document_metadata_group ON document_metadata(group_key);
CREATE TABLE IF NOT EXISTS relation_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, relation_id TEXT NOT NULL REFERENCES relations(id),
 event_type TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '',
 after_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_relation_history_rel ON relation_history(relation_id,id);
CREATE TABLE IF NOT EXISTS comment_revisions (
 id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES comments(id),
 change_type TEXT NOT NULL CHECK(change_type IN ('edit','archive','restore')),
 kind TEXT NOT NULL, language TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL,
 change_reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
 base_updated_at TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_comment_revisions_comment ON comment_revisions(comment_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS ix_comment_pending_unique ON comment_revisions(comment_id) WHERE status='proposed';
CREATE TABLE IF NOT EXISTS comment_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id TEXT NOT NULL REFERENCES comments(id),
 event_type TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '',
 after_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_comment_history_comment ON comment_history(comment_id,id);
'''

def now(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
@contextmanager
def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        with con:
            yield con
    finally:
        con.close()

def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)
        structure_editor.migrate(con)
        # Add taxonomy metadata without mutating existing documents or approved content.
        for d in con.execute('SELECT id,family,kind FROM documents').fetchall():
            if d['id'] in ('mdr-cs','mdr-en'):
                group, jur, kind, tags = 'eu-2017-745','eu','regulation',['zdravotnické prostředky','MDR']
            elif d['id']=='mdcg-2021-24-en':
                group, jur, kind, tags = 'mdcg-2021-24','eu','guidance',['zdravotnické prostředky','klasifikace']
            else:
                group, jur, kind, tags = d['id'],'other','other',[]
            con.execute('INSERT OR IGNORE INTO document_metadata (document_id,group_key,jurisdiction,document_type,topics_json,updated_at) VALUES (?,?,?,?,?,?)',
                        (d['id'],group,jur,kind,json.dumps(tags,ensure_ascii=False),now()))
        # Existing comments are preserved; create a provenance baseline on first migration.
        for comment in con.execute('SELECT * FROM comments WHERE id NOT IN (SELECT comment_id FROM comment_history)').fetchall():
            con.execute('INSERT INTO comment_history (comment_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?)',
                        (comment['id'],'baseline','',json.dumps(dict(comment),ensure_ascii=False),now()))
        # Migration without replacing the existing SQLite database.
        # The baseline captures approved links that predate history tracking.
        for relation in con.execute('SELECT * FROM relations WHERE id NOT IN (SELECT relation_id FROM relation_history)').fetchall():
            con.execute('INSERT INTO relation_history (relation_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?)',
                        (relation['id'],'baseline','',json.dumps(dict(relation),ensure_ascii=False),now()))
        if con.execute('SELECT COUNT(*) FROM documents').fetchone()[0]: return
        docs = [
          ('mdr-cs','Nařízení (EU) 2017/745 – zdravotnické prostředky','MDR','Právní předpis','cs','19. 7. 2026','2026-07-19','Evropský parlament a Rada','https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:02017R0745-20260719','reference'),
          ('mdr-en','Regulation (EU) 2017/745 – medical devices','MDR','Legal act','en','19 July 2026','2026-07-19','European Parliament and Council','https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02017R0745-20260719','reference'),
          ('mdcg-2021-24-en','MDCG 2021-24 rev. 1 – Guidance on classification of medical devices','MDCG 2021-24','Metodický dokument','en','rev. 1 · April 2026','2026-04-20','Medical Device Coordination Group','https://health.ec.europa.eu/system/files/2021-10/mdcg_2021-24_en_0.pdf','reference')]
        con.executemany('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)', [(*d,now()) for d in docs])
        for doc_id,group,jur,kind,tags in (
          ('mdr-cs','eu-2017-745','eu','regulation',['zdravotnické prostředky','MDR']),
          ('mdr-en','eu-2017-745','eu','regulation',['zdravotnické prostředky','MDR']),
          ('mdcg-2021-24-en','mdcg-2021-24','eu','guidance',['zdravotnické prostředky','klasifikace'])):
            con.execute('INSERT OR IGNORE INTO document_metadata VALUES (?,?,?,?,?,?)',
                        (doc_id,group,jur,kind,json.dumps(tags,ensure_ascii=False),now()))

        units = []
        def add(id,doc,parent,kind,label,heading='',locator='',order=0):
            units.append((id,doc,parent,kind,label,heading,'','missing','',order,now(),locator))
        for lang in ('cs','en'):
            pre='mdr-'+lang
            for n,titlecs,titleen in [(1,'Předmět a oblast působnosti','Subject matter and scope'),(2,'Definice','Definitions'),(10,'Obecné povinnosti výrobců','General obligations of manufacturers'),(52,'Postupy posuzování shody','Conformity assessment procedures'),(61,'Klinické hodnocení','Clinical evaluation')]:
                add(f'{pre}-art-{n}',pre,None,'article',f'Článek {n}' if lang=='cs' else f'Article {n}',titlecs if lang=='cs' else titleen,f'Article {n}',n)
            add(f'{pre}-annex-viii',pre,None,'annex','Příloha VIII' if lang=='cs' else 'Annex VIII','Klasifikační pravidla' if lang=='cs' else 'Classification rules','Annex VIII',200)
            for n,titlecs,titleen in [(9,'Aktivní terapeutické prostředky','Active therapeutic devices'),(11,'Software','Software'),(12,'Aktivní prostředky k podávání či odstraňování látek','Active devices to administer or remove substances')]:
                add(f'{pre}-rule-{n}',pre,f'{pre}-annex-viii','rule',f'Pravidlo {n}' if lang=='cs' else f'Rule {n}', titlecs if lang=='cs' else titleen,f'Annex VIII · Rule {n}',200+n)
            add(f'{pre}-annex-xiv',pre,None,'annex','Příloha XIV' if lang=='cs' else 'Annex XIV','Klinické hodnocení a následné klinické sledování' if lang=='cs' else 'Clinical evaluation and PMCF','Annex XIV',300)
        pre='mdcg-2021-24-en'
        add('mdcg-sec-4',pre,None,'section','Chapter 4','Explanations of individual rules','§4',100)
        add('mdcg-sec-4-2-3',pre,'mdcg-sec-4','section','4.2.3','Active devices','§4.2.3',101)
        for n in (9,11,12):
            add(f'mdcg-rule-{n}',pre,'mdcg-sec-4-2-3','section',f'Rule {n}',f'Explanation and practical issues for Rule {n}',f'§4.2.3 · Rule {n}',110+n)
        con.executemany('''INSERT INTO units (id,document_id,parent_id,kind,label,heading,body,text_status,source_note,sort_order,updated_at,locator)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''', units)
        # Suggested not verified and NEVER published unless approved by an editor.
        for n in (9,11,12):
            con.execute('INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)',(
                f'seed-link-{n}',f'mdr-cs-rule-{n}',f'mdcg-rule-{n}',
                'guidance','Kandidátní vazba podle označení pravidla v MDCG; ověřte konkrétní pasáže.',
                '', 'proposed','starter index',now()))


def import_file(payload):
    """Preview or apply a local document. Imported text always needs review."""
    doc_id=payload.get('document_id','')
    filename=str(payload.get('filename',''))[:240]
    if not filename or '/' in filename or '\\' in filename:
        raise ValueError('Neplatný název souboru')
    encoded=payload.get('base64','')
    if not isinstance(encoded,str) or len(encoded)>34_000_000:
        raise ValueError('Příliš velký soubor')
    try: content=base64.b64decode(encoded,validate=True)
    except Exception:raise ValueError('Nesprávné kódování souboru')
    if len(content)>24*1024*1024:
        raise ValueError('Soubor je příliš velký (max. 24 MB)')
    with connect() as con:
        if not con.execute('SELECT 1 FROM documents WHERE id=?',(doc_id,)).fetchone():
            raise ValueError('Neznámý dokument')
    result=parse_source(content,doc_id,filename)
    drafts=result.drafts
    if len({u.id for u in drafts})!=len(drafts):
        raise ValueError('Duplicitní identifikátory v importu. Soubor nebyl uložen.')
    with connect() as con:
        known={r['id']:dict(r) for r in con.execute('SELECT id,body,text_status,source_note FROM units WHERE document_id=?',(doc_id,))}
        archived_ids={r[0] for r in con.execute('SELECT unit_id FROM unit_editor_flags WHERE archived=1')}
        edited_ids={r[0] for r in con.execute('SELECT DISTINCT unit_id FROM unit_edit_history')}
    replace_requested=payload.get('replace_imported',False) is True
    new=[u for u in drafts if u.id not in known]
    can_fill=[u for u in drafts if u.id in known and u.id not in archived_ids and u.id not in edited_ids and not known[u.id]['body'].strip()]
    def is_replaceable(u):
        old=known.get(u.id)
        return (old is not None and u.id not in archived_ids and u.id not in edited_ids and bool(old['body'].strip()) and
                old['text_status']=='needs_review' and
                ('automatický import' in old['source_note'].lower() or
                 ('mdcg 2021-24' in old['source_note'].lower() and 'import pdf' in old['source_note'].lower())))
    replaceable=[u for u in drafts if is_replaceable(u)]
    protected=[u for u in drafts if u.id in known and (u.id in archived_ids or u.id in edited_ids or known[u.id]['body'].strip())
               and not (replace_requested and is_replaceable(u))]
    # In the MDR pilot, all the known main units must be recognized before saving.
    # Even when complete, imported text is only a DRAFT requiring legal review.
    can_import = (result.info['articles']==123 and result.info['annexes']==17
                  and result.info['rules']==22 and result.info.get('content_integrity_ok',True)) if result.info['format']=='eurlex-html' else True
    report={'ok':True,'can_import':can_import,'preview':payload.get('preview',True),'info':result.info,'warnings':result.warnings,
            'drafts':len(drafts),'new':len(new),'fill_empty':len(can_fill),'replaceable':len(replaceable),'will_replace':len(replaceable) if replace_requested else 0,'keep_existing':len(protected),
            'sample':[{'id':d.id,'label':d.label,'chars':len(d.body),'parent':d.parent_id} for d in drafts[:12]],
            'notice':'Všechny importované texty vyžadují ověření. Automaticky importované neověřené texty lze výslovně nahradit po záloze; ověřené texty a ruční komentáře se nepřepisují.'}
    if report['preview']:return report
    if not can_import:
        raise ValueError('Import odmítnut: MDR musí obsahovat 123 základních článků, 17 příloh, 22 pravidel a projít kontrolou úplnosti textu. Nejprve opravte rozpoznávání zdroje.')
    source_ids={d.id for d in drafts}
    with connect() as con:
        existing_ids={r[0] for r in con.execute('SELECT id FROM units')}
        pending=list(drafts)
        added=updated=skipped=replaced=0
        applied_ids=[]
        if result.info['format']=='eurlex-html':
            for mark,entry in result.info.get('amendments',{}).items():
                con.execute('INSERT INTO amendments (document_id,marker,title,kind,url) VALUES (?,?,?,?,?) '
                            'ON CONFLICT(document_id,marker) DO UPDATE SET title=excluded.title,kind=excluded.kind,url=excluded.url',
                            (doc_id,mark,entry['title'],entry['kind'],entry.get('url','')))
        while pending:
            remaining=[];progress=False
            for d in pending:
                if d.parent_id and d.parent_id in source_ids and d.parent_id not in existing_ids:
                    remaining.append(d);continue
                parent=d.parent_id if d.parent_id in existing_ids else None
                if d.id in known:
                    if d.id not in archived_ids and d.id not in edited_ids and (not known[d.id]['body'].strip() or (replace_requested and is_replaceable(d))):
                        replacing=bool(known[d.id]['body'].strip())
                        structure_editor.erase_rich(con,d.id)
                        structure_editor.invalidate_approval(con,[d.id])
                        con.execute("UPDATE units SET parent_id=?, kind=?, label=?, heading=?, body=?, locator=?, text_status='needs_review',source_note=?, sort_order=?,updated_at=? WHERE id=?",
                                   (parent,d.kind,d.label,d.heading,d.body,d.locator,d.source_note,d.sort_order,now(),d.id))
                        if replacing:replaced+=1
                        else:updated+=1
                        applied_ids.append(d.id)
                    else:
                        # Sorting metadata can safely be normalized even for protected texts.
                        if d.id not in edited_ids and d.id not in archived_ids:
                            con.execute('UPDATE units SET sort_order=? WHERE id=?',(d.sort_order,d.id))
                        skipped+=1
                else:
                    con.execute("INSERT INTO units (id,document_id,parent_id,kind,label,heading,body,locator,text_status,source_note,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                (d.id,d.document_id,parent,d.kind,d.label,d.heading,d.body,d.locator,'needs_review',d.source_note,d.sort_order,now()))
                    added+=1;existing_ids.add(d.id);applied_ids.append(d.id)
                progress=True
            if not progress:raise ValueError('Import nelze dokončit – cyklus v hierarchii dokumentu')
            pending=remaining
        if result.info['format']=='eurlex-html':
            for uid in applied_ids:
                con.execute('DELETE FROM unit_amendments WHERE unit_id=?',(uid,))
                for marker in result.info.get('unit_amendments',{}).get(uid,[]):
                    con.execute('INSERT OR IGNORE INTO unit_amendments (unit_id,marker) VALUES (?,?)',(uid,marker))
        if result.info['format']=='mdcg-pdf':
            (DATA/'originals').mkdir(parents=True, exist_ok=True)
            sha=result.info['sha256']
            dest=(DATA/'originals')/f'mdcg-2021-24-en-{sha}.pdf'
            if not dest.exists():
                tmp=dest.with_suffix('.new')
                tmp.write_bytes(content)
                tmp.replace(dest)
            con.execute('INSERT INTO source_files (document_id,sha256,filename,saved_at) VALUES (?,?,?,?) '
                        'ON CONFLICT(document_id) DO UPDATE SET sha256=excluded.sha256, filename=excluded.filename, saved_at=excluded.saved_at',
                        (doc_id,sha,filename,now()))
        con.execute('INSERT INTO import_log (document_id,filename,sha256,format,added,updated,protected,warnings,imported_at) VALUES (?,?,?,?,?,?,?,?,?)',
                    (doc_id,filename,result.info['sha256'],result.info['format'],added,updated,skipped,json.dumps(result.warnings,ensure_ascii=False),now()))
    report.update({'preview':False,'added':added,'updated':updated,'replaced':replaced,'protected':skipped})
    return report


def _unit_order(u):
    ident=u['id'];doc=u['document_id']
    if doc.startswith('mdr-'):
        m=re.fullmatch(r'mdr-(?:cs|en)-art-(\d+)([a-z]?)(?:-par-(\d+))?',ident)
        if m:return (doc,0,int(m.group(1)),ord(m.group(2))-96 if m.group(2) else 0,int(m.group(3) or 0))
        m=re.fullmatch(r'mdr-(?:cs|en)-annex-([ivxlcdm]+)',ident)
        numerals={'i':1,'ii':2,'iii':3,'iv':4,'v':5,'vi':6,'vii':7,'viii':8,'ix':9,'x':10,'xi':11,'xii':12,'xiii':13,'xiv':14,'xv':15,'xvi':16,'xvii':17}
        if m:return (doc,1,numerals.get(m.group(1),999),0,0)
        m=re.fullmatch(r'mdr-(?:cs|en)-rule-(\d+)',ident)
        if m:return (doc,1,8,1,int(m.group(1)))
    return (doc,2,u['sort_order'],0,0)

def rows(con,table):
    order={'documents':'rowid','units':'document_id, sort_order, label','comments':'updated_at DESC','relations':'updated_at DESC'}[table]
    data=[dict(x) for x in con.execute(f'SELECT * FROM {table} ORDER BY {order}')]
    if table=='units':data.sort(key=_unit_order)
    return data

def snapshot():
    with connect() as con:
        data={t:rows(con,t) for t in ('documents','units','comments','relations')}
        metadata={r['document_id']:dict(r) for r in con.execute('SELECT * FROM document_metadata')}
        for d in data['documents']:
            m=metadata.get(d['id'],{})
            d['group_key']=m.get('group_key',d['id'])
            d['jurisdiction']=m.get('jurisdiction','other')
            d['document_type']=m.get('document_type','other')
            try:d['topics']=json.loads(m.get('topics_json','[]'))
            except (TypeError,ValueError):d['topics']=[]
        data['amendments']=[dict(x) for x in con.execute('SELECT * FROM amendments ORDER BY document_id,marker')]
        data['unit_amendments']=[dict(x) for x in con.execute('SELECT * FROM unit_amendments ORDER BY unit_id,marker')]
        data['imports']=[dict(x) for x in con.execute('SELECT * FROM import_log ORDER BY id DESC LIMIT 20')]
        data['source_files']=[dict(x) for x in con.execute('SELECT * FROM source_files ORDER BY document_id')]
        data['relation_revisions']=[dict(x) for x in con.execute('SELECT * FROM relation_revisions ORDER BY created_at DESC,id DESC')]
        data['relation_history']=[dict(x) for x in con.execute('SELECT * FROM relation_history ORDER BY id DESC')]
        data['comment_revisions']=[dict(x) for x in con.execute('SELECT * FROM comment_revisions ORDER BY created_at DESC,id DESC')]
        data['comment_history']=[dict(x) for x in con.execute('SELECT * FROM comment_history ORDER BY id DESC')]
        structure_editor.enrich(con,data)
        data['counts']={
            'documents':len(data['documents']), 'units':len(data['units']),
            'verified':sum(u['text_status']=='verified' and bool(u['body']) for u in data['units']),
            'proposed':sum(r['status']=='proposed' for r in data['relations']),
            'approved_links':sum(r['status']=='approved' for r in data['relations']),
            'approved_comments':sum(c['status']=='approved' for c in data['comments']),
            'proposed_revisions':sum(r['status']=='proposed' for r in data['relation_revisions']),
            'comment_revisions_pending':sum(r['status']=='proposed' for r in data['comment_revisions'])}
        return data

def reader_data(draft=False):
    """Data for the student reader.

    draft=False: only verified texts, approved comments and approved links whose
    both ends are verified. This is the only content that may reach students.
    draft=True: local editorial preview of how the reader will look; includes
    unverified texts and pending proposals, each clearly marked. Never exported.
    Units archived by a merge are never shown.
    """
    s=snapshot()
    live=[u for u in s['units'] if not u.get('editor_archived')]
    by_id={u['id']:u for u in live}
    if draft:
        good={u['id'] for u in live if u['body'].strip()}
    else:
        good={u['id'] for u in live if u['text_status']=='verified' and u['body'].strip()}
    included=set(good)
    # Navigation-only ancestors never reveal unverified legal text or headings.
    for uid in good:
        ancestor=by_id[uid].get('parent_id');seen={uid}
        while ancestor and ancestor in by_id and ancestor not in seen:
            seen.add(ancestor);included.add(ancestor)
            ancestor=by_id[ancestor].get('parent_id')
    unit_fields=('id','document_id','parent_id','kind','label','heading','body','locator','text_status','sort_order','content_blocks')
    units=[]
    for unit in live:
        if unit['id'] not in included:continue
        public={k:unit.get(k) for k in unit_fields}
        if unit['id'] not in good:
            public.update(body='',heading='',text_status='navigation_only',content_blocks=None)
        public['navigation_only']=unit['id'] not in good
        units.append(public)
    doc_fields=('id','title','family','kind','language','version','valid_date','publisher','url','group_key','jurisdiction','document_type','topics')
    documents=[{k:d[k] for k in doc_fields} for d in s['documents'] if any(u['document_id']==d['id'] for u in units)]
    shown=('approved','proposed') if draft else ('approved',)
    links=[{k:r[k] for k in ('id','source_id','target_id','relation_type','rationale','status')}
           for r in s['relations'] if r['status'] in shown and r['source_id'] in good and r['target_id'] in good]
    shown=('approved','draft') if draft else ('approved',)
    comments=[{k:c[k] for k in ('id','unit_id','kind','language','body','author','status','updated_at')}
              for c in s['comments'] if c['status'] in shown and c['unit_id'] in good]
    return {'format':'regulaquest-education-v1','mode':'draft' if draft else 'published',
            'studio_version':VERSION,'published_at':now(),
            'notice':'Legislativní texty jsou informační kopií. Ověřujte aktuální oficiální znění a právní závaznost zdrojů.',
            'documents':documents,'units':units,'relations':links,'comments':comments,
            'counts':{'documents':len(documents),'units':len(units),'verified_units':len(good),
                      'navigation_units':len(included-good),'relations':len(links),'comments':len(comments)}}

def published():
    return reader_data(draft=False)

def publish_to_reader():
    """Write the published export into reader/data for the static reader (GitHub Pages)."""
    data=published()
    READER_DATA.parent.mkdir(parents=True,exist_ok=True)
    tmp=READER_DATA.with_suffix('.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=1),encoding='utf-8')
    tmp.replace(READER_DATA)
    return {'path':str(READER_DATA.relative_to(ROOT)),'counts':data['counts']}


# ---- Explicit reference batch scan: transient, deterministic, editor-gated ----
BATCH_LIMIT = 50
SUPPORTED_REFERENCE_DOCS = ('mdr-cs','mdr-en')

def _reference_source_doc(doc):
    return doc['family']+' '+doc['language'].upper() if doc else 'Dokument'

def _reference_evidence(unit,doc,candidate):
    """The source text is quoted, never paraphrased or silently corrected."""
    where=(unit.get('locator') or unit['label']).strip()
    return f'{_reference_source_doc(doc)}, {where}: „{candidate["excerpt"]}“'

def scan_reference_batch(scope='document', document_id='', unit_id='', state='all', search='',
                         offset=0, limit=50):
    """Read-only paginated analysis. No model calls or persistent proposal cache.

    Source passages are scanned in the current database state, so results cannot
    accidentally be stale once the editor sends a proposal for server-side validation.
    """
    if scope not in ('unit','document','all'):raise ValueError('Neplatný rozsah analýzy')
    if state not in ('all','new','existing','unresolved'):raise ValueError('Neplatný filtr výsledků')
    if not isinstance(offset,int) or offset<0 or offset>1000000:raise ValueError('Neplatný posun stránky')
    if not isinstance(limit,int) or not 1<=limit<=100:raise ValueError('Neplatná velikost stránky')
    if len(search)>120:raise ValueError('Příliš dlouhý hledaný výraz')
    with connect() as con:
        docs={d['id']:dict(d) for d in con.execute('SELECT id,family,language FROM documents')}
        if scope=='unit':
            if not unit_id or not con.execute('SELECT 1 FROM units WHERE id=?',(unit_id,)).fetchone():
                raise ValueError('Vyberte platné zdrojové ustanovení')
            source=con.execute('SELECT * FROM units WHERE id=?',(unit_id,)).fetchall()
        elif scope=='document':
            if not document_id or document_id not in docs:raise ValueError('Vyberte platný dokument')
            source=con.execute('SELECT * FROM units WHERE document_id=? ORDER BY sort_order,id',(document_id,)).fetchall()
        else:
            source=con.execute('SELECT * FROM units ORDER BY document_id,sort_order,id').fetchall()
        known={x['id'] for x in con.execute('SELECT id FROM units')}
        existing=[dict(r) for r in con.execute('SELECT source_id,target_id,relation_type,status FROM relations')]
    sources=[dict(r) for r in source]
    seen_source={r['id'] for r in sources}
    by_id={u['id']:u for u in sources}
    counted={'new':0,'existing':0,'unresolved':0}
    unsupported=sorted({u['document_id'] for u in sources if u['document_id'] not in SUPPORTED_REFERENCE_DOCS and u['body'].strip()})
    raw={}
    for u in sources:
        if u['document_id'] not in SUPPORTED_REFERENCE_DOCS or not u['body'].strip():continue
        raw[u['id']]=suggest_explicit_links(u,known,existing,include_unresolved=True)
    # Avoid proposing identical references at an article/annex level when their
    # more precise descendant passages contain those very citations.
    descendant_targets={}
    for u in sources:
        refs=raw.get(u['id'],[])
        if not refs:continue
        parent=u.get('parent_id');visited={u['id']}
        while parent and parent not in visited and parent in by_id:
            visited.add(parent)
            descendant_targets.setdefault(parent,set()).update(c['target_hint'] for c in refs)
            parent=by_id[parent].get('parent_id')
    result=[]
    for u in sources:
        if u['id'] not in raw:continue
        for c in raw[u['id']]:
            if c['target_hint'] in descendant_targets.get(u['id'],()):continue
            entry=dict(c)
            entry['source_text_status']=u['text_status']
            entry['source_document_id']=u['document_id']
            entry['evidence']=_reference_evidence(u,docs.get(u['document_id']),c)
            entry['category']='unresolved' if c['resolution']=='unresolved' else ('existing' if c['existing_status'] is not None else 'new')
            counted[entry['category']]+=1
            result.append(entry)
    q=search.casefold().strip()
    matched=[]
    for c in result:
        if state!='all' and c['category']!=state:continue
        if q and q not in ' '.join((c['source_id'],c['target_hint'],c['matched_text'],c['excerpt'],c['evidence'])).casefold():continue
        matched.append(c)
    return {'method':'explicit-citation-batch-v1','scope':scope,'source_count':len(sources),
            'eligible_source_count':len(raw),'unsupported_document_ids':unsupported,
            'total':len(result),'counts':counted,'matched':len(matched),
            'offset':offset,'limit':limit,'results':matched[offset:offset+limit]}

def create_reference_batch(con, links):
    """Transactional batch creation; re-check each explicit citation at commit time.

    Every created relation has status=proposed and a history record.
    Nothing is approved automatically or added to the education export.
    """
    if not isinstance(links,list) or not links or len(links)>BATCH_LIMIT:
        raise ValueError('Vyberte 1–50 nových vazeb na jedno uložení')
    if any(not isinstance(x,dict) or not isinstance(x.get('source_id'),str) or
           not isinstance(x.get('target_id'),str) for x in links):
        raise ValueError('Neplatný seznam kandidátů')
    if len({(x['source_id'],x['target_id']) for x in links})!=len(links):
        raise ValueError('Seznam obsahuje duplicitní kandidáty')
    known={r['id'] for r in con.execute('SELECT id FROM units')}
    docs={d['id']:dict(d) for d in con.execute('SELECT id,family,language FROM documents')}
    created=0;skipped=0
    for item in links:
        row=con.execute('SELECT * FROM units WHERE id=?',(item['source_id'],)).fetchone()
        if not row:raise ValueError('Zdrojové ustanovení mezitím neexistuje')
        unit=dict(row)
        if not con.execute('SELECT 1 FROM units WHERE id=?',(item['target_id'],)).fetchone():
            raise ValueError('Cílové ustanovení mezitím neexistuje')
        rels=[dict(r) for r in con.execute('SELECT source_id,target_id,relation_type,status FROM relations WHERE source_id=?',(unit['id'],))]
        candidates=suggest_explicit_links(unit,known,rels,include_unresolved=False)
        match=next((c for c in candidates if c['target_id']==item['target_id']),None)
        if match is None:raise ValueError('Výslovný odkaz již není v textu: '+unit['id']+' → '+item['target_id'])
        if match['existing_status'] is not None:
            skipped+=1
            continue
        target=con.execute('SELECT label,locator FROM units WHERE id=?',(item['target_id'],)).fetchone()
        rationale=('Výslovný odkaz rozpoznaný v textu zdrojového ustanovení ('+
                   match['matched_text']+'). Cílové ustanovení: '+(target['locator'] or target['label'])+
                   '. Redakční návrh – ověřit přesný význam a rozsah odkazu proti originálu.')
        validate_relation_fields(con,unit['id'],item['target_id'],'references',rationale)
        evidence=_reference_evidence(unit,docs.get(unit['document_id']),match)
        ident='relation-'+secrets.token_hex(7)
        con.execute('INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)',
                    (ident,unit['id'],item['target_id'],'references',rationale,evidence,
                     'proposed','explicit-citation-batch-v1; pending-editor-review',now()))
        log_relation(con,ident,'created_batch_candidate',None,relation_snapshot(con,ident))
        created+=1
    return {'created':created,'skipped':skipped}

def ensure_keys(obj,*keys):
    for k in keys:
        if k not in obj or (isinstance(obj[k],str) and not obj[k].strip()):
            raise ValueError('Chybí povinné pole: '+k)

def log_relation(con,relation_id,event_type,before,after):
    con.execute('INSERT INTO relation_history (relation_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?)',
                (relation_id,event_type,json.dumps(before,ensure_ascii=False) if before else '',
                 json.dumps(after,ensure_ascii=False) if after else '',now()))

def validate_relation_fields(con,source_id,target_id,relation_type,rationale):
    if source_id==target_id: raise ValueError('Nelze propojit ustanovení samo se sebou')
    if relation_type not in ('guidance','references','related','supplements','amends'):
        raise ValueError('Neznámý typ vazby')
    if not isinstance(rationale,str) or not rationale.strip() or len(rationale)>15000:
        raise ValueError('Doplňte přiměřené zdůvodnění vazby')
    for ident in (source_id,target_id):
        if not con.execute('SELECT 1 FROM units WHERE id=?',(ident,)).fetchone():
            raise ValueError('Neznámé ustanovení: '+ident)

def relation_snapshot(con,ident):
    result=con.execute('SELECT * FROM relations WHERE id=?',(ident,)).fetchone()
    if not result: raise ValueError('Vazba neexistuje')
    return dict(result)

def relation_modification(con,payload):
    action=payload.get('action')
    if action=='propose_relation_revision':
        ensure_keys(payload,'relation_id','change_type','change_reason')
        r=relation_snapshot(con,payload['relation_id'])
        if r['status']!='approved': raise ValueError('Upravovat lze pouze schválené vazby')
        if con.execute("SELECT 1 FROM relation_revisions WHERE relation_id=? AND status='proposed'",(r['id'],)).fetchone():
            raise ValueError('U této vazby už čeká na kontrolu návrh změny')
        kind=payload['change_type']
        if kind not in ('edit','archive'):raise ValueError('Neplatný druh změny')
        reason=str(payload['change_reason']).strip()
        if not reason or len(reason)>3000:raise ValueError('Uveďte důvod změny')
        source=r['source_id']
        target=payload.get('target_id',r['target_id']) if kind=='edit' else r['target_id']
        relation_type=payload.get('relation_type',r['relation_type']) if kind=='edit' else r['relation_type']
        rationale=payload.get('rationale',r['rationale']) if kind=='edit' else r['rationale']
        evidence=payload.get('evidence',r['evidence']) if kind=='edit' else r['evidence']
        validate_relation_fields(con,source,target,relation_type,rationale)
        if not isinstance(evidence,str) or len(evidence)>15000: raise ValueError('Doklad je příliš dlouhý')
        if kind=='edit' and all((r['target_id']==target,r['relation_type']==relation_type,r['rationale']==rationale.strip(),r['evidence']==evidence.strip())):
            raise ValueError('Ve vazbě nejsou žádné změny')
        con.execute('''INSERT INTO relation_revisions
          (id,relation_id,change_type,source_id,target_id,relation_type,rationale,evidence,change_reason,status,base_updated_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
          ('revision-'+secrets.token_hex(8),r['id'],kind,source,target,relation_type,rationale.strip(),evidence.strip(),reason,'proposed',r['updated_at'],now()))
        return
    if action=='decide_relation_revision':
        ensure_keys(payload,'revision_id','decision')
        if payload['decision'] not in ('approved','rejected'):raise ValueError('Neznámé rozhodnutí')
        row=con.execute('SELECT * FROM relation_revisions WHERE id=?',(payload['revision_id'],)).fetchone()
        if not row or row['status']!='proposed': raise ValueError('Návrh změny již není ke schválení')
        rev=dict(row);r=relation_snapshot(con,rev['relation_id'])
        if r['status']!='approved' or r['updated_at']!=rev['base_updated_at']:
            raise ValueError('Schválená vazba se mezitím změnila. Zkontrolujte její aktuální znění.')
        if payload['decision']=='approved':
            if rev['change_type']=='archive':
                con.execute('UPDATE relations SET status=?,updated_at=? WHERE id=?',('archived',now(),r['id']))
            else:
                validate_relation_fields(con,rev['source_id'],rev['target_id'],rev['relation_type'],rev['rationale'])
                con.execute('''UPDATE relations SET target_id=?,relation_type=?,rationale=?,evidence=?,updated_at=? WHERE id=?''',
                            (rev['target_id'],rev['relation_type'],rev['rationale'],rev['evidence'],now(),r['id']))
            updated=relation_snapshot(con,r['id'])
            log_relation(con,r['id'],'revision_'+rev['change_type']+'_approved',r,updated)
        else:
            log_relation(con,r['id'],'revision_rejected',rev,r)
        con.execute('UPDATE relation_revisions SET status=?,reviewed_at=? WHERE id=?',
                    (payload['decision'],now(),rev['id']))
        return
    raise ValueError('Neznámá akce správy vazby')

def validate_comment_fields(con,unit_id,kind,language,body,author):
    if not con.execute('SELECT 1 FROM units WHERE id=?',(unit_id,)).fetchone():
        raise ValueError('Neznámé ustanovení')
    if kind not in ('explanation','warning','example','definition','reference'):
        raise ValueError('Neznámý typ komentáře')
    if language not in ('cs','en'): raise ValueError('Neplatný jazyk komentáře')
    if not isinstance(body,str) or not body.strip() or len(body)>15000:
        raise ValueError('Komentář musí obsahovat text do 15 000 znaků')
    if not isinstance(author,str) or len(author)>200:
        raise ValueError('Jméno autora je příliš dlouhé')

def comment_snapshot(con,ident):
    row=con.execute('SELECT * FROM comments WHERE id=?',(ident,)).fetchone()
    if not row: raise ValueError('Komentář neexistuje')
    return dict(row)

def log_comment(con,ident,event_type,before,after):
    con.execute('INSERT INTO comment_history (comment_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?)',
                (ident,event_type,json.dumps(before,ensure_ascii=False) if before else '',
                 json.dumps(after,ensure_ascii=False) if after else '',now()))

def comment_was_approved(con,ident):
    # History also includes a baseline for comments created in older Studio versions.
    for row in con.execute('SELECT after_json FROM comment_history WHERE comment_id=?',(ident,)):
        try:
            if json.loads(row['after_json'] or '{}').get('status')=='approved':return True
        except (TypeError,ValueError):pass
    return False

def comment_modification(con,payload):
    action=payload.get('action')
    if action=='archive_comment_draft':
        ensure_keys(payload,'comment_id')
        old=comment_snapshot(con,payload['comment_id'])
        if old['status'] not in ('draft','rejected'):
            raise ValueError('Tato akce je určena pouze pro koncepty a zamítnuté komentáře')
        con.execute('UPDATE comments SET status=?,updated_at=? WHERE id=?',('archived',now(),old['id']))
        log_comment(con,old['id'],'draft_archived',old,comment_snapshot(con,old['id']))
        return
    if action=='restore_comment_draft':
        ensure_keys(payload,'comment_id')
        old=comment_snapshot(con,payload['comment_id'])
        if old['status']!='archived' or comment_was_approved(con,old['id']):
            raise ValueError('Schválené komentáře se obnovují pouze novým schváleným návrhem')
        con.execute('UPDATE comments SET status=?,updated_at=? WHERE id=?',('draft',now(),old['id']))
        log_comment(con,old['id'],'draft_restored',old,comment_snapshot(con,old['id']))
        return
    if action=='edit_comment_draft':
        ensure_keys(payload,'comment_id','kind','language','body')
        old=comment_snapshot(con,payload['comment_id'])
        if old['status'] not in ('draft','rejected'):
            raise ValueError('Přímo lze upravit jen koncept či zamítnutý komentář')
        kind=payload['kind'];language=payload['language'];body=payload['body'].strip();author=payload.get('author','').strip()
        validate_comment_fields(con,old['unit_id'],kind,language,body,author)
        if (old['kind'],old['language'],old['body'],old['author'],old['status'])==(kind,language,body,author,'draft'):
            raise ValueError('Komentář nebyl změněn')
        con.execute('UPDATE comments SET kind=?,language=?,body=?,author=?,status=?,updated_at=? WHERE id=?',
                    (kind,language,body,author,'draft',now(),old['id']))
        log_comment(con,old['id'],'draft_edited',old,comment_snapshot(con,old['id']))
        return
    if action=='propose_comment_revision':
        ensure_keys(payload,'comment_id','change_type','change_reason')
        old=comment_snapshot(con,payload['comment_id'])
        kind=payload['change_type']
        if kind not in ('edit','archive','restore'):raise ValueError('Neplatný druh změny')
        if kind in ('edit','archive') and old['status']!='approved':
            raise ValueError('Upravovat nebo archivovat lze jen schválený komentář')
        if kind=='restore' and (old['status']!='archived' or not comment_was_approved(con,old['id'])):
            raise ValueError('Takto lze obnovit pouze dříve schválený komentář')
        if con.execute("SELECT 1 FROM comment_revisions WHERE comment_id=? AND status='proposed'",(old['id'],)).fetchone():
            raise ValueError('U komentáře už čeká návrh změny')
        reason=str(payload['change_reason']).strip()
        if not reason or len(reason)>3000:raise ValueError('Uveďte důvod změny do 3000 znaků')
        ckind=payload.get('kind',old['kind']) if kind=='edit' else old['kind']
        lang=payload.get('language',old['language']) if kind=='edit' else old['language']
        body=payload.get('body',old['body']).strip() if kind=='edit' else old['body']
        author=payload.get('author',old['author']).strip() if kind=='edit' else old['author']
        validate_comment_fields(con,old['unit_id'],ckind,lang,body,author)
        if kind=='edit' and (ckind,lang,body,author)==(old['kind'],old['language'],old['body'],old['author']):
            raise ValueError('Obsah komentáře se nezměnil')
        con.execute("""INSERT INTO comment_revisions
          (id,comment_id,change_type,kind,language,body,author,change_reason,status,base_updated_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
          ('crev-'+secrets.token_hex(8),old['id'],kind,ckind,lang,body,author,reason,'proposed',old['updated_at'],now()))
        log_comment(con,old['id'],'revision_proposed',old,old)
        return
    if action=='decide_comment_revision':
        ensure_keys(payload,'revision_id','decision')
        decision=payload['decision']
        if decision not in ('approved','rejected'):raise ValueError('Neznámé rozhodnutí')
        row=con.execute('SELECT * FROM comment_revisions WHERE id=?',(payload['revision_id'],)).fetchone()
        if not row or row['status']!='proposed':raise ValueError('Návrh změny už není ke schválení')
        rev=dict(row);old=comment_snapshot(con,rev['comment_id'])
        expected='archived' if rev['change_type']=='restore' else 'approved'
        if old['status']!=expected or old['updated_at']!=rev['base_updated_at']:
            raise ValueError('Komentář se mezitím změnil. Zkontrolujte aktuální znění.')
        if decision=='approved':
            if rev['change_type']=='edit':
                validate_comment_fields(con,old['unit_id'],rev['kind'],rev['language'],rev['body'],rev['author'])
                con.execute("""UPDATE comments SET kind=?,language=?,body=?,author=?,updated_at=? WHERE id=?""",
                            (rev['kind'],rev['language'],rev['body'],rev['author'],now(),old['id']))
            else:
                con.execute('UPDATE comments SET status=?,updated_at=? WHERE id=?',
                            ('archived' if rev['change_type']=='archive' else 'approved',now(),old['id']))
            log_comment(con,old['id'],'revision_'+rev['change_type']+'_approved',old,comment_snapshot(con,old['id']))
        else:
            log_comment(con,old['id'],'revision_rejected',old,old)
        con.execute('UPDATE comment_revisions SET status=?,reviewed_at=? WHERE id=?',(decision,now(),rev['id']))
        return
    raise ValueError('Neznámá akce správy komentáře')

def update(payload):
    action=payload.get('action','')
    batch_result=editor_result=None
    if action=='publish_to_reader':
        return {'ok':True,'state':snapshot(),'reader':publish_to_reader()}
    with connect() as con:
        if action in ('save_unit_content','edit_unit_structure','split_unit','move_unit_text','merge_units'):
            editor_result=structure_editor.handle(con,payload)
        elif action=='batch_new_relations':
            batch_result=create_reference_batch(con,payload.get('links'))
        elif action=='save_unit_text':
            ensure_keys(payload,'unit_id','body')
            if not con.execute('SELECT 1 FROM units WHERE id=?',(payload['unit_id'],)).fetchone(): raise ValueError('Ustanovení neexistuje')
            body=payload['body'].strip()
            if len(body)>450000: raise ValueError('Text je příliš dlouhý; rozdělte jej na části')
            before=structure_editor.unit_state(con,payload['unit_id'])
            structure_editor.erase_rich(con,payload['unit_id'])
            con.execute("UPDATE units SET body=?, text_status='needs_review',source_note=?,updated_at=? WHERE id=?",
                        (body,payload.get('source_note','Ručně vložený text'),structure_editor.stamp(),payload['unit_id']))
            structure_editor.invalidate_approval(con,[payload['unit_id']])
            structure_editor.log(con,payload['unit_id'],'legacy_edit_text',before,structure_editor.unit_state(con,payload['unit_id']),'Přímá úprava textu')
        elif action=='verify_unit':
            ensure_keys(payload,'unit_id')
            unit=con.execute('SELECT * FROM units WHERE id=?',(payload['unit_id'],)).fetchone()
            if not unit or not unit['body'].strip(): raise ValueError('Nelze ověřit prázdný text')
            con.execute("UPDATE units SET text_status='verified',updated_at=? WHERE id=?",(now(),payload['unit_id']))
        elif action=='new_document':
            ensure_keys(payload,'title','language','family','kind','version')
            url = payload.get('url','').strip()
            if url and not url.startswith(('https://','http://')): raise ValueError('Odkaz musí být URL začínající https:// nebo http://')
            id='doc-'+secrets.token_hex(6)
            con.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)',(
                id,payload['title'],payload['family'],payload['kind'],payload['language'],payload['version'],
                payload.get('valid_date',''),payload.get('publisher',''),url,'reference',now()))
            con.execute('INSERT INTO document_metadata VALUES (?,?,?,?,?,?)',
                        (id,id,'other','other','[]',now()))
        elif action=='update_document_metadata':
            ensure_keys(payload,'document_id','jurisdiction','document_type')
            if payload['jurisdiction'] not in ('eu','cz','international','other'):
                raise ValueError('Neplatná jurisdikce')
            if payload['document_type'] not in ('regulation','directive','law','decree','guidance','standard','other'):
                raise ValueError('Neplatný druh dokumentu')
            if not con.execute('SELECT 1 FROM documents WHERE id=?',(payload['document_id'],)).fetchone():
                raise ValueError('Neznámý dokument')
            topics=payload.get('topics',[])
            if not isinstance(topics,list) or len(topics)>40 or any(not isinstance(t,str) or not t.strip() or len(t)>70 for t in topics):
                raise ValueError('Neplatné odborné tagy (max. 40 po 70 znacích)')
            clean=list(dict.fromkeys(t.strip() for t in topics))
            group=con.execute('SELECT group_key FROM document_metadata WHERE document_id=?',(payload['document_id'],)).fetchone()
            if not group:raise ValueError('Chybí záznam metadat, spusťte znovu Studio')
            # Shared document-level topics across translated variants of the same act.
            con.execute('UPDATE document_metadata SET jurisdiction=?,document_type=?,topics_json=?,updated_at=? WHERE group_key=?',
                        (payload['jurisdiction'],payload['document_type'],json.dumps(clean,ensure_ascii=False),now(),group['group_key']))
        elif action=='new_unit':
            ensure_keys(payload,'document_id','label','kind')
            doc=con.execute('SELECT 1 FROM documents WHERE id=?',(payload['document_id'],)).fetchone()
            if not doc: raise ValueError('Neznámý dokument')
            parent=payload.get('parent_id') or None
            if parent and not con.execute('SELECT 1 FROM units WHERE id=? AND document_id=?',(parent,payload['document_id'])).fetchone():
                raise ValueError('Nadřazená část musí patřit ke stejnému dokumentu')
            id='unit-'+secrets.token_hex(7)
            maxorder=con.execute('SELECT COALESCE(MAX(sort_order),0) FROM units WHERE document_id=?',(payload['document_id'],)).fetchone()[0]
            con.execute('''INSERT INTO units (id,document_id,parent_id,kind,label,heading,body,locator,text_status,source_note,sort_order,updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''', (id,payload['document_id'],parent,payload['kind'],payload['label'],payload.get('heading',''),'',payload.get('locator',''),'missing','',maxorder+1,now()))
        elif action=='new_comment':
            ensure_keys(payload,'unit_id','body','kind','language')
            body=payload['body'].strip();author=str(payload.get('author','')).strip()
            validate_comment_fields(con,payload['unit_id'],payload['kind'],payload['language'],body,author)
            ident='comment-'+secrets.token_hex(7)
            con.execute('INSERT INTO comments VALUES (?,?,?,?,?,?,?,?)',
                        (ident,payload['unit_id'],payload['kind'],payload['language'],body,'draft',author,now()))
            log_comment(con,ident,'created',None,comment_snapshot(con,ident))
        elif action=='comment_status':
            ensure_keys(payload,'id','status')
            if payload['status'] not in ('approved','rejected'): raise ValueError('Neplatný stav')
            before=comment_snapshot(con,payload['id'])
            if before['status']!='draft':raise ValueError('Schválit či zamítnout lze jen nový koncept')
            con.execute('UPDATE comments SET status=?,updated_at=? WHERE id=?',(payload['status'],now(),payload['id']))
            log_comment(con,before['id'],'status_'+payload['status'],before,comment_snapshot(con,before['id']))
        elif action in ('edit_comment_draft','archive_comment_draft','restore_comment_draft','propose_comment_revision','decide_comment_revision'):
            comment_modification(con,payload)
        elif action in ('propose_relation_revision','decide_relation_revision'):
            relation_modification(con,payload)
        elif action=='new_relation':
            ensure_keys(payload,'source_id','target_id','relation_type')
            if payload['source_id']==payload['target_id']: raise ValueError('Nelze propojit ustanovení se sebou samým')
            for field in ('source_id','target_id'):
                if not con.execute('SELECT 1 FROM units WHERE id=?',(payload[field],)).fetchone(): raise ValueError('Neznámé ustanovení: '+payload[field])
            validate_relation_fields(con,payload['source_id'],payload['target_id'],payload['relation_type'],payload.get('rationale',''))
            ident='relation-'+secrets.token_hex(7)
            con.execute('INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)',(
                ident,payload['source_id'],payload['target_id'],payload['relation_type'],payload['rationale'].strip(),payload.get('evidence',''),'proposed',payload.get('provenance','manual'),now()))
            log_relation(con,ident,'created',None,relation_snapshot(con,ident))
        elif action=='relation_status':
            ensure_keys(payload,'id','status')
            if payload['status'] not in ('approved','rejected'): raise ValueError('Neplatný stav')
            before=relation_snapshot(con,payload['id'])
            if before['status']!='proposed':raise ValueError('Přímo lze rozhodovat pouze o nově navržené vazbě')
            con.execute('UPDATE relations SET status=?,updated_at=? WHERE id=?',(payload['status'],now(),payload['id']))
            log_relation(con,payload['id'],'status_'+payload['status'],before,relation_snapshot(con,payload['id']))
        elif action=='import_units':
            units=payload.get('units')
            if not isinstance(units,list) or not units or len(units)>1000: raise ValueError('Vyžaduje se seznam 1–1000 ustanovení')
            for u in units:
                ensure_keys(u,'unit_id','body')
                if not con.execute('SELECT 1 FROM units WHERE id=?',(u['unit_id'],)).fetchone(): raise ValueError('Neexistující unit_id: '+u['unit_id'])
                if len(u['body'])>450000: raise ValueError('Příliš dlouhý text')
            for u in units:
                before=structure_editor.unit_state(con,u['unit_id'])
                structure_editor.erase_rich(con,u['unit_id'])
                con.execute("UPDATE units SET body=?,text_status='needs_review',source_note=?,updated_at=? WHERE id=?",
                            (u['body'].strip(),u.get('source_note','Dávkový import – vyžaduje ověření'),structure_editor.stamp(),u['unit_id']))
                structure_editor.invalidate_approval(con,[u['unit_id']])
                structure_editor.log(con,u['unit_id'],'import_text',before,structure_editor.unit_state(con,u['unit_id']),'Dávkový import')
        else:
            raise ValueError('Neznámá akce')
    return {'ok':True, 'state':snapshot(), 'batch':batch_result, 'editor':editor_result}

class Handler(BaseHTTPRequestHandler):
    server_version='RegulaQuest/'+VERSION
    def log_message(self, fmt, *args): pass
    def headers_common(self,content_type):
        self.send_header('Content-Type',content_type)
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','no-referrer')
    def json_response(self,obj,status=200):
        b=json.dumps(obj,ensure_ascii=False,indent=None).encode('utf-8')
        self.send_response(status);self.headers_common('application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        parts=urlsplit(self.path)
        path=unquote(parts.path)
        if path in ('/api/source-pdf','/api/pdf-page'):
            query=parse_qs(parts.query)
            doc=(query.get('document_id') or [''])[0]
            with connect() as con:
                row=con.execute('SELECT sha256,filename FROM source_files WHERE document_id=?',(doc,)).fetchone()
            if not row or not row['filename'].lower().endswith('.pdf'): self.send_error(404,'Pro tento dokument není uložen originální PDF.');return
            original=(DATA/'originals')/f'{doc}-{row["sha256"]}.pdf'
            if not original.is_file(): self.send_error(404,'Originální PDF chybí v data/originals.');return
            if path=='/api/source-pdf':
                b=original.read_bytes();self.send_response(200)
                self.headers_common('application/pdf')
                self.send_header('Content-Disposition','inline; filename="RegulaQuest-source.pdf"')
                self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
            try:
                p=int((query.get('page') or ['1'])[0])
                import fitz
                with fitz.open(original) as pdf:
                    if p<1 or p>pdf.page_count:raise ValueError('Strana mimo rozsah dokumentu')
                    b=pdf[p-1].get_pixmap(matrix=fitz.Matrix(1.55,1.55),alpha=False).tobytes('png')
            except (ValueError,ImportError):self.send_error(400,'Neplatné číslo stránky nebo chybí PyMuPDF');return
            self.send_response(200);self.headers_common('image/png')
            self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if path=='/api/related-batch':
            # Bulk cross-document analysis is strictly read-only and bounded.
            args=parse_qs(parts.query)
            get=lambda name,default='':(args.get(name) or [default])[0]
            source_doc=get('source_document_id')
            target_doc=get('target_document_id','all')
            try:
                if not source_doc or len(source_doc)>160 or len(target_doc)>160:
                    raise ValueError('Neplatný zdrojový nebo cílový dokument.')
                with connect() as con:
                    docs=[dict(r) for r in con.execute(
                        "SELECT d.*, COALESCE(m.document_type,'other') AS document_type, "
                        "COALESCE(m.group_key,d.id) AS group_key "
                        "FROM documents d LEFT JOIN document_metadata m ON m.document_id=d.id")]
                    docmap={d['id']:d for d in docs}
                    if source_doc not in docmap:
                        raise ValueError('Neznámý zdrojový dokument.')
                    if target_doc!='all' and target_doc not in docmap:
                        raise ValueError('Neznámý cílový dokument.')
                    if target_doc==source_doc:
                        raise ValueError('Zdrojový a cílový dokument musí být různé.')
                    source_group=docmap[source_doc]['group_key']
                    target_ids={d['id'] for d in docs if d['id']!=source_doc and
                                (d['id']==target_doc if target_doc!='all' else d['group_key']!=source_group)}
                    if not target_ids:
                        raise ValueError('Nejsou dostupné jiné dokumenty pro hledání.')
                    allunits=[dict(r) for r in con.execute(
                        'SELECT * FROM units WHERE LENGTH(TRIM(body))>0 ORDER BY document_id,sort_order,id')]
                    sources=[u for u in allunits if u['document_id']==source_doc]
                    targets=[u for u in allunits if u['document_id'] in target_ids]
                    rel=[dict(r) for r in con.execute('SELECT source_id,target_id,status FROM relations')]
                output=find_related_bulk(sources,targets,rel,docs,per_source_limit=3,result_cap=1000)
                return self.json_response({
                    'method':'transparent-structure-and-lexical-bulk-v1',
                    'uses_ai':False,'scope':'document','source_document_id':source_doc,
                    'target_document_id':target_doc,'count':len(output['results']),
                    **output,
                    'disclaimer':'Pouze kandidáti pro odbornou kontrolu. Hledání není úplné ani sémantické; '
                                 'opakující se nadřazené pasáže se vynechávají. Žádný návrh se automaticky neukládá.'})
            except (ValueError,TypeError) as error:
                return self.json_response({'error':str(error)},400)
        if path=='/api/related-suggestions':
            # Non-persistent, deterministic cross-document candidates. No AI model
            # and no approval or modification of any existing relation.
            args=parse_qs(parts.query)
            get=lambda name,default='':(args.get(name) or [default])[0]
            source_id=get('unit_id');target_doc=get('target_document_id','all')
            try:
                limit=int(get('limit','20'))
                if not 1<=limit<=50:raise ValueError('Maximálně 50 výsledků')
                if len(source_id)>160 or len(target_doc)>160:raise ValueError('Neplatný identifikátor')
                with connect() as con:
                    source=con.execute('SELECT * FROM units WHERE id=?',(source_id,)).fetchone()
                    if source is None:raise ValueError('Vyberte platné zdrojové ustanovení')
                    if target_doc!='all' and not con.execute('SELECT 1 FROM documents WHERE id=?',(target_doc,)).fetchone():
                        raise ValueError('Neznámý cílový dokument')
                    docs=[dict(r) for r in con.execute("SELECT d.*, COALESCE(m.document_type,'other') AS document_type, "
                                          "COALESCE(m.group_key,d.id) AS group_key "
                                          "FROM documents d LEFT JOIN document_metadata m ON m.document_id=d.id")]
                    source_doc=next(x for x in docs if x['id']==source['document_id'])
                    other_docs={d['id'] for d in docs if d['id']!=source['document_id'] and (
                         target_doc==d['id'] or (target_doc=='all' and d['group_key']!=source_doc['group_key']))}
                    targets=[dict(r) for r in con.execute('SELECT * FROM units ORDER BY document_id,sort_order,id')
                             if r['document_id'] in other_docs and r['body'].strip()]
                    relations=[dict(r) for r in con.execute('SELECT source_id,target_id,status FROM relations WHERE source_id=?',(source_id,))]
                candidates=find_related(dict(source),targets,relations,docs,limit)
                return self.json_response({'method':'transparent-structure-and-lexical-v1','uses_ai':False,
                    'source_id':source_id,'target_document_id':target_doc,'scanned_targets':len(targets),
                    'results':candidates,'count':len(candidates),
                    'disclaimer':'Strukturální a lexikální kandidáti; nikoliv ověřené odborné souvislosti. Schválení je vždy ruční.'})
            except (ValueError,TypeError) as error:
                return self.json_response({'error':str(error)},400)
        if path=='/api/reference-suggestions':
            # Lightweight, deterministic suggestion endpoint. No DB writes.
            unit_id=(parse_qs(parts.query).get('unit_id') or [''])[0]
            with connect() as con:
                row=con.execute('SELECT * FROM units WHERE id=?',(unit_id,)).fetchone()
                if not row:
                    return self.json_response({'error':'Neznámé ustanovení'},404)
                unit=dict(row)
                known=[r['id'] for r in con.execute('SELECT id FROM units WHERE document_id=?',(unit['document_id'],))]
                existing=[dict(r) for r in con.execute('SELECT source_id,target_id,relation_type,status FROM relations WHERE source_id=?',(unit_id,))]
            return self.json_response({'unit_id':unit_id,'method':'explicit-citation-v1',
                'scope':'same-document','suggestions':suggest_explicit_links(unit,known,existing)})
        if path=='/api/reference-batch':
            args=parse_qs(parts.query)
            get=lambda key,default='':(args.get(key) or [default])[0]
            try:
                result=scan_reference_batch(get('scope','document'),get('document_id'),get('unit_id'),
                                            get('state','all'),get('search'),int(get('offset','0')),int(get('limit','50')))
                return self.json_response(result)
            except (ValueError,TypeError) as error:
                return self.json_response({'error':str(error)},400)
        if path=='/api/unit-edit-history':
            query=parse_qs(parts.query)
            unit=(query.get('unit_id') or [''])[0]
            if unit:
                with connect() as con:
                    results=[dict(r) for r in con.execute('SELECT id,unit_id,event,reason,created_at FROM unit_edit_history WHERE unit_id=? ORDER BY id DESC',(unit,))]
                return self.json_response(results)
            try:
                ident=int((query.get('id') or ['0'])[0])
                if ident<1:raise ValueError('Neznámá historie')
                with connect() as con:
                    item=con.execute('SELECT * FROM unit_edit_history WHERE id=?',(ident,)).fetchone()
                if not item:return self.json_response({'error':'Záznam nebyl nalezen'},404)
                return self.json_response(dict(item))
            except ValueError:return self.json_response({'error':'Neplatný identifikátor'},400)
        if path=='/api/state': return self.json_response(snapshot())
        if path=='/api/config': return self.json_response({'token':CSRF,'version':VERSION,'local_only':True})
        if path=='/api/preview': return self.json_response(published())
        if path=='/api/draft-preview': return self.json_response(reader_data(draft=True))
        if path in ('/api/education-export','/api/backup'):
            if path.endswith('education-export'):
                payload=published()
            else:
                payload={'format':'regulaquest-studio-backup-v1','backup_at':now(),**snapshot()}
                # Unlike the on-screen state, a backup retains the COMPLETE edit
                # history with before/after snapshots for future recovery.
                with connect() as con:
                    payload['unit_edit_history']=[dict(r) for r in con.execute('SELECT * FROM unit_edit_history ORDER BY id')]
            b=json.dumps(payload,ensure_ascii=False,indent=2).encode('utf-8')
            filename='regulaquest-student-data.json' if path.endswith('education-export') else 'regulaquest-studio-backup.json'
            self.send_response(200);self.headers_common('application/json; charset=utf-8')
            self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
            self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if path=='/reader':
            self.send_response(301);self.send_header('Location','/reader/');self.end_headers();return
        base,rel=(READER,path[len('/reader/'):]) if path.startswith('/reader/') else (APP,path.lstrip('/'))
        if rel=='' or rel.endswith('/'): rel+='index.html'
        safe=(base / rel).resolve()
        if not safe.is_relative_to(base) or not safe.is_file():
            self.send_error(404,'Nenalezeno');return
        b=safe.read_bytes();typ=mimetypes.guess_type(str(safe))[0] or 'application/octet-stream'
        if typ.startswith('text/') or typ in ('application/javascript','application/json'): typ+='; charset=utf-8'
        self.send_response(200);self.headers_common(typ);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        if urlsplit(self.path).path not in ('/api/action','/api/import'): self.send_error(404);return
        if self.headers.get('X-RQ-Token')!=CSRF:
            self.json_response({'error':'Neautorizovaný místní požadavek'},403);return
        if self.headers.get_content_type()!='application/json':
            self.json_response({'error':'Vyžadován JSON'},415);return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<2 or size>35_000_000: raise ValueError('Neplatná velikost požadavku')
            obj=json.loads(self.rfile.read(size))
            if urlsplit(self.path).path=='/api/import': self.json_response(import_file(obj))
            else: self.json_response(update(obj))
        except (ValueError,sqlite3.IntegrityError,KeyError,TypeError) as e: self.json_response({'error':str(e)},400)
        except Exception as e: self.json_response({'error':'Interní chyba: '+str(e)},500)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);parser.add_argument('--no-browser',action='store_true');args=parser.parse_args()
    init_db()
    try: server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError as e:
        print('Nelze spustit server:',e); return
    url=f'http://127.0.0.1:{args.port}/'
    print(f'RegulaQuest Studio {VERSION} | pouze lokální přístup')
    print('Otevři:',url)
    print('Ukončení: Ctrl+C')
    if not args.no_browser: threading.Timer(0.7,lambda:webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nStudio ukončeno.')
    finally: server.server_close()

if __name__=='__main__': main()
