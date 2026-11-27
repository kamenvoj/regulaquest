'use strict';
/* RegulaQuest Studio – dokumenty po skupinách (jazykové verze v jednom řádku), připnutí (každý sám, v prohlížeči),
   na Přehledu jen připnuté a naposledy upravované, v katalogu vše s filtrem podle stavu. */
window.RQDocs = (function () {
  const PIN = 'rq-pripnute';
  let catalogStatus = 'all', catalogArea = 'all';
  const pins = () => { try { return new Set(JSON.parse(localStorage.getItem(PIN)) || []); } catch { return new Set(); } };
  function togglePin(g) { const p = pins(); p.has(g) ? p.delete(g) : p.add(g); try { localStorage.setItem(PIN, JSON.stringify([...p])); } catch {} }
  const key = d => d.group_key || d.id;
  const LANG = { cs: 0, en: 1 };

  function groups(docs) {
    const m = new Map();
    for (const d of docs) { const k = key(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
    for (const v of m.values()) v.sort((a, b) => (LANG[a.language] ?? 9) - (LANG[b.language] ?? 9));
    return [...m.entries()].map(([k, ds]) => ({ key: k, docs: ds, main: ds[0] }));
  }
  function stats(d) {
    const us = db.units.filter(u => u.document_id === d.id && !u.editor_archived), ids = new Set(us.map(u => u.id));
    const withText = us.filter(u => String(u.body || '').trim()).length, verified = us.filter(u => u.text_status === 'verified' && String(u.body || '').trim()).length;
    const pending = db.relations.filter(r => r.status === 'proposed' && (ids.has(r.source_id) || ids.has(r.target_id))).length;
    return { units: us.length, withText, verified, pending, pct: withText ? Math.round(verified / withText * 100) : 0, ids };
  }
  const status = g => { const s = g.docs.map(stats), w = s.reduce((a, x) => a + x.withText, 0), v = s.reduce((a, x) => a + x.verified, 0);
    return !w || !v ? 'new' : v === w ? 'done' : 'progress'; };
  const STATUS = { new: 'Nezačaté', progress: 'Rozpracované', done: 'Hotové (vše ověřeno)' };
  function lastActivity(g) {
    const ids = new Set(db.units.filter(u => g.docs.some(d => d.id === u.document_id)).map(u => u.id));
    let t = Math.max(...g.docs.map(d => +new Date(d.updated_at || 0)));
    for (const h of db.unit_edit_history || []) if (ids.has(h.unit_id)) t = Math.max(t, +new Date(h.created_at));
    const cm = new Map(db.comments.map(c => [c.id, c.unit_id]));
    for (const h of db.comment_history || []) if (ids.has(cm.get(h.comment_id))) t = Math.max(t, +new Date(h.created_at));
    const rm = new Map(db.relations.map(r => [r.id, r]));
    for (const h of db.relation_history || []) { const r = rm.get(h.relation_id); if (r && (ids.has(r.source_id) || ids.has(r.target_id))) t = Math.max(t, +new Date(h.created_at)); }
    return t;
  }
  const star = g => `<button type="button" class="pin${pins().has(g.key) ? ' on' : ''}" data-pin="${esc(g.key)}" title="${pins().has(g.key) ? 'Odepnout z Přehledu' : 'Připnout na Přehled (jen pro vás)'}" aria-pressed="${pins().has(g.key)}">${pins().has(g.key) ? '★' : '☆'}</button>`;
  const langRow = d => { const s = stats(d);
    return `<div class="lang-row"><span class="lang-badge">${esc(d.language.toUpperCase())}</span>
      <div class="lang-prog"><strong>${s.verified} / ${s.withText} ověřeno</strong><div class="progress-track"><span style="width:${s.pct}%"></span></div>
      <small>${s.units} položek v osnově${s.pending ? ` · ${s.pending} vazeb ke kontrole` : ''}${d.version ? ` · verze ${esc(d.version)}` : ''}</small></div>
      <button type="button" class="btn tiny accent" data-open-doc="${esc(d.id)}" data-home-document="${esc(d.id)}">Otevřít ↗</button></div>`; };
  const card = (g, extra = '') => `<div class="doc-group">${star(g)}<div class="dg-ident"><strong>${esc(g.main.family)}</strong><span>${esc(g.main.title)}</span>
      <small>${esc(jurisdictions[g.main.jurisdiction] || 'Nezařazeno')} · ${esc(docTypes[g.main.document_type] || 'Ostatní')}</small>${extra}</div>
      <div class="dg-langs">${g.docs.map(langRow).join('')}</div></div>`;

  function bind(box, rerender) {
    box.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => { togglePin(b.dataset.pin); rerender(); });
    box.querySelectorAll('[data-open-doc]').forEach(b => b.onclick = () => selectDocument(b.dataset.openDoc));
    box.querySelectorAll('[data-edit-metadata]').forEach(b => b.onclick = () => dialogDocumentMetadata(b.dataset.editMetadata));
  }

  // Přehled: připnuté + naposledy upravované (max. 5), odkaz do katalogu, rychlé hledání
  function renderHome() {
    const box = $('#homeDocuments'); if (!box) return;
    const all = groups(db.documents), p = pins();
    const pinned = all.filter(g => p.has(g.key));
    const recent = all.filter(g => !p.has(g.key)).map(g => ({ g, t: lastActivity(g) })).sort((a, b) => b.t - a.t).slice(0, 5).map(x => x.g);
    const ad = db.archivedDocuments || [];
    box.innerHTML = `<div class="home-doc-tools"><input class="input" id="homeDocSearch" type="search" placeholder="Najít dokument v katalogu (název, zkratka)…" aria-label="Najít dokument">
       <button type="button" class="btn" id="homeAllDocs">Všech ${all.length} dokumentů v katalogu →</button></div>
      ${pinned.length ? `<div class="dg-title">★ Připnuté</div>${pinned.map(g => card(g)).join('')}` : ''}
      ${recent.length ? `<div class="dg-title">Naposledy upravované</div>${recent.map(g => card(g)).join('')}` : ''}
      ${!all.length ? '<div class="review-card"><p>Zatím žádný dokument. Založte nový nebo importujte.</p></div>' : ''}
      ${!pinned.length && all.length ? '<p class="fine">Tip: hvězdičkou ☆ si připnete dokumenty, na kterých dlouhodobě pracujete. Připnutí vidíte jen vy.</p>' : ''}
      ${ad.length ? `<details class="home-archived"><summary>Archivované dokumenty (${ad.length})</summary>${ad.map(d => `<div class="home-doc-row arch"><div class="home-doc-ident"><strong>${esc(d.family)} · ${esc(d.language.toUpperCase())}</strong><span>${esc(d.title)}</span></div><button type="button" class="btn tiny" data-restore-doc="${esc(d.id)}">Obnovit</button></div>`).join('')}</details>` : ''}`;
    bind(box, renderHome);
    const go = () => { docOverviewSearch = box.querySelector('#homeDocSearch').value.trim(); setPage('documents'); };
    box.querySelector('#homeAllDocs').onclick = () => { docOverviewSearch = ''; setPage('documents'); };
    box.querySelector('#homeDocSearch').onkeydown = e => { if (e.key === 'Enter') go(); };
    box.querySelectorAll('[data-restore-doc]').forEach(b => b.onclick = async () => { try { await rpc('rq_archive_document', { p_id: b.dataset.restoreDoc, p_archived: false }); await refresh(); toast('Dokument obnoven.'); } catch (e) { toast(e.message, true); } });
  }

  // Katalog: skupiny podle původu a druhu, jazykové verze v jednom řádku, filtr podle stavu
  function renderCatalog() {
    const holder = $('#documentOverview'), q = docOverviewSearch.trim().toLocaleLowerCase('cs');
    $('#catalogJurisdiction').value = catalogJurisdiction; $('#catalogType').value = catalogType;
    const st = $('#catalogStatus'); if (st) { st.value = catalogStatus; st.onchange = () => { catalogStatus = st.value; renderCatalog(); }; }
    const ar = $('#catalogArea');
    if (ar) { ar.innerHTML = '<option value="all">Všechny</option><option value="none">Bez oblasti</option>' + (db.areas || []).filter(a => !a.archived).map(a => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('');
      ar.value = catalogArea; ar.onchange = () => { catalogArea = ar.value; renderCatalog(); }; }
    const ma = $('#manageAreas'); if (ma && window.RQAreas) ma.onclick = () => RQAreas.manager();
    const inArea = g => { const xs = window.RQAreas ? RQAreas.of(g.key) : []; return catalogArea === 'all' || (catalogArea === 'none' ? !xs.length : xs.some(x => x.area_key === catalogArea)); };
    const si = $('#documentListSearch'); if (si && si.value !== docOverviewSearch) si.value = docOverviewSearch;
    const gs = groups(db.documents).filter(g => {
      const d = g.main;
      return (catalogJurisdiction === 'all' || d.jurisdiction === catalogJurisdiction) && (catalogType === 'all' || d.document_type === catalogType)
        && inArea(g) && (catalogStatus === 'all' || (catalogStatus === 'pinned' ? pins().has(g.key) : status(g) === catalogStatus))
        && g.docs.some(x => [x.family, x.title, x.language, x.version, x.kind, ...(x.topics || [])].join(' ').toLocaleLowerCase('cs').includes(q));
    }).sort((a, b) => [a.main.jurisdiction, a.main.document_type, a.main.family].join('|').localeCompare([b.main.jurisdiction, b.main.document_type, b.main.family].join('|'), 'cs'));
    let prev = null;
    holder.innerHTML = gs.length ? gs.map(g => {
      const grp = g.main.jurisdiction + '|' + g.main.document_type, head = grp !== prev ? `<div class="catalog-section-title">${esc(jurisdictions[g.main.jurisdiction] || 'Nezařazeno')} / ${esc(docTypes[g.main.document_type] || 'Ostatní')}</div>` : ''; prev = grp;
      const topics = [...new Set(g.docs.flatMap(d => d.topics || []))];
      return head + card(g, `${window.RQAreas ? `<div class="area-chips">${RQAreas.chips(g.key)}</div>` : ''}<div class="topic-chips">${topics.map(t => `<span class="topic-chip">${esc(t)}</span>`).join('')}</div>
        <div class="dg-meta">${g.docs.map(d => `<button type="button" class="linklike inline" data-edit-metadata="${esc(d.id)}">Údaje ${esc(d.language.toUpperCase())}</button>`).join(' · ')}</div>`);
    }).join('') : '<div class="review-card"><p>Žádný dokument neodpovídá filtru.</p></div>';
    bind(holder, renderCatalog);
  }
  return { renderHome, renderCatalog };
})();
