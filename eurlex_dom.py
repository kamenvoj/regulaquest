"""Conservative XHTML/HTML DOM reader for EUR-Lex consolidated acts (stdlib-only).

Only legal-body containers anchored by explicit IDs are interpreted.  Every
rendered unit gets a lexical coverage audit against its source subtree.
Editorial change marks are retained separately by the caller.
"""
from __future__ import annotations
from collections import Counter
from html.parser import HTMLParser
import re

class Node:
    __slots__ = ('tag','attrs','children','parent')
    def __init__(self,tag='',attrs=(),parent=None):
        self.tag=tag
        self.attrs=dict(attrs)
        self.children=[]
        self.parent=parent
    def cls(self, name):
        return name in self.attrs.get('class','').split()
    def elements(self):
        for c in self.children:
            if isinstance(c,Node):
                yield c
                yield from c.elements()
    def direct(self):
        return (c for c in self.children if isinstance(c,Node))
    def text(self):
        return ''.join(c.text() if isinstance(c,Node) else c for c in self.children)

VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root=Node('root')
        self.stack=[self.root]
        self.by_id={}
    def handle_starttag(self,tag,attrs):
        node=Node(tag,attrs,self.stack[-1]);self.stack[-1].children.append(node)
        if node.attrs.get('id'):self.by_id[node.attrs['id']]=node
        if tag not in VOID:self.stack.append(node)
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in VOID:self.handle_endtag(tag)
    def handle_endtag(self,tag):
        for j in range(len(self.stack)-1,0,-1):
            if self.stack[j].tag==tag:
                del self.stack[j:]
                return
    def handle_data(self,data):
        self.stack[-1].children.append(data)

EDIT=re.compile(r'[►▼▶]\s*(?:M\d{1,2}|C\d{1,2}|B)\b|◄',re.I)
MARK=re.compile(r'[►▼▶]\s*((?:M|C)\d{1,2})\b',re.I)
SKIP={'script','style','noscript','head','svg'}
BLOCK={'p','div','table','tr','ul','ol','li','h1','h2','h3','h4','h5','h6','section'}

def clean(s):
    s=EDIT.sub('',s).replace('\u00a0',' ').replace('\u202f',' ')
    s=re.sub(r'[ \t\r\n]+',' ',s)
    return re.sub(r'\s+([,;:.])',r'\1',s).strip()

def excluded(node):
    if node.tag in SKIP:return True
    if node.cls('modref') or node.cls('arrow'):return True
    if node.cls('separator') or node.cls('separator-annex'):return True
    return False

def inline(node):
    """Join all text leaves without dropping strings in span/a/em/sup."""
    if isinstance(node,str):return node
    if excluded(node):return ''
    if node.tag=='br':return '\n'
    return ''.join(inline(child) for child in node.children)

def render(node,depth=0):
    """Produce legible plain text while retaining nested enumeration markers."""
    if isinstance(node,str):return clean(node)
    if excluded(node):return ''
    if node.tag=='hr':return ''
    if node.cls('grid-container') and node.cls('grid-list'):
        cells=list(node.direct())
        label=next((c for c in cells if c.cls('grid-list-column-1')) ,None)
        content=next((c for c in cells if c.cls('grid-list-column-2')),None)
        if content is not None:
            prefix=clean(inline(label)) if label is not None else ''
            body=render_container(content,depth+1)
            if prefix and body:
                first,*rest=body.splitlines()
                return ('  '*depth)+prefix+' '+first.lstrip() + (('\n'+'\n'.join(rest)) if rest else '')
            return ('  '*depth)+prefix+' '+body
    if node.tag=='div' and node.cls('norm'):
        num=next((c for c in node.direct() if c.cls('no-parag')),None)
        if num is not None:
            nr=clean(inline(num))
            rest=render_container(node,depth,exclude={id(num)})
            return nr + (' '+rest.lstrip() if rest else '')
    if node.tag in {'p','h1','h2','h3','h4','h5','h6'} and not any(isinstance(c,Node) and c.tag in BLOCK for c in node.children):
        return clean(inline(node))
    if node.tag=='tr':
        cells=[render(c,depth) for c in node.direct() if c.tag in {'td','th'}]
        return ' '.join(c for c in cells if c)
    return render_container(node,depth)

