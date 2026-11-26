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
  };
  // Pořadí v panelu Souvislosti: nejdřív upozornění, pak výklad, odkazy a příklady.
  const ORDER = { warning: 0, key: 1, definition: 2, explanation: 3, guidance: 4, references: 5, supplements: 6, related: 7, amends: 8, example: 9, reference: 10 };

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
    const list = comments.filter(c => c.anchor_text).sort((x, y) => (x.kind === 'key' ? 0 : 1) - (y.kind === 'key' ? 0 : 1));
    for (const c of list) {
      const tm = textMap(root), q = normSel(c.anchor_text);
      let at = -1, from = 0;
      for (let k = 0; k < (c.anchor_occurrence || 1); k++) { at = tm.s.indexOf(q, from); if (at < 0) break; from = at + 1; }
      if (at < 0) { missing.push(c); continue; }
      const spans = wrap(tm, at, at + q.length, () => {
        const el = document.createElement('span');
        el.className = c.kind === 'key' ? 'rq-key' : 'rq-anc' + (c.kind === 'warning' ? ' warn' : '');
        el.dataset.cid = c.id; if (c.status && c.status !== 'approved') el.classList.add('draft');
        return el;
      });
      if (c.kind !== 'key' && spans.length) {
        const mk = document.createElement('button');
        mk.type = 'button'; mk.className = 'rq-mk' + (c.kind === 'warning' ? ' warn' : ''); mk.dataset.cid = c.id;
        mk.setAttribute('aria-label', 'Zobrazit poznámku'); mk.innerHTML = ICON[c.kind] || ICON.comment;
        spans[spans.length - 1].after(mk);
        [...spans, mk].forEach(e => e.addEventListener('click', ev => { ev.preventDefault(); onOpen && onOpen(c, mk); }));
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

  window.RQNotes = { ICON, ORDER, applyAnchors, selectionAnchor };
})();
