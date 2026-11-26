"""Kontroly webových aplikací (web/): společné soubory jsou v obou webech stejné."""
import filecmp
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / 'web'


class SharedFilesTest(unittest.TestCase):
    def test_shared_copies_are_identical(self):
        shared = sorted(p.name for p in (WEB / 'sdilene').iterdir())
        for app in ('ctecka', 'studio'):
            copy = WEB / app / 'sdilene'
            self.assertEqual(sorted(p.name for p in copy.iterdir()), shared, f'{app}: spusťte web/synchronizovat-sdilene.sh')
            match, mismatch, errors = filecmp.cmpfiles(WEB / 'sdilene', copy, shared, shallow=False)
            self.assertEqual(mismatch + errors, [], f'{app}: spusťte web/synchronizovat-sdilene.sh')

    def test_no_secret_keys_in_web(self):
        libraries = {'supabase.js', 'qrcode.js'}  # cizí knihovny obsahují jen názvy formátů klíčů
        for f in WEB.rglob('*'):
            if f.is_file() and f.suffix in ('.js', '.html') and f.name not in libraries:
                text = f.read_text(encoding='utf-8', errors='ignore')
                self.assertNotIn('sb_secret_', text, str(f))
                self.assertNotIn('service_role', text.replace('SUPABASE_SERVICE_ROLE_KEY', ''), str(f))


if __name__ == '__main__':
    unittest.main()
