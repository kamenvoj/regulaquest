'use strict';
/* RegulaQuest Studio – Editor scénářů simulací.
   Univerzální stavebnice: Základ, Ukazatele, Zprávy a podklady, Akce, Události, Hodnocení, Časová osa, JSON.
   Editor upravuje definici scénáře (JSON) – nikdo ji nemusí psát ručně. Oborové „balíčky“ (RQSimPacks) přidávají
   hotové šablony akcí (např. formuláře pro Vigilanci). */
window.RQSimPacks = {
  obecne: { label: 'Obecné', actions: [
    { label: 'Uzavřít případ a zobrazit rozbor', group: 'Čas', days: 0, end: true, confirm: 'Opravdu uzavřít? Další kroky už nepůjdou udělat.' },
    { label: 'Počkat jeden den', group: 'Čas', days: 1, repeat: true },
    { label: 'Rozhodnutí (volba)', group: 'Rozhodnutí', days: 0, choice: { prompt: 'Jak rozhodnete?', options: [{ id: 'o1', label: 'Možnost A' }, { id: 'o2', label: 'Možnost B' }] } },
    { label: 'Formulář', group: 'Dokumenty', days: 0, form: { title: 'Formulář', fields: [{ id: 'f1', label: 'Pole', type: 'text' }] } } ] },
  vigilance: { label: 'Vigilance', actions: [
    { label: 'Posoudit závažnost události', group: 'Posoudit a nahlásit', days: 0, choice: { prompt: 'Jak událost vyhodnotíte?', var: 'severity', options: [
      { id: 'serious', label: 'Závažná nežádoucí příhoda' }, { id: 'threat', label: 'Závažné ohrožení veřejného zdraví' },
      { id: 'nonserious', label: 'Nežádoucí příhoda, která není závažná – sledovat v trendech' }, { id: 'user', label: 'Chyba obsluhy – nehlásit' }] } },
    { label: 'Podat hlášení příslušnému orgánu (SÚKL)', group: 'Posoudit a nahlásit', days: 0, form: { title: 'Hlášení závažné nežádoucí příhody (zjednodušený formulář)', fields: [
      { id: 'type', label: 'Typ hlášení', type: 'select', options: [{ id: 'initial', label: 'Počáteční' }, { id: 'combined', label: 'Kombinované počáteční a konečné' }, { id: 'final', label: 'Konečné' }] },
      { id: 'class', label: 'Klasifikace', type: 'select', options: [{ id: 'serious', label: 'Závažná nežádoucí příhoda' }, { id: 'threat', label: 'Závažné ohrožení veřejného zdraví' }, { id: 'death', label: 'Úmrtí nebo nepředvídané vážné zhoršení zdravotního stavu' }] },
      { id: 'content', label: 'Co hlášení obsahuje', type: 'checks', options: [{ id: 'event', label: 'Popis události a důsledků pro pacienta' }, { id: 'device', label: 'Identifikace prostředku' }, { id: 'cause', label: 'Předběžné hodnocení příčiny' }, { id: 'steps', label: 'Další plánované kroky šetření' }] }] } },
    { label: 'Zahájit bezpečnostní nápravné opatření (FSCA)', group: 'Nápravná opatření', days: 2, form: { title: 'Bezpečnostní nápravné opatření (FSCA)', fields: [
      { id: 'measure', label: 'Opatření', type: 'select', options: [{ id: 'fix', label: 'Oprava / aktualizace dotčených prostředků' }, { id: 'recall', label: 'Stažení z trhu' }, { id: 'warn', label: 'Jen upozornění uživatelů' }] },
      { id: 'notify', label: 'Příslušný orgán', type: 'checks', options: [{ id: 'before', label: 'Oznámit opatření příslušnému orgánu před jeho zahájením' }] }] } },
    { label: 'Připravit bezpečnostní upozornění (FSN)', group: 'Nápravná opatření', days: 1, form: { title: 'Bezpečnostní upozornění (FSN)', fields: [
      { id: 'content', label: 'Obsah upozornění', type: 'checks', options: [{ id: 'ident', label: 'Identifikace dotčených prostředků' }, { id: 'problem', label: 'Popis problému a rizika' }, { id: 'now', label: 'Co mají uživatelé udělat hned' }, { id: 'plan', label: 'Opatření výrobce a termíny' }, { id: 'forward', label: 'Žádost o předání a potvrzení přijetí' }, { id: 'contact', label: 'Kontakt na výrobce' }] }] } },
    { label: 'Podat konečnou zprávu', group: 'Posoudit a nahlásit', days: 1 },
    { label: 'Vyžádat vrácení prostředku k analýze', group: 'Zjistit víc', days: 3 },
    { label: 'Prověřit podobné stížnosti (trendy)', group: 'Zjistit víc', days: 1 } ] }
};

