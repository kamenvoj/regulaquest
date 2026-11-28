/* RegulaQuest – Simulace ve studentské části: seznam, průchod scénářem, rozbor.
   Jádro výpočtu je společné se Studiem (sdilene/simulace.js). Průchod se ukládá k účtu, aby šel přerušit a dokončit;
   průchod si nese kopii scénáře, ve které začal. Běžící hodiny tikají v prohlížeči a stav se průběžně ukládá. */
const SM = { list: [], sid: null, def: null, title: '', status: '', run: null, st: null, open: null, save: Promise.resolve(), busy: false,
  timer: null, last: 0, savedAt: 0, speed: 1, debug: false };
const SIM_MODULES = { vigilance: 'Vigilance – nežádoucí příhody' };
const simAdmin = () => !!(RQ && RQ.me && RQ.me.isAdmin);

async function loadSims(){
  try { const { data, error } = await RQ.client.rpc('rq_sim_list'); if (!error && Array.isArray(data)) SM.list = data; } catch {}
  const sp = $('#spaces'); if (sp) sp.hidden = !SM.list.length;
}
function simSpace(){ return (S.view || '').startsWith('sim'); }
function spacesMark(){
  document.querySelectorAll('#spaces a').forEach(a => a.classList.toggle('on', (a.dataset.space === 'sim') === simSpace()));
  document.body.classList.toggle('space-sim', simSpace());
  if (S.view !== 'sim') simStop();
}

