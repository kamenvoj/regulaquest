'use strict';
/* RegulaQuest – studentská čtečka (webová verze nad Supabase).
   Po přihlášení načte aktuální publikovanou verzi (rq_current_publication).
   Admin může otevřít pracovní náhled: ?nahled=pracovni (rq_draft_preview). Nic neukládá. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const REL_NAMES = {guidance:'Metodický výklad',references:'Výslovný odkaz',related:'Tematická souvislost',supplements:'Doplňuje',amends:'Mění / nahrazuje'};
const NOTE_NAMES = {explanation:'Výklad',warning:'Na co si dát pozor',example:'Praktický příklad',definition:'Definice pojmu',reference:'Poznámka ke zdroji',key:'Klíčová pasáž',duty:'Povinnost',deadline:'Lhůta / číslo',exception:'Výjimka / podmínka'};
const HL = ['duty','deadline','exception'];
const ICON = k => (window.RQNotes?.ICON[k]) || '';
const LANG_NAMES = {cs:'čeština',en:'English'};

const S = {
  data:null, draft:false,
  units:new Map(), docs:new Map(), children:new Map(),
  rels:new Map(), notes:new Map(), order:new Map(),
  terms:[], off:loadOff(),
  docId:null, unitId:null, query:'', highlight:'', expanded:new Set(), tab:'text'
};

/* ---------- Data ---------- */
function loadOff(){ try { const v = JSON.parse(localStorage.getItem('rq-vrstvy-skryte')); if (Array.isArray(v)) return new Set(v); } catch {} return new Set(['duty','deadline','exception']); }
function saveOff(){ try { localStorage.setItem('rq-vrstvy-skryte', JSON.stringify([...S.off])); } catch {} }
let RQ = null;
const wantsDraft = () => new URLSearchParams(location.search).get('nahled') === 'pracovni';

async function load(rq){
  RQ = rq;
  const name = rq.me.profile?.display_name || rq.me.profile?.username || '';
  $('#userName').textContent = name;
  $('#logoutBtn').onclick = () => rq.logout();
  let d;
  try{
    const draft = wantsDraft() && rq.me.isAdmin;
    const { data, error } = await rq.client.rpc(draft ? 'rq_draft_preview' : 'rq_current_publication');
    if (error) throw new Error(error.message);
    d = data;
  }catch(e){
    $('#layout').innerHTML = `<div class="error"><h1>Čtečku nelze otevřít</h1><p>${esc(rq.czError(e))}</p></div>`;
    return;
  }
  if (!d){
    $('#layout').innerHTML = `<div class="error"><h1>Obsah se připravuje</h1><p>Zatím nebyla zveřejněna žádná verze. Zkuste to prosím později.</p></div>`;
    return;
  }
  if (!String(d.format||'').startsWith('regulaquest-education')){
    $('#layout').innerHTML = '<div class="error"><h1>Čtečku nelze otevřít</h1><p>Neznámý formát dat.</p></div>';
    return;
  }
  index(d);
  route();
  window.addEventListener('hashchange', route);
}

/* Obrázky z úložiště: dočasné podepsané odkazy (platí hodinu), jen pro přihlášené. */
const figureUrls = new Map();
async function resolveFigures(){
  for (const img of document.querySelectorAll('img[data-fig]')){
    const path = img.dataset.fig;
    if (!figureUrls.has(path)){
      const { data } = await RQ.client.storage.from('figures').createSignedUrl(path, 3600);
      figureUrls.set(path, data?.signedUrl || '');
    }
    if (figureUrls.get(path)) img.src = figureUrls.get(path);
    img.removeAttribute('data-fig');
  }
}

  const versionText = v => /^[\d. ]+$/.test(v) ? 'znění k ' + v : v;
function index(d){
  S.data = d; S.draft = d.mode === 'draft';
  d.documents.forEach(x => S.docs.set(x.id, x));
  d.units.forEach(u => S.units.set(u.id, u));
  const byOrder = (a,b) => (a.sort_order??0)-(b.sort_order??0) || a.label.localeCompare(b.label,'cs',{numeric:true});
  d.units.forEach(u => {
    const k = u.parent_id && S.units.has(u.parent_id) ? u.parent_id : 'doc:' + u.document_id;
    if (!S.children.has(k)) S.children.set(k, []);
    S.children.get(k).push(u);
  });
  S.children.forEach(list => list.sort(byOrder));
  // Pořadí čtení v rámci dokumentu (do hloubky) pro tlačítka Předchozí / Další.
  d.documents.forEach(doc => {
    const seq = []; const walk = list => list.forEach(u => { if (!u.navigation_only) seq.push(u.id); walk(kids(u.id)); });
    walk(kids('doc:' + doc.id)); S.order.set(doc.id, seq);
  });
  mirrorRelations(d.relations).forEach(r => {
    [r.source_id, r.target_id].forEach(id => { if (!S.rels.has(id)) S.rels.set(id, []); S.rels.get(id).push(r); });
  });
  S.terms = d.terms || [];
  d.comments.forEach(c => { if (!S.notes.has(c.unit_id)) S.notes.set(c.unit_id, []); S.notes.get(c.unit_id).push(c); });

  // Odkaz na pracovní náhled otevřel student: vysvětlit, proč vidí jen publikovaný obsah.
  const deniedDraft = wantsDraft() && !S.draft;
  if (deniedDraft) $('#draftBanner').textContent = 'Pracovní náhled je jen pro redakci. Zobrazuje se publikovaný obsah pro studenty.';
  document.body.classList.toggle('has-banner', S.draft || deniedDraft);
  $('#draftBanner').classList.toggle('hidden', !(S.draft || deniedDraft));
  $('#docSelect').innerHTML = d.documents.map(x => `<option value="${esc(x.id)}">${esc(docShort(x))}</option>`).join('');
  $('#docSelect').onchange = e => go('#/d/' + e.target.value);
  let timer;
  $('#search').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { S.query = e.target.value.trim(); renderNav(); }, 140); };
  document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  document.querySelectorAll('#legendPanel .lg').forEach(e => e.innerHTML = ICON(e.dataset.i));
  $('#legendBtn').onclick = () => { const p = $('#legendPanel'), open = p.classList.toggle('hidden'); $('#legendBtn').setAttribute('aria-expanded', String(!open)); };
}

