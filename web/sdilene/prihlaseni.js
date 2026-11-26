'use strict';
/* Přihlášení do Studia a čtečky (společný kód).
   Použití: const rq = await RQAuth.start({ app: 'studio' | 'ctecka', require: 'admin' | 'member', onReady(rq) {} });
   Zobrazí přihlašovací obrazovku, ověří roli v databázi a pak zavolá onReady. */
(function () {
  const cfg = window.RQ_CONFIG;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function emailFor(username) {
    const u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(u)) return null;
    return u + '@' + (u.startsWith(cfg.studentPrefix) ? cfg.studentDomain : cfg.adminDomain);
  }

  function czError(e) {
    const m = String(e?.message || e || '');
    if (/invalid login credentials/i.test(m)) return 'Nesprávné jméno nebo heslo.';
    if (/rate limit|too many/i.test(m)) return 'Příliš mnoho pokusů. Zkuste to za chvíli znovu.';
    if (/failed to fetch|network/i.test(m)) return 'Nelze se spojit se serverem. Zkontrolujte připojení k internetu.';
    return m || 'Neznámá chyba.';
  }

  async function profile(client) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const [{ data: p }, { data: isAdmin }, { data: isOwner }, { data: isMember }] = await Promise.all([
      client.from('profiles').select('user_id,username,display_name,role,active').eq('user_id', user.id).maybeSingle(),
      client.rpc('rq_is_admin'), client.rpc('rq_is_owner'), client.rpc('rq_is_member')
    ]);
    return { user, profile: p, isAdmin: !!isAdmin, isOwner: !!isOwner, isMember: !!isMember };
  }

  function loginScreen(root, title, subtitle, message) {
    root.innerHTML = `
      <div class="rq-login">
        <form class="rq-login-card" id="rqLoginForm" autocomplete="on">
          <div class="rq-login-brand">
            <svg width="40" height="40" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="17" r="12.5" stroke="#E9CB90" stroke-width="1.5"/><path d="M18 5L22 15L30 18L20 22L17 30L14 20L6 17L16 14Z" fill="#E9CB90"/><circle cx="18" cy="17" r="3.3" fill="#153240" stroke="#E9CB90" stroke-width="1.3"/></svg>
            <div><strong>RegulaQuest</strong><span>${esc(title)}</span></div>
          </div>
          <p class="rq-login-sub">${esc(subtitle)}</p>
          <label>Přihlašovací jméno<input id="rqUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
          <label>Heslo<input id="rqPass" name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" id="rqLoginBtn">Přihlásit</button>
          <p class="rq-login-msg" id="rqLoginMsg" role="alert">${esc(message || '')}</p>
        </form>
      </div>`;
    root.querySelector('#rqUser').focus();
  }

  async function start(opts) {
    const root = document.getElementById(opts.rootId || 'app');
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rq-' + opts.app + '-auth' }
    });
    const rq = { client, cfg, esc, czError, me: null,
      async logout() { await client.auth.signOut(); location.reload(); } };
    const allowed = me => me && (opts.require === 'admin' ? me.isAdmin : me.isMember);
    const deniedText = opts.require === 'admin'
      ? 'Tento účet nemá přístup do Studia.'
      : 'Přístup k tomuto účtu není aktivní. Obraťte se na vyučujícího.';

    async function enter(message) {
      let me = null;
      try { me = await profile(client); } catch (e) { message = czError(e); }
      if (allowed(me)) { rq.me = me; root.innerHTML = ''; opts.onReady(rq); return; }
      if (me) { await client.auth.signOut(); message = deniedText; }
      loginScreen(root, opts.title, opts.subtitle, message);
      root.querySelector('#rqLoginForm').onsubmit = async ev => {
        ev.preventDefault();
        const msg = root.querySelector('#rqLoginMsg'), btn = root.querySelector('#rqLoginBtn');
        const email = emailFor(root.querySelector('#rqUser').value);
        if (!email) { msg.textContent = 'Zadejte platné přihlašovací jméno.'; return; }
        btn.disabled = true; msg.textContent = 'Přihlašuji…';
        const { error } = await client.auth.signInWithPassword({ email, password: root.querySelector('#rqPass').value });
        btn.disabled = false;
        if (error) { msg.textContent = czError(error); return; }
        enter();
      };
    }
    await enter();
    return rq;
  }

  window.RQAuth = { start, emailFor };
})();