// Odkaz na ustanovení „MDR|Článek 87“ → přímo do Legislativy (pokud je dokument publikovaný), jinak jen text
function simRef(ref){
  const [fam, label] = ref.split('|'), up = fam.toUpperCase();
  const docs = [...S.docs.values()].filter(d => (d.family || '').toUpperCase() === up).sort((a, b) => (a.language === 'cs' ? -1 : 0) - (b.language === 'cs' ? -1 : 0));
  if (!label){ const d = docs[0]; return d ? `<a href="#/d/${encodeURIComponent(d.id)}">${esc(fam)}</a>` : esc(fam); }
  for (const d of docs){
    const u = [...S.units.values()].find(x => x.document_id === d.id && x.label === label);
    if (u) return `<a href="#/u/${encodeURIComponent(u.id)}">${esc(fam)} – ${esc(label)}</a>`;
  }
  return `${esc(fam)} – ${esc(label)}`;
}
const simText = t => esc(t || '').split(/\n{2,}/).map(p => /^- /m.test(p) ? `<ul>${p.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^- /, '')}</li>`).join('')}</ul>` : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const simClock = t => RQSim.clock(SM.def, t);
const simDur = h => { const d = Math.floor(h / 24 + 1e-9), r = Math.round(h - d * 24); return [d ? `${d} d` : '', r ? `${r} h` : ''].filter(Boolean).join(' ') || 'méně než hodina'; };
const simMmSs = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function renderSim(){
  spacesMark();
  if (S.view === 'simlist') return renderSimList();
  if (S.view === 'simdone') return renderSimResult();
  return renderSimPlay();
}

/* ---------- seznam ---------- */
function renderSimList(){
  document.title = 'Simulace · RegulaQuest';
  const box = $('#panelText');
  box.innerHTML = `<div class="sim-page"><div class="eyebrow">Simulace</div><h1>Simulace</h1>
    <p class="lead">Vyzkoušejte si regulatorní práci v praxi. Rozhodujete sami, čas běží a každé rozhodnutí má důsledky. Na konci dostanete rozbor s odkazy na předpisy. Simulace můžete opakovat – průběh bude pokaždé trochu jiný.</p>
    ${SM.list.length ? `<div class="sim-cards">${SM.list.map(s => {
      const open = s.runs.find(r => !r.finished_at), done = s.runs.filter(r => r.finished_at && r.result && r.result.pct != null);
      return `<article class="sim-card"><div class="kind">${esc(SIM_MODULES[s.module] || s.module)}${s.status === 'draft' ? ' <span class="draft-tag">koncept – vidí jen redakce</span>' : ''}</div>
        <h2>${esc(s.title)}</h2><p>${esc(s.summary)}</p>
        <div class="muted">${s.role ? esc(s.role) + ' · ' : ''}${s.minutes ? `asi ${s.minutes} minut` : ''}</div>
        <div class="sim-card-act"><a class="btn acc" href="#/simulace/${encodeURIComponent(s.id)}">${open ? 'Pokračovat' : done.length ? 'Zkusit znovu' : 'Spustit'}</a>
        ${done.length ? `<span class="muted">Dokončeno ${done.length}× · naposledy <a href="#/simulace/${encodeURIComponent(s.id)}/rozbor/${done[0].id}">${done[0].result.pct} % – ${esc(done[0].result.outcome || '')}</a></span>` : ''}</div></article>`; }).join('')}</div>`
      : '<p class="muted">Zatím vám není zpřístupněná žádná simulace.</p>'}</div>`;
}

/* ---------- průchod ---------- */
async function simLoad(id){
  const { data, error } = await RQ.client.rpc('rq_sim_scenario', { p_id: id });
  if (error) throw new Error(error.message);
  SM.sid = id; SM.title = data.title; SM.status = data.status; SM.open = null;
  SM.def = (data.run && data.run.definition) || data.definition;
  SM.run = data.run ? data.run.id : null; SM.st = data.run ? RQSim.upgrade(data.run.state) : null;
  if (SM.st && RQSim.live(SM.def) && SM.def.time?.pause_when_closed === false && SM.st.saved_at && SM.st.phase === 'run'){
    SM.st = RQSim.advance(SM.def, SM.st, (Date.now() - SM.st.saved_at) / 60000 * SM.def.time.rate);   // hodiny běžely i při zavřeném okně
  }
}
function simSave(result){
  if (!SM.st) return SM.save;
  SM.st.saved_at = Date.now(); SM.savedAt = Date.now();
  const st = SM.st, sid = SM.sid;
  SM.save = SM.save.then(async () => {
    const { data, error } = await RQ.client.rpc('rq_sim_save_run', { p_scenario_id: sid, p_run: SM.run, p_state: st, p_result: result || null });
    if (error) throw new Error(error.message);
    SM.run = data;
  }).catch(e => toast('Průběh se nepodařilo uložit: ' + e.message));
  return SM.save;
}
async function renderSimPlay(){
  const box = $('#panelText'), id = S.simId;
  if (SM.sid !== id || SM.def == null){
    simStop();
    box.innerHTML = '<p class="muted">Načítám simulaci…</p>';
    try { await simLoad(id); } catch (e) { box.innerHTML = `<div class="sim-page"><h1>Simulace není dostupná</h1><p class="muted">${esc(e.message)}</p><p><a href="#/simulace">Zpět na simulace</a></p></div>`; return; }
    if (S.view !== 'sim' || S.simId !== id) return;
  }
  document.title = `${SM.title} · Simulace · RegulaQuest`;
  if (!SM.st) return simIntro(box);
  simPaint(); simRun();
}
function simIntro(box){
  const d = SM.def, tm = d.time || {};
  box.innerHTML = `<div class="sim-page sim-intro"><div class="eyebrow">Simulace · ${esc(SIM_MODULES[d.module] || d.module || '')}</div><h1>${esc(SM.title)}</h1>
    ${d.role ? `<p class="sim-role">Vaše role: <b>${esc(d.role)}</b></p>` : ''}${simText(d.intro)}
    ${RQSim.live(d) ? `<p class="muted">Běžící čas: 1 minuta = ${simDur(tm.rate)} simulovaného času${tm.prep_minutes ? ` · příprava ${tm.prep_minutes} min` : ''}.</p>` : '<p class="muted">Čas se posouvá jen vašimi kroky.</p>'}
    <p><button type="button" class="btn acc" id="simStart">Začít simulaci</button> <a class="btn" href="#/simulace">Zpět</a></p></div>`;
  $('#simStart').onclick = async () => {
    SM.st = RQSim.start(SM.def); SM.run = null; SM.open = null;
    await simSave(); simPaint(); simRun();
  };
}

// běžící hodiny
function simRun(){
  simStop();
  if (!SM.st || !RQSim.live(SM.def) || SM.st.ended) return;
  SM.last = Date.now();
  SM.timer = setInterval(simTick, 1000);
}
function simStop(){
  if (SM.timer){ clearInterval(SM.timer); SM.timer = null; if (SM.st && !SM.st.ended) simSave(); }
}
addEventListener('pagehide', () => { if (SM.timer && SM.st) simSave(); });
document.addEventListener('visibilitychange', () => {
  if (!SM.timer) return;
  if (document.hidden) simSave(); else SM.last = Date.now();       // při skrytém okně hodiny stojí (pokud scénář neříká jinak)
});
function simTick(){
  if (S.view !== 'sim' || !SM.st){ simStop(); return; }
  const now = Date.now(), dt = now - SM.last; SM.last = now;
  if (document.hidden && SM.def.time?.pause_when_closed !== false) return;
  const st0 = SM.st;
  if (st0.phase === 'prep'){
    const left = st0.prep_ms - dt * SM.speed;
    if (left <= 0){ SM.st = RQSim.begin(SM.def, st0); SM.open = null; simSave(); simPaint(); return; }
    st0.prep_ms = left; const el = $('#simPrepLeft'); if (el) el.textContent = simMmSs(left); return;
  }
  const n0 = st0.inbox.length, p0 = st0.pending.length;
  SM.st = RQSim.advance(SM.def, st0, dt / 60000 * SM.def.time.rate * SM.speed);
  if (SM.st.ended) return simFinish();
  if (SM.st.inbox.length !== n0 || SM.st.pending.length !== p0){ if (SM.st.inbox.length > n0) SM.open = SM.st.inbox.length - 1; simSave(); simPaint(); return; }
  const c = $('#simClock'); if (c) c.textContent = simClock(SM.st.t);
  document.querySelectorAll('[data-eta]').forEach(e => { e.textContent = 'hotovo za ' + simDur(Math.max(0, +e.dataset.eta - SM.st.t)); });
  if (now - SM.savedAt > 15000) simSave();
}

function simPaint(){
  const box = $('#panelText'), d = SM.def, st = SM.st;
  const inbox = st.inbox.map((m, i) => ({ ...m, i })).reverse();
  if (SM.open == null && inbox.length) SM.open = inbox[0].i;
  const cur = SM.open != null ? st.inbox[SM.open] : null, msg = cur && d.messages[cur.id];
  if (cur && !cur.read) cur.read = true;
  const groups = []; RQSim.actions(d, st).forEach(x => { let g = groups.find(g => g.name === (x.a.group || 'Akce')); if (!g) groups.push(g = { name: x.a.group || 'Akce', xs: [] }); g.xs.push(x); });
  const dd = n => n ? simDur(n * 24) : 'hned';
  const prep = st.phase === 'prep';
  box.innerHTML = `<div class="sim-play">
    <div class="sim-head"><div><div class="eyebrow">Simulace · ${esc(SIM_MODULES[d.module] || d.module || '')}${SM.status === 'draft' ? ' · koncept' : ''}</div><h1>${esc(SM.title)}</h1>${d.role ? `<div class="muted">${esc(d.role)}</div>` : ''}</div>
      <div class="sim-clock" aria-live="off"><strong id="simClock" class="${RQSim.live(d) && !prep ? 'live' : ''}">${prep ? 'Příprava' : esc(simClock(st.t))}</strong><button type="button" class="btn small" id="simRestart" title="Zahodit tento průchod a začít znovu">Začít znovu</button></div></div>
    ${(d.indicators || []).some(i => i.visible !== false) ? `<div class="sim-ind">${(d.indicators || []).filter(i => i.visible !== false).map(i => `<span><small>${esc(i.label || i.var)}</small><b>${Number(st.vars[i.var] ?? i.start ?? 0).toLocaleString('cs-CZ')}${i.unit ? ' ' + esc(i.unit) : ''}</b></span>`).join('')}</div>` : ''}
    ${prep ? `<div class="sim-prep"><div><b>Seznamte se s podklady.</b> Hodiny zatím stojí. Krize začne za <b id="simPrepLeft">${simMmSs(st.prep_ms)}</b>.</div><button type="button" class="btn acc" id="simBegin">Jsem připraven(a), začít</button></div>` : ''}
    ${simAdmin() ? simDebugBar() : ''}
    <div class="sim-grid">
      <section class="sim-inbox" aria-label="Pošta"><h2>Pošta a podklady</h2><ul>${inbox.map(m => { const mm = d.messages[m.id] || {}; return `<li><button type="button" data-msg="${m.i}" class="${m.i === SM.open ? 'on' : ''}${m.read ? '' : ' unread'}"><span class="from">${esc(mm.from || '')}</span><span class="subj">${esc(mm.subject || '')}</span><span class="day">${esc(simClock(m.t))}</span></button></li>`; }).join('')}</ul></section>
      <section class="sim-msg" aria-label="Zpráva">${msg ? `<div class="sim-msg-h"><div class="from">${esc(msg.from || '')}</div><h2>${esc(msg.subject || '')}</h2><div class="muted">${esc(simClock(cur.t))}</div></div><div class="sim-body">${simText(msg.body)}</div>` : '<p class="muted">Žádná zpráva.</p>'}</section>
      <section class="sim-acts" aria-label="Co uděláte"><h2>Co uděláte</h2>
        ${st.pending.length ? `<div class="sim-pend"><h3>Probíhá</h3>${st.pending.map(p => `<div class="sim-pend-i"><span>${esc(p.text)}</span><small data-eta="${p.due}">hotovo za ${simDur(Math.max(0, p.due - st.t))}</small></div>`).join('')}</div>` : ''}
        ${groups.map(g => `<div class="sim-g"><h3>${esc(g.name)}</h3>${g.xs.map(x => `<button type="button" class="sim-act" data-act="${esc(x.a.id)}"${x.ok ? '' : ` disabled title="${esc(x.need)}"`}><span>${esc(x.a.label)}</span><small>${x.a.end ? '' : dd(x.a.days || 0)}</small></button>${!x.ok && x.need && !prep ? `<div class="sim-need">${esc(x.need)}</div>` : ''}`).join('')}</div>`).join('')}</section>
    </div>
    <details class="sim-log"><summary>Průběh (${st.log.length})</summary><ol>${st.log.map(l => `<li class="k-${l.kind}"><span>${esc(simClock(l.t))}</span> ${esc(l.text)}</li>`).join('')}</ol></details></div>`;
  box.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => { SM.open = +b.dataset.msg; simPaint(); });
  box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => simDo(b.dataset.act));
  $('#simBegin')?.addEventListener('click', () => { SM.st = RQSim.begin(SM.def, SM.st); SM.open = null; simSave(); simPaint(); });
  $('#simRestart').onclick = async () => {
    if (!confirm('Zahodit tento průchod a začít znovu?')) return;
    simStop(); await simSave({ pct: null, outcome: 'Nedokončeno', ok: [], bad: [] });
    SM.st = null; SM.run = null; SM.open = null; await simLoad(SM.sid); simIntro($('#panelText'));
  };
  if (simAdmin()) simDebugBind();
}
// Ladicí lišta – jen pro redakci (zkušební průchod): zrychlení, posun času, stav
function simDebugBar(){
  const st = SM.st, live = RQSim.live(SM.def);
  return `<div class="sim-debug"><b>Ladění (vidí jen redakce)</b>
    ${live ? `<label>Rychlost <select id="simSpeed">${[1, 5, 20, 60].map(x => `<option value="${x}"${SM.speed === x ? ' selected' : ''}>×${x}</option>`).join('')}</select></label>` : ''}
    <button type="button" class="btn small" data-skip="6">+6 h</button><button type="button" class="btn small" data-skip="24">+1 den</button><button type="button" class="btn small" data-skip="72">+3 dny</button>
    <label><input type="checkbox" id="simDbgShow"${SM.debug ? ' checked' : ''}> stav</label>
    ${SM.debug ? `<pre>${esc(JSON.stringify({ den: +(st.t / 24).toFixed(2), faze: st.phase, seed: st.seed,
      naplanovano: Object.fromEntries(Object.entries(st.sched).map(([k, v]) => [k, v === -1 ? 'v tomto průchodu nenastane' : 'den ' + (v / 24).toFixed(2)])),
      probiha: st.pending.map(p => p.id + ' → den ' + (p.due / 24).toFixed(2)), stav: st.vars, hotovo: Object.fromEntries(Object.entries(st.done).map(([k, v]) => [k, 'den ' + (v / 24).toFixed(2)])) }, null, 1))}</pre>` : ''}</div>`;
}
function simDebugBind(){
  $('#simSpeed')?.addEventListener('change', e => { SM.speed = +e.target.value; });
  $('#simDbgShow')?.addEventListener('change', e => { SM.debug = e.target.checked; simPaint(); });
  document.querySelectorAll('.sim-debug [data-skip]').forEach(b => b.onclick = () => {
    if (SM.st.phase === 'prep') SM.st = RQSim.begin(SM.def, SM.st);
    const n0 = SM.st.inbox.length;
    SM.st = RQSim.advance(SM.def, SM.st, +b.dataset.skip);
    if (SM.st.ended) return simFinish();
    if (SM.st.inbox.length > n0) SM.open = SM.st.inbox.length - 1;
    simSave(); simPaint();
  });
}
async function simDo(id){
  if (SM.busy) return;
  const a = SM.def.actions.find(x => x.id === id); if (!a) return;
  if (a.confirm && !confirm(a.confirm)) return;
  let payload = null;
  if (a.choice || a.form){ payload = await simDialog(a); if (!payload) return; }
  SM.busy = true;
  try {
    const n0 = SM.st.inbox.length;
    SM.st = RQSim.act(SM.def, SM.st, id, payload);
    if (SM.st.inbox.length > n0) SM.open = SM.st.inbox.length - 1;      // nová zpráva se rovnou otevře
    if (SM.st.ended) return simFinish();
    simSave(); simPaint(); if (!SM.timer) simRun();
  } catch (e) { toast(e.message); }
  finally { SM.busy = false; }
}
async function simFinish(){
  const timer = SM.timer; SM.timer = null; if (timer) clearInterval(timer);
  const ev = RQSim.evaluate(SM.def, SM.st);
  await simSave({ pct: ev.pct, outcome: ev.outcome ? ev.outcome.label : '', ok: ev.items.filter(x => x.ok).map(x => x.rule.id), bad: ev.items.filter(x => !x.ok).map(x => x.rule.id) });
  const rid = SM.run; SM.st = null; SM.run = null; SM.def = null;
  loadSims();
  location.hash = `#/simulace/${encodeURIComponent(S.simId)}/rozbor/${rid}`;
}
// Volba nebo formulář v dialogu → {choice} / {form}. Hodiny mezitím běží dál.
function simDialog(a){
  return new Promise(resolve => {
    document.getElementById('simDlg')?.remove();
    const box = document.createElement('div'); box.id = 'simDlg'; box.className = 'fb-overlay';
    const f = a.form, c = a.choice, days = a.days || 0;
    box.innerHTML = `<form class="fb-dlg sim-dlg" role="dialog" aria-modal="true" aria-labelledby="simDlgH">
      <h2 id="simDlgH">${esc(c ? (c.prompt || a.label) : (f.title || a.label))}</h2>${f && f.intro ? `<p class="muted">${esc(f.intro)}</p>` : ''}
      ${c ? `<div class="sim-opts">${c.options.map((o, i) => `<label><input type="radio" name="ch" value="${esc(o.id)}"${i ? '' : ' required'}> ${esc(o.label)}</label>`).join('')}</div>` : ''}
      ${f ? (f.fields || []).map(fl => `<fieldset class="sim-field"><legend>${esc(fl.label)}</legend>${
          fl.type === 'select' ? fl.options.map((o, i) => `<label><input type="radio" name="f_${esc(fl.id)}" value="${esc(o.id)}"${i ? '' : ' required'}> ${esc(o.label)}</label>`).join('')
        : fl.type === 'checks' ? fl.options.map(o => `<label><input type="checkbox" name="f_${esc(fl.id)}" value="${esc(o.id)}"> ${esc(o.label)}</label>`).join('')
        : `<textarea name="f_${esc(fl.id)}" rows="3"></textarea>`}</fieldset>`).join('') : ''}
      ${RQSim.live(SM.def) ? '<p class="muted">Hodiny mezitím běží.</p>' : ''}
      <div class="fb-actions"><button type="button" class="btn" data-x>Zrušit</button><button type="submit" class="btn acc">${days ? `Provést (${simDur(days * 24)})` : 'Provést'}</button></div></form>`;
    document.body.appendChild(box);
    const done = v => { box.remove(); resolve(v); };
    box.querySelector('[data-x]').onclick = () => done(null);
    box.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    box.querySelector('form').onsubmit = e => {
      e.preventDefault(); const fd = new FormData(e.target);
      if (c) return done({ choice: fd.get('ch') });
      const out = {}; (f.fields || []).forEach(fl => { out[fl.id] = fl.type === 'checks' ? fd.getAll('f_' + fl.id) : (fd.get('f_' + fl.id) || ''); });
      done({ form: out });
    };
    box.querySelector('input, textarea')?.focus();
  });
}

