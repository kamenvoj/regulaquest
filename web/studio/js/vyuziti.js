'use strict';
/* RegulaQuest Studio – Připomínky studentů a souhrnný přehled využívání čtečky.
   Připomínky jsou bez vazby na účet. Využívání: jen souhrny za skupinu nebo za všechny, nikdy po jednotlivých účtech. */
const RQ_READER = () => { const a = document.querySelector('[data-reader=""]'); return a ? a.href.replace(/\/$/, '') : ''; };

window.RQFeedback = (function () {
  let F = null, st = 'new';
  const KIND = { error: 'Chyba', unclear: 'Nejasnost', idea: 'Návrh' };
  const WHERE = { unit: 'Ustanovení', slide: 'Snímek', case: 'Řešený případ', path: 'Trasa', other: 'Obecně' };
  const fmt = s => new Date(s).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function href(f) {
    const b = RQ_READER() + '/?nahled=pracovni', e = encodeURIComponent;
    return f.target_kind === 'unit' && f.target_id ? `${b}#/u/${e(f.target_id)}`
      : f.target_kind === 'slide' && f.target_ref ? `${b}#/prezentace/${e(f.target_ref)}${f.target_id ? '/' + e(f.target_id) : ''}`
      : f.target_kind === 'case' && f.target_id ? `${b}#/pripad/${e(f.target_id)}`
      : f.target_kind === 'path' && f.target_id ? `${b}#/t/${e(f.target_id)}` : '';
  }
  function badge() { const el = document.getElementById('navFeedback'); if (el && F) el.textContent = F.filter(f => f.status === 'new').length || ''; }
  async function load(force) { if (!F || force) { F = await rpc('rq_feedback_admin', {}); badge(); } return F; }
  async function render() {
    const box = document.getElementById('feedbackContent'); if (!box) return;
    if (!F) { box.innerHTML = '<p class="fine">Načítám…</p>'; try { await load(); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; } }
    const n = s => F.filter(f => f.status === s).length, xs = F.filter(f => st === 'all' || f.status === st);
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">ZPĚTNÁ VAZBA / PŘIPOMÍNKY STUDENTŮ</div><h1>Připomínky studentů</h1>
      <p>Chyby, nejasnosti a návrhy, které studenti poslali tlačítkem „⚑ Nahlásit chybu / nejasnost“ ve studentské části. Připomínky jsou anonymní – neukládá se, kdo je poslal.</p></div></div>
      <div class="nw-tabs"><button type="button" class="btn tiny${st === 'new' ? ' accent' : ''}" data-fs="new">Nové (${n('new')})</button><button type="button" class="btn tiny${st === 'done' ? ' accent' : ''}" data-fs="done">Vyřešené (${n('done')})</button><button type="button" class="btn tiny${st === 'all' ? ' accent' : ''}" data-fs="all">Vše (${F.length})</button></div>
      ${xs.length ? `<ul class="nw-list fb-list">${xs.map(f => `<li class="nw-item${f.status === 'done' ? ' fb-done' : ''}" data-id="${f.id}"><div class="nw-main">
        <div class="fb-meta"><span class="fb-kind k-${f.kind}">${KIND[f.kind] || f.kind}</span> ${esc(WHERE[f.target_kind] || '')}${f.target_label ? ': <strong>' + esc(f.target_label) + '</strong>' : ''} <small class="fine">· ${esc(fmt(f.created_at))}</small></div>
        <div class="fb-msg">${esc(f.message).replace(/\n/g, '<br>')}</div>
        <input class="input fb-note-in" data-note value="${esc(f.note || '')}" maxlength="500" placeholder="Poznámka redakce (např. co bylo opraveno) – studenti ji nevidí">
      </div><div class="nw-actions">${href(f) ? `<a class="btn tiny" href="${esc(href(f))}" target="_blank" rel="noopener">Otevřít místo ↗</a>` : ''}
        ${f.status === 'new' ? '<button type="button" class="btn tiny accent" data-set="done">✓ Vyřešeno</button>' : '<button type="button" class="btn tiny" data-set="new">Vrátit mezi nové</button>'}
        <button type="button" class="btn tiny" data-del>Smazat</button></div></li>`).join('')}</ul>`
        : `<div class="notice">${st === 'new' ? 'Žádné nové připomínky.' : 'Nic tu není.'}</div>`}`;
    box.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { st = b.dataset.fs; render(); });
    box.querySelectorAll('.fb-list > li').forEach(li => {
      const id = +li.dataset.id, note = () => li.querySelector('[data-note]').value;
      const run = (p, msg) => p.then(() => load(true)).then(() => { render(); if (msg) toast(msg); }).catch(e => toast(e.message, true));
      li.querySelectorAll('[data-set]').forEach(b => b.onclick = () => run(rpc('rq_feedback_set', { p_id: id, p_status: b.dataset.set, p_note: note() }), b.dataset.set === 'done' ? 'Označeno jako vyřešené.' : ''));
      li.querySelector('[data-note]').onchange = () => run(rpc('rq_feedback_set', { p_id: id, p_status: null, p_note: note() }), 'Poznámka uložena.');
      li.querySelector('[data-del]').onclick = () => { if (confirm('Smazat připomínku?')) run(rpc('rq_delete_feedback', { p_id: id }), 'Smazáno.'); };
    });
  }
  setTimeout(() => load().catch(() => {}), 1500);      // počet nových v levém panelu
  return { render, load };
})();

window.RQUsage = (function () {
  let R = null, grp = '', range = '30';
  const DAYS = { '7': 'posledních 7 dní', '30': 'posledních 30 dní', '90': 'posledních 90 dní', '365': 'posledních 12 měsíců' };
  const iso = d => d.toISOString().slice(0, 10);
  const num = x => x == null ? '–' : Number(x).toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  const mins = m => m == null ? '–' : m >= 120 ? `${num(Math.round(m / 6) / 10)} h` : `${num(m)} min`;
  const KINDS = { unit: 'Ustanovení', doc: 'Dokumenty (přehled)', pres: 'Prezentace', case: 'Řešené případy', path: 'Trasy' };
  const PAGES = { home: 'Přehled', docs: 'Dokumenty', finder: 'Najít předpisy', guide: 'Průvodce', paths: 'Trasy', terms: 'Pojmy', marks: 'Záložky', news: 'Co je nového', updates: 'Aktuality', cases: 'Řešené případy', links: 'Odkazy', prlist: 'Prezentace', search: 'Hledání' };

  function bars(items, max) {   // vodorovné pruhy: [{label, n, sub}]
    max = max || Math.max(1, ...items.map(i => i.n));
    return `<div class="us-bars">${items.map(i => `<div class="us-bar"><span class="us-l" title="${esc(i.label)}">${esc(i.label)}</span><span class="us-t"><span style="width:${Math.max(2, i.n / max * 100)}%"></span></span><span class="us-n">${num(i.n)}${i.sub ? ` <small>${esc(i.sub)}</small>` : ''}</span></div>`).join('')}</div>`;
  }
  function daily(d, from, to) {   // sloupce po dnech: aktivní studenti
    const map = new Map(d.map(x => [x.day, x])), days = [];
    for (let t = new Date(from + 'T12:00:00'); iso(t) <= to; t.setDate(t.getDate() + 1)) days.push(iso(t));
    if (days.length > 120) return '';
    const max = Math.max(1, ...d.map(x => x.active));
    return `<div class="us-days" role="img" aria-label="Aktivní studenti po dnech">${days.map(k => { const x = map.get(k), a = x ? x.active : 0;
      return `<span title="${new Date(k + 'T12:00:00').toLocaleDateString('cs-CZ')}: ${a} aktivních, ${x ? mins(x.minutes) : '0 min'}"><i style="height:${a ? Math.max(4, a / max * 100) : 0}%"></i></span>`; }).join('')}</div>
      <div class="us-axis"><span>${new Date(from + 'T12:00:00').toLocaleDateString('cs-CZ')}</span><span>max. ${max} aktivních za den</span><span>${new Date(to + 'T12:00:00').toLocaleDateString('cs-CZ')}</span></div>`;
  }
  const tile = (big, label, sub) => `<div class="us-tile"><strong>${big}</strong><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

  async function render() {
    const box = document.getElementById('usageContent'); if (!box) return;
    box.innerHTML = '<p class="fine">Načítám…</p>';
    const to = new Date(), from = new Date(); from.setDate(to.getDate() - (+range - 1));
    try { R = await rpc('rq_usage_report', { p_group: grp || null, p_from: iso(from), p_to: iso(to) }); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
    const p = R.per_student || {}, k = R.kinds || {}, pct = R.accounts ? Math.round(R.active / R.accounts * 100) : 0;
    const wd = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((n, i) => ({ label: n, n: (R.weekdays || {})[i + 1] || 0 }));
    const top = (key, title) => (R.top[key] || []).length ? `<div class="us-card"><h3>${title}</h3>${bars(R.top[key].map(x => ({ label: x.label || x.id, n: x.n })))}</div>` : '';
    const pages = (R.top.page || []).map(x => ({ label: PAGES[x.id] || x.id, n: x.n })).filter(x => !['unit', 'doc', 'pres', 'case', 'path'].includes(x.label));
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">ZPĚTNÁ VAZBA / VYUŽÍVÁNÍ</div><h1>Využívání studentské části</h1>
      <p>Souhrnný obrázek o tom, jak studenti studentskou část používají. Jen souhrny za skupinu nebo za všechny – nikdy po jednotlivých účtech. Redakce (admini) se nepočítá.</p></div></div>
      <div class="us-filter"><label>Skupina <select class="select" id="usGrp"><option value="">Všechny skupiny</option>${R.groups.map(g => `<option value="${esc(g.id)}"${g.id === grp ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
        <label>Období <select class="select" id="usRange">${Object.entries(DAYS).map(([v, n]) => `<option value="${v}"${v === range ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="us-tiles">
        ${tile(`${R.active} z ${R.accounts}`, 'studentů pracovalo ve studentské části', R.accounts ? `${pct} % účtů` : 'zatím žádné studentské účty')}
        ${tile(num(p.visits_total || 0), [1].includes(+p.visits_total) ? 'návštěva celkem' : +p.visits_total >= 2 && +p.visits_total <= 4 ? 'návštěvy celkem' : 'návštěv celkem', R.small ? '' : `typicky ${num(p.visits_median)} na studenta (průměr ${num(p.visits_mean)})`)}
        ${tile(mins(p.minutes_total || 0), 'čas celkem', R.small ? '' : `typicky ${mins(p.minutes_median)} na studenta`)}
        ${R.small ? '' : tile(num(p.days_median), 'dní s aktivitou (medián)', `průměr ${num(p.days_mean)} · jedna návštěva typicky ${mins(p.visit_minutes_median)}`)}
      </div>
      ${R.small ? `<div class="notice">Rozložení na studenty (typický čas, jak často se vracejí) se ukáže, až bude ve vybrané skupině a období aspoň 5 aktivních studentů – u menšího počtu by šlo odhadovat jednotlivce.</div>` : `
      <div class="us-grid">
        <div class="us-card"><h3>Čas na studenta za období</h3>${bars(['do 15 min', '15–60 min', '1–3 h', 'nad 3 h'].map(l => ({ label: l, n: p.minutes_buckets[l] || 0, sub: 'stud.' })))}<p class="fine">Prostřední polovina studentů: ${mins(p.minutes_p25)} – ${mins(p.minutes_p75)} (průměr ${mins(p.minutes_mean)}).</p></div>
        <div class="us-card"><h3>Kolikrát přišli</h3>${bars([['1', '1×'], ['2–3', '2–3×'], ['4–9', '4–9×'], ['10+', '10× a víc']].map(([k, l]) => ({ label: l, n: p.visits_buckets[k] || 0, sub: 'stud.' })))}<p class="fine">Návštěva = otevření studentské části, nebo návrat po 30 minutách nečinnosti.</p></div>
      </div>`}
      <div class="us-card"><h3>Aktivní studenti po dnech</h3>${daily(R.daily, R.from, R.to) || '<p class="fine">Pro tak dlouhé období se graf po dnech nekreslí.</p>'}</div>
      <div class="us-grid">
        <div class="us-card"><h3>Návštěvy podle dne v týdnu</h3>${bars(wd)}</div>
        <div class="us-card"><h3>Co otevírali</h3>${Object.keys(KINDS).some(x => k[x]) ? bars(Object.entries(KINDS).filter(([x]) => k[x]).map(([x, l]) => ({ label: l, n: k[x] }))) : '<p class="fine">Zatím nic.</p>'}
          ${pages.length ? `<h4>Stránky studentské části</h4>${bars(pages)}` : ''}</div>
        <div class="us-card"><h3>Oblasti</h3>${(R.areas || []).length ? bars(R.areas.map(a => ({ label: a.name, n: a.n }))) : '<p class="fine">Zatím nic – nebo dokumenty nejsou zařazené do oblastí.</p>'}</div>
        ${top('unit', 'Nejčtenější ustanovení')}${top('pres', 'Nejotevíranější prezentace')}${top('case', 'Řešené případy')}${top('path', 'Trasy')}
        <div class="us-card"><h3>Hledání bez výsledku</h3>${(R.search_misses || []).length ? `<p class="fine">Co studenti hledali a nenašli – tipy, co doplnit nebo jak to pojmenovat.</p>${bars(R.search_misses.map(x => ({ label: x.q, n: x.n })))}` : '<p class="fine">Žádné.</p>'}</div>
        <div class="us-card"><h3>Nejčastěji hledané</h3>${(R.searches || []).length ? bars(R.searches.map(x => ({ label: x.q, n: x.n }))) : '<p class="fine">Zatím nic.</p>'}</div>
      </div>
      <p class="fine">Čas se počítá jen při otevřené kartě studentské části a aktivitě studenta (po 3 minutách bez pohybu se zastaví). Denní záznamy o čase se po 13 měsících mažou; co se čte a hledá, se ukládá bez vazby na účet.</p>`;
    box.querySelector('#usGrp').onchange = e => { grp = e.target.value; render(); };
    box.querySelector('#usRange').onchange = e => { range = e.target.value; render(); };
  }
  return { render };
})();
