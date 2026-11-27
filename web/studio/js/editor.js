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
const noteName={explanation:'Vysvětlení',warning:'Na co si dát pozor',example:'Praktický příklad',definition:'Definice pojmu',reference:'Komentář ke zdroji',key:'Klíčová pasáž',duty:'Povinnost',deadline:'Lhůta / číslo',exception:'Výjimka / podmínka'};
const rqLayer=k=>['key','duty','deadline','exception'].includes(k);
const rqIco=k=>(window.RQNotes&&RQNotes.ICON[k])||'';
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
const LIST_LINE=/^([—–•-]|[a-z]\)|\(?[ivx]+\)|\d+[.)]|\(\d+\))\s/;
function legalLines(body){return String(body).split('\n').map(l=>{const t=l.trim();if(!t)return '<span class="ln gap"></span>';
 const lead=(l.match(/^ */)[0].length)/2,list=LIST_LINE.test(t)&&(lead>0||/^\(?\d+\)/.test(t));
 return `<span class="ln${list?' hang':''}" style="--lvl:${lead}">${esc(t)}</span>`}).join('')}
function equivalentIn(u,docId){const d=getDoc(u.document_id);return d&&u.id.startsWith(d.id+'-')?getUnit(docId+u.id.slice(d.id.length))||null:null}
function mirroredRelations(u){
 const d=getDoc(u.document_id);if(!d)return [];const out=[];
 for(const od of db.documents){if(od.id===d.id||(od.group_key||od.id)!==(d.group_key||d.id))continue;
  const twin=equivalentIn(u,od.id);if(!twin)continue;
  for(const r of db.relations){if(r.status==='archived'||r.status==='rejected'||(r.source_id!==twin.id&&r.target_id!==twin.id))continue;
   const o=getUnit(r.source_id===twin.id?r.target_id:r.source_id);if(!o)continue;const od2=getDoc(o.document_id);
   let other=o.id;for(const x of db.documents)if((x.group_key||x.id)===(od2.group_key||od2.id)&&x.language===d.language){const c=equivalentIn(o,x.id);if(c){other=c.id;break}}
   out.push({r,from:twin,other});}}
 return out}
// Všechny vazby převedené do jazyka dokumentu docId (pro kontrolu duplicit a návrhy).
function relationsSeenFrom(docId){
 const doc=getDoc(docId),out=[...db.relations];if(!doc)return out;
 for(const r of db.relations){const s=getUnit(r.source_id),t=getUnit(r.target_id);if(!s||!t)continue;
  const sd=getDoc(s.document_id),td=getDoc(t.document_id);if(!sd||!td||sd.id===docId||(sd.group_key||sd.id)!==(doc.group_key||doc.id))continue;
  const s2=equivalentIn(s,docId);if(!s2)continue;let t2=t;
  for(const x of db.documents)if((x.group_key||x.id)===(td.group_key||td.id)&&x.language===doc.language){const c=equivalentIn(t,x.id);if(c){t2=c;break}}
  out.push({...r,source_id:s2.id,target_id:t2.id,mirrored:true})}
 return out}
