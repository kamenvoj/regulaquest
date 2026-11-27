'use strict';
/* RegulaQuest – nápověda ke čtečce (boční panel). Otevírá se u části, kde student právě je. */
window.RQReaderHelp = (function () {
  const S = [
    ['home', 'Přehled', `<p>Úvodní stránka: kdy byl obsah naposledy aktualizován, kde jste skončili, rozpracovaná trasa, rozcestník <b>Nevíte, který předpis hledat?</b> (průvodce otázkami a Najít předpisy), nejnovější aktuality, doporučené a vaše dokumenty a záložky. Hvězdičkou ☆ si dokument připnete na Přehled.</p>
      <p>V levém panelu najdete i <b>Prezentace</b> z přednášek, <b>Řešené případy</b>, <b>Aktuality</b> z úřadů a <b>Odkazy</b> na užitečné weby. Při čtení dokumentu se panel zúží na ikony – název ukáže najetí myší.</p>`],
    ['docs', 'Dokumenty a čtení', `<p><b>Dokumenty</b> ukazují všechny předpisy a metodiky. Po otevření se navigace vlevo zúží na pruh ikon (název ukáže najetí myší, tlačítko » ji rozbalí s popisky) a vedle ní se otevře osnova dokumentu; skrýt ji můžete tlačítkem « (zpět ikonou osnovy v pruhu). Přepínačem <b>CS / EN</b> přejdete na stejné místo v druhém jazyce. Výběrem <b>Jen:</b> zúžíte osnovu na ustanovení se štítkem (např. Dovozce, Třída III). Značka <b>NOVÉ</b> = změna v poslední aktualizaci.</p>
      <p>Vpravo jsou <b>Souvislosti</b>: upozornění, výklady redakce, metodiky (MDCG), odkazy a příklady. Klepnutím na kartu se v textu ukáže jen to místo, ke kterému patří.</p>`],
    ['finder', 'Najít předpisy a průvodce', `<p><b>Najít předpisy</b> pomůže, když nevíte, který dokument hledat. Vyberte oblast (např. zdravotnické prostředky, metrologie), koho se to týká a další vlastnosti – výsledky se ukážou hned: dokumenty seřazené podle shody (s důvodem, proč se ukazují), konkrétní ustanovení a trasy. Zvlášť jsou uvedené předpisy, které platí jen ve <b>specifických situacích</b>, s vysvětlením kdy. Volby lze kombinovat; odkaz na výsledek můžete zkopírovat a poslat.</p>
      <p><b>Průvodce otázkami</b> je pro situaci, kdy máte konkrétní problém („firma chce dovážet tlakoměr“). Odpovíte na několik otázek, další otázky se přizpůsobí předchozím odpovědím a na konci se otevře vyhledávač s předvyplněným výběrem, který můžete dál upravit.</p>
      <p>Výsledky jsou tak dobré, jak podrobně redakce dokumenty zařadila a oštítkovala – berte je jako rozcestník, ne jako úplný právní rozbor.</p>`],
    ['prlist', 'Prezentace', `<p>Prezentace z přednášek zpřístupněné vaší skupině. Listujete šipkami (nebo klávesami ← →), <b>F</b> nebo tlačítko přepne na celou obrazovku, <b>Přehled snímků</b> ukáže všechny snímky najednou. Podtržené části snímku jsou odkazy: na ustanovení předpisu (vrátíte se lištou „Zpět na prezentaci“) nebo na jiný snímek (vrátíte se „Zpět na snímek“). U ustanovení najdete v Souvislostech, ve kterých prezentacích se o něm mluví.</p>`],
    ['cases', 'Řešené případy', `<p>Konkrétní situace rozebrané krok za krokem (např. klasifikace aplikace). U kroku tlačítko <b>Číst v předpisu</b> otevře ustanovení, o které se krok opírá; lištou nahoře se vrátíte zpět na případ. U ustanovení najdete odkaz na případy v Souvislostech, případy se ukazují i ve výsledcích Najít předpisy.</p>`],
    ['links', 'Odkazy', `<p>Rozcestník webů, které se při práci s regulací hodí (úřady, databáze, legislativa, normy…). Filtrovat můžete podle kategorie a oblasti. Tlačítko <b>Otevřít ↗</b> otevře stránku v novém okně; celou adresu ukáže „Zobrazit adresu“.</p>`],
    ['updates', 'Aktuality', `<p>Novinky z úřadů a institucí (SÚKL, Evropská komise…), které redakce vybrala a okomentovala. Filtrovat můžete podle oblasti a zdroje, hledat a řadit. Odkaz otevře původní zdroj. Aktuality propojené s ustanovením uvidíte i v Souvislostech u něj; počet nových od vaší poslední návštěvy ukazuje navigace.</p>`],
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
  const VIEW = { home: 'home', docs: 'docs', doc: 'docs', unit: 'docs', path: 'paths', paths: 'paths', terms: 'terms', marks: 'marks', news: 'news', search: 'search', finder: 'finder', guide: 'finder', updates: 'updates', cases: 'cases', case: 'cases', links: 'links', prlist: 'prlist', pres: 'prlist' };
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