const kids = id => S.children.get(id) || [];
const docShort = d => `${d.family} · ${LANG_NAMES[d.language] || d.language.toUpperCase()}`;
/* Nadpis bez opakovaného označení („Rule 11 – …“ → „…“, „6.3. Pravidlo 11“ → nic). */
function headingOf(u){
  let h = (u.heading || '').trim(); if (!h) return '';
  const f = fold(h), l = fold(u.label);
  if (f.replace(/^[\d.\s]+/, '') === l) return '';
  if (f.startsWith(l)) h = h.slice(u.label.length).replace(/^[\s–—:-]+/, '');
  return h;
}
/* Úvodní řádky textu, které jen opakují označení a nadpis, se nezobrazují dvakrát. */
function bodyOf(u){
  const paras = u.body.trim().split(/\n{2,}/), skip = new Set([fold(u.label), fold(u.heading || '')]);
  while (paras.length > 1 && skip.has(fold(paras[0].trim()))) paras.shift();
  return paras.join('\n\n');
}
const hasText = u => u && !u.navigation_only && u.body && u.body.trim();
function ancestors(u){ const out=[]; const seen=new Set(); let p=S.units.get(u.parent_id); while(p && !seen.has(p.id)){ out.unshift(p); seen.add(p.id); p=S.units.get(p.parent_id); } return out; }
function descendantsWithText(id){ const out=[]; const walk=l=>l.forEach(u=>{ if(hasText(u)) out.push(u); else walk(kids(u.id)); }); walk(kids(id)); return out; }
function go(hash){ if (location.hash === hash) route(); else location.hash = hash; }

/* Stejné znění v jiném jazyce: stejná skupina dokumentu a stejná přípona identifikátoru. */
function counterpart(u){
  const doc = S.docs.get(u.document_id); if (!doc || !u.id.startsWith(doc.id + '-')) return null;
  const rest = u.id.slice(doc.id.length);
  for (const other of S.docs.values()){
    if (other.id === doc.id || other.group_key !== doc.group_key) continue;
    const c = S.units.get(other.id + rest); if (c) return {unit:c, doc:other};
  }
  return null;
}

/* Vazby se tvoří jednou (obvykle v české verzi) a platí pro všechny jazykové verze předpisu:
   zdroj se převede na stejnou část v jiném jazyce, cíl na verzi ve stejném jazyce, pokud existuje. */
function equivalentIn(u, docId){
  const doc = S.docs.get(u.document_id);
  return doc && u.id.startsWith(doc.id + '-') ? S.units.get(docId + u.id.slice(doc.id.length)) || null : null;
}
function mirrorRelations(list){
  const out = [...list], seen = new Set(list.map(r => r.source_id + '>' + r.target_id + '>' + r.relation_type));
  for (const r of list){
    const s = S.units.get(r.source_id), t = S.units.get(r.target_id); if (!s || !t) continue;
    const sd = S.docs.get(s.document_id), td = S.docs.get(t.document_id); if (!sd || !td) continue;
    for (const od of S.docs.values()){
      if (od.id === sd.id || od.group_key !== sd.group_key) continue;
      const s2 = equivalentIn(s, od.id); if (!s2) continue;
      let t2 = t;
      for (const ot of S.docs.values()) if (ot.group_key === td.group_key && ot.language === od.language){ const c = equivalentIn(t, ot.id); if (c){ t2 = c; break; } }
      const k = s2.id + '>' + t2.id + '>' + r.relation_type; if (seen.has(k)) continue; seen.add(k);
      out.push({...r, id: r.id + '@' + od.id, source_id: s2.id, target_id: t2.id, mirrored: true});
    }
  }
  return out;
}

/* ---------- Routing ---------- */
function route(){
  const h = decodeURIComponent(location.hash.slice(1));
  const m = h.match(/^\/(u|d)\/(.+)$/);
  S.unitId = null;
  if (m && m[1] === 'u' && S.units.has(m[2])){ S.unitId = m[2]; S.docId = S.units.get(m[2]).document_id; }
  else if (m && m[1] === 'd' && S.docs.has(m[2])){ S.docId = m[2]; }
  else S.docId = S.docId || S.data.documents[0]?.id || null;
  if (S.unitId){ ancestors(S.units.get(S.unitId)).forEach(a => S.expanded.add(a.id)); }
  if (S.docId) $('#docSelect').value = S.docId;
  const home = !m;
  render(home);
  if (S.unitId || (m && m[1]==='d')) setTab('text', false);
}