const translationSource=c=>c&&c.translated_from?db.comments.find(x=>x.id===c.translated_from):null;
const translationStale=c=>{const s=translationSource(c);return !!s&&c.status!=='archived'&&s.body!==c.source_body};
function documentLabel(d){return d?`${d.family} · ${d.language.toUpperCase()} · ${d.version}`:'Neznámý dokument'}
const fullname=id=>{const u=getUnit(id);if(!u)return id;const d=getDoc(u.document_id);return `${documentLabel(d)} › ${unitPath(id)}${u.heading?' – '+u.heading:''}${u.editor_archived?' [archivováno]':''}`};
const tag=(s)=>`<span class="tag ${statuses[s]||''}">${esc(statusName[s]||s)}</span>`;
function toast(t,bad=false){const n=$('#toast');n.textContent=t;n.className='toast visible'+(bad?' error':'');setTimeout(()=>n.classList.remove('visible'),4200)}
// Supabase: stav z rq_studio_state(), zápisy výhradně přes funkce rq_*.
let RQ=null,lastLoad=0;
const asText=v=>v==null?'':typeof v==='string'?v:JSON.stringify(v);
async function rpc(name,args){const {data,error}=await RQ.client.rpc(name,args);if(error)throw new Error(error.message);return data}
async function refresh(){
 const state=await rpc('rq_studio_state');
 for(const key of ['relation_history','comment_history'])for(const h of state[key]||[]){h.before_json=asText(h.before_json);h.after_json=asText(h.after_json)}
 // archivované dokumenty (a jejich části) mimo běžné seznamy
 const arch=new Set((state.documents||[]).filter(d=>d.archived).map(d=>d.id));
 state.archivedDocuments=(state.documents||[]).filter(d=>arch.has(d.id));
 if(arch.size){const off=new Set(state.units.filter(u=>arch.has(u.document_id)).map(u=>u.id));
  state.documents=state.documents.filter(d=>!arch.has(d.id));state.units=state.units.filter(u=>!off.has(u.id));
  state.comments=state.comments.filter(c=>!off.has(c.unit_id));state.relations=state.relations.filter(r=>!off.has(r.source_id)&&!off.has(r.target_id));
  state.terms=(state.terms||[]).filter(t=>!off.has(t.unit_id));}
 if(activeDocId&&!state.documents.some(d=>d.id===activeDocId))activeDocId=state.documents[0]?.id||null;
 db=state;lastLoad=Date.now();render();
}
const field_=(d,keys)=>Object.fromEntries(keys.filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
const ACTIONS={
 new_document:d=>['rq_new_document',{p:field_(d,['title','family','kind','language','version','url','valid_date','publisher','jurisdiction','document_type','group_key','topics'])}],
 update_document_metadata:d=>['rq_update_document',{p_id:d.document_id,p:field_(d,['title','family','version','publisher','url','jurisdiction','document_type','topics','short_title','featured','featured_sort'])}],
 new_unit:d=>['rq_new_unit',{p:field_(d,['document_id','parent_id','kind','label','heading','locator'])}],
 verify_unit:d=>['rq_verify_unit',{p_unit_id:d.unit_id,p_expected:getUnit(d.unit_id)?.updated_at||null}],
 save_unit_content:d=>['rq_save_unit_content',{p_unit_id:d.unit_id,p_blocks:d.blocks,p_expected:d.expected_updated_at,p_reason:d.reason||undefined}],
 edit_unit_structure:d=>['rq_edit_unit_structure',{p_unit_id:d.unit_id,p:field_(d,['label','heading','kind','parent_id','locator','sort_order']),p_expected:d.expected_updated_at,p_reason:d.reason||undefined}],
 split_unit:d=>['rq_split_unit',{p_unit_id:d.unit_id,p_index:d.index,p_new_label:d.new_label,p_new_heading:d.new_heading,p_new_locator:d.new_locator,p_expected:d.expected_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 move_unit_text:d=>['rq_move_unit_text',{p_unit_id:d.unit_id,p_target_id:d.target_id,p_fragment:d.fragment,p_expected:d.expected_updated_at,p_target_expected:d.target_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 merge_units:d=>['rq_merge_units',{p_unit_id:d.unit_id,p_target_id:d.target_id,p_expected:d.expected_updated_at,p_target_expected:d.target_updated_at,p_confirm_flatten:!!d.confirm_flatten_rich,p_reason:d.reason||undefined}],
 new_comment:d=>['rq_new_comment',{p_unit_id:d.unit_id,p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author||'',...(d.translated_from?{p_translated_from:d.translated_from}:{}),...(d.anchor_text?{p_anchor_text:d.anchor_text,p_anchor_occurrence:Number(d.anchor_occurrence)||1}:{})}],
 comment_status:d=>['rq_comment_status',{p_id:d.id,p_status:d.status}],
 edit_comment_draft:d=>['rq_edit_comment_draft',{p_id:d.comment_id,p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author||''}],
 archive_unit:d=>['rq_archive_unit',{p_unit_id:d.unit_id,p_expected:getUnit(d.unit_id)?.updated_at||null,p_reason:d.reason||undefined}],
 restore_unit:d=>['rq_restore_unit',{p_unit_id:d.unit_id}],
 translation_current:d=>['rq_mark_translation_current',{p_id:d.id}],
 archive_comment_draft:d=>['rq_archive_comment_draft',{p_id:d.comment_id}],
 restore_comment_draft:d=>['rq_restore_comment_draft',{p_id:d.comment_id}],
 propose_comment_revision:d=>['rq_propose_comment_revision',{p_id:d.comment_id,p_change_type:d.change_type,p_reason:d.change_reason,...(d.change_type==='edit'?{p_kind:d.kind,p_language:d.language,p_body:d.body,p_author:d.author}:{})}],
 decide_comment_revision:d=>['rq_decide_comment_revision',{p_revision_id:d.revision_id,p_decision:d.decision}],
 set_tags:d=>['rq_set_unit_tags',{p_unit_id:d.unit_id,p_tags:d.tags}],
 new_relation:d=>['rq_new_relation',{p_source_id:d.source_id,p_target_id:d.target_id,p_relation_type:d.relation_type,p_rationale:d.rationale,p_evidence:d.evidence||'',p_provenance:d.provenance||'manual',...(d.anchor_text?{p_anchor_text:d.anchor_text,p_anchor_occurrence:Number(d.anchor_occurrence)||1}:{})}],
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
function setPage(p){page=p;if(p==='access')RQ.renderAccess();if(p!=='paths'&&window.RQPaths)RQPaths.leave();if(p!=='guide'&&window.RQGuide)RQGuide.leave();if(p!=='cases'&&window.RQCases)RQCases.leave();if(p!=='links'&&window.RQLinks)RQLinks.leave();if(p!=='news'&&window.RQNews&&document.querySelector('#page-news:not(.hidden)'))RQNews.leave();document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.page===(p==='verified'?'library':p)));document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!=='page-'+p));render()}
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
 const c=db.counts||{},totalText=db.units.filter(u=>!u.editor_archived&&String(u.body||'').trim()).length;
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
 const ad=db.archivedDocuments||[];
 if(ad.length){$('#homeDocuments').insertAdjacentHTML('beforeend',`<details class="home-archived"><summary>Archivované dokumenty (${ad.length})</summary>${ad.map(d=>`<div class="home-doc-row arch"><div class="home-doc-ident"><strong>${esc(d.family)} · ${esc(d.language.toUpperCase())}</strong><span>${esc(d.title)}</span></div><button type="button" class="btn tiny" data-restore-doc="${esc(d.id)}">Obnovit</button></div>`).join('')}</details>`);
  $('#homeDocuments').querySelectorAll('[data-restore-doc]').forEach(b=>b.onclick=async()=>{try{await rpc('rq_archive_document',{p_id:b.dataset.restoreDoc,p_archived:false});await refresh();toast('Dokument obnoven.')}catch(e){toast(e.message,true)}});}
 $('#homeDocuments').querySelectorAll('[data-home-document]').forEach(b=>b.onclick=()=>selectDocument(b.dataset.homeDocument));
 if(window.RQDocs)RQDocs.renderHome();
 if(window.RQHome)RQHome.render();
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
 if(page==='paths'&&window.RQPaths)RQPaths.render();
 if(page==='coverage'&&window.RQCoverage)RQCoverage.render();
 if(page==='guide'&&window.RQGuide)RQGuide.render();
 if(page==='news'&&window.RQNews)RQNews.render();
 if(page==='cases'&&window.RQCases)RQCases.render();
 if(page==='links'&&window.RQLinks)RQLinks.render();
 if(page==='pres'&&window.RQPres)RQPres.render();
 if(window.RQNews&&!window.rqNewsInit){window.rqNewsInit=1;RQNews.load().catch(()=>{})}
 if(page==='library'){renderDocumentMetrics();renderList();renderReader();renderContext();rqLoadFigures($('#reader'))}
 if(page==='documents')renderDocumentsOverview();if(page==='verified')renderVerifiedOverview();if(page==='review')renderReview();if(page==='relations')renderRelations();if(page==='comments')renderComments();if(page==='publish')renderPublish();
}
// Přehledy jsou odvozené pouze z aktuálního stavu rq_studio_state, bez další databáze.
function openDocumentFromOverview(id){
 const d=getDoc(id);if(!d){toast('Dokument nebyl nalezen',true);return}
 selectDocument(id);
}
function renderDocumentsOverview(){
 if(window.RQDocs)return RQDocs.renderCatalog();
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
   const units=db.units.filter(u=>u.document_id===d.id&&!u.editor_archived);
   const verified=units.filter(u=>u.text_status==='verified'&&String(u.body||'').trim()).length;
   const withText=units.filter(u=>String(u.body||'').trim()).length;
   return `${heading}<div class="review-card overview-card"><div><h3>${esc(d.family)} · ${esc(d.language.toUpperCase())}</h3>
   <p>${esc(d.title)}</p><small>Verze: ${esc(d.version)} · ${esc(d.kind)}</small>
   <small>${esc(jurisdictions[d.jurisdiction]||'Nezařazeno')} · ${esc(docTypes[d.document_type]||'Ostatní')} · Ustanovení ${units.length} · S textem ${withText} · Ověřeno ${verified}/${withText}</small>
   <div class="topic-chips">${(d.topics||[]).map(t=>`<span class="topic-chip">${esc(t)}</span>`).join('')||'<small>Bez odborných tagů</small>'}</div></div>
   <div class="catalog-actions"><button class="btn" type="button" data-edit-metadata="${esc(d.id)}">Upravit údaje a tagy</button><button class="btn accent" type="button" data-overview-document="${esc(d.id)}">Otevřít dokument ↗</button></div></div>`;
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
 const verified=db.units.filter(u=>!u.editor_archived&&u.text_status==='verified'&&String(u.body||'').trim()&&
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
       b.innerHTML=`<span>${esc(u.label)}${u.kind==='section'&&u.heading?' · '+esc(u.heading.length>70?u.heading.slice(0,68)+'…':u.heading):''}</span>${rqTreeMarks(u)}`;
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
if(!u){const d=getDoc(selected);if(!d){selected=null;return renderReader()}const related=db.units.filter(x=>x.document_id===d.id&&!x.editor_archived),archived=db.units.filter(x=>x.document_id===d.id&&x.editor_archived&&!x.merged_into);
 box.innerHTML=`<div class="crumb">ZDROJ / ${esc(d.family)}</div><h2>${esc(d.title)}</h2><p class="section-sub">${esc(d.kind)} · ${esc(d.language.toUpperCase())} · ${esc(d.version)}</p><div class="sourcebox"><strong>Vydavatel:</strong> ${esc(d.publisher)}<br><strong>Verze:</strong> ${esc(d.version)}<br><strong>Oficiální zdroj:</strong> <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Otevřít dokument ↗</a></div><button class="btn" id="editDocMetadataReader">Upravit údaje a tagy</button><div class="section-kicker">HLAVNÍ ČÁSTI DOKUMENTU (${related.length} POLOŽEK CELKEM)</div><div class="doc-outline">${related.filter(x=>!x.parent_id).map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(x.locator||'')} · ${esc(statusName[x.text_status])}</small></button>`).join('')}</div>${archived.length?`<div class="section-kicker">ARCHIVOVANÉ ČÁSTI (${archived.length})</div><div class="doc-outline">${archived.slice(0,200).map(x=>`<div class="outline-row"><strong>${esc(unitPath(x.id))}${x.heading?' · '+esc(x.heading):''}</strong><small>${esc(x.locator||'')}</small><button class="btn tiny" type="button" data-unit-restore="${esc(x.id)}">Obnovit</button></div>`).join('')}</div>`:''}`;
 box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>openUnit(el.dataset.unitOpen));box.querySelectorAll('[data-unit-restore]').forEach(el=>el.onclick=()=>{if(confirm('Obnovit tuto část? Vrátí se do osnovy ve stavu „Nutno ověřit“.'))safeAct({action:'restore_unit',unit_id:el.dataset.unitRestore})});const edit=box.querySelector('#editDocMetadataReader');if(edit)edit.onclick=()=>dialogDocumentMetadata(d.id);return}
const d=getDoc(u.document_id);const related=db.units.filter(x=>x.parent_id===u.id&&!x.editor_archived);
box.innerHTML=`<div class="hero-line"><span class="crumb">${esc(d.family)} / ${esc(d.language.toUpperCase())} / ${esc(u.locator||u.label)}</span>${u.editor_archived?'<span class="tag bad">Archivováno</span>':tag(u.text_status)}</div>
${u.editor_archived?`<div class="notice archived-note"><strong>Archivovaná část.</strong> Není v osnově ani ve čtečce${u.merged_into?' (sloučena do '+esc(unitPath(u.merged_into))+')':''}. Zůstává jen pro dohledání historie.${u.merged_into?'':' <button class="btn tiny" type="button" id="rqRestore">Obnovit</button>'}</div>`:''}
<h2>${esc(u.label)}</h2><p class="section-sub">${esc(u.heading||d.title)}</p>${u.editor_archived?'':rqTagsRow(u)}${!u.editor_archived&&window.RQNews?RQNews.unitRow(u):''}${!u.editor_archived&&window.RQCases?RQCases.unitRow(u):''}${!u.editor_archived&&window.RQPres?RQPres.unitRow(u):''}
<div class="sourcebox"><strong>Zdroj:</strong> ${esc(d.title)}<br><strong>Verze:</strong> ${esc(d.version)} · ${esc(d.language.toUpperCase())}<br><strong>Umístění:</strong> ${esc(u.locator||u.label)}<br><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Porovnat s originálem ↗</a></div>
${u.content_blocks&&u.content_blocks.length?`<div class="rq-prepared-content" data-anchor-root><div class="section-kicker">REDAKČNĚ STRUKTUROVANÝ OBSAH A TABULKY · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>${rqRenderBlocks(u.content_blocks)}</div>`:''}
${u.content_blocks&&u.content_blocks.length?'':`<div class="section-kicker">ZNĚNÍ ZDROJE · ${u.text_status==='verified'?'OVĚŘENO':'NUTNO OVĚŘIT'}</div>
  ${u.body?`<div class="legal" data-anchor-root>${legalLines(u.body)}</div>`:`<div class="unloaded"><strong>Text zatím není vložen.</strong>Otevřete „Editor textu a tabulek“ a vložte doslovné znění z oficiálního zdroje.</div>`}`}

<div class="read-actions rq-structure-actions"><button class="btn accent" id="rqEditContent">▦ Editor textu a tabulek</button><button class="btn" id="rqEditStructure">Struktura</button><button class="btn" id="rqSplit" ${!u.body?'disabled':''}>Rozdělit</button><button class="btn" id="rqMove" ${!u.body?'disabled':''}>Přesunout text</button><button class="btn" id="rqMerge" ${!u.body?'disabled':''}>Sloučit</button><button class="btn" id="rqHistory">Historie změn</button><button class="btn" id="rqToPath" title="Přidat toto ustanovení jako krok trasy">⇢ Do trasy</button>${window.RQTerms&&RQNotes.parseDefinitions(u.body).length>=5?`<button class="btn" id="rqTerms">Pojmy z definic (${RQNotes.parseDefinitions(u.body).length})</button>`:''}<button class="btn danger" id="rqArchive">Archivovat</button>${u.body&&u.text_status!=='verified'?'<button class="btn accent" id="verifyText">Ověřil(a) jsem proti zdroji</button>':''}</div>
${u.source_note?`<p class="fine">Původ importu: ${esc(u.source_note)}</p>`:''}
${related.length?`<div class="soft-rule"></div><div class="section-kicker">PODŘAZENÉ ČÁSTI</div><div class="doc-outline">${related.map(x=>`<button class="outline-row" data-unit-open="${esc(x.id)}" style="text-align:left;cursor:pointer"><strong>${esc(x.label)} · ${esc(x.heading)}</strong><small>${esc(statusName[x.text_status])}</small></button>`).join('')}</div>`:''}`;
rqAnchors(box,u);rqTagsBind(box,u);if(window.RQNews)RQNews.bindUnit(box,u);if(window.RQCases)RQCases.bindUnit(box,u);if(window.RQPres)RQPres.bindUnit(box,u);if(window.RQHome)RQHome.remember(u.id);
box.querySelector('#rqEditContent').onclick=()=>rqContentEditor(u);
box.querySelector('#rqEditStructure').onclick=()=>rqStructureEditor(u);
box.querySelector('#rqSplit').onclick=()=>rqSplit(u);
box.querySelector('#rqMove').onclick=()=>rqMoveText(u,false);
box.querySelector('#rqMerge').onclick=()=>rqMoveText(u,true);
box.querySelector('#rqHistory').onclick=()=>rqHistory(u);
box.querySelector('#rqToPath').onclick=()=>RQPaths.addStep(u,null);
const tb=box.querySelector('#rqTerms');if(tb)tb.onclick=()=>RQTerms.dialog(u);
const rs=box.querySelector('#rqRestore');if(rs)rs.onclick=()=>{if(confirm('Obnovit tuto část? Vrátí se do osnovy ve stavu „Nutno ověřit“.'))safeAct({action:'restore_unit',unit_id:u.id})};
if(u.editor_archived)box.querySelector('#rqArchive').style.display='none';
box.querySelector('#rqArchive').onclick=()=>{
 if(related.length){toast('Část má podřazené části. Nejprve archivujte je.',true);return}
 const reason=prompt(`Archivovat „${unitPath(u.id)}“?\n\nČást zmizí z osnovy i ze čtečky, v databázi zůstane i s historií a lze ji obnovit (Katalog → dokument → Archivované části). Její schválené vazby a komentáře se vrátí do kontroly.\n\nDůvod:`,'Nepotřebná nebo duplicitní část');
 if(reason===null)return;
 const parent=u.parent_id;safeAct({action:'archive_unit',unit_id:u.id,reason},()=>{selected=parent||u.document_id;render()});
};
const v=box.querySelector('#verifyText');if(v)v.onclick=()=>{if(confirm('Potvrzujete, že text včetně tabulek byl porovnán s oficiálním dokumentem ve správné jazykové a časové verzi?'))safeAct({action:'verify_unit',unit_id:u.id})};
box.querySelectorAll('[data-unit-open]').forEach(el=>el.onclick=()=>{selected=el.dataset.unitOpen;render()});
}
function renderContext(){const box=$('#context');const u=getUnit(selected);if(!u){box.innerHTML='<div class="smallcaps">VÝKLAD A VAZBY</div><div class="empty-state">Vyberte ustanovení pro úpravu komentářů a propojení.</div>';return}
const relAll=db.relations.filter(r=>r.source_id===u.id||r.target_id===u.id),mirror=mirroredRelations(u);const comAll=db.comments.filter(c=>c.unit_id===u.id);
const hidden=x=>['archived','rejected'].includes(x.status);const rel=relAll.filter(r=>!hidden(r)),comments=comAll.filter(c=>!hidden(c));
const hiddenNote=(n,page)=>n?`<button type="button" class="linklike fine" data-hidden-page="${page}">${n}× archivováno nebo zamítnuto – zobrazit ve správě</button>`:'';
const marks=(db.unit_amendments||[]).filter(x=>x.unit_id===u.id);
const amendments=marks.map(x=>{const a=(db.amendments||[]).find(z=>z.document_id===u.document_id&&z.marker===x.marker);return {...a,marker:x.marker}});
const origin=getDoc(u.document_id);
box.innerHTML=`<div class="context-section"><div class="context-head"><h3>↗ Propojené pasáže <span class="tag">${rel.length}</span></h3><div class="actionrow"><button class="btn tiny" id="seekRelated" title="Souvislosti v jiném dokumentu (např. MDCG)">◎ Souvislosti</button><button class="btn tiny" id="suggestLinks" title="Výslovné odkazy v textu této části">✧ Návrhy</button><button class="btn tiny" id="addLink">+ Propojit</button></div></div>
${rel.length?rel.map(r=>{const other=r.source_id===u.id?r.target_id:r.source_id;return `<div class="boxnote"><div class="meta"><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(other))}</p>${r.anchor_text&&r.source_id===u.id?`<button type="button" class="anchor-q" data-anchor-jump="L${esc(r.id)}" title="Ukázat v textu">„${esc(r.anchor_text.length>90?r.anchor_text.slice(0,88)+'…':r.anchor_text)}“</button>`:''}${rqMissing.has(r.id)?'<span class="tag bad">Kotva nenalezena</span>':''}<div class="helper">${esc(r.rationale)}</div><div class="actionrow"><button class="btn tiny" data-jump="${esc(other)}">Přejít na pasáž ↗</button><button class="btn tiny" data-relation-detail="${esc(r.id)}">Detail vazby</button>${r.status==='proposed'?`<button class="btn tiny danger" data-rel-drop="${esc(r.id)}" title="Zamítne návrh; zůstane ve Správě vazeb (Zamítnuté)">Odstranit návrh</button>`:''}</div></div>`}).join(''):'<p class="fine">Zatím bez propojení. Vazby je možné vytvářet na úrovni kapitol, pravidel i jednotlivých pasáží.</p>'}${hiddenNote(relAll.length-rel.length,'relations')}
${mirror.length?`<div class="section-kicker">Z JINÉ JAZYKOVÉ VERZE · PLATÍ I ZDE</div>${mirror.map(({r,from,other})=>`<div class="boxnote mirrored"><div class="meta"><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(other))}</p><div class="helper">Vazba vytvořená u ${esc(documentLabel(getDoc(from.document_id)))}; upravuje a schvaluje se tam.</div><div class="actionrow"><button class="btn tiny" data-jump="${esc(other)}">Přejít na pasáž ↗</button><button class="btn tiny" data-jump="${esc(from.id)}">Otevřít původní</button></div></div>`).join('')}`:''}</div>
<div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>▤ Naše komentáře <span class="tag">${comments.length}</span></h3><button class="btn tiny" id="addNote">+ Přidat</button></div>${comments.length?comments.slice().sort((a,b)=>(RQNotes.ORDER[a.kind]??5)-(RQNotes.ORDER[b.kind]??5)).map(c=>`<div class="boxnote${c.kind==='warning'?' warnnote':''}"><div class="meta"><strong class="kind">${rqIco(c.kind)} ${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</strong>${tag(c.status)}${translationStale(c)?' <span class="tag warn">Originál změněn</span>':''}${rqMissing.has(c.id)?' <span class="tag bad" title="Vybraný text už v ustanovení není (nové znění?). Otevřete detail a ukotvěte znovu, nebo archivujte.">Kotva nenalezena</span>':''}</div>${c.anchor_text?`<button type="button" class="anchor-q" data-anchor-jump="${esc(c.id)}" title="Ukázat v textu">„${esc(c.anchor_text.length>90?c.anchor_text.slice(0,88)+'…':c.anchor_text)}“</button>`:''}${rqLayer(c.kind)?'':`<p>${esc(c.body)}</p>`}<div class="helper">${esc(c.author||'RegulaQuest redakce')}</div><div class="actionrow"><button type="button" class="btn tiny" data-comment-detail="${esc(c.id)}">Detail / upravit</button>${c.status==='draft'?`<button type="button" class="btn tiny danger" data-com-drop="${esc(c.id)}" title="Přesune koncept do archivu (Správa komentářů → Archivované), odkud jde obnovit">Odstranit</button>`:''}</div></div>`).join(''):'<p class="fine">Zatím bez autorských komentářů.</p>'}${hiddenNote(comAll.length-comments.length,'comments')}</div>${(db.amendments||[]).some(x=>x.document_id===u.document_id)?`<div class="soft-rule"></div><div class="context-section"><div class="context-head"><h3>◷ Změny a původ znění <span class="tag">${amendments.length}</span></h3></div>
${amendments.length?amendments.map(a=>`<div class="boxnote"><div class="meta"><strong>${esc(a.marker)} · ${a.kind==='corrigendum'?'Oprava':'Pozměňující akt'}</strong></div><p>${esc(a.title||'Označení změny v konsolidovaném dokumentu')}</p>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Přejít na původní akt ↗</a>`:`<a href="${esc(origin?.url||'#')}" target="_blank" rel="noopener noreferrer">Ověřit akt v přehledu „Ve znění“ na EUR-Lexu ↗</a>`}</div>`).join(''):'<p class="fine">U tohoto textu nejsou v importovaném konsolidovaném znění zachyceny změnové značky. Neznamená to, že text nikdy nebyl měněn.</p>'}
<p class="fine">Zobrazené znění je informativní konsolidace k datu uvedenému u zdroje. Změnové značky se do textu nevypisují.</p></div>
`:''}<div class="soft-rule"></div><div class="fine">Komentář je oddělený od oficiálního znění. Pro studentský export musí být schválený.</div>`;
box.querySelector('#suggestLinks').onclick=()=>dialogReferences(u.id);box.querySelector('#seekRelated').onclick=()=>dialogRelated(u.id);box.querySelector('#addLink').onclick=()=>dialogRelation(u);box.querySelector('#addNote').onclick=()=>dialogComment(u);box.querySelectorAll('[data-jump]').forEach(x=>x.onclick=()=>openUnit(x.dataset.jump));box.querySelectorAll('[data-relation-detail]').forEach(x=>x.onclick=()=>dialogRelationDetail(x.dataset.relationDetail));box.querySelectorAll('[data-comment-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.commentDetail));
box.querySelectorAll('[data-com-drop]').forEach(x=>x.onclick=()=>safeAct({action:'archive_comment_draft',comment_id:x.dataset.comDrop}));
box.querySelectorAll('[data-rel-drop]').forEach(x=>x.onclick=()=>safeAct({action:'relation_status',id:x.dataset.relDrop,status:'rejected'}));
box.querySelectorAll('[data-hidden-page]').forEach(x=>x.onclick=()=>{const p=x.dataset.hiddenPage;if(p==='comments'){commentStatusFilter='archived';commentDocFilter='all'}else{relationStatusFilter='archived';relationDocFilter='all'}setPage(p)});
box.querySelectorAll('[data-anchor-jump]').forEach(x=>{x.onclick=e=>{e.stopPropagation();rqSetFocus(x.dataset.anchorJump,x)};const card=x.closest('.boxnote');if(card){card.classList.add('focusable');if(rqFocus&&rqFocus.src===x.dataset.anchorJump)card.classList.add('focused');card.addEventListener('click',e=>{if(!e.target.closest('button,a'))rqSetFocus(x.dataset.anchorJump,x)})}});
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
const active=db.relations.filter(r=>r.status==='proposed'&&(relevance(r.source_id)||relevance(r.target_id)));$('#reviewLinks').innerHTML=active.length?active.map(r=>`<div class="review-card"><h3>${esc(fullname(r.source_id))}</h3><small>↔ ${esc(fullname(r.target_id))}</small><p><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong><br>${esc(r.rationale)}</p><small>Doklad: ${esc(r.evidence||'Nedoplněn – před schválením ověřte originální pasáž')}</small><small>Původ: ${esc(r.provenance)}</small><div class="actionrow">${getUnit(r.source_id)?.editor_archived||getUnit(r.target_id)?.editor_archived?'<span class="tag bad">Vede k archivované části</span>':`<button class="btn tiny accent" data-r-approve="${esc(r.id)}">✓ Schválit</button>`}<button class="btn tiny danger" data-r-reject="${esc(r.id)}">× Zamítnout</button><button class="btn tiny" data-r-open="${esc(r.source_id)}">Otevřít zdroj</button></div></div>`).join(''):'<div class="review-card"><p>Žádné vazby čekající na posouzení.</p></div>';
const pendingComments=(db.comment_revisions||[]).filter(r=>r.status==='proposed'&&relevance(db.comments.find(c=>c.id===r.comment_id)?.unit_id));
$('#reviewCommentRevisions').innerHTML=pendingComments.length?pendingComments.map(r=>{
 const c=db.comments.find(x=>x.id===r.comment_id);return `<div class="review-card"><h3>${r.change_type==='archive'?'Archivace':r.change_type==='restore'?'Obnovení':'Úprava'} · ${esc(fullname(c?.unit_id))}</h3>
 <small>${esc(noteName[r.kind]||r.kind)} · ${esc(r.language.toUpperCase())} · ${esc(r.author||'Bez autora')}</small>
 <p>${esc(r.body)}</p><small>Důvod změny: ${esc(r.change_reason)}</small>
 <div class="actionrow"><button class="btn tiny" data-cr-detail="${esc(r.comment_id)}">Původní znění a historie</button><button class="btn tiny accent" data-cr-approve="${esc(r.id)}">✓ Schválit změnu</button><button class="btn tiny danger" data-cr-reject="${esc(r.id)}">× Zamítnout</button></div></div>`}).join(''):'<div class="review-card"><p>Žádné navržené změny komentářů.</p></div>';
$('#reviewCommentRevisions').querySelectorAll('[data-cr-detail]').forEach(x=>x.onclick=()=>dialogCommentDetail(x.dataset.crDetail));
$('#reviewCommentRevisions').querySelectorAll('[data-cr-approve]').forEach(x=>x.onclick=()=>decideCommentRevision(x.dataset.crApprove,'approved'));
$('#reviewCommentRevisions').querySelectorAll('[data-cr-reject]').forEach(x=>x.onclick=()=>decideCommentRevision(x.dataset.crReject,'rejected'));
const activeComments=db.comments.filter(c=>c.status==='draft'&&relevance(c.unit_id));$('#reviewComments').innerHTML=activeComments.length?activeComments.map(c=>`<div class="review-card"><h3>${esc(fullname(c.unit_id))}</h3><small>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())}</small><p>${esc(c.body)}</p><div class="actionrow"><button class="btn tiny" data-c-detail="${esc(c.id)}">Otevřít / upravit</button>${getUnit(c.unit_id)?.editor_archived?'<span class="tag bad">Část je archivovaná</span>':`<button class="btn tiny accent" data-c-approve="${esc(c.id)}">✓ Schválit</button>`}<button class="btn tiny danger" data-c-reject="${esc(c.id)}">× Zamítnout</button></div></div>`).join(''):'<div class="review-card"><p>Žádné komentáře čekající na schválení.</p></div>';
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
 if(window.RQHome)RQHome.remember(id);
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
  return `<div class="history-row"><strong>${esc(labels[h.event_type]||h.event_type)}</strong><small>${esc(new Date(h.created_at).toLocaleString('cs-CZ'))}</small>
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
 const found=db.units.filter(u=>u.document_id===doc.value && u.id!==r.source_id && !u.editor_archived && [unitPath(u.id),u.heading,u.locator].join(' ').toLocaleLowerCase('cs').includes(q));
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
 (commentStatusFilter==='all'||(commentStatusFilter==='stale'?translationStale(c):c.status===commentStatusFilter))&&
 (!q||[fullname(c.unit_id),noteName[c.kind],c.body,c.author,c.language].join(' ').toLocaleLowerCase('cs').includes(q)));
 const area=$('#commentList');area.innerHTML=items.length?items.map(c=>{
 const pending=(db.comment_revisions||[]).find(r=>r.comment_id===c.id&&r.status==='proposed');
 return `<div class="review-card comment-list-item"><h3>${esc(fullname(c.unit_id))}</h3>
 <small>${esc(noteName[c.kind]||c.kind)} · ${esc(c.language.toUpperCase())} · ${esc(c.author||'Redakce RegulaQuest')}</small>
 <p class="comment-preview">${esc(c.body)}</p><div class="actionrow">${tag(c.status)}${pending?'<span class="tag proposed">Čeká návrh změny</span>':''}${translationStale(c)?'<span class="tag warn">Originál překladu změněn</span>':''}<button class="btn tiny" data-manage-comment="${esc(c.id)}">Otevřít detail / historie</button><button class="btn tiny" data-open-comment-unit="${esc(c.unit_id)}">Přejít na ustanovení</button></div></div>`;
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
 return `<div class="history-row"><strong>${esc(descriptions[h.event_type]||h.event_type)}</strong><small>${esc(new Date(h.created_at).toLocaleString('cs-CZ'))}</small>${contentChanged?`<details><summary>Porovnat původní a nové znění</summary><div class="revision-text"><strong>Před</strong><p>${esc(before.body)}</p><strong>Po</strong><p>${esc(after.body)}</p></div></details>`:''}</div>`;
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
 ${c.anchor_text?`<div class="anchor-preview"><span class="smallcaps">Ukotveno k textu${c.anchor_occurrence>1?' ('+c.anchor_occurrence+'. výskyt)':''}</span><span class="${rqLayer(c.kind)?'rq-hl hl-'+c.kind:'rq-anc'}">„${esc(c.anchor_text)}“</span>${rqMissing.has(c.id)?'<br><span class="tag bad">V aktuálním znění nenalezeno</span> – archivujte a vytvořte poznámku znovu k novému textu.':''}</div>`:''}
 <div class="revision-text"><p>${esc(c.body)}</p></div>
 ${pending?`<div class="notice">Čeká návrh ${pending.change_type==='edit'?'úpravy':pending.change_type==='archive'?'archivace':'obnovení'}: ${esc(pending.change_reason)}. Dosavadní schválená verze zůstává beze změny.</div>`:''}
 ${translationSource(c)?`<div class="notice"><strong>Převzato z ${esc(translationSource(c).language.toUpperCase())} komentáře</strong> u ${esc(fullname(translationSource(c).unit_id))}.
 ${translationStale(c)?`<br><strong>Originál se od převzetí změnil.</strong> Zkontrolujte, zda je potřeba upravit i tento komentář.
 <div class="revision-text"><strong>Originál při převzetí</strong><p>${esc(c.source_body)}</p><strong>Originál nyní</strong><p>${esc(translationSource(c).body)}</p></div>
 <button class="btn tiny accent" type="button" id="markTranslation">Zkontrolováno – překlad odpovídá</button>`:' Originál se od převzetí nezměnil.'}</div>`:''}
 <h3>Historie komentáře</h3><div class="history-box">${commentHistory(id)}</div>
 <div class="modal-actions"><button class="btn" type="button" id="closeComment">Zavřít</button><button class="btn" type="button" id="goCommentUnit">Otevřít ustanovení</button>
 ${!pending&&c.status!=='archived'?`<button class="btn accent" type="button" id="editComment">${c.status==='approved'?'Navrhnout úpravu':'Upravit koncept'}</button>`:''}
 ${!pending&&c.status==='approved'?'<button class="btn danger" type="button" id="archiveComment">Navrhnout archivaci</button>':''}
 ${!pending&&['draft','rejected'].includes(c.status)?'<button class="btn danger" type="button" id="archiveDraftComment">Archivovat koncept</button>':''}
 ${!pending&&c.status==='archived'?`<button class="btn accent" type="button" id="restoreComment">${commentWasApproved(c.id)?'Navrhnout obnovení':'Obnovit koncept'}</button>`:''}</div>`;
 f.querySelector('#closeComment').onclick=()=>d.close();
 const mt=f.querySelector('#markTranslation');if(mt)mt.onclick=()=>{d.close();safeAct({action:'translation_current',id})};
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
 try{const r=await rpc('rq_publish',{p_note:note});$('#publishNote').value='';await refresh();const c=r&&r.changes||{};const parts=[c.units_new?`${c.units_new} nově zveřejněných částí`:'',c.units_changed?`${c.units_changed} změněných`:'',c.comments_new?`${c.comments_new} nových výkladů`:'',c.relations_new?`${c.relations_new} nových vazeb`:'',c.paths_new?`${c.paths_new} nových tras`:''].filter(Boolean);toast('Publikováno.'+(parts.length?' Změny: '+parts.join(', ')+'.':' Beze změn obsahu.')+' Studenti je uvidí v „Co je nového“.')}
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
 f.innerHTML=`<h2>Údaje dokumentu · ${esc(d.family)} ${esc(d.language.toUpperCase())}</h2>
 <label class="form-field"><span>Název</span><textarea class="textarea" name="title" required>${esc(d.title)}</textarea></label>
 <div class="rq-meta-grid"><label class="form-field"><span>Zkratka / rodina</span><input class="input" name="family" required value="${esc(d.family)}"></label>
 <label class="form-field"><span>Revize / časová verze</span><input class="input" name="version" value="${esc(d.version)}"></label></div>
 <label class="form-field"><span>Krátký název pro studenty</span><input class="input" name="short_title" maxlength="120" value="${esc(d.short_title||'')}" placeholder="Např. MDR – Nařízení o zdravotnických prostředcích"><small class="form-hint">Zobrazí se ve čtečce na kartách a v seznamu dokumentů. Prázdné = zkratka a jazyk.</small></label>
 <div class="rq-meta-grid"><label class="form-field rq-check"><span>Doporučit studentům</span><label class="inline-check"><input type="checkbox" name="featured" ${d.featured?'checked':''}> zobrazit na úvodní stránce čtečky</label></label>
 <label class="form-field"><span>Pořadí mezi doporučenými</span><input class="input" name="featured_sort" type="number" min="0" max="999" value="${esc(d.featured_sort??100)}"></label></div>
 <label class="form-field"><span>Vydavatel</span><input class="input" name="publisher" value="${esc(d.publisher)}" placeholder="Např. Evropský parlament a Rada"></label>
 <label class="form-field"><span>Oficiální URL</span><input class="input" name="url" type="url" value="${esc(d.url)}" placeholder="https://…"></label>
 ${select('Původ / jurisdikce','jurisdiction',Object.entries(jurisdictions),d.jurisdiction||'other')}
 ${select('Druh dokumentu','document_type',Object.entries(docTypes),d.document_type||'other')}
 <label class="form-field"><span>Odborné tagy (oddělit čárkou)</span><textarea class="textarea" name="topics" placeholder="Např. klasifikace, software, klinické hodnocení">${esc((d.topics||[]).join(', '))}</textarea><small class="form-hint">Zvolte jednotné názvy. Tagy nepředstavují samotnou odbornou vazbu na ustanovení.</small></label>
 <div class="notice">Dokumentová skupina: ${esc(d.group_key||d.id)}. Změna typu, původu a tagů bude platit pro propojené jazykové verze. Text ani schválené vazby se nemění.</div>
 ${window.RQAreas?RQAreas.metaSection(d):''}<div class="doc-danger"><strong>Odstranění dokumentu</strong><p>Archivace dokument skryje v katalogu i ve čtečce (od příští publikace); vše zůstane a lze ho obnovit. Trvalé smazání je jen pro omyly – u dokumentu, který ještě nebyl publikován a nemá schválený obsah.</p>
  <button class="btn tiny" type="button" id="archiveDoc">Archivovat dokument</button> <button class="btn tiny danger" type="button" id="deleteDoc">Smazat dokument trvale…</button></div>
 <div class="modal-actions"><button class="btn" type="button" id="cancelMetadata">Zrušit</button><button class="btn accent" type="submit">Uložit metadata</button></div>`;
 f.querySelector('#cancelMetadata').onclick=()=>modal.close();
 f.querySelector('#archiveDoc').onclick=async()=>{if(!confirm(`Archivovat ${d.family} · ${d.language.toUpperCase()}? Dokument zmizí z katalogu a po příští publikaci i ze čtečky. Obnovit ho lze na úvodní stránce.`))return;
  try{await rpc('rq_archive_document',{p_id:id,p_archived:true});modal.close();await refresh();setPage('home');toast('Dokument archivován.')}catch(e){toast(e.message,true)}};
 f.querySelector('#deleteDoc').onclick=()=>{modal.close();setTimeout(()=>rqDeleteDocument(id),0)};
 if(window.RQAreas)RQAreas.bindMeta(d);
 f.onsubmit=e=>{e.preventDefault();const raw=Object.fromEntries(new FormData(f).entries());const topics=[...new Set(String(raw.topics||'').split(',').map(t=>t.trim()).filter(Boolean))];if(topics.length>40){toast('Maximálně 40 tagů',true);return}
 safeAct({action:'update_document_metadata',document_id:id,title:raw.title,family:raw.family,version:raw.version,publisher:raw.publisher,url:raw.url,jurisdiction:raw.jurisdiction,document_type:raw.document_type,topics,short_title:raw.short_title||'',featured:!!raw.featured,featured_sort:Number(raw.featured_sort)||100});modal.close();};
 modal.showModal();
}
function dialogRelation(u,preset=null,anchor=null){
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
 <div class="relation-small">Stav textu: ${esc(statusName[u.text_status]||u.text_status)}</div>${anchor?`<div class="anchor-preview"><span class="smallcaps">Z místa v textu${anchor.occurrence>1?' ('+anchor.occurrence+'. výskyt)':''}</span><span class="rq-anc link">„${esc(anchor.text)}“</span></div>`:''}</div>
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
  const matching=db.units.filter(x=>x.document_id===id && x.id!==u.id && !x.editor_archived && [unitPath(x.id),x.heading,x.locator].join(' ').toLocaleLowerCase('cs').includes(q));
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
 if(anchor&&!preset){
  evidence.value=`${sourceDoc.family} ${sourceDoc.language.toUpperCase()}, ${u.locator||unitPath(u.id)}: „${anchor.text}“`;
  if(/\b(čl\.|článk|odst\.|příloh|pravidl|Article|Annex|Rule|point|bod)/i.test(anchor.text)){type.value='references';type.onchange&&type.onchange()}
 }
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
  if(relationsSeenFrom(u.document_id).some(r=>r.source_id===u.id&&r.target_id===chosen.id&&r.relation_type===type.value&&r.status!=='rejected')){toast('Tato vazba již existuje (případně u jiné jazykové verze, kde platí i pro tuto).',true);return}
  if(!confirm(`Opravdu uložit návrh propojení?\n\nOD: ${fullname(u.id)}\n\nNA: ${fullname(chosen.id)}\n\nTYP: ${relName[type.value]}`))return;
  const save=form.querySelector('#relationSave');save.disabled=true;
  try{await act({action:'new_relation',...(anchor?{anchor_text:anchor.text,anchor_occurrence:anchor.occurrence}:{}),source_id:u.id,target_id:chosen.id,relation_type:type.value,rationale:rationale.value.trim(),evidence:evidence.value.trim(),provenance:preset?(preset.kind==='related'?'cross-document-structure-lexical-v1; editor-reviewed':'explicit-citation-v1; editor-reviewed'):'manual'});d.close()}
  catch(err){toast(err.message,true);save.disabled=false}
 };
 d.showModal();
}

