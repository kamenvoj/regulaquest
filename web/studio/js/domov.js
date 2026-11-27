'use strict';
/* RegulaQuest Studio – doplňky úvodní stránky: pokračovat, kde jsem skončil, výuka (aktuality, prezentace, případy, odkazy),
   rychlé cesty a poslední aktivita. Aktivita se skládá z historie a časů úprav, které databáze už vede – nic dalšího se neukládá. */
window.RQHome = (function () {
  const KEY = 'rq-studio-posledni';
  function remember(id) { try { localStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() })); } catch {} }
  function last() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }

  const who = id => { const p = (db.people || []).find(x => x.user_id === id); return p ? (p.display_name || p.username) : (id ? 'někdo' : 'systém'); };
  function ago(t) {
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 90) return 'právě teď'; if (s < 3600) return `před ${Math.round(s / 60)} min`;
    if (s < 86400) return `před ${Math.round(s / 3600)} h`; if (s < 86400 * 7) return `před ${Math.round(s / 86400)} d`;
    return new Date(t).toLocaleDateString('cs-CZ');
  }
  const KIND = { explanation: 'výklad', warning: 'upozornění', example: 'příklad', definition: 'definici', reference: 'poznámku ke zdroji', key: 'klíčovou pasáž', duty: 'povinnost', deadline: 'lhůtu', exception: 'výjimku' };
  const UNIT_EV = { edit_text: 'upravil(a) text', edit_content: 'upravil(a) text a tabulky', edit_structure: 'upravil(a) strukturu', verified: 'ověřil(a) text',
    archived: 'archivoval(a)', restored: 'obnovil(a)', created: 'založil(a)', split_unit: 'rozdělil(a)', merge_unit: 'sloučil(a)', move_text: 'přesunul(a) text',
    new_version: 'nové znění (import)', removed_in_new_version: 'v novém znění chybí – archivováno', tags: 'změnil(a) štítky' };
  const COM_EV = { created: 'přidal(a)', status_approved: 'schválil(a)', status_rejected: 'zamítl(a)', status_archived: 'archivoval(a)', draft_edited: 'upravil(a)',
    draft_archived: 'odstranil(a) koncept', revision_proposed: 'navrhl(a) změnu', revision_approved: 'schválil(a) změnu', revision_rejected: 'zamítl(a) změnu', translation_checked: 'potvrdil(a) překlad' };
  const REL_EV = { created: 'propojil(a)', status_approved: 'schválil(a) vazbu', status_rejected: 'zamítl(a) vazbu', status_archived: 'archivoval(a) vazbu',
    revision_approved: 'schválil(a) změnu vazby', revision_rejected: 'zamítl(a) změnu vazby' };

  function events() {
    const out = [];
    for (const h of db.comment_history || []) {
      const c = db.comments.find(x => x.id === h.comment_id); const v = COM_EV[h.event_type]; if (!c || !v) continue;
      out.push({ t: h.created_at, actor: h.actor, text: `${v} ${KIND[c.kind] || 'komentář'}`, unit: c.unit_id });
    }
    for (const h of db.relation_history || []) {
      const r = db.relations.find(x => x.id === h.relation_id); const v = REL_EV[h.event_type]; if (!r || !v) continue;
      out.push({ t: h.created_at, actor: h.actor, text: v, unit: r.source_id, extra: r.target_id });
    }
    for (const h of db.unit_edit_history || []) {
      const v = UNIT_EV[h.event]; if (!v) continue;
      out.push({ t: h.created_at, actor: h.actor, text: v, unit: h.unit_id });
    }
    out.sort((a, b) => new Date(b.t) - new Date(a.t));
    // stejný člověk + stejná akce + stejné ustanovení těsně po sobě = jeden řádek
    const merged = [];
    for (const e of out) { const p = merged[merged.length - 1];
      if (p && p.actor === e.actor && p.text === e.text && p.unit === e.unit) { p.n = (p.n || 1) + 1; continue; } merged.push({ ...e }); }
    return merged;
  }

  // Výukové části se načítají zvlášť (lehké dotazy); po načtení se úvodní stránka překreslí
  let X = null, xLoading = false, xAt = 0;
  async function loadExtras() {
    if (xLoading || (X && Date.now() - xAt < 60000)) return; xLoading = true;
    const safe = p => p.then(v => v, () => null);
    const [news, pres, links, pub] = await Promise.all([
      window.RQNews ? safe(RQNews.load(true)) : null, window.RQPres ? safe(RQPres.load(true)) : null, safe(rpc('rq_links_admin', {})),
      safe(RQ.client.from('publications').select('created_at').order('id', { ascending: false }).limit(1).then(r => (r.data && r.data[0]) || null))]);
    X = { news, pres, links, pub }; xAt = Date.now(); xLoading = false;
    if (document.getElementById('homeExtras') && !document.getElementById('page-home').classList.contains('hidden')) render();
  }
  function extraEvents() {
    const out = [];
    (db.cases || []).forEach(c => c.updated_at && out.push({ t: c.updated_at, actor: c.updated_by, text: 'upravil(a) řešený případ', label: c.title, page: 'cases' }));
    if (X && X.pres) X.pres.presentations.forEach(p => p.updated_at && out.push({ t: p.updated_at, actor: p.updated_by, text: 'upravil(a) prezentaci', label: p.title, page: 'pres' }));
    if (X && X.news) X.news.items.filter(i => i.status === 'published' && i.published_on && i.updated_by).forEach(i => out.push({ t: i.published_on, actor: i.updated_by, text: 'zveřejnil(a) aktualitu', label: i.title, page: 'news' }));
    if (X && Array.isArray(X.links)) X.links.filter(l => l.updated_by).forEach(l => out.push({ t: l.updated_at, actor: l.updated_by, text: l.status === 'published' ? 'zveřejnil(a) odkaz' : 'upravil(a) odkaz', label: l.title, page: 'links' }));
    return out;
  }
  function teachCard(allEvents) {
    const rows = [];
    if (X && X.news) { const n = X.news.items.filter(i => i.status === 'new').length; rows.push(['news', '✉ Aktuality', n ? `<b>${n}</b> nových k přečtení` : 'nic nového k přečtení']); }
    if (X && X.pres) {
      const ps = X.pres.presentations, ready = ps.filter(p => p.status === 'ready').length, today = new Date().toISOString().slice(0, 10);
      const gname = id => (X.pres.groups.find(g => g.id === id) || {}).name || 'skupina';
      const soon = ps.filter(p => p.status === 'ready').flatMap(p => p.groups.filter(g => g.visible_from > today).map(g => ({ p, g }))).sort((a, b) => a.g.visible_from.localeCompare(b.g.visible_from)).slice(0, 3);
      rows.push(['pres', '▭ Prezentace', `${ps.length} celkem · <b>${ready}</b> připravených${soon.length ? '<br><small>Brzy uvidí studenti: ' + soon.map(x => `${esc(x.p.title)} – ${esc(gname(x.g.group_id))} od ${new Date(x.g.visible_from).toLocaleDateString('cs-CZ')}`).join('; ') + '</small>' : ''}`]);
    }
    const cd = (db.cases || []).filter(c => c.status === 'draft').length;
    rows.push(['cases', '◫ Řešené případy', `${(db.cases || []).filter(c => c.status === 'published').length} zveřejněných${cd ? ` · <b>${cd}</b> rozpracovaných` : ''}`]);
    if (X && Array.isArray(X.links)) { const ld = X.links.filter(l => l.status === 'draft').length; rows.push(['links', '⧉ Užitečné odkazy', `${X.links.length - ld} zveřejněných${ld ? ` · <b>${ld}</b> konceptů` : ''}`]); }
    if (X) {
      const since = X.pub ? X.pub.created_at : null;
      const n = allEvents.filter(e => !['news', 'links', 'pres'].includes(e.page) && (!since || new Date(e.t) > new Date(since))).length;
      rows.push(['publish', '↥ Publikace', since ? (n ? `<b>${n}</b> úprav od poslední publikace (${new Date(since).toLocaleDateString('cs-CZ')}) – studenti je zatím nevidí` : `vše publikováno (${new Date(since).toLocaleDateString('cs-CZ')})`) : 'zatím nic nepublikováno']);
    }
    return `<div class="home-card"><h2>Výuka</h2>${X ? `<ul class="teach-list">${rows.map(([pg, t, d]) => `<li><button type="button" class="linklike" data-go="${pg}">${t}</button><span>${d}</span></li>`).join('')}</ul>
      <p class="fine">Aktuality a odkazy studenti vidí hned po zveřejnění, prezentace podle data zpřístupnění; ostatní obsah po publikaci.</p>` : '<p class="fine">Načítám…</p>'}</div>`;
  }

  function render() {
    const box = document.getElementById('homeExtras'); if (!box) return;
    loadExtras();
    const l = last(), lu = l && getUnit(l.id);
    const me = RQ.me?.profile?.user_id || RQ.me?.user?.id;
    const myDrafts = db.comments.filter(c => c.status === 'draft' && c.created_by === me).length;
    const allEv = events().concat(extraEvents()).sort((a, b) => new Date(b.t) - new Date(a.t)), evs = allEv.slice(0, 16);
    box.innerHTML = `<div class="home-col">
      <div class="home-card"><h2>Pokračovat</h2>${lu ? `<p><strong>${esc(fullname(lu.id))}</strong><br><small>otevřeno ${ago(l.at)}</small></p><button type="button" class="btn accent" id="homeContinue">Pokračovat, kde jsem skončil ↗</button>` : '<p class="fine">Zatím jste neotevřel(a) žádné ustanovení.</p>'}
       ${myDrafts ? `<p class="fine">Máte ${myDrafts} rozpracovaných komentářů (koncepty). <button type="button" class="linklike inline" id="homeDrafts">zobrazit</button></p>` : ''}</div>
      ${teachCard(allEv)}
      <div class="home-card"><h2>Rychlé cesty</h2><div class="home-links">
       <button type="button" data-go="coverage">▥ Pokrytí – kde pokračovat</button><button type="button" data-go="review">◇ Ke kontrole</button>
       <button type="button" data-go="pres">▭ Prezentace</button><button type="button" data-go="cases">◫ Řešené případy</button>
       <button type="button" data-go="news">✉ Aktuality</button><button type="button" data-go="paths">⇢ Trasy</button>
       <button type="button" data-go="links">⧉ Užitečné odkazy</button><button type="button" data-go="publish">↥ Publikování</button>
       <button type="button" id="homeHelp">? Nápověda – jak co funguje</button></div></div></div>
      <div class="home-card activity"><h2>Poslední aktivita</h2>${evs.length ? `<ul class="act-list">${evs.map(e => `<li><span class="act-who">${esc(who(e.actor))}</span> ${esc(e.text)}${e.n > 1 ? ` <small>(${e.n}×)</small>` : ''}
        ${e.page ? `<button type="button" class="linklike inline" data-go="${e.page}">${esc(e.label.length > 70 ? e.label.slice(0, 69) + '…' : e.label)}</button>` : ''}${getUnit(e.unit) ? `<button type="button" class="linklike inline" data-unit="${esc(e.unit)}">${esc(shortName(e.unit))}</button>` : ''}${e.extra && getUnit(e.extra) ? ` → <button type="button" class="linklike inline" data-unit="${esc(e.extra)}">${esc(shortName(e.extra))}</button>` : ''}
        <span class="act-when">${ago(e.t)}</span></li>`).join('')}</ul>` : '<p class="fine">Zatím žádná aktivita.</p>'}</div>`;
    const c = box.querySelector('#homeContinue'); if (c) c.onclick = () => openUnit(lu.id);
    const dr = box.querySelector('#homeDrafts'); if (dr) dr.onclick = () => { commentStatusFilter = 'draft'; commentDocFilter = 'all'; setPage('comments'); };
    box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => setPage(b.dataset.go));
    box.querySelector('#homeHelp').onclick = () => RQHelp.open('home');
    box.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => openUnit(b.dataset.unit));
  }
  function shortName(id) { const u = getUnit(id), d = u && getDoc(u.document_id); return u ? `${d ? d.family + ' ' + d.language.toUpperCase() + ' · ' : ''}${unitPath(id)}` : id; }
  return { render, remember };
})();
