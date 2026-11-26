'use strict';
/* RegulaQuest Studio – editor struktury, textu a tabulek. Zápis přes act() v editor.js. */
function rqModal(title,html,wide=true){
 const modal=$('#modal'),form=$('#modalContent');
 form.onsubmit=e=>e.preventDefault();
 form.innerHTML=`<h2>${esc(title)}</h2>${html}`;
 modal.classList.toggle('rq-wide-modal',wide);
 modal.addEventListener('close',()=>modal.classList.remove('rq-wide-modal'),{once:true});
 modal.showModal();
 return {modal,form,close:()=>modal.close()};
}
function rqFormatting(html){return `<div class="rq-format-actions"><span>Základní formátování výběru:</span>
 <button type="button" data-rq-cmd="bold" class="btn tiny" title="Tučné"><b>B</b></button>
 <button type="button" data-rq-cmd="italic" class="btn tiny" title="Kurzíva"><i>I</i></button>
 <button type="button" data-rq-cmd="underline" class="btn tiny" title="Podtržení"><u>U</u></button></div>${html}`}
function rqClone(x){return JSON.parse(JSON.stringify(x))}
function rqBlankCell(){return {text:'',header:false,align:'left',colspan:1,rowspan:1}}
function rqBlockFallback(u){return u.content_blocks&&u.content_blocks.length?rqClone(u.content_blocks):[{type:'text',html:esc(u.body||'').replace(/\n/g,'<br>')}]}
function rqRenderBlocks(blocks){
 return `<div class="rq-rich-view">${(blocks||[]).map(b=>b.type==='text'?`<div class="rq-rich-text">${b.html||''}</div>`:
 `<div class="rq-table-display">${b.caption?`<div class="rq-table-title">${esc(b.caption)}</div>`:''}<div class="rq-table-wrap"><table>${b.rows.map(row=>`<tr>${row.map(c=>`<${c.header?'th':'td'} rowspan="${Number(c.rowspan)||1}" colspan="${Number(c.colspan)||1}" style="text-align:${c.align||'left'}">${esc(c.text).replace(/\n/g,'<br>')}</${c.header?'th':'td'}>`).join('')}</tr>`).join('')}</table></div>${b.notes?`<div class="rq-table-notes">${esc(b.notes)}</div>`:''}</div>`).join('')}</div>`;
}
function rqImpactSummary(ids){
 const idset=new Set(ids);let links=db.relations.filter(x=>x.status==='approved'&&(idset.has(x.source_id)||idset.has(x.target_id))).length;
 let comments=db.comments.filter(x=>x.status==='approved'&&idset.has(x.unit_id)).length;
 return `${links} schválených vazeb a ${comments} schválených komentářů se vrátí do kontroly. Všechny dotčené texty budou vyžadovat nové ověření.`;
}
function rqRunEdit(payload,close,after){
 return act(payload).then(res=>{close();if(after)after(res);return res}).catch(err=>toast(err.message,true));
}
function rqHistory(u){
 const labels={edit_content:'Úprava obsahu a tabulek',edit_structure:'Úprava struktury',split_unit:'Rozdělení textu',created_by_split:'Nová část oddělením',move_text:'Přesun textu',merge_unit:'Sloučení částí',legacy_edit_text:'Starší úprava textu',import_text:'Dávkový import',created:'Vytvoření části',verified:'Ověření textu',edit_text:'Úprava textu',ancestor_structure_changed:'Změna nadřazené části'};
 const html=`<p class="rq-explain">Historie se ukládá v databázi u každé úpravy, včetně toho, kdo ji provedl.</p>
 <div id="rqHistoryItems">Načítám historii…</div><div id="rqHistoryDetail"></div>
 <div class="modal-actions"><button class="btn" type="button" id="rqHistoryClose">Zavřít</button></div>`;
 const {form,close}=rqModal('Historie změn · '+unitPath(u.id),html,true);
 form.querySelector('#rqHistoryClose').onclick=close;
 const list=form.querySelector('#rqHistoryItems');
 const who=id=>{const p=(db.people||[]).find(x=>x.user_id===id);return p?(p.display_name||p.username):''};
 const history=(db.unit_edit_history||[]).filter(h=>h.unit_id===u.id);
 list.innerHTML=history.length?history.map(h=>`<div class="rq-history-item"><strong>${esc(labels[h.event]||h.event)}</strong><small>${esc(new Date(h.created_at).toLocaleString('cs-CZ'))}${who(h.actor)?' · '+esc(who(h.actor)):''}</small><div>${esc(h.reason)}</div><button class="btn tiny" type="button" data-rq-history="${h.id}">Porovnat stav před / po</button></div>`).join(''):'<div class="notice">U této pasáže zatím není zaznamenaná úprava.</div>';
 list.querySelectorAll('[data-rq-history]').forEach(btn=>btn.onclick=async()=>{
  const detail=form.querySelector('#rqHistoryDetail');detail.textContent='Načítám…';
  try{const h=await rpc('rq_edit_history_item',{p_id:Number(btn.dataset.rqHistory)});
   const b=h.before_json||{},a=h.after_json||{};
   const pretty=x=>typeof x==='string'?x:JSON.stringify(x,null,2);
   const before=b.unit||b,after=a.unit||a;
   detail.innerHTML=`<div class="rq-history-compare"><div><h3>Před změnou</h3><pre>${esc(pretty(before))}</pre></div><div><h3>Po změně</h3><pre>${esc(pretty(after))}</pre></div></div>`;
  }catch(err){detail.textContent=err.message}
 });
}
function rqStructureEditor(u){
 const all=db.units.filter(v=>v.document_id===u.document_id&&!v.editor_archived&&v.id!==u.id);
 const kinds=[['article','Článek'],['paragraph','Odstavec'],['annex','Příloha'],['rule','Pravidlo'],['section','Kapitola / pasáž'],['chapter','Kapitola'],['part','Část'],['point','Bod'],['other','Jiné']];
 const html=`<div class="rq-editor-columns"><div><p>Upravujeme identitu a umístění části dokumentu. <strong>ID ustanovení zůstane zachované.</strong> Tato změna může ovlivnit význam již vytvořených vazeb.</p>
 <label class="form-field"><span>Označení</span><input class="input" id="rqLabel" maxlength="240" value="${esc(u.label)}"></label>
 <label class="form-field"><span>Nadpis</span><input class="input" id="rqHeading" value="${esc(u.heading)}"></label>
 <label class="form-field"><span>Typ části</span><select class="select" id="rqKind">${kinds.map(([v,l])=>`<option value="${v}" ${u.kind===v?'selected':''}>${l}</option>`).join('')}</select></label>
 <label class="form-field"><span>Nadřazená část</span><select class="select" id="rqParent"><option value="">Kořen dokumentu</option>${all.map(v=>`<option value="${esc(v.id)}" ${u.parent_id===v.id?'selected':''}>${esc(unitPath(v.id).slice(0,160))}</option>`).join('')}</select></label>
 <label class="form-field"><span>Pořadí v dokumentu</span><input class="input" id="rqOrder" type="number" step="1" value="${Number(u.sort_order)}"></label>
 <label class="form-field"><span>Lokátor v originálu</span><input class="input" id="rqLocator" value="${esc(u.locator)}"></label>
 <label class="form-field"><span>Důvod úpravy</span><input class="input" id="rqReason" value="Oprava hierarchie / označení"></label>
 </div><aside class="rq-editor-tip"><strong>Dotčené vazby a komentáře</strong><p>${esc(rqImpactSummary([u.id]))}</p><p>Po změně bude text případně znovu ověřen. Systém nerozváže ani nepřepíše původní ID.</p><small>Přesun pod sebe či vlastního potomka je zakázán.</small></aside></div>
 <div class="modal-actions"><button class="btn" id="rqCancel" type="button">Zrušit</button><button class="btn accent" id="rqSave" type="button">Uložit změnu struktury</button></div>`;
 const {form,close}=rqModal('Struktura · '+unitPath(u.id),html,true);form.querySelector('#rqCancel').onclick=close;
 form.querySelector('#rqSave').onclick=()=>{
   const value=id=>form.querySelector(id).value;
   if(!confirm(`Upravit strukturu ${u.label}?\n\n${rqImpactSummary([u.id])}`))return;
   rqRunEdit({action:'edit_unit_structure',unit_id:u.id,expected_updated_at:u.updated_at,label:value('#rqLabel'),heading:value('#rqHeading'),kind:value('#rqKind'),
    parent_id:value('#rqParent'),locator:value('#rqLocator'),sort_order:Number(value('#rqOrder')),reason:value('#rqReason')},close);
 };
}
function rqSplit(u){
 const html=`<p>Postav kurzor do textu na místo rozdělení. První část zůstane pod původním ID, druhá vznikne jako samostatné ustanovení. Pokud už byl text formátován, rozdělení převede obě části na prostý text.</p>
 <div class="rq-editor-columns"><div><label class="form-field"><span>Doslovný text (klikněte na hranici rozdělení)</span><textarea class="textarea rq-split-text" id="rqSplitText" spellcheck="false" readonly>${esc(u.body)}</textarea></label>
 <div class="rq-split-preview" id="rqSplitPreview">Vyberte místo rozdělení.</div></div><div>
 <label class="form-field"><span>Označení nové části</span><input class="input" id="rqNewLabel" placeholder="Např. Rule 3"></label>
 <label class="form-field"><span>Nadpis nové části</span><input class="input" id="rqNewHeading"></label>
 <label class="form-field"><span>Lokátor nové části</span><input class="input" id="rqNewLocator" placeholder="PDF str. 31"></label>
 <label class="form-field"><span>Důvod změny</span><input class="input" id="rqSplitReason" value="Oprava hranice importu"></label>
 <div class="notice">${esc(rqImpactSummary([u.id]))}</div></div></div>
 <div class="modal-actions"><button class="btn" id="rqCancel" type="button">Zrušit</button><button class="btn accent" id="rqSplitSave" type="button" disabled>Rozdělit text</button></div>`;
 const {form,close}=rqModal('Rozdělit ustanovení · '+u.label,html,true);
 const t=form.querySelector('#rqSplitText'),preview=form.querySelector('#rqSplitPreview'),button=form.querySelector('#rqSplitSave');let index=0;
 const cursor=()=>{index=t.selectionStart;preview.textContent=`Hranice na znaku ${index} z ${u.body.length}. První část: ${index} znaků, druhá: ${u.body.length-index} znaků.`;button.disabled=!(index>0&&index<u.body.length)};
 ['click','keyup','select'].forEach(e=>t.addEventListener(e,cursor));form.querySelector('#rqCancel').onclick=close;
 button.onclick=()=>{if(!confirm(`Rozdělit ${u.label} a vytvořit ${form.querySelector('#rqNewLabel').value}?\n\n${rqImpactSummary([u.id])}`))return;
 rqRunEdit({action:'split_unit',unit_id:u.id,expected_updated_at:u.updated_at,index,new_label:form.querySelector('#rqNewLabel').value,new_heading:form.querySelector('#rqNewHeading').value,
 new_locator:form.querySelector('#rqNewLocator').value,reason:form.querySelector('#rqSplitReason').value,confirm_flatten_rich:!!u.content_blocks},close,res=>{if(res.editor?.created_unit_id)openUnit(res.editor.created_unit_id)});};
}
function rqMoveText(u,merge=false){
 const targets=db.units.filter(x=>x.document_id===u.document_id&&x.id!==u.id&&!x.editor_archived);
 const html=`<p>${merge?'Celý text zdrojové části se přidá na konec cílové části. Zdrojové ustanovení zůstane v historii, ale bude skryté z osnovy.':'Označ myší text, který patří do jiné části. Přesune se doslovně, nikoli jako kopie.'} <strong>Všechny dotčené pasáže budou vyžadovat opětovné ověření.</strong></p>
 <div class="rq-editor-columns"><div>${merge?`<div class="rq-plain-preview">${esc(u.body.slice(0,8000))}</div>`:
 `<label class="form-field"><span>Označ úryvek k přesunu</span><textarea id="rqMoveSource" class="textarea rq-split-text" readonly spellcheck="false">${esc(u.body)}</textarea></label><div class="rq-split-preview" id="rqMoveSelection">Zatím není nic vybráno.</div>`}</div>
 <div><label class="form-field"><span>Cílové ustanovení</span><select class="select" id="rqMoveTarget"><option value="">Vyberte část…</option>${targets.map(x=>`<option value="${esc(x.id)}">${esc(unitPath(x.id).slice(0,120))}</option>`).join('')}</select></label>
 <label class="form-field"><span>Důvod změny</span><input class="input" id="rqMoveReason" value="Oprava chybného přiřazení textu při importu"></label>
 <div class="notice" id="rqMoveImpact">${esc(rqImpactSummary([u.id]))}</div></div></div>
 <div class="modal-actions"><button class="btn" id="rqCancel" type="button">Zrušit</button><button class="btn accent" id="rqMoveSave" type="button">${merge?'Sloučit ustanovení':'Přesunout označený text'}</button></div>`;
 const {form,close}=rqModal((merge?'Sloučit':'Přesunout text z')+' · '+u.label,html,true);let fragment='';const field=form.querySelector('#rqMoveTarget');
 if(!merge){const t=form.querySelector('#rqMoveSource');const choose=()=>{fragment=t.value.slice(t.selectionStart,t.selectionEnd);form.querySelector('#rqMoveSelection').textContent=fragment?`Vybráno ${fragment.length} znaků: ${fragment.slice(0,180)}`:'Označte souvislou část textu.'};['select','mouseup','keyup'].forEach(e=>t.addEventListener(e,choose));}
 field.onchange=()=>{form.querySelector('#rqMoveImpact').textContent=rqImpactSummary([u.id,field.value]);};form.querySelector('#rqCancel').onclick=close;
 form.querySelector('#rqMoveSave').onclick=()=>{
   const target=getUnit(field.value);if(!target){toast('Vyber cílové ustanovení',true);return}
   if(!merge&&!fragment){toast('Označ text k přesunu',true);return}
   if(!confirm(`${merge?'Sloučit celé ustanovení':'Přesunout označený text'} do ${unitPath(target.id)}?\n\n${rqImpactSummary([u.id,target.id])}\n\nPokud mají pasáže základní formátování, převedou se na prostý text. Tabulky tato operace z bezpečnostních důvodů nepřesouvá. Po sloučení zdrojové ID nezanikne a jeho vazby se automaticky nepřesměrují.`))return;
   const payload={action:merge?'merge_units':'move_unit_text',unit_id:u.id,expected_updated_at:u.updated_at,target_id:target.id,target_updated_at:target.updated_at,confirm_flatten_rich:!!(u.content_blocks||target.content_blocks),
    reason:form.querySelector('#rqMoveReason').value};if(!merge)payload.fragment=fragment;
   rqRunEdit(payload,close,()=>openUnit(target.id));
 };
}
function rqPositions(table){
 const grid=[],pos=new Map();let maxc=0;
 (table.rows||[]).forEach((row,r)=>{grid[r]=grid[r]||[];let col=0;
  row.forEach((cell,i)=>{while(grid[r][col])col++;
   pos.set(cell,{r,c:col,ri:r,ci:i});
   for(let rr=r;rr<r+(cell.rowspan||1);rr++){grid[rr]=grid[rr]||[];for(let cc=col;cc<col+(cell.colspan||1);cc++)grid[rr][cc]=cell;}
   col+=cell.colspan||1;maxc=Math.max(maxc,col);
  });
 });return {grid,pos,maxc};
}
function rqMergeTableCell(table,sel,dir){
 const cell=table.rows[sel.r]?.[sel.c];if(!cell)return false;
 const {grid,pos}=rqPositions(table),p=pos.get(cell);
 if(!p)return false;
 const next=dir==='right'?grid[p.r]?.[p.c+cell.colspan]:grid[p.r+cell.rowspan]?.[p.c];
 const n=pos.get(next);if(!next||!n||cell===next)return false;
 if(dir==='right'&&(n.r!==p.r||next.rowspan!==cell.rowspan))return false;
 if(dir==='down'&&(n.c!==p.c||next.colspan!==cell.colspan))return false;
 cell.text=[cell.text,next.text].filter(Boolean).join('\n');
 if(dir==='right')cell.colspan+=next.colspan;else cell.rowspan+=next.rowspan;
 table.rows[n.ri].splice(n.ci,1);return true;
}
function rqUnmergeCell(table,sel){
 const cell=table.rows[sel.r]?.[sel.c];if(!cell||((cell.rowspan||1)===1&&(cell.colspan||1)===1))return false;
 const {pos}=rqPositions(table),p=pos.get(cell),cs=cell.colspan||1,rs=cell.rowspan||1;
 cell.colspan=1;cell.rowspan=1;
 const added=[];for(let r=p.r;r<p.r+rs;r++)for(let c=p.c;c<p.c+cs;c++)if(!(r===p.r&&c===p.c))added.push({r,c,cell:rqBlankCell()});
 // Keep unmodified merged cells in their original coordinates.
 const all=[];table.rows.forEach(row=>row.forEach(c=>{let location=pos.get(c);all.push({r:location.r,c:location.c,cell:c})}));
 all.push(...added);
 table.rows=table.rows.map((_,r)=>all.filter(x=>x.r===r).sort((a,b)=>a.c-b.c).map(x=>x.cell));
 return true;
}
function rqHasMerges(table){return table.rows.some(row=>row.some(c=>(c.colspan||1)>1||(c.rowspan||1)>1))}
function rqTableGrid(table,blockIndex){
 return `<div class="rq-table-editor" data-rq-table="${blockIndex}"><label class="form-field"><span>Název / popisek tabulky</span><input class="input" data-rq-caption value="${esc(table.caption||'')}"></label>
 <div class="rq-table-wrap"><table class="rq-edit-table">${table.rows.map((row,r)=>`<tr>${row.map((c,i)=>`<${c.header?'th':'td'} colspan="${Number(c.colspan)||1}" rowspan="${Number(c.rowspan)||1}" style="text-align:${c.align||'left'}" data-rq-pos="${r}:${i}"><div contenteditable="true" data-rq-cell="${r}:${i}" spellcheck="false">${esc(c.text).replace(/\n/g,'<br>')}</div></${c.header?'th':'td'}>`).join('')}</tr>`).join('')}</table></div>
 <label class="form-field"><span>Poznámka pod tabulkou</span><textarea class="textarea rq-notes" data-rq-notes>${esc(table.notes||'')}</textarea></label></div>`;
}
function rqContentEditor(u){
 let blocks=rqBlockFallback(u),selection=null;const pdfFile=(db.source_files||[]).find(f=>f.document_id===u.document_id&&f.storage_path&&f.filename.toLowerCase().endsWith('.pdf')),pdf=!!pdfFile;
 const firstPdfPage=Number((String(u.locator).match(/PDF str\.\s*(\d+)/)||[])[1]||1);
 const sourceUrl=pdf?'#':(getDoc(u.document_id)?.url||'');
 const sourcePanel=pdf?`<iframe class="rq-original-frame" title="Originální dokument PDF" src="${esc(sourceUrl)}"></iframe>`:
 `<div class="rq-original-text"><p><strong>Původní zdroj</strong></p><p>U HTML a právních předpisů otevři oficiální zdroj pro srovnání. Importované znění najdeš v textovém editoru.</p><a class="btn" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Otevřít oficiální zdroj ↗</a></div>`;
 const shell=`<p class="rq-explain"><strong>Pracovní rekonstrukce obsahu.</strong> Úpravy textu, tabulek i struktury vyžadují nové ověření proti originálu. Původní importovaný soubor zůstává uložen.</p>
 <div class="rq-editor-columns rq-content-columns"><div class="rq-work-area">${rqFormatting('')}<div class="rq-block-actions"><button type="button" class="btn tiny" id="rqAddText">+ Textový blok</button><button type="button" class="btn tiny" id="rqAddTable">+ Tabulka</button><button type="button" class="btn tiny" id="rqPasteTable">Vložit tabulku z Excelu</button><button type="button" class="btn tiny" id="rqAddRow">+ Řádek</button><button type="button" class="btn tiny" id="rqAddColumn">+ Sloupec</button><button type="button" class="btn tiny" id="rqRemoveRow">− Řádek</button><button type="button" class="btn tiny" id="rqRemoveColumn">− Sloupec</button></div>
 <div class="rq-cell-tools"><strong>Vybraná buňka:</strong> <span id="rqCellLabel">žádná</span>
 <button type="button" class="btn tiny" id="rqHeader">Záhlaví</button><button type="button" class="btn tiny" id="rqAlign">Zarovnání</button>
 <button type="button" class="btn tiny" id="rqMergeRight">Sloučit →</button><button type="button" class="btn tiny" id="rqMergeDown">Sloučit ↓</button>
 <button type="button" class="btn tiny" id="rqUnmerge">Rozdělit buňku</button></div>
 <div class="rq-tsv-import hidden" id="rqTSVPanel"><label class="form-field"><span>Vložit zkopírované buňky (tabulátory mezi sloupci, Enter mezi řádky)</span><textarea class="textarea" id="rqTSVText" placeholder="Třída [TAB] Kritérium [TAB] Příklady..."></textarea></label><label><input type="checkbox" id="rqTSVHeader" checked> První řádek je záhlaví</label> <button type="button" class="btn tiny accent" id="rqTSVInsert">Vložit tabulku</button></div>
 <div id="rqBlocks"></div><label class="form-field"><span>Důvod redakční úpravy</span><input class="input" id="rqContentReason" value="Oprava textu / tabulek proti originálu"></label></div>
 <div class="rq-source-area"><div class="rq-source-top"><strong>Originál k porovnání</strong><a class="btn tiny" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Otevřít samostatně ↗</a></div>${sourcePanel}</div></div>
 <div class="rq-explain">Po uložení: ${esc(rqImpactSummary([u.id]))} Změna bude zapsána do historie.</div>
 <div class="modal-actions"><button type="button" class="btn" id="rqCancel">Zrušit</button><button type="button" class="btn accent" id="rqSaveContent">Uložit obsah k ověření</button></div>`;
 const {form,close}=rqModal('Editor obsahu a tabulek · '+unitPath(u.id),shell,true);
 if(pdf)RQ.client.storage.from('originals').createSignedUrl(pdfFile.storage_path,3600).then(({data})=>{if(!data)return;const url=data.signedUrl+'#page='+firstPdfPage;
  form.querySelectorAll('.rq-original-frame').forEach(f=>f.src=url);form.querySelectorAll('.rq-source-top a').forEach(a=>a.href=url)});
 const host=form.querySelector('#rqBlocks');
 function readEdits(){
  host.querySelectorAll('[data-rq-block]').forEach(el=>{
   const i=Number(el.dataset.rqBlock),block=blocks[i];if(!block)return;
   if(block.type==='text'){block.html=(el.querySelector('[data-rq-editable-text]')?.innerHTML||'').replace(/\r\n?|\n/g,'<br>');}
   if(block.type==='table'){
    block.caption=el.querySelector('[data-rq-caption]')?.value||'';block.notes=el.querySelector('[data-rq-notes]')?.value||'';
    for(const [r,row] of block.rows.entries())for(const [j,cell] of row.entries()){
     const input=el.querySelector(`[data-rq-cell="${r}:${j}"]`);
     if(input)cell.text=input.innerText.replace(/\r/g,'').replace(/\n{3,}/g,'\n\n');
    }
   }
  });
 }
 function renderBlocks(){
  host.innerHTML=blocks.map((b,i)=>`<section class="rq-block" data-rq-block="${i}"><div class="rq-block-head"><strong>${b.type==='text'?'Textový blok':'Tabulka'} ${i+1}</strong><div>
   <button type="button" class="btn tiny" data-rq-up="${i}">↑</button><button type="button" class="btn tiny" data-rq-down="${i}">↓</button>
   <button type="button" class="btn tiny danger" data-rq-remove="${i}">Odstranit blok</button></div></div>
   ${b.type==='text'?`<div class="rq-rich-editable" contenteditable="true" spellcheck="false" data-rq-editable-text>${b.html||''}</div>`:rqTableGrid(b,i)}</section>`).join('');
  host.querySelectorAll('[data-rq-remove]').forEach(el=>el.onclick=()=>{readEdits();blocks.splice(Number(el.dataset.rqRemove),1);selection=null;renderBlocks()});
  host.querySelectorAll('[data-rq-up],[data-rq-down]').forEach(el=>el.onclick=()=>{
   readEdits();let i=Number(el.dataset.rqUp??el.dataset.rqDown),j=i+(el.hasAttribute('data-rq-up')?-1:1);
   if(j>=0&&j<blocks.length)[blocks[i],blocks[j]]=[blocks[j],blocks[i]];selection=null;renderBlocks();
  });
  host.querySelectorAll('[data-rq-pos]').forEach(td=>td.addEventListener('click',()=>{
   let blockEl=td.closest('[data-rq-block]'),bi=Number(blockEl.dataset.rqBlock),[r,c]=td.dataset.rqPos.split(':').map(Number);selection={bi,r,c};
   host.querySelectorAll('[data-rq-pos]').forEach(x=>x.classList.remove('rq-selected-cell'));
   td.classList.add('rq-selected-cell');form.querySelector('#rqCellLabel').textContent=`Tabulka ${bi+1}, řádek ${r+1}, buňka ${c+1}`;
  }));
  host.querySelectorAll('[contenteditable]').forEach(el=>el.addEventListener('paste',e=>{
   e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));
  }));
 }
 function mutateTable(cb){if(!selection||blocks[selection.bi]?.type!=='table'){toast('Nejprve klikni na buňku tabulky',true);return}
  readEdits();const tbl=blocks[selection.bi];let result=cb(tbl,selection);
  if(result===false){toast('Vybrané buňky nelze takto sloučit. Musí sousedit a mít stejné rozpětí.',true);return}
  renderBlocks();selection=null;form.querySelector('#rqCellLabel').textContent='žádná';
 }
 form.querySelectorAll('[data-rq-cmd]').forEach(el=>{el.addEventListener('mousedown',e=>e.preventDefault());el.onclick=()=>document.execCommand(el.dataset.rqCmd,false,null)});
 form.querySelector('#rqAddText').onclick=()=>{readEdits();blocks.push({type:'text',html:''});selection=null;renderBlocks()};
 form.querySelector('#rqAddTable').onclick=()=>{readEdits();blocks.push({type:'table',caption:'',notes:'',rows:[[rqBlankCell(),rqBlankCell(),rqBlankCell()],[rqBlankCell(),rqBlankCell(),rqBlankCell()]]});selection=null;renderBlocks()};
 form.querySelector('#rqPasteTable').onclick=()=>form.querySelector('#rqTSVPanel').classList.toggle('hidden');
 form.querySelector('#rqTSVInsert').onclick=()=>{
  const txt=form.querySelector('#rqTSVText').value.trim();if(!txt){toast('Vlož zkopírované buňky tabulky',true);return}
  const rows=txt.split(/\r?\n/).map(line=>line.split('\t'));
  const width=Math.max(...rows.map(r=>r.length));
  if(rows.length>80||width>35){toast('Maximálně 80 řádků a 35 sloupců',true);return}
  const header=form.querySelector('#rqTSVHeader').checked;
  readEdits();blocks.push({type:'table',caption:'',notes:'',rows:rows.map((row,r)=>Array.from({length:width},(_,col)=>({...rqBlankCell(),text:row[col]||'',header:header&&r===0})))});
  selection=null;renderBlocks();form.querySelector('#rqTSVPanel').classList.add('hidden');form.querySelector('#rqTSVText').value='';
 };
 form.querySelector('#rqAddRow').onclick=()=>mutateTable(t=>{if(rqHasMerges(t)){toast('Pro přidání řádku nejprve zrušte sloučení buněk',true);return false}t.rows.push(t.rows[0].map(()=>rqBlankCell()))});
 form.querySelector('#rqAddColumn').onclick=()=>mutateTable(t=>{if(rqHasMerges(t)){toast('Pro přidání sloupce nejprve zrušte sloučení buněk',true);return false}t.rows.forEach(row=>row.push(rqBlankCell()))});
 form.querySelector('#rqRemoveRow').onclick=()=>mutateTable((t,s)=>{if(rqHasMerges(t)||t.rows.length<=1){toast('Řádek lze odebrat jen z tabulky bez sloučených buněk a nejméně se dvěma řádky',true);return false}t.rows.splice(s.r,1)});
 form.querySelector('#rqRemoveColumn').onclick=()=>mutateTable((t,s)=>{if(rqHasMerges(t)||t.rows[0].length<=1){toast('Sloupec lze odebrat jen z tabulky bez sloučených buněk a nejméně se dvěma sloupci',true);return false}t.rows.forEach(row=>row.splice(s.c,1))});
 form.querySelector('#rqHeader').onclick=()=>mutateTable((t,s)=>{t.rows[s.r][s.c].header=!t.rows[s.r][s.c].header});
 form.querySelector('#rqAlign').onclick=()=>mutateTable((t,s)=>{const c=t.rows[s.r][s.c];c.align={left:'center',center:'right',right:'left'}[c.align||'left']});
 form.querySelector('#rqMergeRight').onclick=()=>mutateTable((t,s)=>rqMergeTableCell(t,s,'right'));
 form.querySelector('#rqMergeDown').onclick=()=>mutateTable((t,s)=>rqMergeTableCell(t,s,'down'));
 form.querySelector('#rqUnmerge').onclick=()=>mutateTable((t,s)=>rqUnmergeCell(t,s));
 form.querySelector('#rqCancel').onclick=close;
 form.querySelector('#rqSaveContent').onclick=()=>{
  readEdits();const tables=blocks.filter(b=>b.type==='table').length;
  if(!confirm(`Uložit nové znění a ${tables} tabulek pro ${u.label}?\n\n${rqImpactSummary([u.id])}\n\nPřed zveřejněním bude vyžadována kontrola originálu.`))return;
  rqRunEdit({action:'save_unit_content',unit_id:u.id,expected_updated_at:u.updated_at,blocks,reason:form.querySelector('#rqContentReason').value},close);
 };
 renderBlocks();
}