function dialogComment(u,anchor,kind){
 // Komentář je jazykový; z jiné jazykové verze lze převzít text jako podklad k překladu.
 const doc=getDoc(u.document_id),lang=doc?.language||'cs';
 const twins=db.documents.filter(x=>doc&&x.id!==doc.id&&(x.group_key||x.id)===(doc.group_key||doc.id)).map(x=>equivalentIn(u,x.id)).filter(Boolean);
 const others=db.comments.filter(c=>twins.some(t=>t.id===c.unit_id)&&['approved','draft'].includes(c.status));
 const html=`<p>Komentář není součástí právního předpisu. Nejprve se uloží jako koncept.</p>
 ${others.length?`<div class="notice"><strong>Komentáře u jiné jazykové verze</strong> – lze převzít jako podklad a upravit (přeložit):${others.map(c=>`<div class="take-row"><span>${esc(getDoc(getUnit(c.unit_id).document_id).language.toUpperCase())} · ${esc(noteName[c.kind]||c.kind)} · ${tag(c.status)} ${esc(c.body.slice(0,140))}${c.body.length>140?'…':''}</span><button type="button" class="btn tiny" data-take="${esc(c.id)}">Převzít</button></div>`).join('')}</div>`:''}
 ${anchor?`<div class="anchor-preview"><span class="smallcaps">K vybranému textu</span><span class="${rqLayer(kind)?'rq-hl hl-'+kind:'rq-anc'}">„${esc(anchor.text)}“</span>${anchor.occurrence>1?` <small>(${anchor.occurrence}. výskyt)</small>`:''}</div>`:''}${select('Typ komentáře','kind',Object.entries(noteName).filter(([k])=>anchor||!rqLayer(k)),kind||'explanation')}<input type="hidden" name="anchor_text" value="${anchor?esc(anchor.text):''}"><input type="hidden" name="anchor_occurrence" value="${anchor?anchor.occurrence:1}">${select('Jazyk','language',[['cs','Čeština'],['en','English']],lang)}${field('Autor / garant','author','Redakce RegulaQuest')}${field('Obsah komentáře','body','','textarea')}<input type="hidden" name="translated_from" value="">`;
 dialog((anchor?'Poznámka k výběru · ':'Nový komentář · ')+u.label,html,vals=>safeAct({action:'new_comment',unit_id:u.id,...vals}));
 const f=$('#modalContent');
 f.querySelectorAll('[data-take]').forEach(b=>b.onclick=()=>{const c=db.comments.find(x=>x.id===b.dataset.take);
  f.querySelector('[name=kind]').value=c.kind;f.querySelector('[name=author]').value=c.author||'Redakce RegulaQuest';
  f.querySelector('[name=translated_from]').value=c.id;const body=f.querySelector('[name=body]');body.value=c.body;body.focus();toast('Text převzat – upravte ho (přeložte) a uložte.')});
}
function dialogDoc(){const html=`<p>Nový dokument bude mít vlastní verzi, jazyk a původ. Po vytvoření do něj můžete přidávat kapitoly a konkrétní pasáže.</p>${field('Název','title')}${field('Zkratka / rodina','family')}${select('Typ','kind',[['Právní předpis','Právní předpis'],['Metodický dokument','Metodický dokument'],['Doplňující dokument','Doplňující dokument']])}${select('Jazyk','language',[['cs','Čeština'],['en','English']])}${field('Revize / časová verze','version')}${db.documents.length?select('Jiná jazyková verze téhož předpisu (nepovinné)','group_key',[['','— samostatný dokument —'],...db.documents.map(x=>[x.group_key||x.id,documentLabel(x)])]):''}<label class="form-field"><span>Vydavatel (nepovinné)</span><input class="input" name="publisher" type="text" placeholder="Např. Evropský parlament a Rada"></label><label class="form-field"><span>Oficiální URL (nepovinné)</span><input class="input" name="url" type="url" placeholder="https://…"></label>`;dialog('Nový zdrojový dokument',html,vals=>{
 // jiná jazyková verze: převzít zařazení a tagy skupiny
 const g=vals.group_key&&db.documents.find(x=>(x.group_key||x.id)===vals.group_key);
 if(g)Object.assign(vals,{jurisdiction:g.jurisdiction,document_type:g.document_type,topics:g.topics||[]});
 safeAct({action:'new_document',...vals})})}
