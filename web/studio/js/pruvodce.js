'use strict';
/* RegulaQuest Studio – nastavení vyhledávače „Najít předpisy“ a průvodce otázkami ve čtečce.
   Pole vyhledávače = skupiny štítků (zde se určí, pro které oblasti platí). Průvodce = otázky s odpověďmi,
   každá odpověď může přidat oblasti a štítky; otázka se může ukázat jen u některých oblastí. */
window.RQGuide = (function () {
  let editing = null; // id upravované otázky, 'new' = nová
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const areaName = k => (db.areas || []).find(a => a.key === k)?.name || k;
  const tagName = k => (db.tags || []).find(t => t.key === k)?.name || k;
  const groups = () => db.tag_groups || [];
  const qs = () => (db.guide_questions || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
  const previewUrl = () => { const a = document.querySelector('[data-reader="?nahled=pracovni"]'); return a ? a.href : '#'; };
  const used = k => db.units.filter(u => !u.editor_archived && (u.tags || []).includes(k)).length;

  // Výběr více položek (oblasti / štítky) jako rozbalovací seznam zaškrtávátek
  function pick(name, selected, items, empty) {
    const sel = new Set(selected || []);
    const label = sel.size ? [...sel].map(k => items.find(i => i.key === k)?.name || k).join(', ') : empty;
    return `<details class="gq-pick" data-pick="${name}"><summary title="${esc(label)}">${esc(label)}</summary><div class="gq-pick-list">
      ${items.map(i => i.group ? `<div class="gq-pick-g">${esc(i.group)}</div>` : `<label><input type="checkbox" value="${esc(i.key)}" ${sel.has(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>`;
  }
  const readPick = (root, name) => [...root.querySelectorAll(`[data-pick="${name}"] input:checked`)].map(x => x.value);
  const areaItems = () => areas().map(a => ({ key: a.key, name: a.name }));
  const tagItems = () => groups().flatMap(g => [{ group: g.name }, ...(db.tags || []).filter(t => t.group_key === g.key && !t.archived).map(t => ({ key: t.key, name: t.name }))]);
  function syncPickLabels(root) {
    root.querySelectorAll('.gq-pick').forEach(d => { const s = d.querySelector('summary'), on = [...d.querySelectorAll('input:checked')].map(x => x.parentElement.textContent.trim());
      s.textContent = on.length ? on.join(', ') : (['qa', 'ga'].includes(d.dataset.pick) ? 'Všechny oblasti' : '—'); s.title = s.textContent; });
  }

  function fieldsSection() {
    return `<section class="gq-card"><h2>Pole vyhledávače</h2>
      <p class="fine">Každá skupina štítků je ve vyhledávači jedním polem. Nabízí se jen štítky, které jsou použité u zveřejněných částí. U skupiny určete, pro které oblasti dává smysl – když student zvolí jinou oblast, pole se skryje. Bez oblasti = pole se ukazuje vždy (např. „Koho se týká“). Štítky a skupiny se zakládají v dokumentu tlačítkem + Štítek → Spravovat štítky.</p>
      <table class="gq-table"><thead><tr><th>Skupina štítků</th><th>Štítky (použito)</th><th>Platí pro oblasti</th><th></th></tr></thead><tbody>
      ${groups().map(g => { const ts = (db.tags || []).filter(t => t.group_key === g.key && !t.archived);
        return `<tr data-g="${esc(g.key)}"><td><strong>${esc(g.name)}</strong></td><td class="gq-tags">${ts.map(t => { const n = used(t.key); return `<span class="${n ? '' : 'unused'}">${esc(t.name)} (${n})</span>`; }).join('') || '<span class="unused">žádné</span>'}</td>
          <td>${pick('ga', g.area_keys, areaItems(), 'Všechny oblasti')}</td><td><button type="button" class="btn tiny" data-gsave>Uložit</button></td></tr>`; }).join('')}
      </tbody></table>
      <p class="fine">Další pole vyhledávače jsou stálá: <b>Oblast</b> (oblasti s alespoň jedním dokumentem), <b>Druh dokumentu</b>, <b>Původ</b> (EU / ČR…), <b>Téma</b> (tagy dokumentu z Údajů dokumentu) a <b>Slovo v textu</b>.</p></section>`;
  }

  function optRow(o, i) {
    return `<div class="gq-opt" data-i="${i}"><input class="input" data-label maxlength="120" value="${esc(o.label || '')}" placeholder="Odpověď, jak by ji řekl student">
      <input class="input" data-help maxlength="300" value="${esc(o.help || '')}" placeholder="Upřesnění (nepovinné)">
      ${pick('oa' + i, o.areas, areaItems(), '—')}${pick('ot' + i, o.tags, tagItems(), '—')}
      <span class="gq-ord"><button type="button" class="btn tiny" data-up aria-label="Výš">↑</button><button type="button" class="btn tiny" data-down aria-label="Níž">↓</button><button type="button" class="btn tiny danger" data-rm aria-label="Odebrat odpověď">✕</button></span></div>`;
  }
  function editor(q) {
    const opts = q.options && q.options.length ? q.options : [{ label: '' }, { label: '' }];
    return `<div class="gq-edit" id="gqEdit"><h3>${q.id ? 'Upravit otázku' : 'Nová otázka'}</h3>
      <label class="form-field"><span>Otázka</span><input class="input" id="gqPrompt" maxlength="200" value="${esc(q.prompt || '')}" placeholder="Např. Má prostředek měřicí funkci?"></label>
      <label class="form-field"><span>Vysvětlení pod otázkou (nepovinné)</span><input class="input" id="gqHelp" maxlength="400" value="${esc(q.help || '')}"></label>
      <div class="gq-row2"><label class="inline-check"><input type="checkbox" id="gqMulti" ${q.multi ? 'checked' : ''}> lze vybrat víc odpovědí</label>
        <div class="form-field"><span>Zobrazit jen, když je ve hře oblast</span>${pick('qa', q.area_keys, areaItems(), 'Všechny oblasti')}</div></div>
      <div class="gq-opt head"><span>Odpověď</span><span>Upřesnění</span><span>Přidá oblasti</span><span>Přidá štítky</span><span></span></div>
      <div id="gqOpts">${opts.map(optRow).join('')}</div>
      <button type="button" class="btn tiny" id="gqAddOpt">+ Odpověď</button>
      <p class="fine">Odpověď bez oblastí a štítků (např. „Nevím“, „Nic z toho“) je v pořádku – jen nic nepřidá. Oblast „ve hře“ = zvolená v některé předchozí odpovědi.</p>
      <div class="modal-actions"><button type="button" class="btn" id="gqCancel">Zrušit</button><button type="button" class="btn accent" id="gqSave">Uložit otázku</button></div></div>`;
  }
  function readOpts(box) {
    return [...box.querySelectorAll('#gqOpts .gq-opt')].map(r => ({ label: r.querySelector('[data-label]').value.trim(), help: r.querySelector('[data-help]').value.trim(),
      areas: readPick(r, 'oa' + r.dataset.i), tags: readPick(r, 'ot' + r.dataset.i) }));
  }

  function guideSection() {
    const list = qs();
    return `<section class="gq-card"><div class="gq-head"><div><h2>Průvodce otázkami</h2>
      <p class="fine">Otázky se studentovi ukazují v tomto pořadí. Otázka s oblastí se ukáže jen tehdy, když ji přidala některá dřívější odpověď – tak se průvodce větví (např. otázky na třídu rizika jen u zdravotnických prostředků). Na konci se otevře vyhledávač s oblastmi a štítky ze všech odpovědí. Změny uvidí studenti po příští publikaci.</p></div>
      <button type="button" class="btn accent" id="gqNew">+ Nová otázka</button></div>
      ${editing === 'new' ? editor({}) : ''}
      <ol class="gq-list">${list.map((q, i) => editing === q.id ? `<li class="editing">${editor(q)}</li>` : `<li class="${q.archived ? 'arch' : ''}">
        <div class="gq-q"><strong>${esc(q.prompt)}</strong>${q.archived ? ' <span class="tag">vyřazená</span>' : ''}
          <small>${q.multi ? 'více odpovědí' : 'jedna odpověď'} · ${q.area_keys.length ? 'jen u: ' + esc(q.area_keys.map(areaName).join(', ')) : 'vždy'}</small>
          <ul>${q.options.map(o => `<li>${esc(o.label)}${o.areas.length || o.tags.length ? ` <span class="gq-eff">→ ${esc([...o.areas.map(areaName), ...o.tags.map(tagName)].join(', '))}</span>` : ''}</li>`).join('')}</ul></div>
        <div class="gq-act"><button type="button" class="btn tiny" data-up="${q.id}" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn tiny" data-down="${q.id}" ${i < list.length - 1 ? '' : 'disabled'}>↓</button>
          <button type="button" class="btn tiny" data-edit="${q.id}">Upravit</button><button type="button" class="btn tiny" data-arch="${q.id}">${q.archived ? 'Obnovit' : 'Vyřadit'}</button><button type="button" class="btn tiny danger" data-del="${q.id}">Smazat</button></div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="fine">Zatím žádné otázky.</p>'}</section>`;
  }

  function render() {
    const box = document.getElementById('guideContent'); if (!box) return;
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">VÝUKA / VYHLEDÁVÁNÍ A PRŮVODCE</div><h1>Vyhledávání a průvodce</h1>
      <p>Jak studenti najdou předpisy, když nevědí, který hledat. Výsledky stojí na oblastech dokumentů a štítcích ustanovení.</p></div>
      <div class="head-actions"><a class="btn" href="${esc(previewUrl())}#/najit" target="_blank" rel="noopener">Vyhledávač v pracovním náhledu ↗</a><a class="btn" href="${esc(previewUrl())}#/pruvodce" target="_blank" rel="noopener">Průvodce v pracovním náhledu ↗</a></div></div>
      ${guideSection()}${fieldsSection()}`;
    bind(box);
  }

  async function run(fn, msg) { try { await fn(); await refresh(); toast(msg); render(); return true; } catch (e) { toast(e.message, true); return false; } }

  function bind(box) {
    box.querySelectorAll('.gq-pick').forEach(d => d.addEventListener('change', () => syncPickLabels(d.parentElement)));
    box.querySelectorAll('tr[data-g]').forEach(tr => tr.querySelector('[data-gsave]').onclick = () =>
      run(() => rpc('rq_set_tag_group_areas', { p_key: tr.dataset.g, p_area_keys: readPick(tr, 'ga') }), 'Oblasti pole uloženy.'));
    box.querySelector('#gqNew').onclick = () => { editing = 'new'; render(); document.getElementById('gqPrompt')?.focus(); };
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = +b.dataset.edit; render(); });
    box.querySelectorAll('[data-arch]').forEach(b => b.onclick = () => { const q = qs().find(x => x.id === +b.dataset.arch);
      run(() => rpc('rq_archive_guide_question', { p_id: q.id, p_archived: !q.archived }), q.archived ? 'Otázka obnovena.' : 'Otázka vyřazena.'); });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const q = qs().find(x => x.id === +b.dataset.del);
      if (confirm(`Smazat otázku „${q.prompt}“? (Vyřazení ji jen skryje.)`)) run(() => rpc('rq_delete_guide_question', { p_id: q.id }), 'Otázka smazána.'); });
    box.querySelectorAll('.gq-act [data-up],.gq-act [data-down]').forEach(b => b.onclick = () =>
      run(() => rpc('rq_move_guide_question', { p_id: +(b.dataset.up || b.dataset.down), p_dir: b.dataset.up ? -1 : 1 }), 'Pořadí změněno.'));
    const ed = document.getElementById('gqEdit'); if (!ed) return;
    const q = editing === 'new' ? {} : qs().find(x => x.id === editing);
    const redrawOpts = opts => { ed.querySelector('#gqOpts').innerHTML = opts.map(optRow).join(''); bindOpts(); };
    function bindOpts() {
      ed.querySelectorAll('#gqOpts .gq-pick').forEach(d => d.addEventListener('change', () => syncPickLabels(d.parentElement)));
      ed.querySelectorAll('#gqOpts .gq-opt').forEach(r => { const i = +r.dataset.i;
        r.querySelector('[data-rm]').onclick = () => { const o = readOpts(ed); o.splice(i, 1); redrawOpts(o); };
        r.querySelector('[data-up]').onclick = () => { const o = readOpts(ed); if (i) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; redrawOpts(o); } };
        r.querySelector('[data-down]').onclick = () => { const o = readOpts(ed); if (i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; redrawOpts(o); } }; });
    }
    bindOpts();
    ed.querySelector('#gqAddOpt').onclick = () => { const o = readOpts(ed); o.push({ label: '' }); redrawOpts(o); ed.querySelector(`#gqOpts .gq-opt:last-child [data-label]`).focus(); };
    ed.querySelector('#gqCancel').onclick = () => { editing = null; render(); };
    ed.querySelector('#gqSave').onclick = async () => {
      const ok = await run(() => rpc('rq_save_guide_question', { p_id: q.id || null, p_prompt: ed.querySelector('#gqPrompt').value, p_help: ed.querySelector('#gqHelp').value,
        p_multi: ed.querySelector('#gqMulti').checked, p_area_keys: readPick(ed.querySelector('.gq-row2'), 'qa'), p_options: readOpts(ed).filter(o => o.label), p_sort: q.sort ?? null }), 'Otázka uložena.');
      if (ok) { editing = null; render(); }
    };
  }
  return { render, leave: () => { editing = null; } };
})();
