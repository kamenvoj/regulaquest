'use strict';
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db={documents:[],units:[],comments:[],relations:[],relation_revisions:[],relation_history:[],comment_revisions:[],comment_history:[],amendments:[],unit_amendments:[],counts:{}};
let page='home', selected=null, activeDocId='', query='', relationStatusFilter='approved', relationSearch='', docOverviewSearch='', verifiedOverviewSearch='', verifiedDocFilter='all',catalogJurisdiction='all',catalogType='all',reviewDocFilter='all',relationDocFilter='all',commentDocFilter='all',commentStatusFilter='all',commentSearch='';
// Bulk scan results are transient and never published without editor approval.

// Stav rozbalene navigace se pri prekresleni zachova, nezapisuje se do databaze.
const openedUnits=new Set();
const openedDocuments=new Set();
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
// Supabase: stav z rq_studio_state(), zápisy výhradně přes funkce rq_*.
let RQ=null,lastLoad=0;
const asText=v=>v==null?'':typeof v==='string'?v:JSON.stringify(v);
async function rpc(name,args){const {data,error}=await RQ.client.rpc(name,args);if(error)throw new Error(error.message);return data}
async function refresh(){
 const state=await rpc('rq_studio_state');
 for(const key of ['relation_history','comment_history'])for(const h of state[key]||[]){h.before_json=asText(h.before_json);h.after_json=asText(h.after_json)}
 db=state;lastLoad=Date.now();render();
}
const field_=(d,keys)=>Object.fromEntries(keys.filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
const ACTIONS={
 new_document:d=>['rq_new_document',{p:field_(d,['title','family','kind','language','version','url','valid_date','publisher','jurisdiction','document_type'])}],
 update_document_metadata:d=>['rq_update_document',{p_id:d.document_id,p:field_(d,['jurisdiction','document_type','topics'])}],
 new_unit:d=>['rq_new_unit',{p:field_(d,['document_id','parent_id','kind','label','heading','locator'])}],
 verify_unit:d=>['rq_verify_unit',{p_unit_id:d.unit_id,p_expected:getUnit(d.unit_id)?.updated_at||null}],
 save_unit_content:d=>['rq_save_unit_content',{p_unit_id:d.unit_id,p_blocks:d.blocks,p_expected:d.expected_updated_at,p_reason:d.reason||undefined}],
 edit_unit_structure:d=>['rq_edit_unit_structure',{p_unit_id:d.unit_id,p:field_(d,['label','heading','kind','parent_id','locator','sort_order']),p_expected:d.expected_updated_at,p_reason:d.reason||undefined}],
 split_unit:d=>['rq_split_unit',{p_unit_id:d.unit_id,p_index:d.index,p_new_label:d.new_label,p_new_heading:d.new_heading,p_new_locator:d.new_locator,p_expected:d.expected_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 move_unit_text:d=>['rq_move_unit_text',{p_unit_id:d.unit_id,p_target_id:d.target_id,p_fragment:d.fragment,p_expected:d.expected_updated_at,p_target_expected:d.target_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 merge_units:d=>['rq_merge_units',{p_unit_id:d.unit_id,p_target_id:d.target_id,p_expected:d.expected_updated_at,p_target_expected:d.target_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 new_comment:d=>['rq_new_comment',{p_unit_id:d.unit_id,p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author||''}],
 comment_status:d=>['rq_comment_status',{p_id:d.id,p_status:d.status}],
 edit_comment_draft:d=>['rq_edit_comment_draft',{p_id:d.comment_id,p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author||''}],
 archive_comment_draft:d=>['rq_archive_comment_draft',{p_id:d.comment_id}],
 restore_comment_draft:d=>['rq_restore_comment_draft',{p_id:d.comment_id}],
 propose_comment_revision:d=>['rq_propose_comment_revision',{p_id:d.comment_id,p_change_type:d.change_type,p_reason:d.change_reason,...(d.change_type==='edit'?{p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author}:{})}],
 decide_comment_revision:d=>['rq_decide_comment_revision',{p_revision_id:d.revision_id,p_decision:d.decision}],
 new_relation:d=>['rq_new_relation',{p_source_id:d.source_id,p_target_id:d.target_id,p_relation_type:d.relation_type,p_rationale:d.rationale,p_evidence:d.evidence||'',p_provenance:d.provenance||'manual'}],
 relation_status:d=>['rq_relation_status',{p_id:d.id,p_status:d.status}],
 propose_relation_revision:d=>['rq_propose_relation_revision',{p_relation_id:d.relation_id,p_change_type:d.change_type,p_reason:d.change_reason,...(d.change_type==='edit'?{p_target_id:d.target_id,p_relation_type:d.relation_type,p_rationale:d.rationale,p_evidence:d.evidence}:{})}],
 decide_relation_revision:d=>['rq_decide_relation_revision',{p_revision_id:d.revision_id,p_decision:d.decision}],
};
async function act(data){
 const map=ACTIONS[data.action];if(!map)throw new Error('Neznámá akce: '+data.action);
 const [name,args]=map(data);
 let result;
 try{result=await rpc(name,args)}
 catch(e){
  // Konflikt verzí: data mezitím změnil jiný admin, načteme aktuální stav.
  if(/změnil|změněn|aktuální/i.test(e.message))refresh().catch(()=>{});
  throw e;
 }
 await refresh();toast('Uloženo.');
 return {editor:result,result};
}
function safeAct(obj,cb){act(obj).then(()=>cb&&cb()).catch(e=>toast(e.message,true))}
function setPage(p){page=p;if(p==='access')RQ.renderAccess();document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.page===(p==='verified'?'library':p)));document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!=='page-'+p));render()}
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
 if(!document.getElementById('navReview'))return;
 $('#navReview').textContent=(c.proposed||0)+(c.proposed_revisions||0)+(c.comment_revisions_pending||0)+db.comments.filter(x=>x.status==='draft').length;
 if(page==='home')renderHome();
 if(page==='library'){renderDocumentMetrics();renderList();renderReader();renderContext()}
 if(page==='documents')renderDocumentsOverview();if(page==='verified')renderVerifiedOverview();if(page==='review')renderReview();if(page==='relations')renderRelations();if(page==='comments')renderComments();if(page==='publish')renderPublish();
}
// Přehledy jsou odvozené pouze z aktuálního stavu rq_studio_state, bez další databáze.
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
function renderReader(){const box=$('#reader');if(box.dataset.currentSelection!==String(selected||'')){box.scrollTop=0;box.dataset.currentSelection=String(selected||'')}if(!selected){box.innerHTML=`<div class="eyebrow">VÍTEJTE V REGULAQUEST STUDIU</div><h2>Odborná redakce legislativy</h2><p class="section-sub">Začněte výběrem dokumentu nebo konkrétního ustanovení v levém panelu.</p><div class="unloaded"><strong>Jak začít?</strong>${db.documents.length?'Vyberte ustanovení vlevo.':'V knihovně zatím není žádný dokument. Založte ho tlačítkem „+ Nový dokument“.'} Vložené texty jsou neověřené, dokud je nezkontrolujete proti zdroji.</div><div class="doc-outline"><div class="outline-row"><strong>01 · Výběr ustanovení</strong><small>Například MDR, příloha VIII, pravidlo 11.</small></div><div class="outline-row"><strong>02 · Vložení originálního textu</strong><small>Editor textu a tabulek u konkrétní části.</small></div><div class="outline-row"><strong>03 · Ověření a propojení</strong><small>Vytvořit schvalovanou vazbu s příslušnou částí MDCG.</small></div></div>`;return}
const u=getUnit(selected);
if(!u){const d=getDoc(selected);if(!d){selected=null;return renderReader()}const related=db.units.filter(x=>x.document_id===d.id);
 box.innerHTML=`<div class="crumb">ZDROJ / ${esc(d.family)}</div><h2>${esc(d.title)}</h2><p class="section-sub">${esc(d.kind)} · ${esc(d.language.toUpperCase())} · ${esc(d.version)}</p><div class="sourcebox"><strong>Vydavatel:</strong> ${esc(d.publisher)}<br><strong>Verze:</strong> ${esc(d.version)}<br><strong>Oficiální zdroj:</strong> <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Otevřít dokument ↗</a></div><button class="btn" id="editDocMetadataReader">Upravit metadata a tagy</button><div class="section-kicker">HLAVNÍ ČÁSTI DOKUMENTU (${related.length} POLOŽEK CELKEM)</div><div class="doc-outline">${related.filter(x=>!x.parent_id).map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(x.locator||'')} · ${esc(statusName[x.text_status])}</small></button>`).join('')}</div>`;
 box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>openUnit(el.dataset.unitOpen));const edit=box.querySelector('#editDocMetadataReader');if(edit)edit.onclick=()=>dialogDocumentMetadata(d.id);return}
const d=getDoc(u.document_id);const related=db.units.filter(x=>x.parent_id===u.id&&!x.editor_archived);
box.innerHTML=`<div class="hero-line"><span class="crumb">${esc(d.family)} / ${esc(d.language.toUpperCase())} / ${esc(u.locator||u.label)}</span>${tag(u.text_status)}</div>
<h2>${esc(u.label)}</h2><p class="section-sub">${esc(u.heading||d.title)}</p>
<div class="sourcebox"><strong>Zdroj:</strong> ${esc(d.title)}<br><strong>Verze:</strong> ${esc(d.version)} · ${esc(d.language.toUpperCase())}<br><strong>Umístění:</strong> ${esc(u.locator||u.label)}<br><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Porovnat s originálem ↗</a></div>
${u.content_blocks&&u.content_blocks.length?`<div class="rq-prepared-content"><div class="section-kicker">REDAKČNĚ STRUKTUROVANÝ OBSAH A TABULKY · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>${rqRenderBlocks(u.content_blocks)}</div>`:''}
${u.content_blocks&&u.content_blocks.length?'':`<div class="section-kicker">ZNĚNÍ ZDROJE · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>
  ${u.body?`<div class="legal">${esc(u.body)}</div>`:`<div class="unloaded"><strong>Text zatím není vložen.</strong>Otevřete „Editor textu a tabulek“ a vložte doslovné znění z oficiálního zdroje.</div>`}`}

<div class="read-actions rq-structure-actions"><button class="btn accent" id="rqEditContent">▦ Editor textu a tabulek</button><button class="btn" id="rqEditStructure">Struktura</button><button class="btn" id="rqSplit" ${!u.body?'disabled':''}>Rozdělit</button><button class="btn" id="rqMove" ${!u.body?'disabled':''}>Přesunout text</button><button class="btn" id="rqMerge" ${!u.body?'disabled':''}>Sloučit</button><button class="btn" id="rqHistory">Historie změn</button>${u.body&&u.text_status!=='verified'?'<button class="btn accent" id="verifyText">Ověřil(a) jsem proti zdroji</button>':''}</div>
${u.source_note?`<p class="fine">Původ importu: ${esc(u.source_note)}</p>`:''}
${related.length?`<div class="soft-rule"></div><div class="section-kicker">PODŘAZENÉ ČÁSTI</div><div class="doc-outline">${related.map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(statusName[x.text_status])}</small></button>`).join('')}</div>`:''}`;
box.querySelector('#rqEditContent').onclick=()=>rqContentEditor(u);
box.querySelector('#rqEditStructure').onclick=()=>rqStructureEditor(u);
box.querySelector('#rqSplit').onclick=()=>rqSplit(u);
box.querySelector('#rqMove').onclick=()=>rqMoveText(u,false);
box.querySelector('#rqMerge').onclick=()=>rqMoveText(u,true);
box.querySelector('#rqHistory').onclick=()=>rqHistory(u);
const v=box.querySelector('#verifyText');if(v)v.onclick=()=>{if(confirm('Potvrzujete, že text včetně tabulek byl porovnán s oficiálním dokumentem ve správné jazykové a časové verzi?'))safeAct({action:'verify_unit',unit_id:u.id})};
box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>{selected=el.dataset.unitOpen;render()});
}
function renderContext(){const box=$('#context');const u=getUnit(selected);if(!u){box.innerHTML='<div class="smallcaps">VÝKLAD A VAZBY</div><div class="empty-state">Vyberte ustanovení pro úpravu komentářů a propojení.</div>';return}
const rel=db.relations.filter(r=>r.source_id===u.id||r.target_id===u.id);const comments=db.comments.filter(c=>c.unit_id===u.id);
const marks=(db.unit_amendments||[]).filter(x=>x.unit_id===u.id);
const amendments=marks.map(x=>{const a=(db.amendments||[]).find(z=>z.document_id===u.document_id&&z.marker===x.marker);return {...a,marker:x.marker}});
const origin=getDoc(u.document_id);
box.innerHTML=`<div class="context-section"><div class="context-head"><h3>↗ Propojené pasáže <span class="tag">${rel.length}</span></h3><div class="actionrow"><button class="btn tiny" id="addLink">+ Propojit</button></div></div>
${rel.length?rel.map(r=>{const other=r.source_id===u.id?r.target_id:r.source_id;return `<div class="boxnote"><div class="meta"><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(other))}</p><div class="helper">${esc(r.rationale)}</div><div class="actionrow"><button class="btn tiny" data-jump="${esc(other)}">Přejít na pasáž ↗</button><button class="btn tiny" data-relation-detail="${esc(r.id)}">Detail vazby</button></div></div>`}).join(''):'<p class="fine">Zatím bez propojení. Vazby je možné vytvářet na úrovni kapitol, pravidel i jednotlivých pasáží.</p>'}</div>
<div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>▤ Naše komentáře <span class="tag">${comments.length}</span></h3><button class="btn tiny" id="addNote">+ Přidat</button></div>${comments.length?comments.map(c=>`<div class="boxnote"><div class="meta"><strong>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</strong>${tag(c.status)}</div><p>${esc(c.body)}</p><div class="helper">${esc(c.author||'RegulaQuest redakce')}</div><div class="actionrow"><button type="button" class="btn tiny" data-comment-detail="${esc(c.id)}">Detail / upravit</button></div></div>`).join(''):'<p class="fine">Zatím bez autorských komentářů.</p>'}</div><div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>◷ Změny a původ znění <span class="tag">${amendments.length}</span></h3></div>
${amendments.length?amendments.map(a=>`<div class="boxnote"><div class="meta"><strong>${esc(a.marker)} · ${a.kind==='corrigendum'?'Oprava':'Pozměňující akt'}</strong></div><p>${esc(a.title||'Označení změny v konsolidovaném dokumentu')}</p>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Přejít na původní akt ↗</a>`:`<a href="${esc(origin?.url||'#')}" target="_blank" rel="noopener noreferrer">Ověřit akt v přehledu „Ve znění“ na EUR-Lexu ↗</a>`}</div>`).join(''):'<p class="fine">U tohoto textu nejsou v importovaném konsolidovaném znění zachyceny změnové značky. Neznamená to, že text nikdy nebyl měněn.</p>'}
<p class="fine">Zobrazené znění je informativní konsolidace k datu uvedenému u zdroje. Změnové značky se do textu nevypisují.</p></div>
<div class="soft-rule"></div><div class="fine">Komentář je oddělený od oficiálního znění. Pro studentský export musí být schválený.</div>`;
box.querySelector('#addLink').onclick=()=>dialogRelation(u);box.querySelector('#addNote').onclick=()=>dialogComment(u);box.querySelectorAll('[data-jump]').forEach(x=>x.onclick=()=>openUnit(x.dataset.jump));box.querySelectorAll('[data-relation-detail]').forEach(x=>x.onclick=()=>dialogRelationDetail(x.dataset.relationDetail));box.querySelectorAll('[data-comment-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.commentDetail));
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
function renderPublish(){
 const verified=db.units.filter(x=>!x.editor_archived&&x.text_status==='verified'&&String(x.body||'').trim());const ids=new Set(verified.map(x=>x.id));
 const comments=db.comments.filter(c=>c.status==='approved'&&ids.has(c.unit_id));const links=db.relations.filter(r=>r.status==='approved'&&ids.has(r.source_id)&&ids.has(r.target_id));
 const rest=db.units.filter(x=>!x.editor_archived).length-verified.length;
 $('#publishInfo').innerHTML=`<strong>${verified.length} ověřených pasáží</strong>, ${comments.length} schválených komentářů a ${links.length} vazeb se dvěma ověřenými konci bude zahrnuto do publikace.<br><br><span class="fine">${rest} neověřených nebo rejstříkových pasáží se vynechá.</span>`;
 const p=db.publication;
 $('#publishCurrent').innerHTML=p?`Studenti nyní vidí verzi <strong>č. ${p.id}</strong> z ${esc(new Date(p.created_at).toLocaleString('cs-CZ'))}${p.note?' – '+esc(p.note):''}.`:'Zatím nebylo nic publikováno. Studenti vidí „Obsah se připravuje“.';
 loadPublications();
}
async function loadPublications(){
 const box=$('#publishHistory');
 const {data,error}=await RQ.client.from('publications').select('id,created_at,note,counts,is_current').order('id',{ascending:false}).limit(10);
 if(error){box.textContent=error.message;return}
 box.innerHTML=data.length?data.map(p=>`<div class="history-row"><strong>Verze č. ${p.id}${p.is_current?' · aktuální':''}</strong><small>${esc(new Date(p.created_at).toLocaleString('cs-CZ'))} · ${p.counts?.verified_units??0} pasáží, ${p.counts?.comments??0} komentářů, ${p.counts?.relations??0} vazeb</small>${p.note?`<div class="fine">${esc(p.note)}</div>`:''}${p.is_current?'':`<button class="btn tiny" type="button" data-pub="${p.id}">Vrátit studentům tuto verzi</button>`}</div>`).join(''):'<p class="fine">Zatím žádná publikace.</p>';
 box.querySelectorAll('[data-pub]').forEach(b=>b.onclick=async()=>{
  if(!confirm(`Studenti uvidí znovu verzi č. ${b.dataset.pub}. Pokračovat?`))return;
  try{await rpc('rq_set_current_publication',{p_id:Number(b.dataset.pub)});await refresh();toast('Verze vrácena.')}catch(e){toast(e.message,true)}});
}
async function publishNow(){
 const note=$('#publishNote').value.trim();
 if(!confirm('Publikovat aktuální ověřený obsah pro studenty? Předchozí verze zůstane v historii.'))return;
 const btn=$('#publishBtn');btn.disabled=true;
 try{await rpc('rq_publish',{p_note:note});$('#publishNote').value='';await refresh();toast('Publikováno. Studenti uvidí novou verzi po obnovení čtečky.')}
 catch(e){toast(e.message,true)}finally{btn.disabled=false}
}
async function downloadBackup(){
 try{const data=await rpc('rq_backup');const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
  a.download='regulaquest-zaloha-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}
 catch(e){toast(e.message,true)}
}
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
function dialogUnit(){const doc=getDoc(selected) || getDoc(getUnit(selected)?.document_id) || getDoc(activeDocId) || db.documents[0];if(!doc){toast('Nejdřív založte dokument.',true);return}const all=db.units.filter(u=>u.document_id===doc.id);const html=`<p>Vytvoříte rejstříkovou část. Text vložíte dodatečně, aby nešlo o neověřené přepisy.</p>${select('Dokument','document_id',db.documents.map(d=>[d.id,`${d.family} · ${d.language.toUpperCase()}`]),doc.id)}${select('Nadřazená část','parent_id',[['','Bez nadřazené části'],...all.map(u=>[u.id,u.label+' · '+u.heading])])}${select('Typ části','kind',[['article','Článek'],['annex','Příloha'],['paragraph','Odstavec'],['rule','Pravidlo'],['section','Kapitola / pasáž']])}${field('Označení','label')}${field('Nadpis / stručný popis','heading')}${field('Lokátor v originále','locator','Např. Annex VIII, Rule 11')}`;dialog('Nové ustanovení / pasáž',html,vals=>safeAct({action:'new_unit',...vals}))}
function init(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(b.dataset.page==='review')reviewDocFilter='all';if(b.dataset.page==='relations')relationDocFilter='all';if(b.dataset.page==='comments')commentDocFilter='all';setPage(b.dataset.page)});$('#filter').addEventListener('input',e=>{query=e.target.value;renderList()});$('#newDoc').onclick=$('#homeNewDoc').onclick=dialogDoc;$('#newUnit').onclick=dialogUnit;$('#statDocsCard').onclick=()=>{selected=activeDocId;renderReader();renderContext()};
 $('#statVerifiedCard').onclick=()=>{verifiedDocFilter=activeDocId;setPage('verified')};
 $('#statProposedCard').onclick=()=>{reviewDocFilter=activeDocId;setPage('review')};
 $('#statApprovedCard').onclick=()=>{relationStatusFilter='approved';relationDocFilter=activeDocId;setPage('relations')};
 $('#goCatalog').onclick=()=>setPage('documents');
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
 $('#backupBottom').onclick=downloadBackup;$('#publishBtn').onclick=publishNow;
 $('#refreshTop').onclick=()=>refresh().then(()=>toast('Načteno aktuální znění.')).catch(e=>toast(e.message,true));
 // Druhý admin mohl mezitím něco změnit: po návratu do okna obnovit, nejvýš jednou za 30 s.
 window.addEventListener('focus',()=>{if(Date.now()-lastLoad>30000&&!$('#modal').open)refresh().catch(()=>{})});
}
// Spouští js/studio.js po přihlášení.
async function startEditor(rq){
 RQ=rq;init();
 try{await refresh()}catch(e){$('.content').innerHTML=`<div class="api-error">Nepodařilo se načíst data: ${esc(e.message)}</div>`}
}
