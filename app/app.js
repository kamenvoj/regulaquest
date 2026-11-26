'use strict';
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db={documents:[],units:[],comments:[],relations:[],relation_revisions:[],relation_history:[],comment_revisions:[],comment_history:[],amendments:[],unit_amendments:[],counts:{}};
let token='', page='home', selected=null, activeDocId='mdr-cs', query='', relationStatusFilter='approved', relationSearch='', docOverviewSearch='', verifiedOverviewSearch='', verifiedDocFilter='all',catalogJurisdiction='all',catalogType='all',reviewDocFilter='all',relationDocFilter='all',commentDocFilter='all',commentStatusFilter='all',commentSearch='';
// Bulk scan results are transient and never published without editor approval.
let batchScope='document',batchDocId='mdr-cs',batchUnitId='',batchFilter='all',batchSearch='',batchOffset=0,
    batchData=null,batchChosen=new Map(),batchRequestSeq=0,batchBusy=false;
const batchKey=c=>c.source_id+'|'+c.target_id;
// Single-unit or bulk read-only, cross-document candidate search.
let relatedSourceDocId='mdr-cs',relatedSourceUnitId='mdr-cs-rule-11',relatedTargetDocId='mdcg-2021-24-en',
    relatedSourceQuery='',relatedScope='document',relatedData=null,relatedBusy=false,relatedSeq=0,
    relatedFilter='all',relatedResultQuery='',relatedPage=0;

// Stav rozbalene navigace se pri prekresleni zachova, nezapisuje se do databaze.
const openedUnits=new Set();
const openedDocuments=new Set(['mdr-cs']);
const statusName={missing:'Text nenahrán',needs_review:'Nutno ověřit',verified:'Ověřený text',draft:'Koncept',proposed:'Návrh',approved:'Schváleno',rejected:'Zamítnuto',archived:'Archivováno'};
const statuses={missing:'warn',needs_review:'warn',verified:'good',draft:'proposed',proposed:'proposed',approved:'good',rejected:'bad',archived:'warn'};
const relName={guidance:'Metodický výklad',references:'Výslovný odkaz',related:'Tematická souvislost',supplements:'Doplňuje',amends:'Mění / nahrazuje'};
const jurisdictions={eu:'Evropská unie',cz:'Česká republika',international:'Mezinárodní',other:'Nezařazeno'};
const docTypes={regulation:'Nařízení',directive:'Směrnice',law:'Zákon',decree:'Vyhláška',guidance:'Metodický dokument',standard:'Technická norma',other:'Ostatní'};
const noteName={explanation:'Vysvětlení',warning:'Na co si dát pozor',example:'Praktický příklad',definition:'Definice pojmu',reference:'Komentář ke zdroji'};
const getUnit=id=>db.units.find(u=>u.id===id);
const getDoc=id=>db.documents.find(d=>d.id===id);
// Jednoznacne cesty pro kontrolu vazeb (bez ohledu na rozbaleni stromu).
function unitPath(id){
 const trail=[],seen=new Set();let unit=getUnit(id);
 while(unit && !seen.has(unit.id) && trail.length<15){
   trail.unshift(unit.label);seen.add(unit.id);
   const parent=getUnit(unit.parent_id);
   unit=parent && parent.document_id===unit.document_id ? parent : null;
 }
 return trail.join(' › ');
}
function documentLabel(d){return d?`${d.family} · ${d.language.toUpperCase()} · ${d.version}`:'Neznámý dokument'}
const fullname=id=>{const u=getUnit(id);if(!u)return id;const d=getDoc(u.document_id);return `${documentLabel(d)} › ${unitPath(id)}${u.heading?' – '+u.heading:''}`};
const tag=(s)=>`<span class="tag ${statuses[s]||''}">${esc(statusName[s]||s)}</span>`;
function toast(t,bad=false){const n=$('#toast');n.textContent=t;n.className='toast visible'+(bad?' error':'');setTimeout(()=>n.classList.remove('visible'),4200)}
async function refresh(){const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('Nepodařilo se načíst databázi');db=await response.json();render()}
async function act(data){const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-RQ-Token':token},body:JSON.stringify(data)});const res=await r.json();if(!r.ok)throw new Error(res.error||'Chyba při ukládání');db=res.state;
 if(data.action==='new_relation'&&relatedData){
  const match=(relatedData.results||[]).find(c=>c.source_id===data.source_id&&c.target_id===data.target_id);
  if(match)match.existing_status='proposed';
 }
 render();if(page==='related'&&relatedData)renderRelatedResults();
 toast('Uloženo do lokální databáze.');return res}
function safeAct(obj,cb){act(obj).then(()=>cb&&cb()).catch(e=>toast(e.message,true))}
function setPage(p){page=p;document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.page===(p==='verified'?'library':p)));document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!=='page-'+p));render()}
function documentStats(docId){
 const units=db.units.filter(u=>u.document_id===docId&&!u.editor_archived),idset=new Set(units.map(u=>u.id));
 const withText=units.filter(u=>String(u.body||'').trim()).length;
 const verified=units.filter(u=>u.text_status==='verified'&&String(u.body||'').trim()).length;
 const involved=db.relations.filter(r=>idset.has(r.source_id)||idset.has(r.target_id));
 return {total:units.length,withText,verified,pending:involved.filter(r=>r.status==='proposed').length,approved:involved.filter(r=>r.status==='approved').length,percent:withText?Math.round(verified/withText*100):0};
}
function selectDocument(id){
 const d=getDoc(id);if(!d)return;
 activeDocId=id;selected=id;openedDocuments.clear();openedDocuments.add(id);
 query='';$('#filter').value='';setPage('library');
}
function linkDoc(id){selectDocument(id)}
function renderDocumentSelector(){
 const sel=$('#activeDocumentSelect');if(!sel)return;
 if(!db.documents.find(d=>d.id===activeDocId))activeDocId=db.documents[0]?.id||'';
 sel.innerHTML=db.documents.map(d=>`<option value="${esc(d.id)}">${esc(d.family)} · ${esc(d.language.toUpperCase())} · ${esc(d.version)}</option>`).join('');sel.value=activeDocId;
 const d=getDoc(activeDocId);$('#workDocTitle').textContent=d?`${d.family} · ${d.language.toUpperCase()}`:'Práce s dokumentem';
 $('#workDocSubtitle').textContent=d?`${d.title} · ${d.version}`:'Vyberte dokument v katalogu.';
}
function renderHome(){
 const c=db.counts||{},totalText=db.units.filter(u=>String(u.body||'').trim()).length;
 $('#homeSummary').innerHTML=`<button type="button" class="metric metric-link" id="homeOpenDocs"><span>Dokumentů ↗</span><strong>${c.documents||0}</strong><small>Otevřít katalog</small></button>
 <button type="button" class="metric metric-link" id="homeOpenVerified"><span>Ověřeno ↗</span><strong>${c.verified||0} / ${totalText}</strong><small>Pasáží s dostupným textem</small></button>
 <button type="button" class="metric metric-link" id="homeOpenReview"><span>Vazby ke kontrole ↗</span><strong>${c.proposed||0}</strong><small>Napříč dokumenty</small></button>
 <button type="button" class="metric metric-link" id="homeOpenLinks"><span>Schválené vazby ↗</span><strong>${c.approved_links||0}</strong><small>Napříč dokumenty</small></button>`;
 $('#homeOpenDocs').onclick=()=>setPage('documents');$('#homeOpenVerified').onclick=()=>{verifiedDocFilter='all';setPage('verified')};
 $('#homeOpenReview').onclick=()=>{reviewDocFilter='all';setPage('review')};
 $('#homeOpenLinks').onclick=()=>{relationDocFilter='all';relationStatusFilter='approved';setPage('relations')};
 $('#homeDocuments').innerHTML=db.documents.map(d=>{
   const st=documentStats(d.id);
   return `<div class="home-doc-row"><div class="home-doc-ident"><strong>${esc(d.family)} · ${esc(d.language.toUpperCase())}</strong><span>${esc(d.title)}</span><small>${esc(jurisdictions[d.jurisdiction]||'Nezařazeno')} · ${esc(docTypes[d.document_type]||'Ostatní')}</small></div>
    <div class="home-doc-progress"><strong>${st.verified} / ${st.withText} ověřeno</strong><div class="progress-track"><span style="width:${st.percent}%"></span></div><small>${st.total} položek v osnově · ${st.pending} vazeb ke kontrole · ${st.approved} schválených</small></div>
    <button type="button" class="btn accent" data-home-document="${esc(d.id)}">Otevřít dokument ↗</button></div>`;
 }).join('');
 $('#homeDocuments').querySelectorAll('[data-home-document]').forEach(b=>b.onclick=()=>selectDocument(b.dataset.homeDocument));
}
function renderDocumentMetrics(){
 renderDocumentSelector();const st=documentStats(activeDocId);
 $('#statDocs').textContent=st.total;$('#statDocsSub').textContent=`${st.withText} pasáží s textem`;
 $('#statVerified').textContent=`${st.verified} / ${st.withText}`;$('#statVerifiedSub').textContent=`${st.percent} % dostupného textu ověřeno`;
 $('#statProposed').textContent=st.pending;$('#statApproved').textContent=st.approved;
}

