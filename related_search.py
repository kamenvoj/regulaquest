"""RegulaQuest: read-only, transparent cross-document search (stdlib only).

NOT a language model and NOT trained semantic embeddings. Exact structural matching
for MDR Annex VIII -> MDCG 2021-24; conservative bilingual lexical candidates.
All candidates require an editorial proposal and independent approval.
"""
from __future__ import annotations
from collections import Counter
from functools import lru_cache
import math
import re
import unicodedata

# Phrases/roots are *search aliases*, not assertions of legal equivalence.
# A limited glossary: conservatively prefer reviewing fewer candidates to
# making legally misleading semantic claims.
CONCEPTS = {
    'software': ('software', 'softwar', 'programove vybaveni', 'mdsw'),
    'classification': ('classification','klasifikac', 'trida rizika', 'risk class'),
    'clinical-evaluation': ('clinical evaluation', 'klinick hodnocen', 'klinicke hodnoceni'),
    'clinical-investigation': ('clinical investigation','klinick zkousk', 'klinicke zkouseni'),
    'conformity': ('conformity assessment', 'posuzovan shod', 'posouzeni shody'),
    'surveillance': ('post market surveillance', 'post-market surveillance', 'dohled nad trhem', 'dozor nad trhem', 'pms'),
    'clinical-followup': ('post-market clinical follow-up','pmcf','nasledne klinicke sledovani'),
    'vigilance': ('vigilance','nezadouci prihod', 'incident reporting', 'serious incident'),
    'risk': ('rizik',' risk','hazard'),
    'diagnosis': ('diagnos','diagnost'),
    'therapy': ('therap','terapeut','lecb','lecba'),
    'monitoring': ('monitor', 'sledovan fyziologick', 'sledovani fyziologick'),
    'physiology': ('physiolog','fyziolog'),
    'vital': ('vital', 'zivotne dulezit'),
    'implant': ('implanta','implant'),
    'invasive': ('invasive', 'invaziv'),
    'non-invasive': ('non-invasive', 'neinvaziv'),
    'active': ('active devices','aktivn prostred', 'active medical'),
    'manufacturer': ('manufactur','vyrobc'),
    'notified-body': ('notified bod', 'oznamen subjekt','notifikovan osob'),
    'sterilization': ('steril', 'steriliz'),
    'disinfection': ('disinfect', 'dezinf'),
    'radiation': ('radiation','zareni'),
    'ionizing': ('ionizing','ionising','ionizuj'),
    'measuring': ('measurement', 'measuring', 'meric', 'mereni'),
    'nanomaterial': ('nanomaterial','nanomaterial'),
    'human-tissue': ('human tissues', 'lidsk tkane', 'human cells'),
    'animal-tissue': ('animal tissues', 'zvirec tkane'),
    'substance': ('substances','latk', 'substance-based'),
    'medicinal-product': ('medicinal product', 'lecivy pripravek', 'lečivý přípravek'),
    'blood': ('blood','krev', 'krevni'),
    'heart': ('heart','srdc', 'kardio'),
    'contact-lenses': ('contact lenses', 'kontaktni cock'),
    'wound': ('wound', 'ran', 'poranen kuze'),
    'surgery': ('surgical', 'chirurg'),
    'duration': ('continuous use', 'long term', 'short term','dlouhodob','kratkodob','doba pouzivani'),
}
STOP = set('a i v z s u na pro pri podle nad pod nebo ale je jsou jako ktere ktery ktera vy se o do od the and of to for in with on or as by from an is are be it its this that which such may all under while more than where shall including include device devices medical product products regulation class rules rule section article annex chapter of eu their will must can a specific use used when based intended purpose applicable apply according part parts one some by as this they more may other between these those manufacturer means medical'.split())
STOP |= set('musi byt ktere jsou jejich tohoto tento tuto take jsou zarizeni prostredku prostredky zdravotnickych zdravotnicky vyrobce vyrobci clanek clanku pravidlo priloha bod cast odstavec odstavce ve vyse nasledujici uvedene'.split())


def norm(text):
    v=unicodedata.normalize('NFKD', str(text or ''))
    v=''.join(c for c in v if not unicodedata.combining(c)).casefold()
    return v.replace('–','-').replace('—','-').replace('\u00a0',' ')


@lru_cache(maxsize=4096)
def text_terms(text):
    words=re.findall(r'[a-z][a-z0-9]{2,}', norm(text))
    return Counter(w for w in words if w not in STOP and not w.isdigit())


@lru_cache(maxsize=4096)
def concepts(text):
    t=' '+norm(text)+' '
    return frozenset(label for label,variants in CONCEPTS.items() if any(norm(v) in t for v in variants))


