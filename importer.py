"""Import legislativních dokumentů do návrhů, nikdy automaticky neověřuje text.

Bez externích závislostí pro EUR-Lex HTML. Pro PDF využívá volitelnou knihovnu PyMuPDF.
Tento parser je pilotní: vyžaduje kontrolu úplnosti, tabulek, grafiky a hierarchie.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from html.parser import HTMLParser
import hashlib
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlsplit

@dataclass
class UnitDraft:
    id: str
    document_id: str
    parent_id: Optional[str]
    kind: str
    label: str
    heading: str
    body: str
    locator: str
    sort_order: int
    source_note: str

@dataclass
class Parsed:
    drafts: list[UnitDraft]
    info: dict
    warnings: list[str]

class _BlockReader(HTMLParser):
    # EUR-Lex HTML uses p headings and p legal paragraphs; preserve visible table cells.
    BLOCKS={'p','h1','h2','h3','h4','h5','h6','li','tr'}
    SKIP={'script','style','noscript','svg','head'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks=[];self.current=[];self.level=0;self.skip=0;self.cell=0
    def handle_starttag(self,tag,attrs):
        if tag in self.SKIP:
            self.skip+=1
        if self.skip: return
        if tag in self.BLOCKS:
            if self.level==0:self.current=[]
            if tag=='li':self.current.append('• ')
            self.level+=1
        if tag in ('td','th') and self.level:
            if self.cell:self.current.append(' | ')
            self.cell+=1
        if tag=='br' and self.level:self.current.append('\n')
    def handle_endtag(self,tag):
        if tag in self.SKIP:
            self.skip=max(0,self.skip-1);return
        if self.skip:return
        if tag in self.BLOCKS and self.level:
            self.level-=1
            if self.level==0:
                t=''.join(self.current).replace('\xa0',' ')
                t='\n'.join(re.sub(r'[ \t]+',' ',q).strip() for q in t.splitlines())
                t=t.strip()
                if t:self.blocks.append(t)
                self.current=[];self.cell=0
    def handle_data(self,data):
        if self.level and not self.skip:self.current.append(data)

ART=re.compile(r'^(?:Článek|Article)\s+(\d{1,3})$',re.IGNORECASE)
ANN=re.compile(r'^(?:PŘÍLOHA|ANNEX)\s+([IVXLCDM]+)$',re.IGNORECASE)
# EUR-Lex classification headings commonly begin with a structural section index,
# e.g. '6.3. Pravidlo 11', '6.3. | Pravidlo 11' (HTML table cells),
# or '6.3. Rule 11'. Do NOT match ordinary textual references to a rule.
RULE=re.compile(r'^(?:\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*(?:\|\s*)?)?(?:Pravidlo|Rule)\s+(\d{1,2})\s*\.?$',re.IGNORECASE)
PARA=re.compile(r'^(\d{1,3})\.\s*(.*)$')
ROMAN={'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10,'XI':11,'XII':12,'XIII':13,'XIV':14,'XV':15,'XVI':16,'XVII':17}

# Editorial consolidation marks (e.g. ►M1 text ◄) are not part of the
# operative wording. We keep their provenance separately; strip ONLY markers.
EDIT_MARK = re.compile(r'[►▼▶]\s*(?:M\d{1,2}|C\d{1,2}|B)\b\s*', re.I)
CHANGE_TOKEN = re.compile(r'[►▼▶]\s*((?:M|C)\d{1,2})\b', re.I)
IS_ITEM = re.compile(r'^(?:\d{1,3}\s*[.)]|\(\d{1,3}\)|[a-z]{1,2}\))$', re.I)

def _clean_block(s: str) -> str:
    # Remove EUR-Lex editorial delimiters, without erasing the amended wording.
    s=EDIT_MARK.sub('',s).replace('◄','')
    # In EUR-Lex's legal tables, cell one may be the list label and cell two text.
    s=re.sub(r'^\s*((?:\d{1,3}[.)]|\(\d{1,3}\)|[a-z]{1,2}\)))\s*\|\s*',r'\1 ',s,flags=re.I)
    s=re.sub(r'^\s*(\d{1,3}\.)\s*\|\s*',r'\1 ',s)
    s=re.sub(r'\s+([,;:.])',r'\1',s)
    return s.strip(' \t|')

def _compact(blocks):
    # Preserve enumerations / lettered subpoints even if HTML has the marker
    # and the following text in separate cells or paragraphs.
    out=[]
    for raw in blocks:
        x=_clean_block(raw)
        if not x:continue
        if out and IS_ITEM.fullmatch(out[-1]) and not IS_ITEM.fullmatch(x):
            out[-1] += ' ' + x
        else:out.append(x)
    return '\n\n'.join(out)

def _marks(blocks):
    return sorted({m.upper() for b in blocks for m in CHANGE_TOKEN.findall(b)}, key=lambda s:(s[0],int(s[1:])))

class _LinkReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links=[];self.href=None;self.words=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.href=dict(attrs).get('href','');self.words=[]
    def handle_data(self,s):
        if self.href is not None:self.words.append(s)
    def handle_endtag(self,tag):
        if tag=='a' and self.href is not None:
            self.links.append((' '.join(''.join(self.words).split()),self.href))
            self.href=None;self.words=[]

def _source_legend(html,frontmatter):
    # Derived ONLY from the downloaded EUR-Lex amendment list, not guessed.
    reader=_LinkReader();reader.feed(html)
    links=reader.links
    legend={}
    for raw in frontmatter:
        s=' '.join(raw.split())
        m=re.match(r'^[►▼▶]?\s*((?:M|C)\d{1,2})\s*(?:\|\s*)?(.*)$',s,re.I)
        if not m:continue
        mark=m.group(1).upper();remainder=m.group(2).strip()
        if not remainder:continue
        title=remainder.split(' | ')[0].strip(' |')[:350]
        if len(title)<8:continue
        legend[mark]={'marker':mark,'title':title,'kind':'corrigendum' if mark.startswith('C') else 'amending_act','url':''}
    for mark,entry in legend.items():
        # The EUR-Lex amendment ledger has a clickable ►M1 / ►C1 marker.
        for label,href in links:
            if re.fullmatch(r'[►▼▶]?\s*'+re.escape(mark)+r'\s*',label,re.I):
                full=urljoin('https://eur-lex.europa.eu',href)
                u=urlsplit(full)
                if u.scheme=='https' and u.netloc=='eur-lex.europa.eu' and '/legal-content/' in u.path:
                    entry['url']=full;break
    return legend

def _parse_mdr_legacy(content:bytes,doc_id:str,filename:str='') -> Parsed:
    if doc_id not in ('mdr-cs','mdr-en'):raise ValueError('Pro MDR zvolte mdr-cs nebo mdr-en')
    lang=doc_id.rsplit('-',1)[-1]
    try:
        from charset_normalizer import from_bytes
        html=str(from_bytes(content).best())
    except ImportError:
        # Official EUR-Lex pages are UTF-8, often with a UTF-8 BOM.
        try: html=content.decode('utf-8-sig')
        except UnicodeDecodeError: html=content.decode('windows-1250' if lang=='cs' else 'latin-1')
    reader=_BlockReader();reader.feed(html)
    blocks=reader.blocks
    warnings=[]
    if len(blocks)<80:raise ValueError('Soubor neobsahuje dost strukturovaných odstavců EUR-Lex HTML. Stáhněte variantu HTML (ne webovou stránku s navigací).')
    # Ignore source front matter. Stop at annexes / article sections, not preamble recitals.
    starts=[];in_act=False;in_annex=False
    for i,t in enumerate(blocks):
        x=re.sub(r'\s+',' ',t).strip()
        am=ART.fullmatch(x); an=ANN.fullmatch(x)
        if am and 1<=int(am.group(1))<=123:
            if in_annex:continue
            if int(am.group(1))==1:in_act=True
            if in_act:starts.append((i,'article',int(am.group(1))))
        elif an and an.group(1).upper() in ROMAN and in_act:
            in_annex=True
            starts.append((i,'annex',an.group(1).upper()))
    # Reject English text accidentally assigned to the Czech document (and vice versa).
    titles=' '.join(blocks[:250])
    cs_titles=len(re.findall(r'(?<!\w)Článek\s+\d+',titles,re.I))
    en_titles=len(re.findall(r'(?<!\w)Article\s+\d+',titles,re.I))
    if (lang=='cs' and en_titles>cs_titles*2 and en_titles>=3) or (lang=='en' and cs_titles>en_titles*2 and cs_titles>=3):
        raise ValueError('Jazyk vloženého dokumentu neodpovídá vybrané jazykové verzi MDR.')
    if not starts or not any(k=='article' for _,k,_ in starts):
        raise ValueError('Nelze najít nadpisy článků. Zkontrolujte staženou HTML verzi EUR-Lex.')
    drafts=[]; source=f'EUR-Lex, 02017R0745-20260719, {lang.upper()}, {filename}; automatický import, nutná kontrola originálu.'
    legend=_source_legend(html,blocks[:starts[0][0]])
    unit_marks={}
    article_nums=[];annex_names=[]; rules=[]; rule_candidates=[]
    for z,(pos,kind,num) in enumerate(starts):
        end=starts[z+1][0] if z+1<len(starts) else len(blocks)
        chunk=blocks[pos+1:end]
        if kind=='article':
            article_nums.append(num)
            ident=f'{doc_id}-art-{num}'
            heading=(chunk[0][:250] if chunk else '')
            unit_marks[ident]=_marks(chunk)
            drafts.append(UnitDraft(ident,doc_id,None,'article',f'Článek {num}' if lang=='cs' else f'Article {num}',heading,_compact(chunk),f'{"Článek" if lang=="cs" else "Article"} {num}',100+num,source))
            # Extract clearly numbered paragraphs only; keep full article body as authoritative reference parent.
            starts_p=[]
            for j,b in enumerate(chunk):
                m=PARA.match(b.replace('\n',' ').strip())
                if m and 1<=int(m.group(1))<=99 and (m.group(2)=='' or len(m.group(2))>10):starts_p.append((j,int(m.group(1))))
            if len(starts_p)>=2 and starts_p[0][1]==1:
                for q,(pi,n) in enumerate(starts_p):
                    pe=starts_p[q+1][0] if q+1<len(starts_p) else len(chunk)
                    part=_compact(chunk[pi:pe]);
                    if part:
                        unit_marks[f'{ident}-par-{n}']=_marks(chunk[pi:pe])
                        drafts.append(UnitDraft(f'{ident}-par-{n}',doc_id,ident,'paragraph',f'Odstavec {n}' if lang=='cs' else f'Paragraph {n}','',part,f'{num}({n})',10_000+num*100+n,source))
        elif kind=='annex':
            annex_names.append(num)
            ident=f'{doc_id}-annex-{num.lower()}'
            heading=chunk[0][:250] if chunk else ''
            unit_marks[ident]=_marks(chunk)
            drafts.append(UnitDraft(ident,doc_id,None,'annex',f'Příloha {num}' if lang=='cs' else f'Annex {num}',heading,_compact(chunk),f'Annex {num}',20_000+ROMAN[num]*1000,source))
            if num=='VIII':
                rule_b=[]
                for j,t in enumerate(chunk):
                    clean=' '.join(t.split())
                    if re.search(r'^(?:\d{1,2}\.\d{1,2}\.\s*(?:\|\s*)?)?(?:Pravidlo|Rule)\s+\d{1,2}\b',clean,re.I) and len(clean)<200:
                        rule_candidates.append(clean[:160])
                    rm=RULE.fullmatch(clean)
                    if rm and 1<=int(rm.group(1))<=22:rule_b.append((j,int(rm.group(1))))
                for q,(rp,rn) in enumerate(rule_b):
                    re_=rule_b[q+1][0] if q+1<len(rule_b) else len(chunk)
                    rb=chunk[rp:re_]; rbody=_compact(rb)
                    if len(rbody)<15:continue
                    rules.append(rn)
                    unit_marks[f'{doc_id}-rule-{rn}']=_marks(rb)
                    drafts.append(UnitDraft(f'{doc_id}-rule-{rn}',doc_id,ident,'rule',f'Pravidlo {rn}' if lang=='cs' else f'Rule {rn}',rb[1][:200] if len(rb)>1 else '',rbody,f'Annex VIII · Rule {rn}',28_000+rn,source))
    ac=len(set(article_nums));nx=len(set(annex_names));rn=len(set(rules))
    if ac<115:warnings.append(f'Nalezeno pouze {ac} jedinečných článků (očekáváno přibližně 123). Zkontrolujte import a úplnost.')
    if nx<16:warnings.append(f'Nalezeno pouze {nx} příloh (očekáváno 17). Zkontrolujte obsah.')
    if rn<20:warnings.append(f'Nalezeno pouze {rn} klasifikačních pravidel přílohy VIII (očekáváno 22).')
    if not any(d.kind=='rule' for d in drafts):warnings.append('Pravidla v příloze VIII nebyla spolehlivě rozpoznána. Nepublikujte jejich vazby bez ověření.')
    warnings.append('Členění, tabulky a poznámky pod čarou nadále vyžadují porovnání s oficiálním HTML. Značky změn jsou skryty ve čtecím textu a vedeny jako metadata.')
    return Parsed(drafts,{'format':'eurlex-html','document_id':doc_id,'articles':ac,'annexes':nx,'rules':rn,'rule_candidates':rule_candidates[:25], 'amendments':legend, 'unit_amendments':unit_marks, 'blocks':len(blocks),'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()},warnings)



def parse_mdr_html(content:bytes,doc_id:str,filename:str='') -> Parsed:
    """For real EUR-Lex XHTML, parse source DOM instead of lossy text blocks.
    Legacy parser remains solely for old synthetic fixtures/non-ELI HTML.
    """
    if doc_id not in ('mdr-cs','mdr-en'):
        raise ValueError('Pro MDR zvolte mdr-cs nebo mdr-en')
    html=content.decode('utf-8-sig')
    if not re.search(r'\bid\s*=\s*[\"\']art_1[\"\']',html):
        return _parse_mdr_legacy(content,doc_id,filename)
    from eurlex_dom import Tree, render, section_body, audit, full_text, clean, inline, classification_rules, find_title, source_legend, amendment_marks, previous_amendment
    reader=Tree();reader.feed(html)
    lang=doc_id.rsplit('-',1)[-1]
    art_nodes=[];ann_nodes=[]
    for key,node in reader.by_id.items():
        m=re.fullmatch(r'art_(\d{1,3})([a-z]?)',key,re.I)
        if m and node.tag=='div':art_nodes.append((int(m.group(1)),m.group(2).lower(),node))
        m=re.fullmatch(r'anx_([IVXLCDM]+)',key,re.I)
        if m and node.tag=='div':ann_nodes.append((m.group(1).upper(),node))
    art_nodes.sort(key=lambda x:(x[0],x[1]));ann_nodes.sort(key=lambda x:ROMAN.get(x[0],999))
    if not art_nodes:raise ValueError('V HTML chybí články s identifikátory art_1, art_2 atd.')
    if not re.search(r'32017R0745',html[:5000],re.I) or '19.07.2026' not in html[:5000]:
        raise ValueError('Tento importér očekává MDR, konsolidované znění k 19. 7. 2026. Vybraný soubor má jinou identifikaci nebo datum.')
    # EUR-Lex uses a non-breaking space in headings like 'Article\u00a01'.
    # Inspect the explicit document language and the actual article heading,
    # rather than searching for the ASCII-space string in the entire article.
    declared_lang=next((n.attrs.get('content','').upper() for n in reader.root.elements()
                        if n.tag=='meta' and n.attrs.get('name','').lower()=='wt.z_usr_lan'), '')
    first_heading=next((n for n in art_nodes[0][2].direct()
                        if n.cls('title-article-norm')), None)
    article_label=clean(inline(first_heading)) if first_heading is not None else ''
    expected_label='Článek 1' if lang=='cs' else 'Article 1'
    if (declared_lang and declared_lang != lang.upper()) or article_label != expected_label:
        raise ValueError('Jazyk HTML neodpovídá zvolené verzi MDR.')
    # Legend is derived from original amendment list, never fabricated.
    legend=source_legend(reader)
    warnings=[];drafts=[];marks={};stats={};bad=[];sample=[]
    source=f'EUR-Lex, 02017R0745-20260719, {lang.upper()}, {filename}; automatický import, nutná kontrola originálu.'
    for num,suffix,node in art_nodes:
        ident=f'{doc_id}-art-{num}{suffix}'
        children=list(node.direct())
        # Skip top article label and article title box.
        skip=[x for x in children if x.cls('title-article-norm') or x.cls('eli-title')]
        body_nodes=[x for x in children if x not in skip]
        body='\n\n'.join(t for x in body_nodes if (t:=render(x)))
        quality=audit(body_nodes,body)
        stats[ident]=quality
        if quality['coverage']<0.999999 or not quality['same_sequence']:
            bad.append({'id':ident,**quality})
        heading=find_title(node,'stitle-article-norm')
        label=f'{"Článek" if lang=="cs" else "Article"} {num}{suffix}'
        marks[ident]=sorted(set(amendment_marks(node)+previous_amendment(node)))
        drafts.append(UnitDraft(ident,doc_id,None,'article',label,heading,body,
                               label,10000+num*100+(ord(suffix)-96 if suffix else 0),source))
        # Paragraphs 1., 2., ... are div.norm with span.no-parag; no regex on raw text.
        paragraphs=[]
        for j,child in enumerate(body_nodes):
            if child.tag!='div' or not child.cls('norm'):continue
            numspan=next((c for c in child.direct() if c.cls('no-parag')),None)
            if numspan:
                m=re.fullmatch(r'(\d{1,3})\.',clean(inline(numspan)))
                if m:paragraphs.append((j,int(m.group(1))))
        # Only create indexed children if numbering starts from 1 and is sequential.
        if paragraphs and paragraphs[0][1]==1 and [n for _,n in paragraphs]==list(range(1,len(paragraphs)+1)):
            for k,(i,n) in enumerate(paragraphs):
                end=paragraphs[k+1][0] if k+1<len(paragraphs) else len(body_nodes)
                parts=body_nodes[i:end]
                pb='\n\n'.join(t for x in parts if (t:=render(x)))
                pid=f'{ident}-par-{n}'
                marks[pid]=sorted(set(m for x in parts for m in amendment_marks(x)))
                drafts.append(UnitDraft(pid,doc_id,ident,'paragraph',
                        f'{"Odstavec" if lang=="cs" else "Paragraph"} {n}','',pb,
                        f'{label}({n})',200000+num*100+n,source))
    for roman,node in ann_nodes:
        ident=f'{doc_id}-annex-{roman.lower()}'
        children=list(node.direct())
        title=next((clean(inline(c)) for c in children if c.cls('title-gr-seq-level-1')),roman)
        body='\n\n'.join(t for x in children if (t:=render(x)))
        qual=audit(children,body);stats[ident]=qual
        if qual['coverage']<0.999999 or not qual['same_sequence']:
            bad.append({'id':ident,**qual})
        marks[ident]=sorted(set(amendment_marks(node)+previous_amendment(node)))
        drafts.append(UnitDraft(ident,doc_id,None,'annex',
                    f'{"Příloha" if lang=="cs" else "Annex"} {roman}',title,
                    body,f'Annex {roman}',500000+ROMAN.get(roman,999)*1000,source))
        if roman=='VIII':
            allkids,rules=classification_rules(node)
            for k,(pos,n,rule_title) in enumerate(rules):
                end=rules[k+1][0] if k+1<len(rules) else len(allkids)
                # Include following rule text but not later chapter headings.
                rnodes=allkids[pos:end]
                rb='\n\n'.join(t for x in rnodes if (t:=render(x)))
                rid=f'{doc_id}-rule-{n}'
                qual=audit(rnodes,rb);stats[rid]=qual
                if qual['coverage']<0.999999 or not qual['same_sequence']:
                    bad.append({'id':rid,**qual})
                marks[rid]=sorted(set(m for x in rnodes for m in amendment_marks(x)))
                drafts.append(UnitDraft(rid,doc_id,ident,'rule',
                            f'{"Pravidlo" if lang=="cs" else "Rule"} {n}',rule_title,
                            rb,f'Annex VIII · Rule {n}',608000+n,source))
    article_count=len(art_nodes);annex_count=len(ann_nodes)
    rule_nums=[int(d.label.split()[-1]) for d in drafts if d.kind=='rule']
    # Completeness is based on original visible words, not only title counts.
    min_coverage=min((v['coverage'] for v in stats.values()),default=0)
    expected=len([x for x in art_nodes if x[1]==''])
    ok=(expected==123 and sorted(n for n,s,_ in art_nodes if not s)==list(range(1,124))
        and article_count==124 and sorted((f'{n}{suffix}' for n,suffix,_ in art_nodes if suffix))==['10a']
        and [x for x,_ in ann_nodes]==list(ROMAN)
        and sorted(rule_nums)==list(range(1,23)) and not bad)
    if bad:warnings.append(f'ZTRÁTA TEXTU: {len(bad)} částí nesplnilo kontrolu znaků v původním pořadí. Import je zablokován.')
    if not ok and not bad:warnings.append('Struktura dokumentu neodpovídá známému MDR k 19. 7. 2026 (včetně článku 10a). Import je zablokován.')
    warnings.append('Automatická slovní kontrola nezaručuje úplnou věrnost struktury, tabulek, odkazů a poznámek pod čarou. Před schválením porovnejte se zdrojem.')
    return Parsed(drafts,{
        'format':'eurlex-html','document_id':doc_id,'articles':expected,
        'articles_total':article_count,'inserted_articles':[f'{n}{suffix}' for n,suffix,_ in art_nodes if suffix],
        'annexes':annex_count,'rules':len(rule_nums),'rule_candidates':[x.heading for x in drafts if x.kind=='rule'],
        'amendments':legend,'unit_amendments':marks,'blocks':sum(1 for x in reader.root.elements() if x.tag in ('p','table','div')),
        'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),
        'content_integrity_ok':ok,'min_text_coverage':min_coverage,'failed_units':bad[:10],
        'audit_units':len(stats)},warnings)

# This parser requires optional PyMuPDF (pip install pymupdf). It deliberately
# retains the entire text of each source page, and separately indexes the rule sections.
# Pilot-specific section outline: official MDCG 2021-24 Rev.1 table of contents.
# These pages are PDF page numbers (1-based), not offsets. The PDF remains the
# authoritative rendering, because tables/flowcharts cannot be safely linearized.
MDCG_CONTENTS = [
 ('1','Purpose of medical device classification',6),
 ('2','Practical relevance of classification',6),
 ('2.1','General requirements',6), ('2.2','Conformity assessment',7),
 ('2.3','Clinical evaluation and investigation',7),('2.4','Post-market surveillance',8),
 ('2.5','Traceability',8),('2.6','Instructions for use',9),
 ('3','How to carry out classification',9),('3.1','Basic terms and definitions',9),
 ('3.1.1','Specific medical purpose',9),('3.1.2','Duration of use',9),
 ('3.1.3','Continuous use',10),('3.1.4','Invasiveness',10),
 ('3.1.5','Active medical devices',12),('3.1.6','Devices with a measuring function',14),
 ('3.1.7','Systems and procedure packs',14),('3.1.8','Other terms',15),
 ('3.2','Application of the classification rules',16),('3.2.1','How to use the rules',17),
 ('3.2.2','Practical example',17),('3.3','Handling of interpretational problems',18),
 ('4','Explanations of individual rules',19),('4.1','Graphical summary',19),
 ('4.1.1','Non-invasive devices',19),('4.1.2','Invasive devices',20),
 ('4.1.3','Active devices',24),('4.1.4','Special rules',26),
 ('4.2','General explanation of rules/practical issues/examples',28),
 ('4.2.1','Non-invasive devices',28),('4.2.2','Invasive devices',34),
 ('4.2.3','Active devices',41),('4.2.4','Special rules',49),
]
MDCG_RULE_HEAD = re.compile(r'^Rule\s+(\d{1,2})(?:\s*[-–—:]|\s*$)',re.I)

def _pdf_heading_lines(page):
    """Read positioned lines to distinguish bold headings from tabular references."""
    out=[]
    for block in page.get_text('dict').get('blocks',[]):
        if 'lines' not in block:continue
        for line in block['lines']:
            spans=line.get('spans',[])
            if not spans:continue
            txt=' '.join(''.join(x.get('text','') for x in spans).split())
            if txt:
                bold=any('bold' in x.get('font','').lower() for x in spans)
                maxsize=max(float(x.get('size',0)) for x in spans)
                out.append((float(line['bbox'][1]),float(line['bbox'][0]),txt,bold,maxsize))
    return sorted(out)

def parse_mdcg_pdf(content:bytes,doc_id:str,filename:str='') -> Parsed:
    if doc_id!='mdcg-2021-24-en':raise ValueError('Tento importér podporuje MDCG 2021-24 rev.1.')
    try: import fitz
    except ImportError:raise ValueError('Pro PDF import je potřeba PyMuPDF. Spusťte instalační skript nainstalovat-pdf-mac.command.')
    try: pdf=fitz.open(stream=content,filetype='pdf')
    except Exception as e:raise ValueError('PDF se nepodařilo přečíst: '+str(e))
    if pdf.page_count<55 or pdf.page_count>70:
        raise ValueError('Neočekávaný počet stran MDCG rev.1; ověřte správnou verzi dokumentu.')
    beginning=' '.join(p.get_text('text') for p in list(pdf)[:3])
    if not re.search(r'MDCG\s*2021\s*[-–]\s*24',beginning,re.I):
        raise ValueError('PDF není identifikováno jako MDCG 2021-24.')
    if not re.search(r'Rev\.?\s*1',beginning,re.I):
        raise ValueError('PDF není jednoznačně identifikováno jako revize 1.')
    source=f'MDCG 2021-24 Rev.1, {filename}, SHA-256 {hashlib.sha256(content).hexdigest()[:16]}; automatický import PDF – nutná kontrola originálu.'
    warnings=['Tabulky a diagramy nelze bezpečně převést do lineárního textu. Originál PDF je uchován a zobrazuje se přímo ve Studiu.',
              'Text extrahovaný ze stránek PDF je pouze pracovní podklad. Schválit až po porovnání všech tabulek a výčtů s originálem.']
    drafts=[]
    # All named chapters and subsections, including chapters 1–3 omitted by the old parser.
    # Page ranges are derived from the published table of contents; where sections
    # begin on the same page, their raw page texts overlap by design.
    for idx,(section,title,start) in enumerate(MDCG_CONTENTS):
        level=len(section.split('.'))
        parent='mdcg-sec-'+section.rsplit('.',1)[0].replace('.','-') if level>1 else None
        ident='mdcg-sec-'+section.replace('.','-')
        next_start=next((p for sec,_,p in MDCG_CONTENTS[idx+1:] if len(sec.split('.'))<=level),pdf.page_count+1)
        end=max(start,min(pdf.page_count,next_start-1))
        # Graphical summary must stay in PDF, not become a meaningless text-only diagram.
        diagram=section.startswith('4.1')
        raw='\n\n'.join(f'[PDF strana {p}]\n'+pdf[p-1].get_text('text',sort=True)
                          for p in range(start,end+1)) if not diagram else ''
        order=sum(int(bit)*100000**(3-k) for k,bit in enumerate(section.split('.')))
        drafts.append(UnitDraft(ident,doc_id,parent,'section',f'{section}',title,raw,
                       f'PDF str. {start}–{end}' if end>start else f'PDF str. {start}',order,source))
    # Rule headings: first prominent occurrence after the graphical overview.
    # Unlike the former implementation, preserve distinct starts on the same page
    # and do not require the title to fit on a single text-extraction line.
    found={}; candidate_count={}
    for pno in range(27,pdf.page_count):
        for y,x,line,bold,size in _pdf_heading_lines(pdf[pno]):
            m=MDCG_RULE_HEAD.match(line)
            if not m:continue
            n=int(m.group(1))
            if not (1<=n<=22):continue
            # PDF tables often contain bare 'Rule 1' column headings. Require a
            # real explanatory heading with a separator or unusually large/bold type.
            if not (re.search(r'Rule\s+\d+\s*[-–—:]',line,re.I) or (bold and size>=11)):
                continue
            candidate_count[n]=candidate_count.get(n,0)+1
            score=(2 if ' - ' in line or ' – ' in line else 0)+(1 if bold else 0)+(1 if size>=11 else 0)
            if n not in found or (score>found[n][2] and pno<=found[n][0]+1):
                found[n]=(pno+1,line[:180],score,y)
    for n in range(1,23):
        parent=('mdcg-sec-4-2-1' if n<=4 else 'mdcg-sec-4-2-2' if n<=8 else
                'mdcg-sec-4-2-3' if n<=13 else 'mdcg-sec-4-2-4')
        start,title,_,_=found.get(n,(None,f'Rule {n} – vyhledejte v originálním PDF',0,0))
        if start is None:
            # Anchor to the known category, but leave body empty: no false excerpt.
            catpage={'mdcg-sec-4-2-1':28,'mdcg-sec-4-2-2':34,
                     'mdcg-sec-4-2-3':41,'mdcg-sec-4-2-4':49}[parent]
            loc=f'PDF str. {catpage} – orientační začátek skupiny; přesnou stranu určit'
            body=''
        else:
            later=[v[0] for k,v in found.items() if k>n and v[0]>=start]
            end=max(start,min(min(later)-1 if later else pdf.page_count,pdf.page_count))
            loc=f'PDF str. {start}–{end}' if end>start else f'PDF str. {start}'
            # Never convert dense multi-column tables into official-looking prose.
            # Keep page-extracted text for editorial search, with source PDF visible.
            body='\n\n'.join(f'[PDF strana {p}]\n'+pdf[p-1].get_text('text',sort=True)
                              for p in range(start,end+1))
        drafts.append(UnitDraft(f'mdcg-rule-{n}',doc_id,parent,'rule',f'Rule {n}',title,body,
                                loc,700000+n,source))
    missing=[n for n in range(1,23) if n not in found]
    if missing:
        warnings.append('NEURČENÉ NADPISY PRAVIDEL: '+', '.join(map(str,missing))+'. Položky existují v osnově, ale jejich přesné stránky a text musí být potvrzeny v PDF.')
    if any(x in found and found[x][0]>found[x+1][0] for x in range(1,22) if x+1 in found):
        warnings.append('Pořadí některých pravidel je podezřelé. Před vytvořením vazeb zkontrolujte stránky.')
    return Parsed(drafts,{'format':'mdcg-pdf','document_id':doc_id,
        'pages':pdf.page_count,'rules':22,'rules_located':len(found),'rules_missing':missing,
        'sections':len(MDCG_CONTENTS),'tables_and_figures':'show_original_pdf',
        'source_pdf_available_after_import':True,'bytes':len(content),
        'sha256':hashlib.sha256(content).hexdigest()},warnings)

def parse_source(content:bytes,document_id:str,filename:str) -> Parsed:
    if len(content)>24*1024*1024:raise ValueError('Soubor je větší než 24 MB')
    if document_id.startswith('mdr-'):
        if not filename.lower().endswith(('.html','.htm')):raise ValueError('Pro MDR stáhněte soubor HTML (ne PDF).')
        return parse_mdr_html(content,document_id,filename)
    if document_id=='mdcg-2021-24-en':
        if not filename.lower().endswith('.pdf') or not content.startswith(b'%PDF'):
            raise ValueError('Pro MDCG vyberte oficiální PDF.')
        return parse_mdcg_pdf(content,document_id,filename)
    raise ValueError('Pro tento dokument ještě není připravený automatický importér. Můžete použít ruční import JSON.')
