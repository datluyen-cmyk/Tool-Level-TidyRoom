const {Playtest, sorted, check, fitsBackground, itemBounds, stackLayers, itemAt, ROUND} = TidyGame;

const $=id=>document.getElementById(id), canvas=$('board'), ctx=canvas.getContext('2d');
const create=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
const btn=(label,fn,title)=>{const b=create('button',label);b.onclick=fn;if(title)b.title=title;return b};
const option=(value,label)=>{const o=create('option',label);o.value=value;return o};
const clone=obj=>structuredClone(obj);
const inPalette=asset=>asset.palette || asset.tidy57Addon;
const normalize=s=>s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replaceAll('đ','d');
const slug=s=>normalize(s).replace(/[^a-z0-9_-]+/g,'-').replace(/^[-_]+|[-_]+$/g,'').slice(0,65)||'level';
const assetURL=Offline.artURL;
const say=s=>{$('notice').textContent=s};
const boundaryMessage='Đặt toàn bộ món đồ trong khung ảnh nền.';
let catalog,level=null,assetLookup=new Map(),groupNames=new Map(),batch=null,batchPos=-1,pending=null,game=null,playingLoad=false;
let selection=new Set(),clipboard=[],pasteOffset=0,marqueeMode=false,showPortrait=false;
let history=[],future=[],kind='items',assetPage=0,showGrid=true,showBoxes=true,inspector='layer',space=false,drag=null,flash=null;
let paletteGesture=null,ghost=null,idSerial=0;
let assetTab='itemsTab',gddItemPaths=null,gddCatalogError='';
let assetLevelPack=null,assetLevelError='';
let layerView=null,editorOrder=null,selectionBounds=null;
let draggedLayer=null,layerDrop=null;
const inspectorTabs=['layer','box','generate','json'];
let templates={},templateDrawing=null,scatterGroups=new Set(),generationBusy=false;
let variantJob=null,variantPack=null,variantPreview=null;
let fileTargets={},batchFileTargets=[],fileSaveBusy=false;
const jsonFileType={description:'JSON level',accept:{'application/json':['.json']}};
let botJob=null,botReplay=null;
let playHover=null;
let playMotion=null;
let hintEnabled=true,hintTimer=null,hintItem=null;
let boxPreviewLevel=null,selectedBox=null;
let view={zoom:1,dx:0,dy:0}, dims={w:0,h:0,s:1,cx:0,cy:0},savedTimer,frame=0,busyImport=false;
const images=new Map(),masks=new Map();
const boundsOnly=new Map();
const ready=()=>!!level;

function getImage(key){
  if(!images.has(key)){const img=new Image();img.onload=schedule;img.src=assetURL(key);images.set(key,img)}return images.get(key);
}
function thumb(key,alt=''){const i=create('img');i.src=assetURL(key);i.alt=alt;i.loading='lazy';return i}
async function getMask(key){
  if(!masks.has(key))masks.set(key,Offline.shape(key));
  return masks.get(key);
}
function warmMasks(){for(const key of new Set(level.items.map(x=>x.asset)))getMask(key).catch(()=>{});}

