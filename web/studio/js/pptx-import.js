'use strict';
/* RegulaQuest Studio – import prezentace z PowerPointu (.pptx) přímo v prohlížeči (nic se nenahrává).
   Ze snímků se převezme obsah a struktura (nadpis, sekce, štítek, karty, pruhy, tabulky, klíčová myšlenka, poznámky),
   vzhled pak dělá šablona aplikace. Barvy se převedou na tóny šablony. */
window.RQPptx = (function () {
  const EMU = 914400;
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main',
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /* ---------- ZIP (bez knihoven: centrální adresář + DecompressionStream) ---------- */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Soubor není platný .pptx (ZIP).');
    const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('Poškozený ZIP.');
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
      files.set(name, { method, csize, lo });
      off += 46 + nl + xl + cl;
    }
    async function read(name) {
      const f = files.get(name); if (!f) return null;
      const start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true);
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('Nepodporovaná komprese v souboru ' + name);
      const ds = new DecompressionStream('deflate-raw');
      return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    }
    return { has: n => files.has(n), names: () => [...files.keys()], text: async n => { const d = await read(n); return d ? dec.decode(d) : null; } };
  }
  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const kids = (el, ns, name) => el ? [...el.children].filter(c => c.namespaceURI === ns && c.localName === name) : [];
  const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
  const desc = (el, ns, name) => el ? [...el.getElementsByTagNameNS(ns, name)] : [];
  const resolve = (base, target) => { const parts = base.split('/').slice(0, -1); target.split('/').forEach(p => { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }); return parts.join('/'); };
  async function rels(z, part) {
    const p = part.replace(/([^/]+)$/, '_rels/$1.rels'), t = await z.text(p); const m = new Map();
    if (t) [...xml(t).documentElement.children].forEach(r => m.set(r.getAttribute('Id'), { type: r.getAttribute('Type'), target: resolve(part, r.getAttribute('Target')) }));
    return m;
  }

  /* ---------- barvy → tóny šablony ---------- */
  function tone(hex) {
    if (!hex) return 'neutral';
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.12) return 'neutral';
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    if (h < 18 || h >= 330) return 'red';
    if (h < 65) return 'gold';
    if (h < 160) return 'green';
    if (h < 200) return 'teal';
    if (h < 260) return l < 0.3 ? 'navy' : 'blue';
    return 'red';
  }
  const fillOf = spPr => { const sf = kid(spPr, A, 'solidFill'); const c = sf && kid(sf, A, 'srgbClr'); return c ? c.getAttribute('val') : null; };
  const lineOf = spPr => { const ln = kid(spPr, A, 'ln'); const sf = ln && kid(ln, A, 'solidFill'); const c = sf && kid(sf, A, 'srgbClr'); return c ? c.getAttribute('val') : null; };

  /* ---------- text ---------- */
  function paragraphs(txBody) {
    return kids(txBody, A, 'p').map(p => {
      const pPr = kid(p, A, 'pPr');
      let text = '', allB = true, any = false, color = null, size = 0;
      [...p.children].forEach(c => {
        if (c.localName === 'br') { text += '\n'; return; }
        if (c.localName !== 'r' && c.localName !== 'fld') return;
        const t = (kid(c, A, 't') || {}).textContent || ''; if (!t) return;
        const rPr = kid(c, A, 'rPr'); const b = rPr && (rPr.getAttribute('b') === '1' || rPr.getAttribute('b') === 'true');
        if (rPr && rPr.getAttribute('sz')) size = Math.max(size, +rPr.getAttribute('sz') / 100);
        const sf = rPr && kid(rPr, A, 'solidFill'), cc = sf && kid(sf, A, 'srgbClr'); if (cc && !color) color = cc.getAttribute('val');
        if (t.trim()) { any = true; if (!b) allB = false; }
        text += b && t.trim() ? `**${t}**` : t;
      });
      text = text.replace(/\*\*(\s*)\*\*/g, '$1').replace(/\*\*\s+\*\*/g, ' ');
      const bullet = !!(pPr && (kid(pPr, A, 'buChar') || kid(pPr, A, 'buAutoNum')));
      const b = any && allB;
      if (b) text = text.replace(/\*\*/g, '');
      return { text: text.replace(/[ \t]+\n/g, '\n').trim(), b, bullet, color, size, level: pPr ? +(pPr.getAttribute('lvl') || 0) : 0 };
    }).filter(p => p.text);
  }

  /* ---------- tvary snímku ---------- */
  function shapesOf(tree, ox = 0, oy = 0, out = []) {
    [...tree.children].forEach(el => {
      const ln = el.localName;
      if (ln === 'grpSp') {
        const x = kid(kid(el, P, 'grpSpPr'), A, 'xfrm'), off = x && kid(x, A, 'off'), ch = x && kid(x, A, 'chOff');
        const dx = off && ch ? +off.getAttribute('x') - +ch.getAttribute('x') : 0, dy = off && ch ? +off.getAttribute('y') - +ch.getAttribute('y') : 0;
        shapesOf(el, ox + dx, oy + dy, out); return;
      }
      if (!['sp', 'graphicFrame', 'pic', 'cxnSp'].includes(ln)) return;
      const nv = el.firstElementChild, cNv = nv && nv.firstElementChild, nvPr = nv && kid(nv, P, 'nvPr'), ph = nvPr && kid(nvPr, P, 'ph');
      const xf = ln === 'graphicFrame' ? kid(el, P, 'xfrm') : kid(kid(el, P, 'spPr'), A, 'xfrm');
      const off = xf && kid(xf, A, 'off'), ext = xf && kid(xf, A, 'ext');
      const s = { kind: ln, name: cNv ? cNv.getAttribute('name') || '' : '', ph: ph ? (ph.getAttribute('type') || 'body') : null,
        x: off ? (+off.getAttribute('x') + ox) / EMU : 0, y: off ? (+off.getAttribute('y') + oy) / EMU : 0, w: ext ? +ext.getAttribute('cx') / EMU : 0, h: ext ? +ext.getAttribute('cy') / EMU : 0 };
      if (ln === 'sp') { const sp = kid(el, P, 'spPr'); s.fill = fillOf(sp); s.line = lineOf(sp); const tb = kid(el, P, 'txBody'); s.paras = tb ? paragraphs(tb) : []; }
      if (ln === 'graphicFrame') {
        const tbl = desc(el, A, 'tbl')[0];
        if (tbl) s.rows = kids(tbl, A, 'tr').map(tr => kids(tr, A, 'tc').map(tc => paragraphs(kid(tc, A, 'txBody')).map(p => p.text).join('\n')));
      }
      out.push(s);
    });
    return out;
  }
  const inside = (t, c) => { const cx = t.x + t.w / 2, cy = t.y + t.h / 2; return cx >= c.x - 0.02 && cx <= c.x + c.w + 0.02 && cy >= c.y - 0.02 && cy <= c.y + c.h + 0.02; };
  const caps = s => s.length <= 70 && s === s.toLocaleUpperCase('cs') && /\p{L}/u.test(s);

  let seq = 0; const bid = () => 'b' + (++seq).toString(36);
  function convert(shapes, W, H) {
    seq = 0;
    const slide = { layout: 'content', title: '', blocks: [] };
    const texts = shapes.filter(s => s.kind === 'sp' && s.paras && s.paras.length);
    const titleSh = texts.find(s => s.ph === 'title' || s.ph === 'ctrTitle');
    if (titleSh) slide.title = titleSh.paras.map(p => p.text.replace(/\*\*/g, '')).join(' ');
    if (titleSh && titleSh.ph === 'ctrTitle') slide.layout = 'title';
    const sub = texts.find(s => s.ph === 'subTitle');
    if (sub) slide.subtitle = sub.paras.map(p => p.text).join(' · ');
    const used = new Set([titleSh, sub].filter(Boolean));
    // proužky (úzké barevné tvary) → tón kontejneru, který překrývají
    const stripes = shapes.filter(s => s.kind === 'sp' && (!s.paras || !s.paras.length) && s.fill && s.w < 0.2 && s.h > s.w * 2);
    const toneFor = c => { const st = stripes.find(p => Math.abs(p.x - c.x) < 0.05 && p.y >= c.y - 0.05 && p.y + p.h <= c.y + c.h + 0.05); return st ? tone(st.fill) : null; };
    // malé texty v záhlaví: štítek (vlevo) a sekce (vpravo)
    texts.filter(s => !used.has(s) && s.y < 0.6 && s.h < 0.6).forEach(s => {
      const t = s.paras.map(p => p.text.replace(/\*\*/g, '')).join(' ');
      if (s.x < W / 2) slide.badge = t; else slide.kicker = t;
      used.add(s);
    });
    // kontejnery: plné tvary bez textu (karty) a vyplněné textové rámečky (pruhy)
    const boxes = shapes.filter(s => s.kind === 'sp' && s.fill && !stripes.includes(s) && s.w > 0.6 && s.h > 0.25 && !(s.y < 0.6 && s.h < 0.6) && (!s.paras || !s.paras.length));
    const items = [];
    boxes.forEach(b => {
      const inner = texts.filter(t => !used.has(t) && t !== b && inside(t, b)).sort((a, c) => a.y - c.y || a.x - c.x);
      if (!inner.length) return;
      inner.forEach(t => used.add(t));
      items.push({ x: b.x, y: b.y, w: b.w, h: b.h, tone: toneFor(b) || tone(b.line && b.fill === 'FFFFFF' ? b.line : null), parts: inner.map(t => t.paras) });
    });
    texts.filter(t => !used.has(t) && t.fill).forEach(t => { used.add(t); items.push({ x: t.x, y: t.y, w: t.w, h: t.h, tone: toneFor(t), filled: true, parts: [t.paras] }); });
    texts.filter(t => !used.has(t)).forEach(t => { used.add(t); items.push({ x: t.x, y: t.y, w: t.w, h: t.h, free: true, parts: [t.paras] }); });
    shapes.filter(s => s.rows).forEach(s => items.push({ x: s.x, y: s.y, w: s.w, h: s.h, table: s.rows }));
    shapes.filter(s => s.kind === 'pic' && s.w > 1).forEach(s => items.push({ x: s.x, y: s.y, w: s.w, h: s.h, pic: s.name }));
    items.sort((a, b) => a.y - b.y || a.x - b.x);

    const clean = ps => ps.map(p => ({ text: p.text, ...(p.b ? { b: true } : {}), ...(p.bullet ? { bullet: true } : {}) }));
    const headingOf = it => {
      if (it.parts.length < 2) return null;
      const first = it.parts[0]; const t = first.map(p => p.text.replace(/\*\*/g, '')).join(' ');
      return (first.length === 1 && (first[0].b || caps(t)) && t.length <= 80) ? t : null;
    };
    let row = null, lines = [];   // karty: řádky (podle y) za sebou se stejnou šířkou karet tvoří jeden blok
    const flushRow = () => { if (row) { const cols = Math.max(...lines.map(l => l.n)); slide.blocks.push({ id: bid(), type: 'cards', items: row, ...(lines.length > 1 ? { cols } : {}) }); row = null; lines = []; } };
    items.forEach((it, i) => {
      if (it.table) { flushRow(); slide.blocks.push({ id: bid(), type: 'table', header: true, rows: it.table }); return; }
      if (it.pic) { flushRow(); slide.blocks.push({ id: bid(), type: 'image', missing: true, name: it.pic }); return; }
      const head = headingOf(it);
      if (head && /^(KLÍČOVÁ MYŠLENKA|KEY (TAKEAWAY|MESSAGE)|SHRNUTÍ)$/i.test(head)) { flushRow(); slide.key = { text: it.parts.slice(1).flat().map(p => p.text.replace(/\*\*/g, '')).join(' ') }; return; }
      const body = clean((head ? it.parts.slice(1) : it.parts).flat());
      const narrow = it.w < W * 0.6;
      if (head || (narrow && !it.free)) {
        const card = { id: bid(), heading: head || '', tone: it.tone || 'neutral', paras: body };
        const line = lines[lines.length - 1];
        if (row && line && Math.abs(line.y - it.y) < 0.25 && line.n < 6) { row.push(card); line.n++; line.h = Math.max(line.h, it.h); }
        else if (row && line && it.y - (line.y + line.h) < 0.6 && it.y > line.y && Math.abs(line.w - it.w) < 0.3) { row.push(card); lines.push({ y: it.y, h: it.h, w: it.w, n: 1 }); }
        else { flushRow(); row = [card]; lines = [{ y: it.y, h: it.h, w: it.w, n: 1 }]; }
        return;
      }
      flushRow();
      const allBold = body.length && body.every(p => p.b);
      const big = Math.max(...it.parts.flat().map(p => p.size || 0)) >= 18;
      const style = it.free ? (big ? 'lead' : 'plain') : allBold && it.tone === 'gold' ? 'question' : big && !allBold ? 'lead' : 'bar';
      slide.blocks.push({ id: bid(), type: 'text', style, tone: it.tone || (it.free ? 'neutral' : 'blue'), paras: style === 'question' ? body.map(p => ({ text: p.text, ...(p.bullet ? { bullet: true } : {}) })) : body });
    });
    flushRow();
    if (slide.layout === 'content' && !slide.blocks.length && !slide.key && slide.title && (slide.subtitle || slide.kicker)) slide.layout = 'section';
    return slide;
  }

  async function notesOf(z, slidePart) {
    const rl = await rels(z, slidePart);
    const n = [...rl.values()].find(r => r.type.endsWith('/notesSlide')); if (!n) return '';
    const t = await z.text(n.target); if (!t) return '';
    const doc = xml(t);
    return desc(doc, P, 'sp').filter(sp => { const ph = desc(sp, P, 'ph')[0]; return !ph || ph.getAttribute('type') === 'body'; })
      .map(sp => kids(kid(sp, P, 'txBody'), A, 'p').map(p => desc(p, A, 't').map(t => t.textContent).join('')).join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Vrací { title, subtitle, slides:[{data, notes}] }
  async function parse(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Prohlížeč neumí rozbalit .pptx – použijte aktuální Chrome, Edge nebo Firefox.');
    const z = await unzip(await file.arrayBuffer());
    const pres = await z.text('ppt/presentation.xml'); if (!pres) throw new Error('V souboru chybí ppt/presentation.xml – není to prezentace PowerPoint.');
    const pd = xml(pres), sz = desc(pd, P, 'sldSz')[0];
    const W = sz ? +sz.getAttribute('cx') / EMU : 13.333, H = sz ? +sz.getAttribute('cy') / EMU : 7.5;
    const prl = await rels(z, 'ppt/presentation.xml');
    const ids = desc(pd, P, 'sldId').map(s => s.getAttributeNS(R, 'id'));
    const slides = [];
    for (const rid of ids) {
      const part = prl.get(rid) && prl.get(rid).target; if (!part) continue;
      const doc = xml(await z.text(part));
      if (doc.documentElement.getAttribute('show') === '0') continue;    // skrytý snímek
      const tree = desc(doc, P, 'spTree')[0];
      const data = convert(shapesOf(tree), W, H);
      slides.push({ data, notes: await notesOf(z, part) });
    }
    if (!slides.length) throw new Error('V prezentaci nejsou žádné snímky.');
    const first = slides[0].data;
    return { title: first.title || file.name.replace(/\.pptx$/i, ''), subtitle: first.subtitle || '', slides };
  }
  return { parse, tone };
})();
