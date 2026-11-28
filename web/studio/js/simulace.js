'use strict';
/* RegulaQuest Studio – Simulace: scénáře (definice JSON), zpřístupnění skupinám, souhrnné výsledky bez jmen.
   Přepínač prostorů Legislativa | Simulace nahoře mění levý panel; Zpětná vazba a Správa jsou společné. */
window.RQSimAdmin = (function () {
  let A = null, openId = null;
  const MOD = { vigilance: 'Vigilance – nežádoucí příhody' };
  const reader = () => { const a = document.querySelector('[data-reader=""]'); return a ? a.href.replace(/\/$/, '') : ''; };
  const fmt = s => s ? new Date(s).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  /* ---------- prostory ---------- */
  let inited = false;
  function initSpaces() {
    const rail = document.querySelector('.rail'); if (!rail || inited) return;
    inited = true; let shared = false;
    [...rail.children].forEach(el => { if (el.dataset.shared != null) shared = true; if (!shared && el.dataset.space !== 'sim') el.classList.add('leg-only'); });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('#spaces [data-space]'); if (!b) return;
    initSpaces();
    const sim = b.dataset.space === 'sim';
    if (sim !== document.body.classList.contains('space-sim')) setPage(sim ? 'sim' : 'home');
  });
  // Volá se při každé změně stránky: stránka Simulace → prostor Simulace; společné stránky prostor nemění
  function page(p) {
    initSpaces();
    const shared = ['feedback', 'usage', 'access'].includes(p);
    if (!shared) document.body.classList.toggle('space-sim', p === 'sim');
    document.querySelectorAll('#spaces [data-space]').forEach(b => b.classList.toggle('on', (b.dataset.space === 'sim') === document.body.classList.contains('space-sim')));
  }

  /* ---------- stránka ---------- */
  async function load(force) { if (!A || force) A = await rpc('rq_sim_admin', {}); return A; }
  async function render() {
    const box = document.getElementById('simContent'); if (!box) return;
    if (!A) { box.innerHTML = '<p class="fine">Načítám…</p>'; try { await load(); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; } }
    box.innerHTML = `<div class="page-head"><div><div class="eyebrow">SIMULACE / SCÉNÁŘE</div><h1>Simulace</h1>
      <p>Scénáře, ve kterých si studenti vyzkouší regulatorní práci v praxi. Studenti vidí jen scénáře ve stavu <b>Připraveno</b> zpřístupněné jejich skupině. Výsledky jsou jen souhrnné – bez účtů; průchody redakce se nepočítají.</p></div>
      <div class="head-actions"><button class="btn" id="simNew">+ Nový scénář (JSON)</button></div></div>
      ${A.scenarios.length ? A.scenarios.map(card).join('') : '<div class="notice">Zatím žádný scénář.</div>'}`;
    box.querySelector('#simNew').onclick = () => editor(null);
    A.scenarios.forEach(s => bind(box.querySelector(`.sim-sc[data-id="${CSS.escape(s.id)}"]`), s));
  }
  function card(s) {
    const st = s.stats || {}, d = s.definition || {}, rules = d.rules || [], open = openId === s.id;
    const rate = r => { const x = (st.rules || {})[r.id]; return x && x.n ? Math.round(x.ok / x.n * 100) : null; };
    return `<section class="card sim-sc" data-id="${esc(s.id)}">
      <div class="sim-sc-head"><div><div class="eyebrow">${esc(MOD[s.module] || s.module)}</div><h2>${esc(s.title)}</h2><p class="fine">${esc(s.summary || '')}</p></div>
        <div class="sim-sc-st"><span class="badge ${s.status === 'ready' ? 'b-ok' : 'b-draft'}">${s.status === 'ready' ? 'Připraveno' : 'Koncept'}</span>
        <button class="btn tiny" data-status>${s.status === 'ready' ? 'Vrátit do konceptu' : 'Označit jako připravené'}</button></div></div>
      <div class="sim-sc-grid">
        <div><h3>Zpřístupnění skupinám</h3>${A.groups.length ? A.groups.map(g => { const x = (s.groups || []).find(y => y.group_id === g.id);
          return `<label class="sim-grp"><input type="checkbox" data-grp="${esc(g.id)}"${x ? ' checked' : ''}> ${esc(g.name)} <span class="fine">od</span> <input type="date" class="input tiny" data-from="${esc(g.id)}" value="${x ? esc(x.visible_from) : ''}"${x ? '' : ' disabled'}></label>`; }).join('') : '<p class="fine">Nejsou žádné skupiny (Přístupy).</p>'}</div>
        <div><h3>Výsledky (souhrnně)</h3><p class="sim-kpi"><b>${st.finished || 0}</b> dokončených z ${st.runs || 0} spuštěných${st.pct_avg != null ? ` · průměr <b>${st.pct_avg} %</b>` : ''}</p>
          ${Object.keys(st.outcomes || {}).length ? `<p class="fine">${Object.entries(st.outcomes).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ')}</p>` : ''}</div>
      </div>
      <details class="sim-more"${open ? ' open' : ''}><summary>Pravidla hodnocení a úspěšnost studentů (${rules.length})</summary>
        <ul class="sim-rules-a">${rules.map(r => { const p = rate(r); return `<li><span>${esc(r.label)}</span><span class="sim-bar"><i style="width:${p == null ? 0 : p}%"></i></span><b>${p == null ? '–' : p + ' %'}</b></li>`; }).join('')}</ul>
        <p class="fine">Procento = podíl dokončených průchodů, ve kterých student pravidlo splnil (u pravidel, která v daném průchodu platila).</p></details>
      <div class="sim-sc-act"><a class="btn" href="${esc(reader())}/#/simulace/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Vyzkoušet ve studentské části ↗</a>
        <button class="btn" data-edit>Upravit scénář (JSON)</button><button class="btn" data-dl>Stáhnout JSON</button>
        <button class="btn" data-reset>Vymazat výsledky</button><button class="btn danger" data-del>Smazat</button>
        <span class="fine">Upraveno ${esc(fmt(s.updated_at))}</span></div></section>`;
  }
  function bind(el, s) {
    if (!el) return;
    const run = (p, msg) => p.then(() => load(true)).then(() => { openId = s.id; render(); if (msg) toast(msg); }).catch(e => toast(e.message, true));
    el.querySelector('[data-status]').onclick = () => run(rpc('rq_sim_save_scenario', { p_id: s.id, p_patch: { status: s.status === 'ready' ? 'draft' : 'ready' } }), s.status === 'ready' ? 'Vráceno do konceptu.' : 'Scénář je připravený – studenti ho uvidí ve zpřístupněných skupinách.');
    el.querySelectorAll('[data-grp]').forEach(cb => cb.onchange = () => {
      const g = cb.dataset.grp, d = el.querySelector(`[data-from="${CSS.escape(g)}"]`).value || null;
      run(rpc('rq_sim_set_group', { p_scenario_id: s.id, p_group_id: g, p_visible_from: d, p_on: cb.checked }), cb.checked ? 'Zpřístupněno.' : 'Zpřístupnění zrušeno.');
    });
    el.querySelectorAll('[data-from]').forEach(inp => inp.onchange = () => run(rpc('rq_sim_set_group', { p_scenario_id: s.id, p_group_id: inp.dataset.from, p_visible_from: inp.value || null, p_on: true }), 'Datum uloženo.'));
    el.querySelector('[data-edit]').onclick = () => editor(s);
    el.querySelector('[data-dl]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s.definition, null, 2)], { type: 'application/json' })); a.download = s.id + '.json'; a.click(); };
    el.querySelector('[data-reset]').onclick = () => { if (confirm('Vymazat všechny průchody a výsledky tohoto scénáře? (Např. po zásadní úpravě scénáře nebo před novým semestrem.)')) run(rpc('rq_sim_reset_runs', { p_scenario_id: s.id }), 'Výsledky vymazány.'); };
    el.querySelector('[data-del]').onclick = () => { if (confirm(`Smazat scénář „${s.title}“ včetně všech průchodů?`)) run(rpc('rq_sim_delete_scenario', { p_id: s.id }), 'Scénář smazán.'); };
  }
  // Editor definice: zatím jako JSON s kontrolou (plnohodnotný editor až podle zkušeností)
  function editor(s) {
    document.getElementById('simEd')?.remove();
    const box = document.createElement('div'); box.id = 'simEd'; box.className = 'sim-overlay';
    box.innerHTML = `<div class="sim-modal" role="dialog" aria-modal="true"><h2>${s ? 'Upravit scénář' : 'Nový scénář'}</h2>
      <p class="fine">Scénář je definice JSON (zprávy, akce, události, pravidla hodnocení). Před uložením se zkontroluje. ${s ? 'Rozehrané průchody studentů zůstanou; při zásadní změně zvažte „Vymazat výsledky“.' : 'Nový scénář se uloží jako koncept.'}</p>
      ${s ? '' : '<p><input type="file" accept=".json,application/json" id="simFile"></p>'}
      <textarea class="input mono" id="simJson" rows="22" spellcheck="false">${esc(s ? JSON.stringify(s.definition, null, 2) : '')}</textarea>
      <div id="simErr" class="fine"></div>
      <div class="modal-actions"><button class="btn" data-x>Zrušit</button><button class="btn" data-check>Zkontrolovat</button><button class="btn accent" data-save>Uložit</button></div></div>`;
    document.body.appendChild(box);
    const ta = box.querySelector('#simJson'), errEl = box.querySelector('#simErr');
    const parse = () => { let d; try { d = JSON.parse(ta.value); } catch (e) { errEl.innerHTML = `<span class="err">Neplatný JSON: ${esc(e.message)}</span>`; return null; }
      const err = RQSim.validate(d); errEl.innerHTML = err.length ? `<span class="err">Chyby (${err.length}):</span><ul>${err.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="ok">✓ Scénář je v pořádku.</span>'; return err.length ? null : d; };
    box.querySelector('#simFile')?.addEventListener('change', async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); parse(); } });
    box.querySelector('[data-x]').onclick = () => box.remove();
    box.querySelector('[data-check]').onclick = parse;
    box.querySelector('[data-save]').onclick = async () => {
      const d = parse(); if (!d) return;
      try { const id = await rpc('rq_sim_save_scenario', { p_id: s ? s.id : null, p_patch: { definition: d } }); openId = id; box.remove(); await load(true); render(); toast('Scénář uložen.'); }
      catch (e) { errEl.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    };
  }
  return { render, page, load };
})();
