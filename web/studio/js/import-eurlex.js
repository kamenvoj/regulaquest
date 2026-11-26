'use strict';
/* RegulaQuest – převod konsolidovaného znění z EUR-Lexu (HTML) na části dokumentu.
   Přepis Python importu (eurlex_dom.py, importer.py): stejná pravidla, stejné kontroly úplnosti.
   Nic neověřuje: všechny texty přicházejí jako „Nutno ověřit“. */
(function () {
  // ---------------------------------------------------------------- strom HTML (jako Python HTMLParser)
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const RAW = new Set(['script','style']);
  let decoder = null;
  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    decoder = decoder || document.createElement('textarea');
    decoder.innerHTML = s.replace(/</g, '&lt;');
    return decoder.value;
  }
  function node(tag, attrs, parent) { return { tag, attrs, children: [], parent }; }
  const cls = (n, name) => typeof n !== 'string' && (' ' + (n.attrs.class || '') + ' ').includes(' ' + name + ' ');
  const direct = n => n.children.filter(c => typeof c !== 'string');
  function* elements(n) { for (const c of n.children) if (typeof c !== 'string') { yield c; yield* elements(c); } }
  const textOf = n => typeof n === 'string' ? n : n.children.map(textOf).join('');

  function parseTree(html) {
    const root = node('root', {}, null), stack = [root], byId = {};
    const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<\/([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
    const attrRe = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
    let last = 0, m;
    const text = s => { if (s) stack[stack.length - 1].children.push(decode(s)); };
    while ((m = re.exec(html))) {
      text(html.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) {                                   // koncová značka
        const tag = m[1].toLowerCase();
        for (let j = stack.length - 1; j > 0; j--) if (stack[j].tag === tag) { stack.length = j; break; }
      } else if (m[2]) {                            // počáteční značka
        const tag = m[2].toLowerCase(), attrs = {};
        let a; attrRe.lastIndex = 0;
        while ((a = attrRe.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
        const n = node(tag, attrs, stack[stack.length - 1]);
        stack[stack.length - 1].children.push(n);
        if (attrs.id) byId[attrs.id] = n;
        if (RAW.has(tag)) {                         // obsah skriptu a stylu se nečte
          const end = html.toLowerCase().indexOf('</' + tag, last);
          last = re.lastIndex = end < 0 ? html.length : end;
          continue;
        }
        if (!VOID.has(tag) && !m[4]) stack.push(n);
      }
    }
    text(html.slice(last));
    return { root, byId };
  }

  // ---------------------------------------------------------------- převod na text (render z eurlex_dom.py)
  const EDIT = /[►▼▶]\s*(?:M\d{1,2}|C\d{1,2}|B)\b|◄/gi;
  const MARK = /[►▼▶]\s*((?:M|C)\d{1,2})\b/gi;
  const SKIP = new Set(['script','style','noscript','head','svg']);
  const BLOCK = new Set(['p','div','table','tr','ul','ol','li','h1','h2','h3','h4','h5','h6','section']);
  const HEADS = new Set(['p','h1','h2','h3','h4','h5','h6']);

  function clean(s) {
    s = s.replace(EDIT, '').replace(/[  ]/g, ' ');
    s = s.replace(/[ \t\r\n]+/g, ' ');
    return s.replace(/\s+([,;:.])/g, '$1').trim();
  }
  const excluded = n => SKIP.has(n.tag) || cls(n, 'modref') || cls(n, 'arrow') || cls(n, 'separator') || cls(n, 'separator-annex');
  function inline(n) {
    if (typeof n === 'string') return n;
    if (excluded(n)) return '';
    if (n.tag === 'br') return '\n';
    return n.children.map(inline).join('');
  }
  function render(n, depth = 0) {
    if (typeof n === 'string') return clean(n);
    if (excluded(n) || n.tag === 'hr') return '';
    if (cls(n, 'grid-container') && cls(n, 'grid-list')) {
      const cells = direct(n);
      const label = cells.find(c => cls(c, 'grid-list-column-1'));
      const content = cells.find(c => cls(c, 'grid-list-column-2'));
      if (content) {
        const prefix = label ? clean(inline(label)) : '';
        const body = renderContainer(content, depth + 1);
        if (prefix && body) {
          const [first, ...rest] = body.split('\n');
          // Pokračování bodu (další věta, „který…“) odsadit pod text bodu, ne pod jeho číslo.
          const pad = '  '.repeat(depth + 1);
          return '  '.repeat(depth) + prefix + ' ' + first.replace(/^\s+/, '') +
            (rest.length ? '\n' + rest.map(l => /^\s/.test(l) ? l : pad + l).join('\n') : '');
        }
        return '  '.repeat(depth) + prefix + ' ' + body;
      }
    }
    if (n.tag === 'div' && cls(n, 'norm')) {
      const num = direct(n).find(c => cls(c, 'no-parag'));
      if (num) {
        const rest = renderContainer(n, depth, new Set([num]));
        return clean(inline(num)) + (rest ? ' ' + rest.replace(/^\s+/, '') : '');
      }
    }
    if (HEADS.has(n.tag) && !n.children.some(c => typeof c !== 'string' && BLOCK.has(c.tag))) return clean(inline(n));
    if (n.tag === 'tr') return direct(n).filter(c => c.tag === 'td' || c.tag === 'th').map(c => render(c, depth)).filter(Boolean).join(' ');
    return renderContainer(n, depth);
  }
  function renderContainer(n, depth = 0, exclude = new Set()) {
    const parts = [], text = [];
    const flush = () => { if (text.length) { const v = clean(text.join('')); if (v) parts.push(v); text.length = 0; } };
    for (const c of n.children) {
      if (exclude.has(c)) continue;
      if (typeof c === 'string') { text.push(c); continue; }
      if (excluded(c)) continue;
      if (BLOCK.has(c.tag)) { flush(); const v = render(c, depth); if (v) parts.push(v); }
      else text.push(inline(c));
    }
    flush();
    return parts.join('\n').trim();
  }
  function fullText(n) {
    if (typeof n === 'string') return n;
    if (excluded(n)) return '';
    return n.children.map(fullText).join('') + (BLOCK.has(n.tag) ? '\n' : '');
  }
  // Kontrola úplnosti: všechny znaky zdroje (bez mezer a značek změn) ve stejném pořadí.
  function audit(nodes, output) {
    const a = nodes.map(fullText).join('').replace(EDIT, '').replace(/\s+/g, '');
    const b = output.replace(/\s+/g, '');
    if (a === b) return { ok: true, coverage: 1 };
    const count = s => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1); return m; };
    const ca = count(a), cb = count(b); let common = 0;
    for (const [ch, k] of ca) common += Math.min(k, cb.get(ch) || 0);
    return { ok: false, coverage: a.length ? common / a.length : 1 };
  }
  const bodyOf = nodes => nodes.map(x => render(x)).filter(Boolean).join('\n\n').trim();
  const marksOf = n => [...new Set([...textOf(n).matchAll(MARK)].map(m => m[1].toUpperCase()))];
  function previousMarks(n) {
    if (!n.parent) return [];
    const sib = direct(n.parent), i = sib.indexOf(n);
    return i > 0 && cls(sib[i - 1], 'modref') ? marksOf(sib[i - 1]) : [];
  }
  function findTitle(n, selector) {
    for (const c of direct(n)) if (cls(c, selector) || cls(c, 'eli-title')) return clean(inline(c));
    return '';
  }
  function legend(tree) {
    const out = {};
    for (const tr of elements(tree.root)) {
      if (tr.tag !== 'tr') continue;
      const kids = direct(tr); if (!kids.length) continue;
      const mk = new RegExp(MARK.source, 'i').exec(textOf(kids[0])); if (!mk) continue;
      const label = mk[1].toUpperCase();
      const name = [...elements(tr)].find(x => x.tag === 'p' && (x.attrs.class || '').includes('title-fam-member'));
      if (!name) continue;
      const title = clean(textOf(name)); if (!title) continue;
      const a = [...elements(name)].find(x => x.tag === 'a' && x.attrs.href);
      let url = '';
      try {
        const u = new URL(a ? a.attrs.href : '', 'https://eur-lex.europa.eu/');
        if (u.protocol === 'https:' && u.host === 'eur-lex.europa.eu' && u.pathname.includes('/legal-content/')) url = u.href;
      } catch (_) { /* neplatný odkaz se nepřebírá */ }
      out[label] = { marker: label, title: title.slice(0, 350), kind: label.startsWith('C') ? 'corrigendum' : 'amending_act', url };
    }
    return out;
  }

  // ---------------------------------------------------------------- import celého aktu
  const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV'];
  const WORDS = {
    cs: { art: 'Článek', par: 'Odstavec', anx: 'Příloha', rule: 'Pravidlo' },
    en: { art: 'Article', par: 'Paragraph', anx: 'Annex', rule: 'Rule' },
  };
  const RULE = /^\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:Pravidlo|Rule)\s+(\d{1,2})\s*$/i;

  // Identifikace zdroje: „02017R0745 — CS — 19.07.2026 — 007.001“
  function identify(html, tree) {
    const ref = [...elements(tree.root)].find(n => n.tag === 'p' && cls(n, 'reference'));
    const r = ref ? clean(textOf(ref)) : '';
    const m = /(\d{5}[A-Z]\d{4})\s*[—–-]\s*([A-Z]{2})\s*[—–-]\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(r);
    const meta = /<meta[^>]+WT\.z_usr_lan[^>]+content=['"]([A-Za-z]{2})['"]/i.exec(html.slice(0, 5000));
    return {
      celex: m ? m[1] : '',
      consolidated: !!m && m[1][0] === '0',
      language: (m ? m[2] : meta ? meta[1] : '').toLowerCase(),
      date: m ? `${m[5]}-${m[4]}-${m[3]}` : '',
      dateText: m ? `${Number(m[3])}. ${Number(m[4])}. ${m[5]}` : '',
    };
  }

  function parseEurlex(html, documentId, filename) {
    const tree = parseTree(html);
    const id = identify(html, tree);
    const lang = id.language;
    const W = WORDS[lang];
    const errors = [], warnings = [];
    if (!W) throw new Error('Podporované jazyky jsou zatím čeština a angličtina (soubor: ' + (lang || 'neznámý') + ').');
    const arts = [], anx = [];
    for (const [key, n] of Object.entries(tree.byId)) {
      let m = /^art_(\d{1,3})([a-z]?)$/i.exec(key);
      if (m && n.tag === 'div') arts.push({ num: +m[1], suffix: m[2].toLowerCase(), n });
      m = /^anx_([IVXLCDM]+)$/i.exec(key);
      if (m && n.tag === 'div') anx.push({ roman: m[1].toUpperCase(), n });
    }
    if (!arts.length) throw new Error('V souboru nejsou články s identifikátory EUR-Lexu (art_1, art_2…). Uložte stránku z EUR-Lexu jako HTML, ne PDF.');
    arts.sort((a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix));
    anx.sort((a, b) => ROMAN.indexOf(a.roman) - ROMAN.indexOf(b.roman));
    const source = `EUR-Lex, ${id.celex || 'neznámý CELEX'}${id.dateText ? ', znění k ' + id.dateText : ''}, ${lang.toUpperCase()}, ${filename}; automatický import, nutná kontrola originálu.`;
    const units = [], marks = {}, bad = [];
    const push = (u, nodes, markList) => {
      const q = audit(nodes, u.body);
      if (!q.ok) bad.push({ id: u.id, label: u.locator, coverage: q.coverage });
      marks[u.id] = [...new Set(markList)].sort();
      units.push({ ...u, document_id: documentId, source_note: source });
    };
    for (const { num, suffix, n } of arts) {
      const ident = `${documentId}-art-${num}${suffix}`;
      const bodyNodes = direct(n).filter(x => !cls(x, 'title-article-norm') && !cls(x, 'eli-title'));
      const label = `${W.art} ${num}${suffix}`;
      push({ id: ident, parent_id: null, kind: 'article', label, heading: findTitle(n, 'stitle-article-norm'), body: bodyOf(bodyNodes),
             locator: label, sort_order: 10000 + num * 100 + (suffix ? suffix.charCodeAt(0) - 96 : 0) }, bodyNodes, [...marksOf(n), ...previousMarks(n)]);
      const pars = [];
      bodyNodes.forEach((c, j) => {
        if (c.tag !== 'div' || !cls(c, 'norm')) return;
        const span = direct(c).find(x => cls(x, 'no-parag'));
        const m = span && /^(\d{1,3})\.$/.exec(clean(inline(span)));
        if (m) pars.push([j, +m[1]]);
      });
      if (pars.length && pars.every(([, k], i) => k === i + 1)) {
        pars.forEach(([i, k], idx) => {
          const parts = bodyNodes.slice(i, idx + 1 < pars.length ? pars[idx + 1][0] : bodyNodes.length);
          push({ id: `${ident}-par-${k}`, parent_id: ident, kind: 'paragraph', label: `${W.par} ${k}`, heading: '', body: bodyOf(parts),
                 locator: `${label}(${k})`, sort_order: 200000 + num * 100 + k }, parts, parts.flatMap(marksOf));
        });
      }
    }
    for (const { roman, n } of anx) {
      const ident = `${documentId}-annex-${roman.toLowerCase()}`;
      const kids = direct(n);
      const titleNode = kids.find(c => cls(c, 'title-gr-seq-level-1'));
      push({ id: ident, parent_id: null, kind: 'annex', label: `${W.anx} ${roman}`, heading: titleNode ? clean(inline(titleNode)) : roman,
             body: bodyOf(kids), locator: `${W.anx} ${roman}`, sort_order: 500000 + (ROMAN.indexOf(roman) + 1) * 1000 }, kids, [...marksOf(n), ...previousMarks(n)]);
      // Klasifikační pravidla (MDR příloha VIII, IVDR příloha VIII): nadpisy „N.M. Pravidlo K“
      const rules = [];
      kids.forEach((c, i) => {
        if (c.tag !== 'p' || !cls(c, 'title-gr-seq-level-4')) return;
        const t = clean(inline(c)), m = RULE.exec(t);
        if (m) rules.push([i, +m[1], t]);
      });
      rules.forEach(([pos, k, title], idx) => {
        const rn = kids.slice(pos, idx + 1 < rules.length ? rules[idx + 1][0] : kids.length);
        push({ id: `${documentId}-rule-${k}`, parent_id: ident, kind: 'rule', label: `${W.rule} ${k}`, heading: title, body: bodyOf(rn),
               locator: `${W.anx} ${roman} · ${W.rule} ${k}`, sort_order: 500000 + (ROMAN.indexOf(roman) + 1) * 1000 + 100 + k }, rn, rn.flatMap(marksOf));
      });
    }
    // Kontroly struktury
    const plain = arts.filter(a => !a.suffix).map(a => a.num);
    const gaps = plain.filter((k, i) => k !== i + 1);
    if (bad.length) errors.push(`Ztráta textu u ${bad.length} částí (např. ${bad.slice(0, 3).map(b => b.label).join(', ')}). Import je zablokován.`);
    if (gaps.length) warnings.push('Číslování článků není souvislé – zkontrolujte, zda soubor obsahuje celý předpis.');
    if (new Set(units.map(u => u.id)).size !== units.length) errors.push('Duplicitní označení částí v souboru. Import je zablokován.');
    if (!id.consolidated) warnings.push('Soubor není konsolidované znění (CELEX nezačíná 0). Pro výuku se doporučuje konsolidované znění.');
    warnings.push('Kontrola znaků ověřuje úplnost textu, ne správnost struktury, tabulek a poznámek. Texty je nutné ověřit proti zdroji.');
    return {
      units, errors, warnings, id,
      amendments: legend(tree), unitMarks: marks,
      info: { articles: arts.length, inserted: arts.filter(a => a.suffix).map(a => a.num + a.suffix),
              paragraphs: units.filter(u => u.kind === 'paragraph').length, annexes: anx.length,
              rules: units.filter(u => u.kind === 'rule').length },
    };
  }

  // Porovnání s tím, co už je v databázi (aktualizace na nové znění).
  // Porovnává se i odsazení a zalomení (formát textu), jen bez koncových mezer na řádcích.
  const norm = s => String(s || '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
  // JSON se seřazenými klíči (bloky z databáze mají jiné pořadí klíčů)
  const stable = v => JSON.stringify(v ?? null, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
  const blk = v => (Array.isArray(v) && v.length ? v : null);   // prázdné bloky = žádné
  function compare(units, existing) {
    const byId = new Map(existing.map(u => [u.id, u])), incoming = new Set(units.map(u => u.id));
    const out = { added: [], changed: [], same: [], removed: [] };
    for (const u of units) {
      const old = byId.get(u.id);
      if (!old) out.added.push(u);
      else if ((u.content_blocks ? stable(blk(old.content_blocks)) !== stable(blk(u.content_blocks)) : norm(old.body) !== norm(u.body))
               || norm(old.heading) !== norm(u.heading)) out.changed.push(u);
      else out.same.push(u);
    }
    for (const u of existing) if (!u.editor_archived && !incoming.has(u.id) && /-(art|annex|rule|sec)-|-front$/.test(u.id)) out.removed.push(u);
    return out;
  }

  async function sha256(buffer) {
    const h = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  window.RQImport = { parseEurlex, compare, sha256, clean };
})();
