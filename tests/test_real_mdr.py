"""Run on real EUR-Lex HTML when RQ_REAL_MDR_HTML points to its local path.
Does not distribute the original legal source in the application bundle.
"""
import base64
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import importer
import server
from eurlex_dom import audit, Tree

SOURCE=Path(os.environ.get('RQ_REAL_MDR_HTML','/path/to/nonexistent.html'))

class RealMdrTests(unittest.TestCase):
    @unittest.skipUnless(SOURCE.is_file(),'Nahraný HTML soubor MDR není v tomto prostředí')
    def test_source_integrity(self):
        data=SOURCE.read_bytes()
        result=importer.parse_mdr_html(data,'mdr-cs',SOURCE.name)
        self.assertTrue(result.info['content_integrity_ok'])
        self.assertEqual(result.info['articles_total'],124)
        self.assertEqual(result.info['inserted_articles'],['10a'])
        self.assertEqual(result.info['annexes'],17)
        self.assertEqual(result.info['rules'],22)
        self.assertEqual(result.info['min_text_coverage'],1)
        self.assertEqual(result.info['failed_units'],[])
        by={d.id:d for d in result.drafts}
        self.assertTrue(by['mdr-cs-art-1'].body.startswith('1. Tímto nařízením'))
        self.assertIn('1) „zdravotnickým prostředkem“',by['mdr-cs-art-2'].body)
        self.assertIn('71) „společnými specifikacemi“',by['mdr-cs-art-2'].body)
        self.assertIn('— diagnostika, prevence',by['mdr-cs-art-2'].body)
        self.assertIn('— poskytování informací prostřednictvím vyšetření',by['mdr-cs-art-2'].body)
        self.assertTrue(by['mdr-cs-art-10a'].body.startswith('1. Pokud výrobce'))
        self.assertIn('►',SOURCE.read_text(encoding='utf-8'))
        self.assertNotIn('►',by['mdr-cs-art-1'].body)
        self.assertIn('M5',result.info['unit_amendments']['mdr-cs-art-10a'])
        self.assertIn('2024/1860',result.info['amendments']['M5']['title'])

    @unittest.skipUnless(SOURCE.is_file(),'Nahraný HTML soubor MDR není v tomto prostředí')
    def test_reimport_preserves_manual_and_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            old=(server.DATA,server.DB)
            try:
                server.DATA=Path(folder);server.DB=server.DATA/'regulaquest.sqlite3';server.init_db()
                payload={'document_id':'mdr-cs','filename':SOURCE.name,
                         'base64':base64.b64encode(SOURCE.read_bytes()).decode()}
                first=server.import_file(dict(payload,preview=False))
                self.assertEqual(first['added'],674)
                self.assertEqual(first['updated'],10)
                with server.connect() as con:
                    con.execute("UPDATE units SET body='STARÉ', text_status='needs_review', source_note='automatický import' WHERE id='mdr-cs-art-2'")
                server.update({'action':'save_unit_text','unit_id':'mdr-cs-art-3','body':'RUČNÍ TEXT'})
                server.update({'action':'verify_unit','unit_id':'mdr-cs-art-4'})
                second=server.import_file(dict(payload,preview=False,replace_imported=True))
                self.assertGreater(second['replaced'],600)
                units={x['id']:x for x in server.snapshot()['units']}
                self.assertIn('1) „zdravotnickým prostředkem“',units['mdr-cs-art-2']['body'])
                self.assertEqual(units['mdr-cs-art-3']['body'],'RUČNÍ TEXT')
                self.assertEqual(units['mdr-cs-art-4']['text_status'],'verified')
                arts=[x['id'] for x in server.snapshot()['units'] if x['document_id']=='mdr-cs' and x['kind']=='article']
                self.assertEqual(arts[9:13],['mdr-cs-art-10','mdr-cs-art-10a','mdr-cs-art-11','mdr-cs-art-12'])
            finally:
                server.DATA,server.DB=old

    def test_audit_detects_omitted_list(self):
        r=Tree();r.feed('<div id="art_2"><p>Úvod</p><div class="grid-container grid-list"><div class="list grid-list-column-1"><span>1)</span></div><div class="grid-list-column-2"><p>První věta</p><p>Druhá věta</p></div></div></div>')
        node=r.by_id['art_2']
        missing=audit(list(node.direct()),'Úvod\n\n1) První věta')
        self.assertFalse(missing['same_sequence'])
        self.assertLess(missing['coverage'],1)

if __name__=='__main__':unittest.main()