const openStore=new Promise((resolve,reject)=>{const q=indexedDB.open('tidy-html5-level-tool',1);q.onupgradeneeded=()=>q.result.createObjectStore('draft');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
async function readDraft(key){const db=await openStore;return new Promise((resolve,reject)=>{const q=db.transaction('draft').objectStore('draft').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});}
function saveSoon(){
  clearTimeout(savedTimer);
  savedTimer=setTimeout(async()=>{
    try{
      const db=await openStore;
      if(drag||paletteGesture?.moved){saveSoon();return;}
      const tx=db.transaction('draft','readwrite');
      tx.objectStore('draft').put({level:variantPreview?.editor.level??level,batch,batchPos,fileTargets,batchFileTargets},'current');
    }catch{}
  },350);
}
function download(name,doc,indent){const file=new Blob([Offline.formatJson(doc,indent)],{type:'application/json'}),url=URL.createObjectURL(file),a=create('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function newLevel(){
  const bg=catalog.backgrounds.find(b=>b.palette&&b.id==='1')||catalog.backgrounds.find(b=>b.palette);
  return {schema:'tidy-level-tool/1',key:'man-moi',name:'Màn mới',rule:'direct',background:{asset:bg.path,width:bg.w,height:bg.h,cameraX:0},items:[],boxes:[]};
}
function openLevel(doc,position=-1,targets={},persist=true){
  endDrag(null,true);
  fileTargets=position<0?targets:(batchFileTargets[position]??={});
  level=doc;batchPos=position;selection=new Set();pending=null;paletteGesture=null;ghost=null;game=null;history=[];future=[];drag=null;flash=null;view={zoom:1,dx:0,dy:0};
  botReplay=null;selectedBox=null;
  templateDrawing=null;scatterGroups.clear();
  $('title').value=level.name;warmMasks();render();if(persist)saveSoon();
}
function patch(fn){
  if(!canEdit()||drag)return;
  const before=snapshot();fn();
  const changed=Object.keys(level).some(key=>key==='items'||key==='boxes'
    ? JSON.stringify(before.level[key])!==JSON.stringify(level[key])
    : before.level[key]!==level[key]);
  if(!changed)return;
  stash(before);render();saveSoon();
}
function snapshot(){
  return {level:{...level,items:level.items.map(i=>({...i})),boxes:level.boxes.map(b=>({...b}))},selection};
}
function canEdit(){return level&&!game&&!playingLoad&&!variantPreview;}
function stash(before){history.push(before);if(history.length>75)history.shift();future=[]}
function rewind(back){
  if(!canEdit()||drag)return;const src=back?history:future,dest=back?future:history;if(!src.length)return;
  dest.push(snapshot());({level,selection}=src.pop());$('title').value=level.name;
  templateDrawing=null;warmMasks();render();saveSoon();
}
function setSelection(ids){
  selection=new Set(ids);selectionBounds=null;renderPanel();schedule();
}
function setMarquee(active){
  marqueeMode=active;
  canvas.classList.toggle('marquee-ready',active);
  if(active)cancelPlacement();
}
function selectItem(uid,multi){
  const next=multi?new Set(selection):new Set();
  if(multi&&next.has(uid))next.delete(uid);else next.add(uid);
  setSelection(next);
}
const chosen=()=>level.items.filter(i=>selection.has(i.uid));
const item=()=>selection.size===1?level?.items.find(i=>selection.has(i.uid)):null;
const drawOrder=()=>editorOrder??(editorOrder=sorted(level.items));
function syncBatch(){if(!variantPreview&&batch&&batchPos>=0)batch.levels[batchPos]=level;}
function newItemId(){
  let id;
  do{ id=globalThis.crypto?.randomUUID?.()??`local-${Date.now().toString(36)}-${++idSerial}`; }
  while(level.items.some(it=>it.uid===id));
  return id;
}

function renderPlacement(){
  const drawing=templateDrawing&&inspector==='generate'&&!game;
  const active=!drawing&&pending&&!game&&kind==='items';
  $('modeTip').hidden=!active&&!drawing;
  $('placeCenter').hidden=!active;
  canvas.classList.toggle('placing',!!(active||drawing));
  if(drawing)$('modeTip').textContent=templateInstructions();
  else if(active)$('modeTip').textContent=`Đang đặt ${pending.id} · Bấm vị trí hoặc nhấn Esc`;
  for(const tile of $('assetList').querySelectorAll('[data-sprite]')){
    const isSelected=tile.dataset.path===(drawing?templateDrawing.asset:pending?.path);
    tile.classList.toggle('active',isSelected);tile.setAttribute('aria-pressed',String(isSelected));
  }
}

function drawPalette(reset=false){
  if(reset)assetPage=0;
  const search=normalize($('search').value.trim());
  const isItems=kind==='items';
  for(const id of ['itemsTab','bgTab','unusedTab','levelAssetsTab']){
    const active=id===assetTab;
    $(id).classList.toggle('active',active);
    $(id).setAttribute('aria-pressed',String(active));
  }
  const byLevel=assetTab==='levelAssetsTab';
  $('assetLevelFilters').hidden=!byLevel;
  const selectedLevel=byLevel?assetLevelPack?.levels[Number($('assetLevelNumber').value)]:null;
  const groupsByAsset=new Map(),groupLabels=new Map();
  for(const box of selectedLevel?.boxes??[])groupLabels.set(box.group,box.label);
  for(const it of selectedLevel?.items??[]){
    if(!groupsByAsset.has(it.asset))groupsByAsset.set(it.asset,new Set());
    groupsByAsset.get(it.asset).add(it.group);
  }
  let coll;
  if(byLevel)coll=[...groupsByAsset.keys()].map(path=>assetLookup.get(path)).filter(Boolean);
  else if(isItems)coll=catalog.items.filter(a=>gddItemPaths&&
    (assetTab==='unusedTab'?inPalette(a)&&!gddItemPaths.has(a.path):gddItemPaths.has(a.path)));
  else coll=catalog.backgrounds.filter(inPalette);
  $('assetTotal').textContent=isItems
    ? ((byLevel?selectedLevel:gddItemPaths)?`${coll.length.toLocaleString('vi')} ảnh vật phẩm`:'Catalog vật phẩm')
    : `${coll.length.toLocaleString('vi')} ảnh nền`;
  const filter=$('groupFilter'), old=filter.value;
  filter.hidden=!isItems;
  if(isItems){
    const groups=byLevel
      ? new Map([...groupsByAsset.values()].flatMap(ids=>[...ids].map(id=>[id,groupLabels.get(id)??label(id)])))
      : new Map(coll.filter(a=>a.group!==null).map(a=>[a.group,a.label]));
    filter.replaceChildren(option('','Tất cả nhóm'),...[...groups].sort((a,b)=>a[1].localeCompare(b[1],'vi')).map(([key,label])=>option(key,`${label} · ${key}`)));
    if(groups.has(Number(old))&&old!=='')filter.value=old;
  }
  const entries=coll.filter(a=>{
    const ids=groupsByAsset.get(a.path);
    const groupMatches=!isItems||!filter.value||(byLevel?ids.has(+filter.value):+filter.value===a.group);
    const names=ids?[...ids].map(id=>groupLabels.get(id)??label(id)).join(' '):'';
    return groupMatches&&normalize(`${a.id} ${a.label} ${a.displayName||''} ${names}`).includes(search);
  });
  const pages=Math.max(1,Math.ceil(entries.length/48));assetPage=Math.min(assetPage,pages-1);
  const list=$('assetList');list.replaceChildren();
  for(const a of entries.slice(assetPage*48,assetPage*48+48)){
    const tile=btn('',e=>{if(!e.detail||!tile.suppressClick)chooseArt(a);},`${a.displayName||a.id} · ${a.id} · ${a.label}${isItems?' · Kéo vào phòng hoặc chọn rồi bấm vị trí':''}`);
    tile.className='asset-card'+(!isItems&&level?.background.asset===a.path?' active':'');
    const icon=thumb(a.path);icon.draggable=false;
    tile.dataset.path=a.path;tile.append(icon,create('span',isItems?(a.displayName||a.id):a.label));list.append(tile);
    if(isItems){
      tile.dataset.sprite='';tile.onpointerdown=e=>{
        if(e.button!==0||!e.isPrimary||!ready()||game||playingLoad||templateDrawing)return;
        tile.suppressClick=false;
        paletteGesture={a,tile,target:level,id:e.pointerId,sx:e.clientX,sy:e.clientY,moved:false};
        tile.setPointerCapture(e.pointerId);
      };
      tile.ondragstart=e=>e.preventDefault();
    }
  }
  if(!entries.length)list.append(create('span',byLevel&&!assetLevelPack
    ? assetLevelError||'Đang nạp bộ level…'
    : isItems&&!byLevel&&!gddItemPaths
    ? gddCatalogError||'Đang đối chiếu bộ 137 level…'
    : 'Không tìm thấy asset.','empty'));
  $('assetPage').textContent=`${assetPage+1}/${pages} · ${entries.length}`;$('assetPrev').disabled=assetPage===0;$('assetNext').disabled=assetPage+1>=pages;
  renderPlacement();
}

function chooseArt(a){
  if(!ready()||playingLoad)return;
  if(game){say('Bấm Về xếp đồ để thay đổi level.');return}
  if(templateDrawing?.shape==='edge'&&kind==='items'){
    if(a.group==null){say('Chọn một vật phẩm có nhóm.');return;}
    templateDrawing.asset=a.path;getImage(a.path);refreshTemplate();return;
  }
  if(kind==='backgrounds'){
    const background={asset:a.path,width:a.w,height:a.h,cameraX:0};
    pending=null;ghost=null;templateDrawing=null;patch(()=>{level.background=background;});view={zoom:1,dx:0,dy:0};drawPalette();schedule();say('Đã đổi nền.');return;
  }
  if(marqueeMode)setMarquee(false);
  pending=a;getImage(a.path);getMask(a.path).catch(()=>{});renderPlacement();schedule();
  say(`Đã chọn ${a.id}. Bấm vị trí trên nền hoặc kéo thẻ đồ vào phòng. Esc để dừng đặt.`);
}
function referenceSize(a,bg,imageSize){
  if(a.native){
    const [sx,sy]=a.roomScale?.[assetLookupBgId(bg.asset)] ?? [1,1];
    return {w:ROUND(a.native[0]*sx),h:ROUND(a.native[1]*sy)};
  }
  const p=catalog.placement,ref=p?.sizes[a.path],ratio=ref?.rooms[bg.asset]||ref?.default;
  if(ratio)return {w:ROUND(bg.height*ratio[0]),h:ROUND(bg.height*ratio[1])};
  const d=imageSize||masks.get(a.path)||(()=>{const img=getImage(a.path);return img.naturalWidth?{w:img.naturalWidth,h:img.naturalHeight}:null;})();
  if(!d)return null;
  const src=p?.roomShapes[a.id];
  const k=a.family==='happy'?(p?.happyScales[assetLookupBgId(bg.asset)]?.[a.group]??1)*bg.height/2640:
    (src?Math.min(src[0]/d.w,src[1]/d.h):a.family==='tidy'?.48:.50)*bg.height/1560;
  return {w:ROUND(d.w*k),h:ROUND(d.h*k)};
}
const assetLookupBgId=asset=>asset.split('/').at(-1).replace(/\.[^.]+$/,'');
async function sizeFor(a,bg){return referenceSize(a,bg)||referenceSize(a,bg,await getMask(a.path));}
function placementAt(point, size){
  return {...point,width:size.w,height:size.h,angle:0,scaleX:1,scaleY:1};
}
async function place(p,a,targetLevel){
  try{
    if(level!==targetLevel||game||playingLoad)return;
    const background=level.background;
    const size=referenceSize(a,background)||await sizeFor(a,background);
    if(level!==targetLevel||level.background!==background||game||playingLoad)return;
    const transform=placementAt(p,size);
    if(!fitsBackground(background,transform)){say(boundaryMessage);return;}
    const group=a.group??0;const linked=level.boxes.find(o=>o.group===group);
    const same=level.items.find(i=>i.group===group);
    patch(()=>{
      const uid=newItemId();level.items.push({uid,asset:a.path,group,targetType:linked?.targetType??same?.targetType??group,layer:Math.max(-1,...level.items.map(i=>i.layer))+1,...transform});selection=new Set([uid]);
    });
    say(`Đã đặt ${a.id} · X ${p.x} / Y ${p.y}. ${pending?'Bấm để đặt tiếp hoặc nhấn Esc.':'Kéo đồ trên nền để chỉnh vị trí.'}`);
  }catch(e){say(`Không đặt được ${a.id}: ${e.message}`)}
}
async function resetSize(items){
  if(!items.length||game||playingLoad)return;
  const target=level,bg=level.background;
  try{
    const sizes=await Promise.all(items.map(async it=>[it,await sizeFor(assetLookup.get(it.asset),bg)]));
    if(level!==target||level.background!==bg||game)return;
    const live=new Set(level.items);
    patch(()=>{for(const [it,d] of sizes)if(live.has(it)){
      it.width=d.w;it.height=d.h;it.scaleX=Math.sign(it.scaleX);it.scaleY=Math.sign(it.scaleY);
    }});
    say(`Đã đưa ${items.length} món về cỡ tham chiếu. Có thể Hoàn tác.`);
  }catch(e){say(`Không lấy được cỡ đồ: ${e.message}`);}
}
function renderBatch(){
  $('batchbar').hidden=!batch||game!==null||!!variantPreview;if(!batch||variantPreview)return;
  const select=$('batchLevel');if(select.options.length!==batch.levels.length)select.replaceChildren(...batch.levels.map((l,i)=>option(i,`${i+1}. ${l.name} · ${l.items.length} món`)));
  if(batchPos>=0){select.value=batchPos;select.options[batchPos].textContent=`${batchPos+1}. ${level.name} · ${level.items.length} món`;}
}
function label(group){return groupNames.get(group)??`Nhóm ${group}`}
function knownGroups(){
  const keys=new Set([...groupNames.keys(),...level.items.map(i=>i.group),...level.boxes.map(b=>b.group)]);
  return [...keys].sort((a,b)=>label(a).localeCompare(label(b),'vi')||a-b);
}
function groupSelect(select,preset,prefer,preserve=false){
  const activeGroups=[...new Set([...level.items.map(i=>i.group),...level.boxes.map(b=>b.group)])];
  const ids=prefer?[...activeGroups,...knownGroups().filter(k=>!activeGroups.includes(k))]:knownGroups();
  const signature=ids.join(',');
  if(select.dataset.signature!==signature){select.replaceChildren(...ids.map(k=>option(k,`${label(k)} · ${k}`)));select.dataset.signature=signature;}
  if(preset!==undefined&&(!preserve||!select.value))select.value=preset;
}
const emptyTemplate=()=>({zones:[],edges:[]});
const currentTemplate=()=>templates[level.background.asset]??emptyTemplate();
const edgeSprite=()=>pending??assetLookup.get(item()?.asset);
function usesMarkedZones(template){
  const mode=$('scatterMode').value;
  return mode==='zones'||(mode==='auto'&&(template.zones.length>0||template.edges.length>0));
}

function renderGenerator(){
  const drawing=templateDrawing?.shape, disabled=!!game||generationBusy;
  $('generateFields').disabled=$('scatterFields').disabled=disabled;
  $('scatter').disabled=disabled||!!drawing;
  $('openVariants').disabled=disabled||!!drawing||(!check(level).ok&&(batch?.levels.length??0)<2);
  $('templateActions').hidden=!drawing;
  $('saveZone').hidden=drawing!=='polygon';
  $('saveZone').disabled=(templateDrawing?.points.length??0)<3;
  $('undoTemplatePoint').hidden=drawing!=='polygon';
  $('undoTemplatePoint').disabled=!templateDrawing?.points.length;
  for(const [id,mode] of [['addZone','rect'],['addEdge','edge'],['addPolygon','polygon']]){
    $(id).classList.toggle('active',drawing===mode);
    $(id).setAttribute('aria-pressed',String(drawing===mode));
  }
  $('templateGuide').hidden=!drawing;
  $('templateHint').textContent=drawing?templateInstructions():'';
  const sprite=$('edgeSpritePreview');
  sprite.hidden=drawing!=='edge'||!templateDrawing?.asset;
  if(!sprite.hidden)sprite.src=assetURL(templateDrawing.asset);
  const list=$('templateList');list.replaceChildren();
  const template=currentTemplate();
  const useZones=usesMarkedZones(template);
  $('scatterMode').disabled=disabled||!!drawing;
  $('zoneSettings').hidden=!useZones;
  $('autoDrapeSetting').hidden=useZones||!!template.zones.length;
  $('scatterModeHelp').textContent=useZones
    ? `${template.zones.length} vùng đặt · ${template.edges.length} mép vắt trên nền này.`
    : template.zones.length?`Mọi món được giới hạn trong ${template.zones.length} vùng đã vẽ.`
      :'Đặt chân vật phẩm dọc các mặt tựa đã quan sát trong màn cùng nền.';
  for(const [key,heading] of [['zones','Vùng'],['edges','Mép vắt']]){
    template[key].forEach((entry,index)=>{
      const name=`${heading} ${index+1}${entry.asset?' · '+assetLookup.get(entry.asset)?.id:''}`;
      const remove=btn('×',()=>editTemplate(t=>t[key].splice(index,1)),`Xóa ${name}`);
      const row=create('div',undefined,'template-row');
      row.append(create('span',name),remove);list.append(row);
    });
  }
  const select=$('scatterGroup');
  if(!select.options.length||select.dataset.gdd!==String(!!gddItemPaths)){
    const groups=[...new Set(catalog.items.filter(a=>(inPalette(a)||gddItemPaths?.has(a.path))&&a.group!==null).map(a=>a.group))];
    groups.sort((a,b)=>label(a).localeCompare(label(b),'vi')||a-b);
    const old=select.value;
    select.replaceChildren(...groups.map(id=>option(id,`${label(id)} · ${id}`)));
    if(groups.includes(Number(old))&&old!=='')select.value=old;
    select.dataset.gdd=String(!!gddItemPaths);
  }
  const groups=$('scatterGroups');groups.replaceChildren();
  for(const id of scatterGroups){
    const row=create('div',undefined,'template-row');
    row.append(create('span',label(id)),btn('×',()=>{scatterGroups.delete(id);renderGenerator();},`Bỏ ${label(id)}`));
    groups.append(row);
  }
  if(!groups.childElementCount)groups.append(create('p','Dùng nhóm có sẵn trong bố cục hoặc ở mép vắt.','generator-help'));
  $('clearScatterGroups').disabled=!scatterGroups.size;
}

function openVariants(){
  if(game||playingLoad||generationBusy||variantPreview)return;
  variantPack=null;
  $('variantOne').disabled=!check(level).ok;
  $('variantAll').hidden=!batch||batch.levels.length<2;
  if(!$('variantAll').hidden)$('variantAll').textContent=`Biến tấu cả ${batch.levels.length} màn`;
  $('variantStatus').textContent='';$('variantProgress').hidden=true;
  $('variantSkipped').hidden=true;$('variantSkipped').open=false;
  $('variantChanges').hidden=true;$('variantChanges').open=false;
  $('variantRows').replaceChildren();$('downloadVariants').hidden=true;
  $('variantAlternative').hidden=true;$('variantAlternative').replaceChildren();
  $('variantDialog').showModal();
}
function describeVariant(source,result){
  const share=(n,total)=>`${n}/${total} (${Math.round(100*n/total)}%)`;
  return [
    result.positions&&`${share(result.positions,source.items.length)} món hoán đổi vị trí`,
    result.clusters&&`${result.clusters} cụm đồ hoán đổi cùng nhau`,
    result.draped&&`${result.draped} món đổi giữa vị trí vắt tương thích`,
    result.pinned&&`${result.pinned} món vắt giữ nguyên vị trí`,
    result.layerItems&&`${share(result.layerItems,source.items.length)} món đổi lớp`,
    result.repacked?`Chia lại ${source.boxes.length} → ${result.doc.boxes.length} hộp`:
      result.boxPositions&&`${share(result.boxPositions,source.boxes.length)} hộp đổi lượt mở`,
  ].filter(Boolean).join(' · ');
}
function describeDifficulty({baseline,measured}){
  return `Điểm khó theo bot ${baseline.score} → ${measured.score}/100 · Bot thắng ${baseline.won}/${baseline.trials} → ${measured.won}/${measured.trials}.`;
}
function showVariantBoard(doc){
  level=doc;selection=new Set();pending=null;ghost=null;layerView=null;selectedBox=null;
  $('title').value=doc.name;warmMasks();render();
}
function previewVariant(source,result,rowIndex=-1){
  if(variantPreview||game||playingLoad)return;
  variantPreview={source,result,rowIndex,showOriginal:false,
    editor:{level,selection,selectedBox,pending,ghost,templateDrawing,view}};
  templateDrawing=null;view={...view};
  $('variantDialog').close();
  showVariantBoard(result.doc);
  say(`Bản xem trước chưa lưu. Đường thắng đã kiểm, khay tối đa ${result.peak}/5.`);
}
function renderVariantPreview(){
  const preview=variantPreview;
  $('variantPreviewBar').hidden=!preview;
  if(!preview)return;
  $('variantPreviewTitle').textContent=preview.showOriginal?'Đang xem màn gốc':preview.generated?'Bản sinh chưa áp dụng':
    preview.result.repacked?'Bản chia lại hộp · đã kiểm đường thắng':
      preview.result.offTarget?'Bản đã kiểm đường thắng · lệch độ khó mục tiêu':'Bản biến tấu chưa lưu';
  $('variantPreviewMetrics').textContent=preview.generated?preview.result.description:
    `${describeVariant(preview.source,preview.result)} · ${describeDifficulty(preview.result.difficulty)}`;
  $('variantCompare').textContent=preview.showOriginal?(preview.generated?'Xem bản sinh':'Xem bản biến tấu'):'Xem màn gốc';
  $('variantCompare').setAttribute('aria-pressed',String(preview.showOriginal));
  $('variantSave').textContent=preview.generated?'Áp dụng vào màn':preview.rowIndex<0?'Lưu bản này':'Giữ trong bộ';
  $('variantCompare').disabled=!!game;
}
function finishVariantPreview(save){
  const preview=variantPreview;
  if(!preview||playingLoad)return;
  game=null;botReplay=null;flash=null;
  variantPreview=null;
  ({level,selection,selectedBox,pending,ghost,templateDrawing,view}=preview.editor);
  $('title').value=level.name;
  if(preview.generated){
    if(save)patch(()=>{
      Object.assign(level,preview.result.doc);
      selection=new Set();selectedBox=null;pending=null;ghost=null;
    });
    render();
    say(save?'Đã áp dụng bản sinh. Có thể Hoàn tác.':'Đã bỏ bản sinh xem trước.');
    return;
  }
  if(preview.rowIndex>=0){
    const i=preview.rowIndex,row=variantPack.rows.find(r=>r.i===i);
    variantPack.levels[i]=save?row.result.doc:preview.source;
    row.decision=save?'kept':'discarded';
    render();renderVariantPackReview();$('variantDialog').showModal();
  }else if(save){
    syncBatch();
    if(!batch){
      batch={key:`${level.key.slice(0,68)}-variants`,levels:[level],rejected:[]};
      batchFileTargets=[fileTargets];
    }
    const copy=clone(preview.result.doc);
    batch.levels.push(copy);
    openLevel(copy,batch.levels.length-1);drawPalette();
  }else{
    render();
  }
  say(save?'Đã lưu bản biến tấu.':'Đã xóa bản xem trước.');
}
function renderVariantPackReview(){
  const pack=variantPack;
  const kept=pack.rows.filter(row=>pack.levels[row.i]===row.result.doc).length;
  $('variantStatus').textContent=`Có ${kept}/${pack.levels.length} bản biến tấu · ${pack.levels.length-kept} màn giữ bản gốc.`;
  $('variantChanges').hidden=!pack.rows.length;
  $('variantChangeRows').replaceChildren(...pack.rows.map(row=>{
    const line=create('div',undefined,'report-row variant-review-row');
    const decision=row.decision==='kept'?' · Đã giữ':row.decision==='discarded'?' · Đã xóa':
      row.result.repacked?' · Chia lại hộp, chờ duyệt':row.result.offTarget?' · Lệch độ khó mục tiêu, chờ duyệt':'';
    line.append(create('span',`${row.i+1}. ${row.source.name} · ${row.summary}${decision}`));
    if(row.decision!=='discarded')line.append(btn('Xem trước',()=>previewVariant(row.source,row.result,row.i)));
    return line;
  }));
  $('downloadVariants').hidden=!kept;
}
function variantName(source,doc,keys,keepName){
  const base=source.key.replace(/-bt-\d+$/,'').slice(0,68);
  let number=1,key=`${base}-bt-${number}`;
  while(keys.has(key))key=`${base}-bt-${++number}`;
  keys.add(key);doc.key=key;
  if(!keepName){
    const suffix=` · Biến tấu ${number}`;
    doc.name=source.name.slice(0,120-suffix.length)+suffix;
  }
}
async function createVariants(all){
  if(variantJob||game||generationBusy||variantPreview)return;
  const active=level,activeBatch=batch;
  if(all&&!activeBatch)return;
  const levels=all?activeBatch.levels.slice():[active];
  const keys=new Set((activeBatch?.levels??levels).map(doc=>doc.key));
  const prefix=active.key.replace(/-bt-\d+$/,'').slice(0,68)+'-bt-';
  const exclude=all?new Set():new Set((activeBatch?.levels??[])
    .filter(doc=>doc.key.startsWith(prefix)).map(TidyVariant.signature));
  const status=$('variantStatus'),progress=$('variantProgress'),job={cancelled:false};
  const controls=['closeVariants','variantOne','variantAll','variantMode','variantStrength','variantDifficulty','variantSearch'];
  variantJob=job;variantPack=null;
  controls.forEach(id=>$(id).disabled=true);
  $('cancelVariants').hidden=false;$('cancelVariants').disabled=false;
  $('downloadVariants').hidden=true;$('variantSkipped').hidden=true;$('variantRows').replaceChildren();
  $('variantAlternative').hidden=true;$('variantAlternative').replaceChildren();
  $('variantChanges').hidden=true;$('variantChangeRows').replaceChildren();
  progress.max=levels.length;progress.value=0;progress.hidden=!all;
  const options={mode:$('variantMode').value,strength:Number($('variantStrength').value),difficulty:$('variantDifficulty').value,
    effort:$('variantSearch').value,exclude,stopped:()=>job.cancelled};
  const output=[],skipped=[],changes=[];
  try{
    for(const [i,source] of levels.entries()){
      if(job.cancelled)break;
      status.textContent=all?`Đang kiểm tra đường thắng · ${i+1}/${levels.length} màn`:'Đang thử các cách đổi thứ tự và kiểm tra đường thắng…';
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(job.cancelled)break;
      let result;
      try{
        await Promise.all([...new Set(source.items.map(it=>it.asset))].map(getMask));
        const template=templates[source.background.asset];
        result=await TidyVariant.make(source,masks,{...options,template,progress:({stage,current,total,elapsed})=>{
          if(job.cancelled)return;
          const task=stage==='baseline'?'Đo độ khó màn gốc':stage==='layout'?`Thử phương án ${current}/${total}`:
            stage==='repack'?'Thử chia lại hộp':`Dò đường thắng sâu ${current}/${total}`;
          const prefix=all?`Màn ${i+1}/${levels.length} · `:'';
          status.textContent=`${prefix}${task} · ${Math.floor(elapsed/1000)} giây`;
        }});
      }catch(error){result={reason:error.message};}
      if(job.cancelled||result.cancelled)break;
      if(result.doc){
        variantName(source,result.doc,keys,all);
        if(!all){
          if(level!==active||batch!==activeBatch)throw Error('Màn đang mở đã thay đổi. Hãy thử lại.');
          previewVariant(source,result);
        }else{
          output.push(result.doc);
          changes.push({i,source,result,summary:describeVariant(source,result)});
        }
      }else{
        if(result.fallback){
          const alternative={...result.fallback,offTarget:!result.fallback.repacked};
          variantName(source,alternative.doc,keys,all);
          if(!all){
            status.textContent=result.reason;
            const caption=alternative.repacked?'Xem bản chia lại hộp':'Xem bản gần nhất đã thắng';
            $('variantAlternative').append(btn(caption,()=>previewVariant(source,alternative)));
            $('variantAlternative').hidden=false;
            return;
          }
          changes.push({i,source,result:alternative,summary:describeVariant(source,alternative)});
        }else if(!all){status.textContent=result.reason;return;}
        output.push(source);
        if(!result.fallback)skipped.push({i,name:source.name,reason:result.reason});
      }
      progress.value=i+1;
    }
    if(job.cancelled){status.textContent='Đã dừng biến tấu.';return;}
    if(!all)return;
    $('variantRows').replaceChildren(...skipped.map(row=>create('div',`${row.i+1}. ${row.name} · ${row.reason}`,'report-row')));
    $('variantSkipped').hidden=!skipped.length;
    variantPack={key:`${slug(activeBatch.key||'tidy-level-pack')}-variants`,levels:output,rows:changes};
    renderVariantPackReview();
  }catch(error){status.textContent=error.message;}
  finally{
    variantJob=null;
    controls.forEach(id=>$(id).disabled=false);
    $('variantOne').disabled=!check(level).ok;
    $('cancelVariants').hidden=true;
  }
}

function refreshTemplate(){
  renderPlacement();renderGenerator();schedule();
}
async function editTemplate(fn){
  const key=level.background.asset, template=clone(currentTemplate());
  fn(template);
  templates[key]=template;
  refreshTemplate();
  try{
    const db=await openStore;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('draft','readwrite');
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      tx.objectStore('draft').put(templates,'templates');
    });
  }catch{say('Vùng và mép đang có trong phiên này. Trình duyệt chưa lưu được cho lần mở sau.');}
}
function templateInstructions(){
  const {shape,asset,points}=templateDrawing;
  if(shape==='rect')return 'Kéo từ góc này sang góc đối diện rồi thả.';
  if(shape==='polygon')return `Bấm từng góc rồi chọn Lưu vùng · ${points.length} điểm.`;
  return asset?'Kéo dọc mép vắt rồi thả.':'Chọn ảnh đồ cần vắt trong Catalog.';
}
function beginTemplate(shape){
  if(drag||!canEdit())return;
  const asset=shape==='edge'?(edgeSprite()??assetLookup.get(templateDrawing?.asset)):null;
  templateDrawing={shape,kind:shape==='edge'?'edges':'zones',points:[],asset:asset?.group!=null?asset.path:undefined};
  if(shape==='edge'&&kind==='backgrounds')$('itemsTab').click();
  pending=null;ghost=null;
  refreshTemplate();
}
function templatePoint(x,y){
  const {width,height}=level.background;
  return [x/width+.5,.5-y/height];
}
function templateDragPoints(g){
  const [u,v]=g.start,[x,y]=g.end;
  return templateDrawing.shape==='rect'?[[u,v],[x,v],[x,y],[u,y]]:[g.start,g.end];
}
function addTemplatePoint(x,y){
  const point=templatePoint(x,y);
  if(point.some(v=>v<0||v>1)){say('Bấm một điểm bên trong ảnh nền.');return;}
  templateDrawing.points.push(point);
  refreshTemplate();
}
function finishTemplate(){
  if(!templateDrawing)return;
  const {kind,points,asset}=templateDrawing;
  if(kind==='zones'&&!TidyGenerator.polygonValid(points)){
    if(templateDrawing.shape==='rect'){
      templateDrawing.points=[];refreshTemplate();say('Kéo rộng hơn để khoanh vùng đặt.');return;
    }
    say('Vùng cần ít nhất ba góc, có diện tích và các cạnh không cắt nhau. Hủy vẽ để thử lại.');return;
  }
  if(kind==='edges'&&Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])<.015){
    templateDrawing.points=[];refreshTemplate();say('Kéo một đường dài hơn để đặt mép vắt.');return;
  }
  templateDrawing=null;
  editTemplate(t=>t[kind].push(asset?{points,asset}:{points}));
  say(kind==='zones'?'Đã lưu vùng đặt cho nền này.':'Đã lưu mép vắt cho nền này.');
}
function drawTemplate(){
  const template=currentTemplate();
  const paths=[...template.zones.map((entry,i)=>({...entry,kind:'zones',label:`Vùng ${i+1}`})),
    ...template.edges.map((entry,i)=>({...entry,kind:'edges',label:`Mép ${i+1}`}))];
  if(templateDrawing?.points.length)paths.push({...templateDrawing,draft:true});
  if(templateDrawing&&drag?.type==='template'&&drag.moved)paths.push({...templateDrawing,points:templateDragPoints(drag),draft:true});
  for(const {kind,points,draft,shape,label,asset} of paths){
    const zone=kind==='zones';
    const positions=points.map(p=>screen(...TidyGenerator.toWorld(p,level.background)));
    ctx.save();ctx.strokeStyle=zone?'#228453':'#a6530a';ctx.fillStyle=zone?'#5bea9c38':'#a6530a';ctx.lineWidth=3;
    ctx.beginPath();
    positions.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    if(zone&&(!draft||shape==='rect')){ctx.closePath();ctx.fill();}
    if(draft)ctx.setLineDash([5,4]);
    ctx.stroke();
    ctx.fillStyle=ctx.strokeStyle;
    for(const [x,y] of positions){ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();}
    if(label){
      const [x,y]=positions[0];ctx.font='600 12px sans-serif';
      ctx.fillRect(x+5,y-20,ctx.measureText(label).width+10,19);
      ctx.fillStyle='#fff';ctx.fillText(label,x+10,y-6);
    }
    ctx.restore();
    if(draft&&!zone){
      const art=assetLookup.get(asset), size=art&&referenceSize(art,level.background), img=art&&getImage(asset);
      if(!size||!img.naturalWidth)continue;
      const frame=TidyGenerator.edgeFrame(points.map(point=>TidyGenerator.toWorld(point,level.background)));
      const {point,angle}=TidyGenerator.edgePose(frame,.5,size.h);
      const [x,y]=screen(...point),w=size.w*dims.s,h=size.h*dims.s;
      ctx.save();ctx.translate(x,y);ctx.rotate(-angle*Math.PI/180);ctx.globalAlpha=.65;
      ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();
    }
  }
}

