'use strict';
/* RegulaQuest čtečka – Prezentace: seznam zpřístupněných prezentací, prohlížení snímků (šipky, celá obrazovka, přehled),
   klikací odkazy na ustanovení a jiné snímky s cestou zpět; u ustanovení „V prezentacích“. Poznámky řečníka jen pro redakci. */
const PR = { list:[], cache:new Map(), id:null, slide:null, back:null, hist:[], grid:false, notes:false };

async function loadPresentations(){
  try { const { data, error } = await RQ.client.rpc('rq_reader_presentations'); if (!error && Array.isArray(data)) PR.list = data; } catch {}
}
const presOf = id => PR.list.find(p => p.id === id);
function slideRef(id){ for (const p of PR.list){ const i = p.slides.findIndex(s => s.id === id); if (i >= 0) return { p, i, s: p.slides[i] }; } return null; }
function presHref(link){
  if (link.unit) return S.units.has(link.unit) ? '#/u/' + encodeURIComponent(link.unit) : null;
  if (link.slide){ const r = slideRef(link.slide); return r ? `#/prezentace/${encodeURIComponent(r.p.id)}/${encodeURIComponent(link.slide)}` : null; }
  return null;
}
function presLinkTitle(link){
  if (link.unit){ const u = S.units.get(link.unit); return u ? `Otevřít: ${docTitle(S.docs.get(u.document_id))} › ${u.label}` : ''; }
  if (link.slide){ const r = slideRef(link.slide); return r ? `Přejít na snímek ${r.i + 1}${r.p.id !== PR.id ? ' prezentace ' + r.p.title : ''}` : ''; }
  return '';
}
// Prezentace a snímky odkazující na ustanovení (i v druhé jazykové verzi)
function presFor(u){
  const ids = new Set([u.id]); const cp = counterpart(u); if (cp) ids.add(cp.unit.id);
  const out = [];
  PR.list.forEach(p => {
    p.slides.forEach((s, i) => { if ((s.units || []).some(x => ids.has(x))) out.push({ p, i, s }); });
    (p.unit_links || []).filter(l => ids.has(l.unit_id)).forEach(l => {
      const i = l.slide_id ? p.slides.findIndex(s => s.id === l.slide_id) : -1;
      if (!out.some(o => o.p === p && o.i === i)) out.push({ p, i, s: i >= 0 ? p.slides[i] : null });
    });
  });
  return out;
}
function presCtx(u){
  const xs = presFor(u);
  return xs.length ? `<div class="ctx-section"><h3>V prezentacích</h3>${xs.slice(0, 8).map(o => `<div class="ctx-card"><a class="ctx-link" href="#/prezentace/${encodeURIComponent(o.p.id)}${o.s ? '/' + encodeURIComponent(o.s.id) : ''}"><strong>${esc(o.p.title)}</strong><small>${o.s ? `snímek ${o.i + 1}${o.s.title ? ' – ' + esc(trim(o.s.title, 60)) : ''}` : 'celá prezentace'}</small></a></div>`).join('')}</div>` : '';
}

