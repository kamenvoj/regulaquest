import base64
import io
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import importer


def sample_mdr(lang='cs', complete=True, numbered_rules=False, table_rules=False):
    label_a,label_n,label_r=('Článek','PŘÍLOHA','Pravidlo') if lang=='cs' else ('Article','ANNEX','Rule')
    annexes=list(importer.ROMAN)
    if not complete:annexes=['VIII']
    parts=['<html><body>']
    for i in range(1,124 if complete else 55):
        parts.append(f'<p class="sti-art">{label_a} {i}</p>')
        parts.append(f'<p>Text článku {i} lorem ipsum requirements.</p>')
        parts.append('<p>1.</p><p>První odstavec se základními požadavky.</p><p>2.</p><p>Další odstavec s požadavky.</p>')
    for an in annexes:
        parts.append(f'<p>{label_n} {an}</p><p>Title Annex {an}</p>')
        if an=='VIII':
            for n in range(1,23):
                if numbered_rules:
                    chapter=4 if n<=4 else 5 if n<=8 else 6 if n<=13 else 7
                    sub=n if n<=4 else n-4 if n<=8 else n-8 if n<=13 else n-13
                    rule_heading=f'{chapter}.{sub}. {label_r} {n}'
                else:
                    rule_heading=f'{label_r} {n}'
                if table_rules:
                    parts.append(f'<table><tr><td>{chapter}.{sub}.</td><td>{label_r} {n}</td></tr></table><p>Full regulation text for classification rule {n}.</p>')
                else:
                    parts.append(f'<p>{rule_heading}</p><p>Full regulation text for classification rule {n}.</p>')
        else:parts.append('<p>Annex content with full details.</p>')
    parts.append('</body></html>')
    return ''.join(parts).encode('utf8')

class TestImport(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old_data,self.old_db=server.DATA,server.DB
        server.DATA=Path(self.tmp.name);server.DB=server.DATA/'test.sqlite3';server.init_db()
    def tearDown(self):
        server.DATA,server.DB=self.old_data,self.old_db;self.tmp.cleanup()
    def test_complete_html(self):
        b=sample_mdr();out=importer.parse_source(b,'mdr-cs','mdr.html')
        self.assertEqual(out.info['articles'],123)
        self.assertEqual(out.info['annexes'],17)
        self.assertEqual(out.info['rules'],22)
        self.assertTrue(any(x.id=='mdr-cs-rule-11' for x in out.drafts))
    def test_eurlex_numbered_rule_headings_cs_en(self):
        for lang in ('cs','en'):
            content=sample_mdr(lang, numbered_rules=True)
            result=importer.parse_source(content,f'mdr-{lang}',f'mdr-{lang}.html')
            self.assertEqual(result.info['rules'],22)
            self.assertEqual(len([x for x in result.drafts if x.kind=='rule']),22)
            self.assertIn(f'mdr-{lang}-rule-11',{x.id for x in result.drafts})
            self.assertIn('6.3.',result.info['rule_candidates'][10])

    def test_eurlex_table_cell_rule_headings(self):
        result=importer.parse_source(sample_mdr('cs',numbered_rules=True,table_rules=True),'mdr-cs','mdr.html')
        self.assertEqual(result.info['rules'],22)
        self.assertIn('mdr-cs-rule-11',{x.id for x in result.drafts})

    def test_import_refuses_missing_rules(self):
        broken=sample_mdr(numbered_rules=True).replace(b'6.3. Pravidlo 11',b'6.3. Irregular heading')
        payload={'document_id':'mdr-cs','filename':'official.html','base64':base64.b64encode(broken).decode()}
        preview=server.import_file({**payload,'preview':True})
        self.assertEqual(preview['info']['rules'],21)
        self.assertFalse(preview['can_import'])
        with self.assertRaisesRegex(ValueError,'Import odmítnut'):
            server.import_file({**payload,'preview':False})
        self.assertEqual(len(server.snapshot()['imports']),0)

    def test_import_preserves_user_work(self):
        server.update({'action':'save_unit_text','unit_id':'mdr-cs-art-61','body':'RUČNĚ VLOŽENÝ TEXT'})
        data={'document_id':'mdr-cs','filename':'official.html','base64':base64.b64encode(sample_mdr()).decode()}
        preview=server.import_file({**data,'preview':True})
        self.assertGreater(preview['new'],100)
        self.assertEqual(preview['keep_existing'],1)
        self.assertEqual(server.snapshot()['counts']['verified'],0)
        result=server.import_file({**data,'preview':False})
        self.assertGreater(result['added'],100)
        saved={x['id']:x for x in server.snapshot()['units']}
        self.assertEqual(saved['mdr-cs-art-61']['body'],'RUČNĚ VLOŽENÝ TEXT')
        self.assertEqual(saved['mdr-cs-rule-11']['text_status'],'needs_review')
        self.assertEqual(server.published()['counts']['units'],0)
        self.assertEqual(server.snapshot()['imports'][0]['format'],'eurlex-html')
    def test_incomplete_html_fails_safe(self):
        data={'document_id':'mdr-cs','filename':'mdr.html','base64':base64.b64encode(sample_mdr(complete=False)).decode()}
        preview=server.import_file({**data,'preview':True})
        self.assertLess(preview['info']['articles'],115)
        with self.assertRaises(ValueError):server.import_file({**data,'preview':False})
        self.assertFalse(server.snapshot()['imports'])
    def test_pymupdf_synthetic(self):
        import fitz
        doc=fitz.open()
        for i in range(59):
            p=doc.new_page()
            if i==0: text='Medical Devices\nMDCG 2021-24 Rev.1\nApril 2026'
            elif i==6: text='4 Explanations of individual rules'
            elif i==27:text='4.2 General explanation of rules/practical issues/examples'
            elif i==28:text='4.2.1 Non-invasive devices\nRule 1 - Introduction'
            elif i==41:text='4.2.3 Active devices\nRule 9 - Active energy delivery'
            elif i==45:text='Rule 11 - Software\nGeneral explanation of the rule\nDetailed interpretation'
            elif i==48:text='Rule 12 - Devices administering substances'
            elif i==50:text='4.2.4 Special rules\nRule 14 - Special requirements'
            else:text='Medical Devices / guidance text and information'
            p.insert_text((50,80),text)
        b=doc.tobytes()
        result=importer.parse_source(b,'mdcg-2021-24-en','MDCG.pdf')
        self.assertEqual(result.info['pages'],59)
        self.assertIn('mdcg-rule-11',{x.id for x in result.drafts})
        self.assertTrue(any('PDF' in w for w in result.warnings))
    def test_pdf_validation(self):
        with self.assertRaises(ValueError):importer.parse_source(b'<html></html>','mdcg-2021-24-en','a.pdf')

if __name__=='__main__':unittest.main()