function generationNumber(id,description){
  const control=$(id), value=Number(control.value);
  if(!Number.isInteger(value)||value<Number(control.min)||value>Number(control.max))
    throw Error(`${description} phải từ ${control.min} đến ${control.max}.`);
  return value;
}
async function scatterPieces(snapshot, template, groups){
  const records=new Map();
  for(const id of groups){
    const available=catalog.items.filter(a=>a.group===id&&(inPalette(a)||gddItemPaths?.has(a.path)));
    for(let i=0;i<Math.min(12,available.length);i++){
      const index=i+Math.floor(Math.random()*(available.length-i));
      [available[i],available[index]]=[available[index],available[i]];
      const a=available[i];records.set(a.path,a);
    }
  }
  for(const {asset} of template.edges){const a=assetLookup.get(asset);if(a?.group!=null)records.set(asset,a);}
  const pieces=[];
  for(const a of records.values()){
    const size=await sizeFor(a,snapshot.background);
    const targetType=snapshot.items.find(i=>i.group===a.group)?.targetType??a.group;
    if(size?.w>0&&size?.h>0)pieces.push({asset:a.path,group:a.group,targetType,width:size.w,height:size.h});
  }
  if([...groups].some(id=>!pieces.some(p=>p.group===id)))throw Error('Có nhóm chưa có sprite để rải. Chọn lại nhóm đồ.');
  return pieces;
}
async function scatterReference(snapshot,groups){
  const capacity=doc=>doc.items.filter(it=>!groups.size||groups.has(it.group)).length;
  const valid=doc=>[...groups].every(group=>doc.items.some(it=>it.group===group));
  const pack=await readGddPack();
  const matching=pack.levels.filter(doc=>doc.background.asset===snapshot.background.asset&&valid(doc));
  if(!matching.length&&snapshot.items.length&&valid(snapshot))matching.push(snapshot);
  matching.sort((a,b)=>capacity(b)-capacity(a));
  if(!matching.length)throw Error('Chưa có bố cục mẫu cùng nền cho các nhóm này. Hãy khoanh vùng đặt hoặc đổi nhóm đồ.');
  return matching[0];
}
async function generate(scatterLayout){
  if(!canEdit()||generationBusy||templateDrawing||drag)return;
  const target=level,snapshot=clone(level),before=JSON.stringify(level);
  try{
    const maxBox=generationNumber(scatterLayout?'scatterMaxBox':'maxBox','Sức chứa hộp');
    const difficulty=scatterLayout?undefined:$('boxDifficulty').value;
    let template,groups,count,layers,useZones,angleRange,stackBias,neatopia=false,drape=false,attempts=1;
    if(scatterLayout){
      template=clone(currentTemplate());
      count=generationNumber('scatterCount','Số món');
      layers=generationNumber('scatterLayers','Số lớp');
      attempts=Number($('scatterAttempts').value);
      neatopia=$('scatterBoxStyle').value==='neatopia';drape=$('autoDrape').checked&&!template.zones.length;
      angleRange=Number($('scatterAngle').value);stackBias=Number($('scatterStack').value);
      useZones=usesMarkedZones(template);
      groups=new Set(scatterGroups);
      if(useZones){
        if(!template.zones.length&&!template.edges.length)throw Error('Khoanh vùng đặt hoặc vẽ mép vắt trên nền trước.');
        if(!groups.size)for(const it of snapshot.items)groups.add(it.group);
        for(const edge of template.edges)groups.add(assetLookup.get(edge.asset)?.group);
        if(!groups.size)throw Error('Thêm ít nhất một nhóm đồ trước khi rải.');
      }
      if(groups.size>count||(useZones&&template.edges.length>count))throw Error('Tăng số món để đủ cho các nhóm và mép vắt đã chọn.');
    }else{
      if(!snapshot.items.length)throw Error('Đặt ít nhất một món đồ trước khi sinh hộp.');
      if(snapshot.boxes.length&&!confirm('Tạo lại hàng đợi hộp từ bố cục hiện tại? Có thể Hoàn tác sau khi sinh.'))return;
    }
    generationBusy=true;renderPanel();$('play').disabled=true;
    say(scatterLayout?'Đang rải đồ và kiểm tra đường thắng…':'Đang sinh hộp và kiểm tra đường thắng…');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const pieces=useZones?await scatterPieces(snapshot,template,groups):null;
    const reference=scatterLayout&&!useZones?await scatterReference(snapshot,groups):null;
    const rails=reference&&reference!==snapshot?window.TIDY_SURFACE_RAILS[reference.key]??[]:[];
    if(reference)await Promise.all([...new Set(reference.items.map(it=>it.asset))].map(getMask));
    const model=reference?TidyGenerator.learnLayout(reference,snapshot.background,rails,reference===snapshot?[]:[snapshot],{masks,zones:template.zones}):null;
    let result, error;
    let generated;
    for(let attempt=0;attempt<attempts&&!result;attempt++){
      try{
        if(useZones)snapshot.items=TidyGenerator.scatter(snapshot.background,template,pieces,{count,layers,angleRange,stackBias});
        if(model){
          generated=TidyGenerator.synthesize(snapshot.background,model,{count,layers,groups,neatopia,drape});
          snapshot.items=generated.items;
        }
        await Promise.all([...new Set(snapshot.items.map(i=>i.asset))].map(getMask));
        result=await TidyGenerator.boxesFromLayout(snapshot,masks,{maxBox,label,neatopia,difficulty});
        Offline.validate({...snapshot,boxes:result.boxes},true);
      }catch(e){error=e;result=null;}
    }
    if(level!==target||drag||JSON.stringify(level)!==before){say('Màn đã thay đổi trong lúc sinh. Bấm sinh lại để dùng bố cục mới.');return;}
    if(!result)throw error;
    const small=result.small?` · ${result.small} hộp dưới ${Math.min(3,maxBox)} món`:'';
    const verified=`${result.boxes.length} hộp · Đã kiểm tra đường thắng trong ${result.points.length} lượt${small}.`;
    if(scatterLayout){
      const doc=Offline.attachProof({...snapshot,boxes:result.boxes},result.order);
      const backgroundSource=useZones?'Vùng và mép đã đánh dấu':template.zones.length
        ? `Sinh mới trong ${template.zones.length} vùng đã vẽ`:`Sinh mới cùng nền · ${generated.draped} món vắt`;
      variantPreview={source:target,generated:true,showOriginal:false,result:{doc,description:`${backgroundSource} · ${count} món · ${verified}`},
        editor:{level,selection,selectedBox,pending,ghost,templateDrawing,view}};
      view={...view};
      showVariantBoard(doc);
      say('Bản sinh chưa áp dụng. Có thể Playtest hoặc xem lại màn gốc.');
    }else{
      patch(()=>{
        level.boxes=result.boxes;
        Offline.attachProof(level,result.order);
      });
      const actual=result.difficulty;
      const targetLabel=difficulty[0].toUpperCase()+difficulty.slice(1);
      const actualLabel=actual[0].toUpperCase()+actual.slice(1);
      say(`${verified} ${actual===difficulty?actualLabel:`Mục tiêu ${targetLabel}, bản gần nhất ${actualLabel}`} · Khay cao nhất ${result.peak}/5 · ${result.waits} lượt vào khay.`);
    }
  }catch(e){say(e.message);}
  finally{generationBusy=false;$('play').disabled=false;renderPanel();}
}

function renderLayerStacks(layers){
  const stacks=new Map();
  for(const it of [...drawOrder()].reverse()){
    const key=layers.get(it.uid).stack;
    if(!stacks.has(key))stacks.set(key,[]);
    stacks.get(key).push(it);
  }
  const list=$('layers'),scroll=$('layerPanel').scrollTop;
  list.replaceChildren();
  let number=0;
  const singles=[];
  for(const [key,items] of stacks){
    if(items.length===1){singles.push(items[0]);continue;}
    const section=create('section',undefined,'layer-stack');
    section.dataset.stack=key;
    section.dataset.color=number%6;
    section.append(create('div',`Cụm ${++number} · ${items.length} món`,'layer-stack-label'),
      ...items.map(it=>layerRow(it,layers.get(it.uid).depth)));
    list.append(section);
  }
  if(singles.length){
    const section=create('section',undefined,'layer-singles');
    section.append(create('div',`Đồ đứng riêng · ${singles.length} món`,'layer-stack-label'),
      ...singles.map(it=>layerRow(it,0)));
    list.append(section);
  }
  $('layerPanel').scrollTop=scroll;
  $('layerDragHelp').hidden=level.items.length<2||!canEdit();
}

function layerRow(it,depth){
  const row=btn('',e=>{
    if(!canEdit())return;
    cancelPlacement();selectItem(it.uid,e.shiftKey||e.ctrlKey||e.metaKey);
  },`X ${it.x} / Y ${it.y}`);
  const active=selection.has(it.uid);
  row.className='layer'+(active?' active':'');
  row.setAttribute('aria-pressed',String(active));
  row.dataset.uid=it.uid;
  if(level.items.length>1&&canEdit()){
    row.draggable=true;
    const handle=create('span','⠿','layer-grip');handle.setAttribute('aria-hidden','true');row.append(handle);
  }
  const art=assetLookup.get(it.asset),img=thumb(it.asset);img.draggable=false;
  row.append(img,create('span',art?.displayName||art?.id||it.asset,'grow'),create('small',`L${depth}`));
  return row;
}

