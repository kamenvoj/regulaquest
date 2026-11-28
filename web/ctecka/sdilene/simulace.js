/* RegulaQuest – společné jádro simulací (Studio i studentská část), verze 2.
   Scénář (JSON) popisuje podklady, zprávy, akce studenta, události a pravidla hodnocení. Jádro je čistě výpočetní.

   Čas: simulované hodiny (st.t). Ve scénáři se zadává ve dnech (desetinná čísla jdou: 0.5 = 12 h).
   Režimy (def.time.mode):
     • „step“ – tahový: čas se posune jen akcí (domácí procvičování),
     • „live“ – běžící hodiny: def.time.rate = simulovaných hodin za 1 minutu reálného času; akce s délkou běží souběžně
       a výsledek přijde později. Volitelně příprava (def.time.prep_minutes) – hodiny stojí, student čte podklady.
   Události (def.events): spouštěč
     • when            – jakmile platí podmínka,
     • at_day          – v daný den,
     • window_days     – [od, do]: každý průchod dostane náhodný okamžik v rozmezí,
     • after           – {action|event|flag, days | days_range} – po jiném dění (řetězení),
     • probability     – 0–1: zda událost v daném průchodu vůbec nastane (losuje se jednou),
     • u at_day/window/after lze přidat when (podmínku v okamžiku spuštění) a else (co se stane, když neplatí).
   Náhoda je odvozená ze seedu průchodu – po obnovení stránky se nemění.
   Stav: { v:2, t, phase, prep_ms, seed, sched{}, pending[], vars, done{}, fired{}, inbox[], log[], ended } */
