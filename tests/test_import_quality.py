"""Regression tests for list structure, editorial consolidation marks, numeric ordering,
and explicit reimport of unverified HTML. All source fixtures are synthetic."""
import base64
import sys
import tempfile
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import importer
import server
from test_importer import sample_mdr

class QualityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=(server.DATA,server.DB)
        server.DATA=Path(self.tmp.name);server.DB=server.DATA/'studio.sqlite3'
        server.init_db()
    def tearDown(self):
        server.DATA,server.DB=self.old
        self.tmp.cleanup()
    def payload(self,source,replace=False):
        return {'document_id':'mdr-cs','filename':'MDR_CS_20260719.html',
                'base64':base64.b64encode(source).decode(),
                'replace_imported':replace}
    def test_order_in_existing_seed_index(self):
        self.assertEqual([u['label'] for u in server.snapshot()['units'] if u['document_id']=='mdr-cs' and u['kind']=='article'],
                         ['Článek 1','Článek 2','Článek 10','Článek 52','Článek 61'])
        source=sample_mdr(numbered_rules=True)
        server.import_file({**self.payload(source),'preview':False})
        article_labels=[u['label'] for u in server.snapshot()['units'] if u['document_id']=='mdr-cs' and u['kind']=='article']
        self.assertEqual(article_labels,[f'Článek {i}' for i in range(1,124)])
    def test_consolidation_does_not_delete_modified_wording(self):
        source=sample_mdr(numbered_rules=True).decode()
        source=source.replace('<html><body>',
        '<html><body><table><tr><td><a href="https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32020R0561">►M1</a></td><td>NAŘÍZENÍ (EU) 2020/561</td></tr></table>')
        source=source.replace('<p>Text článku 1 lorem ipsum requirements.</p>',
         '<p>Text ►M1 26. května 2021 ◄ platí.</p><table><tr><td><p>1)</p></td><td><p>První definice</p></td></tr><tr><td><p>2)</p></td><td><p>Druhá definice</p></td></tr></table>',1)
        parsed=importer.parse_mdr_html(source.encode(),'mdr-cs')
        text=next(d.body for d in parsed.drafts if d.id=='mdr-cs-art-1')
        self.assertIn('26. května 2021',text)
        self.assertNotIn('►M1',text)
        self.assertNotIn('◄',text)
        self.assertIn('1) První definice',text)
        self.assertIn('2) Druhá definice',text)
        self.assertEqual(parsed.info['unit_amendments']['mdr-cs-art-1'],['M1'])
        self.assertIn('2020/561',parsed.info['amendments']['M1']['title'])
        self.assertIn('eur-lex.europa.eu',parsed.info['amendments']['M1']['url'])
        server.import_file({**self.payload(source.encode()),'preview':False})
        snapshot=server.snapshot()
        self.assertEqual([x['marker'] for x in snapshot['unit_amendments'] if x['unit_id']=='mdr-cs-art-1'],['M1'])
    def test_replace_old_unverified_import_only_on_explicit_request(self):
        source=sample_mdr(numbered_rules=True)
        payload=self.payload(source)
        server.import_file({**payload,'preview':False})
        with server.connect() as con:
            con.execute("UPDATE units SET body='►M1 Starý problematický text ◄' WHERE id='mdr-cs-art-1'")
        before=server.import_file({**payload,'preview':True})
        self.assertGreater(before['keep_existing'],100)
        self.assertEqual(before['will_replace'],0)
        after=server.import_file({**payload,'replace_imported':True,'preview':True})
        self.assertGreater(after['will_replace'],100)
        server.import_file({**payload,'replace_imported':True,'preview':False})
        self.assertNotIn('►M1',next(x['body'] for x in server.snapshot()['units'] if x['id']=='mdr-cs-art-1'))
    def test_manual_and_verified_protected(self):
        source=sample_mdr(numbered_rules=True)
        server.import_file({**self.payload(source),'preview':False})
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-art-1','body':'RUČNÍ OPRAVA','source_note':'Vlastní ověřovací přepis'})
        server.update({'action':'verify_unit','unit_id':'mdr-cs-art-2'})
        server.import_file({**self.payload(source,replace=True),'preview':False})
        uu={x['id']:x for x in server.snapshot()['units']}
        self.assertEqual(uu['mdr-cs-art-1']['body'],'RUČNÍ OPRAVA')
        self.assertEqual(uu['mdr-cs-art-2']['text_status'],'verified')

if __name__=='__main__':unittest.main()