def rule_number(unit):
    if unit.get('kind')!='rule': return None
    m=re.search(r'(?:^|-)(?:rule-)(\d+)$',unit['id'],re.I)
    if not m: m=re.search(r'\b(?:rule|pravidlo)\s+(\d+)\b',unit.get('label',''),re.I)
    return int(m.group(1)) if m else None


def focused_text(unit):
    """Use a bounded rule-specific PDF span; do not let adjacent headings
    in extraction dominate matching. Never silently correct the PDF text."""
    body=unit.get('body') or ''
    if unit.get('document_id','').startswith('mdcg-') and unit.get('kind')=='rule':
        n=rule_number(unit)
        if n:
            # Rule heading starts a line; don't accidentally match a reference to it.
            matches=list(re.finditer(r'(?im)^\s*Rule\s+'+str(n)+r'\s*(?:[-–—]|Devices|Software|Active|:|\b)',body))
            if matches:
                start=matches[0].start()
                tail=body[start:]
                nxt=re.search(r'(?im)^\s*Rule\s+(\d+)\s*(?:[-–—]|Devices|Software|Active|:|\b)',tail[len(matches[0].group()):])
                if nxt and int(nxt.group(1))!=n:
                    body=tail[:len(matches[0].group())+nxt.start()]
                else:body=tail
    return body[:12000]


def preview(text, max_len=420):
    clean=re.sub(r'\s+',' ',text or '').strip()
    if len(clean)<=max_len:return clean
    cutoff=clean[:max_len].rfind(' ')
    return clean[:max(cutoff,max_len-45)].rstrip()+'…'


def _key_match(source,target):
    left_mdr=source.get('document_id','') in ('mdr-cs','mdr-en')
    right_mdr=target.get('document_id','') in ('mdr-cs','mdr-en')
    left_mdcg=source.get('document_id','')=='mdcg-2021-24-en'
    right_mdcg=target.get('document_id','')=='mdcg-2021-24-en'
    return ((left_mdr and right_mdcg) or (left_mdcg and right_mdr)) and (rule_number(source) is not None and rule_number(source)==rule_number(target))



def _lexical_score(src,tgt):
    a,b=concepts(src),concepts(tgt)
    common=sorted(a&b)
    ta,tb=text_terms(src),text_terms(tgt)
    # Query-side coverage, but require multiple meaningful shared terms and
    # respect document length; common generic 'risk/class/device' is not enough.
    shared={w for w in ta if w in tb and len(w)>=5}
    token_strength=sum(min(ta[w],2) for w in shared)/max(1,sum(min(v,2) for v in ta.values()))
    weighted=sum(2.0 if c in ('software','clinical-evaluation','clinical-followup','conformity','vigilance','implant','sterilization','nanomaterial') else 1.0 for c in common)
    score=weighted*2 + token_strength*10
    return score,common,sorted(shared,key=lambda w:(-min(ta[w],tb[w]),w))[:9]