function dialogUnit(){const doc=getDoc(selected) || getDoc(getUnit(selected)?.document_id) || getDoc(activeDocId) || db.documents[0];if(!doc){toast('Nejdřív založte dokument.',true);return}const all=db.units.filter(u=>u.document_id===doc.id&&!u.editor_archived);const html=`<p>Vytvoříte rejstříkovou část. Text vložíte dodatečně, aby nešlo o neověřené přepisy.</p>${select('Dokument','document_id',db.documents.map(d=>[d.id,`${d.family} · ${d.language.toUpperCase()}`]),doc.id)}${select('Nadřazená část','parent_id',[['','Bez nadřazené části'],...all.map(u=>[u.id,u.label+' · '+u.heading])])}${select('Typ části','kind',[['article','Článek'],['annex','Příloha'],['paragraph','Odstavec'],['rule','Pravidlo'],['section','Kapitola / pasáž']])}${field('Označení','label')}<label class="form-field"><span>Nadpis / stručný popis (nepovinné)</span><input class="input" name="heading" type="text" placeholder="Např. Definice"></label><label class="form-field"><span>Lokátor v originále (nepovinné)</span><input class="input" name="locator" type="text" placeholder="Např. Článek 2 nebo Annex VIII, Rule 11"></label>`;dialog('Nové ustanovení / pasáž',html,vals=>safeAct({action:'new_unit',...vals}))}

