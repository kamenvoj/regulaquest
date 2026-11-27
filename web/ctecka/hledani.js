'use strict';
/* RegulaQuest čtečka – „Najít předpisy“ a průvodce otázkami.
   Nic není napsané pro konkrétní obor: pole vyhledávače vznikají z oblastí a skupin štítků (skupina může platit
   jen pro některé oblasti), otázky průvodce definuje redakce ve Studiu. Výsledkem průvodce je předvyplněný
   vyhledávač, takže student vidí, proč se mu co ukazuje, a výběr může dál upravit.
   Používá společné funkce a stav z reader.js (S, esc, fold, terms, docGroups, areasOf, …). */

const F = { o:new Set(), s:new Set(), d:new Set(), j:new Set(), t:new Set(), q:'', from:'', more:false };
const G = { ans:new Map(), pos:0 };
const JUR = { eu:'Evropská unie', cz:'Česká republika', international:'Mezinárodní', other:'Ostatní' };
const FIELDS = [['o','Oblast'], ['s','Štítky'], ['d','Druh dokumentu'], ['j','Původ'], ['t','Téma']];

/* ---------- stav ↔ adresa (odkaz lze sdílet) ---------- */
function finderParse(raw){
  const p = new URLSearchParams(raw || ''), set = k => new Set((p.get(k) || '').split('|').filter(Boolean));
  F.o = set('o'); F.s = set('s'); F.d = set('d'); F.j = set('j'); F.t = set('t'); F.q = p.get('q') || ''; F.from = p.get('z') || ''; F.more = false;
}
function finderHash(){
  const p = new URLSearchParams();
  [['o', F.o], ['s', F.s], ['d', F.d], ['j', F.j], ['t', F.t]].forEach(([k, v]) => { if (v.size) p.set(k, [...v].join('|')); });
  if (F.q) p.set('q', F.q);
  if (F.from) p.set('z', F.from);
  const q = p.toString();
  return '#/najit' + (q ? '?' + q : '');
}
const finderEmpty = () => !F.o.size && !F.s.size && !F.d.size && !F.j.size && !F.t.size && !F.q.trim();

/* ---------- data pro vyhledávač (jednou po načtení) ---------- */
function fx(){
  if (S.fx) return S.fx;
  const groups = docGroups(), groupOfDoc = new Map();
  groups.forEach(g => g.docs.forEach(d => groupOfDoc.set(d.id, g)));
  const mainIds = new Set(groups.map(g => g.main.id));
  const units = S.data.units.filter(u => mainIds.has(u.document_id));      // jeden jazyk na dokument (štítky jsou zrcadlené)
  const use = new Map(); units.forEach(u => (u.tags || []).forEach(k => use.set(k, (use.get(k) || 0) + 1)));
  const groupOfTag = new Map((S.data.tags || []).map(t => [t.key, t.group_key]));
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const pos = new Map(); S.order.forEach(seq => seq.forEach((id, i) => pos.set(id, i)));
  return (S.fx = { groups, groupOfDoc, units, use, groupOfTag, areaName, pos });
}

function hardOk(g){
  return (!F.d.size || F.d.has(g.main.document_type)) && (!F.j.size || F.j.has(g.main.jurisdiction))
    && (!F.t.size || g.docs.some(d => (d.topics || []).some(t => F.t.has(t))));
}
function inAreas(g){ return !F.o.size || areasOf(g.key).some(x => F.o.has(x.area_key)); }

function matchUnits(ix){
  const sel = [...F.s], qs = terms(F.q);
  if (!sel.length && !qs.length) return [];
  const out = [];
  for (const u of ix.units){
    const g = ix.groupOfDoc.get(u.document_id);
    if (!g || !hardOk(g) || !inAreas(g)) continue;
    const hit = sel.filter(k => (u.tags || []).includes(k));
    if (sel.length && !hit.length) continue;
    if (qs.length){ const txt = fold([u.label, headingOf(u), u.body || ''].join(' ')); if (!qs.every(t => txt.includes(t))) continue; }
    out.push({ u, g, hit, score: new Set(hit.map(k => ix.groupOfTag.get(k))).size * 100 + hit.length });
  }
  const docOrder = new Map(ix.groups.map((g, i) => [g.main.id, i]));
  return out.sort((a, b) => b.score - a.score || docOrder.get(a.u.document_id) - docOrder.get(b.u.document_id) || (ix.pos.get(a.u.id) ?? 0) - (ix.pos.get(b.u.id) ?? 0));
}

