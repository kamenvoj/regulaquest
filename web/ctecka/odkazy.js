'use strict';
/* RegulaQuest čtečka – Užitečné odkazy: rozcestník webů (úřady, databáze, legislativa…) podle kategorií.
   Načítají se zvlášť (rq_reader_links) – zveřejněné jsou vidět hned. Otevírají se v novém okně. */
const LK = { list:[], cat:'', area:'', q:'' };
async function loadLinks(){
  try { const { data, error } = await RQ.client.rpc('rq_reader_links'); if (!error && Array.isArray(data)) LK.list = data; } catch {}
}
const linkHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function renderLinks(){
  const areaName = k => (S.data.areas || []).find(a => a.key === k)?.name || k;
  const ORDER = ['Úřady a instituce', 'Databáze a registry', 'Legislativa', 'Metodiky a pokyny', 'Normy', 'Ostatní'];
  const cats = [...new Set(LK.list.map(l => l.category))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b, 'cs')), areas = [...new Set(LK.list.flatMap(l => l.area_keys || []))];
  const qs = terms(LK.q);
  const xs = LK.list.filter(l => (!LK.cat || l.category === LK.cat) && (!LK.area || (l.area_keys || []).includes(LK.area))
    && (!qs.length || qs.every(t => fold([l.title, l.description, l.category, linkHost(l.url), ...(l.tags || []).map(roleName)].join(' ')).includes(t))));
  const chips = (key, vals, label, all) => vals.length > 1 ? `<div class="area-switch" role="group" aria-label="${label}"><button type="button" class="chipb ${!LK[key] ? 'on' : ''}" data-lk="${key}" data-v="">${all}</button>${vals.map(v => `<button type="button" class="chipb ${LK[key] === v ? 'on' : ''}" data-lk="${key}" data-v="${esc(v)}">${esc(key === 'area' ? areaName(v) : v)}</button>`).join('')}</div>` : '';
  $('#panelText').innerHTML = `<div class="finder"><div class="eyebrow">Odkazy</div><h1>Užitečné odkazy</h1>
    <p class="lead">Úřady, databáze, legislativa a další weby, které se při práci s regulací hodí. Otevírají se v novém okně.</p>
    ${chips('cat', cats, 'Kategorie', 'Všechny kategorie')}${chips('area', areas, 'Oblast', 'Všechny oblasti')}
    <div class="toolbar"><input type="search" id="lkQ" placeholder="Hledat odkaz…" aria-label="Hledat odkaz" value="${esc(LK.q)}"></div>
    ${xs.length ? cats.filter(c => xs.some(l => l.category === c)).map(c => `<div class="sec"><h2>${esc(c)}</h2></div><div class="lk-cards">${xs.filter(l => l.category === c).map(l => `<div class="card lk">
      <div class="lk-top"><strong>${esc(l.title)}</strong><span class="lk-host">${esc(linkHost(l.url))}</span></div>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      ${(l.area_keys || []).length || (l.tags || []).length ? `<div class="upd-links">${(l.area_keys || []).map(k => `<span class="atag">${esc(areaName(k))}</span>`).join('')}${(l.tags || []).map(k => `<span class="atag supplementary">${esc(roleName(k))}</span>`).join('')}</div>` : ''}
      <div class="lk-act"><a class="btn small acc" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Otevřít ↗</a><details><summary>Zobrazit adresu</summary><code>${esc(l.url)}</code></details></div></div>`).join('')}</div>`).join('')
      : `<div class="empty">${LK.list.length ? 'Žádný odkaz neodpovídá výběru.' : 'Redakce zatím nezveřejnila žádné odkazy.'}</div>`}</div>`;
  $('#panelText').querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { LK[b.dataset.lk] = b.dataset.v; renderLinks(); });
  const qi = $('#lkQ'); let t; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { LK.q = qi.value; const p = qi.selectionStart; renderLinks(); const n = $('#lkQ'); n.focus(); n.setSelectionRange(p, p); }, 200); };
  document.title = 'Užitečné odkazy · RegulaQuest';
}