// Import konsolidovaného znění z EUR-Lexu: převod v prohlížeči (import-eurlex.js), originál do Storage,
// části po dávkách přes rq_import_units, závěr rq_import_finish. Nic se samo neověřuje.
function dialogImport(){
 if(!db.documents.length){toast('Nejdřív založte dokument („+ Nový dokument“).',true);return}
 const d=$('#modal'),f=$('#modalContent');let prepared=null;
 f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Import dokumentu</h2>
 <p><strong>Předpisy z EUR-Lexu:</strong> otevřete konsolidované znění ve formátu HTML a uložte stránku (Ctrl+S, „Webová stránka, pouze HTML“).<br><strong>Metodiky (MDCG apod.):</strong> vyberte originální PDF. Kapitoly se rozpoznají podle obsahu dokumentu, tabulky se převedou, schémata se uloží jako obrázek stránky.</p>
 ${select('Dokument ve Studiu','doc',db.documents.map(x=>[x.id,documentLabel(x)]),getDoc(activeDocId)?activeDocId:db.documents[0].id)}
 <label class="form-field"><span>Soubor HTML nebo PDF</span><input class="input" id="impFile" type="file" accept=".html,.htm,.pdf,text/html,application/pdf"></label>
 <div id="impReport" class="import-report" role="status">Vyberte soubor a stiskněte „Zkontrolovat“.</div>
 <div class="modal-actions"><button class="btn" type="button" id="impClose">Zavřít</button><button class="btn" type="button" id="impCheck">Zkontrolovat</button><button class="btn accent" type="button" id="impGo" disabled>Importovat</button></div>`;
 const docSel=f.querySelector('[name=doc]'),file=f.querySelector('#impFile'),rep=f.querySelector('#impReport'),go=f.querySelector('#impGo'),check=f.querySelector('#impCheck');
 const reset=()=>{prepared=null;go.disabled=true;rep.textContent='Vyberte soubor a stiskněte „Zkontrolovat“.'};
 docSel.onchange=reset;file.onchange=reset;f.querySelector('#impClose').onclick=()=>d.close();
 check.onclick=async()=>{
  try{
   const fl=file.files[0];if(!fl)throw Error('Vyberte soubor HTML.');
   check.disabled=true;rep.textContent='Čtu a kontroluji soubor…';
   const doc=getDoc(docSel.value),buffer=await fl.arrayBuffer(),isPdf=/\.pdf$/i.test(fl.name)||fl.type==='application/pdf';
   let p;
   if(isPdf){
    const sha=await RQImport.sha256(buffer);
    p=await RQPdf.parsePdf(buffer,doc.id,fl.name,t=>{rep.textContent=t});
    p.id={celex:'',language:doc.language,date:'',dateText:'',pdf:true,sha};p.amendments={};p.unitMarks={};
    for(const u of p.units)for(const b of u.content_blocks)if(b.type==='figure')b.path=`${doc.id}/${sha.slice(0,12)}/p${b.page}.png`;
   }else{
    p=RQImport.parseEurlex(new TextDecoder('utf-8').decode(buffer),doc.id,fl.name);
    if(p.id.language!==doc.language)p.errors.unshift(`Jazyk souboru (${p.id.language.toUpperCase()}) neodpovídá dokumentu (${doc.language.toUpperCase()}).`);
   }
   const existing=db.units.filter(u=>u.document_id===doc.id);
   const mode=existing.some(u=>/-(art|annex|rule|sec)-|-front$/.test(u.id))?'update':'new';
   const diff=RQImport.compare(p.units,existing);
   const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'],[yy,mm,dd]=(p.id.date||'--').split('-');
   const versionText=!p.id.dateText?'':p.id.language==='en'?`Consolidated text of ${Number(dd)} ${MONTHS[Number(mm)-1]} ${yy}`:`Konsolidované znění k ${p.id.dateText}`;
   const url=p.id.celex&&p.id.date?`https://eur-lex.europa.eu/legal-content/${p.id.language.toUpperCase()}/TXT/?uri=CELEX:${p.id.celex}-${p.id.date.replace(/-/g,'')}`:'';
   const list=(arr,n=25)=>arr.length?`<ul class="imp-list">${arr.slice(0,n).map(u=>`<li>${esc(u.kind==='paragraph'?u.locator:u.label)}${u.heading?' – '+esc(u.heading.slice(0,70)):''}</li>`).join('')}${arr.length>n?`<li>… a dalších ${arr.length-n}</li>`:''}</ul>`:'';
   prepared={p,doc,buffer,file:fl,mode,diff,versionText,url};
   rep.innerHTML=`<div class="import-results">
    ${p.id.pdf?`<strong>PDF · ${p.info.pages} stran</strong>
    <p>Nalezeno: ${p.info.toc} položek obsahu → ${p.info.sections} kapitol${p.info.rules?', '+p.info.rules+' pravidel':''}, ${p.info.tables} tabulek, ${p.info.figures} schémat (uloží se jako obrázek stránky).</p>`:
    `<strong>${esc(p.id.celex||'Neznámý CELEX')} · ${esc(p.id.language.toUpperCase())}${versionText?' · '+esc(versionText):''}</strong>
    <p>Nalezeno: ${p.info.articles} článků${p.info.inserted.length?' (vložené '+esc(p.info.inserted.join(', '))+')':''}, ${p.info.paragraphs} odstavců, ${p.info.annexes} příloh${p.info.rules?', '+p.info.rules+' klasifikačních pravidel':''}, ${Object.keys(p.amendments).length} pozměňujících aktů a oprav. Kontrola úplnosti textu: ${p.errors.some(e=>e.startsWith('Ztráta'))?'<b>neprošla</b>':'v pořádku'}.</p>`}
    ${mode==='new'?`<p><strong>První import:</strong> vznikne ${diff.added.length} nových částí ve stavu „Nutno ověřit“.${diff.same.length+diff.changed.length?` ${diff.same.length+diff.changed.length} už existujících se nepřepíše, pokud jsou ověřené nebo upravené.`:''}</p>`:
    `<p><strong>Aktualizace na nové znění</strong> (dokument už importované části má):</p>
     <p>beze změny <b>${diff.same.length}</b> (zůstávají ověřené) · změněno <b>${diff.changed.length}</b> · nové <b>${diff.added.length}</b> · v novém znění chybí <b>${diff.removed.length}</b></p>
     ${diff.changed.length?`<details open><summary>Změněné části – vrátí se k ověření, jejich schválené vazby a komentáře do kontroly</summary>${list(diff.changed)}</details>`:''}
     ${diff.added.length?`<details><summary>Nové části</summary>${list(diff.added)}</details>`:''}
     ${diff.removed.length?`<details open><summary>Části, které v novém znění nejsou – archivují se (nic se nesmaže)</summary>${list(diff.removed)}</details>`:''}`}
    ${versionText&&doc.version!==versionText?`<label class="import-replace"><input type="checkbox" id="impVersion" checked> Nastavit verzi dokumentu na „${esc(versionText)}“ a odkaz na toto znění</label>`:''}
    ${p.errors.map(e=>`<div class="notice">${esc(e)}</div>`).join('')}
    ${p.warnings.map(e=>`<p class="fine">${esc(e)}</p>`).join('')}</div>`;
   go.disabled=!!p.errors.length||(mode==='update'&&!diff.changed.length&&!diff.added.length&&!diff.removed.length);
   if(mode==='update'&&go.disabled&&!p.errors.length)rep.insertAdjacentHTML('beforeend','<div class="notice">Soubor se shoduje s textem ve Studiu, není co importovat.</div>');
  }catch(e){prepared=null;go.disabled=true;rep.textContent='Chyba: '+e.message}
  finally{check.disabled=false}
 };
 go.onclick=async()=>{
  if(!prepared)return;const {p,doc,buffer,file:fl,mode,diff,versionText,url}=prepared;
  const what=mode==='update'?`Aktualizovat ${doc.family} na nové znění?\n\nZměněno ${diff.changed.length}, nové ${diff.added.length}, archivováno ${diff.removed.length}. Změněné části bude nutné znovu ověřit.`:`Importovat ${p.units.length} částí do ${doc.family}?`;
  if(!confirm(what))return;
  const setVersion=!!f.querySelector('#impVersion')?.checked;
  go.disabled=check.disabled=true;
  try{
   rep.textContent='Ukládám originál…';
   const sha=await RQImport.sha256(buffer),mime=p.id.pdf?'application/pdf':'text/html';
   const path=p.id.pdf?`${doc.id}/${sha.slice(0,12)}.pdf`:`${doc.id}/${p.id.date||'bez-data'}-${sha.slice(0,12)}.html`;
   const up=await RQ.client.storage.from('originals').upload(path,new Blob([buffer],{type:mime}),{contentType:mime,upsert:false});
   if(up.error&&!/exist|duplicate/i.test(up.error.message))throw Error('Originál se nepodařilo uložit: '+up.error.message);
   if(p.id.pdf){   // schémata: obrázek stránky do úložiště figures
    const figs=[...new Map(p.units.flatMap(u=>u.content_blocks).filter(b=>b.type==='figure').map(b=>[b.path,b])).values()];
    for(const [k,b] of figs.entries()){
     rep.textContent=`Ukládám obrázky schémat ${k+1} z ${figs.length}…`;
     const png=await RQPdf.renderPage(p.pages[b.page-1]);
     const r=await RQ.client.storage.from('figures').upload(b.path,png,{contentType:'image/png',upsert:false});
     if(r.error&&!/exist|duplicate/i.test(r.error.message))throw Error('Obrázek se nepodařilo uložit: '+r.error.message);
    }
   }
   const units=[...p.units].sort((a,b)=>a.sort_order-b.sort_order),size=150,counts={added:0,updated:0,replaced:0,protected:0,same:0,changed:0};
   for(let i=0;i<units.length;i+=size){
    const part=units.slice(i,i+size);rep.textContent=`Ukládám části ${i+1}–${i+part.length} z ${units.length}…`;
    const marks=Object.fromEntries(part.map(u=>[u.id,p.unitMarks[u.id]||[]]));
    const r=await rpc('rq_import_units',{p_document_id:doc.id,p_units:part,p_meta:{mode,chunk:true,unit_amendments:marks},p_replace:false});
    for(const k in counts)counts[k]+=r[k]||0;
   }
   rep.textContent='Dokončuji…';
   const fin=await rpc('rq_import_finish',{p_document_id:doc.id,p_ids:units.map(u=>u.id),p_meta:{mode,filename:fl.name,sha256:sha,format:p.id.pdf?'pdf':'eurlex-html',
     storage_path:path,mime,amendments:p.amendments,counts,warnings:p.warnings,reason:versionText?'Nové znění: '+versionText:'Nové znění předpisu'}});
   if(setVersion)await rpc('rq_update_document',{p_id:doc.id,p:{version:versionText,url}});
   d.close();await refresh();
   toast(mode==='update'?`Aktualizováno: ${counts.changed} změněno, ${counts.added} nových, ${fin.removed} archivováno, ${counts.same} beze změny.`
                       :`Import hotov: ${counts.added} nových částí${counts.protected?', '+counts.protected+' chráněných ponecháno':''}. Texty čekají na ověření.`);
   selectDocument(doc.id);
  }catch(e){rep.textContent='Chyba: '+e.message+' Část dat mohla být uložena; import lze bezpečně spustit znovu.';toast(e.message,true);go.disabled=check.disabled=false}
 };
 d.showModal();
}