function renderPresList(){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Prezentace</div><h1>Prezentace</h1>
    <p class="lead">Prezentace z přednášek. Části snímků vedou přímo na ustanovení předpisů nebo na související snímky. Ovládání: šipky na klávesnici, F = celá obrazovka.</p>
    ${PR.list.length ? `<div class="cards">${PR.list.map(p => `<a class="card prcard" href="#/prezentace/${encodeURIComponent(p.id)}"><span class="kind">Prezentace${p.status !== 'ready' ? ' · koncept' : ''}</span><strong>${esc(p.title)}</strong>
      ${p.subtitle ? `<span>${esc(p.subtitle)}</span>` : ''}${p.description ? `<span>${esc(trim(p.description, 140))}</span>` : ''}
      <em>${p.slides.length} snímků${(p.area_keys || []).length ? ' · ' + esc(p.area_keys.map(areaName).join(', ')) : ''}</em></a>`).join('')}</div>`
      : '<div class="empty">Pro vaši skupinu zatím nejsou zpřístupněné žádné prezentace.</div>'}</div>`;
  document.title = 'Prezentace · RegulaQuest';
}

async function renderPres(){
  const meta = presOf(PR.id);
  if (!meta){ $('#panelText').innerHTML = '<div class="empty">Prezentace není dostupná. <a href="#/prezentace">Všechny prezentace</a></div>'; return; }
  let full = PR.cache.get(PR.id);
  if (!full){
    $('#panelText').innerHTML = '<div class="empty">Načítám prezentaci…</div>';
    try { const { data, error } = await RQ.client.rpc('rq_reader_presentation', { p_id: PR.id }); if (error) throw new Error(error.message); full = data; PR.cache.set(PR.id, full); }
    catch(e){ $('#panelText').innerHTML = `<div class="empty">Prezentaci nelze načíst: ${esc(RQ.czError ? RQ.czError(e) : e.message)}</div>`; return; }
    if (S.view !== 'pres' || presOf(PR.id) !== meta) return;
  }
  const slides = full.slides, n = Math.max(0, slides.findIndex(s => s.id === PR.slide)), s = slides[n];
  PR.slide = s && s.id;
  const opts = { n: n + 1, total: slides.length, deck: full.title, href: presHref, title: presLinkTitle };
  const back = PR.hist.length ? PR.hist[PR.hist.length - 1] : null, br = back && slideRef(back);
  $('#panelText').innerHTML = `<div class="pv${PR.grid ? ' grid' : ''}" id="pv">
    <div class="pv-top"><div><div class="crumbs"><a href="#/prezentace">Prezentace</a></div><h1 class="pv-title">${esc(full.title)}</h1></div>
      <div class="pv-tools"><button type="button" class="btn small" id="pvGrid" aria-pressed="${PR.grid}">▦ Přehled snímků</button><button type="button" class="btn small" id="pvFull" title="Celá obrazovka (F)">⛶ Celá obrazovka</button></div></div>
    ${br ? `<div class="pv-backbar"><a href="#/prezentace/${encodeURIComponent(br.p.id)}/${encodeURIComponent(back)}" data-pop>← Zpět na snímek ${br.i + 1}${br.p.id !== PR.id ? ' (' + esc(br.p.title) + ')' : ''}</a></div>` : ''}
    ${PR.grid ? `<div class="pv-grid">${slides.map((x, i) => `<a class="pv-thumb${i === n ? ' on' : ''}" href="#/prezentace/${encodeURIComponent(PR.id)}/${encodeURIComponent(x.id)}"><span>${i + 1}</span><div class="sl-wrap">${RQSlides.render(x.data, {})}</div></a>`).join('')}</div>` : `
    <div class="pv-stagewrap" id="pvStageWrap"><div class="sl-wrap pv-stage" id="pvStage">${RQSlides.render(s.data, opts)}</div>
      <button type="button" class="pv-nav prev" id="pvPrev" ${n ? '' : 'disabled'} aria-label="Předchozí snímek">‹</button><button type="button" class="pv-nav next" id="pvNext" ${n < slides.length - 1 ? '' : 'disabled'} aria-label="Další snímek">›</button>
      <div class="pv-fsbar"><span class="pv-count">${n + 1} / ${slides.length}</span></div></div>
    <div class="pv-bottom"><button type="button" class="btn small" id="pvPrev2" ${n ? '' : 'disabled'}>‹ Předchozí</button><span class="pv-count">${n + 1} / ${slides.length}</span><button type="button" class="btn small acc" id="pvNext2" ${n < slides.length - 1 ? '' : 'disabled'}>Další ›</button></div>
    ${s.notes != null ? `<details class="pv-notes"${PR.notes ? ' open' : ''}><summary>Poznámky řečníka (vidí jen redakce)</summary><div>${plain(s.notes || '–')}</div></details>` : ''}`}</div>`;
  RQSlides.fit($('#panelText'));
  const hashOf = t => `#/prezentace/${encodeURIComponent(PR.id)}/${encodeURIComponent(t.id)}`;
  // V režimu celé obrazovky se snímek vymění na místě (překreslení stránky by celou obrazovku ukončilo)
  const paint = k => { const t = slides[k]; PR.slide = t.id; history.replaceState(null, '', hashOf(t));
    $('#pvStage').innerHTML = RQSlides.render(t.data, { ...opts, n: k + 1 }); RQSlides.fit($('#pvStage'));
    document.querySelectorAll('.pv-count').forEach(c => c.textContent = `${k + 1} / ${slides.length}`); PR.keyN.n = k; };
  const goN = k => { const t = slides[k]; if (!t) return; if (document.fullscreenElement) paint(k); else go(hashOf(t)); };
  ['pvPrev', 'pvPrev2'].forEach(x => { const b = $('#' + x); if (b) b.onclick = () => goN(n - 1); });
  ['pvNext', 'pvNext2'].forEach(x => { const b = $('#' + x); if (b) b.onclick = () => goN(n + 1); });
  $('#pvGrid').onclick = () => { PR.grid = !PR.grid; renderPres(); };
  $('#pvFull').onclick = () => { const w = $('#pvStageWrap'); if (!w) { PR.grid = false; renderPres().then(() => $('#pvStageWrap')?.requestFullscreen?.()); return; } (document.fullscreenElement ? document.exitFullscreen() : w.requestFullscreen?.()); };
  const nd = $('#panelText').querySelector('.pv-notes'); if (nd) nd.ontoggle = () => { PR.notes = nd.open; };
  const pop = $('#panelText').querySelector('[data-pop]'); if (pop) pop.addEventListener('click', () => { PR.hist.pop(); });
  const st = $('#pvStage');
  if (st) st.onclick = e => {
    const el = e.target.closest('.sl-go'); if (!el) return;
    const link = JSON.parse(el.dataset.link || '{}'), href = el.dataset.href; if (!href) return;
    if (document.fullscreenElement) document.exitFullscreen();
    if (link.unit) PR.back = { pres: PR.id, slide: PR.slide };
    else PR.hist.push(PR.slide);
    go(href);
  };
  PR.keyN = { n, total: slides.length, goN };
  document.title = `${full.title} – snímek ${n + 1} · RegulaQuest`;
}
document.addEventListener('keydown', e => {
  if (S.view !== 'pres' || !PR.keyN || PR.grid || e.target.closest('input, textarea, select')) return;
  const { n, total, goN } = PR.keyN;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)){ e.preventDefault(); if (n < total - 1) goN(n + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)){ e.preventDefault(); if (n) goN(n - 1); }
  else if (e.key === 'Home') goN(0);
  else if (e.key === 'End') goN(total - 1);
  else if (e.key === 'f' || e.key === 'F'){ const w = $('#pvStageWrap'); if (w) (document.fullscreenElement ? document.exitFullscreen() : w.requestFullscreen?.()); }
});
// V režimu celé obrazovky se při listování obsah vykreslí znovu – zachovat celou obrazovku
document.addEventListener('fullscreenchange', () => { const w = $('#pvStageWrap'); if (w) RQSlides.fit(w); if (!document.fullscreenElement && S.view === 'pres') renderPres(); });
// Lišta „zpět na prezentaci“ nad ustanovením otevřeným ze snímku
function presBackBar(u){
  const b = PR.back; if (!b || !u) return;
  const r = slideRef(b.slide); if (!r) return;
  const bar = document.createElement('div'); bar.className = 'cs-backbar';
  bar.innerHTML = `<a href="#/prezentace/${encodeURIComponent(b.pres)}/${encodeURIComponent(b.slide)}">← Zpět na prezentaci: <strong>${esc(r.p.title)}</strong> · snímek ${r.i + 1}</a>`;
  $('#panelText').prepend(bar);
}
