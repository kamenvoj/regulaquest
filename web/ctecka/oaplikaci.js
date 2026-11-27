/* Stránka O aplikaci (#/o-aplikaci) */
function renderAbout(){
  $('#panelText').innerHTML = `<div class="about"><div class="eyebrow">O aplikaci</div><h1>RegulaQuest</h1>
    <p class="lead">RegulaQuest je výukové prostředí pro práci s právními předpisy a metodickými dokumenty v oblastech, které se vyučují na fakultě a jsou pro budoucí praxi studentů podstatné. Největší z nich je regulace zdravotnických prostředků. Pomáhá studentům se v regulaci zorientovat, porozumět souvislostem a naučit se v předpisech hledat.</p>

    <h2>Účel aplikace</h2>
    <p>Aplikace je určena především studentům Fakulty biomedicínského inženýrství ČVUT. Jejím cílem je, aby se studenti ve vyučované legislativě vyznali. Mají umět najít, co se na danou situaci vztahuje, a pochopit, jak spolu jednotlivé předpisy, normy a metodické pokyny souvisejí.</p>
    <p>Texty předpisů jsou doplněné výklady redakce, vazbami na související ustanovení a dokumenty a definicemi pojmů. Text je rozčleněný na jednotlivá ustanovení, takže se dá číst po částech, přepínat mezi jazykovými verzemi a ukládat si záložky.</p>
    <p>RegulaQuest navazuje na výuku a doplňuje ji. Při přednáškách a cvičeních pomáhá s prací s předpisy, při samostudiu umožňuje probranou látku zopakovat a prohloubit a vede studenty i k tématům, která výuka nestihne pokrýt do detailu. Nenahrazuje výuku ani samotné předpisy. Učí studenty v nich pracovat, aby to zvládli i samostatně v praxi.</p>

    <h2>Výukový obsah</h2>
    <ul>
      <li><b>Dokumenty:</b> zákony, nařízení, metodické pokyny a další dokumenty z vyučovaných oblastí, rozčleněné na jednotlivá ustanovení, u evropských předpisů v češtině i angličtině.</li>
      <li><b>Výklady a souvislosti:</b> komentáře redakce, povinnosti, lhůty, výjimky a vazby mezi ustanoveními a dokumenty.</li>
      <li><b>Najít předpisy a průvodce otázkami:</b> hledání podle oblasti, role subjektu a dalších vlastností situace, i pro situace, kdy student přesně neví, co hledá.</li>
      <li><b>Trasy:</b> postupný průchod několika místy předpisů k jednomu tématu.</li>
      <li><b>Řešené případy:</b> praktické situace řešené krok za krokem s odkazy na příslušná ustanovení.</li>
      <li><b>Prezentace:</b> podklady z výuky propojené s texty předpisů.</li>
      <li><b>Aktuality a užitečné odkazy:</b> novinky z úřadů a institucí a rozcestník důležitých webů (úřady, databáze a registry, zdroje legislativy).</li>
    </ul>

    <h2>Zdroje a závaznost textů</h2>
    <p>Texty předpisů vycházejí z oficiálních zdrojů, zejména z Úředního věstníku EU (EUR-Lex) a ze Sbírky zákonů (e-Sbírka), a z dokumentů zveřejněných příslušnými orgány a institucemi. U každého dokumentu je uvedeno, ke kterému znění se vztahuje, a odkaz na oficiální znění.</p>
    <p>Texty v aplikaci jsou informativní kopie. Právně závazné je vždy znění zveřejněné v Úředním věstníku EU, respektive ve Sbírce zákonů. Výklady redakce slouží k výuce, nejsou právním stanoviskem a nenahrazují posouzení konkrétní situace.</p>

    <h2>Využití umělé inteligence při vývoji</h2>
    <p>Aplikace RegulaQuest byla vyvíjena s podporou nástrojů generativní umělé inteligence, konkrétně ChatGPT (OpenAI) a Claude (Anthropic). Tyto nástroje pomáhaly s návrhem a programováním funkcí aplikace, s úpravami kódu a se zpracováním a strukturováním textů předpisů.</p>
    <p>Odbornou koncepci, výběr dokumentů, výklady, vazby mezi předpisy a kontrolu textů zajišťuje redakce. Každé ustanovení, které studenti vidí, redakce ověřila proti oficiálnímu znění. Umělá inteligence je podpůrný nástroj, ne náhrada odborného posouzení ani zdroj ověřených informací.</p>

    <h2>Upozornění a omezení</h2>
    <p>RegulaQuest slouží k výuce. Nenahrazuje oficiální znění předpisů, odbornou literaturu, metodické pokyny ani odborné posouzení konkrétní situace.</p>
    <p>Obsah se průběžně doplňuje a nemusí pokrývat všechny předpisy a jejich změny. Před použitím v praxi je vždy nutné ověřit aktuální znění a platnost dokumentu.</p>

    <h2>Připomínky a soukromí</h2>
    <p>Najdete-li chybu nebo nejasnost, pošlete ji redakci tlačítkem „Nahlásit chybu / nejasnost“. Připomínka se odesílá bez vašeho jména a účtu.</p>
    <p>Aby redakce věděla, co studentům pomáhá, aplikace zaznamenává souhrnné údaje o využívání: čas, návštěvy, co se otevírá a co se hledá. Redakce vidí jen souhrny za skupinu, nikdy přehled o jednotlivém účtu. Podrobnosti jsou v <a href="#" id="aboutHelp">Nápovědě</a>.</p>

    <h2>Institucionální zázemí</h2>
    <p>Aplikace je připravována jako výukový nástroj pro oblast regulace a legislativy ve zdravotnictví a souvisejících oborech na Fakultě biomedicínského inženýrství ČVUT v Praze.</p>
    <p>Další informace o fakultě: <a href="https://www.fbmi.cvut.cz" target="_blank" rel="noopener noreferrer">www.fbmi.cvut.cz</a></p>
    <div class="about-foot"><strong>Fakulta biomedicínského inženýrství ČVUT</strong><span>České vysoké učení technické v Praze</span></div></div>`;
  const h = $('#aboutHelp'); if (h) h.onclick = e => { e.preventDefault(); $('#helpBtn').click(); };
  document.title = 'O aplikaci · RegulaQuest';
}
