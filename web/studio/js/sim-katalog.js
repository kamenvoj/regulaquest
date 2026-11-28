'use strict';
/* RegulaQuest Studio – Katalog simulací („svět“): Subjekty, Produkty (obecné ZP → výrobky výrobců → kusy), vztahy
   a Nastavení polí. Katalog obsahuje úplnou „pravdu“; co z ní student uvidí, určí scénář. Vše je smyšlené. */
window.RQSimCat = (function () {
  let C = null, selSub = null, selProd = null, q = '', typeF = '', showArch = false, cfgDraft = null;
  const H = s => esc(s == null ? '' : String(s));
  async function load(force) { if (!C || force) C = await rpc('rq_sim_catalog', {}); return C; }
  const cfg = () => C.config || {};
  const stype = id => (cfg().subject_types || []).find(t => t.id === id) || { id, label: id, fields: [] };
  const sub = id => C.subjects.find(s => s.id === id), prod = id => C.products.find(p => p.id === id), model = id => C.models.find(m => m.id === id);
  const rk = id => (cfg().relation_kinds || []).find(k => k.id === id) || { id, label: id, target: 'model' };
  const modelName = m => m ? `${m.name} (${sub(m.manufacturer_id)?.name || '?'})` : '?';
  const targetName = r => r.target_kind === 'model' ? modelName(model(r.target_id)) : (sub(r.target_id)?.name || '?');
  const fmtDate = d => d ? new Date(d).toLocaleDateString('cs-CZ') : '';

  // ---------- pole ----------
  function fieldInput(f, v, key, extra = '') {
    const a = `data-fk="${H(key)}" data-ft="${H(f.type || 'text')}" ${extra}`;
    if (f.type === 'bool') return `<label class="sc-f sc-bool"><input type="checkbox" ${a}${v ? ' checked' : ''}> ${H(f.label)}</label>`;
    let inp;
    if (f.type === 'select') inp = `<select class="select" ${a}><option value=""></option>${(f.options || []).map(o => `<option${o === v ? ' selected' : ''}>${H(o)}</option>`).join('')}</select>`;
    else if (f.type === 'number') inp = `<input class="input" type="number" step="any" ${a} value="${H(v)}">`;
    else if (f.type === 'date') inp = `<input class="input" type="date" ${a} value="${H(v)}">`;
    else if (f.type === 'subject') inp = `<select class="select" ${a}><option value=""></option>${C.subjects.filter(s => !f.subject_type || s.type === f.subject_type).map(s => `<option value="${H(s.id)}"${s.id === v ? ' selected' : ''}>${H(s.name)}</option>`).join('')}</select>`;
    else inp = `<input class="input" ${a} value="${H(v)}">`;
    return `<label class="sc-f"><span>${H(f.label)}</span>${inp}</label>`;
  }
  // pole s podmínkou „when“ (např. stanovené měřidlo jen při měřicí funkci)
  const visibleFields = (fields, data) => (fields || []).filter(f => !f.when || data[f.when]);
  function readVal(el) { const t = el.dataset.ft; if (t === 'bool') return el.checked || undefined; if (t === 'number') return el.value === '' ? undefined : +el.value; return el.value === '' ? undefined : el.value; }
  // uloží změnu pole do data objektu položky a pošle na server
  function bindData(root, kind, item, rerender) {
    root.querySelectorAll('[data-fk]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'change', async () => {
      const k = el.dataset.fk, v = readVal(el);
      if (k === 'name' || k === 'type') item[k] = v || item[k]; else { const d = { ...(item.data || {}) }; if (v === undefined) delete d[k]; else d[k] = v; item.data = d; }
      try { await rpc('rq_sim_cat_save', { p_kind: kind, p_id: item.id, p_patch: k === 'name' || k === 'type' ? { [k]: item[k] } : { data: item.data } }); flash(el); }
      catch (e) { toast(e.message, true); }
      if (rerender || (el.dataset.ft === 'bool') || k === 'type') render();
    }));
  }
  const flash = el => { el.classList.add('sc-saved'); setTimeout(() => el.classList.remove('sc-saved'), 700); };
  async function act(p, msg) { try { await p; await load(true); render(); if (msg) toast(msg); } catch (e) { toast(e.message, true); } }

  /* ---------- Subjekty ---------- */
  function renderSubjects(box) {
    const list = C.subjects.filter(s => (showArch || !s.archived) && (!typeF || s.type === typeF) && (!q || (s.name + ' ' + JSON.stringify(s.data)).toLowerCase().includes(q.toLowerCase())));
    if (!selSub && list.length) selSub = list[0].id;
    const s = sub(selSub);
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">SIMULACE / KATALOG</div><h1>Subjekty</h1>
      <p>Smyšlené firmy a instituce (výrobci, distributoři, nemocnice, servisy, oznámené subjekty, orgány…). Vztahy zadané u subjektu jsou vidět i u výrobků. Co z údajů student uvidí, určí scénář.</p></div>
      <div class="head-actions"><button class="btn accent" data-newsub>+ Subjekt</button></div></div>
      <div class="sc-split"><aside class="sc-list"><input class="input" placeholder="Hledat…" data-q value="${H(q)}">
        <select class="select" data-typef><option value="">Všechny typy</option>${(cfg().subject_types || []).map(t => `<option value="${H(t.id)}"${t.id === typeF ? ' selected' : ''}>${H(t.label)}</option>`).join('')}</select>
        <label class="fine"><input type="checkbox" data-arch${showArch ? ' checked' : ''}> i archivované</label>
        ${(cfg().subject_types || []).map(t => { const xs = list.filter(x => x.type === t.id); return xs.length ? `<div class="sc-grp">${H(t.label)}</div>${xs.map(x => `<button class="sc-item${x.id === selSub ? ' on' : ''}${x.archived ? ' arch' : ''}" data-sel="${H(x.id)}">${H(x.name)}</button>`).join('')}` : ''; }).join('')}
      </aside><section class="sc-detail">${s ? subjectDetail(s) : '<p class="fine">Vyberte subjekt.</p>'}</section></div>`;
    box.querySelector('[data-q]').oninput = e => { q = e.target.value; clearTimeout(box._t); box._t = setTimeout(() => { render(); const i = box.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); }, 250); };
    box.querySelector('[data-typef]').onchange = e => { typeF = e.target.value; selSub = null; render(); };
    box.querySelector('[data-arch]').onchange = e => { showArch = e.target.checked; render(); };
    box.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { selSub = b.dataset.sel; render(); });
    box.querySelector('[data-newsub]').onclick = () => act(rpc('rq_sim_cat_save', { p_kind: 'subject', p_id: null, p_patch: { type: typeF || 'vyrobce', name: 'Nový subjekt' } }).then(id => { selSub = id; }), 'Subjekt založen.');
    if (s) bindSubject(box.querySelector('.sc-detail'), s);
  }
  function subjectDetail(s) {
    const t = stype(s.type), d = s.data || {};
    const out = C.relations.filter(r => r.subject_id === s.id), inc = C.relations.filter(r => r.target_kind === 'subject' && r.target_id === s.id);
    const models = C.models.filter(m => m.manufacturer_id === s.id), units = C.units.filter(u => u.holder_id === s.id);
    return `<div class="sc-head"><input class="input sc-name" data-fk="name" value="${H(s.name)}">
        <select class="select" data-fk="type">${(cfg().subject_types || []).map(x => `<option value="${H(x.id)}"${x.id === s.type ? ' selected' : ''}>${H(x.label)}</option>`).join('')}</select>
        <button class="btn tiny" data-archsub>${s.archived ? 'Obnovit z archivu' : 'Archivovat'}</button><button class="btn tiny danger" data-delsub>Smazat</button></div>
      <p class="fine">ID ${H(s.id)}${s.archived ? ' · archivováno' : ''}</p>
      <div class="sc-fields">${visibleFields(t.fields, d).map(f => fieldInput(f, d[f.id], f.id)).join('') || '<p class="fine">Tento typ nemá žádná pole – doplníte je v Nastavení polí.</p>'}</div>
      ${s.type === 'vyrobce' || models.length ? `<h3>Výrobky (${models.length})</h3><table class="sc-tbl"><tr><th>Výrobek</th><th>Obecný produkt</th><th>Kusů v provozu</th><th></th></tr>
        ${models.map(m => `<tr class="${m.archived ? 'arch' : ''}"><td><b>${H(m.name)}</b></td><td>${H(prod(m.product_id)?.name || '?')}</td><td>${C.units.filter(u => u.model_id === m.id).length}</td><td><button class="btn tiny" data-openprod="${H(m.product_id)}">Otevřít v Produktech</button></td></tr>`).join('')}</table>
        <div class="sc-add"><select class="select" data-newmodel-p><option value="">Obecný produkt…</option>${C.products.filter(p => !p.archived).map(p => `<option value="${H(p.id)}">${H(p.name)}</option>`).join('')}</select><input class="input" data-newmodel-n placeholder="Obchodní název výrobku"><button class="btn" data-newmodel>+ Výrobek</button></div>` : ''}
      <h3>Kusy u tohoto subjektu (${units.length})</h3>
      ${units.length ? `<table class="sc-tbl"><tr><th>Výrobek</th><th>Výrobní číslo</th><th>Umístění</th><th>Stav</th><th></th></tr>${units.map(u => `<tr class="${u.archived ? 'arch' : ''}"><td>${H(modelName(model(u.model_id)))}</td><td>${H(u.data.sn)}</td><td>${H(u.data.umisteni)}</td><td>${H(u.data.stav)}</td><td><button class="btn tiny" data-unit="${H(u.id)}">Upravit</button></td></tr>`).join('')}</table>` : '<p class="fine">Žádné kusy.</p>'}
      <div class="sc-add"><select class="select" data-newunit-m><option value="">Výrobek…</option>${C.models.filter(m => !m.archived).map(m => `<option value="${H(m.id)}">${H(modelName(m))}</option>`).join('')}</select><button class="btn" data-newunit>+ Kus</button></div>
      <h3>Vztahy</h3>${relTable(out, true)}
      <div class="sc-add"><select class="select" data-newrel-k><option value="">Druh vztahu…</option>${(cfg().relation_kinds || []).map(k => `<option value="${H(k.id)}">${H(k.label)}</option>`).join('')}</select>
        <select class="select" data-newrel-t disabled><option value="">nejdřív zvolte druh</option></select><button class="btn" data-newrel>+ Vztah</button></div>
      ${inc.length ? `<h3>Vztahy k tomuto subjektu</h3>${relTable(inc, false)}` : ''}`;
  }
  function relTable(rels, own) {
    if (!rels.length) return '<p class="fine">Žádné vztahy.</p>';
    const rf = cfg().relation_fields || [];
    return `<table class="sc-tbl"><tr><th>${own ? 'Vztah' : 'Kdo'}</th><th>${own ? 'K čemu' : 'Vztah'}</th><th>Podrobnosti</th><th></th></tr>${rels.map(r => `<tr><td>${own ? H(rk(r.kind).label) : H(sub(r.subject_id)?.name || '?')}</td><td>${own ? H(targetName(r)) : H(rk(r.kind).label)}</td>
      <td class="fine">${rf.filter(f => r.data?.[f.id]).map(f => `${H(f.label)}: ${H(f.type === 'date' ? fmtDate(r.data[f.id]) : r.data[f.id])}`).join(' · ')}</td>
      <td><button class="btn tiny" data-rel="${r.id}">Upravit</button>${own ? ` <button class="btn tiny danger" data-reldel="${r.id}">×</button>` : ''}</td></tr>`).join('')}</table>`;
  }
  function bindSubject(el, s) {
    bindData(el, 'subject', s);
    el.querySelector('[data-archsub]').onclick = () => act(rpc('rq_sim_cat_save', { p_kind: 'subject', p_id: s.id, p_patch: { archived: !s.archived } }), s.archived ? 'Obnoveno.' : 'Archivováno.');
    el.querySelector('[data-delsub]').onclick = () => { if (confirm(`Smazat „${s.name}“? (Jde jen u nepoužitého subjektu, jinak archivujte.)`)) act(rpc('rq_sim_cat_delete', { p_kind: 'subject', p_id: s.id }).then(() => { selSub = null; }), 'Smazáno.'); };
    el.querySelectorAll('[data-openprod]').forEach(b => b.onclick = () => { selProd = b.dataset.openprod; setPage('simprod'); });
    el.querySelector('[data-newmodel]')?.addEventListener('click', () => {
      const p = el.querySelector('[data-newmodel-p]').value, n = el.querySelector('[data-newmodel-n]').value.trim();
      if (!p || !n) return toast('Vyberte obecný produkt a zadejte obchodní název.', true);
      act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: null, p_patch: { product_id: p, manufacturer_id: s.id, name: n } }), 'Výrobek přidán.');
    });
    el.querySelector('[data-newunit]').onclick = () => { const m = el.querySelector('[data-newunit-m]').value; if (!m) return toast('Vyberte výrobek.', true);
      act(rpc('rq_sim_cat_save', { p_kind: 'unit', p_id: null, p_patch: { model_id: m, holder_id: s.id, data: { stav: 'V provozu', sw: model(m)?.data?.sw } } }), 'Kus přidán – doplňte výrobní číslo a další údaje.'); };
    el.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => unitDialog(C.units.find(u => u.id === b.dataset.unit)));
    const kSel = el.querySelector('[data-newrel-k]'), tSel = el.querySelector('[data-newrel-t]');
    kSel.onchange = () => { const k = rk(kSel.value); tSel.disabled = !kSel.value;
      tSel.innerHTML = !kSel.value ? '<option value="">nejdřív zvolte druh</option>' : k.target === 'subject'
        ? `<option value="">Subjekt…</option>${C.subjects.filter(x => x.id !== s.id && !x.archived).map(x => `<option value="${H(x.id)}">${H(x.name)} (${H(stype(x.type).label)})</option>`).join('')}`
        : `<option value="">Výrobek…</option>${C.models.filter(m => !m.archived).map(m => `<option value="${H(m.id)}">${H(modelName(m))}</option>`).join('')}`; };
    el.querySelector('[data-newrel]').onclick = () => { if (!kSel.value || !tSel.value) return toast('Zvolte druh vztahu a cíl.', true);
      act(rpc('rq_sim_rel_save', { p_id: null, p_patch: { subject_id: s.id, kind: kSel.value, target_kind: rk(kSel.value).target, target_id: tSel.value, data: {} } }).then(id => relDialog(C.relations.find(r => r.id === id) || { id })), null); };
    el.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => relDialog(C.relations.find(r => r.id === +b.dataset.rel)));
    el.querySelectorAll('[data-reldel]').forEach(b => b.onclick = () => { if (confirm('Smazat vztah?')) act(rpc('rq_sim_rel_delete', { p_id: +b.dataset.reldel }), 'Vztah smazán.'); });
  }
  function dialog(title, inner, onBind) {
    document.getElementById('scDlg')?.remove();
    const box = document.createElement('div'); box.id = 'scDlg'; box.className = 'sim-overlay';
    box.innerHTML = `<div class="sim-modal" style="width:min(680px,100%)"><h2>${H(title)}</h2>${inner}<div class="modal-actions"><button class="btn accent" data-x>Hotovo</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('[data-x]').onclick = async () => { box.remove(); await load(true); render(); };
    onBind(box);
  }
  function unitDialog(u) {
    if (!u) return;
    const m = model(u.model_id);
    dialog(`Kus – ${modelName(m)}`, `<div class="sc-fields">${(cfg().unit_fields || []).map(f => fieldInput(f, u.data?.[f.id], f.id)).join('')}
      <label class="sc-f"><span>U subjektu</span><select class="select" data-holder><option value="">—</option>${C.subjects.filter(s => !s.archived).map(s => `<option value="${H(s.id)}"${s.id === u.holder_id ? ' selected' : ''}>${H(s.name)}</option>`).join('')}</select></label></div>
      <p><button class="btn tiny" data-uarch>${u.archived ? 'Obnovit' : 'Archivovat kus'}</button> <button class="btn tiny danger" data-udel>Smazat kus</button></p>`, box => {
      box.querySelectorAll('[data-fk]').forEach(el => el.onchange = async () => { const d = { ...(u.data || {}) }, v = readVal(el); if (v === undefined) delete d[el.dataset.fk]; else d[el.dataset.fk] = v; u.data = d;
        try { await rpc('rq_sim_cat_save', { p_kind: 'unit', p_id: u.id, p_patch: { data: d } }); flash(el); } catch (e) { toast(e.message, true); } });
      box.querySelector('[data-holder]').onchange = async e => { try { await rpc('rq_sim_cat_save', { p_kind: 'unit', p_id: u.id, p_patch: { holder_id: e.target.value } }); flash(e.target); } catch (er) { toast(er.message, true); } };
      box.querySelector('[data-uarch]').onclick = async () => { await rpc('rq_sim_cat_save', { p_kind: 'unit', p_id: u.id, p_patch: { archived: !u.archived } }); box.querySelector('[data-x]').click(); };
      box.querySelector('[data-udel]').onclick = async () => { if (!confirm('Smazat kus?')) return; try { await rpc('rq_sim_cat_delete', { p_kind: 'unit', p_id: u.id }); box.querySelector('[data-x]').click(); } catch (e) { toast(e.message, true); } };
    });
  }
  function relDialog(r) {
    if (!r || !r.subject_id) { load(true).then(() => { const x = C.relations.find(y => y.id === r?.id); if (x) relDialog(x); else render(); }); return; }
    dialog(`${sub(r.subject_id)?.name} – ${rk(r.kind).label} – ${targetName(r)}`, `<div class="sc-fields">${(cfg().relation_fields || []).map(f => fieldInput(f, r.data?.[f.id], f.id)).join('')}</div>`, box => {
      box.querySelectorAll('[data-fk]').forEach(el => el.onchange = async () => { const d = { ...(r.data || {}) }, v = readVal(el); if (v === undefined) delete d[el.dataset.fk]; else d[el.dataset.fk] = v; r.data = d;
        try { await rpc('rq_sim_rel_save', { p_id: r.id, p_patch: { data: d } }); flash(el); } catch (e) { toast(e.message, true); } });
    });
  }

  /* ---------- Produkty ---------- */
  function renderProducts(box) {
    const list = C.products.filter(p => (showArch || !p.archived) && (!q || (p.name + ' ' + JSON.stringify(p.data)).toLowerCase().includes(q.toLowerCase())));
    if (!selProd && list.length) selProd = list[0].id;
    const p = prod(selProd);
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">SIMULACE / KATALOG</div><h1>Produkty</h1>
      <p>Obecné zdravotnické prostředky (druhy) a jejich vlastnosti – včetně měřicí funkce a zdroje ionizujícího záření. Výrobky konkrétních výrobců vlastnosti dědí a smí je přepsat; kusy evidují subjekty.</p></div>
      <div class="head-actions"><button class="btn accent" data-newprod>+ Obecný produkt</button></div></div>
      <div class="sc-split"><aside class="sc-list"><input class="input" placeholder="Hledat…" data-q value="${H(q)}"><label class="fine"><input type="checkbox" data-arch${showArch ? ' checked' : ''}> i archivované</label>
        ${list.map(x => `<button class="sc-item${x.id === selProd ? ' on' : ''}${x.archived ? ' arch' : ''}" data-sel="${H(x.id)}">${H(x.name)}<small>${(n => `${n} ${n === 1 ? 'výrobek' : n > 1 && n < 5 ? 'výrobky' : 'výrobků'}`)(C.models.filter(m => m.product_id === x.id).length)}</small></button>`).join('')}
      </aside><section class="sc-detail">${p ? productDetail(p) : '<p class="fine">Vyberte produkt.</p>'}</section></div>`;
    box.querySelector('[data-q]').oninput = e => { q = e.target.value; clearTimeout(box._t); box._t = setTimeout(() => { render(); const i = box.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); }, 250); };
    box.querySelector('[data-arch]').onchange = e => { showArch = e.target.checked; render(); };
    box.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { selProd = b.dataset.sel; render(); });
    box.querySelector('[data-newprod]').onclick = () => act(rpc('rq_sim_cat_save', { p_kind: 'product', p_id: null, p_patch: { name: 'Nový zdravotnický prostředek', data: {} } }).then(id => { selProd = id; }), 'Produkt založen.');
    if (p) bindProduct(box.querySelector('.sc-detail'), p);
  }
  function productDetail(p) {
    const d = p.data || {}, pf = cfg().product_fields || [], models = C.models.filter(m => m.product_id === p.id);
    return `<div class="sc-prod-main"><div class="sc-head"><input class="input sc-name" data-fk="name" value="${H(p.name)}">
        <button class="btn tiny" data-archprod>${p.archived ? 'Obnovit z archivu' : 'Archivovat'}</button><button class="btn tiny danger" data-delprod>Smazat</button></div>
      <p class="fine">ID ${H(p.id)} · vlastnosti obecného produktu (výrobky je zdědí)</p>
      <div class="sc-fields">${visibleFields(pf, d).map(f => fieldInput(f, d[f.id], f.id)).join('')}</div></div>
      <h3>Výrobky výrobců (${models.length})</h3>
      ${models.map(m => modelCard(m, p)).join('') || '<p class="fine">Zatím žádný výrobce tento produkt nevyrábí.</p>'}
      <div class="sc-add"><select class="select" data-newmodel-m><option value="">Výrobce…</option>${C.subjects.filter(s => s.type === 'vyrobce' && !s.archived).map(s => `<option value="${H(s.id)}">${H(s.name)}</option>`).join('')}</select><input class="input" data-newmodel-n placeholder="Obchodní název"><button class="btn" data-newmodel>+ Výrobek</button></div>`;
  }
  function modelCard(m, p) {
    const d = m.data || {}, pf = cfg().product_fields || [], over = pf.filter(f => f.id in d);
    const rels = C.relations.filter(r => r.target_kind === 'model' && r.target_id === m.id), units = C.units.filter(u => u.model_id === m.id);
    const holders = {}; units.forEach(u => { const n = sub(u.holder_id)?.name || '(bez subjektu)'; holders[n] = (holders[n] || 0) + 1; });
    return `<details class="sc-model${m.archived ? ' arch' : ''}" data-model="${H(m.id)}"><summary><b>${H(m.name)}</b> <span class="fine">${H(sub(m.manufacturer_id)?.name || '?')} · ${units.length} kusů · ${rels.length} vztahů${over.length ? ` · přepsáno: ${over.map(f => H(f.label)).join(', ')}` : ''}</span></summary>
      <div class="sc-head"><input class="input sc-name" data-mk="name" value="${H(m.name)}"><select class="select" data-mk="manufacturer_id">${C.subjects.filter(s => s.type === 'vyrobce').map(s => `<option value="${H(s.id)}"${s.id === m.manufacturer_id ? ' selected' : ''}>${H(s.name)}</option>`).join('')}</select>
        <button class="btn tiny" data-march>${m.archived ? 'Obnovit' : 'Archivovat'}</button><button class="btn tiny danger" data-mdel>Smazat</button></div>
      <div class="sc-fields">${(cfg().model_fields || []).map(f => fieldInput(f, d[f.id], f.id)).join('')}</div>
      <h4>Vlastnosti zděděné z obecného produktu</h4>
      <table class="sc-tbl">${visibleFields(pf, { ...p.data, ...d }).map(f => { const own = f.id in d, val = own ? d[f.id] : p.data?.[f.id];
        return `<tr><td>${H(f.label)}</td><td>${own ? `<span class="sc-over">${fieldInput(f, val, f.id).replace(/<label class="sc-f[^"]*">(<span>[^<]*<\/span>)?/, '').replace(/<\/label>$/, '')}</span>` : `<span class="fine">${H(f.type === 'bool' ? (val ? 'ano' : 'ne') : val ?? '—')}</span>`}</td>
          <td>${own ? `<button class="btn tiny" data-unover="${H(f.id)}">Zpět na zděděné</button>` : `<button class="btn tiny" data-over="${H(f.id)}">Přepsat</button>`}</td></tr>`; }).join('')}</table>
      <h4>Kdo s výrobkem pracuje</h4>
      <ul class="sc-who"><li><b>${H(sub(m.manufacturer_id)?.name || '?')}</b> – výrobce</li>
        ${rels.map(r => `<li><b>${H(sub(r.subject_id)?.name || '?')}</b> – ${H(rk(r.kind).label)}${r.data?.cislo ? ` (${H(r.data.cislo)})` : ''}${r.data?.do ? `, do ${H(fmtDate(r.data.do))}` : ''}</li>`).join('')}
        ${Object.entries(holders).map(([n, k]) => `<li><b>${H(n)}</b> – provozuje ${k} ${k === 1 ? 'kus' : k < 5 ? 'kusy' : 'kusů'}</li>`).join('')}</ul>
      <p class="fine">Vztahy (distribuce, servis, certifikát…) zadáte u subjektu v Subjektech.</p></details>`;
  }
  function bindProduct(el, p) {
    bindData(el.querySelector('.sc-prod-main'), 'product', p);
    el.querySelector('[data-archprod]').onclick = () => act(rpc('rq_sim_cat_save', { p_kind: 'product', p_id: p.id, p_patch: { archived: !p.archived } }), p.archived ? 'Obnoveno.' : 'Archivováno.');
    el.querySelector('[data-delprod]').onclick = () => { if (confirm(`Smazat „${p.name}“?`)) act(rpc('rq_sim_cat_delete', { p_kind: 'product', p_id: p.id }).then(() => { selProd = null; }), 'Smazáno.'); };
    el.querySelector('[data-newmodel]').onclick = () => { const s = el.querySelector('[data-newmodel-m]').value, n = el.querySelector('[data-newmodel-n]').value.trim();
      if (!s || !n) return toast('Vyberte výrobce a zadejte obchodní název.', true);
      act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: null, p_patch: { product_id: p.id, manufacturer_id: s, name: n } }), 'Výrobek přidán.'); };
    el.querySelectorAll('[data-model]').forEach(card => {
      const m = model(card.dataset.model); if (!m) return;
      card.addEventListener('toggle', () => { card.open ? openModels.add(m.id) : openModels.delete(m.id); });
      if (openModels.has(m.id)) card.open = true;
      card.querySelectorAll('[data-fk]').forEach(inp => inp.addEventListener('change', async () => {
        const d = { ...(m.data || {}) }, v = readVal(inp); if (v === undefined && !(inp.dataset.ft === 'bool')) delete d[inp.dataset.fk]; else d[inp.dataset.fk] = inp.dataset.ft === 'bool' ? !!inp.checked : v; m.data = d;
        try { await rpc('rq_sim_cat_save', { p_kind: 'model', p_id: m.id, p_patch: { data: d } }); flash(inp); } catch (e) { toast(e.message, true); }
      }));
      card.querySelectorAll('[data-mk]').forEach(inp => inp.addEventListener('change', () => act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: m.id, p_patch: { [inp.dataset.mk]: inp.value } }), null)));
      card.querySelectorAll('[data-over]').forEach(b => b.onclick = () => { const d = { ...(m.data || {}) }; d[b.dataset.over] = p.data?.[b.dataset.over] ?? (pfDef(b.dataset.over)?.type === 'bool' ? false : ''); act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: m.id, p_patch: { data: d } }), null); });
      card.querySelectorAll('[data-unover]').forEach(b => b.onclick = () => { const d = { ...(m.data || {}) }; delete d[b.dataset.unover]; act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: m.id, p_patch: { data: d } }), null); });
      card.querySelector('[data-march]').onclick = () => act(rpc('rq_sim_cat_save', { p_kind: 'model', p_id: m.id, p_patch: { archived: !m.archived } }), null);
      card.querySelector('[data-mdel]').onclick = () => { if (confirm(`Smazat výrobek „${m.name}“?`)) act(rpc('rq_sim_cat_delete', { p_kind: 'model', p_id: m.id }), 'Smazáno.'); };
    });
  }
  const openModels = new Set();
  const pfDef = id => (cfg().product_fields || []).find(f => f.id === id);

  /* ---------- Nastavení polí ---------- */
  const TYPES = [['text', 'Text'], ['number', 'Číslo'], ['date', 'Datum'], ['bool', 'Ano / ne'], ['select', 'Výběr'], ['subject', 'Odkaz na subjekt']];
  const slug = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'pole';
  function fieldsEditor(list, key, boolPool) {
    return `<table class="sc-tbl sc-cfg"><tr><th>Popisek</th><th>Typ</th><th>Možnosti (u výběru, oddělte čárkou)</th><th>Zobrazit jen když</th><th>ID</th><th></th></tr>
      ${list.map((f, i) => `<tr><td><input class="input" data-cf="${key}.${i}.label" value="${H(f.label)}"></td>
        <td><select class="select" data-cf="${key}.${i}.type">${TYPES.map(([v, l]) => `<option value="${v}"${(f.type || 'text') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${f.type === 'select' ? `<input class="input" data-cfopt="${key}.${i}" value="${H((f.options || []).join(', '))}">` : f.type === 'subject' ? `<select class="select" data-cf="${key}.${i}.subject_type"><option value="">libovolný typ</option>${(cfgDraft.subject_types || []).map(t => `<option value="${H(t.id)}"${t.id === f.subject_type ? ' selected' : ''}>${H(t.label)}</option>`).join('')}</select>` : ''}</td>
        <td>${boolPool ? `<select class="select" data-cf="${key}.${i}.when"><option value="">vždy</option>${boolPool.filter(b => b.id !== f.id).map(b => `<option value="${H(b.id)}"${b.id === f.when ? ' selected' : ''}>${H(b.label)}</option>`).join('')}</select>` : ''}</td>
        <td class="fine">${H(f.id)}</td><td><button class="btn tiny" data-cmv="${key}.${i}.-1">↑</button><button class="btn tiny" data-cmv="${key}.${i}.1">↓</button><button class="btn tiny danger" data-cdel="${key}.${i}">×</button></td></tr>`).join('')}</table>
      <button class="btn tiny" data-cadd="${key}">+ pole</button>`;
  }
  const cget = p => p.split('.').reduce((o, k) => o?.[/^\d+$/.test(k) ? +k : k], cfgDraft);
  function renderConfig(box) {
    if (!cfgDraft) cfgDraft = JSON.parse(JSON.stringify(cfg()));
    const D = cfgDraft, bools = (D.product_fields || []).filter(f => f.type === 'bool');
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">SIMULACE / KATALOG</div><h1>Nastavení polí</h1>
      <p>Jaké údaje se u subjektů, produktů, výrobků, kusů a vztahů evidují. Nové pole se objeví ve formulářích; ve scénáři pak určíte, zda ho student uvidí. ID polí se nemění (scénáře na ně odkazují).</p></div>
      <div class="head-actions"><button class="btn" data-creset>Zahodit změny</button><button class="btn accent" data-csave>Uložit nastavení</button></div></div>
      <h2>Typy subjektů</h2>${(D.subject_types || []).map((t, i) => `<details class="se-card"><summary><b>${H(t.label)}</b> <span class="fine">${(t.fields || []).length} polí · ID ${H(t.id)}</span></summary>
        <label class="sc-f"><span>Název typu</span><input class="input" data-cf="subject_types.${i}.label" value="${H(t.label)}"></label>${fieldsEditor(t.fields || [], `subject_types.${i}.fields`, null)}
        <p><button class="btn tiny danger" data-cdel="subject_types.${i}">Smazat typ</button></p></details>`).join('')}
      <button class="btn tiny" data-caddtype>+ typ subjektu</button>
      <h2>Obecný produkt (ZP)</h2><p class="fine">„Zobrazit jen když“ – pole se ukáže, jen když je zaškrtnuta vlastnost (např. stanovené měřidlo jen u produktu s měřicí funkcí).</p>${fieldsEditor(D.product_fields || [], 'product_fields', bools)}
      <h2>Výrobek výrobce</h2>${fieldsEditor(D.model_fields || [], 'model_fields', null)}
      <h2>Kus</h2>${fieldsEditor(D.unit_fields || [], 'unit_fields', null)}
      <h2>Druhy vztahů</h2><table class="sc-tbl"><tr><th>Název</th><th>Vztah k</th><th>ID</th><th></th></tr>${(D.relation_kinds || []).map((k, i) => `<tr><td><input class="input" data-cf="relation_kinds.${i}.label" value="${H(k.label)}"></td>
        <td><select class="select" data-cf="relation_kinds.${i}.target"><option value="model"${k.target === 'model' ? ' selected' : ''}>výrobku</option><option value="subject"${k.target === 'subject' ? ' selected' : ''}>subjektu</option></select></td><td class="fine">${H(k.id)}</td><td><button class="btn tiny danger" data-cdel="relation_kinds.${i}">×</button></td></tr>`).join('')}</table>
      <button class="btn tiny" data-caddrel>+ druh vztahu</button>
      <h2>Podrobnosti vztahů</h2>${fieldsEditor(D.relation_fields || [], 'relation_fields', null)}`;
    const setP = (p, v) => { const ks = p.split('.').map(k => /^\d+$/.test(k) ? +k : k), last = ks.pop(); const o = ks.reduce((a, k) => a[k], D); if (v === '' || v === undefined) delete o[last]; else o[last] = v; };
    box.querySelectorAll('[data-cf]').forEach(el => el.onchange = () => { setP(el.dataset.cf, el.value); if (el.tagName === 'SELECT') renderConfig(box); });
    box.querySelectorAll('[data-cfopt]').forEach(el => el.onchange = () => { cget(el.dataset.cfopt).options = el.value.split(',').map(x => x.trim()).filter(Boolean); });
    box.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { if (!confirm('Odebrat? Hodnoty u položek zůstanou uložené, jen se přestanou zobrazovat.')) return; const ks = b.dataset.cdel.split('.'), i = +ks.pop(); cget(ks.join('.')).splice(i, 1); renderConfig(box); });
    box.querySelectorAll('[data-cmv]').forEach(b => b.onclick = () => { const ks = b.dataset.cmv.split('.'), d = +ks.pop(), i = +ks.pop(), L = cget(ks.join('.')), j = i + d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; renderConfig(box); });
    box.querySelectorAll('[data-cadd]').forEach(b => b.onclick = () => { const L = cget(b.dataset.cadd) || []; const label = prompt('Popisek nového pole:'); if (!label) return;
      let id = slug(label); const ids = new Set(L.map(f => f.id)); while (ids.has(id)) id += '_2'; L.push({ id, label, type: 'text' }); renderConfig(box); });
    box.querySelector('[data-caddtype]').onclick = () => { const label = prompt('Název nového typu subjektu:'); if (!label) return; D.subject_types.push({ id: slug(label), label, fields: [{ id: 'sidlo', label: 'Sídlo', type: 'text' }] }); renderConfig(box); };
    box.querySelector('[data-caddrel]').onclick = () => { const label = prompt('Název druhu vztahu (např. „Pronajímá“):'); if (!label) return; (D.relation_kinds = D.relation_kinds || []).push({ id: slug(label), label, target: 'model' }); renderConfig(box); };
    box.querySelector('[data-creset]').onclick = () => { cfgDraft = null; renderConfig(box); };
    box.querySelector('[data-csave]').onclick = async () => { try { await rpc('rq_sim_cat_config', { p_config: D }); await load(true); cfgDraft = null; renderConfig(box); toast('Nastavení uloženo.'); } catch (e) { toast(e.message, true); } };
  }

  let pageNow = 'simsub';
  async function render(p) {
    if (p) pageNow = p;
    const box = document.getElementById(pageNow === 'simsub' ? 'simSubContent' : pageNow === 'simprod' ? 'simProdContent' : 'simCfgContent'); if (!box) return;
    if (!C) { box.innerHTML = '<p class="fine">Načítám…</p>'; try { await load(); } catch (e) { box.innerHTML = `<div class="notice">${H(e.message)}</div>`; return; } }
    if (pageNow === 'simsub') renderSubjects(box); else if (pageNow === 'simprod') renderProducts(box); else renderConfig(box);
  }
  return { render, load, data: () => C };
})();