function render(){
 const c=db.counts||{};
 $('#navReview').textContent=(c.proposed||0)+(c.proposed_revisions||0)+(c.comment_revisions_pending||0)+db.comments.filter(x=>x.status==='draft').length;
 if(page==='home')renderHome();
 if(page==='library'){renderDocumentMetrics();renderList();renderReader();renderContext()}
 if(page==='batch')renderBatchSetup();if(page==='related')renderRelatedSetup();if(page==='documents')renderDocumentsOverview();if(page==='verified')renderVerifiedOverview();if(page==='review')renderReview();if(page==='relations')renderRelations();if(page==='comments')renderComments();if(page==='publish')renderPublish();
}
// Přehledy jsou odvozené pouze z aktuálního /api/state, bez další databáze.
function openDocumentFromOverview(id){
 const d=getDoc(id);if(!d){toast('Dokument nebyl nalezen',true);return}
 selectDocument(id);
}
function renderDocumentsOverview(){
 const holder=$('#documentOverview'),q=docOverviewSearch.trim().toLocaleLowerCase('cs');
 $('#catalogJurisdiction').value=catalogJurisdiction;$('#catalogType').value=catalogType;
 const docs=db.documents.filter(d=>
   (catalogJurisdiction==='all'||d.jurisdiction===catalogJurisdiction)&&
   (catalogType==='all'||d.document_type===catalogType)&&
   [d.family,d.title,d.language,d.version,d.kind,jurisdictions[d.jurisdiction],docTypes[d.document_type],...(d.topics||[])].join(' ').toLocaleLowerCase('cs').includes(q))
   .sort((a,b)=>[a.jurisdiction,a.document_type,a.family,a.language].join('|').localeCompare([b.jurisdiction,b.document_type,b.family,b.language].join('|'),'cs'));
 holder.innerHTML=docs.length?docs.map((d,i)=>{
   const currentGroup=d.jurisdiction+'|'+d.document_type;
   const previousGroup=i?docs[i-1].jurisdiction+'|'+docs[i-1].document_type:null;
   const heading=currentGroup!==previousGroup?`<div class="catalog-section-title">${esc(jurisdictions[d.jurisdiction]||'Nezařazeno')} / ${esc(docTypes[d.document_type]||'Ostatní')}</div>`:'';
   const units=db.units.filter(u=>u.document_id===d.id);
   const verified=units.filter(u=>u.text_status==='verified'&&String(u.body||'').trim()).length;
   const withText=units.filter(u=>String(u.body||'').trim()).length;
   return `${heading}<div class="review-card overview-card"><div><h3>${esc(d.family)} · ${esc(d.language.toUpperCase())}</h3>
   <p>${esc(d.title)}</p><small>Verze: ${esc(d.version)} · ${esc(d.kind)}</small>
   <small>${esc(jurisdictions[d.jurisdiction]||'Nezařazeno')} · ${esc(docTypes[d.document_type]||'Ostatní')} · Ustanovení ${units.length} · S textem ${withText} · Ověřeno ${verified}/${withText}</small>
   <div class="topic-chips">${(d.topics||[]).map(t=>`<span class="topic-chip">${esc(t)}</span>`).join('')||'<small>Bez odborných tagů</small>'}</div></div>
   <div class="catalog-actions"><button class="btn" type="button" data-edit-metadata="${esc(d.id)}">Upravit metadata / tagy</button><button class="btn accent" type="button" data-overview-document="${esc(d.id)}">Otevřít dokument ↗</button></div></div>`;
 }).join(''):'<div class="review-card"><p>Žádný dokument neodpovídá hledání.</p></div>';
 holder.querySelectorAll('[data-overview-document]').forEach(b=>b.onclick=()=>openDocumentFromOverview(b.dataset.overviewDocument));
 holder.querySelectorAll('[data-edit-metadata]').forEach(b=>b.onclick=()=>dialogDocumentMetadata(b.dataset.editMetadata));
}
function renderVerifiedOverview(){
 const select=$('#verifiedDocFilter'),holder=$('#verifiedOverview');
 const options=[{id:'all',label:'Všechny dokumenty'},...db.documents.map(d=>({id:d.id,label:documentLabel(d)}))];
 // Neměnit rozepsaný výběr při obnově seznamu.
 select.innerHTML=options.map(o=>`<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
 if(!options.some(o=>o.id===verifiedDocFilter))verifiedDocFilter='all';select.value=verifiedDocFilter;
 const q=verifiedOverviewSearch.trim().toLocaleLowerCase('cs');
 const verified=db.units.filter(u=>u.text_status==='verified'&&String(u.body||'').trim()&&
  (verifiedDocFilter==='all'||u.document_id===verifiedDocFilter)&&
  (!q||[fullname(u.id),u.body,u.locator].join(' ').toLocaleLowerCase('cs').includes(q)));
 holder.innerHTML=verified.length?verified.map(u=>`<div class="review-card overview-card"><div><h3>${esc(fullname(u.id))}</h3>
 <p>${esc(String(u.body).replace(/\s+/g,' ').slice(0,230))}${u.body.length>230?'…':''}</p><small>${esc(statusName[u.text_status])}</small></div>
 <button class="btn accent" type="button" data-overview-unit="${esc(u.id)}">Otevřít pasáž ↗</button></div>`).join(''):
 '<div class="review-card"><p>Žádné ověřené pasáže neodpovídají zvolenému filtru.</p></div>';
 holder.querySelectorAll('[data-overview-unit]').forEach(b=>b.onclick=()=>openUnit(b.dataset.overviewUnit));
}
function matchUnit(u,q){if(!q)return true;let d=getDoc(u.document_id);return [u.label,u.heading,u.body,u.locator,d?.family,d?.title].join(' ').toLocaleLowerCase('cs').includes(q)}
function renderList(){
 const q=query.trim().toLocaleLowerCase('cs');
 const holder=$('#docList');
 holder.replaceChildren();
 const byId=new Map(db.units.filter(u=>!u.editor_archived).map(u=>[u.id,u]));
 const childMap=new Map();
 for(const u of db.units.filter(u=>!u.editor_archived)){
   const parent=byId.get(u.parent_id);
   const key=parent && parent.document_id===u.document_id ? u.parent_id : '__root__'+u.document_id;
   if(!childMap.has(key))childMap.set(key,[]);
   childMap.get(key).push(u);
 }
 const children=id=>childMap.get(id)||[];
 function siblingOpen(id){
   const u=byId.get(id);
   if(!u)return;
   const group=children(u.parent_id&&byId.has(u.parent_id)?u.parent_id:'__root__'+u.document_id);
   for(const sibling of group){if(sibling.id!==id)openedUnits.delete(sibling.id)}
 }
 for(const d of db.documents.filter(d=>d.id===activeDocId)){
   const units=db.units.filter(u=>u.document_id===d.id&&!u.editor_archived);
   const docMatches=[d.title,d.family,d.version].join(' ').toLocaleLowerCase('cs').includes(q);
   const matches=q?units.filter(u=>matchUnit(u,q)):units;
   if(q&&!matches.length&&!docMatches)continue;
   // Hledani ukazuje vysledky i jejich predky, aby bylo zrejme umisteni.
   const visible=new Set();
   if(q){
     for(const hit of matches){
       let x=hit,visited=new Set();
       while(x && !visited.has(x.id) && x.document_id===d.id){
         visible.add(x.id);visited.add(x.id);x=byId.get(x.parent_id);
       }
     }
     if(docMatches && !visible.size)units.forEach(u=>visible.add(u.id));
   }
   const isVisible=u=>!q||visible.has(u.id);
   const group=document.createElement('div');group.className='doc-tab';
   const row=document.createElement('div');row.className='dochead-row';
   const head=document.createElement('button');head.type='button';head.className='dochead';
   head.innerHTML=`<span class="doc-symbol">${d.kind.toLowerCase().includes('legal')||d.kind.includes('předpis')?'§':'↗'}</span><span><span class="docname">${esc(d.family)}</span><div class="docmeta">${esc(d.language.toUpperCase())} · ${esc(d.version)}</div></span>`;
   head.onclick=()=>{selected=d.id;openedDocuments.add(d.id);render()};
   const docIsOpen=!!q||openedDocuments.has(d.id);
   const docToggle=document.createElement('button');docToggle.type='button';
   docToggle.className='tree-toggle doc-toggle';docToggle.textContent=docIsOpen?'▾':'▸';
   docToggle.title=docIsOpen?'Sbalit dokument':'Rozbalit dokument';
   docToggle.setAttribute('aria-label',docToggle.title);
   docToggle.setAttribute('aria-expanded',String(docIsOpen));
   docToggle.onclick=()=>{if(openedDocuments.has(d.id))openedDocuments.delete(d.id);else openedDocuments.add(d.id);renderList()};
   row.append(head,docToggle);group.appendChild(row);
   if(docIsOpen){
     const tree=document.createElement('div');tree.className='doc-tree';
     const ancestors=new Set();
     function addNode(u,container,level){
       if(!isVisible(u)||ancestors.has(u.id))return;
       ancestors.add(u.id);
       const sub=children(u.id).filter(isVisible);
       const hasChildren=sub.length>0;
       const expanded=hasChildren&&(!!q||openedUnits.has(u.id));
       const wrapper=document.createElement('div');wrapper.className='tree-node';
       const itemRow=document.createElement('div');itemRow.className='tree-row';
       if(hasChildren){
         const toggle=document.createElement('button');toggle.type='button';
         toggle.className='tree-toggle';toggle.textContent=expanded?'▾':'▸';
         toggle.title=expanded?'Sbalit podřazené části':'Rozbalit podřazené části';
         toggle.setAttribute('aria-label',toggle.title+' – '+u.label);
         toggle.setAttribute('aria-expanded',String(expanded));
         toggle.onclick=()=>{if(openedUnits.has(u.id))openedUnits.delete(u.id);else{ siblingOpen(u.id);openedUnits.add(u.id) }renderList()};
         itemRow.appendChild(toggle);
       }else{
         const icon=document.createElement('span');icon.className='tree-leaf';icon.setAttribute('aria-hidden','true');
         icon.innerHTML='<i class="tinycircle"></i>';itemRow.appendChild(icon);
       }
       const b=document.createElement('button');b.type='button';
       b.className='unit-entry tree-label'+(selected===u.id?' active':'')+(u.text_status==='verified'?' verified':'');
       b.innerHTML=`<span>${esc(u.label)}${u.kind==='section'&&u.heading?' · '+esc(u.heading).slice(0,36):''}</span>`;
       b.title=u.heading||u.label;
       if(selected===u.id)b.setAttribute('aria-current','true');
       b.onclick=()=>{
         selected=u.id;openedDocuments.add(d.id);
         if(hasChildren){if(openedUnits.has(u.id))openedUnits.delete(u.id);else{siblingOpen(u.id);openedUnits.add(u.id)}}
         render();
       };
       itemRow.appendChild(b);wrapper.appendChild(itemRow);
       if(expanded){
         const childGroup=document.createElement('div');childGroup.className='tree-children';childGroup.setAttribute('role','group');
         for(const child of sub)addNode(child,childGroup,level+1);
         wrapper.appendChild(childGroup);
       }
       container.appendChild(wrapper);
       ancestors.delete(u.id);
     }
     for(const u of children('__root__'+d.id))addNode(u,tree,0);
     group.appendChild(tree);
   }
   holder.appendChild(group);
 }
 if(!holder.children.length)holder.innerHTML='<div class="empty-state">Nenalezeny žádné odpovídající části.</div>';
}
function renderReader(){const box=$('#reader');if(box.dataset.currentSelection!==String(selected||'')){box.scrollTop=0;box.dataset.currentSelection=String(selected||'')}if(!selected){box.innerHTML=`<div class="eyebrow">VÍTEJTE V REGULAQUEST STUDIU</div><h2>Odborná redakce legislativy</h2><p class="section-sub">Začněte výběrem dokumentu nebo konkrétního ustanovení v levém panelu.</p><div class="unloaded"><strong>Co je zde připraveno?</strong>Rejstřík MDR CZ/EN a kapitoly MDCG 2021-24 rev. 1. Texty nejsou automaticky převzaté – budou označeny jako neověřené, dokud je nezkontrolujete proti zdroji.</div><div class="doc-outline"><div class="outline-row"><strong>01 · Výběr ustanovení</strong><small>Například MDR, příloha VIII, pravidlo 11.</small></div><div class="outline-row"><strong>02 · Připojení originálního textu</strong><small>Vložit text nebo hromadně importovat strukturovaný JSON.</small></div><div class="outline-row"><strong>03 · Ověření a propojení</strong><small>Vytvořit schvalovanou vazbu s příslušnou částí MDCG.</small></div></div>`;return}
const u=getUnit(selected);
if(!u){const d=getDoc(selected);if(!d){selected=null;return renderReader()}const related=db.units.filter(x=>x.document_id===d.id);
 box.innerHTML=`<div class="crumb">ZDROJ / ${esc(d.family)}</div><h2>${esc(d.title)}</h2><p class="section-sub">${esc(d.kind)} · ${esc(d.language.toUpperCase())} · ${esc(d.version)}</p><div class="sourcebox"><strong>Vydavatel:</strong> ${esc(d.publisher)}<br><strong>Verze:</strong> ${esc(d.version)}<br><strong>Oficiální zdroj:</strong> <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Otevřít dokument ↗</a></div><button class="btn" id="editDocMetadataReader">Upravit metadata a tagy</button><div class="section-kicker">HLAVNÍ ČÁSTI DOKUMENTU (${related.length} POLOŽEK CELKEM)</div><div class="doc-outline">${related.filter(x=>!x.parent_id).map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(x.locator||'')} · ${esc(statusName[x.text_status])}</small></button>`).join('')}</div>`;
 box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>openUnit(el.dataset.unitOpen));const edit=box.querySelector('#editDocMetadataReader');if(edit)edit.onclick=()=>dialogDocumentMetadata(d.id);return}
