"""Zkušební backend: statické soubory web/ + RPC a SELECT proti lokálnímu PostgreSQL s RLS jako Supabase."""
import json, sys, re, uuid
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import psycopg
DSN = sys.argv[1]; ROOT = sys.argv[2]
USERS = {'vojta@admin.regulaquest.cz': str(uuid.UUID(int=1)), 'ondra@admin.regulaquest.cz': str(uuid.UUID(int=2)),
         'rq-test01@studenti.regulaquest.invalid': str(uuid.UUID(int=3))}   # studentský účet (test_vyuziti.py)
IDENT = re.compile(r'^[a-z_]+$')

def run(uid, fn):
    with psycopg.connect(DSN, autocommit=False) as con:
        con.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))
        con.execute('set local role authenticated')
        try:
            r = fn(con); con.commit(); return 200, r
        except psycopg.Error as e:
            con.rollback(); return 400, {'message': e.diag.message_primary or str(e)}

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'] or 0)) or b'{}')
        uid = self.headers.get('X-User', '')
        if self.path == '/login':
            code, out = (200, {'id': USERS[body['email']]}) if body.get('email') in USERS and body.get('password') == 'Heslo12345AB' else (400, {'message': 'Invalid login credentials'})
        elif self.path.startswith('/rpc/'):
            name = self.path[5:]; assert IDENT.match(name)
            args = {k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in body.items() if v is not None}
            sql = f'select public.{name}(' + ','.join(f'{k} => %({k})s' for k in args) + ')'
            code, out = run(uid, lambda c: c.execute(sql, args).fetchone()[0])
        elif self.path == '/select':
            t = body['table']; assert IDENT.match(t)
            cols = body.get('cols', '*'); assert re.match(r'^[a-z_,*]+$', cols)
            where = ' and '.join(f'{k} = %({k})s' for k in body.get('eq', {}) if IDENT.match(k)) or 'true'
            order = ''
            if body.get('order'): assert IDENT.match(body['order'][0]); order = f" order by {body['order'][0]} {'asc' if body['order'][1] else 'desc'}"
            lim = f" limit {int(body['limit'])}" if body.get('limit') else ''
            sql = f'select coalesce(json_agg(x), \'[]\') from (select {cols} from public.{t} where {where}{order}{lim}) x'
            code, out = run(uid, lambda c: c.execute(sql, body.get('eq', {})).fetchone()[0])
        else:
            code, out = 404, {'message': 'nenalezeno'}
        data = json.dumps(out, default=str).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)

H.extensions_map['.mjs'] = 'text/javascript'
ThreadingHTTPServer(('127.0.0.1', 8765), partial(H, directory=ROOT)).serve_forever()
