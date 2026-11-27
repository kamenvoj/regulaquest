'use strict';
/* RegulaQuest Studio – přehled pokrytí: u každého článku / přílohy / pravidla (včetně jeho odstavců)
   kolik má ověřeného textu, štítků, komentářů, zvýraznění, vazeb a kroků tras. Ukazuje, kde pokračovat. */
window.RQCoverage = (function () {
  let docId = null, filter = 'all', sortBy = 'order';
  const LAYER = new Set(['key', 'duty', 'deadline', 'exception']);
  const FILTERS = { all: 'Vše', unverified: 'Neověřený text', notags: 'Bez štítků', nocomments: 'Bez výkladu', nolinks: 'Bez vazeb', noguidance: 'Bez metodiky', untouched: 'Zatím nic' };

  function stats(top) {
    const ids = new Set([top.id]); let grew = true;
    while (grew) { grew = false; for (const u of db.units) if (!u.editor_archived && u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grew = true; } }
    const units = db.units.filter(u => ids.has(u.id) && !u.editor_archived);
    const withText = units.filter(u => String(u.body || '').trim());
    const live = c => !['archived', 'rejected'].includes(c.status);
    const com = db.comments.filter(c => ids.has(c.unit_id) && live(c));
    const rel = db.relations.filter(r => (ids.has(r.source_id) || ids.has(r.target_id)) && live(r));
    const docType = id => getDoc(getUnit(id)?.document_id)?.document_type;
    const me = getDoc(top.document_id)?.document_type;
    const guidance = rel.filter(r => { const o = ids.has(r.source_id) ? r.target_id : r.source_id; return (docType(o) === 'guidance') !== (me === 'guidance'); });
    const steps = (db.path_steps || []).filter(s => ids.has(s.unit_id));
    const tags = new Set(units.flatMap(u => u.tags || []));
    return {
      parts: units.length, text: withText.length, verified: withText.filter(u => u.text_status === 'verified').length,
      tags: tags.size, tagNames: [...tags].map(k => (db.tags || []).find(t => t.key === k)?.name || k),
      notes: com.filter(c => !LAYER.has(c.kind)), notesOk: com.filter(c => !LAYER.has(c.kind) && c.status === 'approved').length,
      hl: com.filter(c => LAYER.has(c.kind)).length,
      rel: rel.length, relOk: rel.filter(r => r.status === 'approved').length, guidance: guidance.length, steps: steps.length
    };
  }

  function render() {
    const box = $('#coverageContent'); if (!box) return;
    if (!docId || !getDoc(docId)) docId = activeDocId || db.documents[0]?.id || null;
    const d = getDoc(docId);
    const tops = d ? db.units.filter(u => u.document_id === d.id && !u.editor_archived && !u.parent_id) : [];
    // u dokumentů se strukturou kapitol vezmeme o úroveň níž (články, pravidla), pokud nejvyšší úroveň nemá text
    const rows = tops.flatMap(u => (!String(u.body || '').trim() && ['chapter', 'part', 'section'].includes(u.kind))
      ? db.units.filter(x => x.parent_id === u.id && !x.editor_archived) : [u]).map(u => ({ u, s: stats(u) }));
    const pass = ({ s }) => ({ all: true, unverified: s.verified < s.text, notags: !s.tags, nocomments: !s.notes.length, nolinks: !s.rel,
      noguidance: !s.guidance, untouched: !s.tags && !s.notes.length && !s.hl && !s.rel && !s.steps })[filter];
    let shown = rows.filter(pass);
    if (sortBy === 'gaps') shown = shown.slice().sort((a, b) => score(a.s) - score(b.s));
    const tot = k => rows.filter(r => k(r.s)).length;
    const pct = n => rows.length ? Math.round(n / rows.length * 100) : 0;
    const sum = [['Ověřený text', tot(s => s.text && s.verified === s.text)], ['Se štítky', tot(s => s.tags)], ['S výkladem', tot(s => s.notes.length)],
      ['S vazbou', tot(s => s.rel)], ['S metodikou', tot(s => s.guidance)]];
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">02 / ODBORNÁ PRÁCE</div><h1>Pokrytí</h1>
      <p>Kde už je hotovo a kde pokračovat. Čísla zahrnují i odstavce a body daného článku (pravidla, přílohy). Archivované a zamítnuté položky se nepočítají.</p></div>
      <label class="form-field cov-doc"><span>Dokument</span><select class="select" id="covDoc">${db.documents.map(x => `<option value="${esc(x.id)}" ${x.id === docId ? 'selected' : ''}>${esc(x.family)} · ${esc(x.language.toUpperCase())} – ${esc(x.title.slice(0, 60))}</option>`).join('')}</select></label></div>
      ${d ? `<div class="cov-summary">${sum.map(([l, n]) => `<div class="cov-metric"><span>${l}</span><strong>${n} / ${rows.length}</strong><i><b style="width:${pct(n)}%"></b></i></div>`).join('')}</div>
      <div class="cov-tools">${Object.entries(FILTERS).map(([k, l]) => `<button type="button" class="chip-btn${k === filter ? ' on' : ''}" data-f="${k}">${l}${k === 'all' ? '' : ` <small>${rows.filter(r => { const f = filter; filter = k; const ok = pass(r); filter = f; return ok; }).length}</small>`}</button>`).join('')}
        <label class="cov-sort"><input type="checkbox" id="covSort" ${sortBy === 'gaps' ? 'checked' : ''}> nejméně zpracované nahoře</label></div>
      <div class="cov-table" role="table"><div class="cov-row head" role="row"><span>Část</span><span>Text</span><span>Štítky</span><span>Výklad</span><span>Zvýraznění</span><span>Vazby</span><span>Metodika</span><span>Trasy</span></div>
      ${shown.map(({ u, s }) => `<button type="button" class="cov-row" role="row" data-open="${esc(u.id)}" title="Otevřít">
        <span class="cov-name"><strong>${esc(u.label)}</strong>${u.heading ? `<small>${esc(u.heading.slice(0, 70))}</small>` : ''}</span>
        <span class="${!s.text ? 'na' : s.verified === s.text ? 'ok' : 'warn'}">${s.text ? `${s.verified}/${s.text}` : '–'}</span>
        <span class="${s.tags ? 'ok' : 'no'}" title="${esc(s.tagNames.join(', '))}">${s.tags || '·'}</span>
        <span class="${s.notes.length ? (s.notesOk === s.notes.length ? 'ok' : 'warn') : 'no'}" title="schváleno ${s.notesOk} z ${s.notes.length}">${s.notes.length || '·'}</span>
        <span class="${s.hl ? 'ok' : 'no'}">${s.hl || '·'}</span>
        <span class="${s.rel ? (s.relOk === s.rel ? 'ok' : 'warn') : 'no'}" title="schváleno ${s.relOk} z ${s.rel}">${s.rel || '·'}</span>
        <span class="${s.guidance ? 'ok' : 'no'}">${s.guidance || '·'}</span>
        <span class="${s.steps ? 'ok' : 'no'}">${s.steps || '·'}</span></button>`).join('') || '<p class="fine">Nic neodpovídá filtru.</p>'}</div>
      <p class="fine cov-legend"><span class="ok">zelená</span> hotovo · <span class="warn">oranžová</span> rozpracováno (neověřený text, neschválené položky) · <span class="no">·</span> zatím nic</p>`
      : '<div class="empty">Zatím žádný dokument.</div>'}`;
    const ds = box.querySelector('#covDoc'); if (ds) ds.onchange = () => { docId = ds.value; render(); };
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
    const so = box.querySelector('#covSort'); if (so) so.onchange = () => { sortBy = so.checked ? 'gaps' : 'order'; render(); };
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openUnit(b.dataset.open));
  }
  const score = s => (s.text && s.verified === s.text ? 1 : 0) + (s.tags ? 1 : 0) + (s.notes.length ? 1 : 0) + (s.rel ? 1 : 0) + (s.guidance ? 1 : 0) + (s.hl ? 0.5 : 0) + (s.steps ? 0.5 : 0);
  return { render };
})();