def find_related(source, targets, relations, documents, limit=20):
    """Return grounded candidates, no writes, no external services.

    `source` and `targets` are sqlite dicts. Ranking is a heuristic, NOT a
    probability or expert confidence. Exact-number rules only apply to the
    MDR Annex VIII / MDCG classification guidance pair.
    """
    src=focused_text(source)
    if not src.strip():return []
    existing={(r['source_id'],r['target_id']):r['status'] for r in relations
              if r.get('status') not in ('rejected','archived')}
    docmap={d['id']:d for d in documents}
    output=[]
    for target in targets:
        if target['document_id']==source['document_id'] or target['id']==source['id']:continue
        # MDCG chapters are PDF page-span duplicates of their nested rules.
        # For an MDR classification rule, compare to actual rule records only.
        if (source.get('document_id') in ('mdr-cs','mdr-en') and
            source.get('kind')=='rule' and target.get('document_id')=='mdcg-2021-24-en' and
            target.get('kind')!='rule'):continue
        dest=focused_text(target)
        if not dest.strip():continue
        structural=_key_match(source,target)
        score,shared_concepts,shared_terms=_lexical_score(src,dest)
        # Avoid proposing links solely because both passages discuss general
        # treatment / diagnosis / surgical procedures. Require a distinctive
        # shared medical-device topic or several unusually exact terms.
        distinctive={'software','clinical-evaluation','clinical-investigation',
            'clinical-followup','conformity','surveillance','vigilance','implant',
            'sterilization','disinfection','radiation','ionizing','nanomaterial',
            'animal-tissue','human-tissue','blood','contact-lenses','wound',
            'medicinal-product','measuring','notified-body','invasive'}
        strong=set(shared_concepts)&distinctive
        if not structural and not (score>=5.0 and (strong or len(shared_terms)>=6) and
                                   (len(shared_concepts)>=2 or len(shared_terms)>=6)):
            continue
        # Keep metadata and natural-language explanation grounded and modest.
        is_guidance=docmap.get(target['document_id'],{}).get('document_type')=='guidance'
        rel_type='guidance' if is_guidance and docmap.get(source['document_id'],{}).get('document_type') in ('regulation','law','directive') else 'related'
        match_kind='structural-rule' if structural else 'lexical-bilingual'
        why=(f'Shodné číslo klasifikačního pravidla {rule_number(source)} v příloze VIII MDR a v MDCG 2021-24. '
             'Jde o strukturální kandidát; přesný obsah, rozsah výkladu a význam vazby musí potvrdit redaktor.'
             if structural else 'Shoda odborných pojmů nebo výrazů z malého česko-anglického slovníku; neprokazuje sama o sobě metodický vztah.')
        warnings=[]
        if source.get('text_status')!='verified':warnings.append('Zdrojový text dosud nebyl ověřen.')
        if target.get('text_status')!='verified':warnings.append('Cílový text dosud nebyl ověřen.')
        if target['document_id'].startswith('mdcg-'):
            raw=target.get('body') or ''
            found={int(v) for v in re.findall(r'(?im)^\s*Rule\s+(\d+)\b',raw)}
            if any(n!=rule_number(target) for n in found):
                warnings.append('Extrahovaný PDF text může zasahovat do sousedního pravidla; prohlédněte originální strany.')
        srcdoc=docmap.get(source['document_id'],{})
        tdoc=docmap.get(target['document_id'],{})
        source_location=(source.get('locator') or source.get('label') or source['id'])
        target_location=(target.get('locator') or target.get('label') or target['id'])
        evidence=(f'{srcdoc.get("family",source["document_id"])} {srcdoc.get("language", "").upper()}, {source_location}; '
                  f'{tdoc.get("family",target["document_id"])} {tdoc.get("language", "").upper()}, {target_location}. '
                  'Před schválením porovnejte obě ustanovení s oficiálními originály.')
        output.append({
            'source_id':source['id'], 'target_id':target['id'],
            'match_kind':match_kind,'method':'transparent-structure-and-lexical-v1',
            'suggested_relation_type':rel_type, 'explanation':why,
            'matched_concepts':shared_concepts[:8], 'matched_terms':shared_terms,
            'source_status':source.get('text_status','missing'), 'target_status':target.get('text_status','missing'),
            'target_excerpt':preview(dest,330), 'target_locator':target_location,
            'warnings':warnings,'existing_status':existing.get((source['id'],target['id'])),
            'rationale':why, 'evidence':evidence,
            '_rank':(1000 if structural else 0) + score
        })
    output.sort(key=lambda x:(-x['_rank'],x['target_id']))
    for o in output:o.pop('_rank',None)
    return output[:limit]


# Batch scan intentionally avoids parent records that duplicate child text.
# It offers a *shortlist*, not an exhaustive judgment of legal relevance.
def _leaf_passages(units):
    nonempty=[u for u in units if (u.get('body') or '').strip()]
    parents={u.get('parent_id') for u in nonempty if u.get('parent_id')}
    return [u for u in nonempty if u['id'] not in parents]


def find_related_bulk(sources, targets, relations, documents, per_source_limit=3, result_cap=1000):
    """Read-only cross-document shortlist for an entire source document.

    Redundant parent spans are skipped; each source contributes a bounded number
    of lexical candidates plus any matching classification rule. Existing links
    appear for review but are never recreated. This is NOT semantic AI.
    """
    if not 1<=per_source_limit<=8 or not 1<=result_cap<=1500:
        raise ValueError('Neplatný limit analýzy.')
    source_leaves=_leaf_passages(sources)
    target_leaves=_leaf_passages(targets)
    # A cheap first-pass shortlist; each target can be reused efficiently through
    # cached concepts/text_terms, and PDF child pages are not rescanned as parents.
    results=[]
    structural_count=0
    for source in source_leaves:
        candidates=find_related(source, target_leaves, relations, documents,
                                limit=max(25,per_source_limit+2))
        structural=[x for x in candidates if x['match_kind']=='structural-rule']
        lexical=[x for x in candidates if x['match_kind']!='structural-rule'][:per_source_limit]
        structural_count+=len(structural)
        results.extend(structural+lexical)
    # Prefer inspectable exact rule correspondences, followed by lexical review.
    results.sort(key=lambda c:(0 if c['match_kind']=='structural-rule' else 1,
                               0 if not c.get('existing_status') else 1,
                               c['source_id'],c['target_id']))
    return {
        'results':results[:result_cap],
        'total_candidates':len(results),
        'truncated':len(results)>result_cap,
        'structural_count':structural_count,
        'scanned_sources':len(source_leaves),
        'skipped_parent_sources':len([u for u in sources if (u.get('body') or '').strip()])-len(source_leaves),
        'scanned_targets':len(target_leaves),
        'skipped_parent_targets':len([u for u in targets if (u.get('body') or '').strip()])-len(target_leaves),
        'per_source_limit':per_source_limit,
    }