function clearLayerDrop(){
  layerDrop?.row.classList.remove('drop-above','drop-below');
  layerDrop=null;
}
function positionInTargetStack(item,target){
  const bg=level.background,shape=itemBounds({...item,x:0,y:0});
  const limitX=bg.width/2-shape.right,limitY=bg.height/2-shape.top;
  if(limitX<0||limitY<0)return null;
  const bounds=itemBounds(target);
  const offsets=[[0,0],[-.20,0],[.20,0],[0,.20],[0,-.20],[-.20,.20],[.20,.20],[-.20,-.20],[.20,-.20]];
  for(const [u,v] of offsets){
    const x=Math.min(limitX,Math.max(-limitX,target.x+u*(bounds.right-bounds.left)));
    const y=Math.min(limitY,Math.max(-limitY,target.y+v*(bounds.top-bounds.bottom)));
    const moved={...item,x,y};
    if(!fitsBackground(bg,moved))continue;
    const overlap=stackLayers([moved,target],masks);
    if(overlap.get(moved.uid).stack===overlap.get(target.uid).stack)return moved;
  }
  return null;
}
function reorderLayerRow(sourceUid,targetUid,above){
  if(!canEdit()||drag||sourceUid===targetUid)return;
  const layers=layerView??stackLayers(level.items,masks);
  const source=layers.get(sourceUid),target=layers.get(targetUid);
  if(!source||!target)return;
  const sameStack=source.stack===target.stack;
  const order=drawOrder().filter(it=>!sameStack||layers.get(it.uid).stack===source.stack);
  const slots=order.map(it=>it.layer);
  const from=order.findIndex(it=>it.uid===sourceUid);
  const [moved]=order.splice(from,1);
  const to=order.findIndex(it=>it.uid===targetUid)+(above?1:0);
  const destination=sameStack?moved:positionInTargetStack(moved,order.find(it=>it.uid===targetUid));
  if(!destination){say('Món này không vừa vị trí của cụm đích.');return;}
  if(sameStack&&from===to)return;
  order.splice(to,0,moved);
  patch(()=>{
    moved.x=destination.x;moved.y=destination.y;
    order.forEach((it,i)=>{it.layer=slots[i];});
    if(!selection.has(sourceUid))selection=new Set([sourceUid]);
  });
}

