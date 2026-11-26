'use strict';
/* RegulaQuest Studio – pojmy z definičního článku (např. čl. 2 MDR).
   Pojem = bod definice; „vzory“ určují, které tvary slov se v textu označí (* = libovolná koncovka).
   Ve čtečce se označí první výskyt pojmu v každé části a po klepnutí se ukáže definice z aktuálního textu. */
window.RQTerms = (function () {
  const live = () => (db.terms || []).filter(t => t.status !== 'archived');
  // Stejný pojem v jiné jazykové verzi: stejné číslo bodu v odpovídajícím definičním článku.
  function twinUnits(u) {
    const d = getDoc(u.document_id); if (!d) return [];
    return db.documents.filter(x => x.id !== d.id && (x.group_key || x.id) === (d.group_key || d.id)).map(x => equivalentIn(u, x.id)).filter(Boolean);
  }
  function twins(t) {
    const du = getUnit(t.unit_id); if (!du) return [];
    return twinUnits(du).map(tu => ({ lang: getDoc(tu.document_id).language, term: (db.terms || []).find(x => x.unit_id === tu.id && x.number === t.number) }));
  }

  function mark(root, u) {
    const doc = getDoc(u.document_id); if (!doc) return;
    const ts = live().filter(t => t.language === doc.language && t.unit_id !== u.id);
    return ts.length ? RQNotes.applyTerms(root, ts, pop) : 0;
  }
  function pop(t, el) {
    const open = document.querySelector(`.rq-pop[data-term="${CSS.escape(t.id)}"]`);
    document.querySelectorAll('.rq-pop').forEach(p => p.remove());
    if (open) return;
    const du = getUnit(t.unit_id), text = du ? RQNotes.definitionText(du.body, t.number) : '';
    const p = document.createElement('span');
    p.className = 'rq-pop term'; p.dataset.term = t.id; p.dataset.noAnchor = '1';
    const tw = twins(t).filter(x => x.term).map(x => `${x.lang.toUpperCase()}: ${esc(x.term.name)}`).join(' · ');
    p.innerHTML = `<span class="rq-pop-h">${RQNotes.ICON.term} Definice · ${esc(du ? du.label : '')}, bod ${t.number}${t.status === 'draft' ? ' · koncept' : ''}${tw ? ' · ' + tw : ''}
      <button type="button" class="btn tiny tm-edit">Upravit pojem</button></span>${esc(text || t.name).replace(/\n/g, '<br>')}`;
    p.querySelector('.tm-edit').onclick = e => { e.stopPropagation(); if (du) dialog(du, t.name); };
    (el.closest('p, .ln, li, td, [data-anchor-root]') || el.parentElement).after(p);
  }

  function dialog(u, preset) {
    const d = $('#modal'), f = $('#modalContent'), doc = getDoc(u.document_id);
    d.classList.add('wide');
    d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
    f.onsubmit = e => e.preventDefault();
    // výskyty se počítají v ostatních částech dokumentů stejného jazyka
    const toks = RQNotes.tokens(db.units.filter(x => !x.editor_archived && x.id !== u.id && getDoc(x.document_id)?.language === doc.language)
      .map(x => x.body || '').join('\n'));
    let filter = preset || '';
    const other = twinUnits(u).filter(x => RQNotes.parseDefinitions(x.body).length >= 5);
    const draw = () => {
      const defs = RQNotes.parseDefinitions(u.body);
      const mine = (db.terms || []).filter(t => t.unit_id === u.id).sort((a, b) => a.number - b.number);
      const missing = defs.filter(x => !mine.some(t => t.number === x.number));
      const shown = mine.filter(t => !filter || RQNotes.fold(t.name + ' ' + t.source_label + ' ' + t.forms).includes(RQNotes.fold(filter)));
      const st = t => t.status === 'approved' ? '<span class="tag good">Schváleno</span>' : t.status === 'archived' ? '<span class="tag bad">Vyřazeno</span>' : '<span class="tag warn">Koncept</span>';
      f.innerHTML = `<h2>Pojmy z definic · ${esc(u.label)}</h2>
      <p>Každý bod definice je pojem. Ve čtečce se v ostatních částech (${esc(doc.language.toUpperCase())}) jemně podtrhne jeho první výskyt a po klepnutí se ukáže definice.
      <strong>Vzory</strong>: jeden na řádek, slova oddělená mezerou, <code>*</code> na konci slova = libovolná koncovka, diakritika a velká písmena se ignorují.
      Pojem s příliš mnoha výskyty (obecné slovo) raději vyřaďte nebo zpřesněte.</p>
      ${missing.length ? `<div class="notice"><strong>${missing.length} bodů definice zatím není mezi pojmy.</strong> <button type="button" class="btn tiny accent" id="tmImport">Načíst ${missing.length} pojmů jako koncept</button></div>` : ''}
      ${other.length ? `<p class="fine">Pojmy se s jinou jazykovou verzí párují samy podle čísla bodu. ${other.map(x => `<button type="button" class="btn tiny" data-twin="${esc(x.id)}">Přepnout na ${esc(getDoc(x.document_id).language.toUpperCase())}</button>`).join(' ')}</p>` : ''}
      <div class="tm-tools"><input class="input" id="tmFilter" placeholder="Filtrovat pojmy…" value="${esc(filter)}">
       <label class="tm-all"><input type="checkbox" id="tmAll"> vybrat zobrazené</label>
       <button type="button" class="btn tiny accent" data-bulk="approved">Schválit vybrané</button><button type="button" class="btn tiny" data-bulk="draft">Vrátit do konceptu</button><button type="button" class="btn tiny danger" data-bulk="archived">Vyřadit vybrané</button><button type="button" class="btn tiny danger" id="tmDelete" title="Jen koncepty a vyřazené">Smazat vybrané</button></div>
      <div class="tm-list">${shown.map(t => `<div class="tm-row" data-id="${esc(t.id)}">
        <input type="checkbox" class="tm-sel" aria-label="Vybrat pojem ${t.number}">
        <span class="tm-n">${t.number}</span>
        <div class="tm-main"><input class="input tm-name" value="${esc(t.name)}" aria-label="Název pojmu"><small>v textu: „${esc(t.source_label)}“${twins(t).map(x => ` · ${x.lang.toUpperCase()}: ${x.term ? esc(x.term.name) : '<em>nenačteno</em>'}`).join('')}</small></div>
        <textarea class="textarea tm-forms" rows="2" aria-label="Vzory pro vyhledání">${esc(t.forms)}</textarea>
        <div class="tm-side">${st(t)}<small>${RQNotes.countTerm(toks, t)}× v textech</small><button type="button" class="btn tiny tm-save" disabled>Uložit</button></div>
       </div>`).join('') || '<p class="fine">Žádné pojmy.</p>'}</div>
      <div class="modal-actions"><button class="btn" type="button" id="tmClose">Zavřít</button></div>`;
      f.querySelector('#tmClose').onclick = () => d.close();
      const fi = f.querySelector('#tmFilter'); fi.oninput = () => { filter = fi.value; const pos = fi.selectionStart; draw(); const n = f.querySelector('#tmFilter'); n.focus(); n.setSelectionRange(pos, pos); };
      f.querySelector('#tmAll').onchange = e => f.querySelectorAll('.tm-sel').forEach(c => c.checked = e.target.checked);
      const imp = f.querySelector('#tmImport');
      if (imp) imp.onclick = () => run(imp, async () => {
        const n = await rpc('rq_import_terms', { p_unit_id: u.id, p_items: missing.map(x => ({ number: x.number, source_label: x.source_label, name: x.source_label, forms: RQNotes.suggestForms(x.source_label, doc.language) })) });
        toast(`Načteno ${n} pojmů jako koncept. Projděte vzory a schvalte.`);
      });
      f.querySelectorAll('.tm-row').forEach(row => {
        const save = row.querySelector('.tm-save'), t = mine.find(x => x.id === row.dataset.id);
        const name = row.querySelector('.tm-name'), forms = row.querySelector('.tm-forms');
        const dirty = () => save.disabled = name.value.trim() === t.name && forms.value.trim() === t.forms;
        name.oninput = dirty; forms.oninput = () => { dirty(); row.querySelector('.tm-side small').textContent = RQNotes.countTerm(toks, { forms: forms.value }) + '× v textech'; };
        save.onclick = () => run(save, () => rpc('rq_edit_term', { p_id: t.id, p_name: name.value.trim() || t.source_label, p_forms: forms.value }), 'Pojem uložen.');
      });
      f.querySelectorAll('[data-twin]').forEach(b => b.onclick = () => { d.close(); setTimeout(() => dialog(getUnit(b.dataset.twin)), 0); });
      f.querySelector('#tmDelete').onclick = () => {
        const ids = [...f.querySelectorAll('.tm-row')].filter(r => r.querySelector('.tm-sel').checked).map(r => r.dataset.id);
        if (!ids.length) { toast('Nejprve vyberte pojmy.', true); return; }
        if (!confirm(`Trvale smazat ${ids.length} pojmů? Schválené je nutné nejdřív vyřadit. Bod definice lze později znovu načíst.`)) return;
        run(f.querySelector('#tmDelete'), () => rpc('rq_delete_terms', { p_ids: ids }), `Smazáno: ${ids.length}.`);
      };
      f.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => {
        const ids = [...f.querySelectorAll('.tm-row')].filter(r => r.querySelector('.tm-sel').checked).map(r => r.dataset.id);
        if (!ids.length) { toast('Nejprve vyberte pojmy.', true); return; }
        run(b, () => rpc('rq_term_status', { p_ids: ids, p_status: b.dataset.bulk }), `Změněno: ${ids.length}.`);
      });
    };
    async function run(btn, fn, msg) {
      btn.disabled = true;
      try { await fn(); await refresh(); if (msg) toast(msg); draw(); render(); }
      catch (e) { toast(e.message, true); btn.disabled = false; }
    }
    draw(); d.showModal();
  }
  return { mark, dialog };
})();
