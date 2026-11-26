'use strict';
/* RegulaQuest – společné pro Studio i čtečku: ikony druhů komentářů a vazeb
   a ukotvení poznámek / klíčových pasáží k vybranému textu (podle znění a pořadí výskytu). */
(function () {
  const svg = p => `<svg class="rq-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    explanation: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>'),
    warning: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    example: svg('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'),
    definition: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M8 7h8M8 11h6"/>'),
    reference: svg('<path d="M7 7h4v4H7zM13 7h4v4h-4z"/><path d="M7 11c0 3-1 5-3 6M13 11c0 3-1 5-3 6"/>'),
    key: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    guidance: svg('<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>'),
    references: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    related: svg('<path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3"/>'),
    supplements: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    amends: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>'),
    comment: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    duty: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    deadline: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>'),
    exception: svg('<path d="M6 3v6a6 6 0 0 0 6 6h6"/><path d="m15 12 3 3-3 3"/><path d="M6 21v-6"/>'),
    term: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  };
  // Zvýraznění (vrstvy) – bez vlastního textu, jen označují pasáž.
  const LAYERS = ['key', 'duty', 'deadline', 'exception'];
  const LAYER_NAMES = { key: 'Klíčové', duty: 'Povinnosti', deadline: 'Lhůty a čísla', exception: 'Výjimky a podmínky', term: 'Pojmy' };
  // Pořadí v panelu Souvislosti: nejdřív upozornění, pak výklad, odkazy a příklady.
  const ORDER = { warning: 0, key: 1, duty: 1, deadline: 1, exception: 1, definition: 2, explanation: 3, guidance: 4, references: 5, supplements: 6, related: 7, amends: 8, example: 9, reference: 10 };

  // Text kontejneru se sloučenými mezerami + mapa na textové uzly (pro nalezení kotvy).
  function textMap(root) {
    const nodes = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('[data-no-anchor], .rq-mk, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let s = '', map = [], prevSpace = true, n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
      const t = n.nodeValue;
      for (let i = 0; i < t.length; i++) {
        const sp = /\s/.test(t[i]);
        if (sp && prevSpace) continue;
        s += sp ? ' ' : t[i]; map.push([n, i]); prevSpace = sp;
      }
      // hranice bloků (odstavce, řádky) chápat jako mezeru
      const blk = n.parentElement.closest('p, div, li, td, th, br, span.ln');
      if (blk && n === blk.lastChild && !prevSpace) { s += ' '; map.push([n, t.length]); prevSpace = true; }
    }
    return { s, map };
  }
  const normSel = s => String(s || '').replace(/\s+/g, ' ').trim();

  // Obalí rozsah [a, b) normalizovaného textu prvky span (po textových uzlech).
  function wrap(tm, a, b, make) {
    const parts = new Map();
    for (let i = a; i < b; i++) { const [node, off] = tm.map[i]; if (off >= node.nodeValue.length) continue; const p = parts.get(node) || [off, off]; p[0] = Math.min(p[0], off); p[1] = Math.max(p[1], off + 1); parts.set(node, p); }
    const spans = [];
    for (const [node, [x, y]] of parts) {
      const r = document.createRange(); r.setStart(node, x); r.setEnd(node, y);
      const el = make(); r.surroundContents(el); spans.push(el);
    }
    return spans;
  }

  // Ukotví komentáře (anchor_text, anchor_occurrence) do textu v root. Vrací komentáře, jejichž kotva nebyla nalezena.
  function applyAnchors(root, comments, onOpen) {
    const missing = [];
    const list = comments.filter(c => c.anchor_text).sort((x, y) => (LAYERS.includes(x.kind) ? 0 : 1) - (LAYERS.includes(y.kind) ? 0 : 1));
    for (const c of list) {
      const tm = textMap(root), q = normSel(c.anchor_text);
      let at = -1, from = 0;
      for (let k = 0; k < (c.anchor_occurrence || 1); k++) { at = tm.s.indexOf(q, from); if (at < 0) break; from = at + 1; }
      if (at < 0) { missing.push(c); continue; }
      const spans = wrap(tm, at, at + q.length, () => {
        const el = document.createElement('span');
        el.className = LAYERS.includes(c.kind) ? 'rq-hl hl-' + c.kind + (c.kind === 'key' ? ' rq-key' : '') : 'rq-anc' + (c.kind === 'warning' ? ' warn' : c.kind === 'link' ? ' link' : '');
        el.dataset.cid = c.id; if (c.status && c.status !== 'approved') el.classList.add('draft');
        return el;
      });
      if (!LAYERS.includes(c.kind) && spans.length) {
        const mk = document.createElement('button');
        mk.type = 'button'; mk.className = 'rq-mk' + (c.kind === 'warning' ? ' warn' : ''); mk.dataset.cid = c.id;
        mk.setAttribute('aria-label', c.kind === 'link' ? 'Zobrazit propojení' : 'Zobrazit poznámku'); if (c.kind === 'link') mk.classList.add('link'); mk.innerHTML = ICON[c.kind] || ICON.comment;
        spans[spans.length - 1].after(mk);
        [...spans, mk].forEach(e => e.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); onOpen && onOpen(c, mk); }));
      }
    }
    return missing;
  }

  // Výběr myší uvnitř root → { text, occurrence } pro uložení kotvy.
  function selectionAnchor(root) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return null;
    const text = normSel(sel.toString());
    if (text.length < 2 || text.length > 1000) return null;
    // pořadí výskytu: kolikátý výskyt textu začíná nejpozději na místě začátku výběru
    const tm = textMap(root);
    let start = tm.map.findIndex(([n, off]) => n === r.startContainer && off >= r.startOffset);
    if (start < 0) start = tm.map.findIndex(([n]) => r.startContainer.contains && r.startContainer.contains(n));
    let occ = 0, i = -1;
    while ((i = tm.s.indexOf(text, i + 1)) >= 0 && i <= Math.max(start, 0) + 1) occ++;
    return { text, occurrence: Math.max(1, occ) };
  }

  /* ---- Pojmy z definic ----
     Vzor = slova oddělená mezerou; „*“ na konci slova = libovolná koncovka. Porovnává se bez diakritiky a velikosti písmen. */
  const fold = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const STOP = new Set('a i o u v ve z ze s se k ke na do po pro nad pod pri za od je jsou the of an in on for to and or by with as at'.split(' '));
  const ENDINGS = ['ymi', 'ych', 'imi', 'ich', 'ami', 'emi', 'ach', 'emu', 'eho', 'ovi', 'ou', 'ym', 'im', 'em', 'um', 'am', 'ech', 'y', 'a', 'e', 'i', 'u', 'o'];
  function stemCs(word) {
    const f = fold(word);
    if (STOP.has(f) || f.length <= 3) return STOP.has(f) ? f : f + '*';
    let st = f;
    for (const e of ENDINGS) if (st.endsWith(e) && st.length - e.length >= 3) { st = st.slice(0, -e.length); break; }
    // pohyblivé e: prostředkem → prostřed(ek)
    if (/kem$/.test(f) && /[^aeiouy]k$/.test(st) && st.length > 5) st = st.slice(0, -1);
    return st + '*';
  }
  function suggestForms(label, lang) {
    const words = String(label).replace(/[,;:.]+\s*$/, '').match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length) return '';
    if (lang === 'cs') return words.map(stemCs).join(' ');
    return words.map((w, i) => { const f = fold(w);
      if (i < words.length - 1 || f.length <= 3) return f;
      return (f.endsWith('y') && (words.length > 1 || f.length > 5) ? f.slice(0, -1) : f) + '*'; }).join(' ');
  }
  // Body definičního článku: 1) „pojem“ … / (1) ‘term’ means …
  const DEF_LINE = /^\s*\(?(\d+)\)\s*[„‘“"']([^“’”"']+)[“’”"']/;
  function parseDefinitions(body) {
    const out = [];
    String(body || '').split('\n').forEach(l => { const m = l.match(DEF_LINE); if (m) out.push({ number: +m[1], source_label: m[2].trim().replace(/[,;]\s*$/, '') }); });
    return out;
  }
  function definitionText(body, number) {
    const lines = String(body || '').split('\n'); let on = false; const out = [];
    for (const l of lines) {
      const m = l.match(/^\s*\(?(\d+)\)\s/);
      if (m && l.match(DEF_LINE)) { if (on) break; if (+m[1] === number) on = true; }
      if (on) out.push(l.trim());
    }
    return out.join('\n').trim();
  }
  const patterns = t => String(t.forms || '').split('\n').map(x => x.trim()).filter(Boolean)
    .map(x => x.split(/\s+/).map(w => ({ w: fold(w.replace(/\*$/, '')), pre: w.endsWith('*') })));
  // Označí první výskyt každého pojmu v root (nepřekrývá se s jiným pojmem). Vrací počet označených.
  function applyTerms(root, terms, onOpen) {
    const tm = textMap(root), toks = [];
    const re = /[\p{L}\p{N}]+/gu; let m;
    while ((m = re.exec(tm.s))) toks.push({ a: m.index, b: m.index + m[0].length, f: fold(m[0]) });
    const used = new Array(toks.length).fill(false), hits = [];
    const cands = [];
    terms.forEach(t => patterns(t).forEach(p => cands.push({ t, p })));
    cands.sort((x, y) => y.p.length - x.p.length || y.p.reduce((s, w) => s + w.w.length, 0) - x.p.reduce((s, w) => s + w.w.length, 0));
    const done = new Set();
    for (const { t, p } of cands) {
      if (done.has(t.id) || !p.length) continue;
      for (let i = 0; i + p.length <= toks.length; i++) {
        let ok = true;
        for (let k = 0; k < p.length && ok; k++) { const tk = toks[i + k], w = p[k];
          ok = !used[i + k] && (w.pre ? tk.f.startsWith(w.w) : tk.f === w.w); }
        if (!ok) continue;
        for (let k = 0; k < p.length; k++) used[i + k] = true;
        hits.push({ t, a: toks[i].a, b: toks[i + p.length - 1].b }); done.add(t.id); break;
      }
    }
    hits.sort((x, y) => y.a - x.a).forEach(h => {
      const spans = wrap(tm, h.a, h.b, () => { const el = document.createElement('span'); el.className = 'rq-term'; el.dataset.term = h.t.id; return el; });
      spans.forEach(e => e.addEventListener('click', ev => { if (getSelection().toString()) return; ev.preventDefault(); onOpen && onOpen(h.t, spans[spans.length - 1]); }));
    });
    return hits.length;
  }
  // Počet výskytů pojmu v textu (pro kontrolu vzorů ve Studiu).
  const tokens = text => (String(text).match(/[\p{L}\p{N}]+/gu) || []).map(fold);
  function countTerm(text, t) {
    const toks = Array.isArray(text) ? text : tokens(text); let n = 0;
    for (const p of patterns(t)) for (let i = 0; i + p.length <= toks.length; i++)
      if (p.every((w, k) => w.pre ? toks[i + k].startsWith(w.w) : toks[i + k] === w.w)) n++;
    return n;
  }

  function linkGroups(rels) {
    const g = new Map();
    rels.filter(r => r.anchor_text).forEach(r => { const k = r.anchor_occurrence + '|' + r.anchor_text;
      if (!g.has(k)) g.set(k, { id: 'L' + r.id, kind: 'link', anchor_text: r.anchor_text, anchor_occurrence: r.anchor_occurrence, status: r.status, rels: [] });
      g.get(k).rels.push(r); });
    return [...g.values()];
  }
  window.RQNotes = { linkGroups, ICON, ORDER, LAYERS, LAYER_NAMES, applyAnchors, selectionAnchor,
    suggestForms, parseDefinitions, definitionText, applyTerms, countTerm, tokens, fold };
})();