def render_container(node,depth=0,exclude=frozenset()):
    parts=[];text=[]
    def flush():
        if text:
            val=clean(''.join(text))
            if val:parts.append(val)
            text.clear()
    for c in node.children:
        if isinstance(c,Node) and id(c) in exclude:continue
        if isinstance(c,str):text.append(c);continue
        if excluded(c):continue
        if c.tag in BLOCK:
            flush()
            v=render(c,depth)
            if v:parts.append(v)
        else:text.append(inline(c))
    flush()
    return '\n'.join(parts).strip()

def section_body(node,head_count=0):
    kids=list(node.direct())
    # The title paragraph and article title box are metadata, not part of wording.
    if head_count:
        ids={id(k) for k in kids[:head_count]}
    else:ids=set()
    return '\n\n'.join(x for k in kids if id(k) not in ids if (x:=render(k))).strip()

def full_text(node):
    if isinstance(node,str):return node
    if excluded(node):return ''
    s=''.join(full_text(c) for c in node.children)
    return s + ('\n' if node.tag in BLOCK else '')

def tokens(s):
    return re.findall(r'[^\W_]+',clean(s).casefold(),re.U)

def audit(nodes,output):
    """Compare every retained character, in order, against the source DOM.

    The comparison ignores whitespace changes and EUR-Lex's editorial markers,
    but preserves punctuation and all words; e.g. missing one list line fails.
    Formatting semantics (nested indentation) still need a human review.
    """
    source=''.join(full_text(n) for n in nodes)
    a=re.sub(r'\s+','',EDIT.sub('',source))
    b=re.sub(r'\s+','',output)
    exact=(a==b)
    if exact:ratio=1.0
    else:
        from collections import Counter
        ca=Counter(a);cb=Counter(b)
        ratio=sum((ca&cb).values())/len(a) if a else 1.0
    return {'source_chars':len(a),'output_chars':len(b),'coverage':round(ratio,6),
            'same_sequence':exact,'missing_sample':list((Counter(a)-Counter(b)).elements())[:12] if not exact else []}


def find_title(node,selector):
    for c in node.direct():
        if c.cls(selector):return clean(inline(c))
        if c.cls('eli-title'):
            return clean(inline(c))
    return ''

def classification_rules(annex):
    """Locate the 22 peer-level <p> rule headings in Annex VIII."""
    rules=[]
    pat=re.compile(r'^\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:Pravidlo|Rule)\s+(\d{1,2})\s*$',re.I)
    children=list(annex.direct())
    for i,n in enumerate(children):
        if n.tag=='p' and n.cls('title-gr-seq-level-4'):
            t=clean(inline(n));m=pat.fullmatch(t)
            if m and 1<=int(m.group(1))<=22:rules.append((i,int(m.group(1)),t))
    return children,rules


def source_legend(tree):
    """Read amendment/corrigendum ledger from the source table rows."""
    from urllib.parse import urljoin,urlsplit
    legend={}
    for tr in tree.root.elements():
        if tr.tag!='tr':continue
        children=list(tr.direct())
        if not children:continue
        # Ledger rows have a ►M1/►C1 marker in the first table cell.
        mark=MARK.search(children[0].text())
        if not mark:continue
        label=mark.group(1).upper()
        name=next((x for x in tr.elements() if x.tag=='p' and ('title-fam-member' in x.attrs.get('class',''))),None)
        if name is None:continue
        title=clean(name.text())
        if not title:continue
        link=next((x.attrs.get('href','') for x in name.elements() if x.tag=='a' and x.attrs.get('href')), '')
        full=urljoin('https://eur-lex.europa.eu',link)
        u=urlsplit(full)
        if not (u.scheme=='https' and u.netloc=='eur-lex.europa.eu' and '/legal-content/' in u.path):full=''
        legend[label]={'marker':label,'title':title[:350],
                       'kind':'corrigendum' if label.startswith('C') else 'amending_act',
                       'url':full}
    return legend


def amendment_marks(node):
    """Find change markers including source modref nodes not shown in reader."""
    return sorted(set(m.upper() for m in MARK.findall(node.text())),
                  key=lambda s:(s[0],int(s[1:])))


def previous_amendment(node):
    """Inserted acts may be marked by a preceding sibling outside article div."""
    if not node.parent:return []
    siblings=[x for x in node.parent.children if isinstance(x,Node)]
    try:i=siblings.index(node)
    except ValueError:return []
    if i and siblings[i-1].cls('modref'):
        return amendment_marks(siblings[i-1])
    return []
