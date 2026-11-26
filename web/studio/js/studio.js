'use strict';
/* RegulaQuest Studio – start po přihlášení: vloží rozhraní, propojí přístupy a editor. */
RQAuth.start({
  app: 'studio', require: 'admin', title: 'Studio – redakční prostředí',
  subtitle: 'Přihlášení pro adminy. Zadejte své přihlašovací jméno (např. vojta) a heslo.',
  onReady(rq) {
    const app = document.getElementById('app');
    app.replaceChildren(document.getElementById('studioTpl').content.cloneNode(true));
    const me = rq.me;
    document.getElementById('whoName').textContent =
      (me.profile?.display_name || me.profile?.username || '') + (me.isOwner ? ' · správce' : ' · admin') + (window.RQ_VERSION ? ' · v' + window.RQ_VERSION : '');
    document.getElementById('logoutTop').onclick = () => rq.logout();
    document.querySelectorAll('[data-reader]').forEach(a => { a.href = rq.cfg.readerUrl + '/' + a.dataset.reader; });
    RQAccess.init(rq);
    startEditor({ client: rq.client, renderAccess: RQAccess.render });
  },
});
