/* Připomínky studentů a souhrnné měření využívání.
   Připomínka se ukládá bez vazby na účet. Využívání: jen čas (když je karta otevřená a student je aktivní),
   počet návštěv, co se otevírá a co se hledá – Studio z toho ukazuje výhradně souhrny. */

/* ---------- připomínky ---------- */
const FB_KINDS = [['error', 'Chyba'], ['unclear', 'Nejasnost'], ['idea', 'Návrh']];
function fbBtn(kind, id, ref, label){
  return `<button type="button" class="fb-btn" data-fb="${kind}" data-fb-id="${esc(id || '')}" data-fb-ref="${esc(ref || '')}" data-fb-label="${esc(label || '')}" title="Nahlásit chybu, nejasnost nebo návrh redakci">⚑ Nahlásit chybu / nejasnost</button>`;
}
function fbOpen(t){
  document.getElementById('fbDlg')?.remove();
  const box = document.createElement('div'); box.id = 'fbDlg'; box.className = 'fb-overlay';
  box.innerHTML = `<form class="fb-dlg" role="dialog" aria-modal="true" aria-labelledby="fbH">
    <h2 id="fbH">Připomínka pro redakci</h2>
    <div class="fb-target">${esc(t.label || 'Obecná připomínka')}</div>
    <div class="fb-kinds">${FB_KINDS.map(([k, n], i) => `<label><input type="radio" name="fbk" value="${k}"${i === 1 ? ' checked' : ''}> ${n}</label>`).join('')}</div>
    <label class="sr" for="fbText">Text připomínky</label>
    <textarea id="fbText" rows="5" maxlength="2000" placeholder="Co je špatně nebo nejasné? Např. „V bodě 3 chybí odkaz na přílohu VIII“ nebo „Nerozumím, co znamená…“" required></textarea>
    <p class="fb-note">Připomínka se odesílá <b>bez vašeho jména a účtu</b> – prosím nepodepisujte se a nepište osobní údaje.</p>
    <div class="fb-actions"><button type="button" class="btn" id="fbCancel">Zrušit</button><button type="submit" class="btn acc" id="fbSend">Odeslat</button></div></form>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.addEventListener('click', e => { if (e.target === box) close(); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  box.querySelector('#fbCancel').onclick = close;
  box.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const msg = box.querySelector('#fbText').value.trim(); if (msg.length < 3) { toast('Napište prosím alespoň pár slov.'); return; }
    const btn = box.querySelector('#fbSend'); btn.disabled = true;
    try {
      const { error } = await RQ.client.rpc('rq_send_feedback', { p_kind: box.querySelector('[name=fbk]:checked').value, p_target_kind: t.kind,
        p_target_id: t.id || '', p_target_ref: t.ref || '', p_label: t.label || '', p_message: msg });
      if (error) throw new Error(error.message);
      close(); toast('Děkujeme, připomínka je u redakce.');
    } catch (err) { btn.disabled = false; toast('Připomínku se nepodařilo odeslat: ' + (RQ.czError ? RQ.czError(err) : err.message)); }
  };
  box.querySelector('#fbText').focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fb]'); if (!b) return;
  e.preventDefault();
  const t = { kind: b.dataset.fb, id: b.dataset.fbId, ref: b.dataset.fbRef, label: b.dataset.fbLabel };
  if (t.kind === 'slide' && typeof PR !== 'undefined') {        // snímek se může měnit bez překreslení (celá obrazovka)
    const full = PR.cache.get(PR.id), i = full ? full.slides.findIndex(s => s.id === PR.slide) : -1;
    t.id = PR.slide || ''; t.ref = PR.id; t.label = full ? `${full.title} · snímek ${i + 1}${full.slides[i]?.data?.title ? ' – ' + full.slides[i].data.title : ''}` : t.label;
    if (document.fullscreenElement) document.exitFullscreen();
  }
  fbOpen(t);
});

/* ---------- využívání (souhrnně) ---------- */
const UT = { sec: 0, views: [], search: [], visit: false, last: Date.now(), lastKey: '', idleSince: 0 };
const UT_TICK = 15, UT_IDLE = 3 * 60e3, UT_NEWVISIT = 30 * 60e3;
(function(){
  try { if (!sessionStorage.getItem('rq-navsteva')) { UT.visit = true; sessionStorage.setItem('rq-navsteva', '1'); } } catch { UT.visit = true; }
  const act = () => { const now = Date.now(); if (now - UT.last > UT_NEWVISIT) UT.visit = true; UT.last = now; };
  ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, act, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') act(); else utFlush(); });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - UT.last < UT_IDLE) UT.sec += UT_TICK; }, UT_TICK * 1000);
  setInterval(utFlush, 60e3);
})();
function utFlush(){
  if (document.visibilityState !== 'visible') utSearchDone();
  if (typeof RQ === 'undefined' || !RQ.client || !S.me) return;
  if (!UT.sec && !UT.visit && !UT.views.length && !UT.search.length) return;
  const b = { p_seconds: Math.min(UT.sec, 180), p_visit: UT.visit, p_views: UT.views.splice(0, 50), p_search: UT.search.splice(0, 20) };
  UT.sec = Math.max(0, UT.sec - 180); UT.visit = false;
  RQ.client.rpc('rq_track', b).then(() => {}, () => {});
}
// Volá se po každém přechodu ve čtečce
function trackRoute(){
  const v = S.view; let k = null, id = null;
  if (v === 'unit') { k = 'unit'; id = S.unitId; }
  else if (v === 'doc') { k = 'doc'; id = S.docId; }
  else if (v === 'pres') { k = 'pres'; id = PR.id; }
  else if (v === 'case') { k = 'case'; id = S.caseId; }
  else if (v === 'path') { k = 'path'; id = S.path?.p?.id; if (S.unitId) UT.views.push({ kind: 'unit', id: S.unitId }); }
  else { k = 'page'; id = v; }
  const key = k + ':' + id; if (!id || key === UT.lastKey) return;
  UT.lastKey = key; UT.views.push({ kind: k, id });
  if (UT.views.length > 40) utFlush();
}
// Hledání se píše průběžně – zaznamená se až výraz, u kterého se student na 3 s zastavil (ne každé písmeno)
let utSearchT = null, utSearchQ = null;
function trackSearch(q, hits){
  q = (q || '').trim(); clearTimeout(utSearchT); if (q.length < 2) return;
  utSearchQ = { q, hits }; utSearchT = setTimeout(utSearchDone, 3000);
}
function utSearchDone(){ clearTimeout(utSearchT); if (utSearchQ) UT.search.push(utSearchQ); utSearchQ = null; }
