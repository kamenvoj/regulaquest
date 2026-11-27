'use strict';
/* RegulaQuest Studio – Řešené případy: zadání, kroky s odkazem na ustanovení, závěr; oblasti a štítky.
   Ustanovení lze s případem propojit i přímo z textu dokumentu (řádek „Případy“ pod nadpisem).
   Studenti vidí zveřejněné případy po publikaci. */
window.RQCases = (function () {
  let open = null, stepEdit = null, filter = 'all';
  const STATUS = { draft: 'Koncept', published: 'Zveřejněný', archived: 'Archivovaný' };
  const cases = () => (db.cases || []).slice().sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'cs'));
  const steps = id => (db.case_steps || []).filter(s => s.case_id === id).sort((a, b) => a.sort - b.sort);
  const links = id => (db.case_links || []).filter(l => l.case_id === id).map(l => l.unit_id);
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const areaName = k => (db.areas || []).find(a => a.key === k)?.name || k;
  const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const unitLabel = id => { const u = getUnit(id); if (!u) return 'Ustanovení nenalezeno'; const d = getDoc(u.document_id); return `${d ? d.family + ' · ' + d.language.toUpperCase() : ''} › ${u.label}${u.heading ? ' – ' + u.heading : ''}`; };
  const previewUrl = id => { const a = document.querySelector('[data-reader="?nahled=pracovni"]'); return a ? a.href + '#/pripad/' + encodeURIComponent(id) : '#'; };
  const FORMAT = 'Odstavce oddělte prázdným řádkem. Odrážky začněte „- “. Tabulka: každý řádek „| buňka | buňka |“, první řádek je záhlaví.';

  function pick(name, selected, items, empty) {
    const s = new Set(selected || []);
    const label = s.size ? [...s].map(k => items.find(i => i.key === k)?.name || k).join(', ') : empty;
    return `<details class="gq-pick" data-pick="${name}" data-empty="${esc(empty)}"><summary title="${esc(label)}">${esc(label)}</summary><div class="gq-pick-list">
      ${items.map(i => i.group ? `<div class="gq-pick-g">${esc(i.group)}</div>` : `<label><input type="checkbox" value="${esc(i.key)}" ${s.has(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>`;
  }
  const readPick = (root, name) => [...root.querySelectorAll(`[data-pick="${name}"] input:checked`)].map(x => x.value);
  const syncPick = d => { const s = d.querySelector('summary'), on = [...d.querySelectorAll('input:checked')].map(x => x.parentElement.textContent.trim()); s.textContent = on.length ? on.join(', ') : d.dataset.empty; };
  const tagItems = () => (db.tag_groups || []).flatMap(g => [{ group: g.name }, ...(db.tags || []).filter(t => t.group_key === g.key && !t.archived).map(t => ({ key: t.key, name: t.name }))]);

  // Výběr ustanovení hledáním (dokument, označení, nadpis)
  function unitPicker(id, current) {
    return `<div class="cs-upick" id="${id}"><input type="hidden" data-unit value="${esc(current || '')}">
      <div class="cs-ucur">${current ? `<span class="role-chip on">${esc(unitLabel(current))}<button type="button" data-uclear aria-label="Zrušit">×</button></span>` : '<small class="fine">Bez odkazu na ustanovení</small>'}</div>
      <input class="input" data-uq placeholder="Hledat ustanovení: např. pravidlo 11, článek 10, příloha VIII…"><div class="cs-ulist" hidden></div></div>`;
  }
  function bindUnitPicker(root, onPick) {
    const q = root.querySelector('[data-uq]'), list = root.querySelector('.cs-ulist'), hid = root.querySelector('[data-unit]');
    const set = v => { hid.value = v || ''; root.querySelector('.cs-ucur').innerHTML = v ? `<span class="role-chip on">${esc(unitLabel(v))}<button type="button" data-uclear aria-label="Zrušit">×</button></span>` : '<small class="fine">Bez odkazu na ustanovení</small>'; bindClear(); if (onPick) onPick(v); };
    const bindClear = () => { const c = root.querySelector('[data-uclear]'); if (c) c.onclick = () => set(''); };
    bindClear();
    q.oninput = () => {
      const ts = fold(q.value).split(/\s+/).filter(Boolean);
      if (!ts.length) { list.hidden = true; return; }
      const xs = db.units.filter(u => !u.editor_archived && ts.every(t => fold(unitLabel(u.id)).includes(t))).slice(0, 25);
      list.innerHTML = xs.map(u => `<button type="button" data-pick-unit="${esc(u.id)}">${esc(unitLabel(u.id))}</button>`).join('') || '<small class="fine">Nic nenalezeno.</small>';
      list.hidden = false;
      list.querySelectorAll('[data-pick-unit]').forEach(b => b.onclick = () => { set(b.dataset.pickUnit); q.value = ''; list.hidden = true; });
    };
  }

  function listView() {
    const xs = cases().filter(c => filter === 'all' || c.status === filter);
    return `<div class="page-head"><div><div class="eyebrow">VÝUKA / ŘEŠENÉ PŘÍPADY</div><h1>Řešené případy</h1>
      <p>Konkrétní případy rozebrané krok za krokem (klasifikace, analýza rizik, posouzení…). Kroky odkazují na ustanovení; ve čtečce má případ vlastní stránku a u propojených ustanovení se ukáže odkaz. Studenti vidí zveřejněné případy po publikaci.</p></div>
      <div class="head-actions"><button type="button" class="btn accent" id="csNew">+ Nový případ</button></div></div>
      <div class="nw-tabs">${[['all', 'Vše'], ...Object.entries(STATUS)].map(([k, l]) => `<button type="button" class="btn${filter === k ? ' accent' : ''}" data-cf="${k}">${l} (${k === 'all' ? cases().length : cases().filter(c => c.status === k).length})</button>`).join('')}</div>
      <ul class="nw-list">${xs.map(c => `<li class="nw-item cs-row"><span></span><div class="nw-main"><div class="nw-meta">${esc(STATUS[c.status])} · ${steps(c.id).length} kroků · ${links(c.id).length} propojených ustanovení${c.area_keys.length ? ' · ' + esc(c.area_keys.map(areaName).join(', ')) : ''}</div>
        <button type="button" class="nw-title linkish" data-open="${esc(c.id)}">${esc(c.title)}</button>${c.summary ? `<p class="nw-sum">${esc(c.summary)}</p>` : ''}</div>
        <div class="nw-act"><button type="button" class="btn tiny" data-open="${esc(c.id)}">Upravit</button><a class="btn tiny" href="${esc(previewUrl(c.id))}" target="_blank" rel="noopener">Náhled ↗</a></div></li>`).join('') || '<li class="nw-empty">Zatím žádné případy.</li>'}</ul>`;
  }

  function stepRow(s, i, n) {
    if (stepEdit === s.id) return `<li class="cs-step editing" data-sid="${esc(s.id)}">${stepForm(s)}</li>`;
    return `<li class="cs-step" data-sid="${esc(s.id)}"><div><strong>${i + 1}. ${esc(s.title || '(bez názvu)')}</strong>${s.unit_id ? `<div class="cs-ulink">→ ${esc(unitLabel(s.unit_id))}</div>` : ''}${s.body ? `<p class="nw-sum">${esc(s.body.length > 240 ? s.body.slice(0, 239) + '…' : s.body)}</p>` : ''}</div>
      <div class="nw-act"><button type="button" class="btn tiny" data-up ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn tiny" data-down ${i < n - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn tiny" data-sedit>Upravit</button><button type="button" class="btn tiny danger" data-sdel>Smazat</button></div></li>`;
  }
  function stepForm(s) {
    return `<div class="nw-edit cs-sform"><label class="form-field"><span>Název kroku</span><input class="input" data-st maxlength="200" value="${esc(s.title || '')}" placeholder="Např. 2. Je software zdravotnickým prostředkem?"></label>
      <label class="form-field"><span>Text kroku</span><textarea class="textarea" data-sb rows="6" maxlength="15000">${esc(s.body || '')}</textarea><small class="form-hint">${FORMAT}</small></label>
      <div class="form-field"><span>Odkaz na ustanovení (nepovinné)</span>${unitPicker('csStepUnit', s.unit_id)}</div>
      <div class="modal-actions"><button type="button" class="btn" data-scancel>Zrušit</button><button type="button" class="btn accent" data-ssave>Uložit krok</button></div></div>`;
  }

  function detailView(c) {
    const ss = steps(c.id), ls = links(c.id);
    return `<div class="page-head"><div><div class="eyebrow">VÝUKA / ŘEŠENÉ PŘÍPADY</div><h1>${c.id ? esc(c.title) : 'Nový případ'}</h1></div>
      <div class="head-actions"><button type="button" class="btn" id="csBack">← Všechny případy</button>${c.id ? `<a class="btn" href="${esc(previewUrl(c.id))}" target="_blank" rel="noopener">Náhled ve čtečce ↗</a>` : ''}</div></div>
      <div class="gq-card cs-form">
        <label class="form-field"><span>Název</span><input class="input" id="csTitle" maxlength="200" value="${esc(c.title || '')}" placeholder="Např. Klasifikace aplikace pro hodnocení kožních znamének"></label>
        <label class="form-field"><span>Krátký popis (na kartě v seznamu)</span><input class="input" id="csSummary" maxlength="1000" value="${esc(c.summary || '')}"></label>
        <label class="form-field"><span>Zadání</span><textarea class="textarea" id="csAssign" rows="5" maxlength="15000" placeholder="Popis prostředku nebo situace, otázka k vyřešení…">${esc(c.assignment || '')}</textarea></label>
        <label class="form-field"><span>Závěr</span><textarea class="textarea" id="csConcl" rows="4" maxlength="15000">${esc(c.conclusion || '')}</textarea><small class="form-hint">${FORMAT}</small></label>
        <div class="nw-picks"><label class="form-field"><span>Stav</span><select class="select" id="csStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${(c.status || 'draft') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <div class="form-field"><span>Oblasti</span>${pick('ca', c.area_keys, areas().map(a => ({ key: a.key, name: a.name })), '—')}</div>
          <div class="form-field"><span>Štítky</span>${pick('ct', c.tags, tagItems(), '—')}</div></div>
        <div class="modal-actions">${c.id ? '<button type="button" class="btn danger" id="csDel">Smazat případ</button><span style="flex:1"></span>' : ''}<button type="button" class="btn accent" id="csSave">${c.id ? 'Uložit' : 'Založit případ'}</button></div></div>
      ${c.id ? `<div class="gq-card"><div class="gq-head"><h2>Postup (${ss.length} kroků)</h2><button type="button" class="btn" id="csAddStep">+ Krok</button></div>
        ${stepEdit === 'new' ? `<div data-sid="new">${stepForm({})}</div>` : ''}
        <ol class="cs-steps">${ss.map((s, i) => stepRow(s, i, ss.length)).join('')}</ol>${ss.length || stepEdit === 'new' ? '' : '<p class="fine">Zatím žádné kroky.</p>'}</div>
      <div class="gq-card"><h2>Propojená ustanovení</h2><p class="fine">U těchto ustanovení se ve čtečce v Souvislostech ukáže odkaz na případ (stejně jako u ustanovení v krocích). Propojit jde i přímo z textu dokumentu: pod nadpisem „+ Případ“.</p>
        <div class="nw-units">${ls.map(id => `<span class="role-chip on">${esc(unitLabel(id))}<button type="button" data-unlink="${esc(id)}" aria-label="Odpojit">×</button></span>`).join('') || '<small class="fine">Žádná.</small>'}</div>
        <div class="form-field" style="margin-top:10px"><span>Propojit další</span>${unitPicker('csLinkPick', '')}</div></div>` : '<p class="fine">Kroky a propojená ustanovení přidáte po založení případu.</p>'}`;
  }

  function render() {
    const box = document.getElementById('casesContent'); if (!box) return;
    const c = open === 'new' ? {} : open && (db.cases || []).find(x => x.id === open);
    if (open && !c) open = null;
    box.innerHTML = open ? detailView(c) : listView();
    bind(box, c);
  }
  async function run(fn, msg) { try { const r = await fn(); await refresh(); if (msg) toast(msg); return r ?? true; } catch (e) { toast(e.message, true); return null; } }

  function bind(box, c) {
    box.querySelectorAll('.gq-pick').forEach(d => d.addEventListener('change', () => syncPick(d)));
    if (!open) {
      box.querySelector('#csNew').onclick = () => { open = 'new'; stepEdit = null; render(); };
      box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { open = b.dataset.open; stepEdit = null; render(); window.scrollTo(0, 0); });
      box.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { filter = b.dataset.cf; render(); });
      return;
    }
    box.querySelector('#csBack').onclick = () => { open = null; stepEdit = null; render(); };
    box.querySelector('#csSave').onclick = async () => {
      const id = await run(() => rpc('rq_save_case', { p_id: c.id || null, p: { title: box.querySelector('#csTitle').value, summary: box.querySelector('#csSummary').value,
        assignment: box.querySelector('#csAssign').value, conclusion: box.querySelector('#csConcl').value, status: box.querySelector('#csStatus').value,
        area_keys: readPick(box, 'ca'), tags: readPick(box, 'ct') } }), c.id ? 'Případ uložen.' : 'Případ založen.');
      if (id) { open = typeof id === 'string' ? id : open; render(); }
    };
    if (!c.id) return;
    box.querySelector('#csDel').onclick = async () => { if (confirm(`Smazat případ „${c.title}“ i s kroky?`) && await run(() => rpc('rq_delete_case', { p_id: c.id }), 'Případ smazán.')) { open = null; render(); } };
    box.querySelector('#csAddStep').onclick = () => { stepEdit = 'new'; render(); box.querySelector('[data-st]')?.focus(); };
    box.querySelectorAll('[data-sid]').forEach(li => {
      const sid = li.dataset.sid;
      const q = s => li.querySelector(s);
      if (q('[data-up]')) { q('[data-up]').onclick = () => run(() => rpc('rq_move_case_step', { p_id: sid, p_dir: -1 })).then(render); q('[data-down]').onclick = () => run(() => rpc('rq_move_case_step', { p_id: sid, p_dir: 1 })).then(render); }
      if (q('[data-sedit]')) q('[data-sedit]').onclick = () => { stepEdit = sid; render(); };
      if (q('[data-sdel]')) q('[data-sdel]').onclick = () => { if (confirm('Smazat krok?')) run(() => rpc('rq_delete_case_step', { p_id: sid }), 'Krok smazán.').then(render); };
      if (q('.cs-sform')) {
        bindUnitPicker(q('#csStepUnit'));
        q('[data-scancel]').onclick = () => { stepEdit = null; render(); };
        q('[data-ssave]').onclick = async () => {
          if (await run(() => rpc('rq_save_case_step', { p_id: sid === 'new' ? null : sid, p_case_id: c.id, p: { title: q('[data-st]').value, body: q('[data-sb]').value, unit_id: q('#csStepUnit [data-unit]').value } }), 'Krok uložen.')) { stepEdit = null; render(); }
        };
      }
    });
    box.querySelectorAll('[data-unlink]').forEach(b => b.onclick = () => run(() => rpc('rq_link_case_unit', { p_case_id: c.id, p_unit_id: b.dataset.unlink, p_add: false }), 'Odpojeno.').then(render));
    bindUnitPicker(box.querySelector('#csLinkPick'), v => { if (v) run(() => rpc('rq_link_case_unit', { p_case_id: c.id, p_unit_id: v, p_add: true }), 'Ustanovení propojeno.').then(render); });
  }

  /* ---------- v textu dokumentu ---------- */
  function unitRow(u) {
    const mine = cases().filter(c => links(c.id).includes(u.id) || steps(c.id).some(s => s.unit_id === u.id));
    return `<div class="roles-edit" id="rqCasesRow"><span class="smallcaps">Případy</span>${mine.map(c => `<span class="role-chip on${c.status === 'published' ? '' : ' draft'}" title="${esc(STATUS[c.status])}"><button type="button" class="cs-go" data-case-go="${esc(c.id)}">${esc(c.title.length > 50 ? c.title.slice(0, 49) + '…' : c.title)}</button>${links(c.id).includes(u.id) ? `<button type="button" data-case-del="${esc(c.id)}" aria-label="Odpojit">×</button>` : ''}</span>`).join('')}
      <span class="role-add"><button type="button" class="btn tiny" id="rqCaseAdd">+ Případ</button><div class="role-menu nw-pick" hidden>${cases().filter(c => !mine.includes(c)).map(c => `<button type="button" data-case-add="${esc(c.id)}"><small>${esc(STATUS[c.status])}</small>${esc(c.title)}</button>`).join('') || '<small class="fine">Žádný další případ. Založte ho na stránce Řešené případy.</small>'}</div></span></div>`;
  }
  function bindUnit(box, u) {
    const row = box.querySelector('#rqCasesRow'); if (!row) return;
    const relink = (id, add) => rpc('rq_link_case_unit', { p_case_id: id, p_unit_id: u.id, p_add: add }).then(refresh).then(() => toast(add ? 'Případ propojen.' : 'Případ odpojen.')).catch(e => toast(e.message, true));
    row.querySelectorAll('[data-case-del]').forEach(b => b.onclick = () => relink(b.dataset.caseDel, false));
    row.querySelectorAll('[data-case-add]').forEach(b => b.onclick = () => relink(b.dataset.caseAdd, true));
    row.querySelectorAll('[data-case-go]').forEach(b => b.onclick = () => { open = b.dataset.caseGo; stepEdit = null; setPage('cases'); });
    const menu = row.querySelector('.nw-pick');
    row.querySelector('#rqCaseAdd').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) document.addEventListener('click', function off(ev) { if (!menu.contains(ev.target)) { menu.hidden = true; document.removeEventListener('click', off); } }); };
  }
  return { render, unitRow, bindUnit, leave: () => { stepEdit = null; } };
})();
