"""Editor 0.2.15 a export do čtečky: tabulky jen po ověření, archivované části nikdy."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

TABLE={'type':'table','caption':'Příklad','notes':'','rows':[
    [{'text':'Třída','header':True},{'text':'Příklad','header':True}],
    [{'text':'IIa'},{'text':'Software pro diagnostiku'}]]}

class EditorExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=server.DATA,server.DB
        server.DATA=Path(self.tmp.name);server.DB=server.DATA/'t.sqlite3'
        server.init_db()
    def tearDown(self):
        server.DATA,server.DB=self.old;self.tmp.cleanup()
    def unit(self,uid):
        return next(u for u in server.snapshot()['units'] if u['id']==uid)
    def test_table_exported_only_after_verification(self):
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-11','body':'Text pravidla'})
        u=self.unit('mdr-cs-rule-11')
        server.update({'action':'save_unit_content','unit_id':u['id'],'expected_updated_at':u['updated_at'],
                       'blocks':[{'type':'text','html':'Text <b>pravidla</b><script>x</script>'},TABLE]})
        self.assertEqual(server.published()['counts']['verified_units'],0)
        draft=[u for u in server.reader_data(draft=True)['units'] if u['id']=='mdr-cs-rule-11'][0]
        self.assertEqual(draft['content_blocks'][1]['type'],'table')
        self.assertNotIn('script',draft['content_blocks'][0]['html'])
        server.update({'action':'verify_unit','unit_id':'mdr-cs-rule-11'})
        pub=[u for u in server.published()['units'] if u['id']=='mdr-cs-rule-11'][0]
        self.assertEqual(pub['content_blocks'][1]['rows'][1][0]['text'],'IIa')
    def test_merged_unit_is_never_exported(self):
        for uid in ('mdr-cs-rule-9','mdr-cs-rule-12'):
            server.update({'action':'save_unit_text','unit_id':uid,'body':'Text '+uid})
        a,b=self.unit('mdr-cs-rule-12'),self.unit('mdr-cs-rule-9')
        server.update({'action':'merge_units','unit_id':a['id'],'target_id':b['id'],
                       'expected_updated_at':a['updated_at'],'target_updated_at':b['updated_at']})
        ids=[u['id'] for u in server.reader_data(draft=True)['units']]
        self.assertNotIn('mdr-cs-rule-12',ids)
        self.assertIn('mdr-cs-rule-9',ids)
    def test_text_change_returns_approved_comment_to_review(self):
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-11','body':'Text'})
        server.update({'action':'verify_unit','unit_id':'mdr-cs-rule-11'})
        server.update({'action':'new_comment','unit_id':'mdr-cs-rule-11','body':'Výklad','kind':'explanation','language':'cs'})
        c=server.snapshot()['comments'][0]
        server.update({'action':'comment_status','id':c['id'],'status':'approved'})
        self.assertEqual(server.published()['counts']['comments'],1)
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-rule-11','body':'Změněný text'})
        self.assertEqual(server.published()['counts']['comments'],0)
        self.assertEqual(server.snapshot()['comments'][0]['status'],'draft')

if __name__=='__main__': unittest.main()