function setTab(t, scroll=true){
  S.tab = t; document.body.dataset.tab = t;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (scroll) window.scrollTo(0,0);
}

function render(home){
  renderNav();
  if (home) renderHome();
  else if (S.unitId) renderUnit(S.units.get(S.unitId));
  else renderDoc(S.docs.get(S.docId));
  renderContext();
  $('#panelText').scrollTop = 0;
  const cur = document.querySelector('.node a.current');
  if (cur) cur.scrollIntoView({block:'nearest'});
}

/* ---------- Text formatting & search ---------- */
function fold(s){ let o=''; for (const ch of s){ const f = ch.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase(); o += f ? f[0] : ch; } return o; }
const terms = q => fold(q).split(/\s+/).filter(t => t.length >= 2);
function marked(text, q){
  const ts = q ? terms(q) : []; if (!ts.length) return esc(text);
  const f = fold(text), hit = new Array(text.length).fill(false);
  ts.forEach(t => { let j = 0; while ((j = f.indexOf(t, j)) !== -1){ for (let k = j; k < j + t.length; k++) hit[k] = true; j += t.length; } });
  let out = '', open = false;
  for (let i = 0; i < text.length; i++){
    if (hit[i] !== open){ out += hit[i] ? '<mark>' : '</mark>'; open = hit[i]; }
    out += esc(text[i]);
  }
  return out + (open ? '</mark>' : '');
}
const LIST_LINE = /^([—–•-]|[a-z]\)|\(?[ivx]+\)|\d+[.)]|\(\d+\))\s/;
const RUNNING_HEADER = /^Medical Devices\s*\nMedical Device Coordination Group Document/; // záhlaví stránek PDF MDCG
/* Řádky zalomené jen kvůli šířce stránky (typicky PDF) spojí do jednoho odstavce; výčty zachová. */
function joinLines(par){
  return par.split('\n').reduce((acc, line) => {
    const t = line.trim(); if (!t) return acc;
    const prev = acc[acc.length - 1];
    if (prev !== undefined && !LIST_LINE.test(t) && !/^\s/.test(line) && !/[:;]$/.test(prev)) acc[acc.length - 1] = prev + ' ' + t;
    else acc.push(line.replace(/\s+$/, ''));   // úvodní odsazení = pokračování bodu
    return acc;
  }, []);
}
function legal(text, q=''){
  return String(text).trim().split(/\n{2,}/).map(par => {
    if (RUNNING_HEADER.test(par.trim())) return '';
    const page = par.trim().match(/^\[PDF strana (\d+)\]$/);
    if (page) return `<span class="pdfpage">PDF str. ${esc(page[1])}</span>`;
    const head = par.trim().match(/^\[PDF strana (\d+)\]\n([\s\S]*)$/);
    if (head) return `<span class="pdfpage">PDF str. ${esc(head[1])}</span>` + legal(head[2], q);
    const lines = joinLines(par).map(l => {
      // odsazení podle úvodních mezer (2 mezery = 1 úroveň), odrážky s visícím odsazením
      const t = l.trim(), lvl = Math.floor((l.match(/^ */)[0].length) / 2), list = LIST_LINE.test(t) && (lvl > 0 || /^\(?\d+\)/.test(t));
      return `<span class="ln${list ? ' hang' : ''}" style="--lvl:${lvl}">${marked(t,q)}</span>`;
    });
    const flat = par.trim();
    if (flat.length < 90 && !flat.includes('\n') && /\p{Lu}{3}/u.test(flat) && flat === flat.toLocaleUpperCase('cs')) return `<p class="sub">${marked(flat,q)}</p>`;
    return `<p>${lines.join('')}</p>`;
  }).join('');
}
/* Strukturovaný obsah z editoru Studia (text s formátováním a tabulky).
   Formátování se znovu čistí i zde: povolené jsou jen b, strong, i, em, u, br. */
