'use strict';
/* RegulaQuest Studio – Užitečné odkazy pro studenty (SÚKL, EUDAMED, ČMI, EUR-Lex…): kategorie, popisek, oblasti, štítky.
   Zveřejněné studenti vidí hned v záložce Odkazy. */
window.RQLinks = (function () {
  let L = null, editing = null, st = 'all', q = '';
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const areaName = k => (db.areas || []).find(a => a.key === k)?.name || k;
  const tagName = k => (db.tags || []).find(t => t.key === k)?.name || k;
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const CATS = ['Úřady a instituce', 'Databáze a registry', 'Legislativa', 'Metodiky a pokyny', 'Normy', 'Ostatní'];

  function pick(name, selected, items, empty) {
    const s = new Set(selected || []);
    const label = s.size ? [...s].map(k => items.find(i => i.key === k)?.name || k).join(', ') : empty;
    return `<details class="gq-pick" data-pick="${name}" data-empty="${esc(empty)}"><summary title="${esc(label)}">${esc(label)}</summary><div class="gq-pick-list">
      ${items.map(i => i.group ? `<div class="gq-pick-g">${esc(i.group)}</div>` : `<label><input type="checkbox" value="${esc(i.key)}" ${s.has(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>`;
  }
  const readPick = (root, name) => [...root.querySelectorAll(`[data-pick="${name}"] input:checked`)].map(x => x.value);
  const syncPick = d => { const s = d.querySelector('summary'), on = [...d.querySelectorAll('input:checked')].map(x => x.parentElement.textContent.trim()); s.textContent = on.length ? on.join(', ') : d.dataset.empty; };
  const tagItems = () => (db.tag_groups || []).flatMap(g => [{ group: g.name }, ...(db.tags || []).filter(t => t.group_key === g.key && !t.archived).map(t => ({ key: t.key, name: t.name }))]);

  function form(l) {
    const cats = [...new Set([...CATS, ...L.map(x => x.category)])];
    return `<div class="nw-edit lk-form" data-form="${l.id || 'new'}">
      <div class="lk-grid"><label class="form-field"><span>Název</span><input class="input" data-f="title" maxlength="200" value="${esc(l.title || '')}" placeholder="Např. NANDO – oznámené subjekty"></label>
        <label class="form-field"><span>Adresa</span><input class="input" data-f="url" maxlength="1000" value="${esc(l.url || '')}" placeholder="https://…"></label></div>
      <label class="form-field"><span>Krátký popisek (k čemu stránka slouží)</span><input class="input" data-f="description" maxlength="600" value="${esc(l.description || '')}"></label>
      <div class="nw-picks lk-picks"><label class="form-field"><span>Kategorie</span><input class="input" data-f="category" list="lkCats" maxlength="80" value="${esc(l.category || 'Úřady a instituce')}"><datalist id="lkCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <div class="form-field"><span>Oblasti</span>${pick('a', l.area_keys, areas().map(a => ({ key: a.key, name: a.name })), '—')}</div>
        <div class="form-field"><span>Štítky</span>${pick('t', l.tags, tagItems(), '—')}</div>
        <label class="form-field"><span>Stav</span><select class="select" data-f="status"><option value="draft" ${l.status !== 'published' ? 'selected' : ''}>Koncept</option><option value="published" ${l.status === 'published' ? 'selected' : ''}>Zveřejněný</option></select></label></div>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Zrušit</button><button type="button" class="btn accent" data-save>${l.id ? 'Uložit' : 'Přidat odkaz'}</button></div></div>`;
  }
  function row(l, i, n) {
    if (editing === l.id) return `<li class="nw-item editing"><span></span><div class="nw-main">${form(l)}</div><span></span></li>`;
    const chips = [...l.area_keys.map(k => `<span class="nw-chip area">${esc(areaName(k))}</span>`), ...l.tags.map(k => `<span class="nw-chip">${esc(tagName(k))}</span>`)].join('');
    return `<li class="nw-item" data-id="${l.id}"><span class="lk-st ${l.status}" title="${l.status === 'published' ? 'Zveřejněný' : 'Koncept'}"></span>
      <div class="nw-main"><div class="nw-meta">${l.status === 'published' ? 'Zveřejněný' : 'Koncept'} · ${esc(host(l.url))}</div>
        <a class="nw-title" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)} ↗</a>${l.description ? `<p class="nw-sum">${esc(l.description)}</p>` : ''}${chips ? `<div class="nw-links">${chips}</div>` : ''}</div>
      <div class="nw-act"><button type="button" class="btn tiny" data-mv="-1" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn tiny" data-mv="1" ${i < n - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" class="btn tiny${l.status === 'published' ? '' : ' accent'}" data-pub>${l.status === 'published' ? 'Skrýt' : 'Zveřejnit'}</button><button type="button" class="btn tiny" data-ed>Upravit</button><button type="button" class="btn tiny danger" data-del>Smazat</button></div></li>`;
  }
  async function render() {
    const box = document.getElementById('linksContent'); if (!box) return;
    if (!L) { box.innerHTML = '<p class="fine">Načítám…</p>'; try { L = await rpc('rq_links_admin', {}); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; } }
    const f = s => String(s || '').toLocaleLowerCase('cs');
    const xs = L.filter(l => (st === 'all' || l.status === st) && (!q || f([l.title, l.url, l.description, l.category].join(' ')).includes(f(q))));
    const cats = [...new Set(xs.map(l => l.category))].sort((a, b) => (CATS.indexOf(a) + 1 || 99) - (CATS.indexOf(b) + 1 || 99) || a.localeCompare(b, 'cs'));
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">VÝUKA / UŽITEČNÉ ODKAZY</div><h1>Užitečné odkazy</h1>
      <p>Rozcestník webů pro studenty (úřady, databáze, legislativa, normy…). Zveřejněné odkazy studenti vidí hned v záložce Odkazy; otevírají se v novém okně.</p></div>
      <div class="head-actions"><button type="button" class="btn accent" id="lkNew">+ Nový odkaz</button></div></div>
      ${editing === 'new' ? form({}) : ''}
      <div class="nw-tabs">${[['all', 'Vše'], ['draft', 'Koncepty'], ['published', 'Zveřejněné']].map(([k, l]) => `<button type="button" class="btn${st === k ? ' accent' : ''}" data-st="${k}">${l} (${k === 'all' ? L.length : L.filter(x => x.status === k).length})</button>`).join('')}
        <input class="input lk-q" id="lkQ" placeholder="Hledat…" value="${esc(q)}"></div>
      ${cats.map(c => { const ys = xs.filter(l => l.category === c); return `<h3 class="lk-cat">${esc(c)} <small>${ys.length}</small></h3><ul class="nw-list">${ys.map((l, i) => row(l, i, ys.length)).join('')}</ul>`; }).join('') || '<p class="fine">Žádné odkazy.</p>'}`;
    bind(box);
  }
  async function run(fn, msg) { try { await fn(); L = await rpc('rq_links_admin', {}); toast(msg); render(); return true; } catch (e) { toast(e.message, true); return false; } }
  function bindForm(fr, id) {
    fr.querySelectorAll('.gq-pick').forEach(d => d.addEventListener('change', () => syncPick(d)));
    fr.querySelector('[data-cancel]').onclick = () => { editing = null; render(); };
    fr.querySelector('[data-save]').onclick = async () => {
      const v = k => fr.querySelector(`[data-f="${k}"]`).value;
      if (await run(() => rpc('rq_save_link', { p_id: id, p: { title: v('title'), url: v('url').trim(), description: v('description'), category: v('category'), status: v('status'), area_keys: readPick(fr, 'a'), tags: readPick(fr, 't') } }), id ? 'Odkaz uložen.' : 'Odkaz přidán.')) { editing = null; render(); }
    };
  }
  function bind(box) {
    box.querySelector('#lkNew').onclick = () => { editing = 'new'; render(); box.querySelector('[data-f=title]')?.focus(); };
    box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { st = b.dataset.st; render(); });
    let t; const qi = box.querySelector('#lkQ'); qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); const p = qi.selectionStart; render().then(() => { const n = document.getElementById('lkQ'); n.focus(); n.setSelectionRange(p, p); }); }, 250); };
    box.querySelectorAll('[data-form]').forEach(fr => bindForm(fr, fr.dataset.form === 'new' ? null : +fr.dataset.form));
    box.querySelectorAll('.nw-item[data-id]').forEach(li => {
      const l = L.find(x => x.id === +li.dataset.id);
      li.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => run(() => rpc('rq_move_link', { p_id: l.id, p_dir: +b.dataset.mv }), 'Pořadí změněno.'));
      li.querySelector('[data-pub]').onclick = () => run(() => rpc('rq_save_link', { p_id: l.id, p: { ...l, status: l.status === 'published' ? 'draft' : 'published' } }), l.status === 'published' ? 'Odkaz skryt.' : 'Zveřejněno – studenti ho vidí hned.');
      li.querySelector('[data-ed]').onclick = () => { editing = l.id; render(); };
      li.querySelector('[data-del]').onclick = () => { if (confirm(`Smazat odkaz „${l.title}“?`)) run(() => rpc('rq_delete_link', { p_id: l.id }), 'Odkaz smazán.'); };
    });
  }
  return { render, leave: () => { editing = null; L = null; } };
})();
