'use strict';
/* RegulaQuest Studio – Prezentace: import z PowerPointu (i nová verze bez duplicit), editor snímků v jednotné šabloně,
   odkazy z částí snímku na ustanovení nebo jiný snímek (klepnutím do náhledu), poznámky řečníka, zpřístupnění skupinám od data. */
window.RQPres = (function () {
  let A = null, loading = null, open = null, P = null, cur = 0, dirty = false;
  const STATUS = { draft: 'Koncept', ready: 'Připravená', archived: 'Archivovaná' };
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const unitLabel = id => { const u = getUnit(id); if (!u) return null; const d = getDoc(u.document_id); return `${d ? d.family + ' · ' + d.language.toUpperCase() : ''} › ${u.label}${u.heading ? ' – ' + u.heading : ''}`; };
  const presTitle = id => (A && A.presentations.find(p => p.id === id) || {}).title || '';
  const slideInfo = id => A && A.slide_index.find(s => s.id === id);
  const readerUrl = () => { const a = document.querySelector('[data-reader="?nahled=pracovni"]'); return a ? a.href : '#'; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const stable = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => (a[x] = v[x], a), {}) : v);
  const linkText = l => !l ? '' : l.unit ? (unitLabel(l.unit) || 'ustanovení (nenalezeno)') : l.slide ? (() => { const s = slideInfo(l.slide); return s ? `${presTitle(s.presentation_id)} · snímek ${s.n}${s.title ? ' – ' + s.title : ''}` : 'snímek (nenalezen)'; })() : '';

  async function load(force) {
    if (A && !force) return A;
    if (!loading) loading = rpc('rq_presentations_admin', {}).then(r => { A = r; loading = null; return A; }).catch(e => { loading = null; throw e; });
    return loading;
  }
  async function loadOne(id) { P = await rpc('rq_presentation_admin', { p_id: id }); cur = Math.min(cur, P.slides.length - 1); if (cur < 0) cur = 0; dirty = false; }
  const optsFor = (n, total) => ({ n, total, deck: P ? P.title : '', edit: true, href: l => linkText(l) ? '#' : null, title: linkText });

  function pick(name, selected, items, empty) {
    const s = new Set(selected || []);
    const label = s.size ? [...s].map(k => items.find(i => i.key === k)?.name || k).join(', ') : empty;
    return `<details class="gq-pick" data-pick="${name}" data-empty="${esc(empty)}"><summary>${esc(label)}</summary><div class="gq-pick-list">
      ${items.map(i => i.group ? `<div class="gq-pick-g">${esc(i.group)}</div>` : `<label><input type="checkbox" value="${esc(i.key)}" ${s.has(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>`;
  }
  const readPick = (root, name) => [...root.querySelectorAll(`[data-pick="${name}"] input:checked`)].map(x => x.value);
  const syncPick = d => { const s = d.querySelector('summary'), on = [...d.querySelectorAll('input:checked')].map(x => x.parentElement.textContent.trim()); s.textContent = on.length ? on.join(', ') : d.dataset.empty; };
  const tagItems = () => (db.tag_groups || []).flatMap(g => [{ group: g.name }, ...(db.tags || []).filter(t => t.group_key === g.key && !t.archived).map(t => ({ key: t.key, name: t.name }))]);

  /* ---------- přehled ---------- */
  function listView() {
    const ps = A.presentations, kb = Math.round(ps.length ? JSON.stringify(A.slide_index).length / 1024 : 0);
    const gname = id => (A.groups.find(g => g.id === id) || {}).name || 'skupina';
    return `<div class="page-head"><div><div class="eyebrow">VÝUKA / PREZENTACE</div><h1>Prezentace</h1>
      <p>Prezentace v jednotné šabloně aplikace. Import z PowerPointu převezme obsah a strukturu; odkazy z částí snímků vedou na ustanovení nebo jiné snímky. Studenti vidí připravené prezentace své skupiny od nastaveného data – bez poznámek řečníka.</p></div>
      <div class="head-actions"><label class="btn accent">↧ Import z PowerPointu<input type="file" id="prImport" accept=".pptx" hidden></label><button type="button" class="btn" id="prNew">+ Prázdná prezentace</button></div></div>
      <ul class="nw-list">${ps.map(p => `<li class="nw-item"><span class="lk-st ${p.status === 'ready' ? 'published' : ''}"></span><div class="nw-main">
        <div class="nw-meta">${esc(STATUS[p.status])} · ${p.slides} snímků${p.groups.length ? ' · ' + esc(p.groups.map(g => `${gname(g.group_id)} od ${new Date(g.visible_from).toLocaleDateString('cs-CZ')}`).join(', ')) : ' · nezpřístupněná žádné skupině'}</div>
        <button type="button" class="nw-title linkish" data-open="${esc(p.id)}">${esc(p.title)}</button>${p.subtitle ? `<p class="nw-sum">${esc(p.subtitle)}</p>` : ''}</div>
        <div class="nw-act"><button type="button" class="btn tiny" data-open="${esc(p.id)}">Upravit</button><a class="btn tiny" href="${esc(readerUrl())}#/prezentace/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Náhled ↗</a></div></li>`).join('') || '<li class="nw-empty">Zatím žádné prezentace. Začněte importem z PowerPointu.</li>'}</ul>
      <p class="fine">Obsah všech snímků zabírá v databázi zhruba ${Math.max(1, Math.round(ps.reduce((a, p) => a + p.slides, 0) * 1.5))} kB (limit 500 MB). Obrázky zatím nejsou zapojené.</p>`;
  }

  /* ---------- editor prezentace ---------- */
  function headForm() {
    const gs = A.groups;
    return `<details class="gq-card pr-meta"${P.slides.length ? '' : ' open'}><summary><strong>Údaje a zpřístupnění</strong> <span class="fine">${esc(STATUS[P.status])} · ${P.groups.length ? P.groups.length + ' skupin' : 'zatím pro nikoho'}</span></summary>
      <div class="lk-grid"><label class="form-field"><span>Název</span><input class="input" id="prTitle" maxlength="200" value="${esc(P.title)}"></label>
        <label class="form-field"><span>Podtitul (autor, předmět…)</span><input class="input" id="prSub" maxlength="300" value="${esc(P.subtitle)}"></label></div>
      <label class="form-field"><span>Popis pro studenty</span><input class="input" id="prDesc" maxlength="2000" value="${esc(P.description)}"></label>
      <div class="nw-picks"><label class="form-field"><span>Stav</span><select class="select" id="prStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${P.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="form-field"><span>Oblasti</span>${pick('pa', P.area_keys, areas().map(a => ({ key: a.key, name: a.name })), '—')}</div>
        <div class="form-field"><span>Štítky</span>${pick('pt', P.tags, tagItems(), '—')}</div></div>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="btn accent" id="prSaveMeta">Uložit údaje</button></div>
      <h3>Zpřístupnění skupinám</h3><p class="fine">Studenti skupiny uvidí prezentaci ve stavu „Připravená“ od zvoleného dne.</p>
      <div class="pr-groups">${gs.map(g => { const x = P.groups.find(y => y.group_id === g.id); return `<label class="pr-group${g.active ? '' : ' off'}"><input type="checkbox" data-g="${esc(g.id)}" ${x ? 'checked' : ''}> ${esc(g.name)}<input type="date" class="input" data-gd="${esc(g.id)}" value="${x ? x.visible_from : new Date().toISOString().slice(0, 10)}"></label>`; }).join('') || '<p class="fine">Zatím nejsou založené skupiny studentů (Správa → Přístupy).</p>'}</div>
      <div class="pr-danger"><label class="btn">↧ Nahrát novou verzi z PowerPointu<input type="file" id="prReimport" accept=".pptx" hidden></label><button type="button" class="btn danger" id="prDel">Smazat prezentaci</button></div></details>`;
  }
  function paraText(ps) { return (ps || []).map(p => (p.bullet ? '- ' : '') + (p.b ? '**' + p.text + '**' : p.text)).join('\n'); }
  function textParas(t, old) {
    const byText = new Map((old || []).filter(p => p.link).map(p => [p.text, p.link]));
    return String(t || '').split('\n').map(l => l.trimEnd()).filter(l => l.trim()).map(l => {
      const bullet = /^[-•]\s+/.test(l); let text = l.replace(/^[-•]\s+/, '');
      const b = /^\*\*[^*]+\*\*$/.test(text); if (b) text = text.slice(2, -2);
      const p = { text }; if (b) p.b = true; if (bullet) p.bullet = true; if (byText.has(text)) p.link = byText.get(text); return p;
    });
  }
  const toneSel = (v, attr) => `<select class="select tiny-sel" ${attr}>${RQSlides.TONES.map(t => `<option value="${t}" ${v === t ? 'selected' : ''}>${RQSlides.TONE_NAMES[t]}</option>`).join('')}</select>`;
  function blockForm(b, i, n) {
    const tools = `<span class="pr-btools"><button type="button" class="btn tiny" data-bmv="-1" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn tiny" data-bmv="1" ${i < n - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn tiny danger" data-bdel>✕</button></span>`;
    if (b.type === 'cards') return `<div class="pr-block" data-b="${i}"><div class="pr-bh"><strong>Karty</strong><label>sloupců <select class="select tiny-sel" data-cols>${[0, 1, 2, 3, 4, 5, 6].map(c => `<option value="${c}" ${(b.cols || 0) === c ? 'selected' : ''}>${c || 'auto'}</option>`).join('')}</select></label>${tools}</div>
      ${(b.items || []).map((c, k) => `<div class="pr-card" data-c="${k}"><input class="input" data-ch value="${esc(c.heading || '')}" placeholder="Nadpis karty">${toneSel(c.tone, 'data-ct')}<button type="button" class="btn tiny danger" data-cdel>✕</button><textarea class="textarea" data-cb rows="3">${esc(paraText(c.paras))}</textarea></div>`).join('')}
      <button type="button" class="btn tiny" data-cadd>+ Karta</button></div>`;
    if (b.type === 'table') return `<div class="pr-block" data-b="${i}"><div class="pr-bh"><strong>Tabulka</strong><label><input type="checkbox" data-th ${b.header !== false ? 'checked' : ''}> první řádek je záhlaví</label>${tools}</div>
      <textarea class="textarea" data-rows rows="${Math.min(10, (b.rows || []).length + 1)}">${esc((b.rows || []).map(r => r.join(' | ')).join('\n'))}</textarea><small class="form-hint">Řádek = jeden řádek tabulky, buňky oddělte svislítkem |.</small></div>`;
    if (b.type === 'image') return `<div class="pr-block" data-b="${i}"><div class="pr-bh"><strong>Obrázek</strong>${tools}</div><p class="fine">Obrázky se doplní po zapojení úložiště (Cloudflare R2).</p></div>`;
    return `<div class="pr-block" data-b="${i}"><div class="pr-bh"><select class="select tiny-sel" data-st>${[['plain', 'Text'], ['lead', 'Úvodní text'], ['bar', 'Pruh'], ['question', 'Otázka']].map(([k, l]) => `<option value="${k}" ${(b.style || 'plain') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${toneSel(b.tone, 'data-tone')}${tools}</div>
      <textarea class="textarea" data-tx rows="${Math.min(8, (b.paras || []).length + 1)}">${esc(paraText(b.paras))}</textarea></div>`;
  }
  function slideForm(s) {
    const d = s.data, L = d.layout || 'content';
    return `<div class="pr-form">
      <div class="pr-row"><label class="form-field"><span>Typ snímku</span><select class="select" data-f="layout">${[['content', 'Obsahový'], ['title', 'Titulní'], ['section', 'Oddíl']].map(([k, l]) => `<option value="${k}" ${L === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="form-field"><span>Sekce (vpravo nahoře)</span><input class="input" data-f="kicker" value="${esc(d.kicker || '')}" placeholder="Např. II · KLASIFIKACE"></label>
        ${L === 'content' ? `<label class="form-field"><span>Štítek (vlevo nahoře)</span><input class="input" data-f="badge" value="${esc(d.badge || '')}" placeholder="Např. DISKUZE"></label>` : ''}</div>
      <label class="form-field"><span>Nadpis</span><input class="input" data-f="title" value="${esc(d.title || '')}"></label>
      ${L !== 'content' ? `<label class="form-field"><span>Podtitul</span><input class="input" data-f="subtitle" value="${esc(d.subtitle || '')}"></label>` : `
      <div class="pr-blocks">${(d.blocks || []).map((b, i) => blockForm(b, i, d.blocks.length)).join('')}</div>
      <div class="pr-add"><span class="fine">Přidat:</span>${[['text', 'Text'], ['bar', 'Pruh'], ['question', 'Otázku'], ['cards', 'Karty'], ['table', 'Tabulku']].map(([k, l]) => `<button type="button" class="btn tiny" data-add="${k}">${l}</button>`).join('')}</div>
      <label class="form-field"><span>Klíčová myšlenka (dole)</span><input class="input" data-f="key" value="${esc((d.key || {}).text || '')}"></label>`}
      <label class="form-field"><span>Poznámky řečníka (studenti je neuvidí)</span><textarea class="textarea" data-f="notes" rows="5">${esc(s.notes || '')}</textarea></label>
      <p class="fine">Formát: řádek = odstavec, odrážku začněte „- “, tučně **takto**. <b>Odkaz</b> nastavíte klepnutím na část snímku v náhledu nahoře.</p></div>`;
  }
  function editorView() {
    const s = P.slides[cur];
    return `<div class="page-head"><div><div class="eyebrow">VÝUKA / PREZENTACE</div><h1>${esc(P.title)}</h1></div>
      <div class="head-actions"><button type="button" class="btn" id="prBack">← Všechny prezentace</button><a class="btn" href="${esc(readerUrl())}#/prezentace/${encodeURIComponent(P.id)}${s ? '/' + encodeURIComponent(s.id) : ''}" target="_blank" rel="noopener">Náhled ve čtečce ↗</a></div></div>
      ${headForm()}
      <div class="pr-work"><aside class="pr-thumbs">${P.slides.map((x, i) => `<button type="button" class="pr-th${i === cur ? ' on' : ''}" data-go="${i}"><span>${i + 1}</span><div class="sl-wrap">${RQSlides.render(x.data, { deck: '' })}</div></button>`).join('')}
        <button type="button" class="btn tiny" id="prAddSlide">+ Snímek na konec</button></aside>
      <section class="pr-main">${s ? `<div class="pr-bar"><strong>Snímek ${cur + 1} / ${P.slides.length}</strong><span class="pr-dirty"${dirty ? '' : ' hidden'}>neuloženo</span><span style="flex:1"></span>
          <button type="button" class="btn tiny" data-sm="-1" ${cur ? '' : 'disabled'}>↑ Posunout</button><button type="button" class="btn tiny" data-sm="1" ${cur < P.slides.length - 1 ? '' : 'disabled'}>↓ Posunout</button>
          <button type="button" class="btn tiny" id="prDup">Duplikovat</button><button type="button" class="btn tiny" id="prInsert">+ Snímek za</button><button type="button" class="btn tiny danger" id="prDelSlide">Smazat snímek</button><button type="button" class="btn tiny accent" id="prSave">Uložit snímek</button></div>
        <div class="sl-wrap pr-stage" id="prStage">${RQSlides.render(s.data, optsFor(cur + 1, P.slides.length))}</div>
        <div id="prLinkPop" class="pr-pop" hidden></div>
        ${slideForm(s)}` : '<p class="fine">Prezentace nemá žádné snímky.</p>'}</section></div>`;
  }

  async function render() {
    const box = document.getElementById('presContent'); if (!box) return;
    try { await load(); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
    if (open && (!P || P.id !== open)) { try { await loadOne(open); } catch (e) { toast(e.message, true); open = null; } }
    box.innerHTML = open && P ? editorView() : listView();
    RQSlides.fit(box);
    bind(box);
  }
  async function run(fn, msg) { try { const r = await fn(); if (msg) toast(msg); return r ?? true; } catch (e) { toast(e.message, true); return null; } }

  /* ---------- čtení formuláře do dat snímku ---------- */
  function collect(box) {
    const s = P.slides[cur], d = s.data, f = k => box.querySelector(`.pr-form [data-f="${k}"]`);
    ['layout', 'kicker', 'badge', 'title', 'subtitle'].forEach(k => { const el = f(k); if (el) { if (el.value.trim()) d[k] = el.value.trim(); else delete d[k]; } });
    if (f('key')) { const t = f('key').value.trim(); if (t) d.key = { ...(d.key || {}), text: t }; else delete d.key; }
    s.notes = f('notes') ? f('notes').value : s.notes;
    box.querySelectorAll('.pr-block').forEach(el => {
      const b = d.blocks[+el.dataset.b]; if (!b) return;
      if (b.type === 'cards') {
        b.cols = +el.querySelector('[data-cols]').value || undefined; if (!b.cols) delete b.cols;
        el.querySelectorAll('.pr-card').forEach(ce => { const c = b.items[+ce.dataset.c]; c.heading = ce.querySelector('[data-ch]').value.trim(); c.tone = ce.querySelector('[data-ct]').value; c.paras = textParas(ce.querySelector('[data-cb]').value, c.paras); });
      } else if (b.type === 'table') {
        b.header = el.querySelector('[data-th]').checked; b.rows = el.querySelector('[data-rows]').value.split('\n').filter(l => l.trim()).map(l => l.split('|').map(c => c.trim()));
      } else if (b.type === 'text') {
        b.style = el.querySelector('[data-st]').value; b.tone = el.querySelector('[data-tone]').value; b.paras = textParas(el.querySelector('[data-tx]').value, b.paras);
      }
    });
  }
  function preview(box) {
    const st = box.querySelector('#prStage'); if (!st) return;
    st.innerHTML = RQSlides.render(P.slides[cur].data, optsFor(cur + 1, P.slides.length)); RQSlides.fit(st); bindStage(box);
    const th = box.querySelector(`.pr-th[data-go="${cur}"] .sl-wrap`); if (th) th.innerHTML = RQSlides.render(P.slides[cur].data, { deck: '' });
  }
  const markDirty = box => { dirty = true; const x = box.querySelector('.pr-dirty'); if (x) x.hidden = false; };

  /* ---------- odkazy: klepnutí na část snímku ---------- */
  function getAt(d, path) {
    if (path === 'slide') return { get: () => d.link, set: l => { if (l) d.link = l; else delete d.link; }, label: 'Nadpis (celý snímek)' };
    if (path === 'key') return { get: () => d.key && d.key.link, set: l => { if (!d.key) return; if (l) d.key.link = l; else delete d.key.link; }, label: 'Klíčová myšlenka' };
    const m = path.match(/^blocks\.(\d+)(?:\.(items)\.(\d+))?(?:\.(paras)\.(\d+))?(?:\.row\.(\d+))?$/); if (!m) return null;
    const b = d.blocks[+m[1]]; if (!b) return null;
    if (m[6] != null) { const row = +m[6]; b.links = b.links || []; return { get: () => (b.links.find(x => x.row === row) || {}).link, set: l => { b.links = b.links.filter(x => x.row !== row); if (l) b.links.push({ row, link: l }); if (!b.links.length) delete b.links; }, label: 'Řádek tabulky: ' + (b.rows[row] || []).join(' · ') }; }
    let o = b; if (m[2]) o = b.items[+m[3]]; if (m[4]) o = o.paras[+m[5]];
    return { get: () => o.link, set: l => { if (l) o.link = l; else delete o.link; }, label: (m[4] ? 'Odstavec: ' + o.text : m[2] ? 'Karta: ' + (o.heading || (o.paras[0] || {}).text || '') : 'Celý blok') };
  }
  function linkPop(box, path) {
    const pop = box.querySelector('#prLinkPop'), at = getAt(P.slides[cur].data, path); if (!at) return;
    const curL = at.get();
    pop.innerHTML = `<div class="pr-pop-h"><strong>Odkaz z části snímku</strong><button type="button" class="btn tiny" data-close>✕</button></div><p class="fine">${esc(at.label.length > 120 ? at.label.slice(0, 119) + '…' : at.label)}</p>
      ${curL ? `<p>Nyní: <b>${esc(linkText(curL))}</b> <button type="button" class="btn tiny danger" data-unl>Zrušit odkaz</button></p>` : ''}
      <div class="pr-pop-tabs"><button type="button" class="btn tiny accent" data-tab="u">Na ustanovení</button><button type="button" class="btn tiny" data-tab="s">Na snímek</button></div>
      <div data-pane="u"><input class="input" data-uq placeholder="Hledat ustanovení: např. článek 10, pravidlo 11, příloha VIII…"><div class="cs-ulist pr-res"></div></div>
      <div data-pane="s" hidden><select class="select" data-pp>${A.presentations.map(p => `<option value="${esc(p.id)}" ${p.id === P.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select><div class="cs-ulist pr-res" data-sl></div></div>
      <p class="fine">Tip: odkaz na odstavec nastavíte klepnutím přímo na jeho text, odkaz na celou kartu klepnutím na prázdné místo karty.</p>`;
    pop.hidden = false;
    const set = l => { at.set(l); markDirty(box); preview(box); pop.hidden = true; toast(l ? 'Odkaz nastaven – nezapomeňte snímek uložit.' : 'Odkaz zrušen – nezapomeňte snímek uložit.'); };
    pop.querySelector('[data-close]').onclick = () => { pop.hidden = true; };
    if (pop.querySelector('[data-unl]')) pop.querySelector('[data-unl]').onclick = () => set(null);
    pop.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { pop.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('accent', x === b)); pop.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab); });
    const q = pop.querySelector('[data-uq]'), ul = pop.querySelector('[data-pane=u] .pr-res');
    q.oninput = () => { const ts = fold(q.value).split(/\s+/).filter(Boolean); if (!ts.length) { ul.innerHTML = ''; return; }
      const xs = db.units.filter(u => !u.editor_archived && ts.every(t => fold(unitLabel(u.id)).includes(t))).slice(0, 25);
      ul.innerHTML = xs.map(u => `<button type="button" data-u="${esc(u.id)}">${esc(unitLabel(u.id))}</button>`).join('') || '<small class="fine">Nic nenalezeno.</small>';
      ul.querySelectorAll('[data-u]').forEach(b => b.onclick = () => set({ unit: b.dataset.u })); };
    const pp = pop.querySelector('[data-pp]'), sl = pop.querySelector('[data-sl]');
    const drawS = () => { const xs = A.slide_index.filter(s => s.presentation_id === pp.value).sort((a, b) => a.n - b.n);
      sl.innerHTML = xs.map(s => `<button type="button" data-s="${esc(s.id)}" ${s.id === P.slides[cur].id ? 'disabled' : ''}>${s.n}. ${esc(s.title || '(bez nadpisu)')}</button>`).join('') || '<small class="fine">Žádné snímky.</small>';
      sl.querySelectorAll('[data-s]').forEach(b => b.onclick = () => set({ slide: b.dataset.s, pres: pp.value })); };
    pp.onchange = drawS; drawS(); q.focus();
  }
  function bindStage(box) {
    const st = box.querySelector('#prStage'); if (!st) return;
    st.onclick = e => { const el = e.target.closest('[data-path]'); if (!el || !st.contains(el)) return; e.preventDefault(); linkPop(box, el.dataset.path); };
  }

  /* ---------- nová verze z PowerPointu ---------- */
  const norm = s => fold(String(s || '').replace(/\*\*/g, '')).replace(/\s+/g, ' ').trim();
  function linkMap(d) {     // identita části snímku → odkaz
    const m = new Map(); const put = (k, l) => { if (l) m.set(k, l); };
    put('slide', d.link); if (d.key) put('key', d.key.link);
    (d.blocks || []).forEach(b => {
      if (b.type === 'cards') (b.items || []).forEach(c => { put('card:' + norm(c.heading || (c.paras[0] || {}).text), c.link); (c.paras || []).forEach(p => put('p:' + norm(p.text), p.link)); });
      else if (b.type === 'table') (b.links || []).forEach(x => put('row:' + norm((b.rows[x.row] || [])[0]), x.link));
      else { put('block:' + norm((b.paras[0] || {}).text), b.link); (b.paras || []).forEach(p => put('p:' + norm(p.text), p.link)); }
    });
    return m;
  }
  function applyLinks(d, m) {
    const used = new Set(), take = k => { if (m.has(k)) { used.add(k); return m.get(k); } };
    const s1 = take('slide'); if (s1) d.link = s1; if (d.key) { const k = take('key'); if (k) d.key.link = k; }
    (d.blocks || []).forEach(b => {
      if (b.type === 'cards') (b.items || []).forEach(c => { const l = take('card:' + norm(c.heading || (c.paras[0] || {}).text)); if (l) c.link = l; (c.paras || []).forEach(p => { const x = take('p:' + norm(p.text)); if (x) p.link = x; }); });
      else if (b.type === 'table') (b.rows || []).forEach((r, i) => { const l = take('row:' + norm(r[0])); if (l) { b.links = b.links || []; b.links.push({ row: i, link: l }); } });
      else { const l = take('block:' + norm((b.paras[0] || {}).text)); if (l) b.link = l; (b.paras || []).forEach(p => { const x = take('p:' + norm(p.text)); if (x) p.link = x; }); }
    });
    return [...m.keys()].filter(k => !used.has(k));
  }
  async function reimport(file, box) {
    let r; try { r = await RQPptx.parse(file); } catch (e) { toast(e.message, true); return; }
    const old = P.slides.map((s, i) => ({ ...s, i, k1: norm(s.data.kicker) + '|' + norm(s.data.title), k2: norm(s.data.title) }));
    const free = new Set(old.map(o => o.id)), plan = [];
    r.slides.forEach(ns => { const k1 = norm(ns.data.kicker) + '|' + norm(ns.data.title), k2 = norm(ns.data.title);
      const m = old.find(o => free.has(o.id) && o.k1 === k1) || (k2 && old.find(o => free.has(o.id) && o.k2 === k2)); if (m) free.delete(m.id);
      plan.push({ ns, m }); });
    // nespárované: stejné pořadí → týž snímek se změněným nadpisem
    plan.forEach((x, i) => { if (x.m) return; const o = old[i]; if (o && free.has(o.id)) { x.m = o; free.delete(o.id); } });
    const lost = [], changed = []; let kept = 0;
    plan.forEach(x => { if (!x.m) return; const lm = linkMap(x.m.data); const miss = applyLinks(x.ns.data, lm); kept += lm.size - miss.length;
      miss.forEach(k => lost.push(`snímek „${x.m.data.title || x.m.i + 1}“: ${k.replace(/^\w+:/, '')}`));
      if (stable(x.m.data) !== stable(x.ns.data) || (x.m.notes || '') !== (x.ns.notes || '')) changed.push(x); });
    const removed = old.filter(o => free.has(o.id));
    removed.forEach(o => { const lm = linkMap(o.data); lm.forEach((l, k) => lost.push(`odstraněný snímek „${o.data.title || o.i + 1}“: ${k.replace(/^\w+:/, '')}`)); });
    const targets = removed.filter(o => A.slide_index.some(x => (x.targets || []).includes(o.id) && !free.has(x.id)) || (A.unit_links || []).some(l => l.slide_id === o.id));
    const d = $('#modal'), f = $('#modalContent'); f.onsubmit = e => e.preventDefault();
    f.innerHTML = `<h2>Nová verze: ${esc(P.title)}</h2><p>Snímky se spárují podle nadpisu a sekce. Spárované si ponechají své místo pro odkazy z jiných snímků i z ustanovení; obsah a poznámky se nahradí novou verzí.</p>
      <ul class="pr-sum"><li><b>${plan.filter(x => x.m).length}</b> spárovaných snímků (z toho ${changed.length} změněných)</li><li><b>${plan.filter(x => !x.m).length}</b> nových snímků</li><li><b>${removed.length}</b> snímků se odstraní${removed.length ? ': ' + esc(removed.map(o => o.data.title || '#' + (o.i + 1)).join(', ')) : ''}</li>
        <li><b>${kept}</b> odkazů zůstane zachováno</li></ul>
      ${lost.length ? `<div class="notice"><b>Tyto odkazy se nepřenesou</b> (část snímku se změnila nebo zmizela) – po nahrání je případně nastavte znovu:<ul>${lost.slice(0, 30).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${targets.length ? `<div class="notice"><b>Pozor:</b> na odstraněné snímky ${esc(targets.map(o => '„' + (o.data.title || '#' + (o.i + 1)) + '“').join(', '))} vede odkaz z jiného snímku nebo z ustanovení – po nahrání přestane fungovat.</div>` : ''}
      <div class="modal-actions"><button type="button" class="btn" id="riCancel">Zrušit</button><button type="button" class="btn accent" id="riGo">Nahrát novou verzi</button></div>`;
    f.querySelector('#riCancel').onclick = () => d.close();
    f.querySelector('#riGo').onclick = async () => {
      const res = await run(() => rpc('rq_replace_slides', { p_presentation_id: P.id, p_slides: plan.map(x => ({ id: x.m ? x.m.id : null, data: x.ns.data, notes: x.ns.notes })) }));
      if (res) { d.close(); toast(`Nová verze nahrána: ${res.updated} aktualizováno, ${res.inserted} nových, ${res.deleted} odstraněno.`); await load(true); await loadOne(P.id); render(); }
    };
    d.showModal();
  }

  /* ---------- obsluha ---------- */
  function bind(box) {
    box.querySelectorAll('.gq-pick').forEach(x => x.addEventListener('change', () => syncPick(x)));
    if (!open || !P) {
      box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { open = b.dataset.open; cur = 0; P = null; render(); window.scrollTo(0, 0); });
      box.querySelector('#prNew').onclick = async () => { const id = await run(() => rpc('rq_import_presentation', { p: { title: 'Nová prezentace' }, p_slides: [{ data: { layout: 'title', title: 'Nová prezentace' } }] }), 'Prezentace založena.'); if (id) { await load(true); open = id; cur = 0; render(); } };
      box.querySelector('#prImport').onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        toast('Načítám prezentaci…');
        try { const r = await RQPptx.parse(file);
          const id = await rpc('rq_import_presentation', { p: { title: r.title, subtitle: r.subtitle }, p_slides: r.slides });
          toast(`Importováno ${r.slides.length} snímků.`); await load(true); open = id; cur = 0; render();
        } catch (err) { toast(err.message, true); }
      };
      return;
    }
    box.querySelector('#prBack').onclick = () => { if (dirty && !confirm('Snímek má neuložené změny. Opravdu odejít?')) return; open = null; P = null; render(); };
    box.querySelector('#prSaveMeta').onclick = async () => { if (await run(() => rpc('rq_save_presentation', { p_id: P.id, p: { title: box.querySelector('#prTitle').value, subtitle: box.querySelector('#prSub').value, description: box.querySelector('#prDesc').value, status: box.querySelector('#prStatus').value, area_keys: readPick(box, 'pa'), tags: readPick(box, 'pt') } }), 'Údaje uloženy.')) { await load(true); await loadOne(P.id); render(); } };
    box.querySelectorAll('[data-g]').forEach(c => { const set = async () => { if (await run(() => rpc('rq_set_presentation_group', { p_presentation_id: P.id, p_group_id: c.dataset.g, p_visible_from: box.querySelector(`[data-gd="${c.dataset.g}"]`).value || null, p_on: c.checked }), c.checked ? 'Zpřístupnění uloženo.' : 'Skupině odebráno.')) { await load(true); P.groups = (A.presentations.find(p => p.id === P.id) || {}).groups || []; } };
      c.onchange = set; box.querySelector(`[data-gd="${c.dataset.g}"]`).onchange = () => { if (c.checked) set(); }; });
    box.querySelector('#prDel').onclick = async () => { if (confirm(`Smazat prezentaci „${P.title}“ se všemi snímky?`) && await run(() => rpc('rq_delete_presentation', { p_id: P.id }), 'Prezentace smazána.')) { open = null; P = null; await load(true); render(); } };
    box.querySelector('#prReimport').onchange = e => { const file = e.target.files[0]; if (file) reimport(file, box); };
    box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (dirty && !confirm('Snímek má neuložené změny. Zahodit je?')) return; if (dirty) { loadOne(P.id).then(() => { cur = +b.dataset.go; render(); }); return; } cur = +b.dataset.go; render(); });
    const addSlide = async after => { const id = await run(() => rpc('rq_save_slide', { p_id: null, p_presentation_id: P.id, p_data: { layout: 'content', title: 'Nový snímek', blocks: [] }, p_notes: '', p_after: after })); if (id) { await loadOne(P.id); cur = P.slides.findIndex(s => s.id === id); await load(true); render(); } };
    box.querySelector('#prAddSlide').onclick = () => addSlide(null);
    const s = P.slides[cur]; if (!s) return;
    bindStage(box);
    box.querySelector('#prInsert').onclick = () => addSlide(s.id);
    box.querySelector('#prDup').onclick = async () => { collect(box); const id = await run(() => rpc('rq_save_slide', { p_id: null, p_presentation_id: P.id, p_data: clone(s.data), p_notes: s.notes, p_after: s.id }), 'Snímek zduplikován.'); if (id) { await loadOne(P.id); cur++; await load(true); render(); } };
    box.querySelector('#prDelSlide').onclick = async () => { if (confirm('Smazat tento snímek?') && await run(() => rpc('rq_delete_slide', { p_id: s.id }), 'Snímek smazán.')) { await loadOne(P.id); await load(true); render(); } };
    box.querySelectorAll('[data-sm]').forEach(b => b.onclick = async () => { if (await run(() => rpc('rq_move_slide', { p_id: s.id, p_dir: +b.dataset.sm }))) { cur += +b.dataset.sm; await loadOne(P.id); await load(true); render(); } });
    box.querySelector('#prSave').onclick = async () => { collect(box); if (await run(() => rpc('rq_save_slide', { p_id: s.id, p_data: s.data, p_notes: s.notes }), 'Snímek uložen.')) { dirty = false; await load(true); render(); } };
    const form = box.querySelector('.pr-form');
    form.addEventListener('input', () => { collect(box); markDirty(box); preview(box); });
    form.addEventListener('change', e => { if (e.target.matches('[data-f=layout]')) { collect(box); if (s.data.layout === 'content' && !s.data.blocks) s.data.blocks = []; markDirty(box); render(); } });
    form.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { collect(box); const k = b.dataset.add, id = 'b' + Date.now().toString(36);
      s.data.blocks = s.data.blocks || [];
      s.data.blocks.push(k === 'cards' ? { id, type: 'cards', items: [{ id: id + 'a', heading: 'Nadpis', tone: 'neutral', paras: [{ text: 'Text karty' }] }, { id: id + 'b', heading: 'Nadpis', tone: 'teal', paras: [{ text: 'Text karty' }] }] }
        : k === 'table' ? { id, type: 'table', header: true, rows: [['Sloupec', 'Sloupec'], ['…', '…']] }
        : { id, type: 'text', style: k === 'text' ? 'plain' : k, tone: k === 'question' ? 'gold' : k === 'bar' ? 'blue' : 'neutral', paras: [{ text: k === 'question' ? 'Otázka?' : 'Text' }] });
      markDirty(box); render(); });
    form.querySelectorAll('.pr-block').forEach(el => { const i = +el.dataset.b;
      el.querySelectorAll('[data-bmv]').forEach(b => b.onclick = () => { collect(box); const j = i + +b.dataset.bmv, bl = s.data.blocks; [bl[i], bl[j]] = [bl[j], bl[i]]; markDirty(box); render(); });
      el.querySelector('[data-bdel]').onclick = () => { collect(box); s.data.blocks.splice(i, 1); markDirty(box); render(); };
      const ca = el.querySelector('[data-cadd]'); if (ca) ca.onclick = () => { collect(box); s.data.blocks[i].items.push({ id: 'c' + Date.now().toString(36), heading: '', tone: 'neutral', paras: [] }); markDirty(box); render(); };
      el.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { collect(box); s.data.blocks[i].items.splice(+b.closest('.pr-card').dataset.c, 1); markDirty(box); render(); });
    });
  }

  /* ---------- v textu dokumentu: řádek Prezentace ---------- */
  function unitRow(u) {
    if (!A) { load().then(() => { const r = document.getElementById('rqPresRow'); if (r && r.dataset.unit === u.id) { r.outerHTML = unitRow(u); bindUnit(document, u); } }).catch(() => {}); return `<div class="roles-edit" id="rqPresRow" data-unit="${esc(u.id)}"><span class="smallcaps">Prezentace</span><small class="fine">…</small></div>`; }
    const derived = A.slide_index.filter(s => s.units.includes(u.id)), manual = A.unit_links.filter(l => l.unit_id === u.id);
    const chip = (pid, sid, del) => { const s = sid && slideInfo(sid); return `<span class="role-chip on" title="${del ? 'Ruční vazba' : 'Odkaz ze snímku'}">${esc(presTitle(pid))}${s ? ' · ' + s.n : ''}${del ? `<button type="button" data-pr-del="${esc(pid)}|${esc(sid || '')}" aria-label="Odpojit">×</button>` : ''}</span>`; };
    return `<div class="roles-edit" id="rqPresRow" data-unit="${esc(u.id)}"><span class="smallcaps">Prezentace</span>${derived.map(s => chip(s.presentation_id, s.id, false)).join('')}${manual.map(l => chip(l.presentation_id, l.slide_id, true)).join('')}
      <span class="role-add"><button type="button" class="btn tiny" id="rqPresAdd">+ Snímek</button><div class="role-menu nw-pick" hidden><select class="select" data-pp><option value="">Vyberte prezentaci…</option>${A.presentations.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select><div data-sl></div></div></span></div>`;
  }
  function bindUnit(box, u) {
    const row = box.querySelector('#rqPresRow'); if (!row || !A) return;
    const relink = (pid, sid, add) => rpc('rq_link_presentation_unit', { p_presentation_id: pid, p_slide_id: sid || null, p_unit_id: u.id, p_add: add }).then(() => load(true))
      .then(() => { toast(add ? 'Snímek propojen.' : 'Vazba odebrána.'); const r = document.getElementById('rqPresRow'); if (r) { r.outerHTML = unitRow(u); bindUnit(document, u); } }).catch(e => toast(e.message, true));
    row.querySelectorAll('[data-pr-del]').forEach(b => b.onclick = () => { const [p, s] = b.dataset.prDel.split('|'); relink(p, s, false); });
    const menu = row.querySelector('.nw-pick'), pp = menu.querySelector('[data-pp]'), sl = menu.querySelector('[data-sl]');
    pp.onchange = () => { const xs = A.slide_index.filter(s => s.presentation_id === pp.value).sort((a, b) => a.n - b.n);
      sl.innerHTML = pp.value ? `<button type="button" data-s="">Celá prezentace</button>` + xs.map(s => `<button type="button" data-s="${esc(s.id)}">${s.n}. ${esc(s.title || '(bez nadpisu)')}</button>`).join('') : '';
      sl.querySelectorAll('[data-s]').forEach(b => b.onclick = () => relink(pp.value, b.dataset.s, true)); };
    row.querySelector('#rqPresAdd').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) document.addEventListener('click', function off(ev) { if (!menu.contains(ev.target)) { menu.hidden = true; document.removeEventListener('click', off); } }); };
  }
  return { render, unitRow, bindUnit, load, leave: () => {} };
})();