const INLINE_OK = new Set(['B','STRONG','I','EM','U']);
function safeInline(html){
  const root = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html').body.firstChild;
  const walk = n => [...n.childNodes].map(c => {
    if (c.nodeType === 3) return esc(c.textContent);
    if (c.nodeType !== 1) return '';
    if (c.tagName === 'BR') return '<br>';
    const inner = walk(c), t = c.tagName.toLowerCase();
    return INLINE_OK.has(c.tagName) ? `<${t}>${inner}</${t}>` : inner;
  }).join('');
  return root ? walk(root) : '';
}
/* Prázdný řádek (<br><br>) = nový odstavec; odrážky s visícím odsazením. */
function richParas(html){
  return html.split(/(?:<br>\s*){2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p${/^(?:<b>)?\s*[•▪◦●\-–—]\s/.test(p) ? ' class="hang"' : ''}>${p}</p>`).join('');
}
function tableBlock(b, q){
  const cell = c => { const tag = c.header ? 'th' : 'td', al = ['left','center','right'].includes(c.align) ? c.align : 'left';
    return `<${tag} rowspan="${Math.max(1, c.rowspan|0)}" colspan="${Math.max(1, c.colspan|0)}" class="al-${al}">${marked(String(c.text||''), q).replace(/\n/g,'<br>')}</${tag}>`; };
  return `<figure class="tbl">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}<div class="tbl-wrap"><table>${(b.rows||[]).map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table></div>${b.notes ? `<div class="tbl-notes">${plain(b.notes)}</div>` : ''}</figure>`;
}
function content(u, q){
  if (Array.isArray(u.content_blocks) && u.content_blocks.length)
    return u.content_blocks.map(b => b.type === 'table' ? tableBlock(b, q)
      : b.type === 'figure' ? `<figure class="fig"><img data-fig="${esc(b.path)}" alt="${esc(b.alt || b.caption || '')}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`
      : `<div class="rich">${richParas(safeInline(b.html))}</div>`).join('');
  return legal(bodyOf(u), q);
}
/* Zvýraznění hledaného výrazu v již vykresleném textu (formátované bloky, např. MDCG). */
function markDom(root, q){
  const ts = terms(q); if (!ts.length) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  let n; while ((n = w.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const t = node.nodeValue, f = fold(t), hit = new Array(t.length).fill(false);
    ts.forEach(x => { let j = 0; while ((j = f.indexOf(x, j)) !== -1){ for (let k = j; k < j + x.length; k++) hit[k] = true; j += x.length; } });
    if (!hit.includes(true)) return;
    const frag = document.createDocumentFragment(); let i = 0;
    while (i < t.length){ let j = i; while (j < t.length && hit[j] === hit[i]) j++;
      const part = document.createTextNode(t.slice(i, j));
      if (hit[i]){ const m = document.createElement('mark'); m.appendChild(part); frag.appendChild(m); } else frag.appendChild(part);
      i = j; }
    node.replaceWith(frag);
  });
}
function plain(text){ return String(text).trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join(''); }
function snippet(text, q){
  const f = fold(text), i = Math.min(...terms(q).map(t => f.indexOf(t)).filter(x => x >= 0)); if (!isFinite(i)) return '';
  const a = Math.max(0, i - 60), b = Math.min(text.length, i + 120);
  return (a ? '…' : '') + marked(text.slice(a,b).replace(/\s+/g,' '), q) + (b < text.length ? '…' : '');
}

/* ---------- Left panel ---------- */
function renderNav(){
  const box = $('#navBody');
  if (S.query.length >= 2) return renderResults(box);
  const doc = S.docs.get(S.docId);
  if (!doc){ box.innerHTML = ''; return; }
  const top = kids('doc:' + doc.id);
  const groups = doc.document_type === 'regulation'
    ? [['Články', top.filter(u => u.kind === 'article')], ['Přílohy', top.filter(u => u.kind === 'annex')], ['Ostatní', top.filter(u => !['article','annex'].includes(u.kind))]]
    : [['Obsah', top]];
  box.innerHTML = groups.filter(g => g[1].length).map(([name, list]) => `<div class="nav-group">${esc(name)}</div>${tree(list)}`).join('');
  box.querySelectorAll('.caret').forEach(b => b.onclick = () => { const id=b.dataset.id; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); renderNav(); });
}
function tree(list){
  return `<ul class="tree">${list.map(u => {
    const ch = kids(u.id), open = S.expanded.has(u.id) || S.unitId === u.id;
    const marks = outlineMarks(u);
    const heading = headingOf(u) ? `<span class="h">${esc(trim(headingOf(u),60))}</span>` : '';
    return `<li><div class="node">${ch.length ? `<button class="caret" data-id="${esc(u.id)}" aria-label="${open?'Sbalit':'Rozbalit'}" aria-expanded="${open}">${open?'▼':'▶'}</button>` : '<span class="caret-space"></span>'}
      <a href="#/u/${encodeURIComponent(u.id)}" class="${u.id===S.unitId?'current':''} ${u.navigation_only?'locked':''}">${esc(u.label)}${marks}${heading}</a></div>
      ${ch.length && open ? tree(ch) : ''}</li>`;
  }).join('')}</ul>`;
}
function outlineMarks(u){
  const ns = S.notes.get(u.id) || [], rs = S.rels.get(u.id) || [];
  const out = [];
  if (ns.some(n => n.kind === 'key')) out.push(['key','Obsahuje klíčovou pasáž']);
  if (ns.some(n => n.kind === 'warning')) out.push(['warning','Na co si dát pozor']);
  if (ns.some(n => !['key','warning',...HL].includes(n.kind))) out.push(['comment','Má výklad nebo poznámku']);
  if (rs.some(r => isGuidanceLink(u, r))) out.push(['guidance','Má metodický výklad (MDCG)']);
  return out.length ? `<span class="marks">${out.map(([k,t]) => `<span class="m m-${k}" title="${t}">${ICON(k)}</span>`).join('')}</span>` : '';
}
function isGuidanceLink(u, r){
  const o = S.units.get(r.source_id === u.id ? r.target_id : r.source_id);
  const t = id => S.docs.get(S.units.get(id)?.document_id)?.document_type;
  return o && (t(u.id) === 'guidance') !== (t(o.id) === 'guidance');
}
const trim = (s,n) => s.length > n ? s.slice(0,n-1) + '…' : s;

