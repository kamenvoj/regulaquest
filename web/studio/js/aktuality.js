'use strict';
/* RegulaQuest Studio – Aktuality: novinky ze zdrojů (RSS) a ručně přidané odkazy.
   Redakce je přečte, okomentuje, přiřadí k oblastem, štítkům, dokumentům a ustanovením a vybrané zveřejní
   (studenti je vidí hned, bez publikace obsahu). Nevyřízené se po 90 dnech samy přesunou mezi zamítnuté. */
window.RQNews = (function () {
  let N = null, loading = null, tab = 'new', srcF = 'all', areaF = 'all', q = '', sel = new Set(), editing = null, sort = 'new', page = 0;
  let per = (() => { try { return +localStorage.getItem('rq-aktuality-pocet') || 25; } catch { return 25; } })();
  const STATUS = { new: 'Nové', read: 'Přečtené', published: 'Zveřejněné', rejected: 'Zamítnuté' };
  const areas = () => (db.areas || []).filter(a => !a.archived);
  const areaName = k => (db.areas || []).find(a => a.key === k)?.name || k;
  const tagName = k => (db.tags || []).find(t => t.key === k)?.name || k;
  const fmt = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('cs-CZ'); };
  const groups = () => { const m = new Map(); (db.documents || []).filter(d => !d.archived).forEach(d => { const k = d.group_key || d.id; if (!m.has(k) || d.language === 'cs') m.set(k, d); }); return [...m.entries()].map(([key, d]) => ({ key, name: d.short_title || d.family || d.title })); };
  const unitLabel = id => { const u = getUnit(id); if (!u) return null; const d = getDoc(u.document_id); return `${d ? d.family + ' · ' + d.language.toUpperCase() : ''} › ${u.label}`; };

  async function load(force) {
    if (N && !force) return N;
    if (!loading) loading = rpc('rq_news_admin', {}).then(r => { N = r; loading = null; badge(); return N; }).catch(e => { loading = null; throw e; });
    return loading;
  }
  function badge() { const el = document.getElementById('navNews'); if (el && N) { const n = N.items.filter(i => i.status === 'new').length; el.textContent = n || ''; } }

  function pick(name, selected, items, empty) {
    const s = new Set(selected || []);
    const label = s.size ? [...s].map(k => items.find(i => i.key === k)?.name || k).join(', ') : empty;
    return `<details class="gq-pick" data-pick="${name}" data-empty="${esc(empty)}"><summary title="${esc(label)}">${esc(label)}</summary><div class="gq-pick-list">
      ${items.map(i => i.group ? `<div class="gq-pick-g">${esc(i.group)}</div>` : `<label><input type="checkbox" value="${esc(i.key)}" ${s.has(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>`;
  }
  const readPick = (root, name) => [...root.querySelectorAll(`[data-pick="${name}"] input:checked`)].map(x => x.value);
  const syncPick = d => { const s = d.querySelector('summary'), on = [...d.querySelectorAll('input:checked')].map(x => x.parentElement.textContent.trim()); s.textContent = on.length ? on.join(', ') : d.dataset.empty; s.title = s.textContent; };
  const tagItems = () => (db.tag_groups || []).flatMap(g => [{ group: g.name }, ...(db.tags || []).filter(t => t.group_key === g.key && !t.archived).map(t => ({ key: t.key, name: t.name }))]);

  const list = () => { const all = visible(); return per ? all.slice(page * per, page * per + per) : all; };
  function visible() {
    const f = s => s.toLocaleLowerCase('cs');
    const key = i => i.published_at || i.fetched_at || '';
    return N.items.filter(i => i.status === tab && (srcF === 'all' || String(i.source_id ?? 'manual') === srcF) && (areaF === 'all' || i.area_keys.includes(areaF))
      && (!q || f([i.title, i.summary, i.comment, i.source_name].join(' ')).includes(f(q))))
      .sort((a, b) => sort === 'old' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
  }

  function editor(i) {
    return `<div class="nw-edit" data-edit-id="${i.id}">
      <label class="form-field"><span>Název</span><input class="input" data-f="title" maxlength="400" value="${esc(i.title)}"></label>
      <label class="form-field"><span>Výtah</span><textarea class="textarea" data-f="summary" maxlength="1500" rows="3">${esc(i.summary)}</textarea></label>
      <label class="form-field"><span>Komentář redakce pro studenty (proč je to důležité)</span><textarea class="textarea" data-f="comment" maxlength="2000" rows="3" placeholder="Např. Nová revize pokynu ke klasifikaci IVD – mění pravidlo 3.">${esc(i.comment)}</textarea></label>
      <div class="nw-picks"><div class="form-field"><span>Oblasti</span>${pick('a', i.area_keys, areas().map(a => ({ key: a.key, name: a.name })), '—')}</div>
        <div class="form-field"><span>Štítky</span>${pick('t', i.tags, tagItems(), '—')}</div>
        <div class="form-field"><span>Dokumenty</span>${pick('g', i.group_keys, groups(), '—')}</div></div>
      <div class="form-field"><span>Ustanovení</span><div class="nw-units">${i.unit_ids.map(id => `<span class="role-chip on">${esc(unitLabel(id) || id)}<button type="button" data-unlink="${esc(id)}" aria-label="Odebrat">×</button></span>`).join('') || '<small class="fine">Žádná. Propojte z textu dokumentu: pod nadpisem ustanovení „+ Aktualita“.</small>'}</div></div>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Zrušit</button><button type="button" class="btn accent" data-save>Uložit</button></div></div>`;
  }
  function row(i) {
    const links = [...i.area_keys.map(k => `<span class="nw-chip area">${esc(areaName(k))}</span>`), ...i.tags.map(k => `<span class="nw-chip">${esc(tagName(k))}</span>`),
      ...i.group_keys.map(k => `<span class="nw-chip doc">${esc(groups().find(g => g.key === k)?.name || k)}</span>`), ...i.unit_ids.map(id => `<button type="button" class="nw-chip unit" data-open="${esc(id)}">${esc(unitLabel(id) || 'ustanovení')}</button>`)].join('');
    const acts = { new: [['read', 'Přečteno'], ['published', 'Zveřejnit'], ['rejected', 'Zamítnout']], read: [['published', 'Zveřejnit'], ['rejected', 'Zamítnout'], ['new', 'Vrátit mezi nové']],
      published: [['read', 'Stáhnout ze studentské části'], ['rejected', 'Zamítnout']], rejected: [['read', 'Obnovit']] }[i.status];
    return `<li class="nw-item${editing === i.id ? ' editing' : ''}" data-id="${i.id}"><input type="checkbox" class="nw-sel" ${sel.has(i.id) ? 'checked' : ''} aria-label="Vybrat">
      <div class="nw-main"><div class="nw-meta">${esc(fmt(i.published_at || i.fetched_at))} · ${esc(i.source_name || 'Ručně')}${i.status === 'published' && i.published_on ? ` · zveřejněno ${esc(fmt(i.published_on))}` : ''}</div>
        <a class="nw-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)} ↗</a>
        ${i.summary ? `<p class="nw-sum">${esc(i.summary)}</p>` : ''}${i.comment ? `<p class="nw-com"><b>Redakce:</b> ${esc(i.comment)}</p>` : ''}
        ${links ? `<div class="nw-links">${links}</div>` : ''}${editing === i.id ? editor(i) : ''}</div>
      <div class="nw-act">${acts.map(([s, l]) => `<button type="button" class="btn tiny${s === 'published' ? ' accent' : s === 'rejected' ? ' danger' : ''}" data-st="${s}">${l}</button>`).join('')}<button type="button" class="btn tiny" data-ed>${editing === i.id ? 'Zavřít' : 'Upravit'}</button></div></li>`;
  }

  async function render() {
    const box = document.getElementById('newsContent'); if (!box) return;
    if (!N) { box.innerHTML = '<p class="fine">Načítám aktuality…</p>'; try { await load(); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; } }
    const cnt = s => N.items.filter(i => i.status === s).length, all = visible();
    const pages = per ? Math.max(1, Math.ceil(all.length / per)) : 1; page = Math.min(page, pages - 1);
    const list = per ? all.slice(page * per, page * per + per) : all;
    sel = new Set([...sel].filter(id => list.some(i => i.id === id)));
    const pager = pages > 1 ? `<div class="nw-pager"><button type="button" class="btn tiny" data-pg="${page - 1}" ${page ? '' : 'disabled'}>← Předchozí</button>${Array.from({ length: pages }, (_, k) => `<button type="button" class="btn tiny${k === page ? ' accent' : ''}" data-pg="${k}">${k + 1}</button>`).join('')}<button type="button" class="btn tiny" data-pg="${page + 1}" ${page < pages - 1 ? '' : 'disabled'}>Další →</button></div>` : '';
    const warn = !N.net ? 'Stahování ze zdrojů není zapnuté: v Supabase → Database → Extensions zapněte <b>pg_net</b> a <b>pg_cron</b> a spusťte znovu migraci 20_aktuality.sql. Do té doby jde aktuality přidávat ručně.'
      : !N.scheduled ? 'Automatické načítání (pg_cron) není zapnuté – nové položky načtete tlačítkem „Načíst nové“. Po zapnutí pg_cron spusťte znovu migraci 20_aktuality.sql.' : '';
    const errs = N.sources.filter(s => s.active && s.last_error);
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">VÝUKA / AKTUALITY</div><h1>Aktuality</h1>
      <p>Novinky ze zdrojů (načítají se dvakrát denně) a ručně přidané odkazy. Zveřejněné studenti uvidí hned v záložce Aktuality a u propojených ustanovení. Nevyřízené se po 90 dnech samy přesunou mezi zamítnuté.</p></div>
      <div class="head-actions"><button type="button" class="btn" id="nwFetch" ${N.net ? '' : 'disabled'}>⟳ Načíst nové</button><button type="button" class="btn" id="nwAdd">+ Přidat ručně</button><button type="button" class="btn" id="nwSources">Zdroje (${N.sources.length})…</button></div></div>
      ${warn ? `<div class="notice">${warn}</div>` : ''}
      ${errs.length ? `<div class="notice">Problém se zdrojem: ${errs.map(s => `<b>${esc(s.name)}</b> – ${esc(s.last_error)}`).join('; ')}</div>` : ''}
      <div class="nw-tabs">${Object.entries(STATUS).map(([k, l]) => `<button type="button" class="btn${tab === k ? ' accent' : ''}" data-tab="${k}">${l} (${cnt(k)})</button>`).join('')}</div>
      <div class="nw-filters"><select class="select" id="nwSrc"><option value="all">Všechny zdroje</option>${N.sources.map(s => `<option value="${s.id}" ${srcF === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="manual" ${srcF === 'manual' ? 'selected' : ''}>Ručně přidané</option></select>
        <select class="select" id="nwArea"><option value="all">Všechny oblasti</option>${areas().map(a => `<option value="${esc(a.key)}" ${areaF === a.key ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <input class="input" id="nwQ" placeholder="Hledat v názvu, výtahu, komentáři…" value="${esc(q)}">
        <select class="select" id="nwSort" aria-label="Řazení"><option value="new" ${sort === 'new' ? 'selected' : ''}>Nejnovější nahoře</option><option value="old" ${sort === 'old' ? 'selected' : ''}>Nejstarší nahoře</option></select>
        <select class="select" id="nwPer" aria-label="Počet na stránku">${[10, 25, 50, 0].map(n => `<option value="${n}" ${per === n ? 'selected' : ''}>${n ? n + ' na stránku' : 'Vše na jedné stránce'}</option>`).join('')}</select></div>
      <div class="nw-bulk"><label class="inline-check"><input type="checkbox" id="nwAll" ${list.length && sel.size === list.length ? 'checked' : ''}> vybrat ${pages > 1 ? 'na této stránce' : 'vše'} (${list.length})</label>${pages > 1 ? `<span class="fine">Celkem ${all.length} · stránka ${page + 1} z ${pages}</span>` : ''}
        ${sel.size ? `<span>Vybráno ${sel.size}:</span>${tab !== 'read' ? '<button type="button" class="btn tiny" data-bulk="read">Přečteno</button>' : ''}${tab !== 'published' ? '<button type="button" class="btn tiny accent" data-bulk="published">Zveřejnit</button>' : ''}${tab !== 'rejected' ? '<button type="button" class="btn tiny danger" data-bulk="rejected">Zamítnout</button>' : ''}` : ''}</div>
      ${tab === 'rejected' ? '<p class="fine">Zamítnuté se studentům nezobrazují a znovu se nenačtou. Po roce se smažou úplně.</p>' : ''}
      <ul class="nw-list">${list.map(row).join('') || '<li class="nw-empty">Nic tu není.</li>'}</ul>${pager}`;
    bind(box);
  }

  async function run(fn, msg) { try { await fn(); await load(true); toast(msg); render(); return true; } catch (e) { toast(e.message, true); return false; } }
  const setStatus = (ids, s) => run(() => rpc('rq_news_set_status', { p_ids: ids, p_status: s }), { read: 'Označeno jako přečtené.', published: 'Zveřejněno – studenti to vidí hned.', rejected: 'Zamítnuto.', new: 'Vráceno mezi nové.' }[s]);

  function bind(box) {
    box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; sel.clear(); editing = null; page = 0; render(); });
    box.querySelector('#nwSrc').onchange = e => { srcF = e.target.value; page = 0; render(); };
    box.querySelector('#nwArea').onchange = e => { areaF = e.target.value; page = 0; render(); };
    box.querySelector('#nwSort').onchange = e => { sort = e.target.value; page = 0; render(); };
    box.querySelector('#nwPer').onchange = e => { per = +e.target.value; page = 0; try { localStorage.setItem('rq-aktuality-pocet', String(per)); } catch {} render(); };
    box.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { page = +b.dataset.pg; sel.clear(); editing = null; render(); window.scrollTo(0, 0); });
    let t; const qi = box.querySelector('#nwQ'); qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); page = 0; const p = qi.selectionStart; render().then(() => { const n = document.getElementById('nwQ'); n.focus(); n.setSelectionRange(p, p); }); }, 250); };
    box.querySelector('#nwAll').onchange = e => { list().forEach(i => e.target.checked ? sel.add(i.id) : sel.delete(i.id)); render(); };
    box.querySelectorAll('.nw-sel').forEach(c => c.onchange = () => { const id = +c.closest('[data-id]').dataset.id; c.checked ? sel.add(id) : sel.delete(id); render(); });
    box.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => setStatus([...sel], b.dataset.bulk).then(() => sel.clear()));
    box.querySelectorAll('.nw-item').forEach(li => {
      const id = +li.dataset.id, it = N.items.find(x => x.id === id);
      li.querySelectorAll('[data-st]').forEach(b => b.onclick = () => setStatus([id], b.dataset.st));
      li.querySelector('[data-ed]').onclick = () => { editing = editing === id ? null : id; render(); };
      li.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openUnit(b.dataset.open));
      li.querySelector('.nw-title').addEventListener('click', () => { if (it.status === 'new') rpc('rq_news_set_status', { p_ids: [id], p_status: 'read' }).then(() => { it.status = 'read'; badge(); }).catch(() => {}); });
      const ed = li.querySelector('.nw-edit'); if (!ed) return;
      ed.querySelectorAll('.gq-pick').forEach(d => d.addEventListener('change', () => syncPick(d)));
      const cur = { unit_ids: [...it.unit_ids] };
      ed.querySelectorAll('[data-unlink]').forEach(b => b.onclick = () => { cur.unit_ids = cur.unit_ids.filter(x => x !== b.dataset.unlink); b.parentElement.remove(); });
      ed.querySelector('[data-cancel]').onclick = () => { editing = null; render(); };
      ed.querySelector('[data-save]').onclick = async () => {
        const v = k => ed.querySelector(`[data-f="${k}"]`).value;
        if (await run(() => rpc('rq_save_news_item', { p_id: id, p: { title: v('title'), summary: v('summary'), comment: v('comment'), area_keys: readPick(ed, 'a'), tags: readPick(ed, 't'), group_keys: readPick(ed, 'g'), unit_ids: cur.unit_ids } }), 'Uloženo.')) { editing = null; render(); }
      };
    });
    box.querySelector('#nwAdd').onclick = addDialog;
    box.querySelector('#nwSources').onclick = sourcesDialog;
    box.querySelector('#nwFetch').onclick = fetchNow;
  }

  async function fetchNow() {
    const b = document.getElementById('nwFetch'); if (b) { b.disabled = true; b.textContent = 'Načítám…'; }
    try {
      const n = await rpc('rq_news_fetch_now', {});
      toast(`Stahuji z ${n} zdrojů…`);
      let added = 0;
      for (const wait of [5000, 6000, 8000]) {
        await new Promise(r => setTimeout(r, wait));
        added += await rpc('rq_news_collect_now', {});
        await load(true);
        if (!N.sources.some(s => s.last_request)) break;
      }
      toast(added ? `Nových aktualit: ${added}.` : 'Nic nového.');
    } catch (e) { toast(e.message, true); }
    tab = 'new'; render();
  }

  function addDialog() {
    const d = $('#modal'), f = $('#modalContent'); f.onsubmit = e => e.preventDefault();
    f.innerHTML = `<h2>Přidat aktualitu ručně</h2><p>Pro zdroje bez RSS (EUDAMED, MZ ČR, pokyny MDCG…). Přidaná položka je mezi přečtenými; zveřejníte ji v seznamu.</p>
      <label class="form-field"><span>Odkaz</span><input class="input" id="naUrl" placeholder="https://…"></label>
      <label class="form-field"><span>Název</span><input class="input" id="naTitle" maxlength="400"></label>
      <div class="rq-meta-grid"><label class="form-field"><span>Zdroj</span><input class="input" id="naSrc" maxlength="120" placeholder="Např. Evropská komise – MDCG"></label>
        <label class="form-field"><span>Datum</span><input class="input" id="naDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
      <label class="form-field"><span>Výtah (nepovinné)</span><textarea class="textarea" id="naSum" rows="3" maxlength="1500"></textarea></label>
      <label class="form-field"><span>Komentář redakce (nepovinné)</span><textarea class="textarea" id="naCom" rows="2" maxlength="2000"></textarea></label>
      <div class="form-field"><span>Oblasti</span>${pick('na', [], areas().map(a => ({ key: a.key, name: a.name })), '—')}</div>
      <div class="modal-actions"><button type="button" class="btn" id="naCancel">Zrušit</button><button type="button" class="btn accent" id="naSave">Přidat</button></div>`;
    f.querySelectorAll('.gq-pick').forEach(x => x.addEventListener('change', () => syncPick(x)));
    f.querySelector('#naCancel').onclick = () => d.close();
    f.querySelector('#naSave').onclick = async () => {
      const ok = await run(() => rpc('rq_save_news_item', { p_id: null, p: { url: f.querySelector('#naUrl').value, title: f.querySelector('#naTitle').value, source_name: f.querySelector('#naSrc').value || 'Přidáno ručně',
        published_at: f.querySelector('#naDate').value, summary: f.querySelector('#naSum').value, comment: f.querySelector('#naCom').value, area_keys: readPick(f, 'na') } }), 'Aktualita přidána.');
      if (ok) { d.close(); tab = 'read'; render(); }
    };
    d.showModal();
  }

  function sourcesDialog() {
    const d = $('#modal'), f = $('#modalContent'); f.onsubmit = e => e.preventDefault();
    const items = areas().map(a => ({ key: a.key, name: a.name }));
    const draw = () => {
      f.innerHTML = `<h2>Zdroje aktualit</h2><p>Adresa RSS nebo Atom kanálu (na webu bývá ikona RSS nebo odkaz „RSS“). Oblasti zdroje se předvyplní u každé nové položky. Smazáním zdroje zůstanou jeho dosavadní položky.</p>
        <div class="tg-group">${N.sources.map(s => `<div class="nw-src" data-id="${s.id}"><input class="input" data-name value="${esc(s.name)}" aria-label="Název"><input class="input" data-url value="${esc(s.url)}" aria-label="Adresa">
          ${pick('s' + s.id, s.area_keys, items, 'Bez oblasti')}<label class="inline-check"><input type="checkbox" data-active ${s.active ? 'checked' : ''}> načítat</label>
          <button type="button" class="btn tiny" data-save>Uložit</button><button type="button" class="btn tiny danger" data-del>Smazat</button>
          <small class="fine">${s.items} položek · ${s.last_ok_at ? 'naposledy v pořádku ' + esc(new Date(s.last_ok_at).toLocaleString('cs-CZ')) : 'zatím nenačteno'}${s.last_error ? ` · <span class="nw-err">${esc(s.last_error)}</span>` : ''}</small></div>`).join('')}
          <div class="nw-src new"><input class="input" id="nsName" placeholder="Název (např. SÚKL – všechny novinky)"><input class="input" id="nsUrl" placeholder="https://…/feed">${pick('snew', [], items, 'Bez oblasti')}<button type="button" class="btn tiny accent" id="nsAdd">Přidat zdroj</button></div></div>
        <div class="modal-actions"><button class="btn" type="button" id="nsClose">Zavřít</button></div>`;
      const go = async (fn, msg) => { try { await fn(); await load(true); toast(msg); draw(); render(); } catch (e) { toast(e.message, true); } };
      f.querySelectorAll('.gq-pick').forEach(x => x.addEventListener('change', () => syncPick(x)));
      f.querySelector('#nsClose').onclick = () => d.close();
      f.querySelectorAll('.nw-src[data-id]').forEach(r => { const id = +r.dataset.id;
        r.querySelector('[data-save]').onclick = () => go(() => rpc('rq_save_news_source', { p_id: id, p_name: r.querySelector('[data-name]').value, p_url: r.querySelector('[data-url]').value, p_area_keys: readPick(r, 's' + id), p_active: r.querySelector('[data-active]').checked }), 'Zdroj uložen.');
        r.querySelector('[data-del]').onclick = () => { if (confirm('Smazat zdroj? Dosavadní aktuality z něj zůstanou.')) go(() => rpc('rq_delete_news_source', { p_id: id }), 'Zdroj smazán.'); }; });
      f.querySelector('#nsAdd').onclick = () => go(() => rpc('rq_save_news_source', { p_id: null, p_name: f.querySelector('#nsName').value, p_url: f.querySelector('#nsUrl').value, p_area_keys: readPick(f.querySelector('.nw-src.new'), 'snew'), p_active: true }), 'Zdroj přidán.');
    };
    d.classList.add('wide'); d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
    draw(); d.showModal();
  }

  /* ---------- v textu dokumentu: řádek pod nadpisem ustanovení ---------- */
  function unitRow(u) {
    if (!N) { load().then(() => { const r = document.getElementById('rqNewsRow'); if (r && r.dataset.unit === u.id) { r.outerHTML = unitRow(u); bindUnit(document, u); } }).catch(() => {}); }
    const linked = N ? N.items.filter(i => i.unit_ids.includes(u.id) && i.status !== 'rejected') : [];
    return `<div class="roles-edit" id="rqNewsRow" data-unit="${esc(u.id)}"><span class="smallcaps">Aktuality</span>${linked.map(i => `<span class="role-chip on${i.status === 'published' ? '' : ' draft'}" title="${esc(STATUS[i.status])}">${esc(i.title.length > 60 ? i.title.slice(0, 59) + '…' : i.title)}<button type="button" data-news-del="${i.id}" aria-label="Odpojit">×</button></span>`).join('')}
      <span class="role-add"><button type="button" class="btn tiny" id="rqNewsAdd">+ Aktualita</button><div class="role-menu nw-pick" hidden><input class="input" id="rqNewsQ" placeholder="Hledat aktualitu…"><div id="rqNewsList"></div></div></span></div>`;
  }
  function bindUnit(box, u) {
    const row = box.querySelector('#rqNewsRow'); if (!row || !N) return;
    const relink = (id, add) => rpc('rq_news_link_unit', { p_id: id, p_unit_id: u.id, p_add: add }).then(() => load(true)).then(() => { toast(add ? 'Aktualita propojena.' : 'Aktualita odpojena.'); const r = document.getElementById('rqNewsRow'); if (r) { r.outerHTML = unitRow(u); bindUnit(document, u); } }).catch(e => toast(e.message, true));
    row.querySelectorAll('[data-news-del]').forEach(b => b.onclick = () => relink(+b.dataset.newsDel, false));
    const menu = row.querySelector('.nw-pick'), list = row.querySelector('#rqNewsList'), qi = row.querySelector('#rqNewsQ');
    const draw = () => { const f = qi.value.trim().toLocaleLowerCase('cs');
      const xs = N.items.filter(i => i.status !== 'rejected' && !i.unit_ids.includes(u.id) && (!f || i.title.toLocaleLowerCase('cs').includes(f))).slice(0, 30);
      list.innerHTML = xs.map(i => `<button type="button" data-news-add="${i.id}"><small>${esc(fmt(i.published_at || i.fetched_at))} · ${esc(STATUS[i.status])}</small>${esc(i.title)}</button>`).join('') || '<small class="fine">Nic nenalezeno.</small>';
      list.querySelectorAll('[data-news-add]').forEach(b => b.onclick = () => relink(+b.dataset.newsAdd, true)); };
    row.querySelector('#rqNewsAdd').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) { draw(); qi.focus(); document.addEventListener('click', function off(ev) { if (!menu.contains(ev.target)) { menu.hidden = true; document.removeEventListener('click', off); } }); } };
    qi.oninput = draw;
  }

  return { render, load, unitRow, bindUnit, leave: () => { editing = null; N = null; } };
})();