// Návrhy výslovných odkazů (reference-suggest.js): zobrazí kandidáty, uložení vytvoří jen NÁVRHY vazeb ke schválení.
function dialogReferences(unitId){
 const unit=unitId&&getUnit(unitId),docId=unit?unit.document_id:activeDocId,doc=getDoc(docId);
 if(!doc){toast('Nejdřív vyberte dokument.',true);return}
 const d=$('#modal'),f=$('#modalContent');let filter='new',q='',pageNo=0,results=[];const chosen=new Set();const PAGE=50;
 const key=c=>c.source_id+'|'+c.target_hint;
 const compute=()=>{const pool=unit?db.units.filter(x=>x.id===unit.id):db.units.filter(x=>x.document_id===docId);
  results=RQRefs.scan(db.units,pool,relationsSeenFrom(docId),new Map(db.documents.map(x=>[x.id,x])));};
 f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Návrhy výslovných odkazů · ${esc(unit?unitPath(unit.id):documentLabel(doc))}</h2>
 <p>Studio našlo v textu místa, kde ${unit?'tato část':'dokument'} výslovně odkazuje na jiný článek, odstavec, přílohu nebo pravidlo <strong>téhož dokumentu</strong>. Vybrané se uloží jako <strong>návrhy vazeb</strong> do „Ke kontrole“; nic se neschválí samo. Odkazy na jiné předpisy (např. směrnice, nařízení ES) se zatím nehledají.</p>
 <div class="refs-bar"><label class="form-field"><span>Zobrazit</span><select class="select" id="refFilter"><option value="new">Nové návrhy</option><option value="existing">Už existující vazby</option><option value="unresolved">Nenalezený cíl</option><option value="all">Vše</option></select></label>
 <label class="form-field"><span>Hledat</span><input class="input" id="refSearch" type="search" placeholder="Např. článek 61, příloha XIV"></label></div>
 <div id="refCounts" class="fine"></div><div id="refList" class="refs-list"></div>
 <div class="modal-actions"><button class="btn" type="button" id="refClose">Zavřít</button><button class="btn" type="button" id="refPageAll">Vybrat vše na stránce</button><button class="btn accent" type="button" id="refSave" disabled>Uložit vybrané jako návrhy</button></div>`;
 const list=f.querySelector('#refList'),save=f.querySelector('#refSave');
 const visible=()=>results.filter(c=>(filter==='all'||c.category===filter)&&(!q||[unitPath(c.source_id),c.target_hint,c.matched_text,c.excerpt].join(' ').toLocaleLowerCase('cs').includes(q)));
 const draw=()=>{
  const all=visible(),pages=Math.max(1,Math.ceil(all.length/PAGE));pageNo=Math.min(pageNo,pages-1);
  const counts=results.reduce((a,c)=>(a[c.category]++,a),{new:0,existing:0,unresolved:0});
  f.querySelector('#refCounts').textContent=`Nové ${counts.new} · už existující ${counts.existing} · nenalezený cíl ${counts.unresolved}. Vybráno ${chosen.size}.`;
  list.innerHTML=all.length?all.slice(pageNo*PAGE,(pageNo+1)*PAGE).map(c=>`<div class="ref-row ${c.category}">
   ${c.category==='new'?`<input type="checkbox" data-ref="${esc(key(c))}" ${chosen.has(key(c))?'checked':''} aria-label="Vybrat návrh">`:'<span></span>'}
   <div><div class="ref-head"><strong>${esc(unitPath(c.source_id))}</strong> → ${c.target_id?`<strong>${esc(unitPath(c.target_id))}</strong>`:`<span class="tag bad">nenalezeno: ${esc(c.matched_text)}</span>`}
   ${c.category==='existing'?` ${tag(c.existing_status)}`:''}</div>
   <div class="ref-quote">„${esc(c.excerpt).replace(esc(c.matched_text),'<mark>'+esc(c.matched_text)+'</mark>')}“</div>
   ${c.category==='unresolved'?'<small class="fine">Cíl v dokumentu není (jiný předpis, rozsah „články 52 až 56“, nebo chyba v osnově). Případně vytvořte vazbu ručně.</small>':''}</div>
   <button class="btn tiny" type="button" data-open="${esc(c.source_id)}">Otevřít</button></div>`).join('')+
   (pages>1?`<div class="ref-pages"><button class="btn tiny" type="button" id="refPrev" ${pageNo?'':'disabled'}>← Předchozí</button> strana ${pageNo+1} z ${pages} <button class="btn tiny" type="button" id="refNext" ${pageNo<pages-1?'':'disabled'}>Další →</button></div>`:'')
   :'<p class="fine">Nic neodpovídá výběru.</p>';
  list.querySelectorAll('[data-ref]').forEach(b=>b.onchange=()=>{b.checked?chosen.add(b.dataset.ref):chosen.delete(b.dataset.ref);save.disabled=!chosen.size;f.querySelector('#refCounts').textContent=f.querySelector('#refCounts').textContent.replace(/Vybráno \d+/,'Vybráno '+chosen.size)});
  list.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{d.close();openUnit(b.dataset.open)});
  const pv=f.querySelector('#refPrev'),nx=f.querySelector('#refNext');if(pv)pv.onclick=()=>{pageNo--;draw()};if(nx)nx.onclick=()=>{pageNo++;draw()};
  save.disabled=!chosen.size;
 };
 f.querySelector('#refFilter').onchange=e=>{filter=e.target.value;pageNo=0;draw()};
 f.querySelector('#refSearch').oninput=e=>{q=e.target.value.trim().toLocaleLowerCase('cs');pageNo=0;draw()};
 f.querySelector('#refClose').onclick=()=>d.close();
 f.querySelector('#refPageAll').onclick=()=>{list.querySelectorAll('[data-ref]').forEach(b=>{b.checked=true;chosen.add(b.dataset.ref)});draw()};
 save.onclick=async()=>{
  const picked=results.filter(c=>c.category==='new'&&chosen.has(key(c)));
  if(!picked.length||!confirm(`Uložit ${picked.length} návrhů vazeb do schvalovací fronty?\n\nKaždý je potřeba před schválením zkontrolovat proti originálu.`))return;
  save.disabled=true;let created=0,skipped=0;
  try{
   for(let i=0;i<picked.length;i+=50){
    const links=picked.slice(i,i+50).map(c=>{const t=getUnit(c.target_id);return {source_id:c.source_id,target_id:c.target_id,relation_type:'references',
     anchor_text:c.matched_text.replace(/\s+/g,' ').trim(),anchor_occurrence:rqOccurrence(getUnit(c.source_id).body,c.matched_text,c.position),
     rationale:`Výslovný odkaz rozpoznaný v textu zdrojového ustanovení (${c.matched_text}). Cílové ustanovení: ${t.locator||t.label}. Redakční návrh – ověřit přesný význam a rozsah odkazu proti originálu.`,
     evidence:c.evidence,provenance:'explicit-citation-batch-v1'}});
    const r=await rpc('rq_batch_new_relations',{p_links:links});created+=r.created;skipped+=r.skipped;
   }
   chosen.clear();await refresh();compute();draw();toast(`Do „Ke kontrole“ přidáno ${created} návrhů vazeb${skipped?`, ${skipped} už existovalo`:''}.`);
  }catch(e){toast(e.message,true);save.disabled=false}
 };
 compute();
 if(!results.length){f.querySelector('#refList').innerHTML='<p class="fine">V textu nebyl nalezen žádný výslovný odkaz.</p>'}
 draw();d.showModal();
}

// Souvislosti s jiným dokumentem (related-search.js): shodná čísla pravidel + odborné pojmy. Ukládají se jen návrhy.
function dialogRelated(unitId){
 const unit=unitId&&getUnit(unitId),docId=unit?unit.document_id:activeDocId,doc=getDoc(docId);
 if(!doc){toast('Nejdřív vyberte dokument.',true);return}
 const others=db.documents.filter(x=>x.id!==docId&&(x.group_key||x.id)!==(doc.group_key||doc.id));
 if(!others.length){toast('Pro hledání souvislostí je potřeba další dokument (např. MDCG).',true);return}
 const pref=others.find(x=>x.document_type==='guidance'||/metodick/i.test(x.kind||''))||others[0];
 const d=$('#modal'),f=$('#modalContent');let filter='new',results=[];const chosen=new Set();
 const key=c=>c.source_id+'|'+c.target_id;
 f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Souvislosti · ${esc(unit?unitPath(unit.id):documentLabel(doc))}</h2>
 <p>Studio hledá v jiném dokumentu části, které s ${unit?'touto částí':'částmi dokumentu'} souvisejí: <strong>shodné číslo klasifikačního pravidla</strong> (předpis ↔ metodika) a <strong>shodu odborných pojmů</strong> (malý česko-anglický slovník). Nejde o AI ani o jistotu – vybrané se uloží jako <strong>návrhy vazeb</strong> do „Ke kontrole“.</p>
 <div class="refs-bar"><label class="form-field"><span>Hledat v dokumentu</span><select class="select" id="relTarget">${others.map(x=>`<option value="${esc(x.id)}" ${x.id===pref.id?'selected':''}>${esc(documentLabel(x))}</option>`).join('')}</select></label>
 <label class="form-field"><span>Zobrazit</span><select class="select" id="relFilter"><option value="new">Nové návrhy</option><option value="rule">Jen shodná pravidla</option><option value="existing">Už existující vazby</option><option value="all">Vše</option></select></label></div>
 <div id="relCounts" class="fine"></div><div id="relList" class="refs-list"></div>
 <div class="modal-actions"><button class="btn" type="button" id="relClose">Zavřít</button><button class="btn" type="button" id="relAll">Vybrat vše zobrazené</button><button class="btn accent" type="button" id="relSave" disabled>Uložit vybrané jako návrhy</button></div>`;
 const list=f.querySelector('#relList'),save=f.querySelector('#relSave'),tsel=f.querySelector('#relTarget');
 const compute=()=>{const docs=new Map(db.documents.map(x=>[x.id,x])),targets=db.units.filter(u=>u.document_id===tsel.value),rels=relationsSeenFrom(docId);
  results=unit?RQRelated.related(unit,targets.filter(u=>!u.editor_archived&&String(u.body||'').trim()),rels,docs,15):RQRelated.bulk(db.units.filter(u=>u.document_id===docId),targets,rels,docs,3);chosen.clear()};
 const visible=()=>results.filter(c=>filter==='all'||(filter==='existing'?c.existing:filter==='rule'?c.structural&&!c.existing:!c.existing)).slice(0,300);
 const draw=()=>{
  const n=results.filter(c=>!c.existing).length,r=results.filter(c=>c.structural&&!c.existing).length;
  f.querySelector('#relCounts').textContent=`Nové ${n} (z toho shodná pravidla ${r}) · už existující ${results.length-n}. Vybráno ${chosen.size}.`;
  const all=visible();
  list.innerHTML=all.length?all.map(c=>`<div class="ref-row ${c.existing?'existing':'new'}">
   ${c.existing?'<span></span>':`<input type="checkbox" data-rel="${esc(key(c))}" ${chosen.has(key(c))?'checked':''} aria-label="Vybrat návrh">`}
   <div><div class="ref-head"><strong>${esc(unitPath(c.source_id))}</strong> → <strong>${esc(fullname(c.target_id))}</strong> <span class="tag ${c.structural?'good':''}">${c.structural?'shodné pravidlo':esc(relName[c.type]||c.type)}</span>${c.existing?' '+tag(c.existing):''}</div>
   <div class="fine">${esc(c.why)}${c.common.length?` Pojmy: ${esc(c.common.join(', '))}.`:''}${c.shared.length&&!c.structural?` Slova: ${esc(c.shared.slice(0,6).join(', '))}.`:''}${c.warn.length?' ('+esc(c.warn.join(', '))+')':''}</div></div>
   <div class="actionrow"><button class="btn tiny" type="button" data-open="${esc(c.source_id)}">Zdroj</button><button class="btn tiny" type="button" data-open="${esc(c.target_id)}">Cíl</button></div></div>`).join('')
   :'<p class="fine">Nic neodpovídá výběru.</p>';
  list.querySelectorAll('[data-rel]').forEach(b=>b.onchange=()=>{b.checked?chosen.add(b.dataset.rel):chosen.delete(b.dataset.rel);save.disabled=!chosen.size;f.querySelector('#relCounts').textContent=f.querySelector('#relCounts').textContent.replace(/Vybráno \d+/,'Vybráno '+chosen.size)});
  list.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{d.close();openUnit(b.dataset.open)});
  save.disabled=!chosen.size;
 };
 tsel.onchange=()=>{compute();draw()};
 f.querySelector('#relFilter').onchange=e=>{filter=e.target.value;draw()};
 f.querySelector('#relClose').onclick=()=>d.close();
 f.querySelector('#relAll').onclick=()=>{list.querySelectorAll('[data-rel]').forEach(b=>{b.checked=true;chosen.add(b.dataset.rel)});draw()};
 save.onclick=async()=>{
  const picked=results.filter(c=>!c.existing&&chosen.has(key(c)));
  if(!picked.length||!confirm(`Uložit ${picked.length} návrhů vazeb do schvalovací fronty?\n\nKaždý je potřeba před schválením zkontrolovat proti originálům.`))return;
  save.disabled=true;let created=0,skipped=0;
  try{
   for(let i=0;i<picked.length;i+=50){
    const links=picked.slice(i,i+50).map(c=>({source_id:c.source_id,target_id:c.target_id,relation_type:c.type,rationale:c.why,evidence:c.evidence,provenance:'cross-document-structure-lexical-v1'}));
    const r=await rpc('rq_batch_new_relations',{p_links:links});created+=r.created;skipped+=r.skipped;
   }
   await refresh();compute();draw();toast(`Do „Ke kontrole“ přidáno ${created} návrhů vazeb${skipped?`, ${skipped} už existovalo`:''}.`);
  }catch(e){toast(e.message,true);save.disabled=false}
 };
 compute();draw();d.showModal();
}