function renderResults(box){
  const q = S.query, ts = terms(q);
  const hits = ts.length ? S.data.units.filter(u => { if (u.navigation_only) return false; const f = fold([u.label,u.heading,u.locator,u.body].join(' ')); return ts.every(t => f.includes(t)); }) : [];
  // Přednost mají nejmenší části (odstavec před celým článkem).
  hits.sort((a,b) => (a.document_id===S.docId?0:1)-(b.document_id===S.docId?0:1) || (kids(a.id).length?1:0)-(kids(b.id).length?1:0));
  const shown = hits.slice(0, 80);
  $('#panelNav').scrollTop = 0;
  box.innerHTML = `<div class="results-head">${hits.length ? `Nalezeno ${hits.length}${hits.length>80?' (zobrazeno 80)':''}` : 'Nic nenalezeno. Zkuste jiný výraz nebo jiný jazyk dokumentu.'}</div>` +
    shown.map(u => { const d=S.docs.get(u.document_id);
      return `<a class="result" href="#/u/${encodeURIComponent(u.id)}" data-hl="1"><strong>${esc(u.label)}${headingOf(u)?' – '+esc(trim(headingOf(u),50)):''}</strong><small>${esc(docShort(d))}${ancestors(u).length?' › '+esc(ancestors(u).map(a=>a.label).join(' › ')):''}</small><small>${snippet(u.body,q)}</small></a>`; }).join('');
  box.querySelectorAll('.result').forEach(a => a.addEventListener('click', e => { S.highlight = S.query; if (a.getAttribute('href') === location.hash){ e.preventDefault(); route(); } }));
}

/* ---------- Center panel ---------- */
function crumbs(u){
  const d = S.docs.get(u.document_id);
  return `<div class="crumbs"><a href="#/d/${encodeURIComponent(d.id)}">${esc(docShort(d))}</a>${ancestors(u).map(a => ` › <a href="#/u/${encodeURIComponent(a.id)}">${esc(a.label)}</a>`).join('')}</div>`;
}
function sourceLine(d){
  return `<div class="source">Zdroj: ${esc(d.title)}${d.version?', '+esc(versionText(d.version)):''}${d.publisher?' · '+esc(d.publisher):''}. ${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Oficiální znění ↗</a>`:''}<br>${esc(S.data.notice||'')}</div>`;
}

function renderUnit(u){
  const d = S.docs.get(u.document_id), q = S.highlight; S.highlight = '';
  const cp = counterpart(u);
  const status = S.draft && u.text_status !== 'verified' && !u.navigation_only ? ' <span class="chip warn">Neověřený text</span>' : '';
  let html = crumbs(u) + `<div class="title-row"><h1>${esc(u.label)}${status}${headingOf(u) ? `<span class="heading">${esc(headingOf(u))}</span>` : ''}</h1>
    ${cp ? `<a class="lang-btn" href="#/u/${encodeURIComponent(cp.unit.id)}" title="Stejné ustanovení v jazyce ${esc(LANG_NAMES[cp.doc.language]||cp.doc.language)}">${esc(cp.doc.language.toUpperCase())}</a>` : ''}</div>`;
  const ch = kids(u.id);
  if (hasText(u)){
    html += `<div class="legal" data-unit="${esc(u.id)}">${content(u, q)}</div>`;
    if (ch.length) html += `<div class="subparts"><h2>Členění</h2><div class="chips">${ch.map(c => `<a href="#/u/${encodeURIComponent(c.id)}">${esc(c.label)}</a>`).join('')}</div></div>`;
  } else {
    const parts = descendantsWithText(u.id);
    html += `<div class="note">${parts.length ? 'V aplikaci jsou zatím ověřené jen části uvedené níže.' : 'Text této části zatím v aplikaci není ověřen.'} Celé znění najdete v ${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">oficiálním zdroji ↗</a>`:'oficiálním zdroji'}.</div>`;
    html += parts.map(p => `<section class="part"><h3><a href="#/u/${encodeURIComponent(p.id)}">${esc(p.label)}</a></h3><div class="legal" data-unit="${esc(p.id)}">${content(p, q)}</div></section>`).join('');
  }
  html += pager(u) + sourceLine(d);
  $('#panelText').innerHTML = html;
  if (q) document.querySelectorAll('#panelText .rich').forEach(el => markDom(el, q));
  const nTerms = markTerms(d);
  anchorNotes();
  layerBar(u, nTerms);
  resolveFigures();
  document.title = `${u.label} · ${docShort(d)} · RegulaQuest`;
}