function bindLayerDrag(){
  const list=$('layers');
  list.addEventListener('dragstart',event=>{
    const row=event.target.closest('.layer[draggable="true"]');
    if(!row||!canEdit()||drag){event.preventDefault();return;}
    draggedLayer=row;
    event.dataTransfer.setData('text/plain',row.dataset.uid);
    event.dataTransfer.effectAllowed='move';
    row.classList.add('dragged');
  });
  list.addEventListener('dragover',event=>{
    const row=event.target.closest('.layer');
    if(!draggedLayer||!row||row===draggedLayer){clearLayerDrop();return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const {top,height}=row.getBoundingClientRect();
    const above=event.clientY<top+height/2;
    if(layerDrop?.row===row&&layerDrop.above===above)return;
    clearLayerDrop();
    row.classList.add(above?'drop-above':'drop-below');
    layerDrop={row,above};
  });
  list.addEventListener('dragleave',event=>{
    if(!list.contains(event.relatedTarget))clearLayerDrop();
  });
  function finish(){
    clearLayerDrop();draggedLayer?.classList.remove('dragged');draggedLayer=null;
  }
  list.addEventListener('drop',event=>{
    if(!draggedLayer||!layerDrop)return;
    event.preventDefault();
    const from=draggedLayer.dataset.uid,{row,above}=layerDrop;
    finish();reorderLayerRow(from,row.dataset.uid,above);
  });
  list.addEventListener('dragend',finish);
}

function renderPanel(){
  if(!level)return;
  const it=item();$('summary').textContent=`${level.items.length} món · ${level.boxes.length} hộp`;
  const reference=level.reference,info=$('referenceInfo');
  info.hidden=reference?.source!=='tidy57';
  if(!info.hidden)info.textContent=`Tidy Room 57 · ${['Normal','Hard','Super Hard'][reference.difficulty]} · ${reference.timeLimit}s gốc`;
  $('fitAll').disabled=!level.items.length||!!game;
  for(const tab of inspectorTabs){
    const active=inspector===tab;
    $(`${tab}Panel`).hidden=!active;
    $(`${tab}Tab`).classList.toggle('active',active);
    $(`${tab}Tab`).setAttribute('aria-pressed',String(active));
  }
  if(inspector==='generate'){renderGenerator();return;}
  if(inspector==='json'){renderJson();return;}
  if(inspector==='layer'){
    const layers=layerView??(layerView=stackLayers(level.items,masks));
    const depth=Math.max(-1,...Array.from(layers.values(),entry=>entry.depth));
    $('stackDepth').textContent=depth<0?'':`Sâu nhất ${depth+1} lớp`;
    $('selectionEmpty').hidden=!!selection.size;$('itemFields').hidden=!it;$('itemFields').disabled=!canEdit();
    $('selectionActions').hidden=!selection.size;$('selectionActions').disabled=!canEdit();
    $('selectionCount').textContent=`Đã chọn ${selection.size} món`;
    $('groupTools').hidden=selection.size<2;
    if(it){
      $('itemTitle').textContent=assetLookup.get(it.asset)?.displayName||assetLookup.get(it.asset)?.id||it.asset;
      for(const k of ['x','y','angle','scaleX','scaleY'])$(k).value=it[k];
      groupSelect($('itemGroup'),it.group,true);
      const local=layers.get(it.uid);
      $('layerBack').disabled=!local.below;$('layerFront').disabled=!local.above;
      $('layerBack').title='Hạ xuống dưới món chồng gần nhất';$('layerFront').title='Nâng lên trên món chồng gần nhất';
    }else{
      const locked=selection.size===level.items.length;
      $('layerBack').disabled=$('layerFront').disabled=locked;
      $('layerBack').title='Đưa cụm xuống dưới cùng';$('layerFront').title='Đưa cụm lên trên cùng';
    }
    renderLayerStacks(layers);
  }else{
    $('rule').value=level.rule;$('rule').disabled=!!game;
    const orders=$('orders');orders.replaceChildren();
    level.boxes.forEach((o,i)=>{
      const row=create('div',undefined,'sort-row'), count=create('input');count.type='number';count.min='1';count.max='3000';count.value=o.count;count.disabled=!!game;
      row.dataset.boxIndex=i;
      row.draggable=!!canEdit()&&level.boxes.length>1;
      count.setAttribute('aria-label',`Sức chứa hộp ${i+1}`);count.onchange=()=>{const n=Math.max(1,Math.min(3000,Math.round(+count.value||1)));patch(()=>o.count=n);count.value=n;};
      const actions=create('div',undefined,'sort-actions'),up=btn('↑',()=>moveBox(i,-1),'Đưa hộp lên'),down=btn('↓',()=>moveBox(i,1),'Đưa hộp xuống'),del=btn('×',()=>patch(()=>level.boxes.splice(i,1)),'Bỏ hộp');
      up.disabled=!!game||i===0;down.disabled=!!game||i===level.boxes.length-1;del.disabled=!!game;actions.append(up,down,del);
      row.append(create('small',`⠿ ${i+1}`,'box-drag-grip'),create('span',o.label),count,actions);orders.append(row);
    });
    groupSelect($('groupOrder'),level.items[0]?.group,true,true);$('groupOrder').disabled=$('addBox').disabled=!!game;
    $('fillBoxes').disabled=$('maxBox').disabled=$('boxDifficulty').disabled=!!game||generationBusy;
    const report=check(level);$('validation').classList.toggle('invalid',!report.ok);
    $('validation').textContent=report.ok?'Đủ chỗ cho từng nhóm. Có thể chơi thử hoặc xuất Unity.':!level.items.length?'Đặt đồ trước, sau đó tạo hộp.':report.deltas.map(x=>`${label(x.group)}: ${x.have} đồ / ${x.want} chỗ`).join(' · ');
  }
}
function renderBoxBalance(){
  const status=$('boxBalance');
  status.hidden=!!game||(!level.items.length&&!level.boxes.length);
  if(status.hidden)return;
  const {deltas}=check(level);
  const names=new Map(level.boxes.map(box=>[box.group,box.label]));
  const parts=deltas.map(({group,have,want})=>{
    const shortage=have<want;
    const name=names.get(group)||label(group);
    return create('span',`${shortage?'Cần thêm':'Thừa'} ${Math.abs(have-want)} món · ${name} (${group})`,
      shortage?'balance-short':'balance-extra');
  });
  status.title=parts.map(part=>part.textContent).join('\n');
  if(!parts.length)parts.push(create('span','Đồ và hộp vừa đủ','balance-ok'));
  if(status.textContent!==parts.map(part=>part.textContent).join(''))status.replaceChildren(...parts);
}
function render(){
  if(!level)return;
  layerView=null;editorOrder=null;selectionBounds=null;
  canvas.classList.toggle('play-mode',!!game);
  if(!game||playHover?.game!==game)playHover=null;
  const locked=!!game||!!variantPreview;
  $('title').disabled=locked;$('editorMode').textContent=game?'02 / PLAYTEST':variantPreview?'02 / XEM TRƯỚC':'02 / XẾP LEVEL';
  $('play').textContent=game?'■ Dừng test':'▶ Playtest';
  $('undo').disabled=locked||!history.length;$('redo').disabled=locked||!future.length;
  $('playbar').hidden=!game;$('grid').hidden=!!game;$('toggleBoxes').hidden=!!game;
  $('editHelp').hidden=!!game;
  for(const k of ['new','library','openLevelFile'])$(k).disabled=locked;
  renderFileButtons();
  document.querySelector('.assets').inert=!!variantPreview;
  for(const tab of ['layer','box','generate'])$(`${tab}Panel`).inert=!!variantPreview;
  renderVariantPreview();
  renderPlacement();
  renderBoxBalance();
  if(!game){clearPlayMotion();$('finish').hidden=true;}
  syncBatch();renderBatch();renderPanel();if(game)renderPlay();else renderBoxPreview();schedule();
}
function arrange(offset){
  if(!canEdit()||!selection.size)return;
  const it=item();
  if(!it){
    const order=drawOrder(),cut=order.filter(i=>selection.has(i.uid)),rest=order.filter(i=>!selection.has(i.uid));
    const rearranged=offset>0?[...rest,...cut]:[...cut,...rest];
    if(rearranged.some((i,index)=>i!==order[index]))patch(()=>rearranged.forEach((i,index)=>{i.layer=index;}));
    return;
  }
  const layers=layerView??stackLayers(level.items,masks);
  const {above,below}=layers.get(it.uid);
  const neighbor=offset>0?above:below;
  if(!neighbor)return;
  const order=sorted(level.items).filter(other=>other!==it);
  order.splice(order.indexOf(neighbor)+(offset>0?1:0),0,it);
  patch(()=>order.forEach((other,index)=>{other.layer=index;}));
}
function moveBox(from,offset){
  const to=from+offset;
  if(!offset||from<0||from>=level.boxes.length||to<0||to>=level.boxes.length)return;
  patch(()=>{const [box]=level.boxes.splice(from,1);level.boxes.splice(to,0,box);});
}
function bindBoxDrag(list,horizontal){
  let source=null,marked=null;
  function clearMark(){marked?.classList.remove('box-drop-before','box-drop-after');marked=null;}
  function targetFor(event){
    const row=event.target.closest('[data-box-index]');
    if(!source||source.level!==level||!canEdit()||!row||!list.contains(row))return null;
    const index=Number(row.dataset.boxIndex);
    if(index===source.index)return null;
    const rect=row.getBoundingClientRect();
    const after=horizontal?event.clientX>=rect.left+rect.width/2:event.clientY>=rect.top+rect.height/2;
    return {row,index,after};
  }
  list.addEventListener('dragstart',event=>{
    const row=event.target.closest('[data-box-index]');
    if(!row?.draggable||!canEdit()||drag||event.target.closest('input')){event.preventDefault();return;}
    source={level,index:Number(row.dataset.boxIndex)};
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(source.index));
  });
  list.addEventListener('dragover',event=>{
    const target=targetFor(event);clearMark();
    if(!target)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';
    marked=target.row;marked.classList.add(target.after?'box-drop-after':'box-drop-before');
  });
  list.addEventListener('dragleave',event=>{if(!list.contains(event.relatedTarget))clearMark();});
  list.addEventListener('drop',event=>{
    const target=targetFor(event);clearMark();
    if(!target)return;
    event.preventDefault();
    const from=source.index,to=target.index+Number(target.after)-Number(from<target.index);
    source=null;moveBox(from,to-from);
  });
  list.addEventListener('dragend',()=>{source=null;clearMark();});
}
function removeItem(){
  if(!selection.size)return;
  patch(()=>{level.items=level.items.filter(i=>!selection.has(i.uid));selection=new Set();});
}
function cancelPlacement(){
  if(!pending&&!ghost)return;
  pending=null;ghost=null;renderPlacement();schedule();
}
function currentBounds(){
  if(!selection.size)return null;
  return selectionBounds??(selectionBounds=boundsOf(chosen()));
}
function boundsOf(items){
  const bounds={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
  for(const it of items){
    const b=itemBounds(it);
    bounds.left=Math.min(bounds.left,b.left);bounds.right=Math.max(bounds.right,b.right);
    bounds.bottom=Math.min(bounds.bottom,b.bottom);bounds.top=Math.max(bounds.top,b.top);
  }
  return {...bounds,x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
}
function applyTransforms(items,projects){
  if(!items.length)return;
  if(!projects.every(it=>fitsBackground(level.background,it))){say(boundaryMessage);return;}
  patch(()=>items.forEach((it,i)=>Object.assign(it,projects[i])));
}
function angleFor(degrees){return ROUND(((degrees+180)%360+360)%360-180);}
function rotateAround(it,pivot,angle){
  const dx=it.x-pivot.x,dy=it.y-pivot.y;
  const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return {...it,x:ROUND(pivot.x+dx*c-dy*s),y:ROUND(pivot.y+dx*s+dy*c),angle:angleFor(it.angle+angle)};
}
function turn(angle){
  const bounds=currentBounds();if(!bounds)return;
  const items=chosen();
  applyTransforms(items,items.map(it=>rotateAround(it,bounds,angle)));
}
function translate(it,dx,dy){return {...it,x:ROUND(it.x+dx),y:ROUND(it.y+dy)};}
function nudge(dx,dy){
  const items=chosen();applyTransforms(items,items.map(it=>translate(it,dx,dy)));
}
function scaleAround(it,pivot,factor){
  return {...it,x:ROUND(pivot.x+(it.x-pivot.x)*factor),y:ROUND(pivot.y+(it.y-pivot.y)*factor),
    scaleX:ROUND(it.scaleX*factor)||it.scaleX*factor,scaleY:ROUND(it.scaleY*factor)||it.scaleY*factor};
}
function scaleSelection(factor){
  const tools=currentBounds();if(!tools)return;
  const items=chosen();
  const projects=items.map(it=>scaleAround(it,tools,factor));
  if(projects.some(it=>[it.scaleX,it.scaleY].some(n=>Math.abs(n)<.0001||Math.abs(n)>1000)))return;
  applyTransforms(items,projects);
}
function focusSelection(){
  const b=currentBounds();if(!b)return;
  const w=canvas.clientWidth,h=canvas.clientHeight;
  const s=makeTransform(w,h).s/view.zoom;
  const available=showPortrait?Math.min(w,h*9/16):w;
  const zoom=Math.min(8,Math.max(.32,Math.min((available-32)/(b.right-b.left),(h-82)/(b.top-b.bottom))/s));
  view={zoom,dx:-b.x*s*zoom,dy:b.y*s*zoom};
  schedule();
}
function flip(axis){
  const bounds=currentBounds();if(!bounds)return;
  const items=chosen(),key=axis==='x'?'scaleX':'scaleY';
  applyTransforms(items,items.map(it=>({...it,[axis]:ROUND(2*bounds[axis]-it[axis]),angle:angleFor(-it.angle),[key]:-it[key]})));
}
function align(key){
  const bounds=currentBounds();if(!bounds)return;
  const horizontal=['left','right','x'].includes(key);
  const items=chosen();
  applyTransforms(items,items.map(it=>{
    const b=key==='x'||key==='y'?it:itemBounds(it);
    const shift=bounds[key]-b[key];
    return horizontal?translate(it,shift,0):translate(it,0,shift);
  }));
}
function pasteItems(items,step=1){
  if(!canEdit()||drag||!items.length)return false;
  if(level.items.length+items.length>3000){say('Mỗi màn chứa tối đa 3000 món.');return false;}
  const bounds=boundsOf(items),bg=level.background,m=20*step;
  const offsets=[[m,-m],[-m,-m],[m,m],[-m,m],[m,0],[-m,0],[0,m],[0,-m]];
  if(items===clipboard)offsets.push([-bounds.x,-bounds.y],[0,0]);
  let result;
  for(const [x,y] of offsets){
    const proposal=items.map(it=>translate(it,x,y));
    if(proposal.every(it=>fitsBackground(bg,it))){result=proposal;break;}
  }
  if(!result){say(boundaryMessage);return false;}
  patch(()=>{
    let layer=Math.max(-1,...level.items.map(i=>i.layer))+1;
    const added=[];
    for(const copy of result){
      const uid=newItemId(),same=level.items.find(i=>i.group===copy.group);
      const targetType=level.boxes.find(b=>b.group===copy.group)?.targetType??same?.targetType??copy.targetType;
      level.items.push({...copy,uid,layer:layer++,targetType});added.push(uid);
    }
    selection=new Set(added);
  });
  return true;
}
function duplicate(){
  pasteItems(sorted(chosen()));
}

function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw()});}
function makeTransform(w,h){
  const b=level.background,s=Math.min(Math.max(1,w-44)/b.width,Math.max(1,h-40)/b.height)*view.zoom;
  return {w,h,s,cx:w/2+view.dx,cy:h/2+view.dy};
}
const world=(x,y)=>[(x-dims.cx)/dims.s,(dims.cy-y)/dims.s];
const screen=(x,y)=>[dims.cx+x*dims.s,dims.cy-y*dims.s];
function drawPortrait(w,h){
  if(!showPortrait)return;
  const height=Math.min(h-16,(w-16)*16/9),width=height*9/16;
  if(height<=0)return;
  const x=(w-width)/2,y=(h-height)/2;
  ctx.save();
  ctx.fillStyle=game?'#17251db3':'#182820a6';
  ctx.fillRect(0,0,x,h);ctx.fillRect(x+width,0,x,h);
  ctx.fillRect(x,0,width,y);ctx.fillRect(x,y+height,width,y);
  ctx.strokeStyle=game?'#eff8e5a0':'#d4f4dbb0';
  ctx.strokeRect(x+.5,y+.5,width,height);
  ctx.restore();
}
function rotationHandle(bounds){
  const [x,top]=screen(bounds.x,bounds.top),[,bottom]=screen(bounds.x,bounds.bottom);
  const above=top-23,below=bottom+23;
  const clearance=showBoxes&&level.boxes.length?66:12;
  return [x,above>=clearance?above:Math.min(dims.h-12,below)];
}
function resizeHandles(bounds){
  const {left,right,top,bottom}=bounds;
  return [[left,top,right,bottom,'nwse'],[right,top,left,bottom,'nesw'],
    [right,bottom,left,top,'nwse'],[left,bottom,right,top,'nesw']].map(([x,y,px,py,cursor])=>({
    point:screen(x,y),pivot:{x:px,y:py},cursor,
  }));
}
function resizeAt(bounds,sx,sy){
  if(!bounds||marqueeMode)return null;
  const radius=Math.min(8,.28*Math.min(bounds.right-bounds.left,bounds.top-bounds.bottom)*dims.s);
  return resizeHandles(bounds)
    .map(handle=>({handle,dist:Math.hypot(sx-handle.point[0],sy-handle.point[1])}))
    .sort((a,b)=>a.dist-b.dist).find(hit=>hit.dist<=radius)?.handle??null;
}
function drawSelection(){
  if(!canEdit()||!selection.size||templateDrawing)return;
  const projected=drag?.projects;
  const bounds=projected?boundsOf([...projected.values()]):currentBounds();
  const [x,y]=screen(bounds.left,bounds.top),[right,bottom]=screen(bounds.right,bounds.bottom);
  const [hx,hy]=rotationHandle(bounds);
  ctx.save();ctx.strokeStyle=drag?.invalid?'#ffb05e':'#baf2cf';ctx.lineWidth=1.5;
  ctx.setLineDash([4,3]);ctx.strokeRect(x-2,y-2,right-x+4,bottom-y+4);ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(hx,hy<y?y-2:bottom+2);ctx.lineTo(hx,hy);ctx.stroke();
  ctx.beginPath();ctx.arc(hx,hy,6,0,Math.PI*2);ctx.fillStyle='#163b2e';ctx.fill();ctx.stroke();
  for(const {point:[cx,cy]} of resizeHandles(bounds)){
    ctx.fillRect(cx-4,cy-4,8,8);ctx.strokeRect(cx-4,cy-4,8,8);
  }
  const [px,py]=screen(bounds.x,bounds.y);
  ctx.beginPath();ctx.moveTo(px-4,py);ctx.lineTo(px+4,py);ctx.moveTo(px,py-4);ctx.lineTo(px,py+4);ctx.stroke();
  ctx.restore();
}
function draw(){
  if(!level)return;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  if(!w||!h)return;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  dims=makeTransform(w,h);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const {s,cx,cy}=dims,b=level.background,bg=getImage(b.asset);
  const x=cx-b.width*s/2,y=cy-b.height*s/2,bw=b.width*s,bh=b.height*s;
  ctx.fillStyle='#dfd4bc';ctx.fillRect(x,y,bw,bh);
  if(bg.complete&&bg.naturalWidth)ctx.drawImage(bg,x,y,bw,bh);
  ctx.strokeStyle='#ffffff6e';ctx.strokeRect(x,y,bw,bh);
  if(showGrid&&!game){
    ctx.save();ctx.beginPath();ctx.rect(x,y,bw,bh);ctx.clip();const n=s*100;
    if(n>=12){ctx.strokeStyle='#ffffff38';ctx.beginPath();for(let a=cx% n;a<w;a+=n){ctx.moveTo(a,0);ctx.lineTo(a,h)}for(let a=cy%n;a<h;a+=n){ctx.moveTo(0,a);ctx.lineTo(w,a)}ctx.stroke()}
    ctx.strokeStyle='#2e7a61cc';ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(cx,y);ctx.lineTo(cx,y+bh);ctx.moveTo(x,cy);ctx.lineTo(x+bw,cy);ctx.stroke();ctx.restore();
    ctx.fillStyle='#24634b';ctx.beginPath();ctx.arc(cx,cy,3.5,0,Math.PI*2);ctx.fill();
  }
  const items=game?game.items:drawOrder();
  const queued=game&&playMotion?.game===game?new Set(playMotion.queue.filter(effect=>
    (effect.kind==='box'||effect.kind==='tray')&&effect.fromTray===undefined).map(effect=>effect.j)):null;
  items.forEach((original,j)=>{
    const it=drag?.projects?.get(original.uid)??original;
    if(game&&!game.room.has(j)&&!queued?.has(j))return;let [px,py]=screen(it.x,it.y);
    if(flash?.uid===it.uid){const age=performance.now()-flash.at;if(age<280){px+=Math.sin(age/13)*4;schedule()}else flash=null;}
    const img=getImage(it.asset);ctx.save();ctx.translate(px,py);ctx.rotate(-it.angle*Math.PI/180);
    const hintScale=game&&game.state==='playing'&&hintItem===j?1+.08*(.5+.5*Math.sin(performance.now()/250)):1;
    ctx.scale(it.scaleX*hintScale,it.scaleY*hintScale);
    const iw=it.width*s,ih=it.height*s;
    const highlight=!game&&showBoxes&&selectedBox;
    if(highlight&&it.group!==highlight.group)ctx.globalAlpha=.32;
    if(highlight&&it.group===highlight.group){
      ctx.shadowColor='#fff29b';ctx.shadowBlur=11;
    }
    if(templateDrawing)ctx.globalAlpha=.20;
    if(game&&game.state==='playing'&&hintItem===j){
      ctx.shadowColor='#fff46a';ctx.shadowBlur=18+6*Math.sin(performance.now()/250);schedule();
    }
    const hover=game&&playHover?.game===game&&playHover.index===j&&game.canPick(j);
    if(hover&&hintItem!==j){ctx.shadowColor='#fff9bb';ctx.shadowBlur=12;}
    if(img.complete&&img.naturalWidth){
      ctx.drawImage(img,-iw/2,-ih/2,iw,ih);
      if(hover){ctx.shadowBlur=0;ctx.globalCompositeOperation='screen';ctx.globalAlpha=.20;ctx.drawImage(img,-iw/2,-ih/2,iw,ih);}
    }
    if(!game&&!templateDrawing&&selection.has(it.uid)&&selection.size>1){
      ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.strokeStyle='#baf2cf';ctx.lineWidth=1/Math.max(Math.abs(it.scaleX),Math.abs(it.scaleY));
      ctx.strokeRect(-iw/2,-ih/2,iw,ih);
    }
    ctx.restore();
  });
  drawPortrait(w,h);
  if(inspector==='generate'&&!game&&!variantPreview)drawTemplate();
  drawSelection();
  if(drag?.type==='marquee'&&drag.moved){
    const {sx,sy,ex,ey}=drag;
    ctx.fillStyle='#82edb13b';ctx.strokeStyle='#baf2cf';
    ctx.fillRect(sx,sy,ex-sx,ey-sy);ctx.strokeRect(sx,sy,ex-sx,ey-sy);
  }
  const preview=paletteGesture?.moved?paletteGesture.a:pending;
  if(preview&&ghost&&!game&&!drag&&!templateDrawing&&kind==='items'){
    const img=getImage(preview.path);
    const [gx,gy]=screen(ghost.x,ghost.y);
    const d=referenceSize(preview,level.background);
    if(d&&fitsBackground(b,placementAt(ghost,d))){
      if(img.naturalWidth){
        const w=d.w*s,h=d.h*s;
        ctx.save();ctx.globalAlpha=.65;ctx.drawImage(img,gx-w/2,gy-h/2,w,h);ctx.restore();
      }
      ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(gx,gy,8,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
  }
  $('zoomText').textContent=`${Math.round(view.zoom*100)}%`;
}
const pointer=e=>{const r=canvas.getBoundingClientRect();return {sx:e.clientX-r.left,sy:e.clientY-r.top};};
function pointForPlacement(e){
  const r=canvas.getBoundingClientRect(),d=makeTransform(r.width,r.height);
  const x=(e.clientX-r.left-d.cx)/d.s,y=(d.cy-e.clientY+r.top)/d.s;
  return e.shiftKey?{x:Math.round(x/25)*25,y:Math.round(y/25)*25}:{x:ROUND(x),y:ROUND(y)};
}
function overBoard(e){
  const r=canvas.getBoundingClientRect();
  return e.clientX>=r.left&&e.clientX<r.right&&e.clientY>=r.top&&e.clientY<r.bottom;
}
document.addEventListener('pointermove',e=>{
  const g=paletteGesture;if(!g||e.pointerId!==g.id)return;
  if(!g.moved&&Math.hypot(e.clientX-g.sx,e.clientY-g.sy)<5)return;
  if(!g.moved){g.moved=true;chooseArt(g.a);}
  ghost=overBoard(e)?pointForPlacement(e):null;
  schedule();
},true);
function endPalette(e,cancel=false){
  const g=paletteGesture;if(!g||e.pointerId!==g.id)return;
  paletteGesture=null;ghost=null;
  if(!g.moved)return;
  g.tile.suppressClick=true;
  pending=null;renderPlacement();schedule();
  if(!cancel&&g.target===level&&overBoard(e))place(pointForPlacement(e),g.a,g.target);
  else if(!cancel)say(boundaryMessage);
}
document.addEventListener('pointerup',endPalette,true);
document.addEventListener('pointercancel',e=>endPalette(e,true),true);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(!level||playingLoad||drag)return;
  canvas.focus({preventScroll:true});
  const {sx,sy}=pointer(e),[x,y]=world(sx,sy);
  const pan=e.button===1||e.button===2||(space&&e.button===0);
  if(pan){drag={type:'pan',sx,sy,dx:view.dx,dy:view.dy};canvas.classList.add('panning');}
  else if(e.button!==0)return;
  else if(game){tap(x,y);return;}
  else if(variantPreview)return;
  else if(templateDrawing){
    if(templateDrawing.shape==='polygon'){addTemplatePoint(x,y);return;}
    if(templateDrawing.shape==='edge'&&!templateDrawing.asset){say(templateInstructions());return;}
    const start=templatePoint(x,y);
    if(start.some(v=>v<0||v>1)){say('Bắt đầu kéo bên trong ảnh nền.');return;}
    drag={type:'template',sx,sy,start,end:start};
  }
  else{
    const bounds=currentBounds(),group=bounds&&rotationHandle(bounds);
    const grabRotation=group&&Math.hypot(sx-group[0],sy-group[1])<=11;
    const resize=resizeAt(bounds,sx,sy);
    const stack=drawOrder(),selected=stack.filter(it=>selection.has(it.uid));
    const selectedHit=itemAt(selected,x,y,masks)||itemAt(selected,x,y,boundsOnly);
    const found=selectedHit||itemAt(stack,x,y,masks)||itemAt(stack,x,y,boundsOnly);
    const placement=kind==='items'?pending:null;
    const multi=e.shiftKey||e.ctrlKey||e.metaKey;
    if(grabRotation&&!marqueeMode){
      cancelPlacement();
      drag={type:'rotate',sx,sy,pivot:bounds,startAngle:Math.atan2(y-bounds.y,x-bounds.x),items:chosen()};
    }else if(resize){
      cancelPlacement();
      const {pivot,point,cursor}=resize,[px,py]=screen(pivot.x,pivot.y);
      const vx=point[0]-px,vy=point[1]-py,items=chosen();
      const scales=items.flatMap(it=>[Math.abs(it.scaleX),Math.abs(it.scaleY)]);
      drag={type:'resize',sx,sy,pivot,vx,vy,items,min:Math.max(.02,.0001/Math.min(...scales)),max:1000/Math.max(...scales)};
      canvas.dataset.resize=cursor;
    }else if(marqueeMode||(!found&&(!placement||multi))){
      cancelPlacement();
      drag={type:'marquee',sx,sy,ex:sx,ey:sy,base:multi?selection:new Set(),toggle:e.ctrlKey||e.metaKey};
    }else if(found){
      if(e.ctrlKey||e.metaKey||(e.shiftKey&&!selection.has(found.uid))){
        cancelPlacement();selectItem(found.uid,true);return;
      }
      if(!selection.has(found.uid))selectItem(found.uid,false);
      drag={type:'move',sx,sy,anchor:found,items:chosen(),scale:dims.s,placement,toggle:e.shiftKey};
    }else drag={type:'place',placement};
  }
  drag.id=e.pointerId;
  canvas.setPointerCapture(e.pointerId);e.preventDefault();
});
function moveGesture(g,e,sx,sy){
  if(g.type==='pan'){view.dx=g.dx+sx-g.sx;view.dy=g.dy+sy-g.sy;return;}
  if(!g.moved&&Math.hypot(sx-g.sx,sy-g.sy)<3)return;
  g.moved=true;
  if(g.type==='marquee'){g.ex=sx;g.ey=sy;return;}
  if(g.type==='template'){
    g.end=templatePoint(...world(sx,sy)).map(v=>Math.min(1,Math.max(0,v)));
    return;
  }
  if(!['move','rotate','resize'].includes(g.type))return;
  canvas.classList.add('transforming');
  cancelPlacement();
  let results;
  if(g.type==='rotate'){
    const [x,y]=world(sx,sy);
    let angle=angleFor((Math.atan2(y-g.pivot.y,x-g.pivot.x)-g.startAngle)*180/Math.PI);
    if(e.shiftKey)angle=Math.round(angle/15)*15;
    results=g.items.map(it=>rotateAround(it,g.pivot,angle));
  }else if(g.type==='resize'){
    let factor=1+((sx-g.sx)*g.vx+(sy-g.sy)*g.vy)/(g.vx*g.vx+g.vy*g.vy);
    if(e.shiftKey)factor=Math.round(factor*10)/10;
    factor=Math.min(g.max,Math.max(g.min,factor));
    results=g.items.map(it=>scaleAround(it,g.pivot,factor));
  }else{
    let dx=(sx-g.sx)/g.scale,dy=(g.sy-sy)/g.scale;
    if(e.shiftKey){
      dx=Math.round((g.anchor.x+dx)/25)*25-g.anchor.x;
      dy=Math.round((g.anchor.y+dy)/25)*25-g.anchor.y;
    }
    results=g.items.map(it=>translate(it,dx,dy));
  }
  g.invalid=results.some(it=>!fitsBackground(level.background,it));
  g.projects=new Map(results.map(it=>[it.uid,it]));
  if(results.length===1&&inspector==='layer'){
    for(const key of ['x','y','angle','scaleX','scaleY'])$(key).value=results[0][key];
  }
}
canvas.addEventListener('pointermove',e=>{
  if(!level)return;const {sx,sy}=pointer(e),[x,y]=world(sx,sy);$('coord').textContent=`X ${Math.round(x)} · Y ${Math.round(y)}`;
  if(!drag){
    if(game){updatePlayHover(x,y);return;}
    if(pending&&kind==='items'&&!game){ghost=pointForPlacement(e);schedule();}
    const b=currentBounds(),handle=b&&rotationHandle(b);
    const resize=canEdit()&&!templateDrawing&&resizeAt(b,sx,sy);
    if(resize)canvas.dataset.resize=resize.cursor;else delete canvas.dataset.resize;
    canvas.classList.toggle('rotate-ready',!!(canEdit()&&!marqueeMode&&!templateDrawing&&handle&&Math.hypot(sx-handle[0],sy-handle[1])<=11));
    return;
  }
  if(drag.id!==e.pointerId)return;
  moveGesture(drag,e,sx,sy);
  schedule();
});
canvas.addEventListener('pointerleave',()=>{ghost=null;playHover=null;canvas.classList.remove('rotate-ready');if(drag?.type!=='resize')delete canvas.dataset.resize;schedule();});
function finishMarquee(g){
  const next=new Set(g.base);
  if(g.moved){
    const [ax,ay]=world(g.sx,g.sy),[bx,by]=world(g.ex,g.ey);
    for(const it of level.items){
      const b=itemBounds(it);
      if(b.right<Math.min(ax,bx)||b.left>Math.max(ax,bx)||b.top<Math.min(ay,by)||b.bottom>Math.max(ay,by))continue;
      if(g.toggle&&next.has(it.uid))next.delete(it.uid);else next.add(it.uid);
    }
  }
  setSelection(next);
  if(marqueeMode&&g.moved)setMarquee(false);
}
function endDrag(e,cancel=false){
  const g=drag;
  if(!g||(e&&e.pointerId!==g.id))return;
  if(!cancel){const {sx,sy}=pointer(e);moveGesture(g,e,sx,sy);}
  drag=null;canvas.classList.remove('panning','transforming','rotate-ready');
  delete canvas.dataset.resize;
  if(canvas.hasPointerCapture(g.id))canvas.releasePointerCapture(g.id);
  if(!cancel&&g.type==='template'&&g.moved&&templateDrawing){
    templateDrawing.points=templateDragPoints(g);
    finishTemplate();
  }else if(!cancel&&['move','rotate','resize'].includes(g.type)&&g.moved){
    if(g.invalid||(g.type==='move'&&!overBoard(e)))say(boundaryMessage);
    else applyTransforms(g.items,[...g.projects.values()]);
  }else if(!cancel&&g.type==='marquee'){
    finishMarquee(g);
  }else if(!cancel&&g.type==='move'){
    if(g.toggle)selectItem(g.anchor.uid,true);
    else if(g.placement&&overBoard(e)){ghost=null;place(pointForPlacement(e),g.placement,level);}
    else if(selection.size>1)selectItem(g.anchor.uid,false);
  }else if(!cancel&&g.placement&&overBoard(e)){
    ghost=null;place(pointForPlacement(e),g.placement,level);
  }
  if((cancel||g.invalid||g.type==='move'&&!overBoard(e))&&g.projects&&g.items.length===1){
    const original=g.items[0];
    for(const key of ['x','y','angle','scaleX','scaleY'])$(key).value=original[key];
  }
  schedule();
}
canvas.addEventListener('pointerup',e=>endDrag(e));canvas.addEventListener('pointercancel',e=>endDrag(e,true));
canvas.addEventListener('lostpointercapture',e=>endDrag(e,true));
canvas.addEventListener('wheel',e=>{
  if(!level)return;e.preventDefault();if(drag)return;
  const {sx,sy}=pointer(e),current=makeTransform(canvas.clientWidth,canvas.clientHeight);
  const x=(sx-current.cx)/current.s,y=(current.cy-sy)/current.s;
  view.zoom=Math.max(.32,Math.min(8,view.zoom*Math.exp(-e.deltaY*.0018)));
  const d=makeTransform(current.w,current.h);view.dx=sx-d.w/2-x*d.s;view.dy=sy-d.h/2+y*d.s;schedule();
},{passive:false});
new ResizeObserver(schedule).observe($('viewport'));

