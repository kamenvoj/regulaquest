'use strict';
/* RegulaQuest Studio – správa přístupů: skupiny studentů, studentské účty a admini.
   Účty zakládá serverová funkce „ucty“, ostatní zápisy jdou přes funkce rq_*. */
(function () {
  let rq, client, cfg, esc;
  const $ = s => document.querySelector(s);

  async function must(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }
  async function accounts(body) {
    const { data, error } = await client.functions.invoke(cfg.accountsFunction, { body });
    if (error) {
      let m = error.message;
      try { const j = await error.context.json(); m = j.error || m; } catch (_) { /* odpověď bez JSON */ }
      if (/Failed to send a request|Failed to fetch/i.test(m)) m = 'Serverová funkce „ucty“ není dostupná. Je nasazená v Supabase?';
      throw new Error(m);
    }
    return data;
  }
  const fmtDate = s => s ? new Date(s).toLocaleDateString('cs-CZ') : '–';

  function dialog(html, onOpen) {
    const d = $('#dlg');
    d.oncancel = null;
    $('#dlgBody').innerHTML = html;
    d.showModal();
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
    if (onOpen) onOpen(d);
    return d;
  }

  // ------------------------------------------------------------ přístupy
  async function renderAccess() {
    const c = $('#accessContent');
    c.innerHTML = '<p class="empty">Načítám…</p>';
    const [groups, profiles] = await Promise.all([
      must(client.from('student_groups').select('*').order('created_at', { ascending: false })),
      must(client.from('profiles').select('user_id,username,display_name,role,group_id,active,created_at').order('username'))]);
    const staff = profiles.filter(p => p.role !== 'student');
    const byGroup = id => profiles.filter(p => p.role === 'student' && p.group_id === id);
    const owner = rq.me.isOwner;
    c.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">SPRÁVA / PŘÍSTUPY</div><h1>Přístupy</h1><p>Studenti dostanou přidělené jméno a náhodné heslo, bez osobních údajů. Účet platí, dokud ho nedeaktivujete.</p></div></div>
      <div class="card">
        <div class="card-head"><h2>Skupiny studentů</h2></div>
        <form class="form-row" id="newGroup">
          <label class="field">Název skupiny<input name="name" required maxlength="120" placeholder="Např. SIPZ – nástup 2026"></label>
          <label class="field">Poznámka<input name="note" maxlength="200" placeholder="nepovinné"></label>
          <label class="field">Platnost do<input name="valid_until" type="date"></label>
          <button class="btn accent">+ Nová skupina</button>
        </form>
        <div style="margin-top:16px">${groups.length ? `<table class="list"><thead><tr><th>Skupina</th><th>Účty</th><th>Platnost do</th><th>Stav</th><th></th></tr></thead><tbody>
          ${groups.map(g => { const s = byGroup(g.id), act = s.filter(x => x.active).length; return `<tr>
            <td><b>${esc(g.name)}</b>${g.note ? `<br><small>${esc(g.note)}</small>` : ''}</td>
            <td>${act} aktivních${s.length !== act ? ` / ${s.length}` : ''}</td>
            <td>${g.valid_until ? fmtDate(g.valid_until) : 'bez omezení'}</td>
            <td>${g.active ? '<span class="tag">aktivní</span>' : '<span class="tag off">deaktivována</span>'}</td>
            <td><div class="actions">
              <button class="btn small accent" data-gen="${g.id}" ${g.active ? '' : 'disabled'}>Vygenerovat účty</button>
              <button class="btn small" data-show="${g.id}">Účty</button>
              <button class="btn small ${g.active ? 'danger' : ''}" data-gtoggle="${g.id}">${g.active ? 'Deaktivovat skupinu' : 'Znovu aktivovat'}</button>
            </div></td></tr>`; }).join('')}</tbody></table>` : '<p class="empty">Zatím žádná skupina. Doporučení: jedna skupina na ročník nástupu, např. „SIPZ – nástup 2026“.</p>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Admini</h2>${owner ? '<button class="btn accent" id="newAdmin">+ Nový admin</button>' : ''}</div>
        <table class="list"><thead><tr><th>Jméno</th><th>Zobrazované jméno</th><th>Role</th><th>Stav</th><th></th></tr></thead><tbody>
        ${staff.map(p => `<tr><td class="mono">${esc(p.username)}</td><td>${esc(p.display_name)}</td>
          <td>${p.role === 'owner' ? '<span class="tag owner">správce</span>' : 'admin'}</td>
          <td>${p.active ? '<span class="tag">aktivní</span>' : '<span class="tag off">deaktivován</span>'}</td>
          <td>${owner && p.user_id !== rq.me.user.id ? `<div class="actions">
            <button class="btn small" data-reset="${p.user_id}">Nové heslo</button>
            <button class="btn small ${p.active ? 'danger' : ''}" data-ptoggle="${p.user_id}" data-active="${p.active}">${p.active ? 'Deaktivovat' : 'Aktivovat'}</button></div>` : ''}</td></tr>`).join('')}
        </tbody></table>
        ${owner ? '' : '<p class="empty">Účty adminů spravuje správce.</p>'}
      </div>`;

    $('#newGroup').onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await must(client.rpc('rq_new_group', { p_name: f.get('name'), p_note: f.get('note') || '', p_valid_until: f.get('valid_until') || null }));
        toast('Skupina vytvořena.'); renderAccess();
      } catch (e) { toast(e.message, true); }
    };
    c.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => generateDialog(groups.find(g => g.id === b.dataset.gen)));
    c.querySelectorAll('[data-show]').forEach(b => b.onclick = () => groupDialog(groups.find(g => g.id === b.dataset.show), byGroup(b.dataset.show)));
    c.querySelectorAll('[data-gtoggle]').forEach(b => b.onclick = async () => {
      const g = groups.find(x => x.id === b.dataset.gtoggle);
      if (g.active && !confirm(`Deaktivovat skupinu „${g.name}“? Všichni její studenti okamžitě ztratí přístup do studentské části.`)) return;
      try { await must(client.rpc('rq_update_group', { p_id: g.id, p_name: g.name, p_note: g.note, p_valid_until: g.valid_until, p_active: !g.active })); renderAccess(); }
      catch (e) { toast(e.message, true); }
    });
    c.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPassword(profiles.find(p => p.user_id === b.dataset.reset)));
    c.querySelectorAll('[data-ptoggle]').forEach(b => b.onclick = () => toggleProfile(b.dataset.ptoggle, b.dataset.active !== 'true'));
    const na = $('#newAdmin'); if (na) na.onclick = newAdminDialog;
  }

  async function toggleProfile(userId, active) {
    try { await must(client.rpc('rq_set_profile_active', { p_user_id: userId, p_active: active })); toast(active ? 'Účet aktivován.' : 'Účet deaktivován.'); }
    catch (e) { toast(e.message, true); }
    if ($('#dlg').open) $('#dlg').close();
    renderAccess();
  }

  async function resetPassword(p) {
    if (!confirm(`Vygenerovat nové heslo pro „${p.username}“? Staré heslo přestane platit.`)) return;
    try { const r = await accounts({ action: 'reset_password', user_id: p.user_id }); showCredentials('Nové heslo', [r], null); }
    catch (e) { toast(e.message, true); }
  }

  function groupDialog(g, students) {
    dialog(`<h2>${esc(g.name)}</h2>
      <p class="lead">${students.length} účtů. Hesla se neukládají čitelně; zapomenuté heslo nahradíte novým.</p>
      <div class="pwlist">${students.length ? `<table class="list"><thead><tr><th>Jméno</th><th>Vytvořen</th><th>Stav</th><th></th></tr></thead><tbody>
        ${students.map(s => `<tr><td class="mono">${esc(s.username)}</td><td>${fmtDate(s.created_at)}</td>
          <td>${s.active ? '<span class="tag">aktivní</span>' : '<span class="tag off">deaktivován</span>'}</td>
          <td><div class="actions"><button class="btn small" data-reset="${s.user_id}">Nové heslo</button>
          <button class="btn small ${s.active ? 'danger' : ''}" data-ptoggle="${s.user_id}" data-active="${s.active}">${s.active ? 'Deaktivovat' : 'Aktivovat'}</button></div></td></tr>`).join('')}
        </tbody></table>` : '<p class="empty" style="padding:12px">Ve skupině zatím nejsou účty.</p>'}</div>
      <div class="dlg-actions"><button class="btn" data-close>Zavřít</button></div>`, d => {
      d.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { d.close(); resetPassword(students.find(s => s.user_id === b.dataset.reset)); });
      d.querySelectorAll('[data-ptoggle]').forEach(b => b.onclick = () => toggleProfile(b.dataset.ptoggle, b.dataset.active !== 'true'));
    });
  }

  function generateDialog(g) {
    dialog(`<h2>Vygenerovat účty</h2>
      <p>Skupina <b>${esc(g.name)}</b>. Každý účet dostane jméno ve tvaru <span class="mono">rq-xxxxxx</span> a náhodné heslo.</p>
      <form class="form-row" id="genForm"><label class="field">Počet účtů<input name="count" type="number" min="1" max="200" value="10" required></label>
      <button class="btn accent" id="genBtn">Vygenerovat</button></form>
      <p class="note" style="margin-top:14px">Hesla se zobrazí <b>jen jednou</b>, hned po vygenerování. Vytiskněte lístečky nebo si stáhněte seznam.</p>
      <div class="dlg-actions"><button class="btn" data-close>Zrušit</button></div>`, d => {
      d.querySelector('#genForm').onsubmit = async ev => {
        ev.preventDefault();
        const btn = d.querySelector('#genBtn'); btn.disabled = true; btn.textContent = 'Generuji…';
        try {
          const r = await accounts({ action: 'create_students', group_id: g.id, count: Number(new FormData(ev.target).get('count')) });
          showCredentials(`Nové účty – ${r.group}`, r.accounts, r.group);
          renderAccess();
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Vygenerovat'; }
      };
    });
  }

  function newAdminDialog() {
    dialog(`<h2>Nový admin</h2>
      <form id="adminForm">
        <div class="form-row">
          <label class="field">Přihlašovací jméno<input name="username" required pattern="[a-z0-9._-]{2,40}" placeholder="např. ondra"></label>
          <label class="field">Zobrazované jméno<input name="display_name" maxlength="80" placeholder="např. Ondra"></label>
        </div>
        <p class="lead" style="margin-top:10px">Malá písmena bez diakritiky, číslice, tečka nebo pomlčka. Heslo se vygeneruje a zobrazí jen jednou.</p>
        <div class="dlg-actions"><button type="button" class="btn" data-close>Zrušit</button><button class="btn accent" id="adminBtn">Vytvořit</button></div>
      </form>`, d => {
      d.querySelector('#adminForm').onsubmit = async ev => {
        ev.preventDefault();
        const f = new FormData(ev.target), btn = d.querySelector('#adminBtn'); btn.disabled = true;
        try {
          const r = await accounts({ action: 'create_admin', username: f.get('username'), display_name: f.get('display_name') });
          showCredentials('Účet admina vytvořen', [r], null); renderAccess();
        } catch (e) { toast(e.message, true); btn.disabled = false; }
      };
    });
  }

  function showCredentials(title, list, groupName) {
    dialog(`<h2>${esc(title)}</h2>
      <p class="note">Hesla se zobrazují <b>jen teď</b>. Po zavření okna je už nepůjde zobrazit, jen nahradit novými.</p>
      <div class="pwlist"><table class="list"><thead><tr><th>Přihlašovací jméno</th><th>Heslo</th></tr></thead><tbody>
        ${list.map(a => `<tr><td class="mono">${esc(a.username)}</td><td class="mono">${esc(a.password)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="dlg-actions">
        <button class="btn" id="csvBtn">↓ Stáhnout CSV</button>
        <button class="btn" id="printBtn">⎙ Tisk lístečků</button>
        <button class="btn accent" id="doneBtn">Mám uloženo, zavřít</button>
      </div>`, d => {
      d.oncancel = ev => { if (!confirm('Opravdu zavřít? Hesla už znovu neuvidíte.')) ev.preventDefault(); };
      d.querySelector('#doneBtn').onclick = () => { if (confirm('Opravdu zavřít? Hesla už znovu neuvidíte.')) d.close(); };
      d.querySelector('#csvBtn').onclick = () => {
        const rows = [['jmeno', 'heslo', 'adresa'], ...list.map(a => [a.username, a.password, cfg.readerUrl])];
        const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = 'regulaquest-ucty' + (groupName ? '-' + groupName.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-') : '') + '.csv';
        a.click(); URL.revokeObjectURL(a.href);
      };
      d.querySelector('#printBtn').onclick = () => printSlips(list);
    });
  }

  function qrSvg(text) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  function printSlips(list) {
    const host = cfg.readerUrl.replace(/^https?:\/\//, '');
    const qr = qrSvg(cfg.readerUrl);
    $('#tisk').innerHTML = `<div class="slips">${list.map(a => `
      <div class="slip"><div class="qr">${qr}</div><div>
        <h3>RegulaQuest – výukové prostředí pro práci s legislativou</h3>
        <p>Adresa: <b>${esc(host)}</b></p>
        <p>Jméno: <span class="cred">${esc(a.username)}</span></p>
        <p>Heslo: <span class="cred">${esc(a.password)}</span></p>
        <p style="font-size:8pt">Přístup je osobní. Nesdílejte ho. FBMI ČVUT</p>
      </div></div>`).join('')}</div>`;
    window.print();
    setTimeout(() => { $('#tisk').innerHTML = ''; }, 1000);
  }

  window.RQAccess = {
    init(r) { rq = r; client = r.client; cfg = r.cfg; esc = r.esc; },
    render() { renderAccess().catch(e => toast(e.message, true)); },
  };
})();