/* Poznámky ukotvené k textu: podtržení + ikonka; klepnutím se poznámka rozbalí přímo pod řádkem. */
function anchorNotes(){
  if (!window.RQNotes) return;
  document.querySelectorAll('#panelText .legal').forEach(box => {
    const id = box.dataset.unit; if (!id) return;
    const links = RQNotes.linkGroups((S.rels.get(id) || []).filter(r => r.source_id === id && !r.mirrored));
    RQNotes.applyAnchors(box, (S.notes.get(id) || []).concat(links), toggleNote);
  });
}
/* Pojmy z definic: první výskyt v každé části, klepnutím definice pod řádkem. */
function markTerms(d){
  if (!window.RQNotes || !S.terms.length) return 0;
  let n = 0;
  document.querySelectorAll('#panelText .legal').forEach(box => {
    const id = box.dataset.unit;
    const ts = S.terms.filter(t => t.language === d.language && t.unit_id !== id);
    n += RQNotes.applyTerms(box, ts, toggleTerm);
  });
  return n;
}
function toggleTerm(t, el){
  const open = document.querySelector(`.rq-pop[data-term="${CSS.escape(t.id)}"]`);
  document.querySelectorAll('.rq-pop').forEach(p => p.remove());
  if (open) return;
  const du = S.units.get(t.unit_id), text = du ? RQNotes.definitionText(bodyOf(du), t.number) : '';
  const pop = document.createElement('span');
  pop.className = 'rq-pop term'; pop.dataset.term = t.id; pop.dataset.noAnchor = '1';
  const tw = du ? [...S.docs.values()].filter(x => x.id !== du.document_id && x.group_key === S.docs.get(du.document_id)?.group_key)
    .map(x => { const eu = equivalentIn(du, x.id); const tt = eu && S.terms.find(y => y.unit_id === eu.id && y.number === t.number); return tt ? `${x.language.toUpperCase()}: ${esc(tt.name)}` : ''; }).filter(Boolean).join(' · ') : '';
  pop.innerHTML = `<span class="rq-pop-h">${ICON('term')} Definice · ${du ? `<a href="#/u/${encodeURIComponent(du.id)}">${esc(du.label)}, bod ${t.number}</a>` : ''}${tw ? `<span class="tw">${tw}</span>` : ''}</span>${esc(text || t.name).replace(/\n/g,'<br>')}`;
  (el.closest('p, .ln, li, td, .legal') || el.parentElement).after(pop);
}
/* Vrstvy nad textem: jen ty, které v části opravdu jsou; klepnutím zapnout / vypnout. */
function layerBar(u, nTerms){
  const ids = [...document.querySelectorAll('#panelText .legal')].map(b => b.dataset.unit);
  const cnt = k => ids.reduce((s, id) => s + (S.notes.get(id) || []).filter(c => c.kind === k && c.anchor_text).length, 0);
  const items = [...RQNotes.LAYERS.map(k => [k, cnt(k)]), ['term', nTerms]].filter(x => x[1]);
  const panel = $('#panelText');
  ['key',...HL,'term'].forEach(k => panel.classList.toggle('off-' + k, S.off.has(k)));
  if (!items.length) return;
  const bar = document.createElement('div'); bar.className = 'layer-bar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Zvýraznění v textu');
  bar.innerHTML = '<span class="lb-label">Zobrazit:</span>' + items.map(([k, n]) =>
    `<button type="button" class="lb lb-${k}" data-layer="${k}" aria-pressed="${!S.off.has(k)}"><span class="sw"></span>${esc(RQNotes.LAYER_NAMES[k])} <small>${n}</small></button>`).join('');
  bar.querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = b.dataset.layer; S.off.has(k) ? S.off.delete(k) : S.off.add(k); saveOff();
    b.setAttribute('aria-pressed', String(!S.off.has(k))); panel.classList.toggle('off-' + k, S.off.has(k));
  });
  const first = panel.querySelector('.legal'); first.before(bar);
}
function toggleNote(c, mk){
  const open = document.querySelector(`.rq-pop[data-cid="${CSS.escape(c.id)}"]`);
  document.querySelectorAll('.rq-pop').forEach(p => p.remove());
  if (open) return;
  const pop = document.createElement('span');
  pop.className = 'rq-pop' + (c.kind === 'warning' ? ' warn' : ''); pop.dataset.cid = c.id; pop.dataset.noAnchor = '1';
  if (c.kind === 'link') pop.innerHTML = `<span class="rq-pop-h">${ICON('link')} Propojeno</span>` + c.rels.map(r => { const o = S.units.get(r.target_id); if (!o) return ''; const d = S.docs.get(o.document_id);
      return `<a class="lk" href="#/u/${encodeURIComponent(o.id)}"><strong>${esc(o.label)}${headingOf(o)?' – '+esc(trim(headingOf(o),60)):''}</strong><small>${esc(REL_NAMES[r.relation_type]||'')} · ${esc(docShort(d))}${ancestors(o).length?' › '+esc(ancestors(o).map(a=>a.label).join(' › ')):''}</small></a>${r.rationale?`<span class="why">${esc(r.rationale)}</span>`:''}`; }).join('');
  else pop.innerHTML = `<span class="rq-pop-h">${ICON(c.kind)} ${esc(NOTE_NAMES[c.kind]||c.kind)}${S.draft&&c.status!=='approved'?' · koncept':''}</span>${esc(c.body).replace(/\n/g,'<br>')}`;
  const block = mk.closest('p, .ln, li, td, .legal') || mk.parentElement;
  block.after(pop);
}

