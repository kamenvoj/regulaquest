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
  terms:[], off:loadOff(), focus:null, role:loadRole(), tagNames:new Map(), paths:[], path:null,
  area:(()=>{ try { return localStorage.getItem('rq-oblast') || ''; } catch { return ''; } })(),
  view:'home', me:{ marks:[], positions:[], progress:[] }, newUnits:new Map(), docFilter:'all', docQuery:'', termQuery:'',
  docId:null, unitId:null, query:'', highlight:'', expanded:new Set(), tab:'text'
};

/* ---------- Data ---------- */
function loadOff(){ try { const v = JSON.parse(localStorage.getItem('rq-vrstvy-skryte')); if (Array.isArray(v)) return new Set(v); } catch {} return new Set(['duty','deadline','exception']); }
function loadRole(){ try { return localStorage.getItem('rq-stitek') || ''; } catch { return ''; } }
const roleName = k => S.tagNames.get(k) || k;
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
  await loadMe();
  if (typeof loadNews === 'function') await loadNews();
  if (typeof loadLinks === 'function') await loadLinks();
  if (typeof loadPresentations === 'function') await loadPresentations();
  route();
  window.addEventListener('hashchange', route);
}

/* Osobní data čtenáře (záložky, kde skončil, prošlé kroky tras) – u účtu, vidí je jen on. */
async function loadMe(){
  try { const { data, error } = await RQ.client.rpc('rq_my_reader_state'); if (!error && data) S.me = data; } catch {}
}
async function meCall(fn, args){
  try { const { data, error } = await RQ.client.rpc(fn, args); if (error) throw new Error(error.message); return data ?? true; }
  catch(e){ toast(RQ.czError ? RQ.czError(e) : e.message); return null; }
}
function toast(msg){
  let t = document.getElementById('rqToast');
  if (!t){ t = document.createElement('div'); t.id = 'rqToast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3200);
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
  S.paths = (d.paths || []).filter(p => p.steps.length);
  d.comments.forEach(c => { if (!S.notes.has(c.unit_id)) S.notes.set(c.unit_id, []); S.notes.get(c.unit_id).push(c); });

  // Odkaz na pracovní náhled otevřel student: vysvětlit, proč vidí jen publikovaný obsah.
  const deniedDraft = wantsDraft() && !S.draft;
  if (deniedDraft) $('#draftBanner').textContent = 'Pracovní náhled je jen pro redakci. Zobrazuje se publikovaný obsah pro studenty.';
  document.body.classList.toggle('has-banner', S.draft || deniedDraft);
  $('#draftBanner').classList.toggle('hidden', !(S.draft || deniedDraft));
  let timer;
  $('#search').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { const q = e.target.value.trim(); if (q.length >= 2) go('#/hledat/' + encodeURIComponent(q)); }, 300); };
  $('#searchForm').onsubmit = e => { e.preventDefault(); const q = $('#search').value.trim(); if (q) go('#/hledat/' + encodeURIComponent(q)); };
  document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  (d.tags || []).forEach(t => S.tagNames.set(t.key, t.name));
  // Nově změněné části z poslední publikace (značka NOVÉ v osnově 14 dní)
  const last = (d.history || [])[0];
  if (last && Date.now() - new Date(last.published_at) < 14 * 864e5) (Array.isArray(last.changes?.items) ? last.changes.items : []).forEach(i => S.newUnits.set(i.unit_id, i.what));
  const seen = +(localStorage.getItem('rq-novinky-videno') || 0);
  $('#navNews').classList.toggle('hidden', !last || last.id <= seen || !!last.changes?.first);
  // Osnova a kroky trasy mají vlastní panel; navigace se při čtení zúží na pruh ikon.
  $('#railOpen').onclick = () => { const on = !document.body.classList.contains('rail-open'); document.body.classList.toggle('rail-open', on); $('#railOpen').setAttribute('aria-expanded', on); };
  const setOutline = off => { try { localStorage.setItem('rq-osnova-skryta', off ? '1' : ''); } catch {} layoutPanels(); };
  $('#railOutline').onclick = () => setOutline(!outlineOff());
  $('#outlineClose').onclick = () => setOutline(true);
  const help = () => window.RQReaderHelp && RQReaderHelp.open(S.view);
  $('#helpBtn').onclick = help; $('#navHelp').onclick = help;
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
  document.body.classList.remove('rail-open'); $('#railOpen')?.setAttribute('aria-expanded', false);
  S.focus = null; S.path = null; S.unitId = null;
  const raw = location.hash.slice(1), h = decodeURIComponent(raw) || '/';
  let m;
  if (/^\/najit(\?|$)/.test(raw)){ S.view = 'finder'; finderParse(raw.split('?')[1]); }
  else if (raw === '/pruvodce'){ S.view = 'guide'; G.pos = 0; }
  else if ((m = h.match(/^\/t\/([^/]+)(?:\/(\d+))?$/)) && S.paths.find(x => x.id === m[1])){
    const p = S.paths.find(x => x.id === m[1]);
    const n = Math.min(+(m[2] || 0), p.steps.length), st = n ? p.steps[n-1] : null;
    S.path = { p, n }; S.view = 'path';
    S.unitId = st && st.unit_id && S.units.has(st.unit_id) ? st.unit_id : null;
    if (S.unitId){ S.docId = S.units.get(S.unitId).document_id; ancestors(S.units.get(S.unitId)).forEach(a => S.expanded.add(a.id)); }
    if (n) markDone(p.id, st.id);
  }
  else if ((m = h.match(/^\/u\/(.+)$/)) && S.units.has(m[1])){ S.view = 'unit'; S.unitId = m[1]; S.docId = S.units.get(m[1]).document_id; ancestors(S.units.get(S.unitId)).forEach(a => S.expanded.add(a.id)); }
  else if ((m = h.match(/^\/d\/(.+)$/)) && S.docs.has(m[1])){ S.view = 'doc'; S.docId = m[1]; }
  else if ((m = h.match(/^\/pripad\/(.+)$/))){ S.view = 'case'; S.caseId = m[1]; }
  else if ((m = h.match(/^\/prezentace\/([^/]+)(?:\/([^/]+))?$/))){ S.view = 'pres'; if (PR.id !== m[1]) { PR.hist = []; PR.grid = false; } PR.id = m[1]; PR.slide = m[2] || null; }
  else if ((m = h.match(/^\/hledat\/(.+)$/))){ S.view = 'search'; S.query = m[1]; if ($('#search').value.trim() !== S.query) $('#search').value = S.query; }
  else S.view = ({'/dokumenty':'docs', '/trasy':'paths', '/pojmy':'terms', '/zalozky':'marks', '/novinky':'news', '/aktuality':'updates', '/pripady':'cases', '/odkazy':'links', '/prezentace':'prlist'})[h] || 'home';
  if (S.view !== 'search' && document.activeElement !== $('#search')) { $('#search').value = ''; S.query = ''; }
  if (typeof PR !== 'undefined' && !['unit', 'pres'].includes(S.view)) PR.back = null;
  render();
  setTab('text', false);
}

function setTab(t, scroll=true){
  S.tab = t; document.body.dataset.tab = t;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (scroll) window.scrollTo(0,0);
}

