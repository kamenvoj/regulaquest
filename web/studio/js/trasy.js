'use strict';
/* RegulaQuest Studio – trasy: seřazené průchody dokumenty s komentářem ke každému kroku.
   Krok = ustanovení (volitelně konkrétní místo v textu) nebo samostatný text (úvod, shrnutí).
   Kroky se přidávají z textu ustanovení („⇢ Do trasy“) nebo zde. Studenti vidí jen zveřejněné trasy po publikaci. */
window.RQPaths = (function () {
  let current = null;                 // otevřená trasa
  let lastPath = null;                // poslední trasa, do které se přidávalo
  const STATUS = { draft: 'Koncept', published: 'Zveřejněná', archived: 'Archivovaná' };
  const paths = () => db.paths || [];
  const kroku = n => `${n} ${n === 1 ? 'krok' : n >= 2 && n <= 4 ? 'kroky' : 'kroků'}`;
  const steps = id => (db.path_steps || []).filter(s => s.path_id === id).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const previewUrl = id => { const a = document.querySelector('[data-reader="?nahled=pracovni"]'); return a ? a.href + '#/t/' + encodeURIComponent(id) : '#'; };
  const tagFor = s => s === 'published' ? '<span class="tag good">Zveřejněná</span>' : s === 'archived' ? '<span class="tag bad">Archivovaná</span>' : '<span class="tag warn">Koncept</span>';

  async function run(fn, msg) {
    try { const r = await fn(); await refresh(); if (msg) toast(msg); return r; }
    catch (e) { toast(e.message, true); return null; }
  }

  function render() {
    const box = $('#pathsContent'); if (!box) return;
    if (current && !paths().some(p => p.id === current)) current = null;
    if (!current && paths().length) current = paths()[0].id;
    const p = paths().find(x => x.id === current);
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">04 / VÝUKA</div><h1>Trasy</h1>
      <p>Průchod několika místy předpisů a metodik v daném pořadí, s vaším komentářem ke každému kroku – např. „Klasifikace softwaru: čl. 2 → příloha VIII → pravidlo 11 → MDCG 2019-11“.
      Kroky přidáte i přímo z textu ustanovení tlačítkem <strong>⇢ Do trasy</strong> (celé ustanovení) nebo z lišty po označení textu (konkrétní místo).</p></div>
      <button class="btn accent" id="pNew" type="button">+ Nová trasa</button></div>
      <div class="paths-layout"><aside class="paths-list">${paths().map(x => `<button type="button" class="path-item${x.id === current ? ' active' : ''}" data-path="${esc(x.id)}">
        <strong>${esc(x.title)}</strong><span>${kroku(steps(x.id).length)} · ${STATUS[x.status] || x.status}</span></button>`).join('') || '<p class="fine">Zatím žádná trasa.</p>'}</aside>
      <section class="path-edit">${p ? editor(p) : '<div class="empty">Založte první trasu.</div>'}</section></div>`;
    box.querySelector('#pNew').onclick = newPath;
    box.querySelectorAll('[data-path]').forEach(b => b.onclick = () => { current = b.dataset.path; render(); });
    if (p) bind(box, p);
  }

  function stepHtml(s, i, n) {
    const u = s.unit_id ? getUnit(s.unit_id) : null;
    const where = s.unit_id ? (u ? esc(fullname(u.id)) : '<span class="tag bad">Ustanovení nenalezeno (archivovaný dokument?)</span>') : '<em>Samostatný text (úvod, shrnutí…)</em>';
    return `<div class="step-row" data-step="${esc(s.id)}"><div class="step-n">${i + 1}</div>
      <div class="step-main"><div class="step-where">${where}${u ? ` <button type="button" class="linklike inline" data-open="${esc(u.id)}">otevřít ↗</button>` : ''}</div>
       ${s.anchor_text ? `<div class="anchor-preview"><span class="smallcaps">Místo v textu</span><span class="rq-anc">„${esc(s.anchor_text)}“</span></div>` : ''}
       <input class="input step-title" value="${esc(s.title)}" placeholder="Nadpis kroku (nepovinné, např. „Kdy je software prostředkem“)" maxlength="200">
       <textarea class="textarea step-note" rows="3" placeholder="Komentář ke kroku: na co se zaměřit, proč je to důležité, co si zapamatovat…">${esc(s.note)}</textarea>
       <div class="actionrow"><button type="button" class="btn tiny accent step-save" disabled>Uložit krok</button>
        <button type="button" class="btn tiny" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Posunout nahoru">↑</button>
        <button type="button" class="btn tiny" data-move="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Posunout dolů">↓</button>
        ${s.anchor_text ? '<button type="button" class="btn tiny" data-unanchor>Celé ustanovení</button>' : ''}
        <button type="button" class="btn tiny danger" data-del>Odebrat</button></div></div></div>`;
  }

  function editor(p) {
    const st = steps(p.id);
    return `<div class="path-head"><label class="form-field"><span>Název trasy</span><input class="input" id="pTitle" value="${esc(p.title)}" maxlength="200"></label>
      <label class="form-field"><span>Úvod pro studenty</span><textarea class="textarea" id="pDesc" rows="3" placeholder="Co se v trase naučí, pro koho je, kolik času zabere…">${esc(p.description)}</textarea></label>
      <div class="path-tools">${select('Stav', 'pStatus', Object.entries(STATUS), p.status)}
       <button type="button" class="btn accent" id="pSave">Uložit trasu</button>
       <a class="btn" href="${previewUrl(p.id)}" target="_blank" rel="noopener">Náhled ve čtečce ↗</a>
       <button type="button" class="btn danger" id="pDelete">Smazat trasu</button></div>
      ${p.status === 'published' ? '<p class="fine">Zveřejněná trasa se studentům ukáže po příští publikaci. Kroky na neověřená ustanovení se nezobrazí.</p>' : ''}</div>
      <h3 class="steps-h">Kroky (${st.length})</h3>
      <div class="steps">${st.map((s, i) => stepHtml(s, i, st.length)).join('') || '<p class="fine">Trasa zatím nemá kroky. Otevřete ustanovení v Práci s dokumentem a klepněte na „⇢ Do trasy“.</p>'}</div>
      <button type="button" class="btn" id="pAddText">+ Krok jen s textem (úvod, shrnutí)</button>`;
  }

  function bind(box, p) {
    const sel = box.querySelector('[name=pStatus]');
    box.querySelector('#pSave').onclick = () => run(() => rpc('rq_save_path', { p_id: p.id, p_title: box.querySelector('#pTitle').value.trim() || p.title, p_description: box.querySelector('#pDesc').value, p_status: sel.value }), 'Trasa uložena.');
    box.querySelector('#pDelete').onclick = () => { if (confirm(`Smazat trasu „${p.title}“ i se všemi kroky?`)) run(() => rpc('rq_delete_path', { p_id: p.id }), 'Trasa smazána.'); };
    box.querySelector('#pAddText').onclick = () => run(() => rpc('rq_save_path_step', { p_id: '', p_path_id: p.id, p_unit_id: '', p_title: 'Shrnutí', p_note: 'Doplňte text kroku.' }), 'Krok přidán.');
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openUnit(b.dataset.open));
    box.querySelectorAll('.step-row').forEach(row => {
      const s = (db.path_steps || []).find(x => x.id === row.dataset.step);
      const title = row.querySelector('.step-title'), note = row.querySelector('.step-note'), save = row.querySelector('.step-save');
      const dirty = () => save.disabled = title.value.trim() === s.title && note.value.trim() === s.note;
      title.oninput = dirty; note.oninput = dirty;
      const put = (extra = {}) => rpc('rq_save_path_step', { p_id: s.id, p_path_id: p.id, p_unit_id: s.unit_id || '', p_title: title.value, p_note: note.value,
        p_anchor_text: s.anchor_text, p_anchor_occurrence: s.anchor_occurrence, ...extra });
      save.onclick = () => run(() => put(), 'Krok uložen.');
      const un = row.querySelector('[data-unanchor]'); if (un) un.onclick = () => run(() => put({ p_anchor_text: '', p_anchor_occurrence: 1 }), 'Krok míří na celé ustanovení.');
      row.querySelectorAll('[data-move]').forEach(b => b.onclick = () => run(() => rpc('rq_move_path_step', { p_id: s.id, p_dir: +b.dataset.move })));
      row.querySelector('[data-del]').onclick = () => { if (confirm('Odebrat krok z trasy?')) run(() => rpc('rq_delete_path_step', { p_id: s.id }), 'Krok odebrán.'); };
    });
  }

  async function newPath() {
    const t = prompt('Název nové trasy (např. „Klasifikace softwaru“):'); if (!t || !t.trim()) return;
    const id = await run(() => rpc('rq_save_path', { p_id: '', p_title: t.trim(), p_description: '', p_status: 'draft' }), 'Trasa založena.');
    if (id) { current = id; lastPath = id; render(); }
  }

  // Přidání kroku z textu ustanovení (celé ustanovení nebo vybrané místo).
  function addStep(u, anchor) {
    const d = $('#modal'), f = $('#modalContent'); f.onsubmit = e => e.preventDefault();
    const list = paths().filter(p => p.status !== 'archived');
    const pre = lastPath && list.some(p => p.id === lastPath) ? lastPath : (list[0]?.id || '');
    f.innerHTML = `<h2>Přidat do trasy</h2><p><strong>${esc(fullname(u.id))}</strong></p>
      ${anchor ? `<div class="anchor-preview"><span class="smallcaps">Místo v textu</span><span class="rq-anc">„${esc(anchor.text)}“</span></div>` : ''}
      <label class="form-field"><span>Trasa</span><select class="select" id="apPath">${list.map(p => `<option value="${esc(p.id)}" ${p.id === pre ? 'selected' : ''}>${esc(p.title)} (${kroku(steps(p.id).length)})</option>`).join('')}<option value="">+ Nová trasa…</option></select></label>
      <label class="form-field" id="apNewWrap" ${list.length ? 'hidden' : ''}><span>Název nové trasy</span><input class="input" id="apNew" maxlength="200"></label>
      <label class="form-field"><span>Komentář ke kroku (lze doplnit později)</span><textarea class="textarea" id="apNote" rows="3"></textarea></label>
      <div class="modal-actions"><button class="btn" type="button" id="apCancel">Zrušit</button><button class="btn accent" type="button" id="apGo">Přidat krok</button></div>`;
    const ps = f.querySelector('#apPath'), nw = f.querySelector('#apNewWrap');
    ps.onchange = () => nw.hidden = !!ps.value;
    f.querySelector('#apCancel').onclick = () => d.close();
    f.querySelector('#apGo').onclick = async () => {
      let pid = ps.value;
      if (!pid) { const t = f.querySelector('#apNew').value.trim(); if (!t) { toast('Zadejte název trasy.', true); return; }
        pid = await rpc('rq_save_path', { p_id: '', p_title: t, p_description: '', p_status: 'draft' }).catch(e => { toast(e.message, true); return null; }); if (!pid) return; }
      const ok = await run(() => rpc('rq_save_path_step', { p_id: '', p_path_id: pid, p_unit_id: u.id, p_title: '', p_note: f.querySelector('#apNote').value,
        p_anchor_text: anchor ? anchor.text : '', p_anchor_occurrence: anchor ? anchor.occurrence : 1 }), 'Krok přidán do trasy.');
      if (ok !== null) { lastPath = pid; current = pid; d.close(); }
    };
    d.showModal();
  }

  return { render, addStep, leave() {} };
})();
