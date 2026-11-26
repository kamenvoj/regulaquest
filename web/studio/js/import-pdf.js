'use strict';
/* RegulaQuest – import metodického dokumentu z PDF (MDCG apod.) v prohlížeči (pdf.js).
   Kapitoly podle obsahu dokumentu (řádky s tečkami a číslem strany), v kapitolách dál pravidla „Rule N – …“.
   Tabulky s orámováním → upravitelné tabulky; strany se schématy → obrázek stránky (text zůstane pro hledání).
   Nic neověřuje: všechno přichází jako „Nutno ověřit“ a kontroluje se proti originálu. */
(function () {
  const BASE = new URL('vendor/pdfjs/', document.baseURI).href;
  let pdfjs = null;
  async function lib() {
    if (!pdfjs) {
      pdfjs = await import(BASE + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
    }
    return pdfjs;
  }
  const norm = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cast';

  // ---------------------------------------------------------------- čtení stránky
  async function readPage(doc, n) {
    const L = await lib(), O = L.OPS;
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const [tc, ol] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    // čáry a rámečky (pro tabulky a schémata), s ohledem na transformace
    const paint = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const pt = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const hs = [], vs = [], boxes = []; let images = 0;
    ol.fnArray.forEach((f, i) => {
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.transform) ctm = mul(ctm, ol.argsArray[i]);
      else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject) {
        const a = pt(0, 0), b = pt(1, 1), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
        if (w * h > 0.12 * vp.width * vp.height) images++;   // velký obrázek = schéma (logo v záhlaví ne)
      }
      else if (f === O.constructPath) {
        const [op, , mm] = ol.argsArray[i];
        if (!paint.has(op) || !mm) return;
        const a = pt(mm[0], mm[1]), b = pt(mm[2], mm[3]);
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        const w = x1 - x0, h = y1 - y0;
        if (h <= 3 && w >= 4) hs.push({ y: (y0 + y1) / 2, x0, x1 });
        else if (w <= 3 && h >= 4) vs.push({ x: (x0 + x1) / 2, y0, y1 });
        else if (w > 8 && h > 8 && w < vp.width * 0.9) boxes.push({ x0, x1, y0, y1 });
      }
    });
    // text: položky s polohou (PDF souřadnice, y nahoru)
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({
      s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10,
    }));
    return { n, width: vp.width, height: vp.height, items, hs, vs, boxes, images, page };
  }

  // Seskupí položky do řádků (stejná účaří), zleva doprava.
  function toLines(items) {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x), lines = [];
    for (const it of sorted) {
      const line = lines.find(l => Math.abs(l.y - it.y) < Math.max(2, 0.45 * Math.min(l.h, it.h)));
      if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); } else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let t = '', end = null;
      for (const it of l.items) {
        if (end !== null && it.x - end > 0.18 * it.h && !/\s$/.test(t) && !/^\s/.test(it.s)) t += ' ';
        t += it.s; end = it.x + it.w;
      }
      l.text = t.replace(/\s+/g, ' ').trim(); l.x = l.items[0].x;
    }
    return lines.filter(l => l.text).sort((a, b) => b.y - a.y);
  }

  // ---------------------------------------------------------------- tabulky z orámování
  function findTables(p) {
    const tol = 2.5, near = (a, b) => Math.abs(a - b) <= tol;
    const H = p.hs.filter(h => h.x1 - h.x0 > 6), V = p.vs.filter(v => v.y1 - v.y0 > 6);
    // spojené skupiny čar (protínající se vodorovné a svislé)
    const segs = [...H.map(h => ({ t: 'h', ...h })), ...V.map(v => ({ t: 'v', ...v }))];
    const parent = segs.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const touch = (h, v) => v.x >= h.x0 - tol && v.x <= h.x1 + tol && h.y >= v.y0 - tol && h.y <= v.y1 + tol;
    segs.forEach((a, i) => segs.forEach((b, j) => { if (j > i && a.t !== b.t && touch(a.t === 'h' ? a : b, a.t === 'v' ? a : b)) parent[find(i)] = find(j); }));
    const groups = new Map(); segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
    const tables = [];
    for (const g of groups.values()) {
      const gh = g.filter(s => s.t === 'h'), gv = g.filter(s => s.t === 'v');
      if (gh.length < 2 || gv.length < 2) continue;
      const x0 = Math.min(...gh.map(h => h.x0)), x1 = Math.max(...gh.map(h => h.x1)), y0 = Math.min(...gv.map(v => v.y0)), y1 = Math.max(...gv.map(v => v.y1));
      if (x1 - x0 < 60 || y1 - y0 < 15) continue;
      const uniq = (arr) => { const out = []; arr.sort((a, b) => a - b).forEach(v => { if (!out.length || v - out[out.length - 1] > tol) out.push(v); }); return out; };
      const xs = uniq(gv.map(v => v.x)), ys = uniq(gh.map(h => h.y)).reverse(); // ys shora dolů
      if (xs.length < 2 || ys.length < 2) continue;
      // úplný vnější rámeček – jinak nejde o tabulku (schémata mají samostatné rámečky)
      const covH = (y) => gh.filter(h => near(h.y, y)).reduce((s, h) => s + (Math.min(h.x1, xs[xs.length - 1]) - Math.max(h.x0, xs[0])), 0) >= 0.9 * (xs[xs.length - 1] - xs[0]);
      const covV = (x) => gv.filter(v => near(v.x, x)).reduce((s, v) => s + (Math.min(v.y1, ys[0]) - Math.max(v.y0, ys[ys.length - 1])), 0) >= 0.9 * (ys[0] - ys[ys.length - 1]);
      if (!covH(ys[0]) || !covH(ys[ys.length - 1]) || !covV(xs[0]) || !covV(xs[xs.length - 1])) continue;
      const R = ys.length - 1, C = xs.length - 1;
      const vEdge = (c, r) => { const ym = (ys[r] + ys[r + 1]) / 2; return gv.some(v => near(v.x, xs[c]) && v.y0 <= ym + tol && v.y1 >= ym - tol); };
      const hEdge = (r, c) => { const xm = (xs[c] + xs[c + 1]) / 2; return gh.some(h => near(h.y, ys[r]) && h.x0 <= xm + tol && h.x1 >= xm - tol); };
      // sloučené buňky: oblasti mřížky bez dělicí čáry
      const owner = Array.from({ length: R }, () => Array(C).fill(-1)), cells = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        if (owner[r][c] >= 0) continue;
        let cs = 1; while (c + cs < C && !vEdge(c + cs, r)) cs++;
        let rs = 1; while (r + rs < R && !hEdge(r + rs, c)) rs++;
        const id = cells.length;
        for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) if (owner[rr][cc] < 0) owner[rr][cc] = id;
        cells.push({ r, c, rs, cs, x0: xs[c], x1: xs[c + cs], y0: ys[r + rs], y1: ys[r], items: [] });
      }
      // mřížka musí být obdélníková bez překryvů (jinak raději obrázek)
      let ok = true;
      for (let r = 0; r < R && ok; r++) for (let c = 0; c < C; c++) { const o = cells[owner[r][c]]; if (r < o.r || r >= o.r + o.rs || c < o.c || c >= o.c + o.cs) { ok = false; break; } }
      if (!ok || R > 80 || C > 35) continue;
      tables.push({ x0: xs[0], x1: xs[C], y0: ys[R], y1: ys[0], R, C, cells });
    }
    return tables;
  }
  function tableBlock(t) {
    const rows = Array.from({ length: t.R }, () => []);
    for (const cell of t.cells) {
      const text = toLines(cell.items).map(l => l.text).join('\n')
        .replace(/\n(?![•▪◦\-–—]\s|\(?[a-z0-9ivx]{1,4}[).]\s)/g, ' ').trim();
      rows[cell.r].push({ c: cell.c, text, header: false, align: 'left', colspan: cell.cs, rowspan: cell.rs });
    }
    rows.forEach(r => r.sort((a, b) => a.c - b.c).forEach(x => delete x.c));
    // první řádek je záhlaví, pokud jsou jeho buňky krátké
    if (rows[0] && rows[0].every(c => c.text.length < 40)) rows[0].forEach(c => c.header = true);
    return { type: 'table', caption: '', notes: '', rows };
  }

  // ---------------------------------------------------------------- text → odstavce
  const BULLET = /^([•▪◦●\-–—]|\(?[a-z0-9ivx]{1,4}[).])\s/i;
  function paragraphs(lines) {
    const out = []; let cur = null, prev = null;
    for (const l of lines) {
      const gap = prev ? prev.y - l.y : 0;
      const fresh = !cur || prev.page !== l.page && /[.:;]$/.test(cur) || gap > 1.7 * Math.max(prev.h, l.h) || BULLET.test(l.text);
      if (fresh) { if (cur) out.push(cur); cur = l.text; }
      else cur = /-$/.test(cur) && /^[a-z]/.test(l.text) ? cur.slice(0, -1) + l.text : cur + ' ' + l.text;
      prev = l;
    }
    if (cur) out.push(cur);
    return out;
  }
  const textHtml = paras => paras.map(esc).join('<br><br>');

  // ---------------------------------------------------------------- celý dokument
  const TOC = /^(?:(\d+(?:\.\d+){0,4})\.?\s+)?(.+?)\s*(?:\.\s?){4,}\s*(\d{1,3})$/;
  const RULE = /^Rule\s*(\d{1,2})\s*(?:[-–—:]\s*)?([A-Z].{3,})$/;

  async function parsePdf(buffer, documentId, filename, progress = () => {}) {
    const L = await lib();
    const doc = await L.getDocument({ data: new Uint8Array(buffer.slice(0)), standardFontDataUrl: BASE + 'standard_fonts/', wasmUrl: BASE + 'wasm/' }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) { progress(`Čtu stranu ${n} z ${doc.numPages}…`); pages.push(await readPage(doc, n)); }
    const errors = [], warnings = [];

    // záhlaví a zápatí: stejné řádky (bez čísel) nahoře/dole na většině stran
    const edge = new Map();
    const pageLines = pages.map(p => toLines(p.items).map(l => ({ ...l, page: p.n })));
    pageLines.forEach((ls, i) => {
      const p = pages[i], seen = new Set();
      ls.forEach(l => { if (l.y > p.height * 0.86 || l.y < p.height * 0.1) { const k = l.text.replace(/\d+/g, '#').replace(/\s/g, ''); if (!seen.has(k)) { seen.add(k); edge.set(k, (edge.get(k) || 0) + 1); } } });
    });
    const isEdge = (l, p) => (l.y > p.height * 0.86 || l.y < p.height * 0.1) && (edge.get(l.text.replace(/\d+/g, '#').replace(/\s/g, '')) || 0) >= Math.max(3, pages.length * 0.5);

    // obsah dokumentu
    const toc = []; let tocEnd = 0, lastNum = null, uCount = {};
    pageLines.forEach((ls, i) => {
      if (i > 12) return;
      ls.forEach(l => {
        const m = TOC.exec(l.text); if (!m) return;
        const page = +m[3]; if (page < 1 || page > pages.length) return;
        let num = m[1] || null, title = m[2].trim(), parentNum = num ? num.split('.').slice(0, -1).join('.') || null : lastNum;
        if (num) lastNum = num;
        toc.push({ num, title, page, parentNum }); tocEnd = i + 1;
      });
    });
    if (toc.length < 3) throw new Error('V PDF se nepodařilo najít obsah dokumentu (řádky „1 Název …… 6“). Tento import zatím umí jen dokumenty s obsahem.');

    // tělo dokumentu: řádky + tabulky + schémata, po stranách
    const flow = []; // {kind:'line'|'table'|'figure', page, ...}
    const diagramPages = new Set();
    for (const p of pages) {
      const tables = findTables(p);
      const inTable = it => tables.find(t => it.x + it.w / 2 >= t.x0 && it.x + it.w / 2 <= t.x1 && it.y + it.h * 0.3 >= t.y0 && it.y + it.h * 0.3 <= t.y1);
      const free = [];
      for (const it of p.items) {
        const t = inTable(it);
        if (t) { const c = t.cells.find(c => it.x + it.w / 2 >= c.x0 && it.x + it.w / 2 <= c.x1 && it.y + it.h * 0.3 >= c.y0 && it.y + it.h * 0.3 <= c.y1); (c || t.cells[0]).items.push(it); }
        else free.push(it);
      }
      const diagram = p.boxes.length >= 5 || p.images > 0;
      if (diagram) diagramPages.add(p.n);
      const lines = toLines(free).map(l => ({ ...l, page: p.n })).filter(l => !isEdge(l, p));
      const entries = [...lines.map(l => ({ kind: 'line', page: p.n, y: l.y, line: l })), ...tables.map(t => ({ kind: 'table', page: p.n, y: t.y1, block: tableBlock(t) }))];
      entries.sort((a, b) => b.y - a.y);
      if (diagram) {   // obrázek stránky hned pod prvním řádkem (nadpis kapitoly zůstane před ním)
        entries.forEach(e => { if (e.kind === 'line') e.diagram = true; });
        const heads = lines.filter(l => toc.some(t => { const a = norm(l.text), b = norm((t.num ? t.num + ' ' : '') + t.title); return a === norm(t.title) || (b.length > 3 && a.startsWith(b.slice(0, 30))); })).map(l => l.y);
        entries.push({ kind: 'figure', page: p.n, y: (heads.length ? Math.min(...heads) : lines.length ? lines[0].y + 1 : p.height) - 0.5 });
        entries.sort((a, b) => b.y - a.y);
      }
      flow.push(...entries);
    }

    // nadpisy kapitol z obsahu: první výskyt od strany uvedené v obsahu
    const starts = []; let cursor = flow.findIndex(e => e.page > tocEnd);
    if (cursor < 0) cursor = 0;
    for (const e of toc) {
      const want = norm((e.num ? e.num + ' ' : '') + e.title), wantT = norm(e.title);
      let found = -1;
      for (let i = cursor; i < flow.length && flow[i].page <= e.page + 1; i++) {
        if (flow[i].kind !== 'line' || flow[i].page < e.page - 1) continue;
        const t = norm(flow[i].line.text);
        if (t.startsWith(want.slice(0, 40)) || (t.startsWith(wantT.slice(0, 40)) && (!e.num || t.length < wantT.length + 12))) { found = i; break; }
      }
      if (found < 0) { warnings.push(`Nadpis „${e.num ? e.num + ' ' : ''}${e.title}“ nebyl v textu nalezen; kapitola začíná na straně ${e.page}.`); found = Math.max(cursor, flow.findIndex(x => x.page >= e.page)); }
      starts.push({ e, at: found, heading: flow[found] && flow[found].kind === 'line' && norm(flow[found].line.text).includes(wantT.slice(0, 20)) });
      cursor = found + 1;
    }

    // části dokumentu
    const units = [], used = new Set(), num2id = new Map();
    const mkId = e => {
      if (e.num) return `${documentId}-sec-${e.num.replace(/\./g, '-')}`;
      const base = `${documentId}-sec-${e.parentNum ? e.parentNum.replace(/\./g, '-') + '-' : ''}${slug(e.title)}`;
      let id = base, k = 2; while (used.has(id)) id = base + '-' + k++; return id;
    };
    const blocksOf = (part, uid) => {
      const blocks = []; let lines = [];
      const flush = () => { if (lines.length) { const ps = paragraphs(lines); if (ps.length) blocks.push({ type: 'text', html: textHtml(ps) }); lines = []; } };
      for (const e of part) {
        if (e.kind === 'figure') { flush(); blocks.push({ type: 'figure', page: e.page, path: '', caption: `Schéma – strana ${e.page} originálu`, alt: '' }); continue; }
        if (e.kind === 'line' && e.diagram) {
          const fig = [...blocks].reverse().find(b => b.type === 'figure' && b.page === e.page);
          if (fig) fig.alt = (fig.alt + ' ' + e.line.text).trim().slice(0, 1000);
          continue;
        }
        if (e.kind === 'line') lines.push(e.line);
        else { flush(); blocks.push(e.block); }
      }
      flush();
      return blocks;
    };
    const order = { n: 0 };
    const pushUnit = (u, part) => {
      const blocks = blocksOf(part, u.id);
      units.push({ ...u, document_id: documentId, content_blocks: blocks, body: '', sort_order: ++order.n * 10,
                   source_note: `PDF ${filename}; automatický import, nutná kontrola originálu (tabulky, schémata).` });
    };
    // úvodní strany (titulní strana, přehled změn) před první kapitolou
    const firstAt = starts.length ? starts[0].at : flow.length;
    const front = flow.slice(0, firstAt).filter(e => e.page > tocEnd || e.page <= 1 || e.page < (toc[0]?.page || 1));
    if (front.length) pushUnit({ id: `${documentId}-front`, parent_id: null, kind: 'section', label: 'Úvodní strany', heading: 'Titulní strana a přehled změn', locator: 'PDF str. 1' }, flow.slice(0, firstAt).filter(e => !(e.page > 1 && e.page <= tocEnd && e.kind === 'line' && TOC.test(e.line.text))));
    starts.forEach((s, k) => {
      const e = s.e, id = mkId(e); used.add(id); if (e.num) num2id.set(e.num, id);
      const end = k + 1 < starts.length ? starts[k + 1].at : flow.length;
      let part = flow.slice(s.heading ? s.at + 1 : s.at, end);
      const parent = e.parentNum ? num2id.get(e.parentNum) || null : null;
      const base = { id, parent_id: parent, kind: 'section', label: e.num || e.title, heading: e.num ? e.title : '', locator: `PDF str. ${e.page}` };
      // pravidla uvnitř kapitoly: „Rule N – …“ (každé číslo jen jednou)
      const ruleAt = []; const seenRule = new Set();
      part.forEach((x, i) => { if (x.kind === 'line' && !x.diagram) { const m = RULE.exec(x.line.text); if (m && !seenRule.has(m[1])) { seenRule.add(m[1]); ruleAt.push([i, +m[1], m[2]]); } } });
      if (ruleAt.length >= 1 && /rule|pravidl/i.test(e.title + ' ' + (e.parentNum ? (toc.find(t => t.num === e.parentNum)?.title || '') : ''))) {
        pushUnit(base, part.slice(0, ruleAt[0][0]));
        ruleAt.forEach(([i, n, title], j) => {
          const rid = `${documentId}-rule-${n}`;
          if (used.has(rid)) { warnings.push(`Pravidlo ${n} se v dokumentu objevuje vícekrát; další výskyt zůstává v kapitole.`); return; }
          used.add(rid);
          pushUnit({ id: rid, parent_id: id, kind: 'rule', label: `Rule ${n}`, heading: title, locator: `PDF str. ${part[i].page}` }, part.slice(i + 1, j + 1 < ruleAt.length ? ruleAt[j + 1][0] : part.length));
        });
      } else pushUnit(base, part);
    });
    const tablesN = units.reduce((s, u) => s + u.content_blocks.filter(b => b.type === 'table').length, 0);
    const figuresN = units.reduce((s, u) => s + u.content_blocks.filter(b => b.type === 'figure').length, 0);
    // úplnost: každý řádek textu mimo záhlaví patří právě jedné části
    const assigned = flow.filter(e => e.kind === 'line').length, total = pageLines.reduce((s, ls, i) => s + ls.filter(l => !isEdge(l, pages[i])).length, 0);
    warnings.push('Tabulky jsou převedené z orámování v PDF a schémata uložená jako obrázek stránky. Obojí je nutné zkontrolovat proti originálu; tabulky lze upravit v editoru.');
    return {
      units, errors, warnings, pages, diagramPages: [...diagramPages],
      info: { pages: pages.length, sections: units.filter(u => u.kind === 'section').length, rules: units.filter(u => u.kind === 'rule').length,
              tables: tablesN, figures: figuresN, toc: toc.length, lines: total, linesInTables: total - assigned },
    };
  }

  // Obrázek stránky do PNG (pro schémata).
  async function renderPage(p, scale = 1.6) {
    const vp = p.page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  window.RQPdf = { parsePdf, renderPage };
})();