function matchDocs(ix, units){
  const W = { core:30, guidance:20, supplementary:12 }, qs = terms(F.q), crit = F.o.size || F.s.size || qs.length;
  const byGroup = new Map(); units.forEach(r => byGroup.set(r.g.key, (byGroup.get(r.g.key) || 0) + 1));
  const docs = [], situ = [];
  for (const g of ix.groups){
    if (!hardOk(g)) continue;
    const xs = areasOf(g.key).filter(x => F.o.has(x.area_key)), main = xs.filter(x => x.role !== 'situational');
    const why = []; let score = 0;
    main.forEach(x => { score = Math.max(score, W[x.role] || 10); why.push(`${ROLE_ONE[x.role]} · ${ix.areaName(x.area_key)}`); });
    const n = byGroup.get(g.key) || 0;
    if (n){ score += Math.min(n, 25); why.push(pl(n, 'odpovídající ustanovení', 'odpovídající ustanovení', 'odpovídajících ustanovení')); }
    const titleHit = qs.length && qs.every(t => fold(g.docs.map(d => [d.title, d.family, d.short_title, ...(d.topics || [])].join(' ')).join(' ')).includes(t));
    if (titleHit){ score += 15; why.push('název nebo téma odpovídá hledanému slovu'); }
    if (qs.length && !titleHit && !n) continue;   // zadané slovo v dokumentu není
    if (!crit){ score = 1; }
    if (score > 0) docs.push({ g, score, why });
    else xs.filter(x => x.role === 'situational').forEach(x => situ.push({ g, x }));
  }
  docs.sort((a, b) => b.score - a.score || docTitle(a.g.main).localeCompare(docTitle(b.g.main), 'cs'));
  return { docs, situ };
}

