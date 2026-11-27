'use strict';
/* RegulaQuest – nápověda ke čtečce (boční panel). Otevírá se u části, kde student právě je. */
window.RQReaderHelp = (function () {
  const S = [
    ['home', 'Přehled', `<p>Úvodní stránka: kdy byl obsah naposledy aktualizován, kde jste skončili, rozpracovaná trasa, doporučené a vaše dokumenty a záložky. Hvězdičkou ☆ si dokument připnete na Přehled.</p>`],
    ['docs', 'Dokumenty a čtení', `<p><b>Dokumenty</b> ukazují všechny předpisy a metodiky. Po otevření se v levém panelu rozbalí osnova; přepínačem <b>CS / EN</b> přejdete na stejné místo v druhém jazyce. Výběrem <b>Jen:</b> zúžíte osnovu na ustanovení se štítkem (např. Dovozce, Třída III). Značka <b>NOVÉ</b> = změna v poslední aktualizaci.</p>
      <p>Vpravo jsou <b>Souvislosti</b>: upozornění, výklady redakce, metodiky (MDCG), odkazy a příklady. Klepnutím na kartu se v textu ukáže jen to místo, ke kterému patří.</p>`],
    ['finder', 'Najít předpisy a průvodce', `<p><b>Najít předpisy</b> pomůže, když nevíte, který dokument hledat. Vyberte oblast (např. zdravotnické prostředky, metrologie), koho se to týká a další vlastnosti – výsledky se ukážou hned: dokumenty seřazené podle shody (s důvodem, proč se ukazují), konkrétní ustanovení a trasy. Zvlášť jsou uvedené předpisy, které platí jen ve <b>specifických situacích</b>, s vysvětlením kdy. Volby lze kombinovat; odkaz na výsledek můžete zkopírovat a poslat.</p>
      <p><b>Průvodce otázkami</b> je pro situaci, kdy máte konkrétní problém („firma chce dovážet tlakoměr“). Odpovíte na několik otázek, další otázky se přizpůsobí předchozím odpovědím a na konci se otevře vyhledávač s předvyplněným výběrem, který můžete dál upravit.</p>
      <p>Výsledky jsou tak dobré, jak podrobně redakce dokumenty zařadila a oštítkovala – berte je jako rozcestník, ne jako úplný právní rozbor.</p>`],
    ['marks', 'Záložky', `<p>U ustanovení klepněte na <b>Přidat záložku</b> a napište krátký popisek. Záložky a místo, kde jste naposledy četli, se ukládají k vašemu účtu – uvidíte je na každém zařízení. Nikdo jiný je nevidí.</p>`],
    ['layers', 'Značky v textu', `<ul><li><span class="rq-hl hl-key">žlutě</span> klíčová pasáž · <span class="rq-hl hl-duty">zeleně</span> povinnost · <span class="rq-hl hl-deadline">fialově</span> lhůta / číslo · <span class="rq-hl hl-exception">růžově</span> výjimka / podmínka</li>
      <li><span class="rq-anc">tečkovaně podtržené</span> + ikonka = poznámka redakce (oranžově = pozor); klepnutím se rozbalí pod řádkem</li>
      <li><span class="rq-anc link">plně tyrkysově</span> + řetízek = odkaz na jiné ustanovení</li>
      <li><span class="rq-term">šedě podtržené</span> = pojem s definicí</li>
      <li><mark>modře</mark> = hledaný výraz</li></ul>
      <p>Nad textem v řádku <b>Zobrazit</b> si jednotlivé vrstvy zapnete nebo vypnete (pamatuje si to váš prohlížeč).</p>`],
    ['paths', 'Trasy', `<p>Trasa vás provede několika místy v daném pořadí s komentářem redakce. Tlačítky <b>Zpět / Další krok</b> se posouváte, prošlé kroky se ukládají k účtu (✓).</p>`],
    ['terms', 'Pojmy', `<p>Slovník definic z definičních článků (čl. 2 MDR…) česky i anglicky, s odkazem na přesné místo v předpisu.</p>`],
    ['news', 'Co je nového', `<p>Přehled aktualizací obsahu: shrnutí od redakce a seznam změněných ustanovení, nových výkladů, vazeb a tras.</p>`],
    ['search', 'Hledání', `<p>Pole nahoře hledá ve všech dokumentech – v textech, výkladech redakce i pojmech. Nezáleží na diakritice. Po otevření výsledku je hledaný výraz v textu zvýrazněný.</p>`],
  ];
  const VIEW = { home: 'home', docs: 'docs', doc: 'docs', unit: 'docs', path: 'paths', paths: 'paths', terms: 'terms', marks: 'marks', news: 'news', search: 'search', finder: 'finder', guide: 'finder' };
  function open(view) {
    let el = document.getElementById('rqHelp');
    if (!el) {
      el = document.createElement('aside'); el.id = 'rqHelp'; el.className = 'help-drawer'; el.setAttribute('aria-label', 'Nápověda');
      el.innerHTML = `<div class="help-head"><strong>Jak čtečka funguje</strong><button type="button" id="rqHelpClose">Zavřít ✕</button></div>
        <nav class="help-toc">${S.map(([k, t]) => `<button type="button" data-h="${k}">${t}</button>`).join('')}</nav>
        <div class="help-body">${S.map(([k, t, h]) => `<section id="help-${k}"><h3>${t}</h3>${h}</section>`).join('')}
         <section><h3>Upozornění</h3><p>Výklady připravuje redakce pro výuku; nejsou právním stanoviskem. Rozhodující je vždy oficiální znění předpisu. Čtečka je určena hlavně pro počítač; na telefonu se panely přepínají dole.</p></section></div>`;
      document.body.appendChild(el);
      el.querySelector('#rqHelpClose').onclick = close;
      el.querySelectorAll('[data-h]').forEach(b => b.onclick = () => go(b.dataset.h));
      document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }
    el.classList.add('open'); document.getElementById('helpBtn')?.setAttribute('aria-expanded', 'true');
    go(VIEW[view] || 'home');
  }
  function go(k) {
    const el = document.getElementById('rqHelp'), s = el.querySelector('#help-' + k), body = el.querySelector('.help-body');
    el.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', b.dataset.h === k));
    if (s) body.scrollTop = s.offsetTop - body.offsetTop;
  }
  function close() { document.getElementById('rqHelp')?.classList.remove('open'); document.getElementById('helpBtn')?.setAttribute('aria-expanded', 'false'); }
  return { open, close };
})();