function pager(u){
  const seq = S.order.get(u.document_id) || [], i = seq.indexOf(u.id);
  if (i < 0) return '';
  const link = (id, cls, word) => { const x = S.units.get(id); return x ? `<a class="${cls}" href="#/u/${encodeURIComponent(id)}"><small>${word}</small>${esc(x.label)}${ancestors(x).length?' · '+esc(ancestors(x).at(-1).label):''}</a>` : '<span></span>'; };
  return `<div class="pager">${i>0?link(seq[i-1],'prev','← Předchozí'):'<span></span>'}${i<seq.length-1?link(seq[i+1],'next','Další →'):'<span></span>'}</div>`;
}

function renderDoc(d){
  if (!d){ renderHome(); return; }
  const units = S.data.units.filter(u => u.document_id === d.id && !u.navigation_only);
  const withNotes = units.filter(u => S.notes.has(u.id));
  $('#panelText').innerHTML = `<div class="crumbs">Dokument</div><h1>${esc(d.title)}</h1>
    <p>${esc(d.family)} · ${esc(LANG_NAMES[d.language]||d.language)}${d.version?' · '+esc(versionText(d.version)):''}</p>
    <div class="note">V aplikaci je zatím <strong>${units.length}</strong> ověřených částí tohoto dokumentu${S.draft?' (v pracovním náhledu i neověřené)':''}. Vyberte část v obsahu vlevo nebo použijte hledání.</div>
    ${withNotes.length ? `<div class="subparts"><h2>Části s odborným výkladem</h2><ul class="list-plain">${withNotes.map(u => `<li><a href="#/u/${encodeURIComponent(u.id)}">${esc(u.label)}<small>${esc(ancestors(u).map(a=>a.label).join(' › '))}</small></a></li>`).join('')}</ul></div>` : ''}
    ${(d.topics||[]).length ? `<div class="subparts"><h2>Témata</h2><div class="chips">${d.topics.map(t => `<span class="topic">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${sourceLine(d)}`;
  document.title = `${docShort(d)} · RegulaQuest`;
}

function renderHome(){
  const docs = S.data.documents;
  const annotated = S.data.units.filter(u => S.notes.has(u.id));
  $('#panelText').innerHTML = `<div class="hero"><div class="kicker">Výuková čtečka · FBMI ČVUT</div>
    <h1>Evropská regulace zdravotnických prostředků</h1>
    <p>Ověřené texty nařízení MDR a metodik MDCG, doplněné odbornými výklady a vazbami mezi ustanoveními. Aplikace je studijní pomůckou, ne oficiálním zdrojem práva.</p>
    <div class="cards">${docs.map(d => { const n = S.data.units.filter(u => u.document_id===d.id && !u.navigation_only).length;
      return `<a class="card" href="#/d/${encodeURIComponent(d.id)}"><strong>${esc(docShort(d))}</strong><span>${esc(d.title)}</span><em>${n} ${n===1?'část':n<5?'části':'částí'} k dispozici →</em></a>`; }).join('')}</div>
    ${annotated.length ? `<h2 class="block-title">S odborným výkladem</h2><ul class="list-plain">${annotated.map(u => { const d=S.docs.get(u.document_id); return `<li><a href="#/u/${encodeURIComponent(u.id)}">${esc(docShort(d))} › ${esc(ancestors(u).map(a=>a.label).concat(u.label).join(' › '))}<small>${esc(trim(S.notes.get(u.id)[0].body.replace(/\s+/g,' '),140))}</small></a></li>`; }).join('')}</ul>` : ''}
    <div class="source">${esc(S.data.notice||'')} Data k ${esc(fmtDate(S.data.published_at))}.</div></div>`;
  document.title = 'RegulaQuest · Čtečka regulace zdravotnických prostředků';
}
function fmtDate(s){ const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('cs-CZ'); }

/* ---------- Right panel ---------- */
function renderContext(){
  const box = $('#panelContext'); const u = S.units.get(S.unitId);
  if (!u){ box.innerHTML = `<div class="ctx-title">Souvislosti</div><div class="ctx-empty">Po výběru ustanovení se zde zobrazí odborný výklad, související články a metodiky.</div>${disclaimer()}`; $('#tabCount').textContent=''; return; }
  const notes = (S.notes.get(u.id) || []).filter(n => !HL.includes(n.kind)), rels = S.rels.get(u.id) || [];
  const byKind = (a,b) => (RQNotes.ORDER[a.kind]??5) - (RQNotes.ORDER[b.kind]??5);
  const warnings = notes.filter(n => n.kind === 'warning'), keys = notes.filter(n => n.kind === 'key');
  const explain = notes.filter(n => !['example','warning','key'].includes(n.kind)).sort(byKind), examples = notes.filter(n => n.kind === 'example');
  const other = r => S.units.get(r.source_id === u.id ? r.target_id : r.source_id);
  const typeOf = id => S.docs.get(S.units.get(id)?.document_id)?.document_type;
  const here = S.docs.get(u.document_id)?.document_type;
  const guidance = rels.filter(r => here !== 'guidance' && typeOf(other(r)?.id) === 'guidance');
  const legalBasis = rels.filter(r => here === 'guidance' && typeOf(other(r)?.id) !== 'guidance');
  const related = rels.filter(r => !guidance.includes(r) && !legalBasis.includes(r));
  const childInfo = descendantsWithText(u.id).concat(kids(u.id).filter(hasText)).filter((x,i,a)=>a.indexOf(x)===i)
    .map(c => ({c, n:(S.notes.get(c.id)||[]).filter(n => !HL.includes(n.kind)).length, r:(S.rels.get(c.id)||[]).length})).filter(x => x.n || x.r);
  const section = (title, items, fn) => items.length ? `<div class="ctx-section"><h3>${title} <span class="count">${items.length}</span></h3>${items.map(fn).join('')}</div>` : '';
  const quote = n => n.anchor_text ? `<button type="button" class="anchor-q" data-cid="${esc(n.id)}" title="Ukázat v textu">„${esc(trim(n.anchor_text, 90))}“</button>` : '';
  const noteCard = n => `<div class="ctx-card ${n.kind==='warning'?'warning':''}"><div class="meta"><span class="k">${ICON(n.kind)} ${esc(NOTE_NAMES[n.kind]||n.kind)}${n.language!==S.docs.get(u.document_id)?.language?' · '+esc(n.language.toUpperCase()):''}</span>${S.draft&&n.status!=='approved'?'<span class="chip warn">Koncept</span>':''}</div>${quote(n)}${n.kind==='key'?'':`<div class="body">${plain(n.body)}</div>`}</div>`;
  const lgroups = RQNotes.linkGroups(rels.filter(r => r.source_id === u.id && !r.mirrored));
  const relQuote = r => { if (!r.anchor_text || r.source_id !== u.id || r.mirrored) return ''; const g = lgroups.find(x => x.rels.includes(r));
    return g ? `<button type="button" class="anchor-q" data-cid="${esc(g.id)}" title="Ukázat v textu">„${esc(trim(r.anchor_text, 90))}“</button>` : ''; };
  const relCard = r => { const o = other(r); if (!o) return ''; const d = S.docs.get(o.document_id);
    return `<div class="ctx-card"><a class="ctx-link" href="#/u/${encodeURIComponent(o.id)}"><div class="meta"><span class="k">${ICON(guidance.includes(r)||legalBasis.includes(r)?'guidance':r.relation_type)} ${esc(REL_NAMES[r.relation_type]||r.relation_type)}</span>${S.draft&&r.status!=='approved'?'<span class="chip warn">Návrh</span>':''}</div><strong>${esc(o.label)}${headingOf(o)?' – '+esc(trim(headingOf(o),70)):''}</strong><small>${esc(docShort(d))}${ancestors(o).length?' › '+esc(ancestors(o).map(a=>a.label).join(' › ')):''}</small></a>${relQuote(r)}${r.rationale?`<div class="why">${esc(r.rationale)}</div>`:''}</div>`; };
  const total = notes.length + rels.length;
  box.innerHTML = `<div class="ctx-title">Souvislosti · ${esc(u.label)}</div>` +
    section('Na co si dát pozor', warnings, noteCard) +
    section('Výklad', explain, noteCard) +
    section('Metodika (výklad MDCG)', guidance, relCard) +
    section('Vykládané ustanovení předpisu', legalBasis, relCard) +
    section('Související ustanovení', related, relCard) +
    section('Příklady', examples, noteCard) +
    section('Klíčové pasáže', keys, noteCard) +
    (childInfo.length ? `<div class="ctx-section"><h3>V jednotlivých částech</h3>${childInfo.map(x => `<div class="ctx-card"><a class="ctx-link" href="#/u/${encodeURIComponent(x.c.id)}"><strong>${esc(x.c.label)}</strong><small>${[x.n?`${x.n}× výklad`:'',x.r?`${x.r}× souvislost`:''].filter(Boolean).join(' · ')}</small></a></div>`).join('')}</div>` : '') +
    (total || childInfo.length ? '' : '<div class="ctx-empty">K tomuto ustanovení zatím nejsou zveřejněné výklady ani vazby.</div>') + disclaimer();
  $('#tabCount').textContent = total ? String(total) : '';
  box.querySelectorAll('.anchor-q').forEach(b => b.onclick = () => {
    const el = document.querySelector(`#panelText [data-cid="${CSS.escape(b.dataset.cid)}"]`);
    if (!el) return;
    setTab('text', false); el.scrollIntoView({block:'center', behavior:'smooth'});
    document.querySelectorAll(`#panelText [data-cid="${CSS.escape(b.dataset.cid)}"]`).forEach(x => { x.classList.remove('rq-flash'); void x.offsetWidth; x.classList.add('rq-flash'); });
  });
}
function disclaimer(){ return '<div class="disclaimer">Výklady připravuje redakce RegulaQuest pro výuku. Nejsou právním stanoviskem; rozhodující je vždy oficiální znění předpisu.</div>'; }

RQAuth.start({
  app: 'ctecka', require: 'member', title: 'Čtečka regulace zdravotnických prostředků',
  subtitle: 'Přihlaste se jménem a heslem z lístečku od vyučujícího.',
  onReady(rq){
    const tpl = document.getElementById('readerTpl');
    document.getElementById('app').replaceWith(tpl.content.cloneNode(true));
    load(rq);
  }
});