(function (root) {
  'use strict';
  const clone = o => JSON.parse(JSON.stringify(o));
  const H = 24;
  const days = st => st.t / H;

  // ---------- náhoda se seedem (mulberry32) ----------
  function rnd(st, key) {
    let h = (st.seed >>> 0) ^ 0x9e3779b9;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 2654435761);
    h += 0x6D2B79F5; let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- podmínky (dny) ----------
  function test(c, st) {
    if (!c) return true;
    if (Array.isArray(c)) return c.every(x => test(x, st));
    if (c.all) return c.all.every(x => test(x, st));
    if (c.any) return c.any.some(x => test(x, st));
    if (c.not) return !test(c.not, st);
    if (c.flag) return !!st.vars[c.flag];
    if (c.done) return st.done[c.done] != null;
    if (c.started) return st.done[c.started] != null || st.pending.some(p => p.id === c.started);
    if (c.event) return st.fired[c.event] != null;
    if (c.day_gte != null) return days(st) >= c.day_gte;
    if (c.day_lte != null) return days(st) <= c.day_lte;
    if (c.done_by) { const d = st.done[c.done_by.action]; return d != null && d / H <= c.done_by.day_lte + 1e-9; }
    if (c.started_by) { const d = st.started[c.started_by.action]; return d != null && d / H <= c.started_by.day_lte + 1e-9; }
    if (c.done_before) { const [a, b] = c.done_before, da = st.done[a], db = st.done[b] ?? st.started[b]; return da != null && (db == null || da <= db); }
    if (c.within) { const f = st.vars['t:' + c.within.from_flag], d = st.done[c.within.action]; return f != null && d != null && (d - f) / H <= c.within.days + 1e-9; }
    if (c.var) {
      const v = st.vars[c.var];
      if ('eq' in c) return v === c.eq;
      if (c.in) return c.in.includes(v);
      if (c.has) return Array.isArray(v) && v.includes(c.has);
      if (c.has_all) return Array.isArray(v) && c.has_all.every(x => v.includes(x));
      if (c.has_any) return Array.isArray(v) && c.has_any.some(x => v.includes(x));
      if (c.contains_any) { const t = String(v || '').toLowerCase(); return c.contains_any.some(w => w && t.includes(String(w).toLowerCase())); }
      if ('gte' in c) return Number(v) >= c.gte;
      if ('lte' in c) return Number(v) <= c.lte;
      return v != null && v !== false && v !== '';
    }
    return true;
  }

  // ---------- kontrola definice ----------
  function validate(def) {
    const err = [];
    if (!def || typeof def !== 'object') return ['Scénář není objekt JSON.'];
    if (!def.title) err.push('Chybí název (title).');
    const msgs = def.messages || {}, acts = def.actions || [], ids = new Set(), evIds = new Set((def.events || []).map(e => e.id));
    if (!acts.length) err.push('Scénář nemá žádné akce (actions).');
    const tm = def.time || {};
    if (tm.mode && !['step', 'live'].includes(tm.mode)) err.push('time.mode musí být „step“ nebo „live“.');
    if (tm.mode === 'live' && !(tm.rate > 0)) err.push('Běžící čas potřebuje rychlost time.rate (simulovaných hodin za minutu) > 0.');
    const msgRef = (where, list) => (list || []).forEach(m => { if (!msgs[m]) err.push(`${where}: neznámá zpráva „${m}“.`); });
    msgRef('prep_messages', def.prep_messages); msgRef('start_messages', def.start_messages);
    acts.forEach((a, i) => {
      const w = `Akce ${a.id || '#' + (i + 1)}`;
      if (!a.id) err.push(`Akce #${i + 1} nemá id.`); else if (ids.has(a.id)) err.push(`${w}: id se opakuje.`); else ids.add(a.id);
      if (!a.label) err.push(`${w}: chybí popisek (label).`);
      msgRef(w, a.messages);
      if (a.choice && !(a.choice.options || []).length) err.push(`${w}: volba nemá možnosti.`);
      (a.form?.fields || []).forEach(f => { if (!f.id) err.push(`${w}: pole formuláře bez id.`); });
    });
    (def.events || []).forEach((e, i) => {
      const w = `Událost ${e.id || '#' + (i + 1)}`;
      if (!e.id) err.push(`Událost #${i + 1} nemá id.`);
      if (!e.when && e.at_day == null && !e.window_days && !e.after) err.push(`${w}: chybí spouštěč (when, at_day, window_days nebo after).`);
      if (e.window_days && !(e.window_days.length === 2 && e.window_days[0] <= e.window_days[1])) err.push(`${w}: window_days musí být [od, do].`);
      if (e.after && !(e.after.action || e.after.event || e.after.flag)) err.push(`${w}: after potřebuje action, event nebo flag.`);
      if (e.after?.action && !ids.has(e.after.action)) err.push(`${w}: after odkazuje na neznámou akci „${e.after.action}“.`);
      if (e.after?.event && !evIds.has(e.after.event)) err.push(`${w}: after odkazuje na neznámou událost „${e.after.event}“.`);
      if (e.probability != null && !(e.probability >= 0 && e.probability <= 1)) err.push(`${w}: probability musí být 0–1.`);
      msgRef(w, e.messages); msgRef(w + ' (else)', e.else?.messages);
    });
    (def.rules || []).forEach((r, i) => { if (!r.label || !r.ok) err.push(`Pravidlo ${r.id || '#' + (i + 1)}: chybí popisek nebo podmínka.`); });
    (def.indicators || []).forEach((x, i) => { if (!x.var) err.push(`Ukazatel #${i + 1}: chybí název proměnné.`); });
    const ref = c => { if (!c || typeof c !== 'object') return; for (const [k, v] of Object.entries(c)) {
      if ((k === 'done' || k === 'started') && typeof v === 'string' && !ids.has(v)) err.push(`Podmínka odkazuje na neznámou akci „${v}“.`);
      if (k === 'event' && typeof v === 'string' && !evIds.has(v)) err.push(`Podmínka odkazuje na neznámou událost „${v}“.`);
      if (typeof v === 'object') ref(v); } };
    acts.forEach(a => ref(a.when)); (def.events || []).forEach(e => ref(e.when)); (def.rules || []).forEach(r => { ref(r.ok); ref(r.only_if); });
    return err;
  }

  // ---------- pomocné ----------
  function deliver(def, st, ids) { (ids || []).forEach(id => { const m = def.messages?.[id]; if (m) { st.inbox.push({ id, t: st.t, read: false }); st.log.push({ t: st.t, kind: 'msg', text: (m.from ? m.from + ': ' : '') + m.subject }); } }); }
  function setVars(st, set) { Object.entries(set || {}).forEach(([k, v]) => { if (v && !st.vars[k]) st.vars['t:' + k] = st.t; st.vars[k] = v; }); }
  // změna číselných ukazatelů: {rozpocet: -50000, pacienti: 3}
  function addVars(st, add) { Object.entries(add || {}).forEach(([k, v]) => { st.vars[k] = Math.round(((Number(st.vars[k]) || 0) + Number(v || 0)) * 1000) / 1000; }); }
  function effects(def, st, b) { setVars(st, b.set); addVars(st, b.add); deliver(def, st, b.messages); }
  const live = def => (def.time?.mode || 'step') === 'live';
  // naplánuje události s pevným časem / oknem (při startu) a „after“ (jakmile nastane kotva)
  function schedule(def, st) {
    for (const e of def.events || []) {
      if (st.sched[e.id] != null || st.fired[e.id] != null) continue;
      if (e.probability != null && rnd(st, 'p:' + e.id) >= e.probability) { st.sched[e.id] = -1; continue; }   // v tomto průchodu nenastane
      let at = null;
      if (e.at_day != null) at = e.at_day * H;
      else if (e.window_days) { const [a, b] = e.window_days; at = (a + (b - a) * rnd(st, 'w:' + e.id)) * H; }
      else if (e.after) {
        const k = e.after, anchor = k.action ? st.done[k.action] : k.event ? st.fired[k.event] : st.vars['t:' + k.flag];
        if (anchor == null) continue;
        const d = k.days_range ? k.days_range[0] + (k.days_range[1] - k.days_range[0]) * rnd(st, 'a:' + e.id) : (k.days || 0);
        at = anchor + d * H;
      }
      if (at != null) st.sched[e.id] = Math.round(at * 100) / 100;
    }
  }
  function fire(def, st, e, branch) {
    st.fired[e.id] = st.t;
    const b = branch || e;
    effects(def, st, b);
    if (b.end) { st.ended = true; st.phase = 'end'; st.log.push({ t: st.t, kind: 'end', text: 'Čas simulace vypršel.' }); }
  }
  // vyhodnotí vše, co má v čase st.t nastat (dokončené akce, události), dokud se něco děje
  function settle(def, st) {
    let again = true, guard = 0;
    while (again && !st.ended && guard++ < 200) {
      again = false;
      for (const p of st.pending.filter(p => p.due <= st.t + 1e-9)) { st.pending = st.pending.filter(x => x !== p); complete(def, st, p); again = true; if (st.ended) return; }
      schedule(def, st);
      if (def.end_when && st.phase === 'run' && test(def.end_when, st)) { st.ended = true; st.phase = 'end'; st.log.push({ t: st.t, kind: 'end', text: def.end_text || 'Simulace skončila.' }); return; }
      for (const e of def.events || []) {
        if (st.fired[e.id] != null) continue;
        const s = st.sched[e.id];
        if (s === -1) continue;
        if (s != null) {
          if (s > st.t + 1e-9) continue;
          if (test(e.when, st)) fire(def, st, e); else if (e.else) fire(def, st, e, e.else); else st.fired[e.id] = st.t;   // podmínka v okamžiku neplatí → nic
          again = true;
        } else if (e.when && e.at_day == null && !e.window_days && !e.after && test(e.when, st)) { fire(def, st, e); again = true; }
        if (st.ended) return;
      }
    }
  }
  function complete(def, st, p) {
    const a = (def.actions || []).find(x => x.id === p.id); if (!a) return;
    if (a.choice) { const o = a.choice.options.find(x => x.id === p.payload?.choice); if (o) effects(def, st, o); }
    if (!a.repeat || st.done[a.id] == null) st.done[a.id] = st.t;
    st.log.push({ t: st.t, kind: 'act', text: (p.async ? 'Dokončeno: ' : '') + p.text });
    effects(def, st, a);
    if (a.end || (a.choice && a.choice.options.find(x => x.id === p.payload?.choice)?.end)) { st.ended = true; st.phase = 'end'; st.log.push({ t: st.t, kind: 'end', text: 'Případ uzavřen.' }); }
  }

  // ---------- průběh ----------
  function start(def, seed) {
    const st = { v: 2, t: 0, phase: 'run', prep_ms: 0, seed: (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0, sched: {}, pending: [], started: {},
      vars: {}, done: {}, fired: {}, inbox: [], log: [], ended: false };
    (def.indicators || []).forEach(i => { if (i.var) st.vars[i.var] = Number(i.start) || 0; });
    deliver(def, st, def.prep_messages);
    if (live(def) && def.time?.prep_minutes > 0) { st.phase = 'prep'; st.prep_ms = def.time.prep_minutes * 60000; return st; }
    return begin(def, st);
  }
  // konec přípravy → začíná krize
  function begin(def, st0) {
    const st = st0.phase === 'prep' ? clone(st0) : st0;
    st.phase = 'run'; st.prep_ms = 0;
    deliver(def, st, def.start_messages); settle(def, st);
    return st;
  }
  // posune simulovaný čas o dt hodin (běžící hodiny, ladění)
  function advance(def, st0, dt) {
    const st = clone(st0); if (st.ended || st.phase !== 'run') return st;
    const end = st.t + dt;
    const max = def.max_day != null ? def.max_day * H : Infinity;
    while (st.t < end - 1e-9 && !st.ended) {
      const next = Math.min(end, Math.floor(st.t + 1e-9) + 1, max);     // po hodinách
      st.t = next; settle(def, st);
      if (st.t >= max && !st.ended) { st.ended = true; st.phase = 'end'; st.log.push({ t: st.t, kind: 'end', text: 'Čas simulace vypršel.' }); }
    }
    return st;
  }
  function actions(def, st) {
    return (def.actions || []).filter(a => a.repeat || (st.done[a.id] == null && !st.pending.some(p => p.id === a.id)))
      .filter(a => !(live(def) && a.id === (def.time?.wait_action || 'a_wait')))
      .map(a => ({ a, ok: !st.ended && st.phase === 'run' && test(a.when, st), need: st.phase === 'prep' ? 'Nejdřív se seznamte s podklady.' : (a.need || '') }));
  }
  // Provede akci; payload = {choice:id} nebo {form:{pole:hodnota}}. V běžícím čase akce s délkou běží souběžně.
  function act(def, st0, id, payload) {
    const a = (def.actions || []).find(x => x.id === id); if (!a) throw new Error('Neznámá akce ' + id);
    let st = clone(st0); if (st.ended) return st;
    if (st.phase !== 'run') throw new Error('Simulace ještě nezačala.');
    if (!test(a.when, st) || (!a.repeat && (st.done[a.id] != null || st.pending.some(p => p.id === a.id)))) throw new Error('Akce teď není dostupná.');
    let text = a.label;
    if (a.choice) {
      const o = (a.choice.options || []).find(x => x.id === payload?.choice); if (!o) throw new Error('Vyberte jednu z možností.');
      text += ': ' + o.label; st.vars[a.choice.var || a.id] = o.id;
    }
    if (a.form) (a.form.fields || []).forEach(f => { st.vars[`form.${a.id}.${f.id}`] = payload?.form?.[f.id] ?? (f.type === 'checks' ? [] : ''); });
    st.started[a.id] = st.started[a.id] ?? st.t;
    const dur = (a.days || 0) * H;
    if (live(def) && dur > 0) {
      st.pending.push({ id: a.id, due: st.t + dur, payload: payload || null, text, async: true });
      st.log.push({ t: st.t, kind: 'start', text: 'Zahájeno: ' + text });
      settle(def, st); return st;
    }
    if (dur > 0) st = advance(def, st, dur);
    if (st.ended) return st;
    complete(def, st, { id: a.id, payload, text });
    settle(def, st);
    return st;
  }
  function evaluate(def, st) {
    const items = (def.rules || []).filter(r => test(r.only_if, st)).map(r => ({ rule: r, ok: test(r.ok, st) }));
    const w = x => x.rule.weight == null ? 1 : Number(x.rule.weight) || 0, tot = items.reduce((a, x) => a + w(x), 0);
    const pct = tot ? Math.round(items.filter(x => x.ok).reduce((a, x) => a + w(x), 0) / tot * 100) : 0;
    const out = (def.outcomes || []).slice().sort((a, b) => b.min - a.min).find(o => pct >= o.min) || null;
    return { items, pct, outcome: out };
  }
  // „Den 3, 14:00“ – podle def.clock („Den {d}“), s hodinou u běžícího času
  function clock(def, t) {
    const d = Math.floor(t / H + 1e-9), h = Math.floor(t - d * H + 1e-9), m = Math.round((t - d * H - h) * 60);
    const base = (def.clock || 'Den {d}').replace('{d}', d);
    return live(def) ? `${base}, ${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}` : base;
  }
  // převod stavu z verze 1 (dny) na verzi 2 (hodiny)
  function upgrade(st) {
    if (!st || st.v === 2) return st;
    const x = v => v == null ? v : v * H, o = clone(st);
    o.v = 2; o.t = x(st.day || 0); delete o.day; o.phase = st.ended ? 'end' : 'run'; o.prep_ms = 0; o.seed = o.seed || 1; o.sched = {}; o.pending = []; o.started = {};
    Object.keys(o.done).forEach(k => { o.done[k] = x(o.done[k]); o.started[k] = o.done[k]; });
    Object.keys(o.fired).forEach(k => { o.fired[k] = st.day != null ? x(st.day) : 0; });
    Object.keys(o.vars).filter(k => k.startsWith('day:')).forEach(k => { o.vars['t:' + k.slice(4)] = x(o.vars[k]); delete o.vars[k]; });
    o.inbox = o.inbox.map(m => ({ ...m, t: x(m.day) })); o.log = o.log.map(l => ({ ...l, t: x(l.day) }));
    return o;
  }
  root.RQSim = { test, validate, start, begin, advance, actions, act, evaluate, clock, upgrade, live: def => live(def), H };
})(typeof window !== 'undefined' ? window : globalThis);