/* ---- 0.9 Poznámky k vybranému textu ----
   Kotva = přesné znění výběru + kolikátý výskyt v části. Po novém znění se nenalezené kotvy označí. */
let rqMissing=new Set();
function rqUnitComments(u){return db.comments.filter(c=>c.unit_id===u.id&&!['archived','rejected'].includes(c.status))}
/* Štítky: koho se ustanovení týká, třída rizika, typ prostředku… (zrcadlí se do druhé jazykové verze). */
const rqTag=k=>(db.tags||[]).find(t=>t.key===k);
const rqTagName=k=>rqTag(k)?.name||k;
function rqAncestorIds(u){const out=[];let p=u.parent_id,guard=0;while(p&&guard++<50){out.push(p);p=getUnit(p)?.parent_id}return out}
function rqTagsRow(u){
 const own=u.tags||[],inh=own.length?[]:[...new Set(rqAncestorIds(u).flatMap(id=>getUnit(id)?.tags||[]))];
 const groups=(db.tag_groups||[]).map(g=>[g,(db.tags||[]).filter(t=>t.group_key===g.key&&!t.archived&&!own.includes(t.key))]).filter(x=>x[1].length);
 return `<div class="roles-edit" id="rqTags"><span class="smallcaps">Štítky</span>${own.map(k=>`<span class="role-chip on" title="${esc((db.tag_groups||[]).find(g=>g.key===rqTag(k)?.group_key)?.name||'')}">${esc(rqTagName(k))}<button type="button" data-tag-del="${esc(k)}" aria-label="Odebrat štítek ${esc(rqTagName(k))}">×</button></span>`).join('')}
  ${inh.length?`<span class="fine">z nadřazené části: ${inh.map(k=>esc(rqTagName(k))).join(', ')}</span>`:''}
  <span class="role-add"><button type="button" class="btn tiny" id="rqTagAdd">+ Štítek</button><span class="role-menu" hidden>${groups.map(([g,ts])=>`<span class="rm-h">${esc(g.name)}</span>${ts.map(t=>`<button type="button" data-tag-add="${esc(t.key)}">${esc(t.name)}</button>`).join('')}`).join('')}<span class="rm-sep"></span><button type="button" id="rqTagManage">Spravovat štítky…</button></span></span></div>`;
}
function rqTagsBind(box,u){
 const row=box.querySelector('#rqTags');if(!row)return;const own=u.tags||[];
 const save=tags=>safeAct({action:'set_tags',unit_id:u.id,tags});
 row.querySelectorAll('[data-tag-del]').forEach(b=>b.onclick=()=>save(own.filter(k=>k!==b.dataset.tagDel)));
 const menu=row.querySelector('.role-menu');row.querySelector('#rqTagAdd').onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden)document.addEventListener('click',()=>{menu.hidden=true},{once:true})};
 row.querySelectorAll('[data-tag-add]').forEach(b=>b.onclick=()=>save([...own,b.dataset.tagAdd]));
 row.querySelector('#rqTagManage').onclick=()=>rqTagManager();
}
function rqTagManager(){
 const d=$('#modal'),f=$('#modalContent');f.onsubmit=e=>e.preventDefault();
 const used=k=>db.units.filter(u=>(u.tags||[]).includes(k)).length;
 const draw=()=>{
  f.innerHTML=`<h2>Štítky</h2><p>Slovník štítků je společný pro celé Studio. Pro jiné předpisy si založte vlastní skupiny (např. „Oblast“ pro GDPR). Vyřazený štítek zmizí z nabídky i ze čtečky; u částí zůstane uložen a po obnovení se vrátí.</p>
  ${(db.tag_groups||[]).map(g=>`<div class="tg-group"><div class="tg-head"><input class="input tg-gname" data-g="${esc(g.key)}" value="${esc(g.name)}" aria-label="Název skupiny"><button type="button" class="btn tiny" data-gsave="${esc(g.key)}">Uložit název</button></div>
   ${(db.tags||[]).filter(t=>t.group_key===g.key).map(t=>`<div class="tg-row${t.archived?' arch':''}"><input class="input tg-name" data-t="${esc(t.key)}" value="${esc(t.name)}" aria-label="Název štítku"><small>${used(t.key)}× použito</small><button type="button" class="btn tiny" data-tsave="${esc(t.key)}">Uložit</button><button type="button" class="btn tiny ${t.archived?'':'danger'}" data-tarch="${esc(t.key)}">${t.archived?'Obnovit':'Vyřadit'}</button></div>`).join('')}
   <div class="tg-row new"><input class="input" data-newtag="${esc(g.key)}" placeholder="Nový štítek ve skupině „${esc(g.name)}“"><button type="button" class="btn tiny accent" data-tadd="${esc(g.key)}">Přidat</button></div></div>`).join('')}
  <div class="tg-group"><div class="tg-row new"><input class="input" id="tgNewGroup" placeholder="Nová skupina štítků (např. Oblast)"><button type="button" class="btn tiny accent" id="tgAddGroup">Založit skupinu</button></div></div>
  <div class="modal-actions"><button class="btn" type="button" id="tgClose">Zavřít</button></div>`;
  const run=async(fn,msg)=>{try{await fn();await refresh();toast(msg);draw();render()}catch(e){toast(e.message,true)}};
  f.querySelector('#tgClose').onclick=()=>d.close();
  f.querySelectorAll('[data-gsave]').forEach(b=>b.onclick=()=>{const g=db.tag_groups.find(x=>x.key===b.dataset.gsave);run(()=>rpc('rq_save_tag_group',{p_key:g.key,p_name:f.querySelector(`[data-g="${CSS.escape(g.key)}"]`).value,p_sort:g.sort}),'Skupina uložena.')});
  f.querySelectorAll('[data-tsave]').forEach(b=>b.onclick=()=>{const t=rqTag(b.dataset.tsave);run(()=>rpc('rq_save_tag',{p_key:t.key,p_group_key:t.group_key,p_name:f.querySelector(`[data-t="${CSS.escape(t.key)}"]`).value,p_sort:t.sort}),'Štítek uložen.')});
  f.querySelectorAll('[data-tarch]').forEach(b=>b.onclick=()=>{const t=rqTag(b.dataset.tarch);run(()=>rpc('rq_archive_tag',{p_key:t.key,p_archived:!t.archived}),t.archived?'Štítek obnoven.':'Štítek vyřazen.')});
  f.querySelectorAll('[data-tadd]').forEach(b=>b.onclick=()=>{const g=b.dataset.tadd,inp=f.querySelector(`[data-newtag="${CSS.escape(g)}"]`);if(!inp.value.trim())return;
   const n=(db.tags||[]).filter(t=>t.group_key===g).length+1;run(()=>rpc('rq_save_tag',{p_key:'',p_group_key:g,p_name:inp.value.trim(),p_sort:n}),'Štítek přidán.')});
  f.querySelector('#tgAddGroup').onclick=()=>{const v=f.querySelector('#tgNewGroup').value.trim();if(!v)return;run(()=>rpc('rq_save_tag_group',{p_key:'',p_name:v,p_sort:((db.tag_groups||[]).length+1)*10}),'Skupina založena.')};
 };
 d.classList.add('wide');d.addEventListener('close',()=>d.classList.remove('wide'),{once:true});
 draw();d.showModal();
}
/* Trvalé smazání dokumentu (jen nepublikovaný bez schváleného obsahu) včetně souborů v úložišti. */
function rqDeleteDocument(id){
 const d=getDoc(id);if(!d)return;
 const us=db.units.filter(u=>u.document_id===id),ids=new Set(us.map(u=>u.id));
 const nc=db.comments.filter(c=>ids.has(c.unit_id)).length,nr=db.relations.filter(r=>ids.has(r.source_id)||ids.has(r.target_id)).length;
 const f=$('#modalContent'),modal=$('#modal');f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Smazat dokument trvale</h2><p><strong>${esc(d.family)} · ${esc(d.language.toUpperCase())}</strong> – ${esc(d.title)}</p>
 <div class="notice warn">Smaže se ${us.length} částí, ${nc} komentářů, ${nr} vazeb (i z jiných dokumentů na tento), pojmy, historie, záznamy importu a soubory v úložišti. Nelze vrátit.</div>
 <label class="form-field"><span>Pro potvrzení opište název dokumentu</span><textarea class="textarea" id="delTitle" rows="2"></textarea></label>
 <div class="modal-actions"><button class="btn" type="button" id="delCancel">Zrušit</button><button class="btn danger" type="button" id="delGo" disabled>Smazat trvale</button></div>`;
 const t=f.querySelector('#delTitle'),go=f.querySelector('#delGo');
 t.oninput=()=>go.disabled=t.value.trim()!==d.title.trim();
 f.querySelector('#delCancel').onclick=()=>modal.close();
 go.onclick=async()=>{go.disabled=true;go.textContent='Mažu…';
  try{await rpc('rq_delete_document',{p_id:id,p_confirm_title:t.value});
   let nf=0;for(const b of ['originals','figures'])nf+=await rqRemoveFolder(b,id);
   modal.close();await refresh();setPage('home');toast(`Dokument smazán${nf?` (souborů v úložišti: ${nf})`:''}.`)}
  catch(e){toast(e.message,true);go.textContent='Smazat trvale';go.disabled=false}};
 modal.showModal();
}
async function rqRemoveFolder(bucket,prefix){
 const st=RQ.client.storage.from(bucket);let paths=[];
 const walk=async p=>{const {data,error}=await st.list(p,{limit:1000});if(error||!data)return;for(const x of data){const full=p+'/'+x.name;if(x.id)paths.push(full);else await walk(full)}};
 try{await walk(prefix);for(let i=0;i<paths.length;i+=100){await st.remove(paths.slice(i,i+100))}}catch(e){console.warn('Úložiště',e)}
 return paths.length;
}
let rqFocus=null;
function rqSetFocus(src){
 const u=getUnit(selected);if(!u)return;
 if(!src||(rqFocus&&rqFocus.src===src)){rqFocus=null}
 else{let item=null;
  if(src.startsWith('L')){const g=rqLinkAnchors(u).find(x=>x.rels.some(r=>'L'+r.id===src));if(g)item={id:g.id,kind:'link',label:`Odkaz „${esc(g.anchor_text.slice(0,70))}“`}}
  else{const c=db.comments.find(x=>x.id===src);if(c)item={id:c.id,kind:c.kind,label:`${esc(noteName[c.kind]||c.kind)} „${esc(c.anchor_text.slice(0,70))}“`}}
  if(!item){toast('Vybraný text se v ustanovení nenašel.',true);return}
  rqFocus={...item,src,unit:u.id}}
 const box=$('#reader'),y=box.scrollTop;renderReader();renderContext();if(!rqFocus)box.scrollTop=y;
 if(rqFocus&&!document.querySelector('#reader .rq-focus'))toast('Vybraný text se v ustanovení nenašel (kotva nenalezena).',true);
}
let rqOff=(()=>{try{const v=JSON.parse(localStorage.getItem('rq-studio-vrstvy-skryte'));if(Array.isArray(v))return new Set(v)}catch{}return new Set()})();
function rqOpenAnchor(c){
 if(c.kind==='link')return rqLinkOpen(c);
 if(c.kind!=='group')return dialogCommentDetail(c.id);
 const d=$('#modal'),f=$('#modalContent');f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Na tomto místě: ${c.items.length} položky</h2>${c.items.map((x,i)=>x.kind==='link'
  ?x.rels.map(r=>`<div class="boxnote"><div class="meta"><strong class="kind">${rqIco('link')} ${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(r.target_id))}</p><div class="actionrow"><button class="btn tiny" data-rd="${esc(r.id)}">Detail vazby</button></div></div>`).join('')
  :`<div class="boxnote${x.kind==='warning'?' warnnote':''}"><div class="meta"><strong class="kind">${rqIco(x.kind)} ${esc(noteName[x.kind]||x.kind)}</strong>${tag(x.status)}</div><p>${esc(x.body)}</p><div class="actionrow"><button class="btn tiny" data-cd="${esc(x.id)}">Detail / upravit</button></div></div>`).join('')}
  <div class="modal-actions"><button class="btn" type="button" id="grClose">Zavřít</button></div>`;
 f.querySelector('#grClose').onclick=()=>d.close();
 f.querySelectorAll('[data-rd]').forEach(b=>b.onclick=()=>{d.close();dialogRelationDetail(b.dataset.rd)});
 f.querySelectorAll('[data-cd]').forEach(b=>b.onclick=()=>{d.close();dialogCommentDetail(b.dataset.cd)});
 d.showModal();
}
function rqLinkAnchors(u){return RQNotes.linkGroups(db.relations.filter(r=>r.source_id===u.id&&!['rejected','archived'].includes(r.status)))}
function rqLinkAnchorsOld(u){
 const g=new Map();
 db.relations.filter(r=>r.source_id===u.id&&r.anchor_text&&!['rejected','archived'].includes(r.status)).forEach(r=>{
  const k=r.anchor_occurrence+'|'+r.anchor_text;if(!g.has(k))g.set(k,{id:'L'+r.id,kind:'link',anchor_text:r.anchor_text,anchor_occurrence:r.anchor_occurrence,status:r.status,rels:[]});g.get(k).rels.push(r)});
 return [...g.values()];
}
function rqLinkOpen(c){if(c.rels.length===1)return dialogRelationDetail(c.rels[0].id);
 const d=$('#modal'),f=$('#modalContent');f.onsubmit=e=>e.preventDefault();
 f.innerHTML=`<h2>Vazby z místa „${esc(c.anchor_text)}“</h2>${c.rels.map(r=>`<div class="boxnote"><div class="meta"><strong>${esc(relName[r.relation_type]||r.relation_type)}</strong>${tag(r.status)}</div><p>${esc(fullname(r.target_id))}</p><div class="actionrow"><button class="btn tiny" data-rd="${esc(r.id)}">Detail vazby</button></div></div>`).join('')}<div class="modal-actions"><button class="btn" type="button" id="lkClose">Zavřít</button></div>`;
 f.querySelector('#lkClose').onclick=()=>d.close();f.querySelectorAll('[data-rd]').forEach(b=>b.onclick=()=>{d.close();dialogRelationDetail(b.dataset.rd)});d.showModal()}
