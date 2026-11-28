/* RegulaQuest – společné jádro simulací (Studio i studentská část).
   Scénář (JSON) popisuje zprávy, akce studenta, události a pravidla hodnocení. Jádro je čistě výpočetní:
   z definice a stavu spočítá dostupné akce, provede akci (posune simulovaný čas, spustí události) a na konci vyhodnotí.
   Stav: { day, vars, done{akce:den}, fired{událost:true}, inbox[{id, day, read}], log[{day, kind, text}], ended } */
(function (root) {
  'use strict';
  const clone = o => JSON.parse(JSON.stringify(o));
  const flagDay = (st, f) => st.vars['day:' + f];

  // ---------- podmínky ----------
  function test(c, st) {
    if (!c) return true;
    if (Array.isArray(c)) return c.every(x => test(x, st));
    if (c.all) return c.all.every(x => test(x, st));
    if (c.any) return c.any.some(x => test(x, st));
    if (c.not) return !test(c.not, st);
    if (c.flag) return !!st.vars[c.flag];
    if (c.done) return st.done[c.done] != null;
    if (c.day_gte != null) return st.day >= c.day_gte;
    if (c.day_lte != null) return st.day <= c.day_lte;
    if (c.done_by) { const d = st.done[c.done_by.action]; return d != null && d <= c.done_by.day_lte; }
    if (c.done_before) { const [a, b] = c.done_before, da = st.done[a], db = st.done[b]; return da != null && (db == null || da <= db); }
    if (c.within) { const f = flagDay(st, c.within.from_flag), d = st.done[c.within.action]; return f != null && d != null && d - f <= c.within.days; }
    if (c.var) {
      const v = st.vars[c.var];
      if ('eq' in c) return v === c.eq;
      if (c.in) return c.in.includes(v);
      if (c.has) return Array.isArray(v) && v.includes(c.has);
      if (c.has_all) return Array.isArray(v) && c.has_all.every(x => v.includes(x));
      if (c.has_any) return Array.isArray(v) && c.has_any.some(x => v.includes(x));
      return v != null && v !== false && v !== '';
    }
    return true;
  }

  // ---------- kontrola definice (Studio) ----------
  function validate(def) {
    const err = [];
    if (!def || typeof def !== 'object') return ['Scénář není objekt JSON.'];
    if (!def.title) err.push('Chybí název (title).');
    const msgs = def.messages || {}, acts = def.actions || [], ids = new Set();
    if (!acts.length) err.push('Scénář nemá žádné akce (actions).');
    const msgRef = (where, list) => (list || []).forEach(m => { if (!msgs[m]) err.push(`${where}: neznámá zpráva „${m}“.`); });
    msgRef('start_messages', def.start_messages);
    acts.forEach((a, i) => {
      const w = `Akce ${a.id || '#' + (i + 1)}`;
      if (!a.id) err.push(`Akce #${i + 1} nemá id.`); else if (ids.has(a.id)) err.push(`${w}: id se opakuje.`); else ids.add(a.id);
      if (!a.label) err.push(`${w}: chybí popisek (label).`);
      msgRef(w, a.messages);
      if (a.choice && !(a.choice.options || []).length) err.push(`${w}: volba nemá možnosti.`);
      (a.form?.fields || []).forEach(f => { if (!f.id) err.push(`${w}: pole formuláře bez id.`); });
    });
    (def.events || []).forEach((e, i) => { if (!e.when) err.push(`Událost ${e.id || '#' + (i + 1)}: chybí podmínka (when).`); msgRef(`Událost ${e.id || '#' + (i + 1)}`, e.messages); });
    (def.rules || []).forEach((r, i) => { if (!r.label || !r.ok) err.push(`Pravidlo ${r.id || '#' + (i + 1)}: chybí popisek nebo podmínka.`); });
    const actRef = c => { if (!c || typeof c !== 'object') return; for (const [k, v] of Object.entries(c)) {
      if (k === 'done' && typeof v === 'string' && !ids.has(v)) err.push(`Podmínka odkazuje na neznámou akci „${v}“.`);
      if (typeof v === 'object') actRef(v); } };
    acts.forEach(a => actRef(a.when)); (def.events || []).forEach(e => actRef(e.when)); (def.rules || []).forEach(r => { actRef(r.ok); actRef(r.only_if); });
    return err;
  }

  // ---------- průběh ----------
  function deliver(def, st, ids) { (ids || []).forEach(id => { if (def.messages?.[id]) { st.inbox.push({ id, day: st.day, read: false }); st.log.push({ day: st.day, kind: 'msg', text: (def.messages[id].from ? def.messages[id].from + ': ' : '') + def.messages[id].subject }); } }); }
  function setVars(st, set) { Object.entries(set || {}).forEach(([k, v]) => { if (v && !st.vars[k]) st.vars['day:' + k] = st.day; st.vars[k] = v; }); }
  function events(def, st) {
    let again = true;
    while (again && !st.ended) {
      again = false;
      for (const e of def.events || []) {
        if (st.fired[e.id] || !test(e.when, st)) continue;
        st.fired[e.id] = true; again = true;
        setVars(st, e.set); deliver(def, st, e.messages);
        if (e.end) { st.ended = true; st.log.push({ day: st.day, kind: 'end', text: 'Čas simulace vypršel.' }); break; }
      }
    }
  }
  function start(def) {
    const st = { day: 0, vars: {}, done: {}, fired: {}, inbox: [], log: [], ended: false };
    deliver(def, st, def.start_messages); events(def, st);
    return st;
  }
  // Dostupné akce: [{a, ok, need}] – nedostupné (podmínka) se ukazují s vysvětlením, provedené jednorázové se skryjí
  function actions(def, st) {
    return (def.actions || []).filter(a => a.repeat || st.done[a.id] == null).map(a => ({ a, ok: !st.ended && test(a.when, st), need: a.need || '' }));
  }
  // Provede akci; payload = {choice:id} nebo {form:{pole:hodnota}}
  function act(def, st0, id, payload) {
    const a = (def.actions || []).find(x => x.id === id); if (!a) throw new Error('Neznámá akce ' + id);
    const st = clone(st0); if (st.ended) return st;
    if (!test(a.when, st) || (!a.repeat && st.done[a.id] != null)) throw new Error('Akce teď není dostupná.');
    let text = a.label;
    if (a.choice) {
      const o = (a.choice.options || []).find(x => x.id === payload?.choice); if (!o) throw new Error('Vyberte jednu z možností.');
      text += ': ' + o.label;
    }
    for (let i = 0; i < (a.days || 0) && !st.ended; i++) { st.day++; events(def, st); }
    if (st.ended) return st;
    if (a.choice) { const o = a.choice.options.find(x => x.id === payload.choice); st.vars[a.choice.var || a.id] = o.id; setVars(st, o.set); deliver(def, st, o.messages); }
    if (a.form) (a.form.fields || []).forEach(f => { st.vars[`form.${a.id}.${f.id}`] = payload?.form?.[f.id] ?? (f.type === 'checks' ? [] : ''); });
    if (!a.repeat || st.done[a.id] == null) st.done[a.id] = st.day;
    st.log.push({ day: st.day, kind: 'act', text });
    setVars(st, a.set); deliver(def, st, a.messages);
    if (a.end) { st.ended = true; st.log.push({ day: st.day, kind: 'end', text: 'Případ uzavřen.' }); }
    events(def, st);
    return st;
  }
  // Hodnocení: [{rule, ok}] jen pro použitelná pravidla, skóre v %
  function evaluate(def, st) {
    const items = (def.rules || []).filter(r => test(r.only_if, st)).map(r => ({ rule: r, ok: test(r.ok, st) }));
    const pct = items.length ? Math.round(items.filter(x => x.ok).length / items.length * 100) : 0;
    const out = (def.outcomes || []).slice().sort((a, b) => b.min - a.min).find(o => pct >= o.min) || null;
    return { items, pct, outcome: out };
  }
  root.RQSim = { test, validate, start, actions, act, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
