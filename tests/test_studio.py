import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class TestRegulaQuest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_data, self.old_db = server.DATA,server.DB
        server.DATA=Path(self.tmp.name)
        server.DB=server.DATA/'test.sqlite3'
        server.init_db()
    def tearDown(self):
        server.DATA=self.old_data
        server.DB=self.old_db
        self.tmp.cleanup()
    def test_starter_without_fake_law(self):
        s=server.snapshot()
        self.assertEqual(len(s['documents']),3)
        self.assertEqual(s['counts']['verified'],0)
        self.assertEqual(server.published()['counts']['units'],0)
    def test_approval_and_publication_filter(self):
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-11','body':'TESTOVACÍ TEXT – NENÍ PRÁVNÍ PŘEDPIS','source_note':'Test'})
        self.assertEqual(server.published()['counts']['units'],0)
        server.update({'action':'verify_unit','unit_id':'mdr-cs-rule-11'})
        # Verified rule + its parent annex as navigation only (label without text).
        self.assertEqual(server.published()['counts']['verified_units'],1)
        nav=[u for u in server.published()['units'] if u['navigation_only']]
        self.assertEqual([(u['id'],u['body'],u['heading']) for u in nav],[('mdr-cs-annex-viii','','')])
        server.update({'action':'new_comment','unit_id':'mdr-cs-rule-11','body':'Výuková poznámka k testu','kind':'explanation','language':'cs'})
        self.assertEqual(server.published()['counts']['comments'],0)
        c=server.snapshot()['comments'][0]
        server.update({'action':'comment_status','id':c['id'],'status':'approved'})
        self.assertEqual(server.published()['counts']['comments'],1)
        # Relation not published until both endpoints have verified text.
        server.update({'action':'relation_status','id':'seed-link-11','status':'approved'})
        self.assertEqual(server.published()['counts']['relations'],0)
        # Since 0.2.15 a text change returns the approved relation to review.
        server.update({'action':'save_unit_text','unit_id':'mdcg-rule-11','body':'TESTOVACÍ TEXT MDCG – NENÍ ORIGINÁL'})
        server.update({'action':'verify_unit','unit_id':'mdcg-rule-11'})
        self.assertEqual(server.published()['counts']['relations'],0)
        server.update({'action':'relation_status','id':'seed-link-11','status':'approved'})
        self.assertEqual(server.published()['counts']['relations'],1)
    def test_published_never_contains_unverified_text(self):
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-9','body':'NEOVĚŘENÝ TEXT'})
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-11','body':'OVĚŘENÝ TEXT'})
        server.update({'action':'verify_unit','unit_id':'mdr-cs-rule-11'})
        server.update({'action':'new_comment','unit_id':'mdr-cs-rule-11','body':'Koncept','kind':'explanation','language':'cs'})
        pub=server.published()
        self.assertEqual(pub['mode'],'published')
        self.assertNotIn('NEOVĚŘENÝ TEXT',str(pub))
        self.assertEqual(pub['comments'],[])
        draft=server.reader_data(draft=True)
        self.assertEqual(draft['mode'],'draft')
        status={u['id']:u['text_status'] for u in draft['units']}
        self.assertEqual(status['mdr-cs-rule-9'],'needs_review')
        self.assertEqual([c['status'] for c in draft['comments']],['draft'])
    def test_publish_to_reader_writes_published_data_only(self):
        old=server.READER_DATA,server.ROOT
        server.ROOT=Path(self.tmp.name);server.READER_DATA=server.ROOT/'reader'/'data'/'out.json'
        try:
            server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-9','body':'NEOVĚŘENÝ TEXT'})
            res=server.update({'action':'publish_to_reader'})
            text=server.READER_DATA.read_text(encoding='utf-8')
            self.assertIn('"mode": "published"',text)
            self.assertNotIn('NEOVĚŘENÝ TEXT',text)
            self.assertEqual(res['reader']['counts']['verified_units'],0)
        finally:
            server.READER_DATA,server.ROOT=old
    def test_import_checks_all_ids(self):
        bad={'action':'import_units','units':[{'unit_id':'mdr-cs-rule-12','body':'valid'},{'unit_id':'nonexistent','body':'invalid'}]}
        with self.assertRaises(ValueError): server.update(bad)
        self.assertEqual(server.snapshot()['counts']['verified'],0)
        self.assertEqual(next(u['body'] for u in server.snapshot()['units'] if u['id']=='mdr-cs-rule-12'),'')
    def test_no_self_link(self):
        with self.assertRaises(ValueError):server.update({'action':'new_relation','source_id':'mdr-cs-rule-11','target_id':'mdr-cs-rule-11','relation_type':'related'})

if __name__=='__main__': unittest.main()
