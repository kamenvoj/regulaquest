'use strict';
/* RegulaQuest Studio – nápověda v postranním panelu. Otevírá se u části, ve které právě pracujete. */
window.RQHelp = (function () {
  const S = [
    ['home', 'Přehled Studia', `<p>Úvodní stránka: stav dokumentů, kolik je ověřeno a co čeká na kontrolu. <b>Pokračovat</b> otevře ustanovení, na kterém jste naposledy pracoval(a) (pamatuje si to tento prohlížeč).</p>
      <p><b>Výuka</b> shrnuje ostatní části: nové aktuality k přečtení, prezentace (kolik je připravených a které brzy uvidí studenti), rozpracované řešené případy a koncepty odkazů, a kolik úprav od poslední publikace studenti ještě nevidí. Klepnutím na název přejdete na danou stránku. <b>Rychlé cesty</b> vedou na nejčastější stránky.</p>
      <p><b>Poslední aktivita</b> ukazuje, kdo co naposledy udělal (komentáře, vazby, úpravy textu, případy, prezentace, zveřejněné aktuality a odkazy) – skládá se z historie, kterou Studio vede tak jako tak.</p>
      <p>Horní lišta: <b>⟳ Obnovit</b> načte změny druhého admina (Studio se samo neobnovuje), <b>Pohled studenta</b> otevře čtečku tak, jak ji vidí studenti (jen publikovaný obsah), <b>Odhlásit</b>.</p>`],
    ['documents', 'Katalog zdrojů', `<p>Seznam dokumentů (předpisy, metodiky). <b>Upravit údaje a tagy</b>: název, verze, vydavatel, oficiální URL, druh dokumentu – a dole <b>Archivovat</b> (skryje, lze obnovit na úvodní stránce) nebo <b>Smazat trvale</b> (jen omyl: nepublikovaný dokument bez schváleného obsahu).</p>
      <p><b>↧ Import dokumentu</b>: HTML z EUR-Lex (CS/EN) nebo PDF metodiky. Při importu nového znění se změněné části označí, jejich ověření se zruší a chybějící se archivují; komentáře a vazby zůstanou.</p>`],
    ['library', 'Práce s dokumentem', `<p>Vlevo osnova, uprostřed text ustanovení, vpravo vazby a komentáře.</p>
      <p><b>Lišta pod textem</b> (zůstává viditelná): Editor textu a tabulek, Struktura, Rozdělit / Přesunout / Sloučit, Historie změn, Pojmy z definic (jen u definičního článku), ⇢ Do trasy. Text po úpravě je nutné znovu <b>ověřit</b> proti originálu – studenti vidí jen ověřený text.</p>
      <p><b>Štítky</b> pod nadpisem (+ Štítek): koho se ustanovení týká, třída rizika, typ prostředku… Štítek u článku platí i pro jeho odstavce a přenese se do druhé jazykové verze. Slovník štítků upravíte v nabídce „Spravovat štítky…“.</p>`],
    ['selection', 'Práce s vybraným textem', `<p>Označte myší slovo nebo větu – objeví se lišta:</p>
      <ul><li><b>Klíčové / Povinnost / Lhůta / Výjimka</b> – barevné zvýraznění (vrstvy), bez textu.</li>
      <li><b>Poznámka</b> – výklad k vybranému místu; <b>Pozor</b> – upozornění (oranžově).</li>
      <li><b>Propojit</b> – vazba z tohoto místa na jiné ustanovení (např. „čl. 17 odst. 5“).</li>
      <li><b>⇢ Do trasy</b> – krok trasy mířící přesně na toto místo.</li></ul>
      <p>Místo se pamatuje podle přesného znění. Když se po novém znění text změní, položka dostane štítek <b>Kotva nenalezena</b>.</p>`],
    ['layers', 'Značky, barvy a vrstvy', `<ul><li><span class="rq-hl hl-key">žlutá</span> klíčová pasáž · <span class="rq-hl hl-duty">zelená</span> povinnost · <span class="rq-hl hl-deadline">fialová</span> lhůta / číslo · <span class="rq-hl hl-exception">růžová</span> výjimka / podmínka</li>
      <li><span class="rq-anc">tečkovaně podtržené</span> + ikonka = poznámka (oranžově = pozor)</li>
      <li><span class="rq-anc link">plně tyrkysově</span> + řetízek = vazba z místa v textu</li>
      <li><span class="rq-term">šedě podtržené</span> = pojem z definic (klepnutím definice)</li>
      <li>Ikonka s číslem = více položek na jednom místě (pořadí: pozor → definice → výklad → příklad → odkazy).</li></ul>
      <p><b>Zobrazit:</b> nad textem zapnete / vypnete jednotlivé vrstvy – jen pro sebe. <b>Klepnutím na kartu vpravo</b> se v textu výrazně ukáže jen tato položka (tmavý rámeček), i když je její vrstva vypnutá; „Zobrazit vše ✕“ to zruší.</p>`],
    ['terms', 'Pojmy z definic', `<p>U definičního článku (čl. 2) tlačítko <b>Pojmy z definic</b>: načte body jako koncept a navrhne <b>vzory</b> pro vyhledání tvarů slova (<code>zdravotnick* prostred*</code>, hvězdička = libovolná koncovka). Počet výskytů pomůže najít příliš obecné pojmy – ty vyřaďte. Pojmy CS a EN se párují podle čísla bodu. Schválené pojmy se ve čtečce podtrhnou při prvním výskytu v každé části.</p>`],
    ['review', 'Ke kontrole', `<p>Schvalovací fronta: návrhy vazeb, koncepty komentářů a navržené změny schváleného obsahu. Do čtečky jde jen <b>schválené</b>. Dobrá praxe: co navrhl jeden admin, schvaluje druhý.</p>`],
    ['relations', 'Správa vazeb', `<p>Všechny vazby s filtrem podle stavu a dokumentu. Vazby se vytvářejí v Práci s dokumentem: <b>+ Propojit</b> (celé ustanovení), <b>Propojit</b> z vybraného textu, <b>✧ Návrhy</b> (výslovné odkazy nalezené v textu – ukotví se k citaci) a <b>◎ Souvislosti</b> (podobná místa v jiných dokumentech, např. MDR ↔ MDCG). Vazba vytvořená v jedné jazykové verzi se ukáže i v druhé.</p>`],
    ['comments', 'Správa komentářů', `<p>Všechny komentáře a zvýraznění s filtrem (koncepty, schválené, archivované, „originál změněn“ u převzatých překladů). Archivované jdou obnovit. Komentáře jsou pro každý jazyk zvlášť – u komentáře z druhé jazykové verze je <b>Převzít</b> (přeložit).</p>`],
    ['coverage', 'Pokrytí', `<p>Tabulka článků s tím, co už mají (ověřený text, štítky, výklad, zvýraznění, vazby, metodika, trasy). Zelená = hotovo, oranžová = rozpracováno. Filtry a „nejméně zpracované nahoře“ ukážou, kde pokračovat.</p>
      <p>V seznamu dokumentů nahoře jsou i <b>celé oblasti</b> (např. Zdravotnické prostředky – všechny dokumenty). S filtrem <b>Bez štítků</b> tak najdete, co v oblasti ještě chybí oštítkovat – na štítcích stojí vyhledávač Najít předpisy i průvodce otázkami.</p>`],
    ['guide', 'Vyhledávání a průvodce', `<p>Nastavení stránky <b>Najít předpisy</b> a <b>průvodce otázkami</b> ve čtečce. Nic z toho není napsané pro konkrétní obor – vše vychází z oblastí dokumentů a štítků ustanovení.</p>
      <p><b>Pole vyhledávače</b> = skupiny štítků. U každé určete, pro které oblasti platí (třída rizika jen u ZP); bez oblasti se ukazuje vždy. Nabízí se jen štítky použité u zveřejněných částí.</p>
      <p><b>Průvodce</b>: otázky v pořadí, každá odpověď může přidat oblasti a štítky. Otázka s oblastí se ukáže, jen když tu oblast přidala některá dřívější odpověď – tak se průvodce větví. Na konci se otevře vyhledávač s výběrem ze všech odpovědí. Vyzkoušejte v pracovním náhledu; studenti změny uvidí po publikaci.</p>
      <p>Kvalita výsledků stojí na tom, jak důsledně jsou dokumenty zařazené do oblastí (Údaje dokumentu → Oblasti) a ustanovení oštítkovaná (filtr <b>Bez štítků</b> v Pokrytí).</p>`],
    ['cases', 'Řešené případy', `<p>Konkrétní případ rozebraný krok za krokem (klasifikace aplikace, analýza rizik…). <b>+ Nový případ</b>: název, krátký popis, zadání, závěr, oblasti a štítky; po založení přidáte <b>kroky</b> – každý může odkazovat na ustanovení (hledání podle označení nebo nadpisu).</p>
      <p>Formát textu: odstavce oddělte prázdným řádkem, odrážky začněte „- “, tabulku zapište řádky „| buňka | buňka |“ (první řádek je záhlaví).</p>
      <p>S ustanovením propojíte případ i z textu dokumentu: pod nadpisem <b>+ Případ</b>. Ve čtečce se u propojených ustanovení (i u ustanovení z kroků) ukáže v Souvislostech jen odkaz. Studenti vidí případy ve stavu <b>Zveřejněný</b> po příští publikaci; v pracovním náhledu i koncepty.</p>`],
    ['pres', 'Prezentace', `<p><b>↧ Import z PowerPointu</b> převezme obsah (nadpisy, sekce, štítky, karty, pruhy, tabulky, klíčovou myšlenku a poznámky řečníka); vzhled dělá jednotná šablona aplikace, takže prezentace všech autorů vypadají stejně. Soubor se nikam nenahrává – rozbalí se v prohlížeči.</p>
      <p><b>Úpravy:</b> vlevo snímky, uprostřed náhled a pod ním formulář (řádek = odstavec, „- “ odrážka, **tučně**). <b>Odkaz</b> nastavíte klepnutím na část snímku v náhledu: na ustanovení, nebo na jiný snímek téže či jiné prezentace. Nezapomeňte <b>Uložit snímek</b>.</p>
      <p><b>Nová verze:</b> Údaje a zpřístupnění → Nahrát novou verzi. Snímky se spárují podle nadpisu a sekce, nevzniknou duplicity; odkazy se přenesou na stejné části a před nahráním uvidíte, co se změní a které odkazy se nepřenesou.</p>
      <p><b>Zpřístupnění:</b> stav „Připravená“ + zaškrtnutá skupina a datum, od kdy ji studenti uvidí. Poznámky řečníka studenti nikdy neuvidí. Odkazy ze snímků se u ustanovení ve čtečce ukážou samy („V prezentacích“); ručně lze snímek připojit i z textu dokumentu (+ Snímek).</p>`],
    ['links', 'Užitečné odkazy', `<p>Rozcestník webů pro studenty: úřady (SÚKL, ČMI), databáze (EUDAMED, NANDO), legislativa (EUR-Lex, e-Sbírka), normy, metodiky. U odkazu napište krátký popisek, k čemu stránka slouží, a zvolte kategorii (lze napsat i novou), případně oblasti a štítky. Pořadí v kategorii měníte šipkami.</p>
      <p>Studenti vidí <b>zveřejněné</b> odkazy hned (bez publikace) v záložce Odkazy; otevírají se v novém okně. Výchozí sada je připravená jako koncepty – zkontrolujte adresy a zveřejněte.</p>`],
    ['news', 'Aktuality', `<p>Novinky ze zdrojů (RSS – SÚKL, Evropská komise…) se načítají samy dvakrát denně; <b>⟳ Načíst nové</b> je načte hned. Zdroje bez RSS (EUDAMED, pokyny MDCG, MZ ČR) přidejte přes <b>+ Přidat ručně</b>.</p>
      <p>Postup: <b>Nové</b> → přečíst (klepnutím na název se otevře zdroj a položka se označí jako přečtená) → <b>Upravit</b> (komentář redakce pro studenty, oblasti, štítky, dokumenty) → <b>Zveřejnit</b>. Zveřejněné studenti vidí <b>hned</b> v záložce Aktuality, bez publikace obsahu. Nerelevantní <b>Zamítnout</b> (lze hromadně zaškrtnutím). Nevyřízené se po 90 dnech samy přesunou mezi zamítnuté, zamítnuté se po roce smažou.</p>
      <p>S ustanovením propojíte aktualitu přímo v textu dokumentu: pod nadpisem <b>+ Aktualita</b>. Studenti ji pak uvidí v Souvislostech u toho ustanovení.</p>`],
    ['paths', 'Trasy', `<p>Průchod několika místy v daném pořadí s komentářem ke každému kroku. Kroky přidáte z textu (<b>⇢ Do trasy</b>), pořadí šipkami, „+ Krok jen s textem“ pro úvod a shrnutí. Stav <b>Zveřejněná</b> = studenti trasu uvidí po příští publikaci (kroky na neověřená ustanovení se vynechají).</p>`],
    ['publish', 'Publikování', `<p>Studenti nevidí Studio, ale <b>publikaci</b> – pevný snímek ověřených textů a schválených položek. Po práci tedy vždy <b>⇪ Publikovat pro studenty</b>. Pracovní náhled ukáže i rozpracované věci (jen admini). Databáze se zálohuje každou noc; ruční záloha stáhne JSON.</p>`],
    ['access', 'Přístupy', `<p>Účty adminů a skupiny studentů (skupinový přístup bez osobních údajů). Hesla se nikde nezobrazují znovu – při vytvoření si je uložte.</p>`],
  ];
  const PAGE = { home: 'home', documents: 'documents', library: 'library', verified: 'library', review: 'review', relations: 'relations', comments: 'comments', coverage: 'coverage', paths: 'paths', guide: 'guide', news: 'news', cases: 'cases', links: 'links', pres: 'pres', publish: 'publish', access: 'access' };

  function open(section) {
    let el = document.getElementById('rqHelp');
    if (!el) {
      el = document.createElement('aside'); el.id = 'rqHelp'; el.className = 'help-drawer'; el.setAttribute('aria-label', 'Nápověda');
      el.innerHTML = `<div class="help-head"><strong>Nápověda</strong><button type="button" class="btn tiny" id="rqHelpClose">Zavřít ✕</button></div>
        <nav class="help-toc">${S.map(([k, t]) => `<button type="button" data-h="${k}">${t}</button>`).join('')}</nav>
        <div class="help-body">${S.map(([k, t, h]) => `<section id="help-${k}"><h3>${t}</h3>${h}</section>`).join('')}
         <section><h3>Čtečka pro studenty</h3><p>Studenti vidí ověřené texty, schválené komentáře, vazby, pojmy, štítky („Jen: …“ pod hledáním) a zveřejněné trasy (Osnova | Trasy). Vrstvy si přepínají sami; prošlé kroky tras si pamatuje jejich prohlížeč.</p></section></div>`;
      document.body.appendChild(el);
      el.querySelector('#rqHelpClose').onclick = close;
      el.querySelectorAll('[data-h]').forEach(b => b.onclick = () => go(b.dataset.h));
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open') && !document.querySelector('dialog[open]')) close(); });
    }
    el.classList.add('open'); document.body.classList.add('help-open');
    go(section || PAGE[typeof page === 'string' ? page : 'home'] || 'home');
  }
  function go(k) {
    const el = document.getElementById('rqHelp'), s = el.querySelector('#help-' + k);
    el.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', b.dataset.h === k));
    if (s) el.querySelector('.help-body').scrollTop = s.offsetTop - el.querySelector('.help-body').offsetTop;
  }
  function close() { document.getElementById('rqHelp')?.classList.remove('open'); document.body.classList.remove('help-open'); }
  return { open, close };
})();
document.addEventListener('click', e => { if (e.target.closest('#helpTop')) RQHelp.open(); });
