'use strict';
/* RegulaQuest – vykreslování snímků prezentací jednotnou šablonou (Studio i čtečka).
   Snímek je JSON: { layout: 'title'|'section'|'content', badge, kicker, title, subtitle, blocks:[…], key:{text, link}, link }
   Bloky: text {style:'plain'|'lead'|'bar'|'question', tone, paras:[{text, b, bullet, link}], link}
          cards {items:[{heading, tone, paras, link}]}
          table {rows:[[…]], header:true, links:[{row, link}]}
          image {asset, caption, missing, name}
   Odkaz (link) = {unit:'…'} na ustanovení nebo {slide:'…', pres:'…'} na snímek. Tučně v textu: **takto**. */
window.RQSlides = (function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TONES = ['neutral', 'navy', 'blue', 'teal', 'green', 'gold', 'red'];
  const TONE_NAMES = { neutral: 'Šedá', navy: 'Tmavě modrá', blue: 'Modrá', teal: 'Tyrkysová', green: 'Zelená', gold: 'Zlatá', red: 'Červená' };
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

  // Atributy pro odkaz: data-link + třída; opts.href(link) vrací adresu nebo null (neplatný / nedostupný cíl)
  function linkAttr(link, opts, path) {
    if (!link || !(link.unit || link.slide)) return opts.edit ? ` data-path="${esc(path)}"` : '';
    const href = opts.href ? opts.href(link) : null;
    const t = opts.title ? opts.title(link) : '';
    return ` data-path="${esc(path)}" data-link='${esc(JSON.stringify(link))}' class-link="${href ? 'on' : 'off'}"${href ? ` data-href="${esc(href)}"` : ''}${t ? ` title="${esc(t)}"` : ''}`;
  }
  // Třídy doplníme až při sestavení (class-link → class)
  const fixClasses = html => html.replace(/<(\w+)([^>]*?) class="([^"]*)"([^>]*?) class-link="(on|off)"/g, (m, tag, a, cls, b, st) => `<${tag}${a} class="${cls} sl-link ${st === 'on' ? 'sl-go' : 'sl-dead'}"${b}`)
    .replace(/<(\w+)([^>]*?) class-link="(on|off)"/g, (m, tag, a, st) => `<${tag}${a} class="sl-link ${st === 'on' ? 'sl-go' : 'sl-dead'}"`);

  function paras(ps, opts, path) {
    const out = []; let list = null;
    (ps || []).forEach((p, i) => {
      const html = `<span class="sl-t${p.b ? ' sl-b' : ''}"${linkAttr(p.link, opts, path + '.paras.' + i)}>${inline(p.text)}</span>`;
      if (p.bullet) { list = list || []; list.push(`<li>${html}</li>`); }
      else { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } out.push(`<p>${html}</p>`); }
    });
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return out.join('');
  }
  function block(b, i, opts) {
    const path = 'blocks.' + i, tone = TONES.includes(b.tone) ? b.tone : 'neutral';
    if (b.type === 'cards') {
      const n = b.cols || Math.min((b.items || []).length, 6);
      return `<div class="sl-cards n${Math.min(n, 6)}" data-block="${esc(b.id || '')}">${(b.items || []).map((c, k) => `<div class="sl-card tone-${TONES.includes(c.tone) ? c.tone : 'neutral'}"${linkAttr(c.link, opts, path + '.items.' + k)} data-item="${esc(c.id || '')}">
        ${c.heading ? `<div class="sl-ch">${inline(c.heading)}</div>` : ''}<div class="sl-cb">${paras(c.paras, opts, path + '.items.' + k)}</div></div>`).join('')}</div>`;
    }
    if (b.type === 'table') {
      const rows = b.rows || [], links = new Map((b.links || []).map(l => [l.row, l.link]));
      return `<div class="sl-tablewrap" data-block="${esc(b.id || '')}"><table class="sl-table">${rows.map((r, k) => {
        const tag = k === 0 && b.header !== false ? 'th' : 'td';
        return `<tr${links.has(k) ? linkAttr(links.get(k), opts, path + '.row.' + k) : (opts.edit ? ` data-path="${path}.row.${k}"` : '')}>${r.map(c => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
      }).join('')}</table></div>`;
    }
    if (b.type === 'image') {
      return `<figure class="sl-fig" data-block="${esc(b.id || '')}">${b.src ? `<img src="${esc(b.src)}" alt="${esc(b.caption || '')}">` : `<div class="sl-missing">Obrázek${b.name ? ' „' + esc(b.name) + '“' : ''} – doplní se po zapojení úložiště obrázků</div>`}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
    }
    const st = ['lead', 'bar', 'question'].includes(b.style) ? b.style : 'plain';
    return `<div class="sl-text sl-${st} tone-${tone}" data-block="${esc(b.id || '')}"${linkAttr(b.link, opts, path)}>${paras(b.paras, opts, path)}</div>`;
  }

  // slide: data snímku; opts: { n, total, deck (název), href(link), title(link), edit }
  function render(slide, opts = {}) {
    const s = slide || {}, L = ['title', 'section'].includes(s.layout) ? s.layout : 'content';
    let inner;
    if (L === 'title') {
      inner = `<div class="sl-brand"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="17" r="12.5" fill="none" stroke="#E9CB90" stroke-width="1.5"/><path d="M18 5L22 15L30 18L20 22L17 30L14 20L6 17L16 14Z" fill="#E9CB90"/></svg><span>RegulaQuest</span></div>
        ${s.kicker ? `<div class="sl-kicker">${inline(s.kicker)}</div>` : ''}<h2 class="sl-title">${inline(s.title || '')}</h2>${s.subtitle ? `<div class="sl-sub">${inline(s.subtitle)}</div>` : ''}`;
    } else if (L === 'section') {
      inner = `${s.kicker ? `<div class="sl-kicker">${inline(s.kicker)}</div>` : ''}<h2 class="sl-title">${inline(s.title || '')}</h2>${s.subtitle ? `<div class="sl-sub">${inline(s.subtitle)}</div>` : ''}`;
    } else {
      inner = `<div class="sl-head">${s.badge ? `<span class="sl-badge">${esc(s.badge)}</span>` : '<span></span>'}${s.kicker ? `<span class="sl-kicker">${inline(s.kicker)}</span>` : ''}</div>
        <h2 class="sl-title"${linkAttr(s.link, opts, 'slide')}>${inline(s.title || '')}</h2>
        <div class="sl-body">${(s.blocks || []).map((b, i) => block(b, i, opts)).join('')}</div>
        ${s.key && s.key.text ? `<div class="sl-key"${linkAttr(s.key.link, opts, 'key')}><span>Klíčová myšlenka</span>${inline(s.key.text)}</div>` : ''}`;
    }
    const foot = L === 'content' && (opts.deck || opts.n) ? `<div class="sl-foot"><span>${esc(opts.deck || '')}</span><span>${opts.n ? opts.n + (opts.total ? ' / ' + opts.total : '') : ''}</span></div>` : '';
    return fixClasses(`<div class="sl sl-L-${L}"><div class="sl-in">${inner}</div>${foot}</div>`);
  }

  // Když se obsah nevejde, zmenší písmo (až na 70 %)
  function fit(root) {
    (root.matches && root.matches('.sl') ? [root] : [...root.querySelectorAll('.sl')]).forEach(sl => {
      const inn = sl.querySelector('.sl-in'); if (!inn) return;
      let k = 1; sl.style.setProperty('--k', k);
      while (inn.scrollHeight > inn.clientHeight + 1 && k > 0.7) { k = Math.round((k - 0.05) * 100) / 100; sl.style.setProperty('--k', k); }
      sl.classList.toggle('sl-over', inn.scrollHeight > inn.clientHeight + 1);
    });
  }
  // Všechna ustanovení, na která snímek odkazuje
  function units(s) { const out = new Set(); (function walk(o) { if (!o || typeof o !== 'object') return; if (o.link && o.link.unit) out.add(o.link.unit); Object.values(o).forEach(walk); })(s); return [...out]; }
  function plain(s) { const t = []; (function walk(o) { if (typeof o === 'string') return; if (!o || typeof o !== 'object') return; ['title', 'subtitle', 'kicker', 'text', 'heading'].forEach(k => { if (typeof o[k] === 'string') t.push(o[k]); }); if (Array.isArray(o.rows)) o.rows.forEach(r => t.push(r.join(' '))); Object.values(o).forEach(walk); })(s); return t.join(' ').replace(/\*\*/g, ''); }
  return { render, fit, units, plain, TONES, TONE_NAMES, inline, esc };
})();