/* ---------- rozbor ---------- */
async function renderSimResult(){
  const box = $('#panelText'); box.innerHTML = '<p class="muted">Načítám rozbor…</p>';
  let run, def, title;
  try {
    const [r, s] = await Promise.all([RQ.client.rpc('rq_sim_run', { p_run: S.simRun }), RQ.client.rpc('rq_sim_scenario', { p_id: S.simId })]);
    if (r.error || s.error) throw new Error((r.error || s.error).message);
    run = r.data; def = (run && run.definition) || s.data.definition; title = s.data.title;
  } catch (e) { box.innerHTML = `<div class="sim-page"><h1>Rozbor není dostupný</h1><p class="muted">${esc(e.message)}</p></div>`; return; }
  if (!run || S.view !== 'simdone') { if (!run) box.innerHTML = '<div class="sim-page"><h1>Rozbor nenalezen</h1></div>'; return; }
  const st = RQSim.upgrade(run.state), ev = RQSim.evaluate(def, st), cls = ev.pct >= 90 ? 'good' : ev.pct >= 65 ? 'mid' : 'bad';
  document.title = `Rozbor · ${title} · RegulaQuest`;
  box.innerHTML = `<div class="sim-page sim-result"><div class="eyebrow">Simulace · rozbor</div><h1>${esc(title)}</h1>
    <div class="sim-score ${cls}"><strong>${ev.pct} %</strong><div><b>${esc(ev.outcome ? ev.outcome.label : '')}</b><p>${esc(ev.outcome ? ev.outcome.text : '')}</p></div></div>
    <h2>Co se povedlo a co ne</h2><ul class="sim-rules">${ev.items.map(x => `<li class="${x.ok ? 'ok' : 'no'}"><span class="mk" aria-hidden="true">${x.ok ? '✓' : '✗'}</span><div><b>${esc(x.rule.label)}</b><p>${esc(x.ok ? (x.rule.good || '') : (x.rule.bad || ''))}</p>${(x.rule.refs || []).length ? `<div class="refs">Předpisy: ${x.rule.refs.map(simRef).join(' · ')}</div>` : ''}</div></li>`).join('')}</ul>
    <h2>Průběh</h2><ol class="sim-timeline">${st.log.map(l => `<li class="k-${l.kind}"><span>${esc(RQSim.clock(def, l.t))}</span> ${esc(l.text)}</li>`).join('')}</ol>
    <p><a class="btn acc" href="#/simulace/${encodeURIComponent(S.simId)}">Zkusit znovu</a> <a class="btn" href="#/simulace">Zpět na simulace</a></p></div>`;
}
