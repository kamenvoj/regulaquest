'use strict';
/* RegulaQuest – návrhy výslovných odkazů (přepis reference_suggest.py).
   Bez AI: návrh vznikne jen tam, kde zdrojový text cíl výslovně uvádí („článek 61“, „příloha XIV“,
   „pravidlo 11“). Hledá se v rámci téhož dokumentu. Nic se neukládá ani neschvaluje samo. */
(function () {
  const ARTICLE = /(?<![\p{L}\p{N}_])(?:čl\.|člán(?:ek|ku|ky|ků|kem|cích)|articles?)\s*(\d{1,3}[a-z]?)\b(?:\s*\(\s*(\d{1,2})\s*\)|\s*,?\s*(?:odst\.|odstav(?:ec|ce|ci|ců)|paragraph|para\.)\s*(\d{1,2}))?/giu;
  const ANNEX = /(?<![\p{L}\p{N}_])(?:přílo(?:h|z)\p{L}*|annex(?:es)?)\s+([IVXLCDM]{1,8})\b/giu;
  const RULE = /(?<![\p{L}\p{N}_])(?:pravidl\p{L}*|rules?)\s*(\d{1,2})\b/giu;
  const ROMAN = new Set(['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV']);
  const SENTENCE = /(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"„])/gu;
  const alnum = c => /[\p{L}\p{N}]/u.test(c || '');

  function wordLeft(s, p) { if (p && p < s.length && alnum(s[p - 1]) && alnum(s[p])) while (p && alnum(s[p - 1])) p--; return p; }
  function wordRight(s, p) { if (p && p < s.length && alnum(s[p - 1]) && alnum(s[p])) while (p < s.length && alnum(s[p])) p++; return p; }

  // Celá věta s odkazem, jinak souvislý úryvek po celých slovech; text se nemění.
  function excerpt(text, start, end, budget = 260) {
    const b = [0, ...[...text.matchAll(SENTENCE)].map(m => m.index + m[0].length), text.length];
    let i = 0; while (i + 1 < b.length && b[i + 1] <= start) i++;
    const lo = b[i], hi = b[Math.min(i + 1, b.length - 1)];
    if (hi - lo <= budget && start >= lo && end <= hi)
      return text.slice(lo, hi).trim().replace(/^\d{1,2}\.\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/u, '');
    let left = wordLeft(text, Math.max(0, start - 85)), right = wordRight(text, Math.min(text.length, end + 110));
    if (right - left > budget + 30) right = wordRight(text, Math.max(end, Math.min(text.length, left + budget)));
    return (left > 0 ? '…' : '') + text.slice(left, right).trim() + (right < text.length ? '…' : '');
  }

  // Odkazy v jedné části: cíle s identifikátorem dokument-art-N(-par-M), -annex-X, -rule-N.
  function suggest(unit, known, relations, includeUnresolved = false) {
    const text = unit.body || '', doc = unit.document_id;
    if (!text.trim()) return [];
    const existing = new Map(relations.filter(r => r.source_id === unit.id && r.relation_type === 'references').map(r => [r.target_id, r.status]));
    const hits = [];
    const add = (m, ident) => {
      if (ident === unit.id) return;
      const ok = known.has(ident);
      if (!ok && !includeUnresolved) return;
      hits.push({ source_id: unit.id, target_id: ok ? ident : null, target_hint: ident, matched_text: m[0],
                  excerpt: excerpt(text, m.index, m.index + m[0].length), position: m.index,
                  existing_status: ok ? existing.get(ident) ?? null : null, resolved: ok });
    };
    for (const m of text.matchAll(ARTICLE)) {
      const par = m[2] || m[3];
      add(m, `${doc}-art-${m[1].toLowerCase()}` + (par ? `-par-${Number(par)}` : ''));
    }
    for (const m of text.matchAll(ANNEX)) { const r = m[1].toUpperCase(); if (ROMAN.has(r)) add(m, `${doc}-annex-${r.toLowerCase()}`); }
    for (const m of text.matchAll(RULE)) add(m, `${doc}-rule-${Number(m[1])}`);
    const seen = new Set();
    return hits.sort((a, b) => a.position - b.position).filter(h => !seen.has(h.target_hint) && seen.add(h.target_hint));
  }

  // Celý dokument nebo jedna část. Odkaz uvedený v odstavci se nenabízí znovu za celý článek.
  function scan(units, docUnits, relations, docs) {
    const known = new Set(units.filter(u => !u.editor_archived).map(u => u.id));
    const byId = new Map(docUnits.map(u => [u.id, u]));
    const raw = new Map();
    for (const u of docUnits) if (!u.editor_archived && String(u.body || '').trim()) raw.set(u.id, suggest(u, known, relations, true));
    const below = new Map();
    for (const [id, refs] of raw) {
      if (!refs.length) continue;
      let parent = byId.get(id)?.parent_id; const visited = new Set([id]);
      while (parent && !visited.has(parent) && byId.has(parent)) {
        visited.add(parent);
        if (!below.has(parent)) below.set(parent, new Set());
        refs.forEach(c => below.get(parent).add(c.target_hint));
        parent = byId.get(parent).parent_id;
      }
    }
    const out = [];
    for (const [id, refs] of raw) {
      const u = byId.get(id), d = docs.get(u.document_id);
      for (const c of refs) {
        if (below.get(id)?.has(c.target_hint)) continue;
        out.push({ ...c, source: u, category: !c.resolved ? 'unresolved' : c.existing_status != null ? 'existing' : 'new',
                   evidence: `${d ? d.family + ' ' + d.language.toUpperCase() : 'Dokument'}, ${(u.locator || u.label).trim()}: „${c.excerpt}“` });
      }
    }
    return out;
  }

  window.RQRefs = { suggest, scan, excerpt };
})();