function render(){
  const v = S.view, reading = v === 'unit' || v === 'doc' || (v === 'path' && S.unitId);
  document.querySelectorAll('.appnav [data-nav]').forEach(x => x.classList.toggle('on',
    x.dataset.nav === ({home:'home', docs:'docs', doc:'docs', unit:'docs', search:'docs', finder:'finder', guide:'finder', paths:'paths', path:'paths', terms:'terms', marks:'marks', news:'news', updates:'updates', cases:'cases', case:'cases', links:'links', prlist:'prlist', pres:'prlist'})[v]));
  $('#navMarks').textContent = S.me.marks.filter(m => !m.unit_id.startsWith('doc:')).length || '';
  renderNav();
  renderPathNav();
  layoutPanels();
  document.body.classList.toggle('no-ctx', !(v === 'unit' || (v === 'path' && S.unitId)));
  if (v === 'path') renderStep();
  else if (v === 'unit'){ renderUnit(S.units.get(S.unitId)); if (typeof caseBackBar === 'function') caseBackBar(S.units.get(S.unitId)); if (typeof presBackBar === 'function') presBackBar(S.units.get(S.unitId)); }
  else if (v === 'doc') renderDoc(S.docs.get(S.docId));
  else if (v === 'docs') renderDocs();
  else if (v === 'paths') renderPaths();
  else if (v === 'terms') renderTerms();
  else if (v === 'marks') renderMarks();
  else if (v === 'news') renderNews();
  else if (v === 'updates') renderUpdates();
  else if (v === 'cases') renderCases();
  else if (v === 'links') renderLinks();
  else if (v === 'prlist') renderPresList();
  else if (v === 'pres') renderPres();
  else if (v === 'case') renderCase(caseOf(S.caseId));
  else if (v === 'search') renderSearch();
  else if (v === 'finder') renderFinder();
  else if (v === 'guide') renderGuide();
  else renderHome();
  renderContext();
  $('#panelText').scrollTop = 0; window.scrollTo(0, 0);
  const cur = document.querySelector('.node a.current');
  if (cur && reading) cur.scrollIntoView({block:'nearest'});
}

