'use strict';
/* RegulaQuest Studio – oblasti (ZP, metrologie, …) a zařazení dokumentů do nich s rolí.
   Zařazení platí pro celou skupinu jazykových verzí (group_key) a přežije nový import. */
window.RQAreas = (function () {
  const ROLES = { core: 'Hlavní předpis', guidance: 'Metodika / výklad', supplementary: 'Doplňkový', situational: 'Pro specifické situace' };
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const areaName = k => (db.areas || []).find(a => a.key === k)?.name || k;
  const of = gk => (db.document_areas || []).filter(x => x.group_key === gk);
  const roleSel = (v, attr) => `<select class="select" ${attr}>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

  // Krátké štítky oblastí pro katalog
  function chips(gk) {
    const xs = of(gk); if (!xs.length) return '<small class="area-none">Bez oblasti</small>';
    return xs.map(x => `<span class="area-chip ${x.role}" title="${esc(ROLES[x.role])}${x.note ? ': ' + esc(x.note) : ''}">${esc(areaName(x.area_key))}${x.role !== 'core' ? ` · ${esc(ROLES[x.role].toLowerCase())}` : ''}</span>`).join('');
  }

  // Část dialogu „Údaje dokumentu“: zařazení do oblastí (ukládá se hned, nezávisle na tlačítku Uložit metadata)
  function metaSection(d) {
    const gk = d.group_key || d.id, xs = of(gk), free = areas().filter(a => !xs.some(x => x.area_key === a.key));
    return `<div class="area-box" id="docAreas" data-gk="${esc(gk)}"><strong>Oblasti</strong>
      <p class="fine">Do kterých oblastí dokument patří a s jakou rolí. Platí pro všechny jazykové verze a ukládá se hned. „Pro specifické situace“ vyžaduje poznámku, kdy je dokument relevantní (např. „ZP s měřicí funkcí“).</p>
      ${xs.map(x => `<div class="area-row" data-area="${esc(x.area_key)}"><span class="area-name">${esc(areaName(x.area_key))}</span>${roleSel(x.role, 'data-role')}
        <input class="input" data-note maxlength="300" placeholder="Kdy je relevantní (u specifických situací povinné)" value="${esc(x.note)}">
        <button type="button" class="btn tiny" data-save>Uložit</button><button type="button" class="btn tiny danger" data-del aria-label="Odebrat z oblasti">✕</button></div>`).join('') || '<p class="fine">Dokument zatím není v žádné oblasti.</p>'}
      ${free.length ? `<div class="area-row add"><select class="select" data-new-area>${free.map(a => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('')}</select>${roleSel('core', 'data-new-role')}
        <input class="input" data-new-note maxlength="300" placeholder="Kdy je relevantní (u specifických situací povinné)"><button type="button" class="btn tiny accent" data-add>Přidat oblast</button></div>` : ''}</div>`;
  }
  function bindMeta(d) {
    const box = document.getElementById('docAreas'); if (!box) return;
    const gk = box.dataset.gk;
    const redo = async (fn, msg) => { try { await fn(); await refresh(); toast(msg); const n = document.getElementById('docAreas'); if (n) { n.outerHTML = metaSection(d); bindMeta(d); } } catch (e) { toast(e.message, true); } };
    box.querySelectorAll('.area-row[data-area]').forEach(row => {
      const a = row.dataset.area;
      row.querySelector('[data-save]').onclick = () => redo(() => rpc('rq_set_document_area', { p_group_key: gk, p_area_key: a, p_role: row.querySelector('[data-role]').value, p_note: row.querySelector('[data-note]').value, p_sort: 100 }), 'Zařazení uloženo.');
      row.querySelector('[data-del]').onclick = () => redo(() => rpc('rq_remove_document_area', { p_group_key: gk, p_area_key: a }), 'Dokument odebrán z oblasti.');
    });
    const add = box.querySelector('[data-add]');
    if (add) add.onclick = () => redo(() => rpc('rq_set_document_area', { p_group_key: gk, p_area_key: box.querySelector('[data-new-area]').value, p_role: box.querySelector('[data-new-role]').value, p_note: box.querySelector('[data-new-note]').value, p_sort: 100 }), 'Dokument zařazen do oblasti.');
  }

  // Správa seznamu oblastí
  function manager() {
    const d = $('#modal'), f = $('#modalContent'); f.onsubmit = e => e.preventDefault();
    const count = k => new Set((db.document_areas || []).filter(x => x.area_key === k).map(x => x.group_key)).size;
    const draw = () => {
      f.innerHTML = `<h2>Oblasti</h2><p>Oblasti jsou stejné pro všechny studenty. Ve čtečce slouží k filtrování dokumentů a mají vlastní stránku s hlavními předpisy, metodikami, doplňkovými předpisy a předpisy pro specifické situace. Vyřazená oblast zmizí ze čtečky; zařazení dokumentů zůstane.</p>
      <div class="tg-group">${(db.areas || []).map(a => `<div class="tg-row area-def${a.archived ? ' arch' : ''}" data-k="${esc(a.key)}"><input class="input" data-name value="${esc(a.name)}" aria-label="Název oblasti"><input class="input" data-desc value="${esc(a.description || '')}" placeholder="Krátký popis pro studenty" aria-label="Popis oblasti"><small>${count(a.key)} dok.</small><button type="button" class="btn tiny" data-s>Uložit</button><button type="button" class="btn tiny ${a.archived ? '' : 'danger'}" data-a>${a.archived ? 'Obnovit' : 'Vyřadit'}</button></div>`).join('')}
       <div class="tg-row new"><input class="input" id="arNew" placeholder="Nová oblast (např. Biocidy)"><button type="button" class="btn tiny accent" id="arAdd">Přidat oblast</button></div></div>
      <div class="modal-actions"><button class="btn" type="button" id="arClose">Zavřít</button></div>`;
      const run = async (fn, msg) => { try { await fn(); await refresh(); toast(msg); draw(); } catch (e) { toast(e.message, true); } };
      f.querySelector('#arClose').onclick = () => d.close();
      f.querySelectorAll('.area-def').forEach(r => { const a = db.areas.find(x => x.key === r.dataset.k);
        r.querySelector('[data-s]').onclick = () => run(() => rpc('rq_save_area', { p_key: a.key, p_name: r.querySelector('[data-name]').value.trim() || a.name, p_description: r.querySelector('[data-desc]').value, p_sort: a.sort }), 'Oblast uložena.');
        r.querySelector('[data-a]').onclick = () => run(() => rpc('rq_archive_area', { p_key: a.key, p_archived: !a.archived }), a.archived ? 'Oblast obnovena.' : 'Oblast vyřazena.'); });
      f.querySelector('#arAdd').onclick = () => { const v = f.querySelector('#arNew').value.trim(); if (v) run(() => rpc('rq_save_area', { p_key: '', p_name: v, p_description: '', p_sort: null }), 'Oblast přidána.'); };
    };
    d.classList.add('wide'); d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
    draw(); d.showModal();
  }
  return { ROLES, chips, metaSection, bindMeta, manager, of };
})();
