"""0.2.5: Source-PDF archive + conservative structured index smoke tests.
These synthetic fixtures are not a substitute for checking the official PDF."""
import base64
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import importer
import server

class PdfSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=(server.DATA,server.DB)
        server.DATA=Path(self.tmp.name);server.DB=server.DATA/'studio.sqlite3'
        server.init_db()
    def tearDown(self):
        server.DATA,server.DB=self.old
        self.tmp.cleanup()
    @staticmethod
    def document(complete=True):
        import fitz
        pdf=fitz.open()
        for i in range(59):
            page=pdf.new_page()
            if i==0:
                page.insert_text((45,90),'MDCG 2021-24 Rev.1',fontname='hebo',fontsize=17)
            if i==5:
                page.insert_text((45,85),'1 Purpose of medical device classification',fontname='hebo',fontsize=15)
            if i==18:
                page.insert_text((45,85),'4.1 Graphical summary',fontname='hebo',fontsize=15)
                page.draw_rect((45,120,180,280))
            if (27 <= i <= 48) and (complete or i in (27,35)):
                n=i-26
                page.insert_text((45,165),f'Rule {n} - Medical device examples',fontname='hebo',fontsize=12)
            page.insert_text((45,790),str(i+1))
        return pdf.tobytes()
    def test_main_chapters_rule_index_and_local_original(self):
        payload={
            'document_id':'mdcg-2021-24-en','filename':'guidance.pdf',
            'base64':base64.b64encode(self.document()).decode(),
        }
        preview=server.import_file({**payload,'preview':True})
        self.assertTrue(preview['can_import'])
        self.assertEqual(preview['info']['rules_located'],22)
        self.assertEqual(preview['info']['sections'],33)
        self.assertFalse(server.snapshot()['source_files'])
        server.import_file({**payload,'preview':False,'replace_imported':True})
        state=server.snapshot()
        self.assertEqual(len(state['source_files']),1)
        self.assertTrue((server.DATA/'originals'/('mdcg-2021-24-en-'+state['source_files'][0]['sha256']+'.pdf')).is_file())
        units={d['id']:d for d in state['units']}
        self.assertTrue(all(f'mdcg-sec-{n}' in units for n in range(1,5)))
        self.assertTrue(all(f'mdcg-rule-{n}' in units for n in range(1,23)))
        self.assertEqual(units['mdcg-sec-4-2-3']['parent_id'],'mdcg-sec-4-2')
        self.assertEqual(units['mdcg-rule-11']['parent_id'],'mdcg-sec-4-2-3')
        self.assertFalse(units['mdcg-sec-4-1-1']['body'])
        self.assertEqual(server.published()['counts']['units'],0)
    def test_missing_rule_is_placeholder_not_invented(self):
        parsed=importer.parse_mdcg_pdf(self.document(complete=False),'mdcg-2021-24-en','test.pdf')
        self.assertEqual(parsed.info['rules'],22)
        self.assertEqual(parsed.info['rules_located'],2)
        self.assertEqual(len(parsed.info['rules_missing']),20)
        by_id={d.id:d for d in parsed.drafts}
        self.assertFalse(by_id['mdcg-rule-11'].body)
        self.assertIn('orientační',by_id['mdcg-rule-11'].locator)

if __name__=='__main__':unittest.main()