function outlineOff(){ try { return localStorage.getItem('rq-osnova-skryta') === '1'; } catch { return false; } }
function layoutPanels(){
  const has = !$('#navDoc').classList.contains('hidden') || !$('#navPath').classList.contains('hidden');
  const b = document.body;
  b.classList.toggle('has-outline', has);
  b.classList.toggle('outline-off', has && outlineOff());
  if (!has) b.classList.remove('rail-open');
  $('#railOutline').setAttribute('aria-pressed', has && !outlineOff());
  $('#railOutline').title = outlineOff() ? 'Zobrazit osnovu' : 'Skrýt osnovu';
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
/* Osnova otevřeného dokumentu pod položkou Dokumenty (s přepínačem jazyka a filtrem štítků). */
function renderNav(){
  const box = $('#navDoc'), doc = S.docs.get(S.docId);
  const show = doc && ['doc', 'unit', 'search'].includes(S.view);
  box.classList.toggle('hidden', !show);
  if (!show){ box.innerHTML = ''; return; }
  const sib = groupDocs(doc);
  const used = new Set(S.data.units.filter(u => u.document_id === doc.id).flatMap(u => u.tags || []));
  if (S.role && !used.has(S.role)) S.role = '';
  const tagOpts = (S.data.tag_groups || []).map(g => { const ts = (S.data.tags || []).filter(t => t.group_key === g.key && used.has(t.key));
    return ts.length ? `<optgroup label="${esc(g.name)}">${ts.map(t => `<option value="${esc(t.key)}" ${t.key===S.role?'selected':''}>${esc(t.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
  const top = roleFilter(kids('doc:' + doc.id));
  const groups = doc.document_type === 'regulation'
    ? [['Články', top.filter(u => u.kind === 'article')], ['Přílohy', top.filter(u => u.kind === 'annex')], ['Ostatní', top.filter(u => !['article','annex'].includes(u.kind))]]
    : [['Obsah', top]];
  box.innerHTML = `<div class="nd-head"><a href="#/d/${encodeURIComponent(doc.id)}" class="nd-title">${esc(docTitle(doc))}</a>
    ${sib.length > 1 ? `<span class="langs" role="group" aria-label="Jazyk dokumentu">${sib.map(x => `<a class="lang ${x.id===doc.id?'on':''}" href="${langHref(x)}" title="${esc(LANG_NAMES[x.language]||x.language)}">${esc(x.language.toUpperCase())}</a>`).join('')}</span>` : ''}</div>
    ${used.size ? `<label class="role-pick"><span>Jen:</span><select id="roleSelect" aria-label="Zobrazit jen ustanovení se štítkem"><option value="">Všechna ustanovení</option>${tagOpts}</select></label>` : ''}
    ${S.role && !top.length ? `<div class="nav-empty">V tomto dokumentu nejsou ustanovení se štítkem „${esc(roleName(S.role))}“.</div>` : ''}
    ${groups.filter(g => g[1].length).map(([name, list]) => `<div class="nav-group">${esc(name)}</div>${tree(list)}`).join('')}`;
  box.querySelectorAll('.caret').forEach(b => b.onclick = () => { const id=b.dataset.id; S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); renderNav(); });
  const rs = box.querySelector('#roleSelect');
  if (rs) rs.onchange = () => { S.role = rs.value; try { localStorage.setItem('rq-stitek', S.role); } catch {} renderNav(); const u = S.units.get(S.unitId); if (u && S.view === 'unit') renderUnit(u); };
}
/* Jazykové verze téhož dokumentu; přepnutí jazyka vede na stejné ustanovení, pokud je otevřené. */
function groupDocs(d){ return [...S.docs.values()].filter(x => (x.group_key || x.id) === (d.group_key || d.id)).sort((a, b) => (a.language === 'cs' ? 0 : 1) - (b.language === 'cs' ? 0 : 1)); }
function langHref(x){ const u = S.units.get(S.unitId); if (u && u.document_id !== x.id){ const e = equivalentIn(u, x.id); if (e) return '#/u/' + encodeURIComponent(e.id); } return '#/d/' + encodeURIComponent(x.id); }
const docTitle = d => d.short_title || d.family;
/* Pohled podle štítku: ustanovení se štítkem, jejich nadřazené části a celé podřazené části. */
const hasRole = u => (u.tags || []).includes(S.role);
function roleHit(u){ if (hasRole(u)) return true; return kids(u.id).some(roleHit); }
const inRoleBranch = u => ancestors(u).some(hasRole);
function roleFilter(list){ return S.role ? list.filter(u => roleHit(u) || inRoleBranch(u)) : list; }
function tree(list){
  return `<ul class="tree">${list.map(u => {
    const ch = roleFilter(kids(u.id)), open = S.expanded.has(u.id) || S.unitId === u.id;
    const marks = outlineMarks(u);
    const heading = headingOf(u) ? `<span class="h">${esc(trim(headingOf(u),60))}</span>` : '';
    return `<li><div class="node">${ch.length ? `<button class="caret" data-id="${esc(u.id)}" aria-label="${open?'Sbalit':'Rozbalit'}" aria-expanded="${open}">${open?'▼':'▶'}</button>` : '<span class="caret-space"></span>'}
      <a href="#/u/${encodeURIComponent(u.id)}" class="${u.id===S.unitId?'current':''} ${u.navigation_only?'locked':''} ${S.role&&!hasRole(u)&&!inRoleBranch(u)?'role-dim':''}">${esc(u.label)}${marks}${isNew(u)?`<span class="newb" title="${esc(S.newUnits.get(u.id) || 'změna v poslední aktualizaci')}">NOVÉ</span>`:''}${heading}</a></div>
      ${ch.length && open ? tree(ch) : ''}</li>`;
  }).join('')}</ul>`;
}
function isNew(u){ if (S.newUnits.has(u.id)) return true; return kids(u.id).some(isNew); }
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

function renderSearch(){
  const q = S.query, ts = terms(q), box = $('#panelText');
  const hits = ts.length ? S.data.units.filter(u => { if (u.navigation_only) return false; const f = fold([u.label,u.heading,u.locator,u.body].join(' ')); return ts.every(t => f.includes(t)); }) : [];
  const nhits = ts.length ? S.data.comments.filter(c => !['key',...HL].includes(c.kind) && ts.every(t => fold(c.body).includes(t))) : [];
  const termHits = ts.length ? S.terms.filter(t => ts.every(x => fold(t.name).includes(x))) : [];
  hits.sort((a,b) => (a.document_id===S.docId?0:1)-(b.document_id===S.docId?0:1) || (kids(a.id).length?1:0)-(kids(b.id).length?1:0));
  const shown = hits.slice(0, 80);
  box.innerHTML = `<div class="eyebrow">Hledání</div><h1>„${esc(q)}“</h1>
    <p class="lead">${hits.length ? `V textech: ${hits.length}${hits.length > 80 ? ' (zobrazeno 80)' : ''}` : 'V textech nic nenalezeno.'}${nhits.length ? ` · ve výkladech: ${nhits.length}` : ''}${termHits.length ? ` · pojmy: ${termHits.length}` : ''}. Hledá se ve všech dokumentech; zkuste i jiný jazyk.</p>
    ${termHits.length ? `<h2 class="block-title">Pojmy</h2><div class="results">${termHits.slice(0, 8).map(t => `<a class="result" href="#/pojmy" data-term="${esc(t.name)}"><strong>${esc(t.name)}</strong><small>definice · ${esc(LANG_NAMES[t.language]||t.language)}</small></a>`).join('')}</div>` : ''}
    ${shown.length ? `<h2 class="block-title">V textech</h2><div class="results">${shown.map(u => { const d=S.docs.get(u.document_id);
      return `<a class="result" href="#/u/${encodeURIComponent(u.id)}" data-hl="1"><strong>${esc(u.label)}${headingOf(u)?' – '+esc(trim(headingOf(u),60)):''}</strong><small>${esc(docShort(d))}${ancestors(u).length?' › '+esc(ancestors(u).map(a=>a.label).join(' › ')):''}</small><small class="snip">${snippet(u.body,q)}</small></a>`; }).join('')}</div>` : ''}
    ${nhits.length ? `<h2 class="block-title">Ve výkladech redakce</h2><div class="results">${nhits.slice(0, 30).map(c => { const u = S.units.get(c.unit_id); if (!u) return ''; const d = S.docs.get(u.document_id);
      return `<a class="result" href="#/u/${encodeURIComponent(u.id)}"><strong>${esc(NOTE_NAMES[c.kind]||'Výklad')} · ${esc(u.label)}</strong><small>${esc(docShort(d))}</small><small class="snip">${snippet(c.body, q)}</small></a>`; }).join('')}</div>` : ''}`;
  box.querySelectorAll('.result[data-hl]').forEach(a => a.addEventListener('click', () => { S.highlight = S.query; }));
  box.querySelectorAll('.result[data-term]').forEach(a => a.addEventListener('click', () => { S.termQuery = a.dataset.term; }));
  document.title = `Hledání: ${q} · RegulaQuest`;
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
  html += markBox(u);
  const known = k => S.tagNames.has(k);
  const own = (u.tags || []).filter(known), inh = own.length ? [] : [...new Set(ancestors(u).flatMap(a => a.tags || []))].filter(known);
  if (own.length || inh.length) html += `<div class="roles-row"><span>Štítky:</span>${(own.length ? own : inh).map(k => `<span class="role-chip${k===S.role?' on':''}">${esc(roleName(k))}</span>`).join('')}${inh.length ? '<small>(podle nadřazené části)</small>' : ''}</div>`;
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
  $('#panelText').classList.remove('focus-mode');
  if (q) document.querySelectorAll('#panelText .rich').forEach(el => markDom(el, q));
  const nTerms = markTerms(d);
  anchorNotes();
  layerBar(u, nTerms);
  if (S.focus){
    const panel = $('#panelText'), el = RQNotes.applyFocus(panel, S.focus.id);
    panel.querySelector('.legal')?.before(RQNotes.focusChip(S.focus.kind, S.focus.label, () => setFocus(null)));
    if (el) requestAnimationFrame(() => el.scrollIntoView({block:'center', behavior:'smooth'}));
  }
  resolveFigures();
  bindMarkBox(u);
  savePosition(u);
  document.title = `${u.label} · ${docShort(d)} · RegulaQuest`;
}

/* ---------- Záložky a pozice (u účtu) ---------- */
const markOf = id => S.me.marks.find(m => m.unit_id === id);
function markBox(u){
  const m = markOf(u.id);
  return `<div class="markbox" id="markBox">${m
    ? `<span class="marked">${ICON_MARK(true)} V záložkách${m.label ? `: <strong>${esc(m.label)}</strong>` : ''}</span><button type="button" class="mini" data-mk="edit">Upravit popisek</button><button type="button" class="mini" data-mk="del">Odebrat</button>`
    : `<button type="button" class="mini" data-mk="add">${ICON_MARK(false)} Přidat záložku</button>`}</div>`;
}
const ICON_MARK = on => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
function bindMarkBox(u){
  const box = $('#markBox'); if (!box) return;
  const m = markOf(u.id);
  const form = () => { box.innerHTML = `<label class="sr" for="mkLabel">Popisek záložky</label><input id="mkLabel" maxlength="80" placeholder="Popisek, např. PMCF u třídy I" value="${esc(m?.label || headingOf(u) || '')}"><button type="button" class="mini acc" id="mkSave">Uložit záložku</button><button type="button" class="mini" id="mkCancel">Zrušit</button>`;
    const inp = box.querySelector('#mkLabel'); inp.focus(); inp.select();
    const save = async () => { const id = await meCall('rq_save_mark', { p_unit_id: u.id, p_label: inp.value });
      if (id != null){ const ex = markOf(u.id); if (ex) ex.label = inp.value.trim(); else S.me.marks.unshift({ id, unit_id: u.id, label: inp.value.trim(), created_at: new Date().toISOString() });
        toast('Záložka uložena.'); refreshMarkBox(u); } };
    box.querySelector('#mkSave').onclick = save; inp.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') refreshMarkBox(u); };
    box.querySelector('#mkCancel').onclick = () => refreshMarkBox(u); };
  box.querySelectorAll('[data-mk]').forEach(b => b.onclick = async () => {
    if (b.dataset.mk === 'del'){ if (await meCall('rq_delete_mark', { p_id: m.id }) !== null){ S.me.marks = S.me.marks.filter(x => x.id !== m.id); toast('Záložka odebrána.'); refreshMarkBox(u); } }
    else form(); });
}
function refreshMarkBox(u){ const box = $('#markBox'); if (!box) return; box.outerHTML = markBox(u); bindMarkBox(u); $('#navMarks').textContent = S.me.marks.filter(m => !m.unit_id.startsWith('doc:')).length || ''; }
let posTimer;
function savePosition(u){
  const d = S.docs.get(u.document_id), g = d.group_key || d.id;
  const ex = S.me.positions.find(p => p.doc_group === g);
  if (ex){ ex.unit_id = u.id; ex.updated_at = new Date().toISOString(); } else S.me.positions.unshift({ doc_group: g, unit_id: u.id, updated_at: new Date().toISOString() });
  S.me.positions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  clearTimeout(posTimer); posTimer = setTimeout(() => { RQ.client.rpc('rq_set_position', { p_doc_group: g, p_unit_id: u.id }).then(() => {}, () => {}); }, 1500);
}

/* Poznámky ukotvené k textu: podtržení + ikonka; klepnutím se poznámka rozbalí přímo pod řádkem. */
function anchorItems(id){
  const links = RQNotes.linkGroups((S.rels.get(id) || []).filter(r => r.source_id === id && !r.mirrored));
  return (S.notes.get(id) || []).filter(c => c.anchor_text).concat(links);
}
function anchorNotes(){
  if (!window.RQNotes) return;
  document.querySelectorAll('#panelText .legal').forEach(box => {
    const id = box.dataset.unit; if (!id) return;
    RQNotes.applyAnchors(box, anchorItems(id).filter(c => !S.off.has(RQNotes.layerOf(c.kind)) || c.id === S.focus?.id), toggleNote);
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
  const all = ids.flatMap(anchorItems), cnt = k => all.filter(c => RQNotes.layerOf(c.kind) === k).length;
  const items = [...RQNotes.LAYERS, 'note', 'warning', 'link'].map(k => [k, cnt(k)]).concat([['term', nTerms]]).filter(x => x[1]);
  const panel = $('#panelText');
  RQNotes.CSS_LAYERS.forEach(k => panel.classList.toggle('off-' + k, S.off.has(k)));
  if (!items.length) return;
  const bar = RQNotes.layerBar(items, S.off, k => {
    saveOff();
    if (RQNotes.CSS_LAYERS.includes(k)) { panel.classList.toggle('off-' + k, S.off.has(k)); return; }
    const y = window.scrollY, py = panel.scrollTop; renderUnit(u); window.scrollTo(0, y); panel.scrollTop = py;
  });
  panel.querySelector('.legal').before(bar);
}
/* Zaměření z panelu Souvislosti: v textu výrazně jen vybraná položka (i když je její vrstva vypnutá). */
function setFocus(f){
  const u = S.units.get(S.unitId); if (!u) return;
  S.focus = f && S.focus?.id === f.id ? null : f;
  const y = window.scrollY, py = $('#panelText').scrollTop;
  renderUnit(u); renderContext();
  if (S.focus) setTab('text', false); else { window.scrollTo(0, y); $('#panelText').scrollTop = py; }
}
function noteHtml(c){
  if (c.kind === 'link') return `<span class="rq-pop-h">${ICON('link')} Propojeno</span>` + c.rels.map(r => { const o = S.units.get(r.target_id); if (!o) return ''; const d = S.docs.get(o.document_id);
      return `<a class="lk" href="#/u/${encodeURIComponent(o.id)}"><strong>${esc(o.label)}${headingOf(o)?' – '+esc(trim(headingOf(o),60)):''}</strong><small>${esc(REL_NAMES[r.relation_type]||'')} · ${esc(docShort(d))}${ancestors(o).length?' › '+esc(ancestors(o).map(a=>a.label).join(' › ')):''}</small></a>${r.rationale?`<span class="why">${esc(r.rationale)}</span>`:''}`; }).join('');
  return `<span class="rq-pop-h">${ICON(c.kind)} ${esc(NOTE_NAMES[c.kind]||c.kind)}${S.draft&&c.status!=='approved'?' · koncept':''}</span>${esc(c.body).replace(/\n/g,'<br>')}`;
}
function toggleNote(c, mk){
  const open = document.querySelector(`.rq-pop[data-cid="${CSS.escape(c.id)}"]`);
  document.querySelectorAll('.rq-pop').forEach(p => p.remove());
  if (open) return;
  const pop = document.createElement('span');
  const items = c.kind === 'group' ? c.items : [c];
  pop.className = 'rq-pop' + (items.some(x => x.kind === 'warning') ? ' warn' : ''); pop.dataset.cid = c.id; pop.dataset.noAnchor = '1';
  pop.innerHTML = items.length > 1 ? items.map(x => `<span class="grp">${noteHtml(x)}</span>`).join('') : noteHtml(c);
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
  const withNotes = units.filter(u => (S.notes.get(u.id) || []).some(c => !['key', ...HL].includes(c.kind)));
  const upd = (S.data.doc_updated || {})[d.id];
  const pos = S.me.positions.find(p => p.doc_group === (d.group_key || d.id));
  const pu = pos && S.units.get(pos.unit_id);
  $('#panelText').innerHTML = `<div class="eyebrow">${esc(DOC_KIND[d.document_type] || 'Dokument')} · ${esc(LANG_NAMES[d.language]||d.language)}</div><h1>${esc(docTitle(d))}</h1>
    <p class="lead">${esc(d.title)}${d.version?' · '+esc(versionText(d.version)):''}</p>
    <div class="facts">${upd ? `<span class="fact">Aktualizováno ${esc(fmtDate(upd))}</span>` : ''}<span class="fact">${units.length} ověřených částí${S.draft?' (v náhledu i neověřené)':''}</span>${withNotes.length ? `<span class="fact">${withNotes.length} částí s výkladem</span>` : ''}</div>
    ${areasOf(d.group_key || d.id).length ? `<div class="area-tags">${areasOf(d.group_key || d.id).map(x => `<span class="atag ${x.role}" title="${esc(x.note || '')}">${esc((S.data.areas || []).find(a => a.key === x.area_key)?.name || x.area_key)} · ${esc(ROLE_ONE[x.role])}${x.note ? ` – ${esc(x.note)}` : ''}</span>`).join('')}</div>` : ''}
    ${pu && pu.document_id === d.id ? `<p><a class="btn acc" href="#/u/${encodeURIComponent(pu.id)}">Pokračovat: ${esc(pu.label)}</a></p>` : ''}
    <div class="note">Vyberte část v osnově vlevo nebo použijte hledání nahoře.</div>
    ${withNotes.length ? `<div class="subparts"><h2>Části s odborným výkladem</h2><ul class="list-plain">${withNotes.slice(0, 40).map(u => `<li><a href="#/u/${encodeURIComponent(u.id)}">${esc(u.label)}${headingOf(u)?' – '+esc(trim(headingOf(u),60)):''}<small>${esc(ancestors(u).map(a=>a.label).join(' › '))}</small></a></li>`).join('')}</ul></div>` : ''}
    ${(d.topics||[]).length ? `<div class="subparts"><h2>Témata</h2><div class="chips">${d.topics.map(t => `<span class="topic">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${sourceLine(d)}`;
  document.title = `${docTitle(d)} · RegulaQuest`;
}

/* ---------- Trasy ---------- */
function doneSet(pid){
  const out = new Set(S.me.progress.filter(x => x.path_id === pid).map(x => x.step_id));
  try { (JSON.parse(localStorage.getItem('rq-trasy-hotovo')) || {})[pid]?.forEach(x => out.add(x)); } catch {}
  return out;
}
function doneMap(){ const m = {}; S.paths.forEach(p => m[p.id] = [...doneSet(p.id)]); return m; }
function markDone(pid, sid){
  if (doneSet(pid).has(sid)) return;
  S.me.progress.push({ path_id: pid, step_id: sid });
  RQ.client.rpc('rq_step_done', { p_path_id: pid, p_step_id: sid }).then(() => {}, () => {});
}
function progress(p){ const d = doneSet(p.id); return p.steps.filter(s => d.has(s.id)).length; }
function stepLabel(s){ const u = s.unit_id && S.units.get(s.unit_id); return s.title || (u ? `${docShort(S.docs.get(u.document_id))} › ${u.label}${headingOf(u) ? ' – ' + trim(headingOf(u), 50) : ''}` : 'Text'); }
const pl = (n, a, b, c) => n ? `${n} ${n === 1 ? a : n >= 2 && n <= 4 ? b : c}` : '';
const kroku = n => `${n} ${n===1?'krok':n>=2&&n<=4?'kroky':'kroků'}`;
/* Kroky otevřené trasy pod položkou Trasy v levém panelu. */
function renderPathNav(){
  const box = $('#navPath'), P = S.path?.p;
  box.classList.toggle('hidden', !P);
  if (!P){ box.innerHTML = ''; return; }
  const done = doneSet(P.id);
  box.innerHTML = `<div class="nd-head"><a class="nd-title" href="#/t/${encodeURIComponent(P.id)}">${esc(P.title)}</a></div>
    <ol class="path-steps">${P.steps.map((st, i) => `<li class="${S.path.n===i+1?'current':''} ${done.has(st.id)?'done':''}"><a href="#/t/${encodeURIComponent(P.id)}/${i+1}">${esc(stepLabel(st))}</a></li>`).join('')}</ol>`;
}
function pathCard(p){
  const k = progress(p), n = p.steps.length;
  return `<a class="card path" href="#/t/${encodeURIComponent(p.id)}${k && k < n ? '/' + Math.min(n, k + 1) : ''}"><strong>${esc(p.title)}</strong><span>${esc(trim(p.description || '', 120))}</span>
    <i class="pbar"><b style="width:${Math.round(k/n*100)}%"></b></i><em>${k === n ? 'Hotovo ✓' : k ? `Prošli jste ${k} z ${n}` : kroku(n)}</em></a>`;
}
function renderPaths(){
  $('#panelText').innerHTML = `<div class="eyebrow">Trasy</div><h1>Trasy</h1>
    <p class="lead">Průchody několika místy předpisů a metodik k jednomu tématu, s komentářem redakce ke každému kroku. Prošlé kroky se ukládají k vašemu účtu.</p>
    ${S.paths.length ? `<div class="cards">${S.paths.map(pathCard).join('')}</div>` : '<div class="empty">Redakce zatím nezveřejnila žádnou trasu.</div>'}`;
  document.title = 'Trasy · RegulaQuest';
}
function renderStep(){
  const { p, n } = S.path, panel = $('#panelText'), st = n ? p.steps[n-1] : null;
  const head = `<div class="path-box"><div class="pb-top"><a href="#/t/${encodeURIComponent(p.id)}" class="pb-title">⇢ ${esc(p.title)}</a><span>${n ? `Krok ${n} z ${p.steps.length}` : `${p.steps.length} ${p.steps.length===1?'krok':p.steps.length<5?'kroky':'kroků'}`}</span></div>
    <div class="pb-dots">${p.steps.map((s, i) => `<a href="#/t/${encodeURIComponent(p.id)}/${i+1}" class="${i+1===n?'on':''} ${(doneMap()[p.id]||[]).includes(s.id)?'done':''}" title="${esc(stepLabel(s))}"></a>`).join('')}</div>
    ${st ? `${st.title ? `<h2>${esc(st.title)}</h2>` : ''}${st.note ? `<div class="pb-note">${plain(st.note)}</div>` : ''}` : ''}</div>`;
  const nav = `<div class="pager path-pager">${n > 0 ? `<a class="prev" href="#/t/${encodeURIComponent(p.id)}/${n-1}"><small>← Zpět</small>${n-1 ? esc(stepLabel(p.steps[n-2])) : 'Úvod trasy'}</a>` : '<span></span>'}
    ${n < p.steps.length ? `<a class="next" href="#/t/${encodeURIComponent(p.id)}/${n+1}"><small>${n ? 'Další krok →' : 'Začít trasu →'}</small>${esc(stepLabel(p.steps[n]))}</a>` : `<a class="next" href="#/t/${encodeURIComponent(p.id)}"><small>Hotovo ✓</small>Zpět na přehled trasy</a>`}</div>`;
  if (!n){
    panel.innerHTML = head + `<div class="path-intro">${p.description ? `<div class="pb-note">${plain(p.description)}</div>` : ''}
      <ol class="path-overview">${p.steps.map((s, i) => `<li class="${(doneMap()[p.id]||[]).includes(s.id)?'done':''}"><a href="#/t/${encodeURIComponent(p.id)}/${i+1}">${esc(stepLabel(s))}</a></li>`).join('')}</ol></div>` + nav;
    document.title = `${p.title} · RegulaQuest`; return;
  }
  const u = S.unitId && S.units.get(S.unitId);
  if (!u){ panel.innerHTML = head + nav; document.title = `${p.title} · RegulaQuest`; return; }
  renderUnit(u);
  panel.querySelector('.pager')?.remove();
  panel.insertAdjacentHTML('afterbegin', head);
  const src = panel.querySelector('.source');
  if (src) src.insertAdjacentHTML('beforebegin', nav); else panel.insertAdjacentHTML('beforeend', nav);
  if (st.anchor_text){
    const box = panel.querySelector(`.legal[data-unit="${CSS.escape(u.id)}"]`);
    if (box){
      RQNotes.applyAnchors(box, [{ id: 'STEP', kind: 'key', anchor_text: st.anchor_text, anchor_occurrence: st.anchor_occurrence }], () => {});
      const el = RQNotes.applyFocus(panel, 'STEP');
      if (el){ box.before(RQNotes.focusChip('route', 'místo, na které trasa míří', () => panel.classList.remove('focus-mode'))); requestAnimationFrame(() => el.scrollIntoView({block:'center', behavior:'smooth'})); }
    }
  }
  document.title = `${p.title} – krok ${n} · RegulaQuest`;
}
/* ---------- Přehled a stránky ---------- */
function docGroups(){
  const m = new Map();
  S.data.documents.forEach(d => { const k = d.group_key || d.id; if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
  return [...m.entries()].map(([key, ds]) => { ds.sort((a, b) => (a.language === 'cs' ? 0 : 1) - (b.language === 'cs' ? 0 : 1));
    return { key, docs: ds, main: ds[0], featured: ds.some(d => d.featured), sort: Math.min(...ds.map(d => d.featured_sort ?? 100)) }; });
}
const docUpdated = g => g.docs.map(d => (S.data.doc_updated || {})[d.id]).filter(Boolean).sort().pop();
function docCard(g, label, note){
  const n = g.docs.reduce((a, d) => a + S.data.units.filter(u => u.document_id === d.id && !u.navigation_only).length, 0);
  const ids = new Set(S.data.units.filter(u => g.docs.some(d => d.id === u.document_id)).map(u => u.id));
  const notes = S.data.comments.filter(c => ids.has(c.unit_id) && !['key', ...HL].includes(c.kind)).length;
  const pinned = S.me.marks.some(m => m.unit_id === 'doc:' + g.key), upd = docUpdated(g);
  return `<div class="card doccard"><div class="dc-top"><span class="kind">${esc(label || DOC_KIND[g.main.document_type] || 'Dokument')}</span>
      <button type="button" class="pin${pinned ? ' on' : ''}" data-pin="${esc(g.key)}" aria-pressed="${pinned}" title="${pinned ? 'Odepnout z Přehledu' : 'Připnout na Přehled'}">${pinned ? '★' : '☆'}</button></div>
    <a class="dc-title" href="#/d/${encodeURIComponent(g.main.id)}">${esc(docTitle(g.main))}</a>
    <div class="muted">${esc(trim(g.main.title, 120))}</div>
    ${note ? `<div class="situ"><strong>Kdy:</strong> ${esc(note)}</div>` : ''}
    <div class="facts">${upd ? `<span class="fact">Aktualizováno ${esc(fmtDate(upd))}</span>` : ''}<span class="fact">${n} ${n===1?'část':n<5?'části':'částí'}</span>${notes ? `<span class="fact">${notes} výkladů</span>` : ''}</div>
    <div class="dc-langs">${g.docs.map(d => `<a class="btn small${d === g.main ? ' acc' : ''}" href="#/d/${encodeURIComponent(d.id)}">${g.docs.length > 1 ? esc(LANG_NAMES[d.language] || d.language) : 'Otevřít'}</a>`).join('')}</div></div>`;
}
const AREA_ROLES = { core:'Hlavní předpisy', guidance:'Metodiky a výklady', supplementary:'Doplňkové předpisy', situational:'Pro specifické situace' };
const ROLE_ONE = { core:'hlavní předpis', guidance:'metodika', supplementary:'doplňkový předpis', situational:'pro specifické situace' };
const areasOf = gk => (S.data.document_areas || []).filter(x => x.group_key === gk);
const usedAreas = () => (S.data.areas || []).filter(a => (S.data.document_areas || []).some(x => x.area_key === a.key && docGroups().some(g => g.key === x.group_key)));
function setArea(k){ S.area = k; try { localStorage.setItem('rq-oblast', k); } catch {} }
const DOC_KIND = { regulation:'Nařízení', directive:'Směrnice', law:'Zákon', decree:'Vyhláška', guidance:'Metodika', standard:'Norma', other:'Dokument' };
function bindPins(box){
  box.querySelectorAll('[data-pin]').forEach(b => b.onclick = async () => {
    const key = 'doc:' + b.dataset.pin, ex = S.me.marks.find(m => m.unit_id === key);
    if (ex){ if (await meCall('rq_delete_mark', { p_id: ex.id }) !== null) S.me.marks = S.me.marks.filter(m => m !== ex); }
    else { const id = await meCall('rq_save_mark', { p_unit_id: key, p_label: '' }); if (id != null) S.me.marks.unshift({ id, unit_id: key, label: '', created_at: new Date().toISOString() }); }
    render();
  });
}
function renderHome(){
  const all = docGroups(), last = (S.data.history || [])[0], ua = usedAreas();
  const ico = k => (document.querySelector(`.navb[data-nav="${k}"] svg`) || { outerHTML: '' }).outerHTML;
  // Pokračovat: čtení, trasa, prezentace
  const pos = S.me.positions.map(p => S.units.get(p.unit_id)).find(Boolean);
  const openPath = S.paths.find(p => { const k = progress(p); return k && k < p.steps.length; });
  const pp = typeof PR !== 'undefined' ? S.me.positions.filter(p => p.doc_group.startsWith('pres:')).map(p => { const r = slideRef(p.unit_id); return r && r.p.id === p.doc_group.slice(5) ? r : null; }).find(Boolean) : null;
  const cont = [
    pos && `<div class="card cont"><div class="kind">Pokračovat ve čtení</div><h3>${esc(docShort(S.docs.get(pos.document_id)))} · ${esc(pos.label)}</h3><div class="muted">${esc(trim(headingOf(pos) || ancestors(pos).map(a => a.label).join(' › '), 90))}</div><a class="btn acc" href="#/u/${encodeURIComponent(pos.id)}">Pokračovat</a></div>`,
    openPath && `<div class="card cont"><div class="kind">Rozpracovaná trasa</div><h3>${esc(openPath.title)}</h3><i class="pbar"><b style="width:${Math.round(progress(openPath) / openPath.steps.length * 100)}%"></b></i><div class="muted">Prošli jste ${progress(openPath)} z ${openPath.steps.length}</div><a class="btn" href="#/t/${encodeURIComponent(openPath.id)}/${Math.min(openPath.steps.length, progress(openPath) + 1)}">Pokračovat v trase</a></div>`,
    pp && `<div class="card cont"><div class="kind">Prezentace</div><h3>${esc(pp.p.title)}</h3><i class="pbar"><b style="width:${Math.round((pp.i + 1) / pp.p.slides.length * 100)}%"></b></i><div class="muted">Snímek ${pp.i + 1} z ${pp.p.slides.length}</div><a class="btn" href="#/prezentace/${encodeURIComponent(pp.p.id)}/${encodeURIComponent(pp.s.id)}">Pokračovat</a></div>`
  ].filter(Boolean);
  // Rozcestník
  const since = Date.now() - 14 * 864e5;
  const prs = typeof PR !== 'undefined' ? PR.list : [], prNew = prs.filter(p => p.visible_from && new Date(p.visible_from) >= since && !S.me.positions.some(x => x.doc_group === 'pres:' + p.id)).length;
  const seen = (() => { try { return localStorage.getItem('rq-aktuality-videno') || ''; } catch { return ''; } })();
  const nws = typeof NW !== 'undefined' ? NW.list : [], nwNew = nws.filter(n => (n.published_on || '') > seen).length;
  const lks = typeof LK !== 'undefined' ? LK.list : [], cases = S.data.cases || [];
  const pathOpen = S.paths.filter(p => { const k = progress(p); return k && k < p.steps.length; }).length;
  const tiles = [
    ['docs', '#/dokumenty', 'Dokumenty', 'Předpisy a metodiky s výklady', `${all.length}`],
    ['finder', '#/najit', 'Najít předpisy', 'Podle oblasti, role a vlastností – nebo průvodce otázkami', ''],
    ['prlist', '#/prezentace', 'Prezentace', 'Snímky z přednášek s odkazy do předpisů', `${prs.length}${prNew ? ` · <b>${prNew} ${prNew === 1 ? 'nová' : 'nové'}</b>` : ''}`],
    ['paths', '#/trasy', 'Trasy', 'Témata krok za krokem napříč předpisy', `${S.paths.length}${pathOpen ? ` · ${pathOpen} rozpracovan${pathOpen === 1 ? 'á' : 'é'}` : ''}`],
    ['cases', '#/pripady', 'Řešené případy', 'Konkrétní situace rozebrané krok za krokem', `${cases.length}`],
    ['updates', '#/aktuality', 'Aktuality', 'Novinky z úřadů a institucí s komentářem', `${nws.length}${nwNew ? ` · <b>${nwNew} ${nwNew === 1 ? 'nová' : nwNew < 5 ? 'nové' : 'nových'}</b>` : ''}`],
    ['links', '#/odkazy', 'Odkazy', 'Úřady, databáze, legislativa, normy', `${lks.length}`],
    ['terms', '#/pojmy', 'Pojmy', 'Definice z předpisů', `${S.terms.length}`]
  ];
  // Nové pro vás
  const sm = last?.changes?.summary || {};
  const changes = last && !last.changes?.first ? [pl(sm.comments_new, 'nový výklad', 'nové výklady', 'nových výkladů'), pl(sm.relations_new, 'nová vazba', 'nové vazby', 'nových vazeb'), pl(sm.units_changed, 'změněné ustanovení', 'změněná ustanovení', 'změněných ustanovení'), pl(sm.units_new, 'nově zveřejněná část', 'nově zveřejněné části', 'nově zveřejněných částí'), pl(sm.paths_new, 'nová trasa', 'nové trasy', 'nových tras')].filter(Boolean).join(', ') : '';
  const newPres = prs.filter(p => p.visible_from && new Date(p.visible_from) >= since).slice(0, 2);
  const marks = S.me.marks.filter(m => !m.unit_id.startsWith('doc:') && S.units.has(m.unit_id)), markN = marks.length;
  // Dokumenty: připnuté, doporučené, naposledy otevřené
  const pinned = all.filter(g => S.me.marks.some(m => m.unit_id === 'doc:' + g.key));
  const featured = all.filter(g => g.featured && !pinned.includes(g)).sort((a, b) => a.sort - b.sort);
  const recent = S.me.positions.map(p => all.find(g => g.key === p.doc_group)).filter(g => g && !pinned.includes(g) && !featured.includes(g));
  let cards = [...pinned.map(g => [g, 'Připnuté']), ...featured.map(g => [g, 'Doporučené']), ...recent.map(g => [g, 'Naposledy otevřené'])].slice(0, 3);
  if (!cards.length) cards = all.slice(0, 3).map(g => [g, '']);

  $('#panelText').innerHTML = `<div class="home">
    <div class="eyebrow">Výuková čtečka · FBMI ČVUT</div>
    <h1>Regulace zdravotnických prostředků</h1>
    <p class="lead">Ověřené texty předpisů a metodik s výklady redakce, prezentacemi, trasami a řešenými případy. Studijní pomůcka, ne oficiální zdroj práva.</p>
    <div class="status"><span class="sdot"></span>Obsah aktualizován <strong>${esc(fmtDate(S.data.published_at))}</strong> <a href="#/novinky">Co je nového</a></div>
    ${cont.length ? `<div class="sec"><h2>Pokračovat</h2></div><div class="home-cont n${cont.length}">${cont.join('')}</div>` : ''}
    <div class="sec"><h2>Rozcestník</h2></div>
    <nav class="home-tiles" aria-label="Rozcestník">${tiles.map(([k, href, name, desc, n, hl]) => `<a class="tile${hl ? ' hl' : ''}" href="${href}"><span class="ti">${ico(k)}</span><span class="tt"><strong>${name}</strong>${n ? `<em>${n}</em>` : ''}</span><small>${desc}</small></a>`).join('')}</nav>
    <div class="home-two">
      <section class="card"><div class="sec in"><h2>Moje záložky</h2>${markN ? `<a href="#/zalozky">Všechny (${markN})</a>` : ''}</div>
        ${markN ? `<div class="marklist flat">${marks.slice(0, 5).map(markRow).join('')}</div>` : '<p class="muted">Záložku přidáte u ustanovení tlačítkem se záložkou vpravo nahoře – můžete jí dát krátký popisek (např. „Na zkoušku – lhůty“). Uloží se k vašemu účtu.</p>'}</section>
      <section class="card"><div class="sec in"><h2>Nové pro vás</h2><a href="#/novinky">Co je nového</a></div>
        ${changes ? `<p class="hn-line"><b>Poslední aktualizace obsahu:</b> ${esc(changes)}.</p>` : ''}
        ${newPres.map(p => `<p class="hn-line"><b>Nová prezentace:</b> <a href="#/prezentace/${encodeURIComponent(p.id)}">${esc(p.title)}</a></p>`).join('')}
        ${nws.length ? `<div class="upd-list compact">${nws.slice(0, 3).map(n => newsCard(n, false)).join('')}</div><a href="#/aktuality">Všechny aktuality</a>` : (!changes && !newPres.length ? '<p class="muted">Zatím nic nového.</p>' : '')}</section>
    </div>
    ${ua.length ? `<div class="sec"><h2>Procházet podle oblasti</h2></div><div class="area-switch">${ua.map(a => `<a class="chipb" href="#/najit?o=${encodeURIComponent(a.key)}">${esc(a.name)}</a>`).join('')}</div>` : ''}
    <div class="sec"><h2>Dokumenty</h2><a href="#/dokumenty">Všechny dokumenty (${all.length})</a></div>
    <div class="cards">${cards.map(([g, l]) => docCard(g, l)).join('')}</div>
    <div class="source">${esc(S.data.notice || '')}</div></div>`;
  bindPins($('#panelText'));
  $('#panelText').querySelectorAll('[data-del-mark]').forEach(b => b.closest('.home') && b.remove());
  document.title = 'RegulaQuest · Čtečka regulace zdravotnických prostředků';
}
function renderDocs(){
  const q = fold(S.docQuery), f = S.docFilter, ua = usedAreas(), area = ua.find(a => a.key === S.area);
  const match = g => (f === 'all' || (f === 'guide' ? g.main.document_type === 'guidance' : g.main.document_type !== 'guidance'))
    && (!q || g.docs.some(d => fold([d.title, d.family, d.short_title, ...(d.topics || [])].join(' ')).includes(q)));
  const byName = (a, b) => docTitle(a.main).localeCompare(docTitle(b.main), 'cs');
  let body;
  if (area){
    const inA = docGroups().map(g => ({ g, x: areasOf(g.key).find(x => x.area_key === area.key) })).filter(o => o.x && match(o.g));
    body = (area.description ? `<p class="lead">${esc(area.description)}</p>` : '') + Object.entries(AREA_ROLES).map(([role, title]) => {
      const list = inA.filter(o => o.x.role === role).sort((a, b) => (a.x.sort - b.x.sort) || byName(a.g, b.g));
      return list.length ? `<div class="sec"><h2>${title}</h2>${role === 'situational' ? '<span class="muted">Platí jen v určitých případech – viz „Kdy“</span>' : ''}</div><div class="cards">${list.map(o => docCard(o.g, '', role === 'situational' ? o.x.note : '')).join('')}</div>` : '';
    }).join('') || '<div class="empty">V této oblasti zatím nejsou dokumenty odpovídající hledání.</div>';
  } else {
    const gs = docGroups().filter(match).sort((a, b) => (a.main.document_type === 'guidance' ? 1 : 0) - (b.main.document_type === 'guidance' ? 1 : 0) || byName(a, b));
    body = gs.length ? `<div class="cards">${gs.map(g => docCard(g, '', '') .replace('<div class="facts">', `<div class="area-tags">${areasOf(g.key).map(x => `<span class="atag ${x.role}">${esc((S.data.areas || []).find(a => a.key === x.area_key)?.name || x.area_key)}</span>`).join('')}</div><div class="facts">`)).join('')}</div>` : '<div class="empty">Žádný dokument neodpovídá hledání.</div>';
  }
  $('#panelText').innerHTML = `<div class="eyebrow">Dokumenty</div><h1>${area ? esc(area.name) : 'Všechny dokumenty'}</h1>
    ${area ? '' : '<p class="lead">Předpisy a metodiky s ověřeným textem a výklady. Vyberte oblast – uvidíte hlavní předpisy, metodiky, doplňkové předpisy i ty pro specifické situace. Hvězdičkou si dokument připnete na Přehled.</p>'}
    ${ua.length ? `<div class="area-switch" role="group" aria-label="Oblast"><button type="button" class="chipb ${!area ? 'on' : ''}" data-area="">Všechny oblasti</button>${ua.map(a => `<button type="button" class="chipb ${area?.key === a.key ? 'on' : ''}" data-area="${esc(a.key)}">${esc(a.name)}</button>`).join('')}</div>` : ''}
    <div class="toolbar"><input type="search" id="docQ" placeholder="Hledat dokument (název, zkratka, téma)…" aria-label="Hledat dokument" value="${esc(S.docQuery)}">
      <span class="langs" role="group" aria-label="Druh">${[['all','Vše'],['law','Předpisy'],['guide','Metodiky']].map(([k,l]) => `<button type="button" class="lang ${f===k?'on':''}" data-f="${k}">${l}</button>`).join('')}</span></div>
    ${body}`;
  const qi = $('#docQ'); qi.oninput = () => { S.docQuery = qi.value; const pos = qi.selectionStart; renderDocs(); const n = $('#docQ'); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.docFilter = b.dataset.f; renderDocs(); });
  document.querySelectorAll('#panelText [data-area]').forEach(b => b.onclick = () => { setArea(b.dataset.area); renderDocs(); });
  bindPins($('#panelText'));
  document.title = `${area ? area.name : 'Dokumenty'} · RegulaQuest`;
}
function markRow(m){
  const u = S.units.get(m.unit_id); if (!u) return '';
  const d = S.docs.get(u.document_id);
  return `<div class="mk">${ICON_MARK(true)}<a href="#/u/${encodeURIComponent(u.id)}"><strong>${esc(m.label || headingOf(u) || u.label)}</strong><span>${esc(docShort(d))} · ${esc(ancestors(u).map(a => a.label).concat(u.label).join(' › '))}</span></a>
    <button type="button" class="mini" data-del-mark="${m.id}" aria-label="Odebrat záložku">Odebrat</button></div>`;
}
function renderMarks(){
  const ms = S.me.marks.filter(m => !m.unit_id.startsWith('doc:'));
  const ok = ms.filter(m => S.units.has(m.unit_id)), gone = ms.length - ok.length;
  $('#panelText').innerHTML = `<div class="eyebrow">Záložky</div><h1>Moje záložky</h1>
    <p class="lead">Uložené k vašemu účtu – uvidíte je na počítači i na telefonu. Vidíte je jen vy. Záložku přidáte tlačítkem „Přidat záložku“ u ustanovení.</p>
    ${ok.length ? `<div class="card marklist">${ok.map(markRow).join('')}</div>` : '<div class="empty">Zatím nemáte žádnou záložku.</div>'}
    ${gone ? `<p class="muted">${gone} záložek míří na ustanovení, které teď ve čtečce není (např. po aktualizaci obsahu).</p>` : ''}`;
  document.querySelectorAll('[data-del-mark]').forEach(b => b.onclick = async () => { const id = +b.dataset.delMark;
    if (await meCall('rq_delete_mark', { p_id: id }) !== null){ S.me.marks = S.me.marks.filter(m => m.id !== id); render(); } });
  document.title = 'Záložky · RegulaQuest';
}
function renderTerms(){
  const q = fold(S.termQuery);
  const byLang = {}; S.terms.forEach(t => (byLang[t.language] = byLang[t.language] || []).push(t));
  const cs = (byLang.cs || []).slice().sort((a, b) => a.number - b.number);
  const twin = t => (byLang[t.language === 'cs' ? 'en' : 'cs'] || []).find(x => x.number === t.number && S.docs.get(S.units.get(x.unit_id)?.document_id)?.group_key === S.docs.get(S.units.get(t.unit_id)?.document_id)?.group_key);
  const base = cs.length ? cs : (byLang.en || []);
  const rows = base.map(t => ({ t, o: twin(t) })).filter(({ t, o }) => !q || fold(t.name + ' ' + (o?.name || '')).includes(q));
  const def = t => { const u = S.units.get(t.unit_id); return u ? RQNotes.definitionText(bodyOf(u), t.number) : ''; };
  $('#panelText').innerHTML = `<div class="eyebrow">Pojmy</div><h1>Slovník pojmů</h1>
    <p class="lead">Definice z definičních článků (např. čl. 2 MDR) česky a anglicky. V textech jsou tyto pojmy podtržené – klepnutím zobrazíte definici.</p>
    <div class="toolbar"><input type="search" id="termQ" placeholder="Hledat pojem (česky i anglicky)…" aria-label="Hledat pojem" value="${esc(S.termQuery)}"></div>
    ${rows.length ? `<div class="card terms">${rows.map(({ t, o }) => { const u = S.units.get(t.unit_id);
      return `<div class="trow"><div><strong>${esc(t.name)}</strong>${o ? `<div class="muted">${esc(o.language.toUpperCase())}: ${esc(o.name)}</div>` : ''}<div class="muted">${u ? `<a href="#/u/${encodeURIComponent(u.id)}">${esc(docShort(S.docs.get(u.document_id)))} · ${esc(u.label)}, bod ${t.number}</a>` : ''}</div></div><p>${esc(trim(def(t).replace(/^\(?\d+\)\s*/, ''), 420))}</p></div>`; }).join('')}</div>`
      : `<div class="empty">${S.terms.length ? 'Žádný pojem neodpovídá hledání.' : 'Redakce zatím nezveřejnila slovník pojmů.'}</div>`}`;
  const qi = $('#termQ'); qi.oninput = () => { S.termQuery = qi.value; const pos = qi.selectionStart; renderTerms(); const n = $('#termQ'); n.focus(); n.setSelectionRange(pos, pos); };
  document.title = 'Pojmy · RegulaQuest';
}
function renderNews(){
  const hist = (S.data.history || []).filter(h => !h.changes?.first || h.note);
  if (hist[0]) try { localStorage.setItem('rq-novinky-videno', String(S.data.history[0].id)); $('#navNews').classList.add('hidden'); } catch {}
  const pill = (n, a, b, c) => n ? `<span class="pill">+${pl(n, a, b, c)}</span>` : '';
  $('#panelText').innerHTML = `<div class="eyebrow">Co je nového</div><h1>Aktualizace obsahu</h1>
    <p class="lead">Co redakce doplnila nebo změnila. Změněná ustanovení mají v osnově dva týdny značku NOVÉ.</p>
    ${hist.length ? hist.map((h, i) => { const c = h.changes || {}, sm = c.summary || {};
      const items = (Array.isArray(c.items) ? c.items : []).filter(x => S.units.has(x.unit_id));
      return `<div class="news${i ? ' old' : ''}"><h3>${esc(fmtDate(h.published_at))}</h3>
        ${h.note ? `<div class="pb-note">${plain(h.note)}</div>` : ''}
        ${c.first ? '<div class="muted">První zveřejnění obsahu.</div>' : `<div class="pills">${pill(sm.comments_new,'nový výklad','nové výklady','nových výkladů')}${pill(sm.relations_new,'nová vazba','nové vazby','nových vazeb')}${pill(sm.units_new,'nově zveřejněná část','nově zveřejněné části','nově zveřejněných částí')}${pill(sm.units_changed,'změněné ustanovení','změněná ustanovení','změněných ustanovení')}${pill(sm.paths_new,'nová trasa','nové trasy','nových tras')}</div>`}
        ${(c.paths_new || []).length ? `<div class="muted">Nové trasy: ${c.paths_new.map(p => S.paths.some(x => x.id === p.id) ? `<a href="#/t/${encodeURIComponent(p.id)}">${esc(p.title)}</a>` : esc(p.title)).join(', ')}</div>` : ''}
        ${items.length ? `<ul>${items.slice(0, 30).map(x => { const u = S.units.get(x.unit_id), d = S.docs.get(u.document_id);
          return `<li><a href="#/u/${encodeURIComponent(u.id)}">${esc(docShort(d))} · ${esc(ancestors(u).map(a => a.label).concat(u.label).join(' › '))}</a> – ${esc(x.what)}</li>`; }).join('')}</ul>${items.length > 30 || (c.items_total || 0) > items.length ? `<div class="muted">…a další změny.</div>` : ''}` : ''}</div>`; }).join('')
      : '<div class="empty">Zatím žádná aktualizace.</div>'}`;
  document.title = 'Co je nového · RegulaQuest';
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
  const fattr = (id, kind, text) => id ? ` data-focus="${esc(id)}" data-fkind="${esc(kind)}" data-flabel="${esc(trim(text, 70))}" title="Ukázat v textu jen tuto položku"` : '';
  const noteCard = n => `<div class="ctx-card ${n.kind==='warning'?'warning':''}${S.focus?.id===n.id?' focused':''}"${n.anchor_text?fattr(n.id, n.kind, `${NOTE_NAMES[n.kind]||n.kind} „${n.anchor_text}“`):''}><div class="meta"><span class="k">${ICON(n.kind)} ${esc(NOTE_NAMES[n.kind]||n.kind)}${n.language!==S.docs.get(u.document_id)?.language?' · '+esc(n.language.toUpperCase()):''}</span>${S.draft&&n.status!=='approved'?'<span class="chip warn">Koncept</span>':''}</div>${quote(n)}${n.kind==='key'?'':`<div class="body">${plain(n.body)}</div>`}</div>`;
  const lgroups = RQNotes.linkGroups(rels.filter(r => r.source_id === u.id && !r.mirrored));
  const relQuote = r => { if (!r.anchor_text || r.source_id !== u.id || r.mirrored) return ''; const g = lgroups.find(x => x.rels.includes(r));
    return g ? `<button type="button" class="anchor-q" data-cid="${esc(g.id)}" title="Ukázat v textu">„${esc(trim(r.anchor_text, 90))}“</button>` : ''; };
  const relCard = r => { const o = other(r); if (!o) return ''; const d = S.docs.get(o.document_id);
    const g = r.anchor_text && r.source_id === u.id && !r.mirrored ? lgroups.find(x => x.rels.includes(r)) : null;
    return `<div class="ctx-card${g && S.focus?.id===g.id?' focused':''}"${g?fattr(g.id, 'link', `Odkaz „${r.anchor_text}“`):''}><a class="ctx-link" href="#/u/${encodeURIComponent(o.id)}"><div class="meta"><span class="k">${ICON(guidance.includes(r)||legalBasis.includes(r)?'guidance':r.relation_type)} ${esc(REL_NAMES[r.relation_type]||r.relation_type)}</span>${S.draft&&r.status!=='approved'?'<span class="chip warn">Návrh</span>':''}</div><strong>${esc(o.label)}${headingOf(o)?' – '+esc(trim(headingOf(o),70)):''}</strong><small>${esc(docShort(d))}${ancestors(o).length?' › '+esc(ancestors(o).map(a=>a.label).join(' › ')):''}</small></a>${relQuote(r)}${r.rationale?`<div class="why">${esc(r.rationale)}</div>`:''}</div>`; };
  const total = notes.length + rels.length;
  box.innerHTML = `<div class="ctx-title">Souvislosti · ${esc(u.label)}</div>` +
    section('Na co si dát pozor', warnings, noteCard) +
    section('Výklad', explain, noteCard) +
    section('Metodika (výklad MDCG)', guidance, relCard) +
    section('Vykládané ustanovení předpisu', legalBasis, relCard) +
    section('Související ustanovení', related, relCard) +
    section('Příklady', examples, noteCard) +
    section('Klíčové pasáže', keys, noteCard) +
    (typeof presCtx === 'function' ? presCtx(u) : '') +
    (typeof casesCtx === 'function' ? casesCtx(u) : '') +
    (typeof newsCtx === 'function' ? newsCtx(u) : '') +
    (childInfo.length ? `<div class="ctx-section"><h3>V jednotlivých částech</h3>${childInfo.map(x => `<div class="ctx-card"><a class="ctx-link" href="#/u/${encodeURIComponent(x.c.id)}"><strong>${esc(x.c.label)}</strong><small>${[x.n?`${x.n}× výklad`:'',x.r?`${x.r}× souvislost`:''].filter(Boolean).join(' · ')}</small></a></div>`).join('')}</div>` : '') +
    (total || childInfo.length || (typeof newsFor === 'function' && newsFor(u).length) || (typeof casesFor === 'function' && casesFor(u).length) || (typeof presFor === 'function' && presFor(u).length) ? '' : '<div class="ctx-empty">K tomuto ustanovení zatím nejsou zveřejněné výklady ani vazby.</div>') + disclaimer();
  $('#tabCount').textContent = total ? String(total) : '';
  box.querySelectorAll('[data-focus]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('a, button:not(.anchor-q)')) return;
    setFocus({ id: c.dataset.focus, kind: c.dataset.fkind, label: esc(c.dataset.flabel) });
  }));
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