window.RQSimEditor = (function () {
  let D = null, sc = null, tab = 'base', dirty = false, onBack = null, rawErr = '';
  const MODULES = { vigilance: 'Vigilance – nežádoucí příhody', obecne: 'Obecná simulace' };
  const TABS = [['base', 'Základ'], ['ind', 'Ukazatele'], ['msg', 'Zprávy a podklady'], ['act', 'Akce'], ['ev', 'Události'], ['rule', 'Hodnocení'], ['time', 'Časová osa'], ['json', 'JSON']];
  const clone = o => JSON.parse(JSON.stringify(o));
  const box = () => document.getElementById('simContent');
  const uid = (pre, taken) => { let i = 1; while (taken.has(pre + i)) i++; return pre + i; };
  const H = s => esc(s == null ? '' : String(s));

  // ---------- cesty v definici ----------
  const path = p => p.split('.').map(x => /^\d+$/.test(x) ? +x : x);
  function get(p) { return path(p).reduce((o, k) => o == null ? undefined : o[k], D); }
  function set(p, v) { const ks = path(p), last = ks.pop(); let o = D; ks.forEach((k, i) => { if (o[k] == null) o[k] = typeof ks[i + 1] === 'number' ? [] : {}; o = o[k]; }); if (v === undefined) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; } else o[last] = v; }

  // ---------- seznamy pro nabídky ----------
  const acts = () => (D.actions || []).map(a => ({ id: a.id, label: a.label || a.id }));
  const evs = () => (D.events || []).map(e => ({ id: e.id, label: e.label || e.id }));
  const msgs = () => Object.entries(D.messages || {}).map(([id, m]) => ({ id, label: m.subject || id }));
  const inds = () => (D.indicators || []).filter(i => i.var).map(i => ({ id: i.var, label: i.label || i.var }));
  function flags() {
    const f = new Set(); const walk = o => { if (!o || typeof o !== 'object') return; if (o.set && typeof o.set === 'object') Object.keys(o.set).forEach(k => f.add(k)); Object.values(o).forEach(walk); };
    walk(D.actions); walk(D.events); return [...f];
  }
  // odpovědi: volby a pole formulářů
  function answers() {
    const out = [];
    (D.actions || []).forEach(a => {
      if (a.choice) out.push({ id: a.choice.var || a.id, label: `${a.label} (volba)`, kind: 'choice', options: a.choice.options || [] });
      (a.form?.fields || []).forEach(f => out.push({ id: `form.${a.id}.${f.id}`, label: `${a.label} → ${f.label || f.id}`, kind: f.type || 'text', options: f.options || [] }));
    });
    return out;
  }
  const opt = (list, v, empty) => (empty ? `<option value="">${H(empty)}</option>` : '') + list.map(x => `<option value="${H(x.id)}"${x.id === v ? ' selected' : ''}>${H(x.label)}</option>`).join('');
  function refSuggestions() {
    try {
      const docs = (db.documents || []).filter(d => !d.archived && d.language === 'cs');
      const out = []; docs.forEach(d => { out.push(d.family); db.units.filter(u => u.document_id === d.id && /^(Článek|Příloha|§)/.test(u.label || '')).slice(0, 400).forEach(u => out.push(`${d.family}|${u.label}`)); });
      return [...new Set(out)];
    } catch { return []; }
  }

  // ---------- skládačka podmínek ----------
  const ROWS = { act: 'Akce', event: 'Událost', flag: 'Příznak', answer: 'Odpověď / volba', ind: 'Ukazatel', time: 'Čas', within: 'Lhůta od příznaku' };
  function parseRow(c) {
    if (!c || typeof c !== 'object') return { t: 'raw', c };
    const n = c.not;
    if (n && !n.all && !n.any) {
      if (n.done) return { t: 'act', op: 'notdone', a: n.done };
      if (n.started) return { t: 'act', op: 'notstarted', a: n.started };
      if (n.event) return { t: 'event', op: 'notfired', e: n.event };
      if (n.flag) return { t: 'flag', op: 'notset', f: n.flag };
      if (n.var && 'eq' in n) return { t: 'answer', op: 'neq', v: n.var, val: n.eq };
      if (n.var && n.has_any) return { t: 'answer', op: 'not_has_any', v: n.var, val: n.has_any };
    }
    if (c.done) return { t: 'act', op: 'done', a: c.done };
    if (c.started) return { t: 'act', op: 'started', a: c.started };
    if (c.done_by) return { t: 'act', op: 'done_by', a: c.done_by.action, d: c.done_by.day_lte };
    if (c.started_by) return { t: 'act', op: 'started_by', a: c.started_by.action, d: c.started_by.day_lte };
    if (c.done_before) return { t: 'act', op: 'done_before', a: c.done_before[0], b: c.done_before[1] };
    if (c.event) return { t: 'event', op: 'fired', e: c.event };
    if (c.flag) return { t: 'flag', op: 'set', f: c.flag };
    if (c.day_gte != null) return { t: 'time', op: 'gte', d: c.day_gte };
    if (c.day_lte != null) return { t: 'time', op: 'lte', d: c.day_lte };
    if (c.within) return { t: 'within', a: c.within.action, f: c.within.from_flag, d: c.within.days };
    if (c.var) {
      const isInd = inds().some(i => i.id === c.var);
      if ('gte' in c) return { t: 'ind', op: 'gte', v: c.var, n: c.gte };
      if ('lte' in c) return { t: 'ind', op: 'lte', v: c.var, n: c.lte };
      if ('eq' in c && isInd) return { t: 'ind', op: 'eq', v: c.var, n: c.eq };
      if ('eq' in c) return { t: 'answer', op: 'eq', v: c.var, val: c.eq };
      if (c.in) return { t: 'answer', op: 'in', v: c.var, val: c.in };
      if (c.has) return { t: 'answer', op: 'has', v: c.var, val: c.has };
      if (c.has_all) return { t: 'answer', op: 'has_all', v: c.var, val: c.has_all };
      if (c.has_any) return { t: 'answer', op: 'has_any', v: c.var, val: c.has_any };
      if (c.contains_any) return { t: 'answer', op: 'contains', v: c.var, val: c.contains_any };
    }
    return { t: 'raw', c };
  }
  function buildRow(r) {
    const num = x => x === '' || x == null || isNaN(+x) ? 0 : +x;
    switch (r.t) {
      case 'act': return { done: { done: r.a }, notdone: { not: { done: r.a } }, started: { started: r.a }, notstarted: { not: { started: r.a } },
        done_by: { done_by: { action: r.a, day_lte: num(r.d) } }, started_by: { started_by: { action: r.a, day_lte: num(r.d) } }, done_before: { done_before: [r.a, r.b || ''] } }[r.op] || { done: r.a };
      case 'event': return r.op === 'notfired' ? { not: { event: r.e } } : { event: r.e };
      case 'flag': return r.op === 'notset' ? { not: { flag: r.f } } : { flag: r.f };
      case 'time': return r.op === 'lte' ? { day_lte: num(r.d) } : { day_gte: num(r.d) };
      case 'within': return { within: { action: r.a, from_flag: r.f, days: num(r.d) } };
      case 'ind': return r.op === 'lte' ? { var: r.v, lte: num(r.n) } : r.op === 'eq' ? { var: r.v, eq: num(r.n) } : { var: r.v, gte: num(r.n) };
      case 'answer': {
        const arr = Array.isArray(r.val) ? r.val : r.val ? [r.val] : [], one = Array.isArray(r.val) ? r.val[0] : r.val;
        return { eq: { var: r.v, eq: one ?? '' }, neq: { not: { var: r.v, eq: one ?? '' } }, in: { var: r.v, in: arr }, has: { var: r.v, has: one ?? '' },
          has_all: { var: r.v, has_all: arr }, has_any: { var: r.v, has_any: arr }, not_has_any: { not: { var: r.v, has_any: arr } }, contains: { var: r.v, contains_any: arr } }[r.op] || { var: r.v, eq: one ?? '' };
      }
      default: return r.c;
    }
  }
  const defaultRow = t => ({ act: { done: acts()[0]?.id || '' }, event: { event: evs()[0]?.id || '' }, flag: { flag: flags()[0] || '' }, answer: { var: answers()[0]?.id || '', eq: '' },
    ind: { var: inds()[0]?.id || '', gte: 0 }, time: { day_gte: 1 }, within: { within: { action: acts()[0]?.id || '', from_flag: flags()[0] || '', days: 10 } } })[t] || { done: '' };
  // skupina = {all:[...]} nebo {any:[...]}; jednotlivá podmínka se zobrazí jako skupina s jedním řádkem
  function asGroup(c) { if (!c) return { all: [] }; if (c.all || c.any) return c; return { all: [c] }; }
  function condUI(p, label, optional) {
    const c = get(p);
    if (optional && !c) return `<div class="se-cond-off"><button class="btn tiny" data-cond-on="${H(p)}">+ ${H(label)}</button></div>`;
    return `<div class="se-cond" data-cond="${H(p)}"><div class="se-cond-h"><b>${H(label)}</b>${optional ? `<button class="btn tiny" data-cond-off="${H(p)}">Odebrat</button>` : ''}</div>${groupUI(asGroup(c), p, 0)}</div>`;
  }
  function groupUI(g, p, depth) {
    const key = g.any ? 'any' : 'all', items = g[key];
    return `<div class="se-grp${depth ? ' nested' : ''}" data-grp="${H(p)}" data-key="${key}">
      <select class="select tiny" data-grp-mode>${[['all', 'Platí všechny podmínky'], ['any', 'Platí alespoň jedna']].map(([k, l]) => `<option value="${k}"${k === key ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${items.map((c, i) => (c && (c.all || c.any)) ? `<div class="se-row">${groupUI(c, `${p}|${key}.${i}`, depth + 1)}<button class="btn tiny danger" data-row-del="${i}">×</button></div>` : rowUI(parseRow(c), i)).join('')}
      <div class="se-add"><select class="select tiny" data-row-add><option value="">+ podmínka…</option>${Object.entries(ROWS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}${depth ? '' : '<option value="group">Skupina (a zároveň / nebo)</option>'}</select></div></div>`;
  }
  function rowUI(r, i) {
    const sel = (k, list, v, empty) => `<select class="select tiny" data-r="${k}">${opt(list, v, empty)}</select>`;
    const ops = l => `<select class="select tiny" data-r="op">${l.map(([k, t]) => `<option value="${k}"${k === r.op ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    const numIn = (k, v, ph) => `<input class="input tiny" type="number" step="0.25" data-r="${k}" value="${H(v ?? '')}" placeholder="${H(ph || '')}" style="width:80px">`;
    let body = '';
    if (r.t === 'act') body = sel('a', acts(), r.a, '— akce —') + ops([['done', 'je hotová'], ['notdone', 'není hotová'], ['started', 'byla zahájena'], ['notstarted', 'nebyla zahájena'], ['done_by', 'hotová nejpozději v den'], ['started_by', 'zahájena nejpozději v den'], ['done_before', 'hotová dřív než akce']])
      + (['done_by', 'started_by'].includes(r.op) ? numIn('d', r.d, 'den') : '') + (r.op === 'done_before' ? sel('b', acts(), r.b, '— akce —') : '');
    else if (r.t === 'event') body = sel('e', evs(), r.e, '— událost —') + ops([['fired', 'nastala'], ['notfired', 'nenastala']]);
    else if (r.t === 'flag') body = `<input class="input tiny" list="seFlags" data-r="f" value="${H(r.f)}" placeholder="název příznaku" style="width:170px">` + ops([['set', 'je nastaven'], ['notset', 'není nastaven']]);
    else if (r.t === 'time') body = ops([['gte', 'den je alespoň'], ['lte', 'den je nejvýš']]) + numIn('d', r.d);
    else if (r.t === 'within') body = sel('a', acts(), r.a, '— akce —') + ' hotová do ' + numIn('d', r.d, 'dní') + ' dní od příznaku ' + `<input class="input tiny" list="seFlags" data-r="f" value="${H(r.f)}" style="width:150px">`;
    else if (r.t === 'ind') body = sel('v', inds(), r.v, '— ukazatel —') + ops([['gte', '≥'], ['lte', '≤'], ['eq', '=']]) + numIn('n', r.n);
    else if (r.t === 'answer') {
      const an = answers(), a = an.find(x => x.id === r.v), multi = ['in', 'has_all', 'has_any', 'not_has_any'].includes(r.op), vals = Array.isArray(r.val) ? r.val : r.val != null && r.val !== '' ? [r.val] : [];
      const opsL = a && a.kind === 'checks' ? [['has', 'obsahuje'], ['has_all', 'obsahuje vše z'], ['has_any', 'obsahuje některé z'], ['not_has_any', 'neobsahuje žádné z']]
        : a && a.kind === 'text' ? [['contains', 'text obsahuje některé slovo']] : [['eq', 'je'], ['neq', 'není'], ['in', 'je jedna z']];
      if (!opsL.some(o => o[0] === r.op)) r.op = opsL[0][0];
      body = `<select class="select tiny" data-r="v">${opt(an, r.v, '— odpověď —')}</select>` + ops(opsL);
      if (r.op === 'contains') body += `<input class="input tiny" data-r="words" value="${H(vals.join(', '))}" placeholder="slova oddělená čárkou" style="width:220px">`;
      else if (a && a.options.length) body += multi ? `<span class="se-checks">${a.options.map(o => `<label><input type="checkbox" data-r="vals" value="${H(o.id)}"${vals.includes(o.id) ? ' checked' : ''}> ${H(o.label)}</label>`).join('')}</span>`
        : `<select class="select tiny" data-r="val">${opt(a.options.map(o => ({ id: o.id, label: o.label })), vals[0], '— možnost —')}</select>`;
      else body += `<input class="input tiny" data-r="val" value="${H(vals[0] ?? '')}">`;
    } else body = `<textarea class="input tiny mono" data-r="raw" rows="2" style="width:100%">${H(JSON.stringify(r.c))}</textarea>`;
    return `<div class="se-row" data-row="${i}" data-t="${r.t}"><span class="se-rt">${H(ROWS[r.t] || 'Vlastní (JSON)')}</span>${body}<button class="btn tiny danger" data-row-del="${i}" title="Odebrat">×</button></div>`;
  }
  // čtení řádku z formuláře
  function readRow(el) {
    const t = el.dataset.t, q = k => el.querySelector(`[data-r="${k}"]`), v = k => q(k) ? q(k).value : undefined;
    if (t === 'raw') { try { return JSON.parse(v('raw')); } catch { return null; } }
    const r = { t, op: v('op'), a: v('a'), b: v('b'), e: v('e'), f: v('f'), d: v('d'), v: v('v'), n: v('n') };
    if (t === 'answer') {
      if (q('words')) r.val = v('words').split(',').map(x => x.trim()).filter(Boolean);
      else if (el.querySelector('[data-r="vals"]')) r.val = [...el.querySelectorAll('[data-r="vals"]:checked')].map(x => x.value);
      else r.val = v('val');
    }
    return buildRow(r);
  }
  function readGroup(el) {
    const key = el.querySelector(':scope > [data-grp-mode]').value, items = [];
    el.querySelectorAll(':scope > .se-row').forEach(row => {
      const sub = row.querySelector(':scope > .se-grp');
      if (sub) items.push(readGroup(sub)); else { const c = readRow(row); if (c) items.push(c); }
    });
    return { [key]: items };
  }
  function simplify(g) { const key = g.all ? 'all' : 'any', it = g[key]; return it.length === 1 && key === 'all' ? it[0] : g; }
  function bindCond(root) {
    root.querySelectorAll('[data-cond-on]').forEach(b => b.onclick = () => { set(b.dataset.condOn, { all: [] }); touch(true); });
    root.querySelectorAll('[data-cond-off]').forEach(b => b.onclick = () => { set(b.dataset.condOff, undefined); touch(true); });
    root.querySelectorAll('.se-cond').forEach(cw => {
      const p = cw.dataset.cond, top = () => cw.querySelector(':scope > .se-grp');
      const save = re => { set(p, simplify(readGroup(top()))); touch(re); };
      cw.addEventListener('change', e => {
        const t = e.target;
        if (t.matches('[data-row-add]')) {
          const g = t.closest('.se-grp'), key = g.querySelector(':scope > [data-grp-mode]').value, cur = readGroup(g);
          cur[key].push(t.value === 'group' ? { any: [defaultRow('act')] } : defaultRow(t.value));
          replaceGroup(g, cur); save(true); return;
        }
        save(t.matches('[data-r="v"], [data-r="op"], [data-grp-mode], [data-r="a"]'));
      });
      cw.addEventListener('click', e => {
        const b = e.target.closest('[data-row-del]'); if (!b) return;
        const g = b.closest('.se-grp'), cur = readGroup(g), key = Object.keys(cur)[0];
        cur[key].splice(+b.dataset.rowDel, 1); replaceGroup(g, cur); save(true);
      });
    });
  }
  // nahradí podskupinu v DOM novými daty (pro čtení celku)
  function replaceGroup(g, data) {
    const tmp = document.createElement('div'); tmp.innerHTML = groupUI(data, '', g.classList.contains('nested') ? 1 : 0);
    g.replaceWith(tmp.firstElementChild);
  }

  // ---------- efekty (zprávy, příznaky, ukazatele, konec) ----------
  function effUI(p, opts = {}) {
    const o = get(p) || {}, ms = o.messages || [], st = Object.keys(o.set || {}), ad = Object.entries(o.add || {});
    return `<div class="se-eff" data-eff="${H(p)}"><div class="se-eff-h">${H(opts.title || 'Co se stane')}</div>
      <div class="se-line"><span>Pošle zprávy:</span>${ms.map((m, i) => `<span class="se-chip">${H(D.messages?.[m]?.subject || m)}<button data-eff-del="messages.${i}">×</button></span>`).join('')}
        <select class="select tiny" data-eff-add="messages">${opt(msgs().filter(m => !ms.includes(m.id)), '', '+ zpráva…')}<option value="__new">+ nová zpráva…</option></select></div>
      <div class="se-line"><span>Nastaví příznaky:</span>${st.map(f => `<span class="se-chip">${H(f)}<button data-eff-del="set.${H(f)}">×</button></span>`).join('')}
        <input class="input tiny" list="seFlags" data-eff-add="set" placeholder="+ příznak (Enter)" style="width:160px"></div>
      ${inds().length ? `<div class="se-line"><span>Změní ukazatele:</span>${ad.map(([k, v]) => `<span class="se-chip">${H(inds().find(i => i.id === k)?.label || k)} <input class="input tiny" type="number" data-eff-num="${H(k)}" value="${H(v)}" style="width:80px"><button data-eff-del="add.${H(k)}">×</button></span>`).join('')}
        <select class="select tiny" data-eff-add="add">${opt(inds().filter(i => !(i.id in (o.add || {}))), '', '+ ukazatel…')}</select></div>` : ''}
      ${opts.end ? `<label class="se-line"><input type="checkbox" data-eff-end${o.end ? ' checked' : ''}> ukončí simulaci (rozbor)</label>` : ''}</div>`;
  }
  function bindEff(root) {
    root.querySelectorAll('.se-eff').forEach(el => {
      const p = el.dataset.eff, o = () => { if (!get(p)) set(p, {}); return get(p); };
      el.querySelectorAll('[data-eff-del]').forEach(b => b.onclick = () => { const [k, ...r] = b.dataset.effDel.split('.'), x = o(); if (k === 'messages') x.messages.splice(+r[0], 1); else delete x[k][r.join('.')]; touch(true); });
      el.querySelectorAll('[data-eff-add]').forEach(inp => {
        const k = inp.dataset.effAdd;
        if (inp.tagName === 'SELECT') inp.onchange = () => {
          const x = o(), v = inp.value; if (!v) return;
          if (k === 'messages') { let id = v; if (v === '__new') { id = uid('m', new Set(Object.keys(D.messages || {}))); D.messages = D.messages || {}; D.messages[id] = { from: '', subject: 'Nová zpráva', body: '' }; toast('Zpráva založena – text doplňte v záložce Zprávy a podklady.'); } (x.messages = x.messages || []).push(id); }
          if (k === 'add') (x.add = x.add || {})[v] = 0;
          touch(true);
        };
        else inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); (o().set = o().set || {})[inp.value.trim().replace(/\s+/g, '_')] = true; touch(true); } };
      });
      el.querySelectorAll('[data-eff-num]').forEach(inp => inp.onchange = () => { o().add[inp.dataset.effNum] = +inp.value || 0; touch(false); });
      el.querySelector('[data-eff-end]')?.addEventListener('change', e => { if (e.target.checked) o().end = true; else delete o().end; touch(false); });
    });
  }

  // ---------- jednoduchá pole (data-k = cesta, data-ty = num/bool/list) ----------
  const fld = (p, label, ty, extra = '') => {
    const v = get(p);
    if (ty === 'bool') return `<label class="se-f se-bool"><input type="checkbox" data-k="${H(p)}" data-ty="bool"${v ? ' checked' : ''} ${extra}> ${H(label)}</label>`;
    if (ty === 'area') return `<label class="se-f"><span>${H(label)}</span><textarea class="input" rows="${extra || 4}" data-k="${H(p)}">${H(v)}</textarea></label>`;
    return `<label class="se-f"><span>${H(label)}</span><input class="input" ${ty === 'num' ? 'type="number" step="any" data-ty="num"' : ''} data-k="${H(p)}" value="${H(v)}" ${extra}></label>`;
  };
  function bindFields(root) {
    root.querySelectorAll('[data-k]').forEach(inp => {
      const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' || inp.hasAttribute('data-re') ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        const ty = inp.dataset.ty; let v = ty === 'bool' ? inp.checked : ty === 'num' ? (inp.value === '' ? undefined : +inp.value) : inp.value;
        if (ty === 'bool' && !v) v = undefined;
        set(inp.dataset.k, v); touch(inp.hasAttribute('data-re'));
      });
    });
  }

  // ---------- záložky ----------
  function tabBase() {
    const t = D.time || (D.time = { mode: 'step' }), live = t.mode === 'live';
    const perDay = live && t.rate ? (24 / t.rate) : null;
    return `<div class="se-cols"><div>
      ${fld('title', 'Název scénáře')}
      <label class="se-f"><span>Oblast (balíček)</span><select class="select" data-k="module" data-re>${Object.entries(MODULES).map(([k, l]) => `<option value="${k}"${k === D.module ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${fld('summary', 'Krátký popis (na kartě v seznamu)', 'area', 2)}
      ${fld('role', 'Role studenta')}
      ${fld('intro', 'Úvod (zobrazí se před startem)', 'area', 6)}
      ${fld('minutes', 'Odhadovaná délka (minut)', 'num')}
    </div><div>
      <h3>Čas</h3>
      <label class="se-f"><span>Režim</span><select class="select" data-k="time.mode" data-re><option value="step"${!live ? ' selected' : ''}>Tahový – čas se posune jen krokem studenta</option><option value="live"${live ? ' selected' : ''}>Běžící hodiny</option></select></label>
      ${live ? `${fld('time.rate', 'Rychlost: simulovaných hodin za 1 minutu', 'num', 'min="0.1" data-re')}<p class="fine">${perDay ? `1 simulovaný den = ${Math.round(perDay * 10) / 10} min reálného času${D.max_day ? ` · celá simulace (${D.max_day} dní) ≈ ${Math.round(perDay * D.max_day)} min` : ''}` : ''}</p>
        ${fld('time.prep_minutes', 'Příprava – minut na seznámení s podklady (hodiny stojí)', 'num')}
        <label class="se-f se-bool"><input type="checkbox" data-k="time.pause_when_closed" data-ty="bool"${t.pause_when_closed !== false ? ' checked' : ''}> Při zavřeném okně se hodiny zastaví</label>` : ''}
      ${fld('max_day', 'Konec nejpozději v den (prázdné = bez limitu)', 'num', 'data-re')}
      ${fld('clock', 'Popis času (např. „Den {d} od přijetí hlášení“)')}
      <h3>Konec simulace podmínkou</h3><p class="fine">Volitelné – např. „rozpočet ≤ 0“ nebo „nastala událost X“.</p>
      ${condUI('end_when', 'Simulace skončí, když…', true)}${D.end_when ? fld('end_text', 'Text při ukončení') : ''}
    </div></div>`;
  }
  function tabInd() {
    const L = D.indicators || [];
    return `<p class="fine">Ukazatele jsou čísla, která se v průběhu mění (rozpočet, počet pacientů v ohrožení, body důvěry…). Mění je akce, volby a události; podmínky s nimi umí pracovat (≥, ≤, =).</p>
      <table class="se-tbl"><tr><th>Název proměnné</th><th>Popisek pro studenta</th><th>Jednotka</th><th>Počáteční hodnota</th><th>Student vidí</th><th></th></tr>
      ${L.map((x, i) => `<tr><td><input class="input" data-k="indicators.${i}.var" value="${H(x.var)}" placeholder="např. rozpocet"></td><td><input class="input" data-k="indicators.${i}.label" value="${H(x.label)}"></td><td><input class="input" data-k="indicators.${i}.unit" value="${H(x.unit)}"></td>
        <td><input class="input" type="number" step="any" data-ty="num" data-k="indicators.${i}.start" value="${H(x.start)}"></td><td><input type="checkbox" ${x.visible === false ? '' : 'checked'} data-vis="${i}"></td>
        <td><button class="btn tiny danger" data-del="indicators.${i}">×</button></td></tr>`).join('')}</table>
      <button class="btn" data-addind>+ Ukazatel</button>`;
  }
  function tabMsg() {
    const ms = Object.entries(D.messages || {}), prep = new Set(D.prep_messages || []), start = new Set(D.start_messages || []);
    const used = id => JSON.stringify([D.actions, D.events]).includes(`"${id}"`);
    return `<p class="fine"><b>Podklady</b> dostane student na začátku (při přípravě). <b>Úvodní</b> zprávy přijdou se startem simulace. Ostatní zprávy posílají akce a události.</p>
      ${ms.map(([id, m]) => `<details class="se-card" data-open-key="msg.${H(id)}"${openSet.has('msg.' + id) ? ' open' : ''}><summary><b>${H(m.subject || '(bez předmětu)')}</b> <span class="fine">${H(m.from || '')}</span>
          ${prep.has(id) ? '<span class="se-tag">podklad</span>' : ''}${start.has(id) ? '<span class="se-tag">úvodní</span>' : ''}${!prep.has(id) && !start.has(id) && !used(id) ? '<span class="se-tag warn">nepoužitá</span>' : ''}</summary>
        <div class="se-cols"><div>${fld(`messages.${id}.from`, 'Od koho')}${fld(`messages.${id}.subject`, 'Předmět')}</div>
        <div><label class="se-f se-bool"><input type="checkbox" data-msgflag="prep_messages" data-id="${H(id)}"${prep.has(id) ? ' checked' : ''}> Podklad (na začátku, při přípravě)</label>
          <label class="se-f se-bool"><input type="checkbox" data-msgflag="start_messages" data-id="${H(id)}"${start.has(id) ? ' checked' : ''}> Úvodní zpráva (se startem)</label>
          <button class="btn tiny danger" data-delmsg="${H(id)}">Smazat zprávu</button></div></div>
        ${fld(`messages.${id}.body`, 'Text (odstavce oddělte prázdným řádkem, odrážky začněte „- “)', 'area', 8)}</details>`).join('')}
      <button class="btn" data-addmsg>+ Zpráva</button>`;
  }
  function tabAct() {
    const L = D.actions || [], groups = [...new Set(L.map(a => a.group).filter(Boolean))];
    const pack = RQSimPacks[D.module] || RQSimPacks.obecne;
    return `<p class="fine">Akce jsou tlačítka, která student může použít. „Trvání“ je simulovaný čas (při běžících hodinách běží souběžně a výsledek přijde později).</p>
      <datalist id="seGroups">${groups.map(g => `<option value="${H(g)}">`).join('')}</datalist>
      ${L.map((a, i) => { const ty = a.choice ? 'choice' : a.form ? 'form' : 'simple';
        return `<details class="se-card" data-open-key="act.${H(a.id)}"${openSet.has('act.' + a.id) ? ' open' : ''}><summary><b>${H(a.label || '(bez názvu)')}</b> <span class="fine">${H(a.group || '')} · ${a.days ? a.days + ' d' : 'hned'}${ty === 'choice' ? ' · volba' : ty === 'form' ? ' · formulář' : ''}${a.end ? ' · ukončí' : ''}</span>
          <span class="se-move"><button class="btn tiny" data-mv="actions.${i}.-1">↑</button><button class="btn tiny" data-mv="actions.${i}.1">↓</button></span></summary>
        <div class="se-cols"><div>${fld(`actions.${i}.label`, 'Popisek tlačítka')}
          <label class="se-f"><span>Skupina</span><input class="input" list="seGroups" data-k="actions.${i}.group" value="${H(a.group)}"></label>
          ${fld(`actions.${i}.days`, 'Trvání (dní, lze 0.5)', 'num')}
          <label class="se-f"><span>Typ</span><select class="select" data-acttype="${i}"><option value="simple"${ty === 'simple' ? ' selected' : ''}>Jednoduchá akce</option><option value="choice"${ty === 'choice' ? ' selected' : ''}>Volba (jedna z možností)</option><option value="form"${ty === 'form' ? ' selected' : ''}>Formulář</option></select></label></div>
        <div>${fld(`actions.${i}.repeat`, 'Lze opakovat', 'bool')}${fld(`actions.${i}.confirm`, 'Potvrzovací otázka (volitelné)')}${fld(`actions.${i}.need`, 'Vysvětlení, když není dostupná')}
          <button class="btn tiny" data-dup="${i}">Duplikovat</button> <button class="btn tiny danger" data-del="actions.${i}">Smazat akci</button></div></div>
        ${condUI(`actions.${i}.when`, 'Dostupná jen když…', true)}
        ${ty === 'choice' ? choiceUI(i) : ty === 'form' ? formUI(i) : ''}
        ${effUI(`actions.${i}`, { title: 'Po dokončení akce', end: true })}</details>`; }).join('')}
      <div class="se-addbar"><button class="btn" data-addact>+ Akce</button> <select class="select tiny" data-tpl><option value="">+ ze šablony (${H(pack.label)})…</option>${[...pack.actions, ...(pack === RQSimPacks.obecne ? [] : RQSimPacks.obecne.actions)].map((t, k) => `<option value="${k}">${H(t.label)}</option>`).join('')}</select></div>`;
  }
  function choiceUI(i) {
    const c = D.actions[i].choice;
    return `<div class="se-sub"><h4>Volba</h4>${fld(`actions.${i}.choice.prompt`, 'Otázka')}
      <p class="fine">Odpověď se ukládá jako „${H(c.var || D.actions[i].id)}“ – použijete ji v podmínkách (Odpověď / volba).</p>
      ${(c.options || []).map((o, k) => `<div class="se-opt">${fld(`actions.${i}.choice.options.${k}.label`, `Možnost ${k + 1}`)}<button class="btn tiny danger" data-del="actions.${i}.choice.options.${k}">×</button>
        <details><summary class="fine">Důsledky této možnosti</summary>${effUI(`actions.${i}.choice.options.${k}`, { title: 'Když student zvolí tuto možnost', end: true })}</details></div>`).join('')}
      <button class="btn tiny" data-addopt="${i}">+ Možnost</button></div>`;
  }
  function formUI(i) {
    const f = D.actions[i].form;
    return `<div class="se-sub"><h4>Formulář</h4>${fld(`actions.${i}.form.title`, 'Nadpis formuláře')}${fld(`actions.${i}.form.intro`, 'Úvodní text', 'area', 2)}
      ${(f.fields || []).map((x, k) => `<div class="se-field"><div class="se-cols3">${fld(`actions.${i}.form.fields.${k}.label`, `Pole ${k + 1}`)}
        <label class="se-f"><span>Typ</span><select class="select" data-k="actions.${i}.form.fields.${k}.type" data-re>${[['select', 'Výběr jedné možnosti'], ['checks', 'Zaškrtávací (více možností)'], ['text', 'Volný text']].map(([v, l]) => `<option value="${v}"${(x.type || 'text') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div><button class="btn tiny danger" data-del="actions.${i}.form.fields.${k}">Smazat pole</button></div></div>
        ${x.type === 'select' || x.type === 'checks' ? `<div class="se-optlist">${(x.options || []).map((o, m) => `<span class="se-chip"><input class="input tiny" data-k="actions.${i}.form.fields.${k}.options.${m}.label" value="${H(o.label)}" style="width:260px"><button data-del2="actions.${i}.form.fields.${k}.options.${m}">×</button></span>`).join('')}<button class="btn tiny" data-addfopt="${i}.${k}">+ možnost</button></div>` : '<p class="fine">Volný text – v hodnocení lze testovat, zda obsahuje některé slovo.</p>'}</div>`).join('')}
      <button class="btn tiny" data-addfield="${i}">+ Pole</button></div>`;
  }
  const TRIG = { when: 'Jakmile platí podmínka', at: 'V daný den', window: 'Náhodně v časovém okně', after: 'Po jiném dění (řetězení)' };
  const trigOf = e => e.after ? 'after' : e.window_days ? 'window' : e.at_day != null ? 'at' : 'when';
  function tabEv() {
    const L = D.events || [];
    return `<p class="fine">Události přicházejí samy – podle času, podmínek nebo jako důsledek jiného dění. „Náhodně v okně“ dává každému studentovi jiný okamžik; „pravděpodobnost“ určuje, zda událost v průchodu vůbec nastane.</p>
      ${L.map((e, i) => { const tg = trigOf(e);
        return `<details class="se-card"${openSet.has('ev.' + e.id) ? ' open' : ''} data-open-key="ev.${H(e.id)}"><summary><b>${H(e.label || e.id)}</b> <span class="fine">${H(trigLabel(e))}${e.probability != null ? ` · ${Math.round(e.probability * 100)} %` : ''}</span>
          <span class="se-move"><button class="btn tiny" data-mv="events.${i}.-1">↑</button><button class="btn tiny" data-mv="events.${i}.1">↓</button></span></summary>
        <div class="se-cols"><div>${fld(`events.${i}.label`, 'Název (pro vás)')}
          <label class="se-f"><span>Spouštěč</span><select class="select" data-trig="${i}">${Object.entries(TRIG).map(([k, l]) => `<option value="${k}"${k === tg ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          ${tg === 'at' ? fld(`events.${i}.at_day`, 'Den', 'num') : ''}
          ${tg === 'window' ? `<div class="se-cols"><label class="se-f"><span>Od dne</span><input class="input" type="number" step="any" data-ty="num" data-k="events.${i}.window_days.0" value="${H(e.window_days[0])}"></label><label class="se-f"><span>Do dne</span><input class="input" type="number" step="any" data-ty="num" data-k="events.${i}.window_days.1" value="${H(e.window_days[1])}"></label></div>` : ''}
          ${tg === 'after' ? afterUI(i, e) : ''}
          <label class="se-f"><span>Pravděpodobnost, že v průchodu nastane (%) – prázdné = vždy</span><input class="input" type="number" min="0" max="100" data-prob="${i}" value="${e.probability == null ? '' : Math.round(e.probability * 100)}"></label></div>
        <div><button class="btn tiny" data-dupev="${i}">Duplikovat</button> <button class="btn tiny danger" data-del="events.${i}">Smazat událost</button></div></div>
        ${condUI(`events.${i}.when`, tg === 'when' ? 'Nastane, jakmile…' : 'Nastane jen když v tu chvíli platí…', tg !== 'when')}
        ${effUI(`events.${i}`, { title: 'Co se stane', end: true })}
        ${tg !== 'when' && e.when ? (e.else ? effUI(`events.${i}.else`, { title: 'Jinak (podmínka neplatí)', end: true }) + `<button class="btn tiny" data-del="events.${i}.else">Odebrat větev „jinak“</button>` : `<button class="btn tiny" data-addelse="${i}">+ Větev „jinak“</button>`) : ''}</details>`; }).join('')}
      <button class="btn" data-addev>+ Událost</button>`;
  }
  function afterUI(i, e) {
    const k = e.after, kind = k.action != null ? 'action' : k.event != null ? 'event' : 'flag', range = !!k.days_range;
    return `<div class="se-sub"><label class="se-f"><span>Po čem</span><select class="select" data-afterkind="${i}">${[['action', 'Po dokončení akce'], ['event', 'Po události'], ['flag', 'Po nastavení příznaku']].map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${kind === 'action' ? `<label class="se-f"><span>Akce</span><select class="select" data-k="events.${i}.after.action">${opt(acts(), k.action, '— akce —')}</select></label>`
        : kind === 'event' ? `<label class="se-f"><span>Událost</span><select class="select" data-k="events.${i}.after.event">${opt(evs().filter(x => x.id !== e.id), k.event, '— událost —')}</select></label>`
        : `<label class="se-f"><span>Příznak</span><input class="input" list="seFlags" data-k="events.${i}.after.flag" value="${H(k.flag)}"></label>`}
      <label class="se-f se-bool"><input type="checkbox" data-afterrange="${i}"${range ? ' checked' : ''}> Zpoždění náhodně v rozmezí</label>
      ${range ? `<div class="se-cols"><label class="se-f"><span>Za (od) dní</span><input class="input" type="number" step="any" data-ty="num" data-k="events.${i}.after.days_range.0" value="${H(k.days_range[0])}"></label><label class="se-f"><span>do dní</span><input class="input" type="number" step="any" data-ty="num" data-k="events.${i}.after.days_range.1" value="${H(k.days_range[1])}"></label></div>`
        : fld(`events.${i}.after.days`, 'Za kolik dní', 'num')}</div>`;
  }
  function trigLabel(e) {
    if (e.window_days) return `náhodně ${e.window_days[0]}.–${e.window_days[1]}. den`;
    if (e.at_day != null) return `${e.at_day}. den`;
    if (e.after) { const k = e.after, what = k.action ? acts().find(a => a.id === k.action)?.label : k.event ? evs().find(x => x.id === k.event)?.label : k.flag; return `${k.days_range ? k.days_range.join('–') : k.days || 0} d po: ${what || '?'}`; }
    return 'když platí podmínka';
  }
  function tabRule() {
    const L = D.rules || [], O = D.outcomes || [], sug = refSuggestions();
    return `<datalist id="seRefs">${sug.map(x => `<option value="${H(x)}">`).join('')}</datalist>
      <p class="fine">Pravidla se vyhodnotí na konci; výsledek = vážený podíl splněných. „Hodnotit jen když“ – pravidlo se použije jen v průchodech, kde dává smysl (např. jen pokud nastala druhá příhoda).</p>
      ${L.map((r, i) => `<details class="se-card"${openSet.has('rule.' + i) ? ' open' : ''} data-open-key="rule.${i}"><summary><b>${H(r.label || '(bez názvu)')}</b> <span class="fine">váha ${r.weight ?? 1}</span>
          <span class="se-move"><button class="btn tiny" data-mv="rules.${i}.-1">↑</button><button class="btn tiny" data-mv="rules.${i}.1">↓</button></span></summary>
        <div class="se-cols"><div>${fld(`rules.${i}.label`, 'Co se hodnotí (text pro studenta)')}${fld(`rules.${i}.weight`, 'Váha (výchozí 1)', 'num')}</div>
        <div><button class="btn tiny danger" data-del="rules.${i}">Smazat pravidlo</button></div></div>
        ${condUI(`rules.${i}.ok`, 'Splněno, když…', false)}
        ${condUI(`rules.${i}.only_if`, 'Hodnotit jen když…', true)}
        <div class="se-cols">${fld(`rules.${i}.good`, 'Vysvětlení, když splněno', 'area', 3)}${fld(`rules.${i}.bad`, 'Vysvětlení, když nesplněno', 'area', 3)}</div>
        <div class="se-line"><span>Odkazy na předpisy:</span>${(r.refs || []).map((x, k) => `<span class="se-chip">${H(x.replace('|', ' – '))}<button data-del2="rules.${i}.refs.${k}">×</button></span>`).join('')}
          <input class="input tiny" list="seRefs" data-addref="${i}" placeholder="např. MDR|Článek 87 (Enter)" style="width:240px"></div></details>`).join('')}
      <button class="btn" data-addrule>+ Pravidlo</button>
      <h3>Výsledné hodnocení</h3><table class="se-tbl"><tr><th>Od %</th><th>Označení</th><th>Text</th><th></th></tr>
      ${O.map((o, i) => `<tr><td><input class="input" type="number" data-ty="num" data-k="outcomes.${i}.min" value="${H(o.min)}" style="width:70px"></td><td><input class="input" data-k="outcomes.${i}.label" value="${H(o.label)}"></td><td><input class="input" data-k="outcomes.${i}.text" value="${H(o.text)}"></td><td><button class="btn tiny danger" data-del="outcomes.${i}">×</button></td></tr>`).join('')}</table>
      <button class="btn tiny" data-addout>+ Hranice</button>`;
  }
  function tabTime() {
    const L = D.events || [], max = D.max_day || Math.max(10, ...L.map(e => e.window_days ? e.window_days[1] : e.at_day || 0)) + 1;
    const x = d => Math.max(0, Math.min(100, d / max * 100));
    const deadlines = []; const walk = (o, lab) => { if (!o || typeof o !== 'object') return; if (o.done_by) deadlines.push({ d: o.done_by.day_lte, l: lab }); if (o.started_by) deadlines.push({ d: o.started_by.day_lte, l: lab }); Object.values(o).forEach(v => walk(v, lab)); };
    (D.rules || []).forEach(r => walk(r.ok, r.label));
    const ticks = []; for (let d = 0; d <= max; d += max > 30 ? 5 : max > 12 ? 2 : 1) ticks.push(d);
    const tm = D.time || {};
    return `<p class="fine">Přehled, kdy mohou nastat události (pruh = náhodné okno, tečka = pevný den) a lhůty z pravidel hodnocení. Události spouštěné podmínkou nebo po jiném dění jsou uvedeny pod osou.</p>
      ${tm.mode === 'live' && tm.prep_minutes ? `<p class="fine">Před dnem 0: příprava ${tm.prep_minutes} min (hodiny stojí).</p>` : ''}
      <div class="se-tl"><div class="se-tl-axis">${ticks.map(d => `<span style="left:${x(d)}%">${d}</span>`).join('')}</div>
      ${L.filter(e => e.at_day != null || e.window_days).map(e => `<div class="se-tl-row"><span class="se-tl-l">${H(e.label || e.id)}${e.probability != null ? ` (${Math.round(e.probability * 100)} %)` : ''}${e.when ? ' *' : ''}</span><div class="se-tl-track">${e.window_days ? `<i class="win" style="left:${x(e.window_days[0])}%;width:${Math.max(1, x(e.window_days[1]) - x(e.window_days[0]))}%"></i>` : `<i class="pt" style="left:${x(e.at_day)}%"></i>`}</div></div>`).join('')}
      ${deadlines.map(dl => `<div class="se-tl-row dl"><span class="se-tl-l">Lhůta: ${H(dl.l)}</span><div class="se-tl-track"><i class="pt dl" style="left:${x(dl.d)}%"></i></div></div>`).join('')}
      ${D.max_day ? `<div class="se-tl-row"><span class="se-tl-l">Konec simulace</span><div class="se-tl-track"><i class="pt end" style="left:${x(D.max_day)}%"></i></div></div>` : ''}</div>
      <p class="fine">* událost má podmínku v okamžiku spuštění – nemusí nastat.</p>
      <ul class="se-other">${L.filter(e => !(e.at_day != null || e.window_days)).map(e => `<li><b>${H(e.label || e.id)}</b> – ${H(trigLabel(e))}</li>`).join('')}</ul>`;
  }
  function tabJson() {
    return `<p class="fine">Pro pokročilé: celá definice scénáře. Lze sem vložit scénář zkopírovaný odjinud a kliknout „Použít“.</p>
      <textarea class="input mono" id="seRaw" rows="26" spellcheck="false">${H(JSON.stringify(D, null, 2))}</textarea>${rawErr ? `<p class="err">${H(rawErr)}</p>` : ''}
      <p><button class="btn" data-rawapply>Použít</button></p>`;
  }

  // ---------- vykreslení ----------
  const openSet = new Set();
  function render() {
    const el = box(); if (!el || !D) return;
    // zapamatuj si otevřené karty
    el.querySelectorAll('details[data-open-key]').forEach(d => { if (d.open) openSet.add(d.dataset.openKey); else openSet.delete(d.dataset.openKey); });
    const errs = RQSim.validate(D), warns = warnings();
    const sy = window.scrollY;
    el.innerHTML = `<div class="se">
      <div class="se-top"><div><div class="eyebrow">SIMULACE / EDITOR SCÉNÁŘE</div><h1>${H(D.title || 'Nový scénář')}</h1>
        <p class="fine">${sc ? (sc.status === 'ready' ? 'Připraveno – změny uvidí studenti v nových průchodech' : 'Koncept') : 'Nový scénář – zatím neuložený'}${dirty ? ' · <b class="se-dirty">neuložené změny</b>' : ''}</p></div>
        <div class="head-actions"><button class="btn" data-back>← Zpět na seznam</button>${sc ? `<a class="btn" href="${H(reader())}/#/simulace/${encodeURIComponent(sc.id)}" target="_blank" rel="noopener" data-try>Vyzkoušet ↗</a>` : ''}<button class="btn accent" data-save>Uložit</button></div></div>
      <div class="se-tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${k === 'act' ? ` (${(D.actions || []).length})` : k === 'ev' ? ` (${(D.events || []).length})` : k === 'rule' ? ` (${(D.rules || []).length})` : k === 'msg' ? ` (${Object.keys(D.messages || {}).length})` : ''}</button>`).join('')}</div>
      <div class="se-main"><div class="se-body">${({ base: tabBase, ind: tabInd, msg: tabMsg, act: tabAct, ev: tabEv, rule: tabRule, time: tabTime, json: tabJson })[tab]()}</div>
        <aside class="se-check"><h3>Kontrola</h3>${errs.length ? `<ul class="err">${errs.map(x => `<li>${H(x)}</li>`).join('')}</ul>` : '<p class="ok">✓ Bez chyb</p>'}
          ${warns.length ? `<h4>Upozornění</h4><ul class="warn">${warns.map(x => `<li>${H(x)}</li>`).join('')}</ul>` : ''}
          <p class="fine">Scénář s chybami lze uložit jako koncept, ale nelze ho označit jako připravený.</p></aside></div>
      <datalist id="seFlags">${flags().map(f => `<option value="${H(f)}">`).join('')}</datalist></div>`;
    bind(el); window.scrollTo(0, sy);
  }
  function warnings() {
    const w = [], s = JSON.stringify([D.actions, D.events, D.rules, D.end_when]);
    Object.keys(D.messages || {}).forEach(id => { if (!(D.prep_messages || []).includes(id) && !(D.start_messages || []).includes(id) && !s.includes(`"${id}"`)) w.push(`Zpráva „${D.messages[id].subject || id}“ se nikdy nepošle.`); });
    const fl = new Set(flags()); const used = []; const walk = o => { if (!o || typeof o !== 'object') return; if (typeof o.flag === 'string') used.push(o.flag); if (o.within?.from_flag) used.push(o.within.from_flag); if (o.after?.flag) used.push(o.after.flag); Object.values(o).forEach(walk); };
    walk([D.actions, D.events, D.rules, D.end_when]); [...new Set(used)].forEach(f => { if (f && !fl.has(f)) w.push(`Příznak „${f}“ se testuje, ale nic ho nenastavuje.`); });
    if (!(D.rules || []).length) w.push('Scénář nemá žádná pravidla hodnocení – rozbor bude prázdný.');
    if (!(D.actions || []).some(a => a.end) && !D.max_day && !D.end_when && !(D.events || []).some(e => e.end)) w.push('Simulace nemá konec (akce „ukončí“, konec v den ani podmínka).');
    if (!(D.start_messages || []).length && !(D.prep_messages || []).length) w.push('Student na začátku nedostane žádnou zprávu.');
    return w;
  }
  const reader = () => { const a = document.querySelector('[data-reader=""]'); return a ? a.href.replace(/\/$/, '') : ''; };
  let tt = null, rr = false;
  function touch(rerender) {
    dirty = true;
    if (rerender) { if (!rr) { rr = true; setTimeout(() => { rr = false; render(); }, 0); } return; }
    clearTimeout(tt); tt = setTimeout(() => { const c = box().querySelector('.se-check'); if (!c) return; const errs = RQSim.validate(D), warns = warnings();
      c.innerHTML = `<h3>Kontrola</h3>${errs.length ? `<ul class="err">${errs.map(x => `<li>${H(x)}</li>`).join('')}</ul>` : '<p class="ok">✓ Bez chyb</p>'}${warns.length ? `<h4>Upozornění</h4><ul class="warn">${warns.map(x => `<li>${H(x)}</li>`).join('')}</ul>` : ''}<p class="fine">Scénář s chybami lze uložit jako koncept, ale nelze ho označit jako připravený.</p>`;
      const d = box().querySelector('.se-top .fine'); if (d && !d.innerHTML.includes('se-dirty')) d.innerHTML += ' · <b class="se-dirty">neuložené změny</b>'; }, 250);
  }
  function bind(el) {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { if (tab === 'json' && !applyRaw()) return; tab = b.dataset.tab; render(); });
    el.querySelector('[data-back]').onclick = () => { if (dirty && !confirm('Máte neuložené změny. Opravdu odejít?')) return; D = null; onBack && onBack(); };
    el.querySelector('[data-save]').onclick = save;
    el.querySelector('[data-try]')?.addEventListener('click', e => { if (dirty) { e.preventDefault(); toast('Nejdřív uložte – vyzkoušet jde uložená verze.', true); } });
    bindFields(el); bindCond(el); bindEff(el);
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.preventDefault(); if (!confirm('Smazat?')) return; set(b.dataset.del, undefined); touch(true); });
    el.querySelectorAll('[data-del2]').forEach(b => b.onclick = e => { e.preventDefault(); set(b.dataset.del2, undefined); touch(true); });
    el.querySelectorAll('[data-mv]').forEach(b => b.onclick = e => { e.preventDefault(); const [arr, i, d] = b.dataset.mv.split('.'), L = D[arr], j = +i + +d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; touch(true); });
    // ukazatele
    el.querySelector('[data-addind]')?.addEventListener('click', () => { (D.indicators = D.indicators || []).push({ var: uid('ukazatel', new Set((D.indicators || []).map(i => i.var))), label: 'Nový ukazatel', unit: '', start: 0 }); touch(true); });
    el.querySelectorAll('[data-vis]').forEach(cb => cb.onchange = () => { const x = D.indicators[+cb.dataset.vis]; if (cb.checked) delete x.visible; else x.visible = false; touch(false); });
    // zprávy
    el.querySelector('[data-addmsg]')?.addEventListener('click', () => { D.messages = D.messages || {}; const id = uid('m', new Set(Object.keys(D.messages))); D.messages[id] = { from: '', subject: 'Nová zpráva', body: '' }; openSet.add('msg.' + id); touch(true); });
    el.querySelectorAll('[data-msgflag]').forEach(cb => cb.onchange = () => { const k = cb.dataset.msgflag, L = new Set(D[k] || []); cb.checked ? L.add(cb.dataset.id) : L.delete(cb.dataset.id); D[k] = [...L]; touch(true); });
    el.querySelectorAll('[data-delmsg]').forEach(b => b.onclick = () => { const id = b.dataset.delmsg; if (!confirm('Smazat zprávu? Odkazy na ni z akcí a událostí se odeberou.')) return; delete D.messages[id];
      const strip = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o.messages)) o.messages = o.messages.filter(m => m !== id); Object.values(o).forEach(strip); };
      strip(D.actions); strip(D.events); ['prep_messages', 'start_messages'].forEach(k => D[k] = (D[k] || []).filter(m => m !== id)); touch(true); });
    // akce
    el.querySelector('[data-addact]')?.addEventListener('click', () => addAction({ label: 'Nová akce', group: '', days: 0 }));
    el.querySelector('[data-tpl]')?.addEventListener('change', e => { const pack = RQSimPacks[D.module] || RQSimPacks.obecne, all = [...pack.actions, ...(pack === RQSimPacks.obecne ? [] : RQSimPacks.obecne.actions)], t = all[+e.target.value]; if (t) addAction(clone(t)); });
    el.querySelectorAll('[data-dup]').forEach(b => b.onclick = e => { e.preventDefault(); const a = clone(D.actions[+b.dataset.dup]); a.label += ' (kopie)'; addAction(a); });
    el.querySelectorAll('[data-acttype]').forEach(s => s.onchange = () => { const a = D.actions[+s.dataset.acttype];
      if (s.value !== 'choice') delete a.choice; if (s.value !== 'form') delete a.form;
      if (s.value === 'choice' && !a.choice) a.choice = { prompt: a.label, options: [{ id: 'o1', label: 'Možnost A' }, { id: 'o2', label: 'Možnost B' }] };
      if (s.value === 'form' && !a.form) a.form = { title: a.label, fields: [{ id: 'f1', label: 'Pole', type: 'text' }] };
      openSet.add('act.' + a.id); touch(true); });
    el.querySelectorAll('[data-addopt]').forEach(b => b.onclick = e => { e.preventDefault(); const c = D.actions[+b.dataset.addopt].choice; c.options.push({ id: uid('o', new Set(c.options.map(o => o.id))), label: 'Nová možnost' }); touch(true); });
    el.querySelectorAll('[data-addfield]').forEach(b => b.onclick = e => { e.preventDefault(); const f = D.actions[+b.dataset.addfield].form; f.fields = f.fields || []; f.fields.push({ id: uid('f', new Set(f.fields.map(x => x.id))), label: 'Nové pole', type: 'select', options: [{ id: 'o1', label: 'Možnost' }] }); touch(true); });
    el.querySelectorAll('[data-addfopt]').forEach(b => b.onclick = e => { e.preventDefault(); const [i, k] = b.dataset.addfopt.split('.'), fl = D.actions[+i].form.fields[+k]; fl.options = fl.options || []; fl.options.push({ id: uid('o', new Set(fl.options.map(o => o.id))), label: 'Možnost' }); touch(true); });
    // události
    el.querySelector('[data-addev]')?.addEventListener('click', () => { D.events = D.events || []; const id = uid('e', new Set(D.events.map(e => e.id))); D.events.push({ id, label: 'Nová událost', window_days: [1, 3] }); openSet.add('ev.' + id); touch(true); });
    el.querySelectorAll('[data-dupev]').forEach(b => b.onclick = e => { e.preventDefault(); const x = clone(D.events[+b.dataset.dupev]); x.id = uid('e', new Set(D.events.map(e => e.id))); x.label = (x.label || x.id) + ' (kopie)'; D.events.push(x); openSet.add('ev.' + x.id); touch(true); });
    el.querySelectorAll('[data-trig]').forEach(s => s.onchange = () => { const e = D.events[+s.dataset.trig]; delete e.at_day; delete e.window_days; delete e.after;
      if (s.value === 'at') e.at_day = 1; if (s.value === 'window') e.window_days = [1, 3]; if (s.value === 'after') e.after = { action: acts()[0]?.id || '', days: 1 };
      if (s.value === 'when' && !e.when) e.when = { all: [] }; touch(true); });
    el.querySelectorAll('[data-afterkind]').forEach(s => s.onchange = () => { const k = D.events[+s.dataset.afterkind].after; delete k.action; delete k.event; delete k.flag; k[s.value] = ''; touch(true); });
    el.querySelectorAll('[data-afterrange]').forEach(cb => cb.onchange = () => { const k = D.events[+cb.dataset.afterrange].after; if (cb.checked) { k.days_range = [k.days || 1, (k.days || 1) + 2]; delete k.days; } else { k.days = k.days_range?.[0] || 1; delete k.days_range; } touch(true); });
    el.querySelectorAll('[data-prob]').forEach(inp => inp.onchange = () => { const e = D.events[+inp.dataset.prob]; if (inp.value === '') delete e.probability; else e.probability = Math.max(0, Math.min(100, +inp.value)) / 100; touch(false); });
    el.querySelectorAll('[data-addelse]').forEach(b => b.onclick = e => { e.preventDefault(); D.events[+b.dataset.addelse].else = { messages: [] }; touch(true); });
    // hodnocení
    el.querySelector('[data-addrule]')?.addEventListener('click', () => { D.rules = D.rules || []; D.rules.push({ id: uid('r', new Set(D.rules.map(r => r.id))), label: 'Nové pravidlo', ok: { all: [] }, good: '', bad: '' }); openSet.add('rule.' + (D.rules.length - 1)); touch(true); });
    el.querySelector('[data-addout]')?.addEventListener('click', () => { (D.outcomes = D.outcomes || []).push({ min: 0, label: '', text: '' }); touch(true); });
    el.querySelectorAll('[data-addref]').forEach(inp => inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); const r = D.rules[+inp.dataset.addref]; (r.refs = r.refs || []).push(inp.value.trim()); touch(true); } });
    // JSON
    el.querySelector('[data-rawapply]')?.addEventListener('click', () => { if (applyRaw()) { toast('Použito.'); render(); } });
  }
  function addAction(a) { D.actions = D.actions || []; a.id = uid('a', new Set(D.actions.map(x => x.id))); const ci = D.actions.findIndex(x => x.end); if (ci >= 0 && !a.end) D.actions.splice(ci, 0, a); else D.actions.push(a); openSet.add('act.' + a.id); touch(true); }
  function applyRaw() {
    const ta = box().querySelector('#seRaw'); if (!ta) return true;
    const txt = ta.value; if (txt === JSON.stringify(D, null, 2)) { rawErr = ''; return true; }
    try { D = JSON.parse(txt); rawErr = ''; dirty = true; return true; } catch (e) { rawErr = 'Neplatný JSON: ' + e.message; render(); return false; }
  }
  async function save() {
    if (tab === 'json' && !applyRaw()) return;
    const errs = RQSim.validate(D);
    if (errs.length && !confirm(`Scénář má ${errs.length} chyb – uložit jako koncept i tak?`)) return;
    try {
      const id = await rpc('rq_sim_save_scenario', { p_id: sc ? sc.id : null, p_patch: { definition: D } });
      if (!sc) sc = { id, status: 'draft' };
      if (errs.length && sc.status === 'ready') { await rpc('rq_sim_save_scenario', { p_id: sc.id, p_patch: { status: 'draft' } }); sc.status = 'draft'; toast('Uloženo – kvůli chybám vráceno do konceptu.', true); }
      else toast('Scénář uložen.');
      dirty = false; render();
    } catch (e) { toast(e.message, true); }
  }
  const BLANK = module => ({ version: 2, module, title: 'Nový scénář', summary: '', role: '', intro: '', minutes: 45,
    time: { mode: 'live', rate: 8, prep_minutes: 5, pause_when_closed: true }, max_day: 15, clock: 'Den {d}', indicators: [],
    messages: { m1: { from: '', subject: 'Úvodní zpráva', body: '' } }, prep_messages: [], start_messages: ['m1'],
    actions: [{ id: 'a1', group: 'Čas', label: 'Uzavřít případ a zobrazit rozbor', days: 0, end: true, confirm: 'Opravdu uzavřít? Další kroky už nepůjdou udělat.' }],
    events: [], rules: [], outcomes: [{ min: 90, label: 'Výborně zvládnuto', text: '' }, { min: 65, label: 'Zvládnuto s výhradami', text: '' }, { min: 0, label: 'Nezvládnuto', text: '' }] });
  function open(scenario, back, opts = {}) {
    sc = scenario ? { id: scenario.id, status: scenario.status } : null;
    D = scenario ? clone(scenario.definition) : opts.definition ? clone(opts.definition) : BLANK(opts.module || 'vigilance');
    if (!scenario && opts.definition) D.title = (D.title || 'Scénář') + (opts.copy ? ' (kopie)' : '');
    tab = 'base'; dirty = !scenario; onBack = back; openSet.clear(); rawErr = '';
    render(); window.scrollTo(0, 0);
  }
  return { open, isOpen: () => !!D, redraw: render };
})();
