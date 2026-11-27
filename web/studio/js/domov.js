'use strict';
/* RegulaQuest Studio – doplňky úvodní stránky: pokračovat, kde jsem skončil, a poslední aktivita.
   Aktivita se skládá z historie, kterou databáze už vede (komentáře, vazby, úpravy textu) – nic dalšího se neukládá. */
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

  function render() {
    const box = document.getElementById('homeExtras'); if (!box) return;
    const l = last(), lu = l && getUnit(l.id);
    const me = RQ.me?.profile?.user_id || RQ.me?.user?.id;
    const myDrafts = db.comments.filter(c => c.status === 'draft' && c.created_by === me).length;
    const evs = events().slice(0, 14);
    box.innerHTML = `<div class="home-col">
      <div class="home-card"><h2>Pokračovat</h2>${lu ? `<p><strong>${esc(fullname(lu.id))}</strong><br><small>otevřeno ${ago(l.at)}</small></p><button type="button" class="btn accent" id="homeContinue">Pokračovat, kde jsem skončil ↗</button>` : '<p class="fine">Zatím jste neotevřel(a) žádné ustanovení.</p>'}
       ${myDrafts ? `<p class="fine">Máte ${myDrafts} rozpracovaných komentářů (koncepty). <button type="button" class="linklike inline" id="homeDrafts">zobrazit</button></p>` : ''}</div>
      <div class="home-card"><h2>Rychlé cesty</h2><div class="home-links">
       <button type="button" data-go="coverage">▥ Pokrytí – kde pokračovat</button><button type="button" data-go="review">◇ Ke kontrole</button>
       <button type="button" data-go="paths">⇢ Trasy</button><button type="button" data-go="publish">↥ Publikování</button>
       <button type="button" id="homeHelp">? Nápověda – jak co funguje</button></div></div></div>
      <div class="home-card activity"><h2>Poslední aktivita</h2>${evs.length ? `<ul class="act-list">${evs.map(e => `<li><span class="act-who">${esc(who(e.actor))}</span> ${esc(e.text)}${e.n > 1 ? ` <small>(${e.n}×)</small>` : ''}
        ${getUnit(e.unit) ? `<button type="button" class="linklike inline" data-unit="${esc(e.unit)}">${esc(shortName(e.unit))}</button>` : ''}${e.extra && getUnit(e.extra) ? ` → <button type="button" class="linklike inline" data-unit="${esc(e.extra)}">${esc(shortName(e.extra))}</button>` : ''}
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