function matchPaths(ix, units){
  const qs = terms(F.q), hitIds = new Set(units.map(r => r.u.id));
  return S.paths.map(p => {
    let score = 0;
    p.steps.forEach(st => {
      const u = st.unit_id && S.units.get(st.unit_id); if (!u) return;
      const own = hitIds.has(u.id) || (F.s.size && (u.tags || []).some(k => F.s.has(k)));
      if (own) score += 3;
      else if (F.o.size){ const g = ix.groupOfDoc.get(u.document_id); if (g && inAreas(g)) score += 1; }
    });
    if (qs.length && qs.every(t => fold(p.title + ' ' + (p.description || '')).includes(t))) score += 5;
    return { p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.p);
}

/* ---------- stránka vyhledávače ---------- */
function chip(field, key, label, n){
  const on = F[field].has(key);
  return `<button type="button" class="chipb${on ? ' on' : ''}" data-f="${field}" data-k="${esc(key)}" aria-pressed="${on}">${esc(label)}${n != null ? ` <small>${n}</small>` : ''}</button>`;
}
function fieldBox(title, hint, chips){
  return chips ? `<div class="ff"><div class="ff-h"><strong>${title}</strong>${hint ? `<span>${hint}</span>` : ''}</div><div class="ff-chips">${chips}</div></div>` : '';
}

function renderFinder(){
  const ix = fx(), A = S.data.areas || [];
  const areaKeys = new Set(ix.groups.flatMap(g => areasOf(g.key).map(x => x.area_key)));
  const areaChips = A.filter(a => areaKeys.has(a.key) || F.o.has(a.key)).map(a => chip('o', a.key, a.name)).join('');
  const tagGroups = (S.data.tag_groups || []).filter(g => {
    const ak = g.area_keys || [];
    const vis = !ak.length || !F.o.size || ak.some(k => F.o.has(k));
    return vis || (S.data.tags || []).some(t => t.group_key === g.key && F.s.has(t.key));
  });
  const tagBoxes = tagGroups.map(g => {
    const ts = (S.data.tags || []).filter(t => t.group_key === g.key && (ix.use.get(t.key) || F.s.has(t.key)));
    return fieldBox(esc(g.name), '', ts.map(t => chip('s', t.key, t.name, ix.use.get(t.key) || 0)).join(''));
  }).join('');
  const vals = f => [...new Set(ix.groups.flatMap(f))].filter(Boolean);
  const types = vals(g => [g.main.document_type]), jurs = vals(g => [g.main.jurisdiction]);
  const topics = vals(g => g.docs.flatMap(d => d.topics || [])).sort((a, b) => a.localeCompare(b, 'cs'));
  const extra = (types.length > 1 ? fieldBox('Druh dokumentu', '', types.map(k => chip('d', k, DOC_KIND[k] || k)).join('')) : '')
    + (jurs.length > 1 ? fieldBox('Původ', '', jurs.map(k => chip('j', k, JUR[k] || k)).join('')) : '')
    + (topics.length ? fieldBox('Téma', '', topics.map(k => chip('t', k, k)).join('')) : '');
  const extraOn = F.d.size || F.j.size || F.t.size;

  let results = '';
  if (finderEmpty()){
    results = `<div class="empty">Vyberte oblast, koho se to týká nebo vlastnosti – výsledky se ukážou hned. Nevíte, co zvolit? Zkuste <a href="#/pruvodce">průvodce otázkami</a>.</div>`;
  } else {
    const units = matchUnits(ix), { docs, situ } = matchDocs(ix, units), paths = matchPaths(ix, units);
    const emptyAreas = [...F.o].filter(k => !areaKeys.has(k)).map(ix.areaName);
    const shownU = F.more ? units.slice(0, 300) : units.slice(0, 40);
    results = `<div class="fr-sum"><span>${[pl(docs.length, 'dokument', 'dokumenty', 'dokumentů') || '0 dokumentů', pl(units.length, 'ustanovení', 'ustanovení', 'ustanovení'), pl(paths.length, 'trasa', 'trasy', 'tras')].filter(Boolean).join(' · ')}</span>
        <button type="button" class="btn small" id="frCopy">Zkopírovat odkaz na výsledek</button><button type="button" class="btn small" id="frClear">Vymazat výběr</button></div>
      ${emptyAreas.length ? `<div class="fr-note">Do oblasti ${esc(emptyAreas.join(', '))} redakce zatím nezařadila žádné dokumenty.</div>` : ''}
      ${situ.length ? `<div class="fr-situ"><strong>Platí také ve specifických situacích</strong>${situ.map(({ g, x }) => `<div><a href="#/d/${encodeURIComponent(g.main.id)}">${esc(docTitle(g.main))}</a> <span class="muted">(${esc(ix.areaName(x.area_key))})</span> – <b>kdy:</b> ${esc(x.note)}</div>`).join('')}</div>` : ''}
      <div class="sec"><h2>Dokumenty</h2></div>
      ${docs.length ? `<ul class="fr-list">${docs.slice(0, 40).map(({ g, why }) => `<li><a href="#/d/${encodeURIComponent(g.main.id)}"><span class="kind">${esc(DOC_KIND[g.main.document_type] || 'Dokument')}</span><strong>${esc(docTitle(g.main))}</strong><small>${esc(trim(g.main.title, 140))}</small></a>${why.length ? `<div class="fr-why">${why.map(w => `<span>${esc(w)}</span>`).join('')}</div>` : ''}</li>`).join('')}</ul>` : '<div class="empty">Žádný dokument neodpovídá výběru.</div>'}
      ${units.length ? `<div class="sec"><h2>Konkrétní ustanovení</h2><span class="muted">${F.s.size ? 'Nahoře ta, která odpovídají nejvíce zvoleným štítkům' : ''}</span></div>
      <ul class="fr-list units">${shownU.map(({ u, hit }) => `<li><a href="#/u/${encodeURIComponent(u.id)}"><small>${esc(docTitle(S.docs.get(u.document_id)))}</small><strong>${esc(u.label)}${headingOf(u) ? ' – ' + esc(trim(headingOf(u), 90)) : ''}</strong></a>${hit.length ? `<div class="fr-why">${hit.map(k => `<span class="tg">${esc(roleName(k))}</span>`).join('')}</div>` : ''}</li>`).join('')}</ul>
      ${units.length > shownU.length ? `<button type="button" class="btn small" id="frMore">Zobrazit další (${units.length - shownU.length})</button>` : ''}` : ''}
      ${paths.length ? `<div class="sec"><h2>Trasy k tématu</h2></div><div class="cards">${paths.slice(0, 6).map(pathCard).join('')}</div>` : ''}`;
  }

  $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Najít předpisy</div><h1>Najít předpisy</h1>
    <p class="lead">Nevíte přesně, který dokument hledat? Vyberte, čeho se situace týká – ukážeme dokumenty, konkrétní ustanovení a trasy. Volby lze kombinovat.</p>
    ${F.from === 'pruvodce' ? `<div class="fr-guide">Výsledek průvodce. Výběr níže můžete dál upravit. <a href="#/pruvodce">Upravit odpovědi</a> · <a href="#/pruvodce" data-restart>Začít znovu</a></div>`
      : `<div class="fr-guide soft">Máte konkrétní situaci a nevíte, co zvolit? <a class="btn small acc" href="#/pruvodce">Projít průvodce otázkami</a></div>`}
    <div class="fform">
      ${areaChips ? fieldBox('Oblast', 'lze vybrat víc', areaChips) : ''}
      ${tagBoxes}
      ${extra ? `<details class="ff-more"${extraOn ? ' open' : ''}><summary>Další upřesnění (druh dokumentu, původ, téma)</summary>${extra}</details>` : ''}
      <div class="ff"><div class="ff-h"><strong>Slovo v textu</strong><span>nepovinné</span></div><input type="search" id="frQ" value="${esc(F.q)}" placeholder="Např. klinické hodnocení, UDI, lhůta…" aria-label="Slovo v textu"></div>
    </div>
    <div class="fresults">${results}</div></div>`;
  bindFinder();
  document.title = 'Najít předpisy · RegulaQuest';
}
function finderUpdate(keepFocus){
  history.replaceState(null, '', finderHash());
  const el = $('#frQ'), pos = el && el.selectionStart;
  renderFinder();
  if (keepFocus){ const n = $('#frQ'); n.focus(); n.setSelectionRange(pos, pos); }
}
function bindFinder(){
  const box = $('#panelText');
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    const s = F[b.dataset.f], k = b.dataset.k; s.has(k) ? s.delete(k) : s.add(k); F.more = false; finderUpdate();
  });
  let t; const q = $('#frQ'); q.oninput = () => { clearTimeout(t); t = setTimeout(() => { F.q = q.value.trim(); finderUpdate(true); }, 250); };
  const more = $('#frMore'); if (more) more.onclick = () => { F.more = true; renderFinder(); };
  const clr = $('#frClear'); if (clr) clr.onclick = () => { finderParse(''); finderUpdate(); };
  const cp = $('#frCopy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Odkaz zkopírován.'); } catch { toast('Odkaz: ' + location.href); } };
  box.querySelectorAll('[data-restart]').forEach(a => a.onclick = () => { G.ans.clear(); G.pos = 0; });
}

/* ---------- průvodce ---------- */
function guideQs(){
  const okA = new Set((S.data.areas || []).map(a => a.key)), okT = new Set((S.data.tags || []).map(t => t.key));
  return (S.data.guide || []).map(q => ({ ...q, area_keys: (q.area_keys || []).filter(k => okA.has(k)),
    options: (q.options || []).map(o => ({ ...o, areas: (o.areas || []).filter(k => okA.has(k)), tags: (o.tags || []).filter(k => okT.has(k)) })) }));
}
// Otázky, které se při současných odpovědích ukazují (v pořadí), a z nich vyplývající oblasti a štítky.
function guideWalk(){
  const qs = guideQs(), areas = new Set(), tags = new Set(), vis = [];
  qs.forEach(q => {
    if (q.area_keys.length && !q.area_keys.some(k => areas.has(k))) return;
    vis.push(q);
    (G.ans.get(q.id) || []).forEach(i => { const o = q.options[i]; if (o){ o.areas.forEach(a => areas.add(a)); o.tags.forEach(t => tags.add(t)); } });
  });
  return { qs, vis, areas, tags };
}
function guideFinish(){
  const w = guideWalk();
  finderParse(''); w.areas.forEach(a => F.o.add(a)); w.tags.forEach(t => F.s.add(t)); F.from = 'pruvodce';
  go(finderHash());
}
function renderGuide(){
  const w = guideWalk();
  if (!w.qs.length){
    $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Průvodce</div><h1>Průvodce otázkami</h1><div class="empty">Redakce průvodce zatím nepřipravila. Použijte <a href="#/najit">Najít předpisy</a>.</div></div>`;
    return;
  }
  if (G.pos >= w.vis.length){ guideFinish(); return; }
  const q = w.vis[G.pos], sel = new Set(G.ans.get(q.id) || []), n = G.pos + 1, total = w.vis.length;
  $('#panelText').innerHTML = `<div class="finder guide"><div class="eyebrow">Průvodce · otázka ${n} z ${total}</div>
    <i class="pbar"><b style="width:${Math.round((n - 1) / total * 100)}%"></b></i>
    <h1>${esc(q.prompt)}</h1>${q.help ? `<p class="lead">${esc(q.help)}</p>` : `<p class="lead">${q.multi ? 'Můžete vybrat víc odpovědí.' : 'Vyberte jednu odpověď.'}</p>`}
    <div class="g-opts${q.multi ? ' multi' : ''}" role="${q.multi ? 'group' : 'radiogroup'}">${q.options.map((o, i) => `<button type="button" class="g-opt${sel.has(i) ? ' on' : ''}" data-i="${i}" role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${sel.has(i)}">
      <span class="g-box" aria-hidden="true"></span><span><strong>${esc(o.label)}</strong>${o.help ? `<small>${esc(o.help)}</small>` : ''}</span></button>`).join('')}</div>
    <div class="g-nav">${G.pos ? '<button type="button" class="btn" id="gBack">← Zpět</button>' : ''}
      <button type="button" class="btn" id="gSkip">Přeskočit</button>
      ${q.multi ? `<button type="button" class="btn acc" id="gNext">${n === total ? 'Zobrazit výsledky' : 'Další →'}</button>` : ''}
      <span class="g-sp"></span>${G.ans.size ? '<button type="button" class="btn small" id="gReset">Začít znovu</button>' : ''}<a class="btn small" href="#/najit">Raději vyhledávač</a></div>
    ${guideSoFar(w)}</div>`;
  const next = () => { G.pos++; renderGuide(); window.scrollTo(0, 0); };
  $('#panelText').querySelectorAll('.g-opt').forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    if (q.multi){ const s = new Set(G.ans.get(q.id) || []); s.has(i) ? s.delete(i) : s.add(i); s.size ? G.ans.set(q.id, [...s]) : G.ans.delete(q.id); renderGuide(); }
    else { G.ans.set(q.id, [i]); next(); }
  });
  $('#gSkip').onclick = () => { G.ans.delete(q.id); next(); };
  if ($('#gNext')) $('#gNext').onclick = next;
  if ($('#gBack')) $('#gBack').onclick = () => { G.pos--; renderGuide(); };
  if ($('#gReset')) $('#gReset').onclick = () => { G.ans.clear(); G.pos = 0; renderGuide(); };
  $('#panelText').querySelectorAll('[data-goto]').forEach(a => a.onclick = () => { G.pos = +a.dataset.goto; renderGuide(); });
  document.title = 'Průvodce · RegulaQuest';
}
function guideSoFar(w){
  const rows = w.vis.map((q, i) => ({ q, i, a: (G.ans.get(q.id) || []).map(k => q.options[k]?.label).filter(Boolean) })).filter(r => r.a.length);
  return rows.length ? `<div class="g-sofar"><strong>Vaše odpovědi</strong>${rows.map(r => `<div><button type="button" class="linkish" data-goto="${r.i}">${esc(r.q.prompt)}</button> ${esc(r.a.join(', '))}</div>`).join('')}</div>` : '';
}