async function startPlay(){
  if(!level||playingLoad||generationBusy||drag)return;if(game){clearHint();game=null;botReplay=null;render();say('Đã về chế độ xếp đồ.');return;}
  if(!check(level).ok){templateDrawing=null;inspector='box';renderPlacement();renderPanel();say('Số chỗ trong hộp phải khớp số đồ của từng nhóm. Xem mục Hộp & luật.');return;}
  playingLoad=true;say('Đang nạp viền sprite để playtest…');
  try{
    const target=level;await Promise.all([...new Set(level.items.map(i=>i.asset))].map(getMask));if(level!==target)return;
    pending=null;paletteGesture=null;ghost=null;templateDrawing=null;game=new Playtest(clone(level),masks);resetHint();render();drawPalette();say('Bấm đồ không bị đè để dọn. Có 2 hộp mở và 5 slot chờ.');
  }catch(e){say(e.message)}finally{playingLoad=false;}
}
function boxCard(order,count,position){
  const editor=position!==undefined;
  const card=create(editor?'button':'div',undefined,'test-box'),icon=create('div',undefined,'box-art');
  if(!level.background.asset.startsWith('Art/RoomSortOffline/')&&catalog.ui.GP_Box0)
    icon.style.backgroundImage=`url("${assetURL(catalog.ui.GP_Box0)}")`;
  const it=order&&level.items.find(i=>i.group===order.group);
  if(it)icon.append(thumb(it.asset));
  const text=create('span');
  const amount=order?`${count}/${order.count}`:'';
  text.append(create('strong',order?.label||'Đã xong'),create('span',editor?`${position} · ${order.count} chỗ`:amount,'box-amount'));
  if(order)card.title=order.label;
  if(editor){
    card.type='button';
    card.dataset.boxIndex=position-1;
    card.draggable=!!canEdit()&&level.boxes.length>1;
    icon.querySelector('img')?.setAttribute('draggable','false');
    card.onclick=()=>{
      selectedBox=selectedBox===order?null:order;
      renderBoxMatch();schedule();
    };
  }
  card.append(icon,text);
  return card;
}
function renderBoxMatch(){
  const message=$('boxMatch'),boxes=$('testBoxes');
  Array.from(boxes.children).forEach((card,i)=>card.setAttribute('aria-pressed',String(level.boxes[i]===selectedBox)));
  message.hidden=!selectedBox||boxes.hidden;
  if(message.hidden)return;
  const group=selectedBox.group;
  const have=level.items.filter(it=>it.group===group).length;
  const capacity=level.boxes.filter(box=>box.group===group).reduce((n,box)=>n+box.count,0);
  const prior=level.boxes.slice(0,level.boxes.indexOf(selectedBox))
    .filter(box=>box.group===group).reduce((n,box)=>n+box.count,0);
  const forBox=Math.min(selectedBox.count,Math.max(0,have-prior));
  const delta=have-capacity;
  const status=delta===0?'Vừa đủ':delta<0?`Thiếu ${-delta} món`:`Thừa ${delta} món`;
  message.classList.toggle('mismatch',delta!==0);
  message.textContent=`${selectedBox.label} · Hộp này ${forBox}/${selectedBox.count} món theo lượt · Cả nhóm ${have}/${capacity} món · ${status}`;
}
function renderBoxPreview(){
  const boxes=$('testBoxes');
  const left=boxPreviewLevel===level?boxes.scrollLeft:0;
  boxPreviewLevel=level;
  if(!level.boxes.includes(selectedBox))selectedBox=null;
  boxes.hidden=!showBoxes||!level.boxes.length;$('testTray').hidden=true;
  boxes.classList.add('editor-boxes');
  boxes.setAttribute('aria-label','Thứ tự mở hộp');boxes.tabIndex=0;
  boxes.replaceChildren();
  if(!boxes.hidden){
    boxes.append(...level.boxes.map((order,i)=>boxCard(order,0,i+1)));
    boxes.scrollLeft=left;
  }
  renderBoxMatch();
}
function renderPlay(){
  $('runBot').disabled=botJob===game;
  $('stepBot').hidden=!botReplay || botReplay.index>=botReplay.points.length;
  if(playMotion?.game===game)return;
  clearPlayMotion();
  renderPlayHud(game);
  const done=$('finish');done.hidden=game.state==='playing';
  if(!done.hidden)done.replaceChildren(create('strong',game.state==='win'?'Đã dọn sạch!':'Hết chỗ trong khay'),create('div',`${game.moves} lượt · Khay cao nhất ${game.peak}/5`),btn('Chơi lại',restart));
}
function renderPlayHud({boxes:openBoxes,tray:waiting}){
  const boxes=$('testBoxes'),tray=$('testTray');
  boxes.hidden=false;tray.hidden=false;
  $('boxMatch').hidden=true;
  boxes.classList.remove('editor-boxes');
  boxes.setAttribute('aria-label','Hộp đang mở');boxes.removeAttribute('tabindex');
  boxes.replaceChildren(...openBoxes.map(b=>{
    const order=game.order(b),card=boxCard(order,b.count);
    if(!order)card.classList.add('empty-box-slot');
    return card;
  }));
  tray.replaceChildren();
  for(let i=0;i<5;i++){const cell=create('div',undefined,'slot');cell.title=`Slot chờ ${i+1}`;
    if(!level.background.asset.startsWith('Art/RoomSortOffline/')&&catalog.ui.GP_Slot)cell.style.backgroundImage=`url("${assetURL(catalog.ui.GP_Slot)}")`;
    if(waiting[i]!==undefined)cell.append(thumb(game.items[waiting[i]].asset));tray.append(cell);
  }
}
function clearPlayMotion(){
  if(!playMotion)return;
  const motion=playMotion;playMotion=null;
  for(const anim of motion.animations)anim.cancel();
  motion.sprite?.remove();
}
function updatePlayHover(x,y){
  if(!game)return;
  const index=!space&&game.state==='playing'?game.itemAt(x,y):null;
  const next=index!==null&&game.canPick(index)?index:null;
  if((playHover?.game===game?playHover.index:null)!==next){
    playHover=next===null?null:{game,index:next};schedule();
  }
}
async function animatePlay(motion,element,frames,duration){
  if(!element?.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const speed=motion.queue.length>=5?.45:motion.queue.length>=2?.70:1;
  const anim=element.animate(frames,{duration:Math.round(duration*speed),fill:'forwards'});
  motion.animations.add(anim);
  try{await anim.finished;}catch{}finally{motion.animations.delete(anim);anim.cancel();}
}
function viewportCenter(element){
  const box=element.getBoundingClientRect(),view=$('viewport').getBoundingClientRect();
  return {x:box.left-view.left+box.width/2,y:box.top-view.top+box.height/2,w:box.width,h:box.height};
}
async function flyPlayItem(motion,effect,destination){
  if(!destination||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const it=motion.game.items[effect.j];
  const [x,y]=screen(it.x,it.y);
  const cell=$('testTray').children[effect.fromTray]?.firstElementChild;
  const start=cell?viewportCenter(cell):{x,y,w:Math.abs(it.width*it.scaleX*dims.s),h:Math.abs(it.height*it.scaleY*dims.s)};
  const end=viewportCenter(destination),arc=Math.min(48,Math.max(12,Math.abs(end.x-start.x)*.13));
  const size=Math.min(end.w/start.w,end.h/start.h,.82);
  const angle=cell?0:-it.angle;
  const flipX=cell?1:Math.sign(it.scaleX),flipY=cell?1:Math.sign(it.scaleY);
  const pose=(x,y,scale,angle)=>`translate(${x}px,${y}px) translate(-50%,-50%) rotate(${angle}deg) scale(${scale*flipX},${scale*flipY})`;
  const sprite=thumb(it.asset);sprite.className='play-flight';sprite.loading='eager';
  sprite.style.width=`${start.w}px`;sprite.style.height=`${start.h}px`;
  sprite.style.transform=pose(start.x,start.y,1,angle);
  if(cell)cell.style.visibility='hidden';
  motion.sprite=sprite;$('viewport').append(sprite);
  await animatePlay(motion,sprite,[
    {transform:pose(start.x,start.y,1,angle),opacity:1,easing:'cubic-bezier(.18,.5,.47,1)'},
    {offset:.48,transform:pose((start.x+end.x)/2,(start.y+end.y)/2-arc,Math.max(.58,size),angle*.4),opacity:1,easing:'ease-in'},
    {offset:.86,transform:pose(end.x,end.y,size,0),opacity:1},
    {transform:pose(end.x,end.y,size*.5,0),opacity:0},
  ],260);
  sprite.remove();motion.sprite=null;
}
async function runPlayMotion(motion){
  try{
    while(playMotion===motion&&motion.queue.length){
      const effect=motion.queue.shift();
      schedule();
      const box=$('testBoxes').children[effect.slot];
      if(effect.kind==='complete'){
        await animatePlay(motion,box,[{transform:'scale(1)'},{offset:.26,transform:'scale(1.09)'},
          {transform:'translateY(-20px) scale(.72)',opacity:0,easing:'ease-in'}],210);
        if(playMotion!==motion)return;
        motion.boxes[effect.slot]={index:effect.index,count:0};renderPlayHud(motion);
        if(effect.index>=0)await animatePlay(motion,$('testBoxes').children[effect.slot],
          [{transform:'translateY(-14px) scale(.88)',opacity:0},{transform:'scale(1.04)',opacity:1},{transform:'scale(1)',opacity:1}],155);
      }else{
        const destination=effect.kind==='box'?box?.querySelector('.box-art'):$('testTray').children[effect.slot];
        await flyPlayItem(motion,effect,destination);
        if(playMotion!==motion)return;
        if(effect.kind==='box'){
          motion.boxes[effect.slot].count=effect.count;
          if(effect.fromTray!==undefined)motion.tray.splice(effect.fromTray,1);
        }else motion.tray.push(effect.j);
        renderPlayHud(motion);
      }
    }
  }finally{
    if(playMotion===motion){clearPlayMotion();renderPlay();schedule();}
  }
}
function clearHint(){clearTimeout(hintTimer);hintTimer=null;hintItem=null;}
function resetHint(){
  clearHint();
  if(!hintEnabled||!game||game.state!=='playing')return;
  const target=game;
  hintTimer=setTimeout(()=>{
    hintTimer=null;
    if(game!==target||!hintEnabled||target.state!=='playing')return;
    hintItem=[...target.room].find(i=>target.box(target.items[i].group)>=0&&target.pointFor(i))??null;
    schedule();
  },3000);
}
function restart(){if(!game)return;game=new Playtest(clone(level),masks);botReplay=null;flash=null;resetHint();renderPlay();schedule();say('Đã bắt đầu lại màn.');}
async function runBot(){
  if(!game||botJob===game)return;
  const target=game,doc=target.level;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  botJob=target;botReplay=null;renderPlay();say('Đang phân tích đường gỡ các lớp đồ…');
  try{
    await frame();
    if(game!==target)return;
    const model=TidyBot.fromPlaytest(target),passes=[];
    for(const policy of ['visible','chain','branch']){
      for(let seed=41;seed<45;seed++){
        await frame();
        if(game!==target)return;
        passes.push({policy,...model.run({policy,seed})});
      }
    }
    const options=passes.filter(run=>run.won).sort((a,b)=>a.peak-b.peak||a.waits-b.waits);
    let selected=null;
    const verify=route=>{
      const proof=TidyGenerator.verifyRoute(doc,masks,doc.boxes,route.path,target.cache);
      return proof?{route,proof}:null;
    };
    const stored=Offline.proofRoute(doc);
    if(stored)selected=verify({path:stored});
    for(const route of options){
      if(selected)break;
      selected=verify(route);
    }
    if(!selected){
      await frame();
      if(game!==target)return;
      const search=model.findRoute();
      if(search)selected=verify(search);
    }
    const summary=['visible','chain','branch'].map((policy,i)=>
      `${['Gỡ 1 lớp','Gỡ theo chuỗi','Thử nhánh'][i]} ${passes.filter(run=>run.policy===policy&&run.won).length}/4`).join(' · ');
    if(selected){
      const {route,proof}=selected;
      const recovery=model.recovery(route.path);
      botReplay={points:proof.points,index:0};
      const sensitivity=recovery.samples.length ? ` · Cứu được ${recovery.samples.filter(test=>test.recovered).length}/${recovery.samples.length} nước lệch đã thử` : '';
      say(`${summary} · Đường thắng đã kiểm, khay tối đa ${proof.peak}/5${sensitivity}.`);
      return;
    }
    const best=Math.max(...passes.map(run=>run.picked));
    say(`${summary} · Chưa tìm được đường thắng bấm được. Bot dọn tối đa ${best}/${target.items.length} món.`);
  }catch(error){if(game===target)say(error.message);}
  finally{if(botJob===target)botJob=null;if(game===target)renderPlay();}
}
function stepBot(){
  if(!botReplay || botReplay.index>=botReplay.points.length)return;
  if(!botReplay.index){game=new Playtest(clone(level),masks);flash=null;resetHint();renderPlay();}
  const [x,y]=botReplay.points[botReplay.index++];
  tap(x,y,true,true);
}
function tap(x,y,bot=false,animate=!bot){
  if(!bot)botReplay=null;
  playHover=null;
  if(playMotion?.game!==game||!animate)clearPlayMotion();
  const effects=animate?[]:undefined;
  const before=effects&&!playMotion?{game,boxes:game.boxes.map(b=>({...b})),tray:[...game.tray],queue:[],animations:new Set()}:null;
  const r=game.tapAt(x,y,effects);
  if(effects?.length){
    if(before)playMotion=before;
    playMotion.queue.push(...effects);
    if(before)void runPlayMotion(before);
  }
  if(r.kind==='box'||r.kind==='tray')resetHint();
  if(r.kind==='blocked'){flash={uid:game.items[r.j].uid,at:performance.now()};say('Món này đang bị đè. Dọn món phía trên trước.');}
  else if(r.kind==='full')say('Khay đầy. Hãy lấy món vào thẳng hộp đang mở.');
  else if(r.kind==='box'||r.kind==='tray')say(`${game.room.size} món trên nền · ${game.tray.length}/5 slot chờ · ${game.delivered}/${game.items.length} đã vào hộp.`);
  renderPlay();schedule();
}

function openReport(){
  if(!batch)return;const fail=batch.rejected||[],warnings=batch.levels.flatMap(l=>(l.origin?.warnings||[]).map(w=>({file:l.name,error:w})));
  $('reportSummary').textContent=`${batch.levels.length} màn nhập được · ${fail.length} lỗi đọc · ${warnings.length} lưu ý`;
  $('reportRows').replaceChildren(...[...fail,...warnings].map(r=>create('div',`${r.file}${r.level?' · '+r.level:''}: ${r.error}`,'report-row')));
  $('reportDialog').showModal();
}
async function importPack(job,status=$('importStatus'),targets={}){
  if(busyImport||variantJob||variantPreview||game||playingLoad)return;busyImport=true;status.textContent='Đang chuyển level và kiểm tra asset…';
  for(const k of ['allRoom','allHappy','allGdd','allTidy','chooseFiles'])$(k).disabled=true;
  try{
    const p=await job();
    if(!p.levels.length){
      const first=p.rejected.slice(0,3).map(x=>`${x.file}: ${x.error}`).join('\n');status.textContent=`Không nhập được màn nào.\n${first}`;
      if(p.rejected.length){const b=btn('Tải báo cáo lỗi',()=>download('import-report.json',p));status.append(document.createElement('br'),b);}return;
    }
    batch=p;batchFileTargets=[targets];$('batchLevel').replaceChildren();openLevel(clone(p.levels[0]),0);drawPalette();$('loadDialog').close();
    status.hidden=status===$('jsonImportStatus');
    say(`Đã nhập ${p.levels.length} màn${p.rejected.length?` · ${p.rejected.length} lỗi` : ''}. Chọn màn ở hàng phía trên.`);
    if(p.rejected.length)openReport();
  }catch(e){status.textContent=e.message;}finally{
    busyImport=false;for(const k of ['allGdd','allTidy','chooseFiles'])$(k).disabled=false;
    $('allRoom').disabled=!Offline.sources.roomsort.length;$('allHappy').disabled=!Offline.sources.happy.length;
  }
}
function source(kind,key=''){return importPack(()=>Offline.library(kind,key));}
async function readBundledPack(filename,variable,key){
    const script=document.createElement('script');
    const encoded=await new Promise((resolve,reject)=>{
      script.src=`./data/${filename}`;
      script.onload=()=>{
        const payload=window[variable];
        delete window[variable];
        script.remove();
        if(payload)resolve(payload);
        else reject(Error('File dữ liệu chưa có nội dung.'));
      };
      script.onerror=()=>{
        script.remove();
        reject(Error(`Không mở được data/${filename}. Kiểm tra thư mục data của tool.`));
      };
      document.head.append(script);
    });
    const binary=atob(encoded);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const pack=await Offline.importFiles([new File([bytes],`${key}.json.gz`)],'auto');
    pack.key=key;
    return pack;
}
const gddBundle=['gdd-137.js','TIDY_GDD_PACK_GZIP','roomsort-tidy57-gdd-137'];
const tidyBundle=['tidy57-100.js','TIDY_TIDY57_PACK_GZIP','tidy57-original-100'];
let gddPackRequest;
function readGddPack(){
  return gddPackRequest??=readBundledPack(...gddBundle).catch(error=>{gddPackRequest=null;throw error;});
}
const openGddPack=()=>importPack(async()=>clone(await readGddPack()));
const assetLevelPacks=new Map();
function readAssetLevelPack(key){
  if(!assetLevelPacks.has(key)){
    const request=Promise.resolve().then(()=>{
      if(key==='gdd')return readGddPack();
      if(key==='tidy')return readBundledPack(...tidyBundle);
      return Offline.library(key);
    }).catch(error=>{assetLevelPacks.delete(key);throw error;});
    assetLevelPacks.set(key,request);
  }
  return assetLevelPacks.get(key);
}
async function selectAssetLevelPack(){
  const packKey=$('assetLevelPack').value,selector=$('assetLevelNumber');
  assetLevelPack=null;assetLevelError='';selector.disabled=true;
  selector.replaceChildren(option('','Đang nạp…'));drawPalette(true);
  try{
    const pack=await readAssetLevelPack(packKey);
    if($('assetLevelPack').value!==packKey)return;
    if(!pack.levels.length)throw Error('Bộ này chưa có màn để xem asset.');
    assetLevelPack=pack;
    selector.replaceChildren(...pack.levels.map((doc,i)=>option(i,`${i+1}. ${doc.name}`)));
    selector.disabled=false;
  }catch(error){
    if($('assetLevelPack').value!==packKey)return;
    assetLevelError=error.message;selector.replaceChildren(option('','Chưa có màn'));
  }
  if(assetTab==='levelAssetsTab')drawPalette(true);
}
async function refreshGddCatalog(){
  gddCatalogError='';
  drawPalette();
  if(kind!=='items'||assetTab==='levelAssetsTab'||gddItemPaths)return;
  try{
    const pack=await readGddPack();
    if(pack.levels.length!==137||pack.rejected.length)throw Error('Không đọc đủ 137 level để lọc ảnh.');
    gddItemPaths=new Set(pack.levels.flatMap(l=>l.items.map(it=>it.asset)));
  }catch(error){gddCatalogError=error.message;}
  if(kind==='items')drawPalette();
}
function openLinkedGddPack(){
  if(location.hash!=='#gdd-137'||busyImport||variantJob||variantPreview)return;
  if(!$('loadDialog').open)$('library').click();
  return openGddPack();
}
function importFiles(files,mode=$('source').value,status=$('importStatus'),handle){
  const selectedFiles=[...files].filter(f=>/\.(json(?:\.gz)?|zip)$/i.test(f.name));
  if(!selectedFiles.length){status.textContent='Không tìm thấy JSON, JSON.GZ hoặc ZIP.';return;}
  if(selectedFiles.length>2000||selectedFiles.reduce((n,f)=>n+f.size,0)>96*1024*1024){status.textContent='Tối đa 2000 file / 96 MB mỗi lượt.';return;}
  const targets={};
  const remember=handle?format=>{targets[format]=handle;}:undefined;
  return importPack(()=>Offline.importFiles(selectedFiles,mode,remember),status,targets);
}

async function pickLevelFiles(input,mode,status){
  if(!canEdit()||busyImport)return;
  if(!window.showOpenFilePicker){input.click();return;}
  try{
    const handles=await window.showOpenFilePicker({multiple:true,types:[
      jsonFileType,{description:'Level nén',accept:{'application/gzip':['.gz'],'application/zip':['.zip']}},
    ]});
    const files=await Promise.all(handles.map(handle=>handle.getFile()));
    if(!files.length||!canEdit()||busyImport)return;
    status.hidden=false;
    await importFiles(files,mode,status,handles.length===1?handles[0]:undefined);
  }catch(error){
    if(error.name==='AbortError')return;
    if(error.name==='SecurityError'||error.name==='NotSupportedError'){input.click();return;}
    status.hidden=false;status.textContent=error.message;
  }
}

function bindSidebarResize(id,property,direction,min,max){
  const handle=$(id),shell=handle.closest('.shell'),panel=handle.closest('.sidebar');
  const other=shell.querySelector(direction===1?'.inspect':'.assets');
  let gesture=null;
  const width=()=>Math.round(panel.getBoundingClientRect().width);
  function resize(value){
    const style=getComputedStyle(shell);
    const room=shell.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)
      -2*parseFloat(style.columnGap)-parseFloat(style.getPropertyValue('--canvas-min'))
      -other.getBoundingClientRect().width;
    shell.style.setProperty(property,`${Math.round(Math.max(min,Math.min(max,room,value)))}px`);
    handle.setAttribute('aria-valuenow',String(width()));
  }
  handle.setAttribute('aria-valuemin',String(min));
  handle.setAttribute('aria-valuemax',String(max));
  const observer=new ResizeObserver(()=>handle.setAttribute('aria-valuenow',String(width())));
  observer.observe(panel);
  handle.onpointerdown=event=>{
    if(event.button!==0||gesture)return;
    gesture={id:event.pointerId,x:event.clientX,width:width()};
    handle.setPointerCapture(event.pointerId);
    shell.classList.add('sidebar-resizing');handle.classList.add('resizing');
    event.preventDefault();
  };
  handle.onpointermove=event=>{
    if(gesture?.id===event.pointerId)resize(gesture.width+direction*(event.clientX-gesture.x));
  };
  const finish=event=>{
    if(gesture?.id!==event.pointerId)return;
    gesture=null;shell.classList.remove('sidebar-resizing');handle.classList.remove('resizing');
  };
  handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=finish;
  handle.onkeydown=event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    const before=width();
    resize(before+direction*(event.key==='ArrowLeft'?-16:16));
    event.preventDefault();
  };
}
function bind(){
  bindSidebarResize('resizeCatalog','--catalog-width',1,170,540);
  bindSidebarResize('resizeInspector','--inspector-resized',-1,220,640);
  bindLayerDrag();
  bindBoxDrag($('orders'),false);
  bindBoxDrag($('testBoxes'),true);
  for(const id of ['itemsTab','bgTab','unusedTab','levelAssetsTab'])$(id).onclick=()=>{
    kind=id==='bgTab'?'backgrounds':'items';
    assetTab=id;
    cancelPlacement();
    assetPage=0;
    if(id==='levelAssetsTab'&&!assetLevelPack)return selectAssetLevelPack();
    return refreshGddCatalog();
  };
  $('assetLevelPack').onchange=()=>{cancelPlacement();return selectAssetLevelPack();};
  $('assetLevelNumber').onchange=()=>{cancelPlacement();drawPalette(true);};
  $('groupFilter').onchange=()=>drawPalette(true);
  $('search').oninput=()=>drawPalette(true);$('assetPrev').onclick=()=>{assetPage--;drawPalette()};$('assetNext').onclick=()=>{assetPage++;drawPalette()};
  for(const tab of inspectorTabs)$(`${tab}Tab`).onclick=()=>{if(tab!=='generate')templateDrawing=null;inspector=tab;renderPlacement();renderPanel();schedule();};
  $('new').onclick=()=>{if(level.items.length&&!confirm('Mở màn mới? Lưu JSON trước nếu cần giữ bản hiện tại.'))return;batch=null;batchFileTargets=[];openLevel(newLevel());drawPalette();say('Chọn ảnh nền và đồ vật ở cột bên trái.');};
  $('title').onchange=()=>{const name=$('title').value.trim();if(name)patch(()=>{level.name=name;level.key=slug(name)});$('title').value=level.name;};
  $('undo').onclick=()=>rewind(true);$('redo').onclick=()=>rewind(false);
  $('center').onclick=()=>{
    if(!level)return;
    const w=canvas.clientWidth,h=canvas.clientHeight,b=level.background;
    const base=Math.min(Math.max(1,w-44)/b.width,Math.max(1,h-40)/b.height);
    view={zoom:h/b.height/base,dx:0,dy:0};
    schedule();
  };
  $('editHelp').onclick=()=>$('editorHelp').showModal();
  $('portrait').onclick=()=>{
    showPortrait=!showPortrait;$('portrait').classList.toggle('active',showPortrait);
    $('portrait').setAttribute('aria-pressed',String(showPortrait));schedule();
  };
  $('placeCenter').onclick=()=>{if(pending&&!game){ghost=null;place({x:0,y:0},pending,level);}};
  $('grid').onclick=()=>{showGrid=!showGrid;$('grid').classList.toggle('active',showGrid);$('grid').setAttribute('aria-pressed',showGrid);schedule()};
  $('toggleBoxes').onclick=()=>{
    showBoxes=!showBoxes;$('toggleBoxes').classList.toggle('active',showBoxes);
    $('toggleBoxes').setAttribute('aria-pressed',String(showBoxes));renderBoxPreview();schedule();
  };
  $('testBoxes').addEventListener('wheel',e=>{
    const row=e.currentTarget;
    if(game||e.ctrlKey||row.scrollWidth<=row.clientWidth||Math.abs(e.deltaX)>=Math.abs(e.deltaY))return;
    const unit=e.deltaMode===1?16:e.deltaMode===2?row.clientWidth:1;
    row.scrollLeft+=e.deltaY*unit;e.preventDefault();
  },{passive:false});
  $('layerBack').onclick=()=>arrange(-1);$('layerFront').onclick=()=>arrange(1);$('delete').onclick=removeItem;$('duplicate').onclick=duplicate;
  $('turnLeft').onclick=()=>turn(15);$('turnRight').onclick=()=>turn(-15);
  $('focusSelection').onclick=focusSelection;
  $('flipX').onclick=()=>flip('x');$('flipY').onclick=()=>flip('y');
  $('shrinkGroup').onclick=()=>scaleSelection(.9);$('growGroup').onclick=()=>scaleSelection(1.1);
  $('alignGroup').onchange=e=>{if(e.target.value)align(e.target.value);e.target.value='';};
  $('fitItem').onclick=()=>resetSize(chosen());$('fitAll').onclick=()=>{if(level)resetSize([...level.items]);};
  for(const k of ['x','y','angle','scaleX','scaleY'])$(k).onchange=()=>{
    const it=item(),n=+$(k).value,scale=k.startsWith('scale');if(!it)return;
    if($(k).value!==''&&Number.isFinite(n)&&Math.abs(n)<=(scale?1000:1e7)&&(!scale||Math.abs(n)>=.0001)){
      const value=ROUND(n)||(scale?n:0);
      if(fitsBackground(level.background,{...it,[k]:value}))patch(()=>it[k]=value);
      else say(boundaryMessage);
    }
    $(k).value=it[k];
  };
  $('itemGroup').onchange=()=>{const it=item();if(!it)return;const g=+$('itemGroup').value;patch(()=>{it.group=g;it.targetType=level.boxes.find(o=>o.group===g)?.targetType??level.items.find(i=>i!==it&&i.group===g)?.targetType??g;});};
  $('rule').onchange=()=>patch(()=>level.rule=$('rule').value);
  $('addBox').onclick=()=>{const group=+$('groupOrder').value;patch(()=>level.boxes.push({group,targetType:level.items.find(i=>i.group===group)?.targetType??group,label:label(group),count:1}));};
  $('fillBoxes').onclick=()=>generate(false);
  $('openVariants').onclick=openVariants;
  $('variantOne').onclick=()=>createVariants(false);
  $('variantAll').onclick=()=>createVariants(true);
  $('variantCompare').onclick=()=>{
    const preview=variantPreview;
    if(!preview||game||playingLoad)return;
    preview.showOriginal=!preview.showOriginal;
    showVariantBoard(preview.showOriginal?preview.source:preview.result.doc);
  };
  $('variantSave').onclick=()=>finishVariantPreview(true);
  $('variantDiscard').onclick=()=>finishVariantPreview(false);
  $('cancelVariants').onclick=()=>{
    if(variantJob){variantJob.cancelled=true;$('cancelVariants').disabled=true;}
  };
  $('variantDialog').addEventListener('cancel',e=>{
    if(variantJob){e.preventDefault();$('cancelVariants').click();}
  });
  $('downloadVariants').onclick=()=>{
    if(variantPack)saveLevelData(variantPack.key+'.json',()=>Offline.compactPack(variantPack),1);
  };
  $('scatter').onclick=()=>generate(true);
  $('scatterMode').onchange=()=>renderGenerator();
  $('clearScatterGroups').onclick=()=>{scatterGroups.clear();renderGenerator();};
  $('addZone').onclick=()=>beginTemplate('rect');$('addEdge').onclick=()=>beginTemplate('edge');
  $('addPolygon').onclick=()=>beginTemplate('polygon');
  $('saveZone').onclick=finishTemplate;$('cancelTemplate').onclick=()=>{templateDrawing=null;refreshTemplate();};
  $('undoTemplatePoint').onclick=()=>{templateDrawing?.points.pop();refreshTemplate();};
  $('addScatterGroup').onclick=()=>{
    const value=$('scatterGroup').value;
    if(value!==''){scatterGroups.add(Number(value));renderGenerator();}
  };
  $('play').onclick=startPlay;$('exitPlay').onclick=startPlay;$('restart').onclick=restart;
  $('hintToggle').onclick=()=>{
    hintEnabled=!hintEnabled;
    $('hintToggle').textContent=hintEnabled?'Hint: Bật':'Hint: Tắt';
    $('hintToggle').classList.toggle('active',hintEnabled);
    $('hintToggle').setAttribute('aria-pressed',String(hintEnabled));
    resetHint();schedule();
  };
  $('runBot').onclick=runBot;$('stepBot').onclick=stepBot;
  $('library').onclick=()=>{
    $('importStatus').textContent='';$('loadDialog').showModal();
    $('resumeDraft').hidden=true;
    void readDraft('current').then(draft=>{
      if($('loadDialog').open)$('resumeDraft').hidden=!draft?.level;
    }).catch(()=>{});
  };
  $('resumeDraft').onclick=async()=>{
    try{
      const draft=await readDraft('current');
      if(!draft?.level||!canEdit()||busyImport)return;
      Offline.validate(draft.level);
      batch=draft.batch;batchFileTargets=draft.batchFileTargets??[];
      openLevel(draft.level,draft.batchPos,draft.fileTargets);drawPalette();
      $('loadDialog').close();say('Đã mở bản nháp.');
    }catch(error){$('importStatus').textContent=error.message;}
  };
  $('allRoom').onclick=()=>source('roomsort');$('allHappy').onclick=()=>source('happy');
  $('allGdd').onclick=openGddPack;
  $('allTidy').onclick=()=>importPack(async()=>clone(await readAssetLevelPack('tidy')));
  $('chooseFiles').onclick=()=>pickLevelFiles($('files'),$('source').value,$('importStatus'));
  for(const k of ['files','folder'])$(k).onchange=()=>{importFiles($(k).files);$(k).value='';};
  $('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('over')};$('drop').ondragleave=()=>$('drop').classList.remove('over');
  $('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('over');importFiles(e.dataTransfer.files)};
  $('batchLevel').onchange=()=>{syncBatch();const p=+$('batchLevel').value;openLevel(clone(batch.levels[p]),p);drawPalette();say(`Đang sửa màn ${p+1}/${batch.levels.length}.`);};
  $('savePack').onclick=()=>{syncBatch();saveLevelData((batch.key||'tidy-level-pack')+'.json',()=>Offline.compactPack(batch));};
  $('download').onclick=()=>saveLevelFile('tool');
  $('showReport').onclick=openReport;
  $('jsonFormat').onchange=renderJson;
  $('openJson').onclick=()=>pickLevelFiles($('jsonFile'),'auto',$('jsonImportStatus'));
  $('openLevelFile').onclick=()=>pickLevelFiles($('jsonFile'),'auto',$('notice'));
  $('jsonFile').onchange=async()=>{
    const files=[...$('jsonFile').files];$('jsonFile').value='';
    if(!files.length||!canEdit()||busyImport)return;
    const status=inspector==='json'?$('jsonImportStatus'):$('notice');
    status.hidden=false;$('openJson').disabled=true;
    try{await importFiles(files,'auto',status);}
    finally{$('openJson').disabled=!canEdit();}
  };
  $('saveJson').onclick=()=>{
    const unity=$('jsonFormat').value==='unity';
    saveLevelData(level.key+(unity?'.unity.json':'.tidy.json'),()=>unity?Offline.unity(level):Offline.compact(level));
  };
  $('downloadReport').onclick=()=>download('import-report.json',{total:batch.levels.length,rejected:batch.rejected,warnings:batch.levels.filter(l=>l.origin?.warnings?.length).map(l=>({key:l.key,warnings:l.origin.warnings}))});
  $('unity').onclick=()=>saveLevelFile('unity');
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  function holdCamera(active){space=active;canvas.classList.toggle('pan-ready',active);if(active&&playHover){playHover=null;schedule();}}
  document.addEventListener('keyup',e=>{if(e.code==='Space')holdCamera(false);});
  window.addEventListener('blur',()=>{holdCamera(false);endDrag(null,true);});
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&drag){endDrag(null,true);e.preventDefault();return;}
    if(e.key==='Escape'&&templateDrawing){templateDrawing=null;refreshTemplate();return;}
    if(e.key==='Escape'&&pending){cancelPlacement();say('Đã dừng đặt đồ. Bấm một món trên nền để di chuyển.');return;}
    if(e.target.matches('input,select,textarea,[contenteditable]'))return;
    if(e.code==='Space'&&!e.ctrlKey&&!e.altKey&&!e.metaKey){
      holdCamera(true);
      if(canvas.matches(':hover')||!e.target.closest('button,a,summary,label'))e.preventDefault();
    }
    if(!canEdit()||drag||templateDrawing)return;
    if(e.ctrlKey||e.metaKey){
      switch(e.key.toLowerCase()){
        case 'z':rewind(!e.shiftKey);break;
        case 'y':rewind(false);break;
        case 'a':cancelPlacement();setSelection(level.items.map(it=>it.uid));break;
        case 'd':duplicate();break;
        case 'c':
          if(!selection.size)return;
          clipboard=sorted(chosen()).map(it=>({...it}));pasteOffset=0;
          say(`Đã sao chép ${clipboard.length} món.`);break;
        case 'v':if(!clipboard.length)return;if(pasteItems(clipboard,pasteOffset+1))pasteOffset++;break;
        default:return;
      }
    }else{
      const step=e.shiftKey?10:1;
      switch(e.key.toLowerCase()){
        case 'm':if(!e.repeat)setMarquee(!marqueeMode);break;
        case 'f':focusSelection();break;
        case 'escape':if(marqueeMode)setMarquee(false);else setSelection([]);break;
        case 'delete':removeItem();break;
        case '[':turn(15);break;
        case ']':turn(-15);break;
        case 'arrowleft':if(!selection.size)return;nudge(-step,0);break;
        case 'arrowright':if(!selection.size)return;nudge(step,0);break;
        case 'arrowup':if(!selection.size)return;nudge(0,step);break;
        case 'arrowdown':if(!selection.size)return;nudge(0,-step);break;
        default:return;
      }
    }
    e.preventDefault();
  });
}
function saveLevelData(filename, encode, indent){
  try{download(filename,encode(),indent);}
  catch(error){say(error.message);}
}
function renderJson(){
  const unityFormat=$('jsonFormat').value==='unity';
  const display=$('jsonContent');
  $('openJson').disabled=!canEdit();
  $('saveJson').disabled=!canEdit();
  try{
    const data=unityFormat?Offline.unity(level):Offline.compact(level);
    const formatted=Offline.formatJson(data);
    if(display.value!==formatted){
      display.value=formatted;
      display.scrollTop=0;
      display.scrollLeft=0;
    }
    $('jsonNote').textContent=unityFormat
      ?'id là tên ảnh theo catalog. sourceId giữ mã gốc. art và bg trỏ tới file ảnh.'
      :'bg và id tra trong catalog. content xếp từ dưới lên. order là thứ tự mở hộp.';
  }catch(e){
    $('saveJson').disabled=true;
    display.value='';
    $('jsonNote').textContent=e.message;
  }
}
function renderFileButtons(){
  for(const [id,format,label] of [['download','tool','JSON'],['unity','unity','Unity']]){
    const handle=fileTargets[format],button=$(id);
    button.textContent=handle?`Lưu Data ${label}`:`Xuất ${label}…`;
    button.title=handle?`Lưu vào ${handle.name}`:'Chọn thư mục và tên file';
    button.disabled=!canEdit()||fileSaveBusy;
  }
}
async function saveLevelFile(format){
  if(!canEdit()||fileSaveBusy||busyImport)return;
  const targets=fileTargets,unity=format==='unity';
  const filename=level.key+(unity?'.unity.json':'.tidy.json');
  let data;
  try{data=unity?Offline.unity(level):Offline.compact(level);}
  catch(error){say(error.message);return;}
  let handle=targets[format];
  fileSaveBusy=true;renderFileButtons();
  try{
    if(!handle){
      try{
        handle=await window.showSaveFilePicker?.({suggestedName:filename,types:[jsonFileType]});
      }catch(error){
        if(error.name!=='SecurityError'&&error.name!=='NotSupportedError')throw error;
      }
      if(!handle){download(filename,data);say('Đã tải file theo cài đặt tải xuống của trình duyệt.');return;}
    }
    const other=unity?'tool':'unity';
    const same=targets[other]&&await handle.isSameEntry(targets[other]);
    const writable=await handle.createWritable();
    try{
      await writable.write(Offline.formatJson(data));
      await writable.close();
    }catch(error){await writable.abort().catch(()=>{});throw error;}
    targets[format]=handle;
    if(same)delete targets[other];
    saveSoon();say(`Đã lưu ${handle.name}.`);
  }catch(error){
    if((error.name==='NotFoundError'||error.name==='NotAllowedError')&&targets[format]===handle){
      delete targets[format];saveSoon();say('File cũ không ghi được. Bấm Xuất để chọn nơi lưu mới.');
    }else if(error.name!=='AbortError')say(error.message);
  }finally{fileSaveBusy=false;renderFileButtons();}
}

async function initialize(){
  catalog=Offline.catalog;
  assetLookup=new Map(catalog.items.map(a=>[a.path,a]));
  groupNames=new Map(catalog.items.filter(a=>a.group!==null).map(a=>[a.group,a.label]));
  for(const [id,name] of Object.entries(catalog.roomGroups))groupNames.set(+id,name);
  groupNames.set(0,'Chưa gán nhóm');
  $('allRoom').disabled=!Offline.sources.roomsort.length;$('allHappy').disabled=!Offline.sources.happy.length;
  const storedTemplates=await readDraft('templates').catch(()=>null);
  if(storedTemplates)templates=storedTemplates;
  openLevel(newLevel(),-1,{},false);
  say('Kéo đồ từ catalog RoomSort vào phòng. Chuột phải để kéo nền · lăn để zoom.');
  bind();
  const catalogReady=refreshGddCatalog();
  window.addEventListener('hashchange',openLinkedGddPack);
  await openLinkedGddPack();
  await catalogReady;
}
initialize().catch(e=>say(`Không mở được tool: ${e.message}`));
