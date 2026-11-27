'use strict';
/* RegulaQuest čtečka – Aktuality: novinky vybrané redakcí (SÚKL, Evropská komise, …) s komentářem.
   Načítají se zvlášť (rq_reader_news) – zveřejněné jsou vidět hned, bez publikace obsahu. */
const NW = { list:[], q:'', area:'', src:'', sort:'new', page:0 };
const NW_PER = 10;

// Kdy si student aktuality naposledy prohlédl – u účtu (stejně jako místo ve čtení), záložně v prohlížeči
function newsSeenAt(){
  const acc = S.me && (S.me.positions || []).find(p => p.doc_group === 'news:seen');
  let loc = ''; try { loc = localStorage.getItem('rq-aktuality-videno') || ''; } catch {}
  return [acc ? acc.unit_id : '', loc].sort().pop();
}
async function loadNews(){
  try { const { data, error } = await RQ.client.rpc('rq_reader_news'); if (!error && Array.isArray(data)) NW.list = data; } catch {}
  const seen = newsSeenAt();
  const fresh = NW.list.filter(n => (n.published_on || '') > seen).length;
  const el = $('#navUpd'); if (el) el.textContent = fresh ? String(fresh) : '';
}
function newsSeen(){
  const max = NW.list.map(n => n.published_on || '').sort().pop();
  if (max && max > newsSeenAt()){
    try { localStorage.setItem('rq-aktuality-videno', max); } catch {}
    if (S.me){ const ex = S.me.positions.find(p => p.doc_group === 'news:seen'); if (ex) ex.unit_id = max; else S.me.positions.push({ doc_group: 'news:seen', unit_id: max, updated_at: new Date(0).toISOString() }); }
    RQ.client.rpc('rq_set_position', { p_doc_group: 'news:seen', p_unit_id: max }).then(() => {}, () => {});
  }
  const el = $('#navUpd'); if (el) el.textContent = '';
}
const newsDate = n => fmtDate(n.published_at || n.published_on);
function newsFor(u){
  const ids = new Set([u.id]); const c = counterpart(u); if (c) ids.add(c.unit.id);
  return NW.list.filter(n => (n.unit_ids || []).some(id => ids.has(id)));
}
function newsCard(n, full){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const groups = full ? docGroups().filter(g => (n.group_keys || []).includes(g.key)) : [];
  const units = full ? (n.unit_ids || []).map(id => S.units.get(id)).filter(Boolean) : [];
  return `<article class="upd${full ? '' : ' small'}"><div class="upd-meta">${esc(newsDate(n))} · ${esc(n.source || '')}</div>
    <a class="upd-title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)} <span aria-hidden="true">↗</span></a>
    ${full && n.summary ? `<p class="upd-sum">${esc(n.summary)}</p>` : ''}
    ${n.comment ? `<p class="upd-com"><b>Redakce:</b> ${esc(n.comment)}</p>` : ''}
    ${full && ((n.area_keys || []).length || groups.length || units.length) ? `<div class="upd-links">${(n.area_keys || []).map(k => `<span class="atag">${esc(areaName(k))}</span>`).join('')}
      ${groups.map(g => `<a class="upd-doc" href="#/d/${encodeURIComponent(g.main.id)}">${esc(docTitle(g.main))}</a>`).join('')}
      ${units.map(u => `<a class="upd-doc" href="#/u/${encodeURIComponent(u.id)}">${esc(docTitle(S.docs.get(u.document_id)))} › ${esc(u.label)}</a>`).join('')}</div>` : ''}</article>`;
}
function newsCtx(u){
  const xs = newsFor(u);
  return xs.length ? `<div class="ctx-section"><h3>Aktuality</h3>${xs.slice(0, 5).map(n => `<div class="ctx-card">${newsCard(n, false)}</div>`).join('')}${xs.length > 5 ? '<a href="#/aktuality">Všechny aktuality</a>' : ''}</div>` : '';
}
function homeNews(){
  const xs = NW.list.slice(0, 3);
  return xs.length ? `<div class="sec"><h2>Aktuality</h2><a href="#/aktuality">Všechny aktuality</a></div><div class="upd-list">${xs.map(n => newsCard(n, false)).join('')}</div>` : '';
}
function renderUpdates(){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const areas = [...new Set(NW.list.flatMap(n => n.area_keys || []))], srcs = [...new Set(NW.list.map(n => n.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  const qs = terms(NW.q);
  let xs = NW.list.filter(n => (!NW.area || (n.area_keys || []).includes(NW.area)) && (!NW.src || n.source === NW.src)
    && (!qs.length || qs.every(t => fold([n.title, n.summary, n.comment, n.source].join(' ')).includes(t))));
  const key = n => n.published_at || n.published_on || '';
  xs = xs.slice().sort((a, b) => NW.sort === 'old' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
  const pages = Math.max(1, Math.ceil(xs.length / NW_PER)); NW.page = Math.min(NW.page, pages - 1);
  const shown = xs.slice(NW.page * NW_PER, NW.page * NW_PER + NW_PER);
  const pager = pages > 1 ? `<nav class="upd-pager" aria-label="Stránky">${NW.page ? `<button type="button" class="btn small" data-up="${NW.page - 1}">← Novější</button>`.replace('Novější', NW.sort === 'old' ? 'Předchozí' : 'Novější') : ''}${Array.from({ length: pages }, (_, k) => `<button type="button" class="btn small${k === NW.page ? ' acc' : ''}" data-up="${k}" ${k === NW.page ? 'aria-current="page"' : ''}>${k + 1}</button>`).join('')}${NW.page < pages - 1 ? `<button type="button" class="btn small" data-up="${NW.page + 1}">${NW.sort === 'old' ? 'Další' : 'Starší'} →</button>` : ''}</nav>` : '';
  $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Aktuality</div><h1>Aktuality z regulace</h1>
    <p class="lead">Novinky z úřadů a institucí (SÚKL, Evropská komise…), které redakce vybrala a okomentovala. Odkaz vede na původní zdroj.</p>
    ${areas.length > 1 ? `<div class="area-switch" role="group" aria-label="Oblast"><button type="button" class="chipb ${!NW.area ? 'on' : ''}" data-ua="">Všechny oblasti</button>${areas.map(k => `<button type="button" class="chipb ${NW.area === k ? 'on' : ''}" data-ua="${esc(k)}">${esc(areaName(k))}</button>`).join('')}</div>` : ''}
    <div class="toolbar"><input type="search" id="updQ" placeholder="Hledat v aktualitách…" aria-label="Hledat v aktualitách" value="${esc(NW.q)}">
      ${srcs.length > 1 ? `<select id="updSrc" aria-label="Zdroj"><option value="">Všechny zdroje</option>${srcs.map(s => `<option ${NW.src === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
      <span class="langs" role="group" aria-label="Řazení">${[['new', 'Nejnovější'], ['old', 'Nejstarší']].map(([k, l]) => `<button type="button" class="lang ${NW.sort === k ? 'on' : ''}" data-us="${k}">${l}</button>`).join('')}</span></div>
    ${xs.length ? `<div class="upd-list">${shown.map(n => newsCard(n, true)).join('')}</div>${pager}` : `<div class="empty">${NW.list.length ? 'Žádná aktualita neodpovídá výběru.' : 'Redakce zatím nezveřejnila žádné aktuality.'}</div>`}</div>`;
  const qi = $('#updQ'); let t; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { NW.q = qi.value; NW.page = 0; const p = qi.selectionStart; renderUpdates(); const n = $('#updQ'); n.focus(); n.setSelectionRange(p, p); }, 200); };
  const sv = $('#updSrc'); if (sv) sv.onchange = () => { NW.src = sv.value; NW.page = 0; renderUpdates(); };
  $('#panelText').querySelectorAll('[data-ua]').forEach(b => b.onclick = () => { NW.area = b.dataset.ua; NW.page = 0; renderUpdates(); });
  $('#panelText').querySelectorAll('[data-us]').forEach(b => b.onclick = () => { NW.sort = b.dataset.us; NW.page = 0; renderUpdates(); });
  $('#panelText').querySelectorAll('[data-up]').forEach(b => b.onclick = () => { NW.page = +b.dataset.up; renderUpdates(); $('#panelText').scrollTop = 0; window.scrollTo(0, 0); });
  newsSeen();
  document.title = 'Aktuality · RegulaQuest';
}
