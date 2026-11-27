'use strict';
/* RegulaQuest čtečka – Řešené případy: zadání, postup po krocích s odkazy na ustanovení, závěr.
   Z ustanovení otevřeného z případu vede lišta zpět na případ. Data jsou v publikaci (S.data.cases). */
const CS = { area:'', back:null };
const caseList = () => (S.data.cases || []);
const caseOf = id => caseList().find(c => c.id === id);
function caseUnits(c){ return new Set([...(c.steps || []).map(s => s.unit_id).filter(Boolean), ...(c.unit_ids || [])]); }
function casesFor(u){
  const ids = new Set([u.id]); const cp = counterpart(u); if (cp) ids.add(cp.unit.id);
  return caseList().filter(c => [...caseUnits(c)].some(id => ids.has(id)));
}
// Jednoduchý formát: odstavce, odrážky „- “, tabulky „| a | b |“
function caseText(t){
  return String(t || '').trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length && lines.every(l => l.startsWith('|'))){
      const rows = lines.filter(l => !/^\|[\s:|-]+\|?$/.test(l)).map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const [h, ...b] = rows;
      return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${h.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (lines.length && lines.every(l => /^[-•]\s/.test(l))) return `<ul>${lines.map(l => `<li>${esc(l.replace(/^[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
}
const unitName = u => `${docTitle(S.docs.get(u.document_id))} › ${u.label}${headingOf(u) ? ' – ' + trim(headingOf(u), 70) : ''}`;
const kroku2 = n => `${n} ${n === 1 ? 'krok' : n >= 2 && n <= 4 ? 'kroky' : 'kroků'}`;

function caseCard(c){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  return `<a class="card casecard" href="#/pripad/${encodeURIComponent(c.id)}"><span class="kind">Řešený případ${c.status === 'draft' ? ' · koncept' : ''}</span><strong>${esc(c.title)}</strong>
    ${c.summary ? `<span>${esc(trim(c.summary, 160))}</span>` : ''}<em>${kroku2((c.steps || []).length)}${(c.area_keys || []).length ? ' · ' + esc(c.area_keys.map(areaName).join(', ')) : ''}</em></a>`;
}
function renderCases(){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const areas = [...new Set(caseList().flatMap(c => c.area_keys || []))];
  const xs = caseList().filter(c => !CS.area || (c.area_keys || []).includes(CS.area));
  $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Řešené případy</div><h1>Řešené případy</h1>
    <p class="lead">Konkrétní situace rozebrané krok za krokem – jak se postupuje a o která ustanovení se každý krok opírá.</p>
    ${areas.length > 1 ? `<div class="area-switch" role="group" aria-label="Oblast"><button type="button" class="chipb ${!CS.area ? 'on' : ''}" data-ca="">Všechny oblasti</button>${areas.map(k => `<button type="button" class="chipb ${CS.area === k ? 'on' : ''}" data-ca="${esc(k)}">${esc(areaName(k))}</button>`).join('')}</div>` : ''}
    ${xs.length ? `<div class="cards">${xs.map(caseCard).join('')}</div>` : '<div class="empty">Redakce zatím nezveřejnila žádné řešené případy.</div>'}</div>`;
  $('#panelText').querySelectorAll('[data-ca]').forEach(b => b.onclick = () => { CS.area = b.dataset.ca; renderCases(); });
  document.title = 'Řešené případy · RegulaQuest';
}
function renderCase(c){
  if (!c){ $('#panelText').innerHTML = '<div class="empty">Případ nebyl nalezen.</div>'; return; }
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const rel = (c.unit_ids || []).map(id => S.units.get(id)).filter(Boolean);
  $('#panelText').innerHTML = `<div class="case"><div class="crumbs"><a href="#/pripady">Řešené případy</a></div>
    <div class="eyebrow">Řešený případ${c.status === 'draft' ? ' · koncept' : ''}</div><h1>${esc(c.title)}</h1>
    ${typeof fbBtn === 'function' ? `<div class="fb-line">${fbBtn('case', c.id, '', 'Řešený případ: ' + c.title)}</div>` : ''}
    ${c.summary ? `<p class="lead">${esc(c.summary)}</p>` : ''}
    ${(c.area_keys || []).length || (c.tags || []).length ? `<div class="upd-links">${(c.area_keys || []).map(k => `<span class="atag">${esc(areaName(k))}</span>`).join('')}${(c.tags || []).map(k => `<span class="atag supplementary">${esc(roleName(k))}</span>`).join('')}</div>` : ''}
    ${c.assignment ? `<section class="cs-box assign"><h2>Zadání</h2>${caseText(c.assignment)}</section>` : ''}
    ${(c.steps || []).length ? `<h2 class="cs-h">Postup</h2><ol class="cs-steps">${c.steps.map((s, i) => { const u = s.unit_id && S.units.get(s.unit_id);
      return `<li><div class="cs-num">${i + 1}</div><div class="cs-body">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${caseText(s.body)}
        ${u ? `<a class="btn small cs-read" href="#/u/${encodeURIComponent(u.id)}" data-case-step="${i}">Číst v předpisu: ${esc(unitName(u))} →</a>` : ''}</div></li>`; }).join('')}</ol>` : ''}
    ${c.conclusion ? `<section class="cs-box concl"><h2>Závěr</h2>${caseText(c.conclusion)}</section>` : ''}
    ${rel.length ? `<div class="sec"><h2>Související ustanovení</h2></div><ul class="fr-list units">${rel.map(u => `<li><a href="#/u/${encodeURIComponent(u.id)}" data-case-step="-1"><small>${esc(docTitle(S.docs.get(u.document_id)))}</small><strong>${esc(u.label)}${headingOf(u) ? ' – ' + esc(trim(headingOf(u), 90)) : ''}</strong></a></li>`).join('')}</ul>` : ''}
    ${disclaimer()}</div>`;
  $('#panelText').querySelectorAll('[data-case-step]').forEach(a => a.addEventListener('click', () => { CS.back = { id: c.id, step: +a.dataset.caseStep }; }));
  document.title = `${c.title} · Řešené případy · RegulaQuest`;
}
// Lišta „zpět na případ“ nad ustanovením otevřeným z případu
function caseBackBar(u){
  const c = CS.back && caseOf(CS.back.id);
  if (!c || !u) return;
  const ids = new Set([u.id]); const cp = counterpart(u); if (cp) ids.add(cp.unit.id);
  if (![...caseUnits(c)].some(id => ids.has(id)) && !ancestors(u).some(a => caseUnits(c).has(a.id))) return;
  const bar = document.createElement('div'); bar.className = 'cs-backbar';
  bar.innerHTML = `<a href="#/pripad/${encodeURIComponent(c.id)}">← Zpět na řešený případ: <strong>${esc(c.title)}</strong></a>`;
  $('#panelText').prepend(bar);
}
function casesCtx(u){
  const xs = casesFor(u);
  return xs.length ? `<div class="ctx-section"><h3>Řešené případy</h3>${xs.map(c => `<div class="ctx-card"><a class="ctx-link" href="#/pripad/${encodeURIComponent(c.id)}"><strong>${esc(c.title)}</strong><small>${kroku2((c.steps || []).length)}</small></a></div>`).join('')}</div>` : '';
}