const d=getDoc(u.document_id);const related=db.units.filter(x=>x.parent_id===u.id&&!x.editor_archived);
box.innerHTML=`<div class="hero-line"><span class="crumb">${esc(d.family)} / ${esc(d.language.toUpperCase())} / ${esc(u.locator||u.label)}</span>${tag(u.text_status)}</div>
<h2>${esc(u.label)}</h2><p class="section-sub">${esc(u.heading||d.title)}</p>
<div class="sourcebox"><strong>Zdroj:</strong> ${esc(d.title)}<br><strong>Verze:</strong> ${esc(d.version)} · ${esc(d.language.toUpperCase())}<br><strong>Umístění:</strong> ${esc(u.locator||u.label)}<br><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Porovnat s originálem ↗</a></div>
${u.content_blocks&&u.content_blocks.length?`<div class="rq-prepared-content"><div class="section-kicker">REDAKČNĚ STRUKTUROVANÝ OBSAH A TABULKY · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>${rqRenderBlocks(u.content_blocks)}</div>`:''}
${d.id==='mdcg-2021-24-en' ? `
  <div class="section-kicker">PŮVODNÍ PDF · TABULKY A DIAGRAMY BEZ ZTRÁTY ROZLOŽENÍ</div>
  ${(db.source_files||[]).some(f=>f.document_id===d.id) ? `
    <div class="pdf-source-viewer" data-pdf-start="${parseInt((u.locator.match(/PDF str\.\s*(\d+)/)||[])[1]||'1',10)}">
      <div class="pdf-toolbar"><button type="button" class="btn tiny" id="pdfPrev">← Předchozí</button>
      <strong>Originál PDF · strana <span id="pdfPageNum"></span> z 59</strong>
      <button type="button" class="btn tiny" id="pdfNext">Další →</button>
      <a class="btn tiny" id="pdfOpen" target="_blank" rel="noopener noreferrer">Otevřít celé PDF ↗</a></div>
      <img id="pdfPageImage" alt="Věrný obraz stránky původního dokumentu MDCG, včetně tabulek a diagramů" loading="lazy"/>
    </div>` : `<div class="notice">Originální PDF zatím není uložené v této verzi Studia. Po aktualizaci jej znovu naimportujte.</div>`}
  <details class="pdf-raw-text"><summary>Strojově extrahovaný text – pracovní podklad (může mít chybné pořadí tabulek)</summary>
  ${u.body?`<div class="legal">${esc(u.body)}</div>`:`<div class="unloaded">Text nelze bezpečně automaticky vypsat. Zobrazte originální stránku PDF.</div>`}</details>
  ` : `<div class="section-kicker">KONSOLIDOVANÉ ZNĚNÍ ZDROJE · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>
  ${u.body?`<div class="legal">${esc(u.body)}</div>`:`<div class="unloaded"><strong>Oficiální text zatím není načten.</strong>Tohle je pouze ověřitelný rejstříkový údaj. Nevkládáme sem vymyšlená nebo neúplná znění právního předpisu.</div>`}`}

<div class="read-actions rq-structure-actions"><button class="btn accent" id="rqEditContent">▦ Editor textu a tabulek</button><button class="btn" id="rqEditStructure">Struktura</button><button class="btn" id="rqSplit" ${!u.body?'disabled':''}>Rozdělit</button><button class="btn" id="rqMove" ${!u.body?'disabled':''}>Přesunout text</button><button class="btn" id="rqMerge" ${!u.body?'disabled':''}>Sloučit</button><button class="btn" id="rqHistory">Historie změn</button>${u.body&&u.text_status!=='verified'?'<button class="btn accent" id="verifyText">Ověřil(a) jsem proti zdroji</button>':''}</div>
${u.source_note?`<p class="fine">Původ importu: ${esc(u.source_note)}</p>`:''}
${related.length?`<div class="soft-rule"></div><div class="section-kicker">PODŘAZENÉ ČÁSTI</div><div class="doc-outline">${related.map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(statusName[x.text_status])}</small></button>`).join('')}</div>`:''}`;
const pdfWrap=box.querySelector('.pdf-source-viewer');
if(pdfWrap){
 let p=Math.min(59,Math.max(1,Number(pdfWrap.dataset.pdfStart)||1));
 const setPdfPage=()=>{box.querySelector('#pdfPageNum').textContent=String(p);
   box.querySelector('#pdfPageImage').src='/api/pdf-page?document_id=mdcg-2021-24-en&page='+p;
   box.querySelector('#pdfOpen').href='/api/source-pdf?document_id=mdcg-2021-24-en#page='+p;
   box.querySelector('#pdfPrev').disabled=p<=1;box.querySelector('#pdfNext').disabled=p>=59;};
 box.querySelector('#pdfPrev').onclick=()=>{p=Math.max(1,p-1);setPdfPage()};
 box.querySelector('#pdfNext').onclick=()=>{p=Math.min(59,p+1);setPdfPage()};
 setPdfPage();
}
box.querySelector('#rqEditContent').onclick=()=>rqContentEditor(u);
box.querySelector('#rqEditStructure').onclick=()=>rqStructureEditor(u);
box.querySelector('#rqSplit').onclick=()=>rqSplit(u);
box.querySelector('#rqMove').onclick=()=>rqMoveText(u,false);
box.querySelector('#rqMerge').onclick=()=>rqMoveText(u,true);
box.querySelector('#rqHistory').onclick=()=>rqHistory(u);
const v=box.querySelector('#verifyText');if(v)v.onclick=()=>{if(confirm(d.id==='mdcg-2021-24-en'?'POTVRZENÍ KONTROLY PDF: Zkontrolovali jste proti originálnímu PDF veškerý text včetně pořadí tabulek, výčtů a diagramů? Pokud má strojový přepis chyby, nejprve jej ručně opravte.':'Potvrzujete, že text byl porovnán s oficiálním dokumentem ve správné jazykové a časové verzi?'))safeAct({action:'verify_unit',unit_id:u.id})};
box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>{selected=el.dataset.unitOpen;render()});
}
function renderContext(){const box=$('#context');const u=getUnit(selected);if(!u){box.innerHTML='<div class="smallcaps">VÝKLAD A VAZBY</div><div class="empty-state">Vyberte ustanovení pro úpravu komentářů a propojení.</div>';return}
const rel=db.relations.filter(r=>r.source_id===u.id||r.target_id===u.id);const comments=db.comments.filter(c=>c.unit_id===u.id);
const marks=(db.unit_amendments||[]).filter(x=>x.unit_id===u.id);
const amendments=marks.map(x=>{const a=(db.amendments||[]).find(z=>z.document_id===u.document_id&&z.marker===x.marker);return {...a,marker:x.marker}});
const origin=getDoc(u.document_id);
box.innerHTML=`<div class="context-section"><div class="context-head"><h3>↗ Propojené pasáže <span class="tag">${rel.length}</span></h3><div class="actionrow"><button class="btn tiny" id="seekRelated" title="Hledat související ustanovení jiných dokumentů">◎ Souvislosti</button><button class="btn tiny" id="suggestLinks" title="Navrhnout výslovné odkazy z vybraného textu">✧ Návrhy</button><button class="btn tiny" id="addLink">+ Propojit</button></div></div>
${rel.length?rel.map(r=>{const other=r.source_id===u.id?r.target_id:r.source_id;return `<div class="boxnote"><div class="meta"><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(other))}</p><div class="helper">${esc(r.rationale)}</div><div class="actionrow"><button class="btn tiny" data-jump="${esc(other)}">Přejít na pasáž ↗</button><button class="btn tiny" data-relation-detail="${esc(r.id)}">Detail vazby</button></div></div>`}).join(''):'<p class="fine">Zatím bez propojení. Vazby je možné vytvářet na úrovni kapitol, pravidel i jednotlivých pasáží.</p>'}</div>
<div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>▤ Naše komentáře <span class="tag">${comments.length}</span></h3><button class="btn tiny" id="addNote">+ Přidat</button></div>${comments.length?comments.map(c=>`<div class="boxnote"><div class="meta"><strong>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</strong>${tag(c.status)}</div><p>${esc(c.body)}</p><div class="helper">${esc(c.author||'RegulaQuest redakce')}</div><div class="actionrow"><button type="button" class="btn tiny" data-comment-detail="${esc(c.id)}">Detail / upravit</button></div></div>`).join(''):'<p class="fine">Zatím bez autorských komentářů.</p>'}</div><div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>◷ Změny a původ znění <span class="tag">${amendments.length}</span></h3></div>
${amendments.length?amendments.map(a=>`<div class="boxnote"><div class="meta"><strong>${esc(a.marker)} · ${a.kind==='corrigendum'?'Oprava':'Pozměňující akt'}</strong></div><p>${esc(a.title||'Označení změny v konsolidovaném dokumentu')}</p>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Přejít na původní akt ↗</a>`:`<a href="${esc(origin?.url||'#')}" target="_blank" rel="noopener noreferrer">Ověřit akt v přehledu „Ve znění“ na EUR-Lexu ↗</a>`}</div>`).join(''):'<p class="fine">U tohoto textu nejsou v importovaném konsolidovaném znění zachyceny změnové značky. Neznamená to, že text nikdy nebyl měněn.</p>'}
<p class="fine">Zobrazené znění je informativní konsolidace k datu uvedenému u zdroje. Změnové značky se do textu nevypisují.</p></div>
<div class="soft-rule"></div><div class="fine">Komentář je oddělený od oficiálního znění. Pro studentský export musí být schválený.</div>`;
box.querySelector('#seekRelated').onclick=()=>openRelatedForUnit(u.id);box.querySelector('#suggestLinks').onclick=()=>dialogReferenceSuggestions(u);box.querySelector('#addLink').onclick=()=>dialogRelation(u);box.querySelector('#addNote').onclick=()=>dialogComment(u);box.querySelectorAll('[data-jump]').forEach(x=>x.onclick=()=>openUnit(x.dataset.jump));box.querySelectorAll('[data-relation-detail]').forEach(x=>x.onclick=()=>dialogRelationDetail(x.dataset.relationDetail));box.querySelectorAll('[data-comment-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.commentDetail));
}
function renderReview(){
 const filter=$('#reviewDocFilter');filter.innerHTML='<option value="all">Všechny dokumenty</option>'+db.documents.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))}</option>`).join('');filter.value=reviewDocFilter;
 const relevance=id=>reviewDocFilter==='all'||getUnit(id)?.document_id===reviewDocFilter;
const revisions=(db.relation_revisions||[]).filter(r=>r.status==='proposed'&&(relevance(r.source_id)||relevance(r.target_id)));
$('#reviewRevisions').innerHTML=revisions.length?revisions.map(rev=>`<div class="review-card">
 <h3>${rev.change_type==='archive'?'Návrh archivace':'Návrh úpravy'} · ${esc(fullname(rev.source_id))}</h3>
 <small>Současná vazba: ${esc(fullname(db.relations.find(x=>x.id===rev.relation_id)?.target_id))}</small>
 <small>Navržený cíl: ${esc(fullname(rev.target_id))}</small>
 <p><strong>${esc(relName[rev.relation_type]||rev.relation_type)}</strong><br>${esc(rev.rationale)}</p>
 <small>Doklad: ${esc(rev.evidence||'Bez dokladu')}</small><small>Důvod změny: ${esc(rev.change_reason)}</small>
 <div class="actionrow"><button class="btn tiny" data-r-detail="${esc(rev.relation_id)}">Porovnat s původní vazbou</button>
 <button class="btn tiny accent" data-rev-approve="${esc(rev.id)}">✓ Schválit změnu</button><button class="btn tiny danger" data-rev-reject="${esc(rev.id)}">× Zamítnout změnu</button></div></div>`).join(''):'<div class="review-card"><p>Žádné změny schválených vazeb nečekají na kontrolu.</p></div>';
$('#reviewRevisions').querySelectorAll('[data-r-detail]').forEach(x=>x.onclick=()=>dialogRelationDetail(x.dataset.rDetail));
$('#reviewRevisions').querySelectorAll('[data-rev-approve]').forEach(x=>x.onclick=()=>decideRevision(x.dataset.revApprove,'approved'));
$('#reviewRevisions').querySelectorAll('[data-rev-reject]').forEach(x=>x.onclick=()=>decideRevision(x.dataset.revReject,'rejected'));
const active=db.relations.filter(r=>r.status==='proposed'&&(relevance(r.source_id)||relevance(r.target_id)));$('#reviewLinks').innerHTML=active.length?active.map(r=>`<div class="review-card"><h3>${esc(fullname(r.source_id))}</h3><small>↔ ${esc(fullname(r.target_id))}</small><p><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong><br>${esc(r.rationale)}</p><small>Doklad: ${esc(r.evidence||'Nedoplněn – před schválením ověřte originální pasáž')}</small><small>Původ: ${esc(r.provenance)}</small><div class="actionrow"><button class="btn tiny accent" data-r-approve="${esc(r.id)}">✓ Schválit</button><button class="btn tiny danger" data-r-reject="${esc(r.id)}">× Zamítnout</button><button class="btn tiny" data-r-open="${esc(r.source_id)}">Otevřít zdroj</button></div></div>`).join(''):'<div class="review-card"><p>Žádné vazby čekající na posouzení.</p></div>';
const pendingComments=(db.comment_revisions||[]).filter(r=>r.status==='proposed'&&relevance(db.comments.find(c=>c.id===r.comment_id)?.unit_id));
$('#reviewCommentRevisions').innerHTML=pendingComments.length?pendingComments.map(r=>{
 const c=db.comments.find(x=>x.id===r.comment_id);return `<div class="review-card"><h3>${r.change_type==='archive'?'Archivace':r.change_type==='restore'?'Obnovení':'Úprava'} · ${esc(fullname(c?.unit_id))}</h3>
 <small>${esc(noteName[r.kind]||r.kind)} · ${esc(r.language.toUpperCase())} · ${esc(r.author||'Bez autora')}</small>
 <p>${esc(r.body)}</p><small>Důvod změny: ${esc(r.change_reason)}</small>
 <div class="actionrow"><button class="btn tiny" data-cr-detail="${esc(r.comment_id)}">Původní znění a historie</button><button class="btn tiny accent" data-cr-approve="${esc(r.id)}">✓ Schválit změnu</button><button class="btn tiny danger" data-cr-reject="${esc(r.id)}">× Zamítnout</button></div></div>`}).join(''):'<div class="review-card"><p>Žádné navržené změny komentářů.</p></div>';
$('#reviewCommentRevisions').querySelectorAll('[data-cr-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.crDetail));
$('#reviewCommentRevisions').querySelectorAll('[data-cr-approve]').forEach(x=>x.onclick=()=>decideCommentRevision(x.dataset.crApprove,'approved'));
$('#reviewCommentRevisions').querySelectorAll('[data-cr-reject]').forEach(x=>x.onclick=()=>decideCommentRevision(x.dataset.crReject,'rejected'));
const activeComments=db.comments.filter(c=>c.status==='draft'&&relevance(c.unit_id));$('#reviewComments').innerHTML=activeComments.length?activeComments.map(c=>`<div class="review-card"><h3>${esc(fullname(c.unit_id))}</h3><small>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</small><p>${esc(c.body)}</p><div class="actionrow"><button class="btn tiny" data-c-detail="${esc(c.id)}">Otevřít / upravit</button><button class="btn tiny accent" data-c-approve="${esc(c.id)}">✓ Schválit</button><button class="btn tiny danger" data-c-reject="${esc(c.id)}">× Zamítnout</button></div></div>`).join(''):'<div class="review-card"><p>Žádné komentáře čekající na schválení.</p></div>';
$('#reviewComments').querySelectorAll('[data-c-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.cDetail));
document.querySelectorAll('[data-r-approve]').forEach(x=>x.onclick=()=>safeAct({action:'relation_status',id:x.dataset.rApprove,status:'approved'}));document.querySelectorAll('[data-r-reject]').forEach(x=>x.onclick=()=>safeAct({action:'relation_status',id:x.dataset.rReject,status:'rejected'}));document.querySelectorAll('[data-r-open]').forEach(x=>x.onclick=()=>openUnit(x.dataset.rOpen));document.querySelectorAll('[data-c-approve]').forEach(x=>x.onclick=()=>safeAct({action:'comment_status',id:x.dataset.cApprove,status:'approved'}));document.querySelectorAll('[data-c-reject]').forEach(x=>x.onclick=()=>safeAct({action:'comment_status',id:x.dataset.cReject,status:'rejected'}));
}
function decideRevision(revId,decision){
 const rev=(db.relation_revisions||[]).find(x=>x.id===revId);
 if(!rev)return;
 const action=decision==='approved'?(rev.change_type==='archive'?'ARCHIVOVAT schválenou vazbu':'SCHVÁLIT nové znění vazby'):'ZAMÍTNOUT navrženou změnu';
 if(!confirm(`Opravdu ${action}?\n\nOD: ${fullname(rev.source_id)}\nNA: ${fullname(rev.target_id)}\nDŮVOD: ${rev.change_reason}`))return;
 safeAct({action:'decide_relation_revision',revision_id:revId,decision});
}
function renderRelations(){
 const dfilter=$('#relationDocFilter');dfilter.innerHTML='<option value="all">Všechny dokumenty</option>'+db.documents.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))}</option>`).join('');dfilter.value=relationDocFilter;
 const state=$('#relationStateFilter'),search=$('#relationListSearch');state.value=relationStatusFilter;search.value=relationSearch;
 const q=relationSearch.trim().toLocaleLowerCase('cs');
 const filtered=db.relations.filter(r=>(relationStatusFilter==='all'||r.status===relationStatusFilter)&&
   (relationDocFilter==='all'||getUnit(r.source_id)?.document_id===relationDocFilter||getUnit(r.target_id)?.document_id===relationDocFilter)&&
   (!q||[fullname(r.source_id),fullname(r.target_id),relName[r.relation_type],r.rationale,r.evidence].join(' ').toLocaleLowerCase('cs').includes(q)));
 const holder=$('#relationList');
 holder.innerHTML=filtered.length?filtered.map(r=>{
 const pending=(db.relation_revisions||[]).some(x=>x.relation_id===r.id&&x.status==='proposed');
 return `<div class="review-card relation-list-item"><div class="relation-list-head"><h3>${esc(fullname(r.source_id))}</h3>${tag(r.status)}</div>
 <div class="relation-arrow">↓ ${esc(relName[r.relation_type]||r.relation_type)}</div><p><strong>${esc(fullname(r.target_id))}</strong></p>
 <p>${esc(r.rationale)}</p><small>Doklad: ${esc(r.evidence||'Není doplněn')}</small>
 ${pending?'<div class="notice">U vazby čeká návrh změny na schválení. Dosavadní schválené znění zůstává zachované.</div>':''}
 <div class="actionrow"><button class="btn tiny" data-r-detail="${esc(r.id)}">Otevřít detail a historii</button>
 <button class="btn tiny" data-r-open="${esc(r.source_id)}">Otevřít zdroj</button><button class="btn tiny" data-r-target="${esc(r.target_id)}">Otevřít cíl</button>
 ${r.status==='approved'&&!pending?`<button class="btn tiny accent" data-r-edit="${esc(r.id)}">Navrhnout úpravu</button><button class="btn tiny" data-r-archive="${esc(r.id)}">Navrhnout archivaci</button>`:''}</div></div>`;
 }).join(''):'<div class="review-card"><p>Pro zadaný filtr nejsou k dispozici žádné vazby.</p></div>';
 holder.querySelectorAll('[data-r-detail]').forEach(el=>el.onclick=()=>dialogRelationDetail(el.dataset.rDetail));
 holder.querySelectorAll('[data-r-open]').forEach(el=>el.onclick=()=>openUnit(el.dataset.rOpen));
 holder.querySelectorAll('[data-r-target]').forEach(el=>el.onclick=()=>openUnit(el.dataset.rTarget));
 holder.querySelectorAll('[data-r-edit]').forEach(el=>el.onclick=()=>dialogRelationRevision(el.dataset.rEdit));
 holder.querySelectorAll('[data-r-archive]').forEach(el=>el.onclick=()=>dialogArchiveRelation(el.dataset.rArchive));
}
function openUnit(id){
 const u=getUnit(id);if(!u){toast('Ustanovení nebylo nalezeno',true);return}
 activeDocId=u.document_id;selected=id;openedDocuments.add(u.document_id);
 let parent=getUnit(u.parent_id),n=0;while(parent&&n++<20){openedUnits.add(parent.id);parent=getUnit(parent.parent_id)}
 setPage('library');
}
function relationHistory(r){
 const history=(db.relation_history||[]).filter(h=>h.relation_id===r.id);
 const labels={baseline:'Výchozí uložený stav',created:'Vytvoření vazby',status_approved:'Schválení vazby',status_rejected:'Zamítnutí vazby',revision_edit_approved:'Schválení úpravy',revision_archive_approved:'Schválení archivace',revision_rejected:'Zamítnutí návrhu změny'};
 const fields={target_id:'Cílové ustanovení',relation_type:'Typ vazby',rationale:'Zdůvodnění',evidence:'Doklad',status:'Stav'};
 function parse(s){try{return s?JSON.parse(s):{}}catch{return {}}}
 return history.map(h=>{const old=parse(h.before_json),current=parse(h.after_json);
  const changed=Object.keys(fields).filter(k=>old[k]!==undefined&&current[k]!==undefined&&old[k]!==current[k]);
  return `<div class="history-row"><strong>${esc(labels[h.event_type]||h.event_type)}</strong><small>${esc(h.created_at)}</small>
  ${changed.map(k=>`<div class="history-change"><strong>${esc(fields[k])}:</strong>
  <div class="fine">Před: ${esc(k==='target_id'?fullname(old[k]):k==='relation_type'?relName[old[k]]:old[k])}</div>
  <div class="fine">Po: ${esc(k==='target_id'?fullname(current[k]):k==='relation_type'?relName[current[k]]:current[k])}</div></div>`).join('')}
  </div>`;
 }).join('')||'<p class="fine">Bez záznamů historie.</p>';
}
function dialogRelationDetail(id){
 const r=db.relations.find(x=>x.id===id);if(!r){toast('Vazba neexistuje',true);return}
 const pending=(db.relation_revisions||[]).find(x=>x.relation_id===id&&x.status==='proposed');
 const f=$('#modalContent'),d=$('#modal');
 f.innerHTML=`<h2>Detail propojení</h2><div class="relation-source"><span class="relation-kicker">ZDROJ</span><strong>${esc(fullname(r.source_id))}</strong></div>
 <div class="relation-source"><span class="relation-kicker">CÍL</span><strong>${esc(fullname(r.target_id))}</strong></div>
 <p>Typ: <strong>${esc(relName[r.relation_type]||r.relation_type)}</strong> · ${tag(r.status)}</p>
 <h3>Zdůvodnění</h3><p class="relation-body">${esc(r.rationale)}</p><h3>Doklad / umístění v originále</h3><p class="relation-body">${esc(r.evidence||'Doklad není doplněn')}</p>
 ${pending?`<div class="notice">Čeká návrh ${pending.change_type==='archive'?'archivace':'úpravy'}: ${esc(pending.change_reason)}. Schválená verze zůstává v platnosti.</div>`:''}
 <h3>Historie</h3><div class="history-box">${relationHistory(r)}</div>
 <div class="modal-actions"><button class="btn" id="detailClose" type="button">Zavřít</button>
 <button class="btn" id="detailSource" type="button">Otevřít zdroj</button><button class="btn" id="detailTarget" type="button">Otevřít cíl</button>
 ${r.status==='approved'&&!pending?'<button class="btn accent" id="detailEdit" type="button">Navrhnout úpravu</button>':''}</div>`;
 f.querySelector('#detailClose').onclick=()=>d.close();
 f.querySelector('#detailSource').onclick=()=>{d.close();openUnit(r.source_id)};
 f.querySelector('#detailTarget').onclick=()=>{d.close();openUnit(r.target_id)};
 const btn=f.querySelector('#detailEdit');if(btn)btn.onclick=()=>{d.close();dialogRelationRevision(id)};
 d.showModal();
}
function dialogRelationRevision(id){
 const r=db.relations.find(x=>x.id===id);if(!r||r.status!=='approved')return;
 if((db.relation_revisions||[]).some(x=>x.relation_id===id&&x.status==='proposed')){toast('U vazby už čeká návrh změny',true);return}
 const d=$('#modal'),f=$('#modalContent');
 f.innerHTML=`<h2>Návrh úpravy schválené vazby</h2><p>Schválená vazba zůstane beze změny až do dalšího schválení.</p>
 <div class="relation-source"><span class="relation-kicker">ZDROJOVÉ USTANOVENÍ · NEMĚNÍ SE</span><strong>${esc(fullname(r.source_id))}</strong></div>
 <div class="relation-step">1. CÍLOVÉ USTANOVENÍ</div>
 <label class="form-field"><span>Cílový dokument</span><select class="select" id="editRelDoc">${db.documents.map(x=>`<option value="${esc(x.id)}" ${getUnit(r.target_id)?.document_id===x.id?'selected':''}>${esc(documentLabel(x))}</option>`).join('')}</select></label>
 <label class="form-field"><span>Hledat konkrétní část</span><input class="input" type="search" id="editRelSearch" placeholder="Článek 61, Pravidlo 11…"></label>
 <label class="form-field"><span>Cílové ustanovení</span><select class="select" id="editRelTarget"></select><small class="form-hint" id="editRelCount"></small></label>
 ${select('Typ vazby','relation_type',Object.entries(relName),r.relation_type)}
 ${field('Zdůvodnění a rozsah relevance','rationale',r.rationale,'textarea')}
 <label class="form-field"><span>Doklad / umístění v originále</span><input class="input" name="evidence" value="${esc(r.evidence)}"></label>
 ${field('Proč se schválená vazba mění?','change_reason','','textarea')}
 <div class="modal-actions"><button type="button" class="btn" id="editRelCancel">Zrušit</button><button class="btn accent" type="submit" id="editRelSave">Uložit návrh změny</button></div>`;
 const doc=f.querySelector('#editRelDoc'),search=f.querySelector('#editRelSearch'),target=f.querySelector('#editRelTarget'),count=f.querySelector('#editRelCount');
 function fill(){const q=search.value.trim().toLocaleLowerCase('cs'),prior=target.value||r.target_id;
 const found=db.units.filter(u=>u.document_id===doc.value && u.id!==r.source_id && [unitPath(u.id),u.heading,u.locator].join(' ').toLocaleLowerCase('cs').includes(q));
 target.innerHTML='<option value="">— Vyberte cílové ustanovení —</option>';
 for(const u of found.slice(0,250)){let opt=document.createElement('option');opt.value=u.id;opt.textContent=unitPath(u.id)+(u.heading?' – '+u.heading:'');target.appendChild(opt)}
 if(found.some(u=>u.id===prior))target.value=prior;
 count.textContent=`Nalezeno ${found.length} částí${found.length>250?' (zobrazeno prvních 250; upřesněte hledání)':''}.`;
 }
 doc.onchange=()=>{search.value='';target.value='';fill()};search.oninput=fill;fill();target.value=r.target_id;
 f.querySelector('#editRelCancel').onclick=()=>d.close();
 f.onsubmit=async e=>{e.preventDefault();const vals=Object.fromEntries(new FormData(f).entries());if(!target.value){toast('Vyberte cílovou pasáž',true);return}
 if(!vals.change_reason?.trim()){toast('Doplňte důvod změny',true);return}
 if(!confirm(`Opravdu navrhnout změnu?\n\nOD: ${fullname(r.source_id)}\nNA: ${fullname(target.value)}\n\nPůvodní schválená vazba zůstane zachovaná.`))return;
 const save=f.querySelector('#editRelSave');save.disabled=true;
 try{await act({action:'propose_relation_revision',relation_id:id,change_type:'edit',target_id:target.value,
 relation_type:vals.relation_type,rationale:vals.rationale,evidence:vals.evidence,change_reason:vals.change_reason});d.close()}
 catch(err){toast(err.message,true);save.disabled=false}};
 d.showModal();
}
function dialogArchiveRelation(id){
 const r=db.relations.find(x=>x.id===id);if(!r||r.status!=='approved')return;
 const d=$('#modal'),f=$('#modalContent');
 f.innerHTML=`<h2>Navrhnout archivaci vazby</h2><p>Archivovaná vazba se nebude exportovat studentům. Až do schválení návrhu zůstane dosavadní vazba platná.</p>
 <div class="relation-source"><strong>${esc(fullname(r.source_id))}</strong><div>→ ${esc(fullname(r.target_id))}</div></div>
 ${field('Důvod archivace','change_reason','','textarea')}
 <div class="modal-actions"><button type="button" class="btn" id="archiveCancel">Zrušit</button><button type="submit" class="btn accent">Uložit návrh archivace</button></div>`;
 f.querySelector('#archiveCancel').onclick=()=>d.close();
 f.onsubmit=async e=>{e.preventDefault();const reason=new FormData(f).get('change_reason');
 if(!confirm('Opravdu odeslat návrh archivace do schvalovací fronty?'))return;
 try{await act({action:'propose_relation_revision',relation_id:id,change_type:'archive',change_reason:reason});d.close()}catch(err){toast(err.message,true)}};
 d.showModal();
}
function renderComments(){
 const doc=$('#commentDocFilter');doc.innerHTML='<option value="all">Všechny dokumenty</option>'+db.documents.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))}</option>`).join('');doc.value=commentDocFilter;
 $('#commentStateFilter').value=commentStatusFilter;$('#commentListSearch').value=commentSearch;
 const q=commentSearch.trim().toLocaleLowerCase('cs');
 const items=db.comments.filter(c=>(commentDocFilter==='all'||getUnit(c.unit_id)?.document_id===commentDocFilter)&&
 (commentStatusFilter==='all'||c.status===commentStatusFilter)&&
 (!q||[fullname(c.unit_id),noteName[c.kind],c.body,c.author,c.language].join(' ').toLocaleLowerCase('cs').includes(q)));
 const area=$('#commentList');area.innerHTML=items.length?items.map(c=>{
 const pending=(db.comment_revisions||[]).find(r=>r.comment_id===c.id&&r.status==='proposed');
 return `<div class="review-card comment-list-item"><h3>${esc(fullname(c.unit_id))}</h3>
 <small>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())} · ${esc(c.author||'Redakce RegulaQuest')}</small>
 <p class="comment-preview">${esc(c.body)}</p><div class="actionrow">${tag(c.status)}${pending?'<span class="tag proposed">Čeká návrh změny</span>':''}<button class="btn tiny" data-manage-comment="${esc(c.id)}">Otevřít detail / historie</button><button class="btn tiny" data-open-comment-unit="${esc(c.unit_id)}">Přejít na ustanovení</button></div></div>`;
 }).join(''):'<div class="review-card">Žádné komentáře neodpovídají vybranému filtru.</div>';
 area.querySelectorAll('[data-manage-comment]').forEach(b=>b.onclick=()=>dialogCommentDetail(b.dataset.manageComment));
 area.querySelectorAll('[data-open-comment-unit]').forEach(b=>b.onclick=()=>openUnit(b.dataset.openCommentUnit));
}
function commentHistory(id){
 const descriptions={baseline:'Původní záznam před zavedením historie',created:'Vytvoření konceptu',draft_edited:'Úprava konceptu',status_approved:'Schválení',status_rejected:'Zamítnutí',draft_archived:'Archivace konceptu',draft_restored:'Obnovení konceptu',revision_proposed:'Návrh změny',revision_edit_approved:'Schválená úprava',revision_archive_approved:'Schválená archivace',revision_restore_approved:'Schválené obnovení',revision_rejected:'Zamítnutí návrhu změny'};
 const rows=(db.comment_history||[]).filter(h=>h.comment_id===id);
 return rows.length?rows.map(h=>{
 const before=(()=>{try{return JSON.parse(h.before_json||'{}')}catch{return {}}})();
 const after=(()=>{try{return JSON.parse(h.after_json||'{}')}catch{return {}}})();
 const contentChanged=before.body!==undefined&&after.body!==undefined&&before.body!==after.body;
 return `<div class="history-row"><strong>${esc(descriptions[h.event_type]||h.event_type)}</strong><small>${esc(h.created_at)}</small>${contentChanged?`<details><summary>Porovnat původní a nové znění</summary><div class="revision-text"><strong>Před</strong><p>${esc(before.body)}</p><strong>Po</strong><p>${esc(after.body)}</p></div></details>`:''}</div>`;
 }).join(''):'<p class="fine">Žádná historie.</p>';
}
function commentWasApproved(id){return (db.comment_history||[]).some(h=>{
 if(h.comment_id!==id)return false;try{return JSON.parse(h.after_json||'{}').status==='approved'}catch{return false}
})}
function dialogCommentDetail(id){
 const c=db.comments.find(x=>x.id===id);if(!c){toast('Komentář nebyl nalezen',true);return}
 const pending=(db.comment_revisions||[]).find(r=>r.comment_id===id&&r.status==='proposed');
 const d=$('#modal'),f=$('#modalContent');f.onsubmit=null;
 f.innerHTML=`<h2>Detail odborného komentáře</h2><p>${esc(fullname(c.unit_id))}</p>
 <div class="comment-detail-meta">${tag(c.status)} <span class="tag">${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</span> <span>${esc(c.author||'Redakce RegulaQuest')}</span></div>
 <div class="revision-text"><p>${esc(c.body)}</p></div>
 ${pending?`<div class="notice">Čeká návrh ${pending.change_type==='edit'?'úpravy':pending.change_type==='archive'?'archivace':'obnovení'}: ${esc(pending.change_reason)}. Dosavadní schválená verze zůstává beze změny.</div>`:''}
 <h3>Historie komentáře</h3><div class="history-box">${commentHistory(id)}</div>
 <div class="modal-actions"><button class="btn" type="button" id="closeComment">Zavřít</button><button class="btn" type="button" id="goCommentUnit">Otevřít ustanovení</button>
 ${!pending&&c.status!=='archived'?`<button class="btn accent" type="button" id="editComment">${c.status==='approved'?'Navrhnout úpravu':'Upravit koncept'}</button>`:''}
 ${!pending&&c.status==='approved'?'<button class="btn danger" type="button" id="archiveComment">Navrhnout archivaci</button>':''}
 ${!pending&&['draft','rejected'].includes(c.status)?'<button class="btn danger" type="button" id="archiveDraftComment">Archivovat koncept</button>':''}
 ${!pending&&c.status==='archived'?`<button class="btn accent" type="button" id="restoreComment">${commentWasApproved(c.id)?'Navrhnout obnovení':'Obnovit koncept'}</button>`:''}</div>`;
 f.querySelector('#closeComment').onclick=()=>d.close();
 f.querySelector('#goCommentUnit').onclick=()=>{d.close();openUnit(c.unit_id)};
 const edit=f.querySelector('#editComment');if(edit)edit.onclick=()=>{d.close();dialogCommentEdit(id)};
 const archive=f.querySelector('#archiveComment');if(archive)archive.onclick=()=>{d.close();dialogCommentStatusRevision(id,'archive')};
 const archiveDraft=f.querySelector('#archiveDraftComment');if(archiveDraft)archiveDraft.onclick=()=>{
  if(!confirm('Archivovat tento nepublikovaný koncept? Půjde později obnovit.'))return;
  d.close();safeAct({action:'archive_comment_draft',comment_id:id});};
 const restore=f.querySelector('#restoreComment');if(restore)restore.onclick=()=>{
  d.close();if(commentWasApproved(id))dialogCommentStatusRevision(id,'restore');else safeAct({action:'restore_comment_draft',comment_id:id});};
 d.showModal();
}
function dialogCommentEdit(id){
 const c=db.comments.find(x=>x.id===id);if(!c||!['draft','rejected','approved'].includes(c.status))return;
 const approved=c.status==='approved',pending=(db.comment_revisions||[]).some(r=>r.comment_id===id&&r.status==='proposed');
 if(pending){toast('U komentáře už čeká návrh změny',true);return}
 const html=`<p>${esc(fullname(c.unit_id))}</p><p>${approved?'Schválený komentář zůstane platný až do schválení nové verze.':'Koncept můžete upravit přímo. Zamítnutý komentář se uloží znovu jako koncept.'}</p>
 ${select('Typ komentáře','kind',Object.entries(noteName),c.kind)}
 ${select('Jazyk','language',[['cs','Čeština'],['en','English']],c.language)}
 ${field('Autor / garant','author',c.author||'Redakce RegulaQuest')}
 ${field('Obsah komentáře','body',c.body,'textarea')}
 ${approved?field('Důvod změny pro schválení','change_reason','','textarea'):''}`;
 dialog(approved?'Navrhnout úpravu schváleného komentáře':'Upravit komentář',html,vals=>safeAct({action:approved?'propose_comment_revision':'edit_comment_draft',comment_id:id,...(approved?{change_type:'edit'}:{}),...vals}));
}
function dialogCommentStatusRevision(id,kind){
 const c=db.comments.find(x=>x.id===id);if(!c)return;
 const doing=kind==='archive'?'archivaci':'obnovení';
 dialog(`Navrhnout ${doing} komentáře`, `<p>${esc(fullname(c.unit_id))}</p><p>${kind==='archive'?'Po schválení archivace už komentář nebude ve studentském exportu.':'Po schválení obnovení se schválený komentář opět může exportovat, je-li ověřené zdrojové ustanovení.'}</p><div class="revision-text">${esc(c.body)}</div>${field('Důvod změny','change_reason','','textarea')}`,
 vals=>safeAct({action:'propose_comment_revision',comment_id:id,change_type:kind,...vals}));
}
function decideCommentRevision(id,decision){
 const r=(db.comment_revisions||[]).find(x=>x.id===id);if(!r)return;
 const c=db.comments.find(x=>x.id===r.comment_id);
 if(!confirm(`${decision==='approved'?'Schválit':'Zamítnout'} návrh ${r.change_type==='archive'?'archivace':r.change_type==='restore'?'obnovení':'úpravy'}?\n\n${fullname(c?.unit_id)}\n\n${r.change_reason}`))return;
 safeAct({action:'decide_comment_revision',revision_id:id,decision});
}
function renderPublish(){const verified=db.units.filter(x=>x.text_status==='verified'&&x.body.trim());const ids=new Set(verified.map(x=>x.id));const comments=db.comments.filter(c=>c.status==='approved'&&ids.has(c.unit_id));const links=db.relations.filter(r=>r.status==='approved'&&ids.has(r.source_id)&&ids.has(r.target_id));$('#publishInfo').innerHTML=`<strong>${verified.length} ověřených pasáží</strong>, ${comments.length} schválených komentářů a ${links.length} vazeb se dvěma ověřenými konci bude zahrnuto do exportu.<br><br><span class="fine">Zbývá ${db.units.length-verified.length} rejstříkových nebo neověřených pasáží. Při exportu se vynechají.</span>`}
function dialog(title,fields,onSubmit){const d=$('#modal');const form=$('#modalContent');form.innerHTML=`<h2>${esc(title)}</h2>${fields}<div class="modal-actions"><button class="btn" value="cancel" type="button" id="cancelDialog">Zrušit</button><button class="btn accent" type="submit">Uložit</button></div>`;form.querySelector('#cancelDialog').onclick=()=>d.close();form.onsubmit=event=>{event.preventDefault();const vals=Object.fromEntries(new FormData(form).entries());onSubmit(vals);d.close()};d.showModal()}
const field=(label,name,defaultValue='',type='text')=>`<label class="form-field"><span>${esc(label)}</span>${type==='textarea'?`<textarea class="textarea" name="${name}" required>${esc(defaultValue)}</textarea>`:`<input class="input" name="${name}" type="${type}" value="${esc(defaultValue)}" required>`}</label>`;
const select=(label,name,options,current='')=>`<label class="form-field"><span>${esc(label)}</span><select class="select" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
function dialogDocumentMetadata(id){
 const d=getDoc(id);if(!d)return;
 const f=$('#modalContent'),modal=$('#modal');
 f.innerHTML=`<h2>Metadata a tagy · ${esc(d.family)} ${esc(d.language.toUpperCase())}</h2>
 <p>Metadata budou využitelná pro katalog a pozdější studentské filtrování. Odborné tagy jsou sdílené mezi jazykovými verzemi téhož dokumentu.</p>
 ${select('Původ / jurisdikce','jurisdiction',Object.entries(jurisdictions),d.jurisdiction||'other')}
 ${select('Druh dokumentu','document_type',Object.entries(docTypes),d.document_type||'other')}
 <label class="form-field"><span>Odborné tagy (oddělit čárkou)</span><textarea class="textarea" name="topics" placeholder="Např. klasifikace, software, klinické hodnocení">${esc((d.topics||[]).join(', '))}</textarea><small class="form-hint">Zvolte jednotné názvy. Tagy nepředstavují samotnou odbornou vazbu na ustanovení.</small></label>
 <div class="notice">Dokumentová skupina: ${esc(d.group_key||d.id)}. Změna typu, původu a tagů bude platit pro propojené jazykové verze. Text ani schválené vazby se nemění.</div>
 <div class="modal-actions"><button class="btn" type="button" id="cancelMetadata">Zrušit</button><button class="btn accent" type="submit">Uložit metadata</button></div>`;
 f.querySelector('#cancelMetadata').onclick=()=>modal.close();
 f.onsubmit=e=>{e.preventDefault();const raw=Object.fromEntries(new FormData(f).entries());const topics=[...new Set(String(raw.topics||'').split(',').map(t=>t.trim()).filter(Boolean))];if(topics.length>40){toast('Maximálně 40 tagů',true);return}
 safeAct({action:'update_document_metadata',document_id:id,jurisdiction:raw.jurisdiction,document_type:raw.document_type,topics});modal.close();};
 modal.showModal();
}
function dialogText(u){const content=`<p>Text bude uložen jako <strong>neověřený</strong>. Před publikováním jej porovnejte s původním oficiálním dokumentem a potvrďte ověření.</p>${field('Původ textu / odkaz na stažený soubor','source_note',u.source_note||'Ručně vložený text')}${field('Doslovné znění pasáže','body',u.body,'textarea')}`;dialog('Text · '+u.label,content,vals=>safeAct({action:'save_unit_text',unit_id:u.id,...vals}))}
function openRelatedForUnit(id){
 const u=getUnit(id);if(!u)return;
 relatedScope='unit';relatedSourceDocId=u.document_id;relatedSourceUnitId=id;
 const available=db.documents.filter(d=>d.id!==u.document_id);
 relatedTargetDocId=(available.find(d=>d.id==='mdcg-2021-24-en')||available.find(d=>d.id==='mdr-cs')||available[0])?.id||'';
 relatedSourceQuery='';relatedData=null;relatedFilter='all';relatedResultQuery='';relatedPage=0;
 setPage('related');
 $('#relatedSourceSearch').value='';
 $('#relatedOutput').innerHTML='<div class="empty-state">Zvolte cílový dokument a spusťte analýzu souvislostí.</div>';
}
function invalidateRelatedResults(){
 relatedData=null;relatedSeq++;relatedPage=0;
 const out=$('#relatedOutput');if(out)out.innerHTML='<div class="empty-state">Změnili jste zadání. Spusťte novou analýzu souvislostí.</div>';
}
function renderRelatedSetup(){
 const doc=$('#relatedSourceDoc'),unit=$('#relatedSourceUnit'),target=$('#relatedTargetDoc');
 if(!doc||!db.documents.length)return;
 $('#relatedScope').value=relatedScope;
 const unitMode=relatedScope==='unit';
 $('#relatedSourceSearchField').classList.toggle('hidden',!unitMode);
 $('#relatedSourceUnitField').classList.toggle('hidden',!unitMode);
 if(!getDoc(relatedSourceDocId))relatedSourceDocId=db.documents[0].id;
 doc.innerHTML=db.documents.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))}</option>`).join('');doc.value=relatedSourceDocId;
 if(unitMode){
  const unitList=db.units.filter(x=>x.document_id===relatedSourceDocId&&String(x.body||'').trim()&&
   [unitPath(x.id),x.heading,x.locator,x.body.slice(0,300)].join(' ').toLocaleLowerCase('cs').includes(relatedSourceQuery.toLocaleLowerCase('cs')));
  if(!unitList.some(x=>x.id===relatedSourceUnitId))relatedSourceUnitId=unitList[0]?.id||'';
  unit.innerHTML=unitList.length?unitList.map(x=>`<option value="${esc(x.id)}">${esc(unitPath(x.id))}${x.heading?' · '+esc(x.heading.slice(0,70)):''}</option>`).join(''):'<option value="">Žádná odpovídající pasáž s textem</option>';
  unit.value=relatedSourceUnitId;
 }
 const others=db.documents.filter(d=>d.id!==relatedSourceDocId);
 if(relatedTargetDocId!=='all'&&!others.some(d=>d.id===relatedTargetDocId))relatedTargetDocId=(others.find(d=>d.id==='mdcg-2021-24-en')||others[0])?.id||'';
 target.innerHTML='<option value="all">Všechny další dokumenty (mimo jiné jazykové verze)</option>'+others.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))}</option>`).join('');target.value=relatedTargetDocId;
 $('#relatedAnalyze').disabled=(unitMode?!relatedSourceUnitId:!db.units.some(u=>u.document_id===relatedSourceDocId&&String(u.body||'').trim()))||relatedBusy;
}
async function runRelatedSearch(){
 if(relatedBusy)return;
 const bulk=relatedScope==='document';
 if(!bulk&&!getUnit(relatedSourceUnitId)){toast('Vyberte ustanovení s textem.',true);return}
 relatedBusy=true;relatedData=null;relatedFilter='all';relatedResultQuery='';relatedPage=0;
 const serial=++relatedSeq,button=$('#relatedAnalyze'),out=$('#relatedOutput');
 button.disabled=true;out.innerHTML=`<div class="empty-state">${bulk?'Procházím celý dokument a porovnávám jeho pasáže s jinými zdroji. Výsledky se zobrazí až po dokončení analýzy…':'Vyhledávám související pasáže…'}</div>`;
 try{
  let endpoint,params;
  if(bulk){endpoint='/api/related-batch?';params=new URLSearchParams({source_document_id:relatedSourceDocId,target_document_id:relatedTargetDocId||'all'});}
  else {endpoint='/api/related-suggestions?';params=new URLSearchParams({unit_id:relatedSourceUnitId,target_document_id:relatedTargetDocId||'all',limit:'30'});}
  const r=await fetch(endpoint+params,{cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Vyhledávání selhalo');
  if(serial!==relatedSeq)return;
  relatedData=data;renderRelatedResults();
 }catch(e){if(serial===relatedSeq){out.innerHTML='<div class="empty-state">Analýza se nezdařila.</div>';toast(e.message,true)}}
 finally{relatedBusy=false;renderRelatedSetup()}
}
function renderRelatedResults(){
 const data=relatedData,out=$('#relatedOutput');if(!data)return;
 const bulk=data.scope==='document';
 const all=data.results||[];
 const q=relatedResultQuery.toLocaleLowerCase('cs').trim();
 const filtered=all.filter(c=>{
  if(relatedFilter==='structural'&&c.match_kind!=='structural-rule')return false;
  if(relatedFilter==='lexical'&&c.match_kind==='structural-rule')return false;
  if(relatedFilter==='new'&&c.existing_status)return false;
  if(relatedFilter==='existing'&&!c.existing_status)return false;
  if(!q)return true;
  return [fullname(c.source_id),fullname(c.target_id),c.explanation,(c.matched_concepts||[]).join(' '),c.target_excerpt]
   .join(' ').toLocaleLowerCase('cs').includes(q);
 });
 const pageSize=20,maxPage=Math.max(0,Math.ceil(filtered.length/pageSize)-1);
 relatedPage=Math.min(relatedPage,maxPage);
 const start=relatedPage*pageSize,pageItems=filtered.slice(start,start+pageSize);
 const structural=all.filter(c=>c.match_kind==='structural-rule').length;
 const already=all.filter(c=>!!c.existing_status).length;
 const scan=bulk?`Prohledáno ${data.scanned_sources} zdrojových a ${data.scanned_targets} cílových pasáží (bez duplicitních nadřazených záznamů).`:`Zkontrolováno ${data.scanned_targets} cílových pasáží.`;
 out.innerHTML=`<div class="related-summary"><strong>${bulk?'Hromadná analýza':'Analýza ustanovení'}: ${data.total_candidates??data.count} kandidátů</strong><span class="related-summary-detail">${esc(scan)} Nic nebylo uloženo.</span></div>
 ${bulk?`<p class="related-note">Zobrazeny jsou maximálně ${data.per_source_limit} slovníkové návrhy z jedné zdrojové pasáže plus případné strukturální shody. ${data.skipped_parent_sources} opakujících se nadřazených zdrojů bylo vynecháno. ${data.truncated?'Pozor: zobrazeno pouze prvních '+data.count+' z '+data.total_candidates+' kandidátů.':''} Nejde o úplný soupis všech odborných souvislostí.</p>`:''}
 <div class="related-filterbar">
 <label class="form-field"><span>Typ výsledku</span><select class="select" id="relatedResultFilter">
  ${[['all',`Všechny (${all.length})`],['structural',`Shoda pravidel (${structural})`],['lexical',`Slovníková podobnost (${all.length-structural})`],['new',`Nové (${all.length-already})`],['existing',`Existující (${already})`]].map(([v,l])=>`<option value="${v}" ${relatedFilter===v?'selected':''}>${esc(l)}</option>`).join('')}
 </select></label>
 <label class="form-field"><span>Hledat ve výsledcích</span><input id="relatedResultSearch" class="input" type="search" value="${esc(relatedResultQuery)}" placeholder="Pravidlo 11, software, klinické…"></label>
 <p class="fine">Zobrazeno ${filtered.length?start+1:0}–${Math.min(filtered.length,start+pageSize)} z ${filtered.length} filtrovaných</p>
 </div>
 ${!filtered.length?'<div class="empty-state">Pro tento filtr nejsou nalezeni žádní kandidáti. Zkuste jiný filtr; nepřítomnost výsledku neznamená, že odborná vazba neexistuje.</div>':''}
 <div class="related-results">${pageItems.map((c,i)=>{
  const existing=c.existing_status,matched=c.matched_concepts||[];
  const idx=start+i;
  return `<article class="related-result">
   <div class="related-result-source">${esc(fullname(c.source_id))}<span class="related-result-arrow">→</span></div>
   <div class="related-result-top"><h3>${esc(fullname(c.target_id))}</h3><span class="tag ${existing?'good':c.match_kind==='structural-rule'?'good':'warn'}">${existing?'Existující vazba':c.match_kind==='structural-rule'?'Shoda klasifikačního pravidla':'Slovníková podobnost'}</span></div>
   <p class="related-reason">${esc(c.explanation)}</p>
   ${matched.length?`<p class="fine"><strong>Shodné pojmy:</strong> ${esc(matched.join(', '))}</p>`:''}
   <div class="related-excerpt"><span>ÚRYVEK CÍLOVÉHO TEXTU (PRACOVNÍ PŘEPIS)</span>${esc(c.target_excerpt||'')}</div>
   ${(c.warnings||[]).length?`<p class="related-warning">⚠ ${esc(c.warnings.join(' '))}</p>`:''}
   <p class="fine">Navržený druh vazby: <strong>${esc(relName[c.suggested_relation_type]||'Tematická souvislost')}</strong>. Typ lze ve formuláři změnit.</p>
   <div class="actionrow"><button class="btn tiny" type="button" data-related-source="${idx}">Otevřít zdroj ↗</button> <button class="btn tiny" type="button" data-related-open="${idx}">Otevřít cíl ↗</button>
   ${existing?`<span class="fine">${esc(statusName[existing]||existing)} – znovu nenavrhovat</span>`:`<button class="btn tiny accent" type="button" data-related-propose="${idx}">Zkontrolovat a vytvořit návrh ↗</button>`}</div>
  </article>`}).join('')}</div>
 <div class="related-page-nav"><span class="fine">Strana ${relatedPage+1} z ${maxPage+1}</span><div class="actionrow"><button type="button" class="btn tiny" id="relatedPrev" ${relatedPage===0?'disabled':''}>← Předchozí</button><button type="button" class="btn tiny" id="relatedNext" ${relatedPage>=maxPage?'disabled':''}>Další →</button></div></div>
 <p class="fine">Automatické hledání používá pouze strukturální a slovníkové porovnání; výsledky nejsou odborně ověřené a neobsahují embeddingy ani jazykový model. Před schválením porovnejte oba texty s originály.</p>`;
 const item=b=>filtered[Number(b.dataset.relatedPropose??b.dataset.relatedOpen??b.dataset.relatedSource)];
 out.querySelector('#relatedResultFilter').onchange=e=>{relatedFilter=e.target.value;relatedPage=0;renderRelatedResults()};
 out.querySelector('#relatedResultSearch').oninput=e=>{relatedResultQuery=e.target.value;relatedPage=0;renderRelatedResults();const field=$('#relatedResultSearch');field.focus();field.setSelectionRange(field.value.length,field.value.length)};
 out.querySelector('#relatedPrev').onclick=()=>{relatedPage=Math.max(0,relatedPage-1);renderRelatedResults()};
 out.querySelector('#relatedNext').onclick=()=>{relatedPage=Math.min(maxPage,relatedPage+1);renderRelatedResults()};
 out.querySelectorAll('[data-related-open]').forEach(b=>b.onclick=()=>{const c=item(b);if(c)openUnit(c.target_id)});
 out.querySelectorAll('[data-related-source]').forEach(b=>b.onclick=()=>{const c=item(b);if(c)openUnit(c.source_id)});
 out.querySelectorAll('[data-related-propose]').forEach(b=>b.onclick=()=>{
  const found=item(b),source=getUnit(found?.source_id);
  if(!found||!source){toast('Zdrojový záznam nelze otevřít',true);return}
  dialogRelation(source,{...found,kind:'related',relation_type:found.suggested_relation_type});
 });
}
function renderBatchSetup(){
 const scope=$('#batchScope'),doc=$('#batchDocument'),unit=$('#batchUnit');if(!scope)return;
 scope.value=batchScope;
 if(!getDoc(batchDocId))batchDocId=activeDocId||db.documents[0]?.id||'';
 doc.innerHTML=db.documents.map(d=>`<option value="${esc(d.id)}">${esc(documentLabel(d))} – ${esc(d.title)}</option>`).join('');doc.value=batchDocId;
 $('#batchDocumentField').classList.toggle('hidden',batchScope==='all');
 $('#batchUnitField').classList.toggle('hidden',batchScope!=='unit');
 const units=db.units.filter(u=>u.document_id===batchDocId);
 if(!units.find(u=>u.id===batchUnitId))batchUnitId=units[0]?.id||'';
 unit.innerHTML=units.map(u=>`<option value="${esc(u.id)}">${esc(unitPath(u.id))}${u.heading?' – '+esc(u.heading).slice(0,55):''}</option>`).join('');
 unit.value=batchUnitId;
 if(batchData)renderBatchResults();
}
function renderBatchResults(){
 const out=$('#batchOutput');if(!out)return;
 if(!batchData){out.innerHTML='<div class="empty-state">Spusťte analýzu pro zvolený rozsah.</div>';return}
 const d=batchData,counts=d.counts||{new:0,existing:0,unresolved:0};
 const summary=[['all','Celkem',d.total],['new','Nové',counts.new],['existing','Již existují',counts.existing],['unresolved','Nerozpoznané',counts.unresolved]];
 const statuses={new:'Nový návrh',existing:'Již existuje',unresolved:'Nelze určit cíl'};
 const start=d.matched?d.offset+1:0,finish=Math.min(d.offset+d.limit,d.matched);
 const eligible=d.results.filter(c=>c.category==='new');
 out.innerHTML=`<div class="batch-stats">${summary.map(([v,t,n])=>`<button type="button" class="batch-stat ${batchFilter===v?'active':''}" data-batch-stat="${v}"><small>${t}</small><strong>${n}</strong><small>${v==='new'?'Lze navrhnout':v==='existing'?'Bez opětovného ukládání':v==='unresolved'?'K ručnímu prověření':'Rozpoznané v rozsahu'}</small></button>`).join('')}</div>
 <div class="batch-filter-panel"><div class="batch-filter-grid">
 <label class="form-field"><span>Stav kandidáta</span><select class="select" id="batchStatusFilter"><option value="all">Všechny</option><option value="new">Pouze nové</option><option value="existing">Již existující</option><option value="unresolved">Nerozpoznané</option></select></label>
 <label class="form-field"><span>Hledat ve výsledcích</span><input class="input" type="search" id="batchSearch" placeholder="Článek 61, příloha XIV nebo označení ustanovení" value="${esc(batchSearch)}"></label>
 <button type="button" class="btn" id="batchApplyFilter">Filtrovat</button></div>
 <div class="batch-toolbar"><p class="fine">Zkontrolováno ${d.source_count} položek (s podporovaným textem: ${d.eligible_source_count}). ${d.unsupported_document_ids.length?'Zatím nepodporované dokumenty: '+d.unsupported_document_ids.map(x=>esc(documentLabel(getDoc(x)))).join(', ')+'.':''}</p>
 <p class="fine">${start}–${finish} z ${d.matched} vyfiltrovaných výsledků</p></div></div>
 <div class="batch-toolbar" style="margin:12px 0"><label class="batch-check"><input type="checkbox" id="batchSelectPage" ${eligible.length&&!eligible.some(c=>!batchChosen.has(batchKey(c)))?'checked':''} ${!eligible.length?'disabled':''}> Vybrat nové návrhy na této stránce</label>
 <div class="batch-toolbar"><strong id="batchSelectedLabel">Vybráno ${batchChosen.size} z max. 50</strong><button type="button" class="btn" id="batchClearSelection" ${batchChosen.size?'':'disabled'}>Zrušit výběr</button><button type="button" class="btn accent" id="batchSaveSelection" ${batchChosen.size?'':'disabled'}>Odeslat vybrané ke kontrole ↗</button></div></div>
 <div class="batch-list">${d.results.length?d.results.map((c,i)=>`<div class="batch-item" data-batch-row="${i}">
 <div class="batch-item-heading"><div><h3>${esc(fullname(c.source_id))} → ${c.target_id?esc(fullname(c.target_id)):esc(c.target_hint)}</h3>
 <span class="tag ${c.category==='existing'?'good':c.category==='new'?'proposed':'warn'}">${statuses[c.category]}</span>${c.existing_status?' <span class="fine">('+esc(statusName[c.existing_status]||c.existing_status)+')</span>':''}
 ${c.source_text_status!=='verified'?'<span class="fine"> · Zdrojový text není ověřen</span>':''}</div>
 ${c.category==='new'?`<label class="batch-check"><input type="checkbox" data-batch-check="${i}" ${batchChosen.has(batchKey(c))?'checked':''}> Vybrat</label>`:''}</div>
 <p>Rozpoznáno: <strong>${esc(c.matched_text)}</strong> · Typ: Výslovný odkaz</p>
 <div class="batch-evidence">${esc(c.evidence)}</div>
 ${c.category==='unresolved'?`<p class="fine">${esc(c.reason)}</p>`:c.category==='new'?`<div class="actionrow"><button class="btn tiny" type="button" data-batch-review="${i}">Individuálně zkontrolovat a upravit ↗</button></div>`:''}
 </div>`).join(''):'<div class="notice">Pro zvolené filtry nejsou žádné odpovídající výsledky.</div>'}</div>
 <div class="batch-footer" style="margin:17px 0"><p class="batch-paging">Stránka ${Math.floor(d.offset/d.limit)+1} · Zobrazeno ${start}–${finish} z ${d.matched}</p><div class="actionrow"><button class="btn" type="button" id="batchPrevious" ${d.offset<=0?'disabled':''}>← Předchozí</button><button class="btn" type="button" id="batchNext" ${d.offset+d.limit>=d.matched?'disabled':''}>Další →</button></div></div>
 <div class="notice">Návrhy jsou automatické a mohou vyžadovat opravu. Ukládají se výhradně se stavem <strong>Návrh</strong>. Do studentské aplikace vstupují až po schválení a ověření obou ustanovení.</div>`;
 $('#batchStatusFilter').value=batchFilter;
 out.querySelectorAll('[data-batch-stat]').forEach(b=>b.onclick=()=>{batchFilter=b.dataset.batchStat;batchOffset=0;runBatchScan()});
 $('#batchStatusFilter').onchange=e=>{batchFilter=e.target.value;batchOffset=0;runBatchScan()};
 $('#batchApplyFilter').onclick=()=>{batchSearch=$('#batchSearch').value;batchOffset=0;runBatchScan()};
 $('#batchSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#batchApplyFilter').click()}};
 $('#batchPrevious').onclick=()=>{batchOffset=Math.max(0,batchOffset-d.limit);runBatchScan()};
 $('#batchNext').onclick=()=>{batchOffset+=d.limit;runBatchScan()};
 out.querySelectorAll('[data-batch-check]').forEach(b=>b.onchange=e=>{
   const c=d.results[Number(b.dataset.batchCheck)],key=batchKey(c);
   if(e.target.checked){if(batchChosen.size>=50){e.target.checked=false;toast('Maximálně 50 návrhů v jednom uložení.',true);return}batchChosen.set(key,c)}else batchChosen.delete(key);
   renderBatchResults();
 });
 $('#batchSelectPage').onchange=e=>{
   if(e.target.checked){for(const c of eligible){if(batchChosen.size>=50)break;batchChosen.set(batchKey(c),c)}}
   else for(const c of eligible)batchChosen.delete(batchKey(c));
   renderBatchResults();
 };
 $('#batchClearSelection').onclick=()=>{batchChosen.clear();renderBatchResults()};
 $('#batchSaveSelection').onclick=saveBatchSelection;
 out.querySelectorAll('[data-batch-review]').forEach(b=>b.onclick=()=>{
   const c=d.results[Number(b.dataset.batchReview)],source=getUnit(c.source_id);
   if(!source)return toast('Zdroj není dostupný',true);
   dialogRelation(source,c);
 });
}
async function runBatchScan(){
 const seq=++batchRequestSeq;
 const out=$('#batchOutput');
 out.innerHTML='<div class="review-card">Analyzuji výslovné odkazy…</div>';
 const qs=new URLSearchParams({scope:batchScope,document_id:batchDocId,unit_id:batchUnitId,state:batchFilter,search:batchSearch,offset:String(batchOffset),limit:'50'});
 try{
  const response=await fetch('/api/reference-batch?'+qs.toString(),{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.error||'Analýza se nezdařila');
  if(seq!==batchRequestSeq || page!=='batch')return;
  batchData=data;renderBatchResults();
 }catch(e){if(seq===batchRequestSeq){batchData=null;out.innerHTML='<div class="notice">Chyba při analýze: '+esc(e.message)+'</div>';toast(e.message,true)}}
}
async function saveBatchSelection(){
 if(batchBusy||!batchChosen.size)return;
 const selected=[...batchChosen.values()];
 if(!confirm('Vytvořit '+selected.length+' nových návrhů vazeb?\n\nVazby se uloží do schvalovací fronty jako návrhy. Žádná se automaticky neschválí.'))return;
 batchBusy=true;$('#batchSaveSelection').disabled=true;
 try{
  const response=await act({action:'batch_new_relations',links:selected.map(c=>({source_id:c.source_id,target_id:c.target_id}))});
  batchChosen.clear();await runBatchScan();
  toast('Do schvalovací fronty přidáno '+response.batch.created+' vazeb; již existujících přeskočeno: '+response.batch.skipped+'.');
 }catch(e){toast('Návrhy nebyly uloženy: '+e.message,true)}finally{batchBusy=false}
}

async function dialogReferenceSuggestions(u){
 const d=$('#modal'),form=$('#modalContent');
 form.onsubmit=null;
 form.innerHTML=`<h2>Výslovné odkazy v textu</h2><p>První automatické návrhy bez AI. Hledají pouze výslovně uvedené články, přílohy a pravidla <strong>ve stejném MDR a jazyce</strong>. Každý výsledek je nutné zkontrolovat.</p><div id="citationResults" class="review-stack">Kontroluji text…</div><div class="modal-actions"><button class="btn" id="closeSuggestions" type="button">Zavřít</button></div>`;
 form.querySelector('#closeSuggestions').onclick=()=>d.close();d.showModal();
 try{
  const r=await fetch('/api/reference-suggestions?unit_id='+encodeURIComponent(u.id),{cache:'no-store'}),data=await r.json();
  if(!r.ok)throw new Error(data.error||'Návrhy se nepodařilo načíst');
  if(!d.open || selected!==u.id)return;
  const output=form.querySelector('#citationResults');
  output.innerHTML=data.suggestions.length?data.suggestions.map((c,i)=>`<div class="boxnote"><strong>${esc(fullname(c.target_id))}</strong><p class="fine">Rozpoznáno: <strong>${esc(c.matched_text)}</strong></p><p class="fine">Zdrojový důkaz: „${esc(c.excerpt)}“</p>${c.existing_status?`<p class="fine">Vazba již existuje: ${esc(statusName[c.existing_status]||c.existing_status)}</p>`:`<button class="btn tiny accent" type="button" data-suggest-index="${i}">Zkontrolovat a vytvořit návrh ↗</button>`}</div>`).join(''):'<div class="notice">Nebyly nalezeny výslovné odkazy, které lze jednoznačně přiřadit k existujícím ustanovením. Použijte ruční propojení. Nejde o potvrzení, že v textu žádné odkazy nejsou.</div>';
  output.querySelectorAll('[data-suggest-index]').forEach(b=>b.onclick=()=>{
   const c=data.suggestions[Number(b.dataset.suggestIndex)];
   d.close();
   try{dialogRelation(u,c)}catch(error){console.error('Nepodařilo se otevřít formulář propojení',error);toast('Formulář propojení se nepodařilo otevřít: '+error.message,true)}
  });
 }catch(error){if(d.open)form.querySelector('#citationResults').textContent=error.message}
}
function dialogRelation(u,preset=null){
 // Manual selection or editor-reviewed deterministic citation / cross-document search suggestion.
 const sourceDoc=getDoc(u.document_id),d=$('#modal'),form=$('#modalContent');
 const relHelp={
  guidance:'Metodika vysvětluje nebo konkretizuje právní ustanovení (např. MDR → MDCG). Nejde o změnu právního znění.',
  references:'Zdrojové ustanovení výslovně uvádí cílový článek, odstavec, pravidlo nebo přílohu.',
  related:'Souvislost je tematická; ve zdrojovém textu nemusí být přímý odkaz.',
  supplements:'Cílová pasáž doplňuje nebo rozvádí obsah zdrojové pasáže.',
  amends:'Vyhrazeno pro skutečný pozměňující/nahrazující právní akt. Nepoužívat pro metodický výklad.'
 };
 const isExampleSource=sourceDoc?.id==='mdr-cs' && /^Článek 10 › Odstavec 3$/.test(unitPath(u.id));
 const exampleRationale='Článek 10 odst. 3 MDR stanoví povinnost výrobce provádět klinické hodnocení podle článku 61 a přílohy XIV. Cílový článek 61 rozvádí požadavky na klinické hodnocení.';
 const exampleEvidence='MDR (EU) 2017/745, české konsolidované znění k 19. 7. 2026, článek 10 odst. 3 (výslovný odkaz na článek 61); porovnat s oficiálním zněním na EUR-Lexu.';
 const docOpts=db.documents.map(doc=>`<option value="${esc(doc.id)}">${esc(doc.title)} · ${esc(doc.language.toUpperCase())} · ${esc(doc.version)}</option>`).join('');
 form.innerHTML=`<h2>Nové propojení</h2>
 <p>Vytvoříte <strong>návrh vazby</strong> do schvalovací fronty. Automatické návrhy, včetně podobnosti textů, nejsou odborně ověřené. Zkontrolujte skutečný obsah obou originálů.</p>
 <div class="relation-source"><span class="relation-kicker">ODKUD PROPOJUJEME · ZDROJOVÉ USTANOVENÍ</span>
 <strong>${esc(documentLabel(sourceDoc))}</strong>
 <div class="relation-path">${esc(unitPath(u.id))}</div>
 ${u.heading?`<div class="relation-small">${esc(u.heading)}</div>`:''}
 <div class="relation-small">Stav textu: ${esc(statusName[u.text_status]||u.text_status)}</div></div>
 <div class="relation-step">1. CÍLOVÉ USTANOVENÍ</div>
 <label class="form-field"><span>Cílový dokument</span><select class="select" name="document_choice" id="relationDocument" required><option value="">— Vyberte dokument —</option>${docOpts}</select></label>
 <label class="form-field"><span>Najít část cílového dokumentu</span><input class="input" type="search" id="relationSearch" placeholder="Např. Článek 61, příloha XIV nebo klinické hodnocení" disabled autocomplete="off"><small class="form-hint">Prohledává označení, nadpisy a umístění ustanovení ve vybraném dokumentu.</small></label>
 <label class="form-field"><span>Cílová pasáž</span><select class="select" name="target_id" id="relationTarget" required disabled><option value="">— Nejprve vyberte dokument —</option></select><small class="form-hint" id="relationCount" aria-live="polite"></small></label>
 <div class="relation-target-preview" id="relationTargetPreview" aria-live="polite">Zatím není vybráno cílové ustanovení.</div>
 <div class="relation-step">2. DRUH A VÝZNAM VAZBY</div>
 <label class="form-field"><span>Typ vazby</span><select class="select" name="relation_type" id="relationType" required><option value="">— Vyberte typ propojení —</option>${Object.entries(relName).map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select><small class="form-hint" id="relationTypeHelp" aria-live="polite">Např. výslovný odkaz = zdroj přímo jmenuje cílové ustanovení.</small></label>
 <label class="form-field"><span>Zdůvodnění a rozsah relevance</span><textarea class="textarea" name="rationale" id="relationRationale" required placeholder="Proč spolu části souvisejí? Co konkrétně má student v cílové části najít?"></textarea><small class="form-hint">Odborné vysvětlení vztahu. Neopisujte celé ustanovení.</small></label>
 <label class="form-field"><span>Doklad / umístění v originále</span><input class="input" name="evidence" id="relationEvidence" placeholder="Např. MDR CS, čl. 10 odst. 3; EUR-Lex; odkaz přímo na čl. 61"><small class="form-hint">Kde se dá vztah ověřit: dokument, jazyk, článek/odstavec, strana PDF nebo oficiální URL. Před schválením zkontrolovat.</small></label>
 <div class="relation-example"><strong>Příklad pro tuto zkoušku</strong>
 <p>Čl. 10 odst. 3 → čl. 61 MDR: <strong>Výslovný odkaz</strong>. Zdůvodnění vysvětluje, co odkaz spojuje; doklad zaznamenává, kde je odkaz v originále uveden.</p>
 <button class="btn tiny" id="relationFillExample" type="button" hidden>Vyplnit tento příklad (lze upravit)</button></div>
 <div class="modal-actions"><button class="btn" type="button" id="cancelDialog">Zrušit</button><button class="btn accent" type="submit" id="relationSave">Uložit návrh</button></div>`;
 const docSelect=form.querySelector('#relationDocument'),search=form.querySelector('#relationSearch'),target=form.querySelector('#relationTarget'),count=form.querySelector('#relationCount'),preview=form.querySelector('#relationTargetPreview');
 const type=form.querySelector('#relationType'),typeHelp=form.querySelector('#relationTypeHelp');
 const fill=form.querySelector('#relationFillExample'),rationale=form.querySelector('#relationRationale'),evidence=form.querySelector('#relationEvidence');
 function validExample(){return isExampleSource && getUnit(target.value)?.document_id==='mdr-cs' && unitPath(target.value)==='Článek 61'}
 function syncExample(){fill.hidden=!validExample()}
 function chosenTarget(){
  const chosen=getUnit(target.value);
  preview.innerHTML=chosen?`<strong>${esc(documentLabel(getDoc(chosen.document_id)))}</strong><div>${esc(unitPath(chosen.id))}${chosen.heading?' – '+esc(chosen.heading):''}</div><small>Stav textu: ${esc(statusName[chosen.text_status]||chosen.text_status)}</small>`:'Zatím není vybráno cílové ustanovení.';
  syncExample();
 }
 function listTargets(){
  const id=docSelect.value,q=search.value.trim().toLocaleLowerCase('cs'),prior=target.value;
  target.innerHTML='<option value="">— Vyberte cílové ustanovení —</option>';
  target.disabled=!id; search.disabled=!id;
  if(!id){count.textContent='Nejprve vyberte cílový dokument.';chosenTarget();return}
  const matching=db.units.filter(x=>x.document_id===id && x.id!==u.id && [unitPath(x.id),x.heading,x.locator].join(' ').toLocaleLowerCase('cs').includes(q));
  const limit=200;
  for(const x of matching.slice(0,limit)){
   const opt=document.createElement('option');opt.value=x.id;
   opt.textContent=unitPath(x.id)+(x.heading?' – '+x.heading:'');target.appendChild(opt);
  }
  if(matching.some(x=>x.id===prior))target.value=prior;
  count.textContent=matching.length>limit?`Nalezeno ${matching.length} částí; zobrazeno prvních ${limit}. Upřesněte hledání.`:matching.length?`Nalezeno ${matching.length} částí.`:'Žádné odpovídající ustanovení.';
  chosenTarget();
 }
 docSelect.onchange=()=>{search.value='';listTargets()};search.oninput=listTargets;target.onchange=chosenTarget;
 // The preset branch calls type.onchange() while pre-filling an automatic suggestion.
 // Register the handler BEFORE applying preset values (otherwise the modal never opens).
 type.onchange=()=>{typeHelp.textContent=relHelp[type.value]||'Vyberte typ podle skutečné povahy vztahu mezi dokumenty.'};
 if(preset){
  const dest=getUnit(preset.target_id);
  if(dest){
   docSelect.value=dest.document_id;
   search.value=unitPath(dest.id);
   listTargets();target.value=dest.id;chosenTarget();
   type.value=preset.relation_type||'references';type.onchange();
   rationale.value=preset.rationale||'Zdrojová pasáž výslovně odkazuje na '+unitPath(dest.id)+'. Prověřte význam a rozsah odkazu proti originálu.';
   evidence.value=preset.evidence||`${sourceDoc.family} ${sourceDoc.language.toUpperCase()}, ${u.locator||unitPath(u.id)}: „${preset.excerpt}“`;
  }
 }

 fill.onclick=()=>{if(!validExample())return;type.value='references';type.onchange();rationale.value=exampleRationale;evidence.value=exampleEvidence;rationale.focus()};
 form.querySelector('#cancelDialog').onclick=()=>d.close();
 form.onsubmit=async event=>{
  event.preventDefault();
  const chosen=getUnit(target.value);
  if(!chosen || chosen.document_id!==docSelect.value){toast('Vyberte konkrétní cílové ustanovení.',true);return}
  if(chosen.id===u.id){toast('Nelze propojit ustanovení samo se sebou.',true);return}
  if(!type.value || !rationale.value.trim()){toast('Doplňte typ a zdůvodnění vazby.',true);return}
  if(db.relations.some(r=>r.source_id===u.id&&r.target_id===chosen.id&&r.relation_type===type.value&&r.status!=='rejected')){toast('Tato vazba již existuje.',true);return}
  if(!confirm(`Opravdu uložit návrh propojení?\n\nOD: ${fullname(u.id)}\n\nNA: ${fullname(chosen.id)}\n\nTYP: ${relName[type.value]}`))return;
  const save=form.querySelector('#relationSave');save.disabled=true;
  try{await act({action:'new_relation',source_id:u.id,target_id:chosen.id,relation_type:type.value,rationale:rationale.value.trim(),evidence:evidence.value.trim(),provenance:preset?(preset.kind==='related'?'cross-document-structure-lexical-v1; editor-reviewed':'explicit-citation-v1; editor-reviewed'):'manual'});d.close()}
  catch(err){toast(err.message,true);save.disabled=false}
 };
 d.showModal();
}

function dialogComment(u){const html=`<p>Komentář není součástí právního předpisu. Nejprve se uloží jako koncept.</p>${select('Typ komentáře','kind',Object.entries(noteName))}${select('Jazyk','language',[['cs','Čeština'],['en','English']])}${field('Autor / garant','author','Redakce RegulaQuest')}${field('Obsah komentáře','body','','textarea')}`;dialog('Nový komentář · '+u.label,html,vals=>safeAct({action:'new_comment',unit_id:u.id,...vals}))}
function dialogDoc(){const html=`<p>Nový dokument bude mít vlastní verzi, jazyk a původ. Po vytvoření do něj můžete přidávat kapitoly a konkrétní pasáže.</p>${field('Název','title')}${field('Zkratka / rodina','family')}${select('Typ','kind',[['Právní předpis','Právní předpis'],['Metodický dokument','Metodický dokument'],['Doplňující dokument','Doplňující dokument']])}${select('Jazyk','language',[['cs','Čeština'],['en','English']])}${field('Revize / časová verze','version')}<label class="form-field"><span>Oficiální URL (nepovinné)</span><input class="input" name="url" type="url" placeholder="https://…"></label>`;dialog('Nový zdrojový dokument',html,vals=>safeAct({action:'new_document',...vals}))}
function dialogUnit(){const doc=getDoc(selected) || getDoc(getUnit(selected)?.document_id) || db.documents[0];const all=db.units.filter(u=>u.document_id===doc.id);const html=`<p>Vytvoříte rejstříkovou část. Text vložíte dodatečně, aby nešlo o neověřené přepisy.</p>${select('Dokument','document_id',db.documents.map(d=>[d.id,`${d.family} · ${d.language.toUpperCase()}`]),doc.id)}${select('Nadřazená část','parent_id',[['','Bez nadřazené části'],...all.map(u=>[u.id,u.label+' · '+u.heading])])}${select('Typ části','kind',[['article','Článek'],['annex','Příloha'],['paragraph','Odstavec'],['rule','Pravidlo'],['section','Kapitola / pasáž']])}${field('Označení','label')}${field('Nadpis / stručný popis','heading')}${field('Lokátor v originále','locator','Např. Annex VIII, Rule 11')}`;dialog('Nové ustanovení / pasáž',html,vals=>safeAct({action:'new_unit',...vals}))}
function dialogImport(){const example=`{\n  "units": [\n    {\n      "unit_id": "mdr-cs-rule-11",\n      "body": "SEM PATŘÍ DOSLOVNÝ TEXT Z OFICIÁLNÍHO ZDROJE",\n      "source_note": "EUR-Lex, CS, znění 19. 7. 2026"\n    }\n  ]\n}`;
const html=`<p>Importujeme výhradně <strong>strukturovaná data s přesnými identifikátory ustanovení</strong>. Kontrolujeme existenci ID. Texty se uloží se stavem „Nutno ověřit“.</p><label class="form-field"><span>Vyberte JSON soubor z počítače</span><input id="batchFile" type="file" accept=".json,application/json" class="input"></label><div class="mode-tile"><strong>Ukázka struktury</strong><pre style="font-size:10px;white-space:pre-wrap">${esc(example)}</pre></div>`;
const d=$('#modal');const form=$('#modalContent');form.innerHTML=`<h2>Hromadný import textů</h2>${html}<div class="modal-actions"><button type="button" class="btn" id="cancelDialog">Zrušit</button><button type="button" class="btn accent" id="submitImport">Importovat</button></div>`;form.querySelector('#cancelDialog').onclick=()=>d.close();form.querySelector('#submitImport').onclick=async()=>{try{const file=form.querySelector('#batchFile').files[0];if(!file)throw Error('Vyberte soubor JSON');const obj=JSON.parse(await file.text());await act({action:'import_units',units:obj.units});d.close()}catch(e){toast(e.message,true)}};d.showModal();}
function fileToBase64(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(new Error('Nelze přečíst soubor'));fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.readAsDataURL(file)})}
async function sendOfficial(payload){const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json','X-RQ-Token':token},body:JSON.stringify(payload)});const ans=await response.json();if(!response.ok)throw Error(ans.error||'Import se nezdařil');return ans}
function dialogOfficialImport(){
 const d=$('#modal'),f=$('#modalContent');let prepared=null;
 f.innerHTML=`<h2>Import dokumentu</h2>
 <p>Import probíhá <strong>jen na tomto počítači</strong>. Automaticky jsou zatím podporovány <strong>MDR (HTML EUR-Lex)</strong> a <strong>MDCG 2021-24 (PDF)</strong>. Další zdroje lze nyní založit ručně a jejich text vložit jednotlivě nebo pomocí strukturovaného JSON. Texty dostanou stav „Nutno ověřit“.</p>
 <label class="form-field"><span>Dokument a jazyk</span><select class="select" id="officialDoc">
 <option value="mdr-cs">MDR – čeština (HTML EUR-Lex, 19. 7. 2026)</option>
 <option value="mdr-en">MDR – English (HTML EUR-Lex, 19 July 2026)</option>
 <option value="mdcg-2021-24-en">MDCG 2021-24 rev.1 – English (PDF)</option></select></label>
 <div id="officialDownloadLinks" class="notice"></div><div class="form-hint">Pro jiné dokumenty použijte „+ Nový dokument“ a následně import JSON nebo ruční vložení. Automatické převodníky dalších typů budeme rozšiřovat.</div>
 <label class="form-field"><span>Stažený soubor z oficiálního webu</span><input class="input" id="officialFile" type="file" accept=".html,.htm,.pdf"></label>
 <label class="import-replace"><input type="checkbox" id="replaceImported"> Při opakovaném importu nahradit dosavadní <strong>neověřené automaticky importované texty</strong>. Ověřené texty a ručně vložené texty budou zachovány. <strong>Před použitím zazálohujte databázi!</strong></label>
 <div id="importReport" class="import-report" role="status">Nejdříve vyberte soubor a stiskněte „Zkontrolovat import“.</div>
 <div class="modal-actions"><button class="btn" type="button" id="cancelOfficial">Zavřít</button>
 <button class="btn" type="button" id="previewOfficial">Zkontrolovat import</button>
 <button class="btn accent" type="button" id="commitOfficial" disabled>Importovat do Studia</button></div>`;
 const linkMap={
 'mdr-cs':['https://eur-lex.europa.eu/legal-content/CS/TXT/HTML/?uri=CELEX:02017R0745-20260719','Otevřít MDR CZ na EUR-Lex (uložte jako HTML)'],
 'mdr-en':['https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02017R0745-20260719','Open MDR EN at EUR-Lex (save as HTML)'],
 'mdcg-2021-24-en':['https://health.ec.europa.eu/system/files/2021-10/mdcg_2021-24_en_0.pdf','Stáhnout originální MDCG PDF']};
 const doc=f.querySelector('#officialDoc'),file=f.querySelector('#officialFile'),replace=f.querySelector('#replaceImported'),previewBtn=f.querySelector('#previewOfficial'),commit=f.querySelector('#commitOfficial'),report=f.querySelector('#importReport');
 function setLink(){const [url,label]=linkMap[doc.value];f.querySelector('#officialDownloadLinks').innerHTML=`<strong>Oficiální zdroj:</strong> <a target="_blank" rel="noopener noreferrer" href="${url}">${label} ↗</a><br>U MDR zvolte v prohlížeči Uložit stránku jako… → HTML, nikoliv PDF.`;file.accept=doc.value.startsWith('mdr-')?'.html,.htm':'.pdf'}
 function clearPreview(){prepared=null;commit.disabled=true;report.textContent='Připraveno ke kontrole.'}
 doc.onchange=()=>{clearPreview();setLink()};file.onchange=clearPreview;replace.onchange=clearPreview;setLink();
 f.querySelector('#cancelOfficial').onclick=()=>d.close();
 previewBtn.onclick=async()=>{try{if(!file.files[0])throw Error('Vyberte soubor HTML nebo PDF.');previewBtn.disabled=true;report.textContent='Načítání a analýza souboru…';const b64=await fileToBase64(file.files[0]);const payload={document_id:doc.value,filename:file.files[0].name,base64:b64,replace_imported:replace.checked,preview:true};const res=await sendOfficial(payload);
 prepared=res.can_import?payload:null;commit.disabled=!res.can_import;
 const inf=res.info;report.innerHTML=`<div class="import-results"><strong>Rozpoznaný dokument: ${esc(inf.format)}</strong><p>${Object.entries(inf).filter(([k])=>['articles','annexes','rules','rules_located','sections','pages','blocks'].includes(k)).map(([k,v])=>`${esc(k)}: <b>${esc(v)}</b>`).join(' · ')}</p>${inf.format==='mdcg-pdf'?`<p><strong>Obsah:</strong> kapitoly 1–4 podle obsahu dokumentu · 22 položek pravidel · <b>${esc(inf.rules_located)} z 22</b> nadpisů pravidel automaticky lokalizováno. Ostatní je nutné ručně určit v PDF.</p>`:''}<p>Nových částí: <b>${res.new}</b> · Doplní prázdné: <b>${res.fill_empty}</b> · Nahradí starší automatický import: <b>${res.will_replace}</b> · Zachová existující texty: <b>${res.keep_existing}</b></p>${res.warnings.map(w=>`<p class="warnline">⚠ ${esc(w)}</p>`).join('')}${!res.can_import?'<p class="warnline"><strong>Import je zablokován: rozpoznaná struktura není úplná.</strong></p>':''}${inf.content_integrity_ok!==undefined?`<p class="${inf.content_integrity_ok?'goodline':'warnline'}"><strong>Kontrola převodu textu: ${inf.content_integrity_ok?'PROŠLA':'CHYBA – ztráta nebo změna textu'}</strong> · Kontrolováno ${esc(inf.audit_units)} částí · zachováno ${esc(Math.round((inf.min_text_coverage||0)*10000)/100)} % znaků (mimo mezery a změnové značky). ${inf.inserted_articles?.length?`Vložené články: ${inf.inserted_articles.map(esc).join(', ')}.`:''}</p>`:''}${inf.failed_units?.length?`<details><summary>Chyby úplnosti (${inf.failed_units.length} položek)</summary><ul>${inf.failed_units.map(x=>`<li>${esc(x.id)} – ${esc(x.coverage)}</li>`).join('')}</ul></details>`:''}${inf.rule_candidates?.length?`<details><summary>Diagnostika nadpisů pravidel (${inf.rule_candidates.length})</summary><ul>${inf.rule_candidates.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}<small>Otisk SHA-256: ${esc(inf.sha256)}</small></div>`;
 }catch(e){commit.disabled=true;prepared=null;report.textContent='Chyba: '+e.message;toast(e.message,true)}finally{previewBtn.disabled=false}};
 commit.onclick=async()=>{if(!prepared)return;try{commit.disabled=true;report.textContent='Import a uložení do lokální databáze…';const res=await sendOfficial({...prepared,preview:false});d.close();await refresh();toast(`Import hotov: ${res.added} nových, ${res.updated} doplněných, ${res.replaced||0} znovu načtených, ${res.protected} zachovaných.`)}catch(e){report.textContent='Chyba: '+e.message;toast(e.message,true);commit.disabled=false}};
 d.showModal();
}

function init(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(b.dataset.page==='review')reviewDocFilter='all';if(b.dataset.page==='relations')relationDocFilter='all';if(b.dataset.page==='comments')commentDocFilter='all';if(b.dataset.page==='batch'&&getUnit(selected)){batchScope='unit';batchDocId=getUnit(selected).document_id;batchUnitId=selected;}if(b.dataset.page==='related'){relatedScope='document';relatedSourceDocId=getUnit(selected)?.document_id||activeDocId;relatedSourceUnitId=getUnit(selected)?.id||'';relatedData=null;relatedPage=0;relatedFilter='all';relatedResultQuery='';}setPage(b.dataset.page)});$('#filter').addEventListener('input',e=>{query=e.target.value;renderList()});$('#newDoc').onclick=dialogDoc;$('#newUnit').onclick=dialogUnit;$('#batchImport').onclick=dialogImport;$('#importOfficial').onclick=dialogOfficialImport;$('#statDocsCard').onclick=()=>{selected=activeDocId;renderReader();renderContext()};
 $('#relatedScope').onchange=e=>{relatedScope=e.target.value;invalidateRelatedResults();renderRelatedSetup()};
 $('#relatedSourceDoc').onchange=e=>{relatedSourceDocId=e.target.value;relatedSourceUnitId='';relatedSourceQuery='';$('#relatedSourceSearch').value='';invalidateRelatedResults();renderRelatedSetup()};
 $('#relatedSourceSearch').oninput=e=>{relatedSourceQuery=e.target.value;invalidateRelatedResults();renderRelatedSetup();};
 $('#relatedSourceUnit').onchange=e=>{relatedSourceUnitId=e.target.value;invalidateRelatedResults();};
 $('#relatedTargetDoc').onchange=e=>{relatedTargetDocId=e.target.value;invalidateRelatedResults();};
 $('#relatedAnalyze').onclick=runRelatedSearch;
 $('#relatedGoReview').onclick=()=>{reviewDocFilter='all';setPage('review')};
 $('#batchScope').onchange=e=>{batchScope=e.target.value;batchData=null;batchChosen.clear();batchOffset=0;renderBatchSetup();$('#batchOutput').innerHTML='<div class="empty-state">Změnili jste rozsah. Spusťte novou analýzu.</div>'};
 $('#batchDocument').onchange=e=>{batchDocId=e.target.value;batchUnitId='';batchData=null;batchChosen.clear();batchOffset=0;renderBatchSetup();$('#batchOutput').innerHTML='<div class="empty-state">Vyberte ustanovení nebo spusťte analýzu.</div>'};
 $('#batchUnit').onchange=e=>{batchUnitId=e.target.value;batchData=null;batchChosen.clear();batchOffset=0;$('#batchOutput').innerHTML='<div class="empty-state">Spusťte analýzu vybraného ustanovení.</div>'};
 $('#batchAnalyze').onclick=()=>{batchChosen.clear();batchData=null;batchOffset=0;batchFilter='all';batchSearch='';runBatchScan()};
 $('#batchOpenReview').onclick=()=>{reviewDocFilter='all';setPage('review')};
 $('#statVerifiedCard').onclick=()=>{verifiedDocFilter=activeDocId;setPage('verified')};
 $('#statProposedCard').onclick=()=>{reviewDocFilter=activeDocId;setPage('review')};
 $('#statApprovedCard').onclick=()=>{relationStatusFilter='approved';relationDocFilter=activeDocId;setPage('relations')};
 $('#goCatalog').onclick=()=>setPage('documents');$('#homeImport').onclick=dialogOfficialImport;
 $('#workOpenCatalog').onclick=()=>setPage('documents');
 $('#activeDocumentSelect').onchange=e=>selectDocument(e.target.value);
$('#documentListSearch').oninput=e=>{docOverviewSearch=e.target.value;renderDocumentsOverview()};
 $('#catalogJurisdiction').onchange=e=>{catalogJurisdiction=e.target.value;renderDocumentsOverview()};
 $('#catalogType').onchange=e=>{catalogType=e.target.value;renderDocumentsOverview()};
 $('#reviewDocFilter').onchange=e=>{reviewDocFilter=e.target.value;renderReview()};
 $('#relationDocFilter').onchange=e=>{relationDocFilter=e.target.value;renderRelations()};
$('#verifiedListSearch').oninput=e=>{verifiedOverviewSearch=e.target.value;renderVerifiedOverview()};
$('#verifiedDocFilter').onchange=e=>{verifiedDocFilter=e.target.value;renderVerifiedOverview()};
$('#relationStateFilter').onchange=e=>{relationStatusFilter=e.target.value;renderRelations()};
$('#relationListSearch').oninput=e=>{relationSearch=e.target.value;renderRelations()};
$('#commentDocFilter').onchange=e=>{commentDocFilter=e.target.value;renderComments()};
$('#commentStateFilter').onchange=e=>{commentStatusFilter=e.target.value;renderComments()};
$('#commentListSearch').oninput=e=>{commentSearch=e.target.value;renderComments()};
$('#backupTop').onclick=$('#backupBottom').onclick=()=>window.location.assign('/api/backup');$('#exportPublished').onclick=()=>window.location.assign('/api/education-export');
$('#publishToReader').onclick=()=>act({action:'publish_to_reader'}).then(res=>{const c=res.reader.counts;$('#publishToReaderInfo').textContent=`Uloženo do ${res.reader.path}: ${c.verified_units} ověřených částí, ${c.comments} komentářů, ${c.relations} vazeb. Nyní změny odešlete na GitHub.`}).catch(e=>toast(e.message,true));
fetch('/api/config').then(r=>r.json()).then(c=>{token=c.token;$('#versionLabel').textContent='v'+c.version;return refresh()}).catch(e=>{$('.content').innerHTML=`<div class="api-error">Aplikace se nepřipojila k místní databázi. Spusťte ji přes soubor <strong>spustit-mac.command</strong>, ne otevřením HTML přímo. ${esc(e.message)}</div>`});}
init();
