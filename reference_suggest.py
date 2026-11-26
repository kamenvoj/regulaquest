"""Auditable deterministic *explicit* cross-reference candidates for RegulaQuest.

No AI model, no unreviewed links published, no database mutation here.
The first stage supports citations *within one language version of MDR*.
Other source families must be handled by separate document-aware resolvers.
"""
from __future__ import annotations
import re
from typing import Iterable

ARTICLE = re.compile(r"(?iu)(?<![\w])(?:čl\.|člán(?:ek|ku|ky|ků|kem|cích)|articles?)\s*(\d{1,3}[a-z]?)\b(?:\s*\(\s*(\d{1,2})\s*\)|\s*,?\s*(?:odst\.|odstav(?:ec|ce|ci|ců)|paragraph|para\.)\s*(\d{1,2}))?")
ANNEX = re.compile(r"(?iu)(?<![\w])(?:přílo(?:h|z)[\w]*|annex(?:es)?)\s+([IVXLCDM]{1,8})\b")
RULE = re.compile(r"(?iu)(?<![\w])(?:pravidl[\w]*|rules?)\s*(\d{1,2})\b")
ROMAN = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10,'XI':11,'XII':12,'XIII':13,'XIV':14,'XV':15,'XVI':16,'XVII':17}
SENTENCE_BOUNDARY = re.compile(r'(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ\"„])')


def _word_left(s:str, pos:int)->int:
    """Move a trimmed left cut back to the beginning of a full word."""
    if pos and pos < len(s) and s[pos-1].isalnum() and s[pos].isalnum():
        while pos and s[pos-1].isalnum():pos-=1
    return pos


def _word_right(s:str, pos:int)->int:
    if pos and pos < len(s) and s[pos-1].isalnum() and s[pos].isalnum():
        while pos<len(s) and s[pos].isalnum():pos+=1
    return pos


def quote_excerpt(text:str, start:int, end:int, budget:int=260)->str:
    """Find a complete sentence if possible, otherwise contextual *whole-word* quote.

    The returned quote is a contiguous substring of the legal source text,
    except for explicit leading/trailing omission marks and the paragraph number
    at its start. Never changes legal characters (e.g., PMCFh in source text).
    """
    if not text or not 0 <= start <= end <= len(text):return ''
    # Sentence segmentation is deliberately conservative; boundaries are only whitespace.
    boundaries=[0]
    boundaries += [m.end() for m in SENTENCE_BOUNDARY.finditer(text)]
    boundaries += [len(text)]
    from bisect import bisect_right
    i=bisect_right(boundaries,start)-1
    lo,hi=boundaries[i],boundaries[min(i+1,len(boundaries)-1)]
    if hi-lo<=budget and start>=lo and end<=hi:
        sample=text[lo:hi].strip()
        # Legal paragraph numbering is already represented in the locator.
        sample=re.sub(r'^\d{1,2}\.\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])','',sample,count=1)
        return sample
    left=max(0,start-85)
    right=min(len(text),end+110)
    left=_word_left(text,left)
    right=_word_right(text,right)
    # If a modest local clause is available, avoid clipping an entire sentence.
    if right-left>budget+30:
        right=_word_right(text,max(end,min(len(text),left+budget)))
    frag=text[left:right].strip()
    return ('…' if left>0 else '')+frag+('…' if right<len(text) else '')


def suggest_explicit_links(unit:dict, known_ids:Iterable[str], existing_relations:Iterable[dict]=(), limit:int=60,
                           include_unresolved:bool=False)->list[dict]:
    """Suggest explicit same-document MDR references and optionally unresolved references.

    No inferred range expansion and no implied subject/semantic relationships.
    A candidate only appears if the *source text itself* cites its destination.
    """
    source_id=unit['id']; doc_id=unit['document_id']; text=unit.get('body') or ''
    if doc_id not in ('mdr-cs','mdr-en') or not text.strip():return []
    ids=set(known_ids)
    existing={(r['source_id'],r['target_id'],r['relation_type']):r['status'] for r in existing_relations}
    hits=[]
    for regex,kind in ((ARTICLE,'article'),(ANNEX,'annex'),(RULE,'rule')):
        for match in regex.finditer(text):
            if kind=='article':
                number=match.group(1).lower()
                paragraph=match.group(2) or match.group(3)
                ident=f'{doc_id}-art-{number}'+(f'-par-{int(paragraph)}' if paragraph else '')
            elif kind=='annex':
                roman=match.group(1).upper()
                if roman not in ROMAN:continue
                ident=f'{doc_id}-annex-{roman.lower()}'
            else:
                number=int(match.group(1))
                if number<1 or number>22:continue
                ident=f'{doc_id}-rule-{number}'
            if ident==source_id:continue
            exists=ident in ids
            if not exists and not include_unresolved:continue
            excerpt=quote_excerpt(text,match.start(),match.end())
            hits.append({'source_id':source_id,'target_id':ident if exists else None,
                         'target_hint':ident, 'type':'references','matched_text':match.group(0),
                         'excerpt':excerpt,'position':match.start(),
                         'existing_status':existing.get((source_id,ident,'references')) if exists else None,
                         'resolution':'resolved' if exists else 'unresolved',
                         'reason':'' if exists else 'Odkaz nelze přiřadit k existujícímu ustanovení. Zkontrolujte označení, strukturu nebo cílový dokument.'})
    # Duplicate cites of one target in one source should not create extra proposals.
    seen=set(); result=[]
    for c in sorted(hits,key=lambda x:x['position']):
        ident=c['target_hint']
        if ident not in seen:
            result.append(c);seen.add(ident)
        if len(result)>=limit:break
    return result