function rqOccurrence(body,text,pos){const n=x=>String(x).replace(/\s+/g,' ');const pre=n(String(body).slice(0,pos)),t=n(text).trim();let k=0,i=-1;while((i=pre.indexOf(t,i+1))>=0)k++;return k+1}
function rqTreeMarks(u){
 const cs=rqUnitComments(u);
 const rel=db.relations.some(r=>(r.source_id===u.id||r.target_id===u.id)&&r.status!=='rejected'&&r.status!=='archived');
 const m=[];
 if(cs.some(c=>c.kind==='key'))m.push(['key','Klíčová pasáž']);
 if(cs.some(c=>c.kind==='warning'))m.push(['warning','Na co si dát pozor']);
 if(cs.some(c=>!rqLayer(c.kind)&&c.kind!=='warning'))m.push(['comment','Komentář']);
 if(rel)m.push(['references','Vazba']);
 return m.length?`<span class="tree-marks">${m.map(([k,t])=>`<span class="m m-${k}" title="${t}">${rqIco(k)}</span>`).join('')}</span>`:'';
}
function rqAnchors(box,u){
 if(!window.RQNotes)return;
 const roots=[...box.querySelectorAll('[data-anchor-root]')];
 if(rqFocus&&rqFocus.unit!==u.id)rqFocus=null;
 const all=rqUnitComments(u).filter(c=>c.anchor_text).concat(rqLinkAnchors(u));
 const shown=all.filter(c=>!rqOff.has(RQNotes.layerOf(c.kind))||(rqFocus&&c.id===rqFocus.id)),ids=c=>c.rels?c.rels.map(r=>r.id):[c.id];
 let missing=shown,nTerms=0;
 if(window.RQTerms)roots.forEach(r=>nTerms+=RQTerms.mark(r,u));
 roots.forEach(r=>{missing=RQNotes.applyAnchors(r,missing,rqOpenAnchor)});
 const before=rqMissing.size,hiddenIds=new Set(all.filter(c=>!shown.includes(c)).flatMap(ids));
 rqMissing=new Set([...[...rqMissing].filter(id=>hiddenIds.has(id)),...missing.flatMap(ids)]);
 RQNotes.CSS_LAYERS.forEach(k=>box.classList.toggle('off-'+k,rqOff.has(k)));
 const cnt=k=>all.filter(c=>RQNotes.layerOf(c.kind)===k).length;
 const items=[...RQNotes.LAYERS,'note','warning','link'].map(k=>[k,cnt(k)]).concat([['term',nTerms]]).filter(x=>x[1]);
 if(items.length&&roots.length)roots[0].before(RQNotes.layerBar(items,rqOff,k=>{try{localStorage.setItem('rq-studio-vrstvy-skryte',JSON.stringify([...rqOff]))}catch{}
  if(RQNotes.CSS_LAYERS.includes(k))box.classList.toggle('off-'+k,rqOff.has(k));else{const y=box.scrollTop;renderReader();box.scrollTop=y}}));
 box.classList.remove('focus-mode');
 if(rqFocus&&roots.length){const el=RQNotes.applyFocus(box,rqFocus.id);roots[0].before(RQNotes.focusChip(rqFocus.kind,rqFocus.label,()=>rqSetFocus(null)));if(el)requestAnimationFrame(()=>el.scrollIntoView({block:'center',behavior:'smooth'}))}
 if(missing.length&&roots.length){const n=document.createElement('div');n.className='notice anchor-missing';n.innerHTML=`<strong>${missing.length}× poznámka nebo vazba bez kotvy.</strong> Vybraný text už v ustanovení není (pravděpodobně nové znění). Najdete je vpravo se štítkem „Kotva nenalezena“.`;roots[0].before(n)}
 if(before!==rqMissing.size)renderContext();
 roots.forEach(r=>r.addEventListener('mouseup',()=>setTimeout(()=>rqSelBar(r,u),0)));
}
function rqSelBar(root,u){
 let bar=document.getElementById('rqSelBar');
 if(!bar){bar=document.createElement('div');bar.id='rqSelBar';bar.className='rq-selbar';document.body.appendChild(bar);
  document.addEventListener('mousedown',e=>{if(!bar.contains(e.target))bar.style.display='none'});}
 const a=RQNotes.selectionAnchor(root);
 if(!a||u.editor_archived){bar.style.display='none';return}
 const rect=window.getSelection().getRangeAt(0).getBoundingClientRect();
 bar.innerHTML=`<span class="sb-group" title="Zvýraznit jako…"><button type="button" data-k="key" title="Klíčová pasáž"><i class="sw hl-key"></i>Klíčové</button><button type="button" data-k="duty" title="Povinnost (kdo musí co udělat)"><i class="sw hl-duty"></i>Povinnost</button><button type="button" data-k="deadline" title="Lhůta, počet, prahová hodnota"><i class="sw hl-deadline"></i>Lhůta</button><button type="button" data-k="exception" title="Výjimka nebo podmínka"><i class="sw hl-exception"></i>Výjimka</button></span><span class="sb-sep"></span><button type="button" data-k="explanation">${rqIco('comment')} Poznámka</button><button type="button" data-k="warning">${rqIco('warning')} Pozor</button><span class="sb-sep"></span><button type="button" data-k="link">${rqIco('references')} Propojit</button><button type="button" data-k="path">⇢ Do trasy</button>`;
 bar.style.display='flex';
 bar.style.top=(window.scrollY+rect.top-bar.offsetHeight-8)+'px';
 bar.style.left=Math.max(8,window.scrollX+rect.left+rect.width/2-bar.offsetWidth/2)+'px';
 bar.querySelectorAll('button').forEach(b=>b.onmousedown=e=>e.preventDefault());
 bar.querySelectorAll('button').forEach(b=>b.onclick=()=>{bar.style.display='none';const k=b.dataset.k;
  if(rqLayer(k)){const doc=getDoc(u.document_id);safeAct({action:'new_comment',unit_id:u.id,kind:k,language:doc?.language||'cs',body:'',author:'Redakce RegulaQuest',anchor_text:a.text,anchor_occurrence:a.occurrence});window.getSelection().removeAllRanges()}
  else if(k==='link'){window.getSelection().removeAllRanges();dialogRelation(u,null,a)}
  else if(k==='path'){window.getSelection().removeAllRanges();RQPaths.addStep(u,a)}
  else dialogComment(u,a,k)});
}
function init(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{if(b.dataset.page==='review')reviewDocFilter='all';if(b.dataset.page==='relations')relationDocFilter='all';if(b.dataset.page==='comments')commentDocFilter='all';setPage(b.dataset.page)});$('#filter').addEventListener('input',e=>{query=e.target.value;renderList()});$('#newDoc').onclick=$('#homeNewDoc').onclick=dialogDoc;$('#newUnit').onclick=dialogUnit;$('#refsBtn').onclick=()=>dialogReferences(null);$('#relatedBtn').onclick=()=>dialogRelated(null);$('#importBtn').onclick=$('#homeImport').onclick=dialogImport;$('#statDocsCard').onclick=()=>{selected=activeDocId;renderReader();renderContext()};
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
