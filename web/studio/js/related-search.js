'use strict';
/* RegulaQuest – hledání souvislostí mezi dokumenty (přepis related_search.py).
   Není to jazykový model: 1) shodné číslo klasifikačního pravidla (předpis ↔ metodika),
   2) shoda odborných pojmů z malého česko-anglického slovníku a výrazných slov.
   Výsledky jsou jen kandidáti; každá vazba se ukládá jako návrh ke schválení. */
(function () {
  // Slovník: hledací tvary, ne tvrzení o právní rovnocennosti.
  const CONCEPTS = {
    software: ['software', 'softwar', 'programove vybaveni', 'mdsw'],
    classification: ['classification', 'klasifikac', 'trida rizika', 'risk class'],
    'clinical-evaluation': ['clinical evaluation', 'klinick hodnocen', 'klinicke hodnoceni'],
    'clinical-investigation': ['clinical investigation', 'klinick zkousk', 'klinicke zkouseni'],
    conformity: ['conformity assessment', 'posuzovan shod', 'posouzeni shody'],
    surveillance: ['post market surveillance', 'post-market surveillance', 'dohled nad trhem', 'dozor nad trhem', 'pms'],
    'clinical-followup': ['post-market clinical follow-up', 'pmcf', 'nasledne klinicke sledovani'],
    vigilance: ['vigilance', 'nezadouci prihod', 'incident reporting', 'serious incident'],
    risk: ['rizik', ' risk', 'hazard'],
    diagnosis: ['diagnos', 'diagnost'],
    therapy: ['therap', 'terapeut', 'lecb', 'lecba'],
    monitoring: ['monitor', 'sledovan fyziologick', 'sledovani fyziologick'],
    physiology: ['physiolog', 'fyziolog'],
    vital: ['vital', 'zivotne dulezit'],
    implant: ['implanta', 'implant'],
    invasive: ['invasive', 'invaziv'],
    'non-invasive': ['non-invasive', 'neinvaziv'],
    active: ['active devices', 'aktivn prostred', 'active medical'],
    manufacturer: ['manufactur', 'vyrobc'],
    'notified-body': ['notified bod', 'oznamen subjekt', 'notifikovan osob'],
    sterilization: ['steril', 'steriliz'],
    disinfection: ['disinfect', 'dezinf'],
    radiation: ['radiation', 'zareni'],
    ionizing: ['ionizing', 'ionising', 'ionizuj'],
    measuring: ['measurement', 'measuring', 'meric', 'mereni'],
    nanomaterial: ['nanomaterial'],
    'human-tissue': ['human tissues', 'lidsk tkane', 'human cells'],
    'animal-tissue': ['animal tissues', 'zvirec tkane'],
    substance: ['substances', 'latk', 'substance-based'],
    'medicinal-product': ['medicinal product', 'lecivy pripravek'],
    blood: ['blood', 'krev', 'krevni'],
    heart: ['heart', 'srdc', 'kardio'],
    'contact-lenses': ['contact lenses', 'kontaktni cock'],
    wound: ['wound', 'rany', 'ranu', 'ranach', 'poraneni', 'poranen kuze'],
    surgery: ['surgical', 'chirurg'],
    duration: ['continuous use', 'long term', 'short term', 'dlouhodob', 'kratkodob', 'doba pouzivani'],
  };
  const DISTINCTIVE = new Set(['software', 'clinical-evaluation', 'clinical-investigation', 'clinical-followup', 'conformity', 'surveillance',
    'vigilance', 'implant', 'sterilization', 'disinfection', 'radiation', 'ionizing', 'nanomaterial', 'animal-tissue', 'human-tissue', 'blood',
    'contact-lenses', 'wound', 'medicinal-product', 'measuring', 'notified-body', 'invasive']);
  const LIGHT = new Set(['manufacturer', 'risk', 'therapy', 'diagnosis', 'surgery', 'substance', 'classification']);
  const HEAVY = new Set(['software', 'clinical-evaluation', 'clinical-followup', 'conformity', 'vigilance', 'implant', 'sterilization', 'nanomaterial']);
  const STOP = new Set(('a i v z s u na pro pri podle nad pod nebo ale je jsou jako ktere ktery ktera vy se o do od the and of to for in with on or as by from an is are be it its this that which such may all under while more than where shall including include device devices medical product products regulation class rules rule section article annex chapter of eu their will must can a specific use used when based intended purpose applicable apply according part parts one some by as this they more may other between these those manufacturer means medical '
    + 'musi byt ktere jsou jejich tohoto tento tuto take jsou zarizeni prostredku prostredky zdravotnickych zdravotnicky vyrobce vyrobci clanek clanku pravidlo priloha bod cast odstavec odstavce ve vyse nasledujici uvedene').split(' '));

  const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[–—]/g, '-').replace(/ /g, ' ');
  const cache = new Map();
  function features(u) {
    const key = u.id + '|' + (u.updated_at || '');
    if (cache.has(key)) return cache.get(key);
    const t = ' ' + fold(u.body).replace(/[^a-z0-9-]+/g, ' ') + ' ';
    const terms = new Map();
    for (const w of t.match(/[a-z][a-z0-9]{2,}/g) || []) if (!STOP.has(w) && !/^\d+$/.test(w)) terms.set(w, (terms.get(w) || 0) + 1);
    // tvar pojmu musí začínat na začátku slova (jinak „ran“ najde i „transfer“)
    const concepts = new Set(Object.entries(CONCEPTS).filter(([, vs]) => vs.some(v => t.includes(' ' + fold(v).trim()))).map(([k]) => k));
    const f = { terms, concepts };
    cache.set(key, f);
    return f;
  }
  const ruleNo = u => { const m = /-rule-(\d+)$/.exec(u.id) || /\b(?:rule|pravidlo)\s+(\d+)\b/i.exec(u.label || ''); return u.kind === 'rule' && m ? +m[1] : null; };
  const isLaw = d => ['regulation', 'directive', 'law', 'decree'].includes(d?.document_type) || /předpis/i.test(d?.kind || '');
  const isGuide = d => d?.document_type === 'guidance' || /metodick/i.test(d?.kind || '');

  function lexical(src, tgt) {
    const a = features(src), b = features(tgt);
    const common = [...a.concepts].filter(c => b.concepts.has(c)).sort();
    const shared = [...a.terms.keys()].filter(w => b.terms.has(w) && w.length >= 5);
    const strength = shared.reduce((s, w) => s + Math.min(a.terms.get(w), 2), 0) / Math.max(1, [...a.terms.values()].reduce((s, v) => s + Math.min(v, 2), 0));
    const score = common.reduce((s, c) => s + (HEAVY.has(c) ? 2 : LIGHT.has(c) ? 0.4 : 1), 0) * 2 + strength * 10;
    shared.sort((x, y) => Math.min(b.terms.get(y), a.terms.get(y)) - Math.min(b.terms.get(x), a.terms.get(x)) || x.localeCompare(y));
    return { score, common, shared: shared.slice(0, 9) };
  }
  // Jen „listy“: rodič, jehož text se opakuje v potomcích, by dával zdvojené návrhy.
  function leaves(units) {
    const live = units.filter(u => !u.editor_archived && String(u.body || '').trim());
    const parents = new Set(live.map(u => u.parent_id).filter(Boolean));
    return live.filter(u => !parents.has(u.id) || u.kind === 'section');
  }

  function related(source, targets, relations, docs, limit = 20) {
    if (!String(source.body || '').trim()) return [];
    const sd = docs.get(source.document_id), existing = new Map(relations.filter(r => !['rejected', 'archived'].includes(r.status)).map(r => [r.source_id + '>' + r.target_id, r.status]));
    const out = [];
    for (const t of targets) {
      if (t.document_id === source.document_id || t.id === source.id) continue;
      const td = docs.get(t.document_id);
      const pair = (isLaw(sd) && isGuide(td)) || (isGuide(sd) && isLaw(td));
      const structural = pair && ruleNo(source) !== null && ruleNo(source) === ruleNo(t);
      // u pravidla předpisu porovnávat v metodice jen pravidla
      if (pair && ruleNo(source) !== null && isGuide(td) && t.kind !== 'rule') continue;
      const { score, common, shared } = lexical(source, t);
      const strong = common.some(c => DISTINCTIVE.has(c));
      if (!structural && !(score >= 5 && (strong || shared.length >= 6) && (common.length >= 2 || shared.length >= 6))) continue;
      const type = isLaw(sd) && isGuide(td) ? 'guidance' : 'related';
      const why = structural
        ? `Shodné číslo klasifikačního pravidla ${ruleNo(source)} v předpisu a v metodice. Strukturální kandidát; obsah a rozsah výkladu musí potvrdit redakce.`
        : 'Shoda odborných pojmů nebo výrazů (malý česko-anglický slovník); sama o sobě neprokazuje metodický vztah.';
      const warn = [];
      if (source.text_status !== 'verified') warn.push('zdroj neověřen');
      if (t.text_status !== 'verified') warn.push('cíl neověřen');
      const loc = (u, d) => `${d ? d.family + ' ' + d.language.toUpperCase() : u.document_id}, ${u.locator || u.label}`;
      out.push({ source_id: source.id, target_id: t.id, structural, type, why, common: common.slice(0, 8), shared, warn,
                 existing: existing.get(source.id + '>' + t.id) || null,
                 evidence: `${loc(source, sd)}; ${loc(t, td)}. Před schválením porovnejte obě ustanovení s oficiálními originály.`,
                 rank: (structural ? 1000 : 0) + score });
    }
    return out.sort((a, b) => b.rank - a.rank || a.target_id.localeCompare(b.target_id)).slice(0, limit);
  }

  // Celý dokument: u každé části pravidlo se shodným číslem + nejvýš perSource dalších kandidátů.
  function bulk(sources, targets, relations, docs, perSource = 3) {
    const tl = leaves(targets), res = [];
    for (const s of leaves(sources)) {
      const c = related(s, tl, relations, docs, perSource + 25);
      res.push(...c.filter(x => x.structural), ...c.filter(x => !x.structural).slice(0, perSource));
    }
    return res.sort((a, b) => (b.structural - a.structural) || (!!a.existing - !!b.existing) || b.rank - a.rank);
  }

  window.RQRelated = { related, bulk };
})();
