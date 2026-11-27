"""Testy databáze RegulaQuest (migrace v supabase/migrations) na lokálním PostgreSQL.

Spuštění:  RQ_PG_DSN="host=/tmp/pg port=5544 user=postgres" python3 -m unittest supabase/tests/test_databaze.py -v
Každý test dostane čerstvou databázi. Supabase se napodobuje souborem 00_lokalni_napodobeni_supabase.sql.
Volitelně RQ_SQLITE=cesta k testovací databázi lokálního Studia → srovnání publikace s Python verzí.
"""
import json
import os
import sqlite3
import unittest
import uuid
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None

DSN = os.environ.get('RQ_PG_DSN')
ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / 'tests/00_lokalni_napodobeni_supabase.sql'] + sorted((ROOT / 'migrations').glob('[0-9][0-9]_*.sql'))

OWNER, ADMIN, STUDENT, STUDENT2 = (str(uuid.UUID(int=i)) for i in (1, 2, 3, 4))


@unittest.skipUnless(DSN and psycopg, 'Nastavte RQ_PG_DSN (lokální PostgreSQL)')
class DatabaseTest(unittest.TestCase):
    def setUp(self):
        name = 'rq_' + uuid.uuid4().hex[:10]
        with psycopg.connect(DSN, autocommit=True) as c:
            c.execute(f'create database {name}')
        self.db = name
        self.con = psycopg.connect(DSN + f' dbname={name}', autocommit=True)
        for f in FILES:
            self.con.execute(f.read_text())
        g = self.con.execute("insert into student_groups(name) values ('SIPZ – nástup 2026') returning id").fetchone()[0]
        self.group = g
        for uid, email, user, role, grp in ((OWNER, 'vojta@admin.regulaquest.cz', 'vojta', 'owner', None),
                                            (ADMIN, 'ondra@admin.regulaquest.cz', 'ondra', 'admin', None),
                                            (STUDENT, 'rq-aaa111@studenti.regulaquest.invalid', 'rq-aaa111', 'student', g),
                                            (STUDENT2, 'rq-bbb222@studenti.regulaquest.invalid', 'rq-bbb222', 'student', g)):
            self.con.execute('insert into auth.users(id,email) values (%s,%s)', (uid, email))
            self.con.execute('insert into profiles(user_id,username,role,group_id) values (%s,%s,%s,%s)', (uid, user, role, grp))

    def tearDown(self):
        self.con.close()
        with psycopg.connect(DSN, autocommit=True) as c:
            c.execute(f'drop database {self.db} with (force)')

    # ------------------------------------------------------------ pomocné
    def as_user(self, uid):
        self.con.execute('reset role')
        self.con.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or '',))
        self.con.execute('set role anon' if uid is None else 'set role authenticated')

    def call(self, fn, *args):
        ph = ','.join(['%s'] * len(args))
        args = [json.dumps(a) if isinstance(a, (dict, list)) else a for a in args]
        return self.con.execute(f'select {fn}({ph})', args).fetchone()[0]

    def fails(self, text, fn, *args):
        with self.assertRaises(psycopg.Error) as e:
            self.call(fn, *args)
        self.assertIn(text, str(e.exception))

    def sql(self, q, *a):
        self.con.execute('reset role')
        return self.con.execute(q, a).fetchall()

    def setup_doc(self):
        self.as_user(OWNER)
        self.call('rq_new_document', {'id': 'mdr-cs', 'title': 'MDR', 'family': 'MDR', 'language': 'cs', 'group_key': 'eu-2017-745',
                                      'document_type': 'regulation', 'jurisdiction': 'eu'})
        units = [{'id': 'mdr-cs-annex-viii', 'parent_id': None, 'kind': 'annex', 'label': 'Příloha VIII', 'body': 'Celá příloha',
                  'source_note': 'EUR-Lex; automatický import', 'sort_order': 1},
                 {'id': 'mdr-cs-rule-11', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 11', 'body': 'Software…',
                  'source_note': 'EUR-Lex; automatický import', 'sort_order': 2},
                 {'id': 'mdr-cs-rule-12', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 12', 'body': 'Aktivní…',
                  'source_note': 'EUR-Lex; automatický import', 'sort_order': 3}]
        return self.call('rq_import_units', 'mdr-cs', units, {'filename': 'mdr.html', 'sha256': 'a' * 64, 'format': 'eurlex-html'}, False)

    def updated_at(self, uid):
        return self.sql('select updated_at from units where id=%s', uid)[0][0]

    # ------------------------------------------------------------ přístup
    def test_anonymous_sees_nothing(self):
        self.setup_doc()
        self.as_user(None)
        with self.assertRaises(psycopg.Error):
            self.con.execute('select * from units').fetchall()
        with self.assertRaises(psycopg.Error):
            self.call('rq_current_publication')

    def test_student_cannot_read_working_data_or_write(self):
        self.setup_doc()
        self.as_user(STUDENT)
        self.assertEqual(self.con.execute('select count(*) from units').fetchone()[0], 0)
        self.assertEqual(self.con.execute('select count(*) from profiles').fetchone()[0], 1)  # jen vlastní profil
        self.fails('jen admin', 'rq_save_unit_text', 'mdr-cs-rule-11', 'hack')
        self.fails('jen admin', 'rq_studio_state')
        self.fails('jen admin', 'rq_draft_preview')
        with self.assertRaises(psycopg.Error):
            self.con.execute("update units set body='x'")

    def test_admin_cannot_write_tables_directly(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.assertEqual(self.con.execute('select count(*) from units').fetchone()[0], 3)
        for q in ("update units set text_status='verified'", "delete from comments", "insert into publications(data) values ('{}')"):
            with self.assertRaises(psycopg.Error):
                self.con.execute(q)

    def test_student_gets_only_published_verified_content(self):
        self.setup_doc()
        self.as_user(STUDENT)
        self.assertIsNone(self.call('rq_current_publication'))
        self.as_user(ADMIN)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        cid = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', 'Redakce')
        self.call('rq_new_comment', 'mdr-cs-rule-12', 'explanation', 'cs', 'Výklad k neověřenému', '')
        self.call('rq_comment_status', cid, 'approved')
        pub = self.call('rq_publish', 'první')
        self.assertEqual(pub['counts']['verified_units'], 1)
        self.as_user(STUDENT)
        data = self.call('rq_current_publication')
        units = {u['id']: u for u in data['units']}
        self.assertEqual(set(units), {'mdr-cs-annex-viii', 'mdr-cs-rule-11'})
        self.assertTrue(units['mdr-cs-annex-viii']['navigation_only'])
        self.assertEqual(units['mdr-cs-annex-viii']['body'], '')
        self.assertNotIn('Aktivní…', json.dumps(data, ensure_ascii=False))
        self.assertEqual([c['id'] for c in data['comments']], [cid])
        # Pracovní změna se studentů nedotkne, dokud se nepublikuje.
        self.as_user(ADMIN)
        self.call('rq_verify_unit', 'mdr-cs-rule-12', None)
        self.as_user(STUDENT)
        self.assertEqual(self.call('rq_current_publication')['counts']['verified_units'], 1)

    def test_deactivation_blocks_student(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.call('rq_publish', '')
        self.call('rq_set_profile_active', STUDENT, False)
        self.as_user(STUDENT)
        self.fails('není aktivní', 'rq_current_publication')
        self.as_user(STUDENT2)
        self.assertIsNotNone(self.call('rq_current_publication'))
        self.as_user(ADMIN)
        self.call('rq_update_group', self.group, None, None, None, False)
        self.as_user(STUDENT2)
        self.fails('není aktivní', 'rq_current_publication')

    def test_private_helpers_and_storage_are_closed(self):
        self.setup_doc()
        self.as_user(ADMIN)
        with self.assertRaises(psycopg.Error):  # vnitřní funkce nejsou přes API dostupné ani adminovi
            self.call('rq_private.invalidate_approval', ['mdr-cs-rule-11'])
        self.con.execute('reset role')
        self.con.execute("insert into storage.objects(bucket_id,name) values ('originals','mdr.html'),('figures','obr.png')")
        self.as_user(ADMIN)
        self.assertEqual(self.con.execute('select count(*) from storage.objects').fetchone()[0], 2)
        self.as_user(STUDENT)
        self.assertEqual([r[0] for r in self.con.execute('select bucket_id from storage.objects').fetchall()], ['figures'])
        with self.assertRaises(psycopg.Error):
            self.con.execute("insert into storage.objects(bucket_id,name) values ('figures','podvrh.png')")

    def test_only_owner_manages_admins(self):
        self.as_user(ADMIN)
        self.fails('jen správce', 'rq_set_profile_active', OWNER, False)
        self.as_user(OWNER)
        self.call('rq_set_profile_active', ADMIN, False)
        self.as_user(ADMIN)
        self.fails('jen admin', 'rq_studio_state')

    # ------------------------------------------------------------ odborná pravidla
    def test_text_change_returns_approvals_to_review(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_verify_unit', 'mdr-cs-rule-12', None)
        cid = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', '')
        self.call('rq_comment_status', cid, 'approved')
        rid = self.call('rq_new_relation', 'mdr-cs-rule-11', 'mdr-cs-rule-12', 'related', 'Souvislost', '', 'manual')
        self.call('rq_relation_status', rid, 'approved')
        self.call('rq_save_unit_text', 'mdr-cs-rule-11', 'Nový text', 'Oprava', None)
        st = self.sql("select text_status from units where id='mdr-cs-rule-11'")[0][0]
        self.assertEqual(st, 'needs_review')
        self.assertEqual(self.sql('select status from comments where id=%s', cid)[0][0], 'draft')
        self.assertEqual(self.sql('select status from relations where id=%s', rid)[0][0], 'proposed')
        self.assertEqual(self.sql("select actor from unit_edit_history where event='edit_text'")[0][0], uuid.UUID(ADMIN))

    def test_optimistic_lock(self):
        self.setup_doc()
        self.as_user(ADMIN)
        old = self.updated_at('mdr-cs-rule-11')
        self.call('rq_save_unit_text', 'mdr-cs-rule-11', 'A', '', old)
        self.fails('mezitím změnilo', 'rq_save_unit_text', 'mdr-cs-rule-11', 'B', '', old)

    def test_comment_and_relation_revisions(self):
        self.setup_doc()
        self.as_user(ADMIN)
        cid = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', '')
        self.fails('jen schválený', 'rq_propose_comment_revision', cid, 'edit', 'důvod', None, None, 'Nové', None)
        self.call('rq_comment_status', cid, 'approved')
        rev = self.call('rq_propose_comment_revision', cid, 'edit', 'zpřesnění', None, None, 'Nové znění', None)
        self.fails('už čeká', 'rq_propose_comment_revision', cid, 'archive', 'jiný', None, None, None, None)
        self.call('rq_decide_comment_revision', rev, 'approved')
        self.assertEqual(self.sql('select body, status from comments where id=%s', cid)[0], ('Nové znění', 'approved'))
        rid = self.call('rq_new_relation', 'mdr-cs-rule-11', 'mdr-cs-rule-12', 'related', 'Důvod', '', 'manual')
        self.call('rq_relation_status', rid, 'approved')
        rrev = self.call('rq_propose_relation_revision', rid, 'archive', 'zastaralé', None, None, None, None)
        self.call('rq_decide_relation_revision', rrev, 'approved')
        self.assertEqual(self.sql('select status from relations where id=%s', rid)[0][0], 'archived')
        self.fails('samo se sebou', 'rq_new_relation', 'mdr-cs-rule-11', 'mdr-cs-rule-11', 'related', 'x', '', 'manual')

    def test_import_protects_verified_and_edited(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_save_unit_text', 'mdr-cs-rule-12', 'Ručně opravený text', 'ručně', None)
        again = [{'id': 'mdr-cs-rule-11', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 11', 'body': 'JINÝ',
                  'source_note': 'automatický import', 'sort_order': 2},
                 {'id': 'mdr-cs-rule-12', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 12', 'body': 'JINÝ',
                  'source_note': 'automatický import', 'sort_order': 3},
                 {'id': 'mdr-cs-annex-viii', 'parent_id': None, 'kind': 'annex', 'label': 'Příloha VIII', 'body': 'NOVÁ PŘÍLOHA',
                  'source_note': 'automatický import', 'sort_order': 1}]
        res = self.call('rq_import_units', 'mdr-cs', again, {'filename': 'x', 'sha256': 'b' * 64, 'format': 'eurlex-html'}, True)
        self.assertEqual((res['protected'], res['replaced']), (2, 1))
        bodies = dict(self.sql("select id, body from units"))
        self.assertEqual(bodies['mdr-cs-rule-11'], 'Software…')
        self.assertEqual(bodies['mdr-cs-rule-12'], 'Ručně opravený text')
        self.assertEqual(bodies['mdr-cs-annex-viii'], 'NOVÁ PŘÍLOHA')

    def test_import_new_version(self):
        self.setup_doc()
        self.as_user(ADMIN)
        for uid in ('mdr-cs-annex-viii', 'mdr-cs-rule-11', 'mdr-cs-rule-12'):
            self.call('rq_verify_unit', uid, None)
        rel = self.call('rq_new_relation', 'mdr-cs-rule-11', 'mdr-cs-rule-12', 'related', 'souvisí', '', 'manual')
        self.call('rq_relation_status', rel, 'approved')
        new = [{'id': 'mdr-cs-annex-viii', 'parent_id': None, 'kind': 'annex', 'label': 'Příloha VIII', 'body': 'Celá příloha  ',
                'source_note': 'nové znění; automatický import', 'sort_order': 1},
               {'id': 'mdr-cs-rule-11', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 11', 'body': 'Software (změněno)',
                'source_note': 'nové znění; automatický import', 'sort_order': 2},
               {'id': 'mdr-cs-rule-23', 'parent_id': 'mdr-cs-annex-viii', 'kind': 'rule', 'label': 'Pravidlo 23', 'body': 'Nové pravidlo',
                'source_note': 'nové znění; automatický import', 'sort_order': 4}]
        res = self.call('rq_import_units', 'mdr-cs', new, {'mode': 'update', 'chunk': True}, False)
        self.assertEqual((res['same'], res['changed'], res['added']), (1, 1, 1))
        fin = self.call('rq_import_finish', 'mdr-cs', ['mdr-cs-annex-viii', 'mdr-cs-rule-11', 'mdr-cs-rule-23'],
                        {'mode': 'update', 'filename': 'n.html', 'sha256': 'c' * 64, 'format': 'eurlex-html', 'counts': res})
        self.assertEqual(fin['removed'], 1)
        st = {r[0]: r[1:] for r in self.sql("select id, text_status, archived, body from units")}
        self.assertEqual(st['mdr-cs-annex-viii'][:2], ('verified', False))      # shodný text zůstává ověřený
        self.assertEqual(st['mdr-cs-rule-11'][:3], ('needs_review', False, 'Software (změněno)'))
        self.assertEqual(st['mdr-cs-rule-12'][1], True)                          # chybí v novém znění → archiv
        self.assertEqual(st['mdr-cs-rule-23'][0], 'needs_review')
        self.assertEqual(self.sql("select status from relations")[0][0], 'proposed')
        before = self.sql("select before_json->>'body' from unit_edit_history where unit_id='mdr-cs-rule-11' and event='new_version'")
        self.assertEqual(before[0][0], 'Software…')
        self.assertEqual(self.sql("select count(*) from import_log")[0][0], 2)
        # ručně založená část se nikdy automaticky nearchivuje
        self.call('rq_new_unit', {'document_id': 'mdr-cs', 'kind': 'section', 'label': 'Poznámka'})
        self.call('rq_import_finish', 'mdr-cs', ['mdr-cs-annex-viii'], {'mode': 'update'})
        self.assertEqual(self.sql("select archived from units where label='Poznámka'")[0][0], False)

    def test_archive_and_restore_unit(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.fails('podřazené části', 'rq_archive_unit', 'mdr-cs-annex-viii', self.updated_at('mdr-cs-annex-viii'), 'x')
        self.call('rq_verify_unit', 'mdr-cs-rule-12', None)
        self.call('rq_archive_unit', 'mdr-cs-rule-12', self.updated_at('mdr-cs-rule-12'), 'duplicita')
        self.assertTrue(self.sql("select archived from units where id='mdr-cs-rule-12'")[0][0])
        c = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', 'R')
        self.call('rq_archive_unit', 'mdr-cs-rule-11', self.updated_at('mdr-cs-rule-11'), 'x')
        self.fails('archivované', 'rq_comment_status', c, 'approved')
        self.call('rq_restore_unit', 'mdr-cs-rule-11', 'x')
        self.call('rq_restore_unit', 'mdr-cs-rule-12', 'omyl')
        self.assertEqual(self.sql("select archived, text_status from units where id='mdr-cs-rule-12'")[0], (False, 'needs_review'))
        self.as_user(STUDENT)
        self.fails('', 'rq_archive_unit', 'mdr-cs-rule-11', None, 'x')

    def test_translated_comment_tracks_source(self):
        self.setup_doc()
        self.as_user(ADMIN)
        src = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Původní výklad', 'R')
        tr = self.call('rq_new_comment', 'mdr-cs-rule-12', 'explanation', 'en', 'Translated', 'R', src)
        self.assertEqual(self.sql("select translated_from, source_body from comments where id=%s", tr)[0], (src, 'Původní výklad'))
        self.call('rq_edit_comment_draft', src, 'explanation', 'cs', 'Změněný výklad', 'R')
        self.call('rq_mark_translation_current', tr)
        self.assertEqual(self.sql("select source_body from comments where id=%s", tr)[0][0], 'Změněný výklad')
        self.fails('nevznikl', 'rq_mark_translation_current', src)

    def test_import_with_blocks(self):
        self.setup_doc()
        self.as_user(ADMIN)
        blocks = [{'type': 'text', 'html': 'Úvod<br><br>Druhý odstavec'},
                  {'type': 'table', 'caption': '', 'notes': '', 'rows': [[{'text': 'Class', 'header': True}, {'text': 'Rule 5', 'header': True}], [{'text': 'I'}, {'text': 'Text'}]]},
                  {'type': 'figure', 'path': 'mdcg/abc/p19.png', 'caption': 'Schéma', 'alt': 'Rule 1', 'page': 19}]
        u = [{'id': 'mdr-cs-sec-1', 'kind': 'section', 'label': '1', 'heading': 'X', 'content_blocks': blocks, 'sort_order': 9}]
        self.call('rq_import_units', 'mdr-cs', u, {'mode': 'new'}, False)
        body, cb = self.sql("select body, content_blocks from units where id='mdr-cs-sec-1'")[0]
        self.assertIn('Rule 5', body); self.assertEqual(len(cb), 3)
        res = self.call('rq_import_units', 'mdr-cs', u, {'mode': 'update', 'chunk': True}, False)
        self.assertEqual(res['same'], 1)
        u[0]['content_blocks'][0]['html'] = 'Změněný úvod'
        res = self.call('rq_import_units', 'mdr-cs', u, {'mode': 'update', 'chunk': True}, False)
        self.assertEqual(res['changed'], 1)

    def test_anchored_comments_and_key_passages(self):
        self.setup_doc()
        self.as_user(ADMIN)
        c = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', 'R', '', 'Software', 1)
        self.assertEqual(self.sql("select anchor_text, anchor_occurrence from comments where id=%s", c)[0], ('Software', 1))
        k = self.call('rq_new_comment', 'mdr-cs-rule-11', 'key', 'cs', '', 'R', '', 'Software', 1)
        self.assertEqual(self.sql("select body from comments where id=%s", k)[0][0], 'Klíčová pasáž')
        self.fails('nebyl nalezen', 'rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'x', 'R', '', 'Neexistující text', 1)
        self.fails('vybraný text', 'rq_new_comment', 'mdr-cs-rule-11', 'key', 'cs', '', 'R', '', '', 1)
        self.call('rq_comment_status', c, 'approved')
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_publish', 'x')
        self.as_user(STUDENT)
        pub = self.call('rq_current_publication')
        self.assertEqual(pub['comments'][0]['anchor_text'], 'Software')

    def test_terms_and_layers(self):
        self.setup_doc()
        self.as_user(ADMIN)
        n = self.call('rq_import_terms', 'mdr-cs-rule-11', [{'number': 1, 'source_label': 'softwarem', 'name': 'software', 'forms': 'software*'},
                                                           {'number': 2, 'source_label': 'x', 'name': 'x', 'forms': ''}])
        self.assertEqual(n, 2)
        self.assertEqual(self.call('rq_import_terms', 'mdr-cs-rule-11', [{'number': 1, 'source_label': 'softwarem', 'name': 'jiné', 'forms': ''}]), 0)
        tid = self.sql("select id from terms where number=1")[0][0]
        self.assertEqual(self.sql("select name from terms where id=%s", tid)[0][0], 'software')
        self.call('rq_edit_term', tid, 'software (SW)', 'software*\nSW')
        self.assertEqual(self.call('rq_term_status', [tid], 'approved'), 1)
        self.fails('nejdřív vyřaďte', 'rq_delete_terms', [tid])
        t2 = self.sql("select id from terms where number=2")[0][0]
        self.assertEqual(self.call('rq_delete_terms', [t2]), 1)
        d = self.call('rq_new_comment', 'mdr-cs-rule-11', 'duty', 'cs', '', 'R', '', 'Software', 1)
        self.assertEqual(self.sql("select body from comments where id=%s", d)[0][0], 'Povinnost')
        self.fails('vybraný text', 'rq_new_comment', 'mdr-cs-rule-11', 'deadline', 'cs', '', 'R', '', '', 1)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_publish', 'x')
        self.assertIn('terms', self.call('rq_backup'))
        self.as_user(STUDENT)
        pub = self.call('rq_current_publication')
        self.assertEqual([t['name'] for t in pub['terms']], ['software (SW)'])
        self.fails('', 'rq_import_terms', 'mdr-cs-rule-11', [])

    def test_anchored_relations(self):
        self.setup_doc()
        self.as_user(ADMIN)
        tgt = self.sql("select id from units where id <> 'mdr-cs-rule-11' and not archived limit 1")[0][0]
        a = self.call('rq_new_relation', 'mdr-cs-rule-11', tgt, 'references', 'důvod', '', 'manual', 'Software', 1)
        b = self.call('rq_new_relation', 'mdr-cs-rule-11', tgt, 'references', 'důvod 2', '', 'manual', '', 1)
        self.assertNotEqual(a, b)
        self.fails('už existuje', 'rq_new_relation', 'mdr-cs-rule-11', tgt, 'references', 'x', '', 'manual', 'Software', 1)
        self.fails('nebyl nalezen', 'rq_new_relation', 'mdr-cs-rule-11', tgt, 'related', 'x', '', 'manual', 'Nic takového', 1)
        r = self.call('rq_batch_new_relations', [{'source_id': 'mdr-cs-rule-11', 'target_id': tgt, 'relation_type': 'related', 'rationale': 'r', 'anchor_text': 'Software', 'anchor_occurrence': 1}])
        self.assertEqual(r['created'], 1)
        self.assertEqual(self.sql("select anchor_text from relations where relation_type='related'")[0][0], 'Software')
        self.assertIn('anchor_text', self.call('rq_draft_preview')['relations'][0])

    def test_unit_tags(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.assertEqual(self.call('rq_set_unit_tags', 'mdr-cs-rule-11', ['role_vyrobce', 'typ_software']), 1)
        self.assertEqual(self.sql("select tags from units where id='mdr-cs-rule-11'")[0][0], ['role_vyrobce', 'typ_software'])
        self.fails('Neznámý štítek', 'rq_set_unit_tags', 'mdr-cs-rule-11', ['pekar'])
        g = self.call('rq_save_tag_group', '', 'Oblast GDPR', 50)
        self.assertEqual(g, 'oblast_gdpr')
        k = self.call('rq_save_tag', '', g, 'Správce údajů', 1)
        self.assertEqual(k, 'oblast_gdpr_spravce_udaju')
        self.call('rq_archive_tag', k, True)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        pv = self.call('rq_draft_preview')
        self.assertEqual([x for x in pv['units'] if x['id'] == 'mdr-cs-rule-11'][0]['tags'], ['role_vyrobce', 'typ_software'])
        self.assertNotIn(k, [t['key'] for t in pv['tags']])
        self.assertIn('tags', self.call('rq_backup'))

    def test_document_archive_and_delete(self):
        self.setup_doc()
        self.as_user(ADMIN)
        title = self.sql("select title from documents where id='mdr-cs'")[0][0]
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_archive_document', 'mdr-cs', True)
        self.assertEqual(self.call('rq_draft_preview')['documents'], [])
        self.call('rq_archive_document', 'mdr-cs', False)
        self.fails('opište', 'rq_delete_document', 'mdr-cs', 'jiný název')
        c = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'x', 'R')
        self.call('rq_comment_status', c, 'approved')
        self.fails('schválené komentáře', 'rq_delete_document', 'mdr-cs', title)
        self.call('rq_publish', 'x')
        self.fails('publikován', 'rq_delete_document', 'mdr-cs', title)
        self.sql("with x as (delete from publications returning 1) select count(*) from x")
        self.sql("with x as (update comments set status='draft' returning 1) select count(*) from x")
        r = self.call('rq_delete_document', 'mdr-cs', title)
        self.assertEqual(r['units'], 3)
        self.assertEqual(self.sql("select count(*) from units")[0][0], 0)

    def test_delete_document_cleans_links(self):
        self.setup_doc()
        self.as_user(ADMIN)
        title = self.sql("select title from documents where id='mdr-cs'")[0][0]
        gk = self.sql("select coalesce(group_key, id) from documents where id='mdr-cs'")[0][0]
        self.sql("with x as (insert into paths(id, title) values ('p1', 'Trasa') returning 1) select count(*) from x")
        self.sql("with x as (insert into path_steps(id, path_id, sort, unit_id, note) values ('ps1', 'p1', 10, 'mdr-cs-rule-11', ''), ('ps2', 'p1', 20, null, 'úvod') returning 1) select count(*) from x")
        c = self.call('rq_save_case', None, {'title': 'Případ'})
        self.call('rq_save_case_step', None, c, {'title': 'Krok', 'unit_id': 'mdr-cs-rule-11'})
        self.call('rq_link_case_unit', c, 'mdr-cs-rule-11', True)
        pid = self.call('rq_import_presentation', {'title': 'P'}, [{'data': {'title': 'S'}}])
        self.call('rq_link_presentation_unit', pid, None, 'mdr-cs-rule-11', True)
        n = self.call('rq_save_news_item', None, {'url': 'https://example.org/n', 'title': 'N', 'group_keys': [gk], 'unit_ids': ['mdr-cs-rule-11']})
        self.sql("with x as (insert into document_areas(group_key, area_key, role) values (%s, 'zp', 'core') returning 1) select count(*) from x", gk)
        r = self.call('rq_delete_document', 'mdr-cs', title)
        self.assertEqual(self.sql("select count(*) from units")[0][0], 0)
        self.assertEqual([x[0] for x in self.sql("select id from path_steps order by sort")], ['ps2'])           # krok s ustanovením pryč, textový zůstal
        self.assertEqual(self.sql("select unit_id, title from case_steps")[0], (None, 'Krok'))                  # krok případu zůstal bez odkazu
        self.assertEqual(self.sql("select count(*) from case_links")[0][0], 0)
        self.assertEqual(self.sql("select count(*) from presentation_unit_links")[0][0], 0)
        self.assertEqual(self.sql("select unit_ids, group_keys from news_items where id = %s", n)[0], ([], []))
        self.assertEqual(self.sql("select count(*) from document_areas where group_key = %s", gk)[0][0], 0)    # skupina už nemá žádný dokument

    def test_paths(self):
        self.setup_doc()
        self.as_user(ADMIN)
        pid = self.call('rq_save_path', '', 'Klasifikace softwaru', 'Úvod', 'draft')
        a = self.call('rq_save_path_step', '', pid, 'mdr-cs-rule-11', '', 'Začněte pravidlem 11.', 'Software', 1)
        b = self.call('rq_save_path_step', '', pid, '', 'Shrnutí', 'Co si zapamatovat.', '', 1)
        self.fails('nebyl nalezen', 'rq_save_path_step', '', pid, 'mdr-cs-rule-11', '', 'x', 'Nic', 1)
        self.call('rq_move_path_step', b, -1)
        self.assertEqual([r[0] for r in self.sql("select id from path_steps order by sort")], [b, a])
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.assertEqual(len(self.call('rq_draft_preview')['paths'][0]['steps']), 2)
        self.call('rq_publish', 'x')
        self.assertEqual(self.call('rq_current_publication')['paths'], [])
        self.call('rq_save_path', pid, 'Klasifikace softwaru', 'Úvod', 'published')
        self.fails('nejdřív', 'rq_delete_path', pid)
        self.call('rq_publish', 'y')
        self.as_user(STUDENT)
        pub = self.call('rq_current_publication')
        self.assertEqual(pub['paths'][0]['steps'][1]['anchor_text'], 'Software')

    def test_publication_changes_and_reader_state(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.call('rq_update_document', 'mdr-cs', {'short_title': 'MDR – nařízení', 'featured': True})
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_publish', 'první')
        c = self.call('rq_new_comment', 'mdr-cs-rule-11', 'explanation', 'cs', 'Výklad', 'R')
        self.call('rq_comment_status', c, 'approved')
        r = self.call('rq_publish', 'druhá')
        self.assertEqual(r['changes']['comments_new'], 1)
        self.as_user(STUDENT)
        pub = self.call('rq_current_publication')
        self.assertEqual(pub['documents'][0]['short_title'], 'MDR – nařízení')
        self.assertTrue(pub['documents'][0]['featured'])
        self.assertEqual(len(pub['history']), 2)
        self.assertEqual(pub['history'][0]['changes']['items'][0]['unit_id'], 'mdr-cs-rule-11')
        self.assertIn('mdr-cs', pub['doc_updated'])
        m = self.call('rq_save_mark', 'mdr-cs-rule-11', 'Pravidlo 11')
        self.assertEqual(self.call('rq_save_mark', 'mdr-cs-rule-11', 'Software'), m)
        self.call('rq_set_position', 'eu-2017-745', 'mdr-cs-rule-11')
        self.call('rq_step_done', 'path-x', 'step-1')
        st = self.call('rq_my_reader_state')
        self.assertEqual([x['label'] for x in st['marks']], ['Software'])
        self.assertEqual(st['positions'][0]['unit_id'], 'mdr-cs-rule-11')
        self.assertEqual(len(st['progress']), 1)
        self.as_user(ADMIN)
        self.assertEqual(self.call('rq_my_reader_state')['marks'], [])
        self.call('rq_delete_mark', m)
        self.as_user(STUDENT)
        self.assertEqual(len(self.call('rq_my_reader_state')['marks']), 1)
        self.call('rq_delete_mark', m)
        self.assertEqual(self.call('rq_my_reader_state')['marks'], [])

    def test_areas(self):
        self.setup_doc()
        self.as_user(ADMIN)
        gk = self.sql("select group_key from documents where id='mdr-cs'")[0][0]
        self.call('rq_set_document_area', gk, 'zp', 'core', '', 1)
        self.fails('kdy je dokument relevantní', 'rq_set_document_area', gk, 'metrologie', 'situational', '', 1)
        self.call('rq_set_document_area', gk, 'metrologie', 'situational', 'ZP s měřicí funkcí', 1)
        k = self.call('rq_save_area', '', 'Zdravotnická technika', '', None)
        self.assertEqual(k, 'zdravotnicka_technika')
        self.call('rq_archive_area', 'metrologie', True)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        pv = self.call('rq_draft_preview')
        self.assertEqual([(x['area_key'], x['role']) for x in pv['document_areas']], [('zp', 'core')])
        self.assertIn('zdravotnicka_technika', [a['key'] for a in pv['areas']])
        self.call('rq_remove_document_area', gk, 'zp')
        self.assertEqual(self.call('rq_draft_preview')['document_areas'], [])
        self.assertIn('document_areas', self.call('rq_backup'))

    def test_finder_and_guide(self):
        self.setup_doc()
        self.as_user(STUDENT)
        self.fails('', 'rq_set_tag_group_areas', 'typ', ['zp'])
        self.as_user(ADMIN)
        # výchozí sada průvodce a navázání skupin na oblast ZP
        self.assertEqual(self.sql("select area_keys from tag_groups where key='typ'")[0][0], ['zp'])
        self.assertEqual(self.sql("select count(*) from guide_questions")[0][0], 5)
        self.call('rq_set_tag_group_areas', 'role', ['zp', 'metrologie', 'zp'])
        self.assertEqual(self.sql("select area_keys from tag_groups where key='role'")[0][0], ['metrologie', 'zp'])
        self.fails('Neznámá oblast', 'rq_set_tag_group_areas', 'role', ['neexistuje'])
        opts = [{'label': 'Měří', 'areas': ['metrologie'], 'tags': ['trida_im']}, {'label': ' ', 'areas': []}, {'label': 'Neměří'}]
        q = self.call('rq_save_guide_question', None, 'Měří prostředek?', '', False, ['zp'], opts, None)
        row = self.sql("select options, sort from guide_questions where id=%s", q)[0]
        self.assertEqual([o['label'] for o in row[0]], ['Měří', 'Neměří'])
        self.assertEqual(row[1], 60)
        self.fails('alespoň dvě', 'rq_save_guide_question', q, 'X', '', False, [], [{'label': 'Jen jedna'}], None)
        self.fails('Neznámý štítek', 'rq_save_guide_question', q, 'X', '', False, [], [{'label': 'A', 'tags': ['nic']}, {'label': 'B'}], None)
        self.call('rq_move_guide_question', q, -1)
        order = [r[0] for r in self.sql("select id from guide_questions order by sort")]
        self.assertEqual(order.index(q), 4)
        self.call('rq_archive_guide_question', q, True)
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        pv = self.call('rq_draft_preview')
        self.assertEqual(len(pv['guide']), 5)
        self.assertNotIn(q, [x['id'] for x in pv['guide']])
        self.assertEqual(next(g for g in pv['tag_groups'] if g['key'] == 'role')['area_keys'], ['metrologie', 'zp'])
        self.call('rq_delete_guide_question', q)
        self.assertIn('guide_questions', self.call('rq_backup'))
        self.assertIn('guide_questions', self.call('rq_studio_state'))

    def test_news(self):
        self.setup_doc()
        rss = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>EK</title>'
               '<item><title>MDCG 2020-16 rev.5 - Guidance on Classification</title><link>https://health.ec.europa.eu/a_en</link>'
               '<guid>https://health.ec.europa.eu/a_en</guid><description>&lt;p&gt;MDCG 2020-16 &amp;amp; IVD&lt;/p&gt;</description>'
               '<pubDate>Wed, 09 Sep 2026 15:03:30 +0200</pubDate></item>'
               '<item><title><![CDATA[Upozornění na stahování šarží]]></title><link>https://sukl.gov.cz/b/</link>'
               '<description><![CDATA[<p>SÚKL upozorňuje…</p>]]></description><pubDate>Thu, 26 Nov 2026 12:14:01 +0000</pubDate></item>'
               '<item><title>Bez odkazu</title></item></channel></rss>')
        atom = ('<feed xmlns="http://www.w3.org/2005/Atom"><title>X</title><entry><title>Atom zpráva</title>'
                '<link rel="alternate" href="https://example.org/c"/><id>urn:c</id><updated>2026-10-01T10:00:00Z</updated>'
                '<summary>Krátce</summary></entry></feed>')
        # náhrada pg_net: požadavek hned „odpoví“ obsahem podle adresy
        self.con.execute('reset role')
        self.con.execute("create schema if not exists net")
        self.con.execute("create table net._http_response(id bigint, status_code int, content text, timed_out boolean, error_msg text)")
        self.con.execute("create table net.fake(url text, body text, code int)")
        self.con.execute("""create function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds int) returns bigint
            language plpgsql as $f$ declare i bigint := (select coalesce(max(id),0)+1 from net._http_response); begin
            insert into net._http_response select i, f.code, f.body, false, null from net.fake f where f.url = http_get.url; return i; end $f$""")
        self.as_user(ADMIN)
        rss_src = self.call('rq_save_news_source', None, 'EK', 'https://ex.eu/rss', ['zp'], True)
        atom_src = self.call('rq_save_news_source', None, 'Atom', 'https://ex.eu/atom', [], True)
        bad_src = self.call('rq_save_news_source', None, 'Rozbitý', 'https://ex.eu/html', [], True)
        self.fails('už existuje', 'rq_save_news_source', None, 'EK2', 'https://ex.eu/rss', [], True)
        self.sql("with x as (update news_sources set active=false where url like 'https://sukl%%' or url like 'https://health%%' returning 1) select count(*) from x")
        self.sql("with x as (insert into net.fake values ('https://ex.eu/rss', %s, 200), ('https://ex.eu/atom', %s, 200), ('https://ex.eu/html', '<html><body>nic', 200) returning 1) select count(*) from x", rss, atom)
        self.as_user(ADMIN)
        self.assertEqual(self.call('rq_news_fetch_now'), 3)
        n = self.call('rq_news_collect_now')
        self.assertEqual(n, 3)
        self.assertEqual(self.call('rq_news_fetch_now'), 3)
        self.assertEqual(self.call('rq_news_collect_now'), 0)      # podruhé nic nového
        st = self.call('rq_news_admin')
        items = {i['title']: i for i in st['items']}
        self.assertEqual(sorted(items), ['Atom zpráva', 'MDCG 2020-16 rev.5 - Guidance on Classification', 'Upozornění na stahování šarží'])
        ek = items['MDCG 2020-16 rev.5 - Guidance on Classification']
        self.assertEqual(ek['summary'], 'MDCG 2020-16 & IVD'); self.assertEqual(ek['area_keys'], ['zp']); self.assertEqual(ek['source_name'], 'EK')
        self.assertTrue(ek['published_at'].startswith('2026-09-09'))
        self.assertEqual(items['Upozornění na stahování šarží']['summary'], 'SÚKL upozorňuje…')
        self.assertEqual(items['Atom zpráva']['url'], 'https://example.org/c')
        self.assertIn('RSS/Atom', next(s for s in st['sources'] if s['id'] == bad_src)['last_error'])
        # úprava, propojení s ustanovením, zveřejnění
        self.call('rq_save_news_item', ek['id'], {'comment': 'Nová revize pokynu', 'tags': ['role_vyrobce'], 'area_keys': ['zp']})
        self.call('rq_news_link_unit', ek['id'], 'mdr-cs-rule-11', True)
        self.fails('Neznámý štítek', 'rq_save_news_item', ek['id'], {'tags': ['nic']})
        man = self.call('rq_save_news_item', None, {'url': 'https://example.org/rucne', 'title': 'Ručně přidaná', 'source_name': 'MZ ČR'})
        self.fails('už mezi', 'rq_save_news_item', None, {'url': 'https://example.org/rucne', 'title': 'Znovu'})
        self.assertEqual(self.call('rq_news_set_status', [ek['id'], man], 'published'), 2)
        self.call('rq_news_set_status', [items['Atom zpráva']['id']], 'rejected')
        self.as_user(STUDENT)
        self.fails('', 'rq_news_admin')
        self.fails('', 'rq_news_set_status', [man], 'rejected')
        rn = self.call('rq_reader_news')
        self.assertEqual([x['title'] for x in rn], ['MDCG 2020-16 rev.5 - Guidance on Classification', 'Ručně přidaná'] if rn[0]['published_at'] < rn[1]['published_at'] else [x['title'] for x in rn])
        e = next(x for x in rn if x['id'] == ek['id'])
        self.assertEqual(e['unit_ids'], ['mdr-cs-rule-11']); self.assertEqual(e['comment'], 'Nová revize pokynu'); self.assertEqual(len(e['group_keys']), 1)
        self.assertEqual(len(rn), 2)
        # úklid: staré nevyřízené → zamítnuté, staré zamítnuté pryč
        self.sql("with x as (update news_items set fetched_at = now() - interval '100 days', status = 'new' where id = %s returning 1) select count(*) from x", items['Upozornění na stahování šarží']['id'])
        self.sql("with x as (update news_items set updated_at = now() - interval '400 days' where id = %s returning 1) select count(*) from x", items['Atom zpráva']['id'])
        self.sql("select rq_private.news_cleanup()")
        self.assertEqual(self.sql("select status from news_items where id = %s", items['Upozornění na stahování šarží']['id'])[0][0], 'rejected')
        self.assertEqual(self.sql("select count(*) from news_items where id = %s", items['Atom zpráva']['id'])[0][0], 0)
        self.as_user(ADMIN)
        self.call('rq_delete_news_source', rss_src)
        self.assertEqual(self.sql("select source_id, source_name from news_items where id = %s", ek['id'])[0], (None, 'EK'))
        self.assertIn('news_items', self.call('rq_backup'))

    def test_cases(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.fails('název', 'rq_save_case', None, {'title': ' '})
        c = self.call('rq_save_case', None, {'title': 'Klasifikace aplikace', 'summary': 'Krátce', 'assignment': 'Aplikace hodnotí znaménka.',
                                             'conclusion': 'Třída IIa', 'status': 'draft', 'area_keys': ['zp'], 'tags': ['typ_software']})
        s1 = self.call('rq_save_case_step', None, c, {'title': 'Je to MDSW?', 'body': 'Ano.'})
        s2 = self.call('rq_save_case_step', None, c, {'title': 'Pravidlo 11', 'unit_id': 'mdr-cs-rule-11'})
        self.fails('prázdný', 'rq_save_case_step', None, c, {})
        self.call('rq_move_case_step', s2, -1)
        self.assertEqual([r[0] for r in self.sql("select id from case_steps where case_id=%s order by sort", c)], [s2, s1])
        self.call('rq_link_case_unit', c, 'mdr-cs-rule-11', True)
        self.call('rq_link_case_unit', c, 'mdr-cs-rule-11', True)
        self.assertEqual(self.sql("select count(*) from case_links")[0][0], 1)
        pv = self.call('rq_draft_preview')
        self.assertEqual(pv['cases'][0]['steps'][0]['unit_id'], 'mdr-cs-rule-11')   # v náhledu i neověřené
        self.call('rq_publish', 'první')
        self.assertEqual(self.call('rq_current_publication')['cases'], [])      # koncept studenti nevidí
        self.call('rq_save_case', c, {'title': 'Klasifikace aplikace', 'status': 'published', 'area_keys': ['zp']})
        self.call('rq_publish', 'druhá')
        ch = self.sql("select changes from publications where is_current")[0][0]
        self.assertEqual((ch['summary']['cases_new'], ch['cases_new'][0]['title']), (1, 'Klasifikace aplikace'))   # Co je nového
        pub = self.call('rq_current_publication')['cases'][0]
        self.assertEqual([s['unit_id'] for s in pub['steps']], [None, None])    # neověřené ustanovení se studentům nenabízí
        self.call('rq_verify_unit', 'mdr-cs-rule-11', None)
        self.call('rq_publish', 'třetí')
        pub = self.call('rq_current_publication')['cases'][0]
        self.assertEqual(pub['steps'][0]['unit_id'], 'mdr-cs-rule-11'); self.assertEqual(pub['unit_ids'], ['mdr-cs-rule-11'])
        self.assertIn('case_steps', self.call('rq_studio_state')); self.assertIn('cases', self.call('rq_backup'))
        self.as_user(STUDENT)
        self.fails('', 'rq_save_case', c, {'title': 'X'})
        self.as_user(ADMIN)
        self.call('rq_delete_case', c)
        self.assertEqual(self.sql("select count(*) from case_steps")[0][0], 0)

    def test_links(self):
        self.as_user(ADMIN)
        st = self.call('rq_links_admin')
        self.assertEqual(len(st), 7); self.assertTrue(all(x['status'] == 'draft' for x in st))
        self.fails('https://', 'rq_save_link', None, {'title': 'X', 'url': 'sukl.gov.cz'})
        a = self.call('rq_save_link', None, {'title': 'NANDO', 'url': 'https://example.org/nando', 'category': 'Databáze a registry', 'status': 'published', 'area_keys': ['zp']})
        b = self.call('rq_save_link', None, {'title': 'Druhý', 'url': 'https://example.org/b', 'category': 'Databáze a registry', 'status': 'published'})
        self.call('rq_move_link', b, -1)
        self.as_user(STUDENT)
        self.fails('', 'rq_links_admin')
        rl = self.call('rq_reader_links')
        self.assertEqual([x['title'] for x in rl], ['Druhý', 'NANDO'])
        self.as_user(ADMIN)
        self.call('rq_delete_link', a)
        self.assertIn('links', self.call('rq_backup'))

    def test_presentations(self):
        self.setup_doc()
        g = self.group
        self.as_user(ADMIN)
        sl = lambda t, u=None: {'data': {'layout': 'content', 'title': t, 'blocks': [{'id': 'b1', 'type': 'text', 'paras': [{'text': 'x', 'link': {'unit': u}}]}] if u else []}, 'notes': 'Poznámka ' + t}
        pid = self.call('rq_import_presentation', {'title': 'IVDR', 'subtitle': 'Ing. V. K.'}, [sl('Úvod'), sl('Třídy', 'mdr-cs-rule-11'), sl('Konec')])
        st = self.call('rq_presentations_admin')
        self.assertEqual(st['presentations'][0]['slides'], 3)
        self.assertEqual([x['units'] for x in st['slide_index'] if x['title'] == 'Třídy'][0], ['mdr-cs-rule-11'])
        full = self.call('rq_presentation_admin', pid); ids = [x['id'] for x in full['slides']]
        self.call('rq_move_slide', ids[2], -1)
        s4 = self.call('rq_save_slide', None, pid, {'title': 'Vložený'}, '', ids[0])
        self.assertEqual([x['data']['title'] for x in self.call('rq_presentation_admin', pid)['slides']], ['Úvod', 'Vložený', 'Konec', 'Třídy'])
        self.call('rq_link_presentation_unit', pid, ids[1], 'mdr-cs-rule-11', True)
        # student: koncept ani nezpřístupněnou nevidí
        self.as_user(STUDENT)
        self.assertEqual(self.call('rq_reader_presentations'), [])
        self.fails('není dostupná', 'rq_reader_presentation', pid)
        self.as_user(ADMIN)
        self.call('rq_save_presentation', pid, {'title': 'IVDR', 'status': 'ready'})
        self.call('rq_set_presentation_group', pid, g, '2099-01-01', True)
        self.as_user(STUDENT)
        self.assertEqual(self.call('rq_reader_presentations'), [])          # zatím nenastalo datum
        self.as_user(ADMIN)
        self.call('rq_set_presentation_group', pid, g, None, True)
        self.as_user(STUDENT)
        lst = self.call('rq_reader_presentations')
        self.assertEqual(len(lst), 1); self.assertEqual(len(lst[0]['unit_links']), 1)
        self.assertIsInstance(lst[0]['slides'][0]['text'], str)               # prostý text snímku pro hledání
        rp = self.call('rq_reader_presentation', pid)
        self.assertNotIn('notes', rp['slides'][0])                          # poznámky řečníka studenti nedostanou
        self.as_user(ADMIN)
        self.assertIn('notes', self.call('rq_reader_presentation', pid)['slides'][0])
        # nová verze: Třídy spárované (id zůstane), Vložený a Konec pryč, nový snímek přidán
        r = self.call('rq_replace_slides', pid, [{'id': ids[0], 'data': {'title': 'Úvod v2'}}, {'id': ids[1], 'data': {'title': 'Třídy v2'}}, {'data': {'title': 'Nový'}}])
        self.assertEqual(r, {'updated': 2, 'inserted': 1, 'deleted': 2})
        self.assertEqual([x['data']['title'] for x in self.call('rq_presentation_admin', pid)['slides']], ['Úvod v2', 'Třídy v2', 'Nový'])
        self.assertEqual(self.sql("select count(*) from presentation_unit_links where slide_id = %s", ids[1])[0][0], 1)
        other = self.call('rq_import_presentation', {'title': 'Jiná'}, [sl('A')])
        oid = self.call('rq_presentation_admin', other)['slides'][0]['id']
        self.fails('nepatří', 'rq_replace_slides', pid, [{'id': oid, 'data': {}}])
        self.as_user(STUDENT)
        self.fails('', 'rq_save_slide', ids[0], pid, {}, '', None)
        self.as_user(ADMIN)
        self.call('rq_delete_presentation', pid)
        self.assertEqual(self.sql("select count(*) from presentation_slides where presentation_id = %s", pid)[0][0], 0)
        self.assertIn('presentations', self.call('rq_backup'))

    def test_structure_editor(self):
        self.setup_doc()
        self.as_user(ADMIN)
        self.call('rq_save_unit_text', 'mdr-cs-rule-12', 'První část. Druhá část.', '', None)
        r = self.call('rq_split_unit', 'mdr-cs-rule-12', 12, 'Pravidlo 13', '', '', self.updated_at('mdr-cs-rule-12'), False, 'test')
        new = r['created_unit_id']
        self.assertEqual(self.sql('select body from units where id=%s', new)[0][0], 'Druhá část.')
        self.call('rq_move_unit_text', new, 'mdr-cs-rule-11', 'Druhá', self.updated_at(new), self.updated_at('mdr-cs-rule-11'), False, 'p')
        self.assertTrue(self.sql("select body from units where id='mdr-cs-rule-11'")[0][0].endswith('Druhá'))
        self.call('rq_merge_units', new, 'mdr-cs-rule-12', self.updated_at(new), self.updated_at('mdr-cs-rule-12'), False, 'm')
        self.assertEqual(self.sql('select archived, merged_into from units where id=%s', new)[0], (True, 'mdr-cs-rule-12'))
        self.fails('cyklus', 'rq_edit_unit_structure', 'mdr-cs-annex-viii', {'parent_id': 'mdr-cs-rule-11'},
                   self.updated_at('mdr-cs-annex-viii'), 'x')
        # Archivovaná část se nedostane ani do pracovního náhledu.
        self.assertNotIn(new, [u['id'] for u in self.call('rq_draft_preview')['units']])

    def test_blocks_are_validated_and_cleaned(self):
        self.setup_doc()
        self.as_user(ADMIN)
        u = self.updated_at('mdr-cs-rule-11')
        bad = [{'type': 'table', 'rows': [[{'text': 'A', 'colspan': 2}], [{'text': 'B'}]]}]
        self.fails('mezeru v mřížce', 'rq_save_unit_content', 'mdr-cs-rule-11', bad, u, 'x')
        blocks = [{'type': 'text', 'html': 'Text <b onclick="x()">tučně</b><script>alert(1)</script> <i>ok</i><br>řádek'},
                  {'type': 'table', 'caption': 'Tab', 'rows': [[{'text': 'Třída', 'header': True}], [{'text': 'IIa'}]]}]
        self.call('rq_save_unit_content', 'mdr-cs-rule-11', blocks, u, 'x')
        cb, body = self.sql("select content_blocks, body from units where id='mdr-cs-rule-11'")[0]
        self.assertEqual(cb[0]['html'], 'Text <b>tučně</b> <i>ok</i><br>řádek')
        self.assertIn('IIa', body)
        # odstavce vložené prohlížečem jako <div> zůstanou oddělené
        self.assertEqual(self.sql("select rq_private.clean_html('Úvod<div>1) první</div><div><br></div><div class=\"x\">2) druhý</div>')")[0][0],
                         'Úvod<br>1) první<br><br>2) druhý')
        self.fails('tabulku nebo obrázek', 'rq_split_unit', 'mdr-cs-rule-11', 3, 'X', '', '', self.updated_at('mdr-cs-rule-11'), True, 'x')

    # ------------------------------------------------------------ srovnání s lokálním Studiem
    @unittest.skipUnless(os.environ.get('RQ_SQLITE'), 'Nastavte RQ_SQLITE pro srovnání s testovací databází Studia')
    def test_publication_matches_local_studio(self):
        src = sqlite3.connect(os.environ['RQ_SQLITE']); src.row_factory = sqlite3.Row
        self.as_user(OWNER)
        for d in src.execute('select d.*, m.group_key, m.jurisdiction, m.document_type, m.topics_json from documents d join document_metadata m on m.document_id=d.id'):
            self.call('rq_new_document', {'id': d['id'], 'title': d['title'], 'family': d['family'], 'kind': d['kind'],
                      'language': d['language'], 'version': d['version'], 'url': d['url'], 'group_key': d['group_key'],
                      'jurisdiction': d['jurisdiction'], 'document_type': d['document_type'], 'topics': json.loads(d['topics_json'])})
            units = [dict(id=u['id'], parent_id=u['parent_id'], kind=u['kind'], label=u['label'], heading=u['heading'], body=u['body'],
                          locator=u['locator'], source_note=u['source_note'], sort_order=u['sort_order'])
                     for u in src.execute('select * from units where document_id=? order by sort_order', (d['id'],))]
            # Rodiče před potomky (pořadí z hloubky stromu).
            depth = {}
            byid = {u['id']: u for u in units}
            def dep(i, seen=()):
                p = byid[i]['parent_id']
                return 0 if not p or p not in byid or p in seen else 1 + dep(p, seen + (i,))
            units.sort(key=lambda u: dep(u['id']))
            r = self.call('rq_import_units', d['id'], units, {'filename': 'test', 'sha256': 'c' * 64, 'format': 'test'}, False)
            self.assertEqual(r['added'], len(units))
        for u in src.execute("select id from units where text_status='verified'"):
            self.call('rq_verify_unit', u['id'], None)
        for c in src.execute("select * from comments where status='approved'"):
            cid = self.call('rq_new_comment', c['unit_id'], c['kind'], c['language'], c['body'], c['author'])
            self.call('rq_comment_status', cid, 'approved')
        for r in src.execute("select * from relations where status='approved'"):
            rid = self.call('rq_new_relation', r['source_id'], r['target_id'], r['relation_type'], r['rationale'], r['evidence'], 'test')
            self.call('rq_relation_status', rid, 'approved')
        counts = self.call('rq_publish', 'srovnání')['counts']
        # Výsledek lokálního Studia 0.3.0 nad stejnou databází.
        self.assertEqual(counts, {'documents': 1, 'units': 2, 'verified_units': 1, 'navigation_units': 1, 'relations': 0, 'comments': 1})
        state = self.call('rq_studio_state')
        self.assertEqual(state['counts']['units'], 1423)
        rows = {u['id']: u for u in map(dict, src.execute('select id, parent_id, body from units'))}
        expected = {i for i, u in rows.items() if u['body'].strip()}
        for i in list(expected):
            p = rows[i]['parent_id']
            while p and p in rows and p not in expected:
                expected.add(p); p = rows[p]['parent_id']
        self.assertEqual({u['id'] for u in self.call('rq_draft_preview')['units']}, expected)


if __name__ == '__main__':
    unittest.main()
