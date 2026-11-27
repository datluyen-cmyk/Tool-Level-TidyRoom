const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {gzipSync}=require('node:zlib');
const {chromium}=require(process.env.TIDY_PLAYWRIGHT || 'playwright');
const url=process.env.TIDY_TEST_URL || pathToFileURL(path.join(__dirname,'index.html')).href;

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.TIDY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:process.env.TIDY_HEADFUL!=='1'});
  try{
    const page=await browser.newPage({viewport:{width:1460,height:970}}),errors=[],network=[];
    await page.addInitScript(()=>{
      window.showOpenFilePicker=undefined;
      window.showSaveFilePicker=undefined;
    });
    page.on('pageerror',e=>errors.push(e.message));
    await page.route(/^https?:/,r=>{network.push(r.request().url());return r.abort();});
    await page.goto(url);
    const wait=expr=>page.waitForFunction(expr);
    await wait(()=>document.querySelectorAll('.asset-card').length>0);
    assert(await page.evaluate(()=>level.items.length===0&&level.background.asset==='Art/RoomSortOffline/Rooms/1.jpg'));
    const selectRoomTwo=async()=>{
      await page.locator('#bgTab').click();
      await page.locator('#search').fill('Background_2_');
      await page.locator('[data-path="Art/RoomSortOffline/Rooms/2.jpg"]').click();
      await page.locator('#search').clear();
      await page.locator('#itemsTab').click();
    };
    const resumeDraft=async()=>{
      await page.locator('#library').click();
      await page.locator('#resumeDraft').click();
      await page.locator('#loadDialog').waitFor({state:'hidden'});
    };
    assert.match(await page.locator('#assetTotal').innerText(),/2\.376 ảnh vật phẩm/);
    assert.equal(await page.locator('#assetList').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    const divider=await page.locator('#resizeCatalog').boundingBox();
    const initialCatalog=await page.locator('.assets').boundingBox();
    await page.mouse.move(divider.x+divider.width/2,divider.y+80);
    await page.mouse.down();
    await page.mouse.move(divider.x+divider.width/2+84,divider.y+80,{steps:8});
    await page.mouse.up();
    assert((await page.locator('.assets').boundingBox()).width>initialCatalog.width+75);
    assert.equal(await page.locator('#assetList').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
    const narrowed=await page.locator('#resizeCatalog').boundingBox();
    await page.mouse.move(narrowed.x+narrowed.width/2,narrowed.y+80);
    await page.mouse.down();
    await page.mouse.move(narrowed.x+narrowed.width/2-84,narrowed.y+80,{steps:8});
    await page.mouse.up();
    assert.equal(await page.locator('#assetList').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    const rightPanel=page.locator('#inspector'),rightWidth=(await rightPanel.boundingBox()).width;
    const rightDivider=page.locator('#resizeInspector'),rightStart=await rightDivider.boundingBox();
    await page.mouse.move(rightStart.x+4,rightStart.y+80);
    await page.mouse.down();await page.mouse.move(rightStart.x-76,rightStart.y+80,{steps:8});await page.mouse.up();
    assert((await rightPanel.boundingBox()).width>rightWidth+70);
    const shiftedRight=await rightDivider.boundingBox();
    await page.mouse.move(shiftedRight.x+4,shiftedRight.y+80);
    await page.mouse.down();await page.mouse.move(shiftedRight.x+84,shiftedRight.y+80,{steps:8});await page.mouse.up();
    assert.equal((await rightPanel.boundingBox()).width,rightWidth);
    await page.evaluate(()=>document.querySelector('.shell').style.removeProperty('--inspector-resized'));
    assert.equal(await page.locator('#groupFilter option[value="11004"]').count(),0);
    await page.locator('#search').fill('11004');
    assert.equal(await page.locator('.asset-card').count(),0);
    await page.locator('#search').clear();
    await page.locator('#unusedTab').click();
    await page.locator('#groupFilter option[value="11004"]').waitFor({state:'attached'});
    assert.equal(await page.locator('#unusedTab').getAttribute('aria-pressed'),'true');
    await page.locator('#groupFilter').selectOption('11004');
    assert.equal(await page.locator('.asset-card').count(),5);
    await page.locator('#groupFilter').selectOption('');
    await page.locator('#search').fill('101-1');
    const usedBook=page.locator('[data-path="Art/RoomSortOffline/Items/101-1.png"]');
    assert.equal(await usedBook.count(),0);
    await page.locator('#itemsTab').click();
    assert.equal(await usedBook.count(),1);
    await page.locator('#search').clear();
    await page.locator('#levelAssetsTab').click();
    for(const [pack,count] of [['gdd',137],['happy',65],['tidy',100],['roomsort',139],['roomsort-new',160]]){
      await page.locator('#assetLevelPack').selectOption(pack);
      await page.waitForFunction(count=>$('assetLevelNumber').options.length===count,count);
      const expected=await page.evaluate(()=>[...new Set(assetLevelPack.levels[0].items.map(it=>it.asset))].slice(0,48));
      assert.deepEqual(await page.locator('#assetList .asset-card').evaluateAll(cards=>cards.map(c=>c.dataset.path)),expected);
    }
    await page.locator('#assetLevelNumber').selectOption('1');
    assert(await page.evaluate(()=>{
      const groups=new Set(assetLevelPack.levels[1].items.map(it=>it.group));
      const options=[...$('groupFilter').options].slice(1);
      return options.length===groups.size&&options.every(option=>groups.has(Number(option.value)));
    }));
    await selectRoomTwo();
    await page.locator('#search').fill('11-1');
    const key='Art/RoomSortOffline/Items/11-1.png', room='Art/RoomSortOffline/Rooms/2.jpg';
    const sprite=page.locator(`[data-path="${key}"]`);
    await sprite.click();
    const board=page.locator('#board');
    const worldPoint=async(x,y)=>{
      const {x:left,y:top,width:w,height:h}=await board.boundingBox();
      const bg=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qa-bg')));
      const s=Math.min(Math.max(1,w-44)/bg.w,Math.max(1,h-40)/bg.h);
      return [left+w/2+x*s,top+h/2-y*s];
    };
    const clickWorld=async(x,y)=>page.mouse.click(...await worldPoint(x,y));
    const bg=await page.evaluate(key=>Offline.catalog.backgrounds.find(a=>a.path===key),room);
    await page.evaluate(bg=>sessionStorage.setItem('qa-bg',JSON.stringify(bg)),bg);
    // Selecting the same asset again must not silently turn placement off.
    await sprite.click();assert.equal(await sprite.getAttribute('aria-pressed'),'true');
    await clickWorld(-140,120); await wait(()=>document.querySelectorAll('#layers .layer').length===1);
    const card=await sprite.boundingBox();
    await page.mouse.move(card.x+card.width/2,card.y+card.height/2);await page.mouse.down();
    await page.mouse.move(...await worldPoint(160,-90),{steps:16});await page.mouse.up();
    await wait(()=>document.querySelectorAll('#layers .layer').length===2);
    assert.equal(await sprite.getAttribute('aria-pressed'),'false');
    assert(Math.abs(Number(await page.inputValue('#x'))-160)<3);
    assert(Math.abs(Number(await page.inputValue('#y'))+90)<3);
    assert.deepEqual(await page.locator('#layers .layer small').allTextContents(),['L0','L0']);
    assert(await page.locator('#layerBack').isDisabled());
    // Reposition an existing item even while a sprite is selected for placement.
    await sprite.click();await page.mouse.move(...await worldPoint(160,-90));await page.mouse.down();
    await page.mouse.move(...await worldPoint(217,-155),{steps:10});await page.mouse.up();
    await wait(()=>Math.abs(+document.querySelector('#x').value-217)<3);
    assert.equal(await page.locator('#layers .layer').count(),2);
    assert.equal(await sprite.getAttribute('aria-pressed'),'false');
    const writeField=async(id,value)=>{await page.locator('#'+id).fill(value);await page.locator('#'+id).press('Tab');};
    await writeField('x','-140');await writeField('y','120');
    assert.deepEqual(await page.locator('#layers .layer small').allTextContents(),['L1','L0']);
    await page.locator('#layerBack').click();
    assert.match(await page.locator('#layers .layer.active').innerText(),/L0/);
    await page.locator('#undo').click();
    assert.match(await page.locator('#layers .layer.active').innerText(),/L1/);
    const pile=page.locator('#layers .layer-stack');
    assert.equal(await pile.count(),1);
    const pileRows=pile.locator('.layer');
    const topUid=await pileRows.first().getAttribute('data-uid');
    await pileRows.first().dragTo(pileRows.last(),{targetPosition:{x:62,y:28}});
    assert.equal(await pileRows.last().getAttribute('data-uid'),topUid);
    assert.match(await pileRows.last().innerText(),/L0/);
    await page.locator('#undo').click();
    assert.equal(await pileRows.first().getAttribute('data-uid'),topUid);
    await writeField('x','160');await writeField('y','-90');
    await page.locator('#angle').fill('20');await page.locator('#angle').press('Tab');
    await page.locator('#boxTab').click();await page.locator('#fillBoxes').click();
    await wait(()=>document.querySelector('#notice').textContent.includes('Đã kiểm tra đường thắng'));
    assert.match(await page.locator('#validation').innerText(),/Đủ chỗ/);
    await page.locator('#play').click();await page.locator('#playbar').waitFor({state:'visible'});
    await wait(()=>!playMotion);
    assert.equal(await board.evaluate(el=>getComputedStyle(el).cursor),'pointer');
    await board.focus();
    await page.keyboard.down('Space');
    assert.equal(await board.evaluate(el=>getComputedStyle(el).cursor),'grab');
    await page.keyboard.up('Space');
    assert.equal(await page.locator('#testBoxes .test-box').count(),2,await page.locator('#testBoxes').innerHTML());
    const shape=await page.evaluate(key=>Offline.shape(key),key);
    const [w,h]=[124.74,104.58]; // Source collider dimensions 99×83 at the room 2's scale of 1.26.
    let near=Infinity,pick;
    shape.alpha.forEach((opaque,i)=>{if(!opaque)return;const x=(i%shape.maskW+.5)/shape.maskW-.5,y=.5-(Math.floor(i/shape.maskW)+.5)/shape.maskH,d=x*x+y*y;if(d<near){pick=[x*w,y*h];near=d;}});
    await page.mouse.move(...await worldPoint(-140+pick[0],120+pick[1]));
    assert(await page.evaluate(()=>playHover!==null&&game.canPick(playHover.index)));
    await page.mouse.move(...await worldPoint(0,300));
    assert.equal(await page.evaluate(()=>playHover),null);
    await clickWorld(-140+pick[0],120+pick[1]);
    await page.locator('.play-flight').waitFor({state:'attached'});
    const a=20*Math.PI/180;await clickWorld(160+pick[0]*Math.cos(a)-pick[1]*Math.sin(a),-90+pick[0]*Math.sin(a)+pick[1]*Math.cos(a));
    await page.locator('#finish').waitFor({state:'visible'});assert.match(await page.locator('#finish').innerText(),/Đã dọn sạch!/);
    assert.equal(await page.locator('#testBoxes .empty-box-slot').count(),2);
    assert.equal(await page.locator('.play-flight').count(),0);
    await page.locator('#runBot').click();
    await wait(()=>document.querySelector('#notice').textContent.includes('Đường thắng đã kiểm'));
    assert.match(await page.locator('#notice').innerText(),/Gỡ theo chuỗi 4\/4/);
    await page.locator('#stepBot').click();
    await page.locator('#stepBot').click();
    await page.locator('#finish').waitFor({state:'visible'});
    assert.match(await page.locator('#finish').innerText(),/Đã dọn sạch!/);
    await page.locator('#exitPlay').click(); assert.match(await page.locator('#summary').innerText(),/2 món/);
    assert.notEqual(await board.evaluate(el=>getComputedStyle(el).cursor),'pointer');
    const namedRoundTrip=await page.evaluate(async()=>{
      const doc=Offline.compact(level);
      const imported=await Offline.importFiles([new File([JSON.stringify(doc)],'level.json',{type:'application/json'})],'auto');
      return {bg:doc.bg,id:doc.content[0].id,expected:assetLookup.get(level.items[0].asset).displayName,
        same:imported.levels[0]?.background.asset===level.background.asset&&imported.levels[0]?.items[0].asset===level.items[0].asset};
    });
    assert.match(namedRoundTrip.bg,/^Background_/);
    assert.equal(namedRoundTrip.id,namedRoundTrip.expected);
    assert(namedRoundTrip.same);
    const unityDownload=page.waitForEvent('download');await page.locator('#unity').click();
    const unity=JSON.parse(fs.readFileSync(await (await unityDownload).path(),'utf8'));
    const namedPaths=await page.evaluate(([item,bg])=>[Offline.artURL(item).slice(2),Offline.artURL(bg).slice(2)],[key,room]);
    assert.equal(unity.bg,namedPaths[1]);
    assert(unity.content.every(i=>i.art===namedPaths[0]&&i.id===namedRoundTrip.expected&&i.sourceId==='11-1'));
    if(process.env.TIDY_EXPORT_FIXTURE)fs.writeFileSync(process.env.TIDY_EXPORT_FIXTURE,JSON.stringify(unity));
    assert(Math.abs(unity.content[0].x+140)<3&&Math.abs(unity.content[0].y-120)<3);
    assert.deepEqual(unity.content.map(i=>[i.uid,i.angle]),[[0,0],[1,20]]);
    assert.deepEqual([unity.content[1].x,unity.content[1].y],[160,-90]);
    assert(unity.content.every(i=>Math.abs(i.width-w)<.001&&Math.abs(i.height-h)<.001));
    assert(unity.content.every(i=>i.alpha.length===i.maskW*i.maskH));
    await page.evaluate(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined}));
    await sprite.click();await page.locator('#placeCenter').click();
    await page.locator('#layerTab').click();await wait(()=>document.querySelectorAll('#layers .layer').length===3);
    assert.equal(await page.inputValue('#x'),'0');assert.equal(await page.inputValue('#y'),'0');
    await page.locator('#scaleX').fill('-2');await page.locator('#scaleX').press('Tab');
    await page.locator('#fitAll').click();await wait(()=>document.querySelector('#scaleX').value==='-1');
    await page.locator('#undo').click();assert.equal(await page.inputValue('#scaleX'),'-2');
    const rect=await board.boundingBox();await page.mouse.click(rect.x+6,rect.y+rect.height/2);
    assert.equal(await page.locator('#layers .layer').count(),3);
    assert.match(await page.locator('#notice').innerText(),/trong khung ảnh nền/);
    await clickWorld(bg.w/2-10,0);
    assert.equal(await page.locator('#layers .layer').count(),3);
    assert.match(await page.locator('#notice').innerText(),/trong khung ảnh nền/);
    await clickWorld(-140,120);await wait(()=>document.querySelectorAll('#layers .layer').length===4);
    await clickWorld(160,-90);await wait(()=>document.querySelectorAll('#layers .layer').length===5);
    assert.deepEqual((await page.locator('#layers .layer small').allTextContents()).sort(),['L0','L0','L0','L1','L1']);
    assert.match(await page.locator('#stackDepth').innerText(),/2 lớp/);
    assert.equal(await page.locator('#layers .layer-stack').count(),2);
    assert.equal(await page.locator('#layers .layer-singles .layer').count(),1);
    const beforeCrossPile=await page.evaluate(()=>level.items);
    const fromPile=page.locator('#layers .layer-stack').first().locator('.layer').first();
    const toPile=page.locator('#layers .layer-stack').last().locator('.layer').first();
    const crossUid=await fromPile.getAttribute('data-uid'),destinationUid=await toPile.getAttribute('data-uid');
    await fromPile.dragTo(toPile,{targetPosition:{x:62,y:6}});
    assert(await page.evaluate(([a,b])=>{
      const shifted=level.items.find(it=>it.uid===a),target=level.items.find(it=>it.uid===b);
      return layerView.get(a).stack===layerView.get(b).stack&&shifted.layer>target.layer&&shifted.x===target.x&&shifted.y===target.y;
    },[crossUid,destinationUid]));
    await page.locator('#undo').click();
    assert.deepEqual(await page.evaluate(()=>level.items),beforeCrossPile);
    await page.locator('#search').focus();await page.keyboard.press('Escape');
    assert.equal(await sprite.getAttribute('aria-pressed'),'false');
    await clickWorld(160,-90);
    await writeField('x',String(bg.w));
    assert(Math.abs(Number(await page.inputValue('#x'))-160)<3);
    const oldY=await page.inputValue('#y');
    await page.mouse.move(...await worldPoint(160,-90));await page.mouse.down();
    await page.mouse.move(rect.x+5,rect.y+rect.height/2,{steps:12});await page.mouse.up();
    assert(Math.abs(Number(await page.inputValue('#x'))-160)<3);
    assert.equal(await page.inputValue('#y'),oldY);
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
    await page.mouse.wheel(0,320);
    await page.waitForFunction(()=>view.zoom<.7);
    await page.mouse.down({button:'right'});
    await page.mouse.move(rect.x+rect.width/2+165,rect.y+rect.height/2,{steps:8});
    await page.mouse.up({button:'right'});
    await page.waitForFunction(()=>view.dx>150);
    const cardAgain=await sprite.boundingBox();
    await page.mouse.move(cardAgain.x+cardAgain.width/2,cardAgain.y+cardAgain.height/2);
    await page.mouse.down();
    await page.mouse.move(rect.x+36,rect.y+rect.height/2,{steps:16});await page.mouse.up();
    assert.equal(await page.locator('#layers .layer').count(),5);
    assert.match(await page.locator('#notice').innerText(),/trong khung ảnh nền/);
    await page.locator('#library').click();
    assert.deepEqual(await page.locator('#allHappy,#allTidy,#allRoom').allTextContents(),
      ['Happy Tidy Room (Lumos)','Tidy Room Circle','Amochioom (Room Sort)']);
    await page.locator('#allHappy').click();await page.locator('#batchbar').waitFor({state:'visible'});
    assert.equal(await page.locator('#batchLevel option').count(),65);
    await page.selectOption('#batchLevel','1');await page.locator('#title').fill('Happy chỉnh thử');await page.locator('#title').press('Tab');
    await page.selectOption('#batchLevel','0');await page.selectOption('#batchLevel','1');assert.equal(await page.inputValue('#title'),'Happy chỉnh thử');
    const packDownload=page.waitForEvent('download');await page.locator('#savePack').click();
    const pack=JSON.parse(fs.readFileSync(await (await packDownload).path(),'utf8'));assert.equal(pack.levels[1].name,'Happy chỉnh thử');
    await page.locator('#library').click();
    const zipBytes=await page.evaluate(async unity=>{
      const zip=new JSZip();zip.file('valid.json',JSON.stringify(unity));zip.file('bad.json','{ broken');
      return [...await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})];
    },unity);
    await page.locator('#files').setInputFiles([{name:'test.zip',mimeType:'application/zip',buffer:Buffer.from(zipBytes)},{name:'valid.json.gz',mimeType:'application/gzip',buffer:gzipSync(JSON.stringify(unity))}]);
    await page.locator('#reportDialog').waitFor({state:'visible'});assert.match(await page.locator('#reportSummary').innerText(),/2 màn nhập được · 1 lỗi đọc/);
    await page.locator('button[data-close="reportDialog"]').click();
    await page.locator('#library').click();await page.locator('#allRoom').click();await wait(()=>document.querySelectorAll('#batchLevel option').length===139);
    const originalName=await page.inputValue('#title');
    const count=await page.evaluate(()=>Offline.library('unity').levels.length);assert.equal(count,204);
    await page.locator('#layerTab').click();await page.locator('#layers .layer').first().click();
    if(process.env.TIDY_SCREENSHOT)await page.screenshot({path:process.env.TIDY_SCREENSHOT});
    await page.waitForTimeout(450);await page.reload();await wait(()=>level?.items.length===0);
    assert.equal(await page.evaluate(()=>level.background.asset),'Art/RoomSortOffline/Rooms/1.jpg');
    await resumeDraft();assert.equal(await page.inputValue('#title'),originalName);

    // Regenerate boxes on a large imported board without moving any original item.
    page.on('dialog',dialog=>dialog.accept());
    const largest=await page.evaluate(()=>batch.levels.reduce((best,l,i)=>l.items.length>batch.levels[best].items.length?i:best,0));
    await page.selectOption('#batchLevel',String(largest));
    const layoutBefore=await page.evaluate(()=>structuredClone(level.items));
    const queue=page.locator('#testBoxes');
    assert.deepEqual(await queue.locator('strong').allTextContents(),await page.evaluate(()=>level.boxes.map(box=>box.label)));
    await queue.hover();
    await page.mouse.wheel(0,600);
    await wait(()=>$('testBoxes').scrollLeft>0);
    assert(await queue.evaluate(row=>{
      row.scrollLeft=row.scrollWidth;
      const last=row.lastElementChild.getBoundingClientRect(),bounds=row.getBoundingClientRect();
      return last.right<=bounds.right+1&&last.left>=bounds.left&&row.scrollHeight<=row.clientHeight+1;
    }));
    await page.locator('#boxTab').click();
    await page.locator('#maxBox').fill('4');
    await page.locator('#fillBoxes').click();
    await wait(()=>document.querySelector('#notice').textContent.includes('Đã kiểm tra đường thắng'));
    assert.deepEqual(await page.evaluate(()=>level.items),layoutBefore);
    assert(await page.evaluate(()=>TidyGame.check(level).ok&&level.boxes.every(b=>b.count<=4)));
    await page.locator('#undo').click();
    assert.deepEqual(await page.evaluate(()=>level.items),layoutBefore);

    await page.locator('#new').click();
    await selectRoomTwo();
    await page.locator('#generateTab').click();
    await page.locator('#scatterCount').fill('4');
    await page.locator('#scatterLayers').fill('1');
    await page.locator('#scatter').click();
    await page.locator('#variantPreviewBar').waitFor({state:'visible'});
    assert.match(await page.locator('#variantPreviewMetrics').innerText(),/Sinh mới cùng nền/);
    assert(await page.evaluate(async()=>{
      const pack=await readGddPack();
      const source=pack.levels.find(source=>source.background.asset===level.background.asset);
      return level.items.length===4&&variantPreview.editor.level.items.length===0&&level.items.every(it=>
        TidyGame.fitsBackground(level.background,it)&&source.items.every(slot=>Math.hypot(it.x-slot.x,it.y-slot.y)>8));
    }));
    await page.locator('#variantDiscard').click();
    assert.equal(await page.evaluate(()=>level.items.length),0);
    assert(await page.evaluate(async()=>{
      const pack=await readGddPack();
      const reference=pack.levels.find(doc=>doc.background.asset===level.background.asset);
      const zones=[{points:[[.01,.01],[.02,.01],[.02,.02],[.01,.02]]}];
      const model=TidyGenerator.learnLayout(reference,level.background,[],[],{masks,zones});
      try{
        TidyGenerator.synthesize(level.background,model,{count:4,layers:1,groups:new Set(),drape:false});
        return false;
      }catch(error){return error.message.includes('0/4 chỗ mới');}
    }));
    const templatePoint=(u,v)=>worldPoint((u-.5)*bg.w,(.5-v)*bg.h);
    const drawMark=async(from,to)=>{
      await page.mouse.move(...await templatePoint(...from));await page.mouse.down();
      await page.mouse.move(...await templatePoint(...to),{steps:8});await page.mouse.up();
    };
    await page.locator('#addZone').click();
    await drawMark([.06,.06],[.94,.94]);
    assert.equal(await page.locator('#addZone').getAttribute('aria-pressed'),'false');
    await page.selectOption('#scatterMode','reference');
    await page.locator('#scatter').click();
    await page.locator('#variantPreviewBar').waitFor({state:'visible'});
    assert(await page.evaluate(()=>{
      const {width,height}=level.background;
      return level.items.every(item=>{
        const {left,right,top,bottom}=TidyGame.itemBounds(item);
        // Allow for pointer rounding while drawing the polygon at 6% and 94%.
        return left>=-.441*width&&right<=.441*width&&bottom>=-.441*height&&top<=.441*height;
      });
    }));
    await page.locator('#variantDiscard').click();
    await page.selectOption('#scatterMode','auto');
    await page.locator('#addPolygon').click();
    await page.mouse.click(...await templatePoint(.25,.25));
    await page.locator('#undoTemplatePoint').click();
    assert.match(await page.locator('#templateHint').innerText(),/0 điểm/);
    await page.locator('#cancelTemplate').click();
    await page.locator('#addEdge').click();
    assert.match(await page.locator('#templateHint').innerText(),/Chọn ảnh đồ/);
    await page.locator('#search').fill('11-1');await sprite.click();
    assert(await page.locator('#edgeSpritePreview').isVisible());
    await drawMark([.38,.48],[.62,.52]);
    assert.equal(await page.locator('#templateList .template-row').count(),2);
    const secondGroup=await page.evaluate(key=>{
      const edgeGroup=Offline.catalog.items.find(a=>a.path===key).group;
      return Offline.catalog.items.find(a=>a.palette&&a.group!=null&&a.group!==edgeGroup).group;
    },key);
    await page.selectOption('#scatterGroup',String(secondGroup));await page.locator('#addScatterGroup').click();
    await page.locator('#scatterCount').fill('12');await page.locator('#scatterLayers').fill('3');
    await page.evaluate(()=>{
      const generateBoxes=TidyGenerator.boxesFromLayout;
      TidyGenerator.boxesFromLayout=async(...args)=>{
        const result=await generateBoxes(...args);
        window.qaWinningRoute=result.points;
        return result;
      };
    });
    await page.locator('#scatter').click();
    await page.locator('#variantPreviewBar').waitFor({state:'visible'});
    assert.match(await page.locator('#variantPreviewMetrics').innerText(),/Vùng và mép đã đánh dấu.*Đã kiểm tra đường thắng/);
    await page.locator('#variantSave').click();
    const generated=await page.evaluate(key=>{
      const depths=TidyGame.stackLayers(level.items,masks);
      const exported=Offline.unity(level), compact=Offline.compact(level);
      return {
        items:level.items.length, groups:new Set(level.items.map(it=>it.group)).size,
        boundary:level.items.every(it=>TidyGame.fitsBackground(level.background,it)),
        edge:level.items.filter(it=>it.asset===key).map(it=>it.angle),
        depth:Math.max(...[...depths.values()].map(it=>it.depth)),
        valid:TidyGame.check(level).ok,
        unity:exported.content.length,
        templateInJson:['zones','edges','templates'].some(k=>Object.hasOwn(compact,k)),
      };
    },key);
    assert.equal(generated.items,12);assert.equal(generated.groups,2);
    assert(generated.boundary&&generated.valid&&generated.edge.length===1&&Math.abs(generated.edge[0])>1);
    assert(generated.depth<=2);assert.equal(generated.unity,12);assert.equal(generated.templateInJson,false);
    const route=await page.evaluate(()=>window.qaWinningRoute);
    assert.equal(route.length,12);
    const originalGenerated=await page.evaluate(()=>structuredClone(level));
    await page.locator('#play').click();await page.locator('#testBoxes').waitFor({state:'visible'});
    // Replay exact world positions, as the bot does, independent of viewport rounding.
    await page.evaluate(points=>{for(const [x,y] of points)tap(x,y,true);},route);
    await page.locator('#finish').waitFor({state:'visible'});
    assert.match(await page.locator('#finish').innerText(),/Đã dọn sạch!/);
    await page.locator('#exitPlay').click();
    await page.locator('#scatterCount').fill('1');
    await page.locator('#scatter').click();
    assert.match(await page.locator('#notice').innerText(),/Tăng số món/);
    assert.deepEqual(await page.evaluate(()=>level),originalGenerated);
    await page.locator('#undo').click();
    assert.equal(await page.evaluate(()=>level.items.length),0);
    await page.waitForFunction(async()=>{
      const [draft,marks]=await Promise.all([readDraft('current'),readDraft('templates')]);
      const bg=draft?.level.background.asset;
      return bg===level.background.asset&&draft.level.items.length===0&&marks?.[bg]?.zones.length===1&&marks[bg].edges.length===1;
    });
    await page.reload();await wait(()=>document.querySelectorAll('.asset-card').length>0);
    if(await page.evaluate(()=>level.background.asset)!==room){
      await page.locator('#bgTab').click();
      await page.locator('#search').fill('Background_2_');
      await page.locator(`[data-path="${room}"]`).click();
      await page.locator('#search').clear();
      await page.locator('#itemsTab').click();
    }
    await page.locator('#generateTab').click();
    await wait(()=>document.querySelectorAll('#templateList .template-row').length===2);

    // Add a layer-only copy, then export an alternate pack through the offline UI.
    const variantSource=await page.evaluate(asset=>{
      const source={...newLevel(),key:'variant-smoke',name:'Màn biến tấu mẫu'};
      const placements=[[-165,120,1],[-145,120,2],[-325,-60,1],[-140,-60,1],
        [25,-60,2],[190,-60,2],[-200,-210,3],[0,-210,3],[200,-210,3]];
      source.items=placements.map(([x,y,group],layer)=>({uid:`variant-${layer}`,asset,layer,group,targetType:group,
        x,y,width:120,height:100,angle:0,scaleX:1,scaleY:1}));
      source.boxes=[1,2,3].map(group=>({group,count:3,targetType:group,label:`Nhóm ${group}`}));
      const tutorial={...source,key:'variant-tutorial',name:'Màn một hộp',boxes:source.boxes.slice(0,1),
        items:source.items.filter(it=>it.group===1)};
      batch={key:'variant-smoke-pack',levels:[source,tutorial]};
      openLevel(source,0);
      return structuredClone(source);
    },key);
    assert.deepEqual(await page.locator('#viewport #testBoxes .test-box strong').allTextContents(),['Nhóm 1','Nhóm 2','Nhóm 3']);
    assert.equal(await page.locator('#boxBalance .balance-ok').innerText(),'Đồ và hộp vừa đủ');
    await page.evaluate(()=>patch(()=>{level.boxes[0].count++;level.boxes[1].count--;}));
    assert.match(await page.locator('#boxBalance .balance-short').innerText(),/Cần thêm 1 món · Nhóm 1/);
    assert.match(await page.locator('#boxBalance .balance-extra').innerText(),/Thừa 1 món · Nhóm 2/);
    await page.locator('#undo').click();
    const boxCards=page.locator('#testBoxes [data-box-index]');
    const lastBox=await boxCards.last().boundingBox();
    await boxCards.first().dragTo(boxCards.last(),{targetPosition:{x:lastBox.width-5,y:12}});
    assert.deepEqual(await page.evaluate(()=>level.boxes.map(box=>box.group)),[2,3,1]);
    await page.locator('#undo').click();
    await page.locator('#boxTab').click();
    const orderRows=page.locator('#orders .sort-row');
    const lastRow=await orderRows.last().boundingBox();
    await orderRows.first().locator('.box-drag-grip').dragTo(orderRows.last(),{targetPosition:{x:42,y:lastRow.height-3}});
    assert.deepEqual(await page.evaluate(()=>level.boxes.map(box=>box.group)),[2,3,1]);
    await page.locator('#undo').click();
    await page.locator('#generateTab').click();
    await page.locator('#toggleBoxes').click();
    assert(await page.locator('#testBoxes').isHidden());
    await page.locator('#toggleBoxes').click();
    await page.locator('#testBoxes .test-box').first().click();
    assert.match(await page.locator('#boxMatch').innerText(),/3\/3 món · Vừa đủ/);
    await page.evaluate(()=>patch(()=>level.boxes[0].count++));
    assert.match(await page.locator('#boxMatch').innerText(),/3\/4 món · Thiếu 1 món/);
    await page.evaluate(()=>patch(()=>level.boxes[0].count-=2));
    assert.match(await page.locator('#boxMatch').innerText(),/3\/2 món · Thừa 1 món/);
    await page.evaluate(()=>patch(()=>level.boxes[0].count++));
    await page.locator('#testBoxes .test-box').first().click();
    assert(await page.locator('#boxMatch').isHidden());
    await page.locator('#openVariants').click();
    await page.selectOption('#variantMode','layers');
    await page.selectOption('#variantSearch','extended');
    await page.evaluate(()=>{
      const make=TidyVariant.make;
      TidyVariant.make=async(source,masks,options)=>{
        TidyVariant.make=make;
        if(options.effort!=='extended')throw Error('Search mode was not forwarded');
        options.progress({stage:'layout',current:1,total:42,elapsed:0});
        while(!options.stopped())await new Promise(resolve=>setTimeout(resolve,25));
        return {cancelled:true};
      };
    });
    await page.locator('#variantOne').click();
    await wait(()=>$('variantStatus').textContent.includes('1/42'));
    await page.locator('#cancelVariants').click();
    await wait(()=>$('variantStatus').textContent==='Đã dừng biến tấu.');
    await page.evaluate(()=>{
      const make=TidyVariant.make;
      TidyVariant.make=async(...args)=>{
        TidyVariant.make=make;
        const result=await make(...args);
        if(!result.doc)return result;
        return {fallback:result,reason:'Có bản chơi thắng, nhưng chưa đạt độ khó đã chọn.'};
      };
    });
    await page.selectOption('#variantSearch','deep');await page.locator('#variantOne').click();
    await page.getByRole('button',{name:'Xem bản gần nhất đã thắng'}).click();
    await page.locator('#variantDialog').waitFor({state:'hidden'});
    assert.match(await page.locator('#variantPreviewTitle').innerText(),/lệch độ khó mục tiêu/);
    assert.match(await page.locator('#variantPreviewMetrics').innerText(),/món đổi lớp.*Điểm khó theo bot/);
    assert.equal(await page.evaluate(()=>batch.levels.length),2);
    await page.locator('#variantCompare').click();
    assert.equal(await page.locator('#title').inputValue(),variantSource.name);
    await page.locator('#variantCompare').click();
    await page.locator('#play').click();await page.locator('#playbar').waitFor({state:'visible'});
    await page.locator('#hintToggle').click();
    assert.equal(await page.locator('#hintToggle').getAttribute('aria-pressed'),'false');
    await page.waitForTimeout(3100);
    assert.equal(await page.evaluate(()=>hintItem),null);
    await page.locator('#hintToggle').click();
    await page.waitForFunction(()=>hintItem!==null,{timeout:7000});
    assert(await page.evaluate(()=>game.box(game.items[hintItem].group)>=0&&!!game.pointFor(hintItem)));
    await page.evaluate(()=>{const [x,y]=game.pointFor(hintItem);tap(x,y);});
    assert.equal(await page.evaluate(()=>hintItem),null);
    await page.locator('#variantDiscard').click();
    assert(await page.locator('#playbar').isHidden());
    assert.equal(await page.evaluate(()=>batch.levels.length),2);
    assert.deepEqual(await page.evaluate(()=>level),variantSource);
    await page.locator('#openVariants').click();await page.locator('#variantOne').click();
    await page.locator('#variantPreviewBar').waitFor({state:'visible'});
    const surface=await page.locator('#board').boundingBox();
    await page.mouse.move(surface.x+surface.width/2,surface.y+surface.height/2);
    await page.keyboard.down('Space');await page.mouse.down();
    await page.mouse.move(surface.x+surface.width/2+70,surface.y+surface.height/2+15,{steps:4});
    await page.mouse.up();await page.keyboard.up('Space');
    assert(await page.evaluate(()=>Math.abs(view.dx)>50&&!space));
    await page.locator('#variantSave').click();
    assert.equal(await page.locator('#batchLevel option').count(),3);
    const layerCopy=await page.evaluate(()=>{
      const board=new TidyGame.Playtest(level,masks);
      const proof=TidyGenerator.verifyRoute(level,masks,level.boxes,Offline.proofRoute(level),board.cache);
      const source=batch.levels[0];
      const independent=source.boxes.every(box=>!level.boxes.includes(box))&&source.items.every(it=>!level.items.includes(it));
      return {source,copy:level,won:!!proof,independent,exported:Offline.unity(level).proof.length};
    });
    assert.deepEqual(layerCopy.source,variantSource);
    assert.deepEqual(layerCopy.copy.boxes,variantSource.boxes);
    assert.notEqual(layerCopy.copy.items.find(it=>it.uid==='variant-1').layer,1);
    assert(layerCopy.won&&layerCopy.independent);assert.equal(layerCopy.exported,variantSource.items.length);

    await page.locator('#openVariants').click();
    await page.selectOption('#variantMode','boxes');
    await page.evaluate(()=>{
      const make=TidyVariant.make;
      TidyVariant.make=async(source,masks,options)=>{
        if(source.key!=='variant-smoke')return {reason:'Không có bản dự phòng trong fixture.'};
        const candidate=await make(source,masks,options);
        if(!candidate.doc)return candidate;
        return {fallback:{...candidate,repacked:true},reason:'Có bản chia lại hộp đã kiểm đường thắng.'};
      };
      window.restoreVariantMake=()=>{TidyVariant.make=make;};
    });
    await page.locator('#variantAll').click();
    await wait(()=>$('variantStatus').textContent.startsWith('Có 0/3'));
    assert(await page.locator('#downloadVariants').isHidden());
    await page.locator('#variantChanges summary').click();await page.locator('#variantChangeRows button').click();
    assert.match(await page.locator('#variantPreviewTitle').innerText(),/Bản chia lại hộp/);
    await page.locator('#variantSave').click();
    await page.locator('#downloadVariants').waitFor({state:'visible'});
    assert.match(await page.locator('#variantStatus').innerText(),/1\/3 bản biến tấu/);
    await page.evaluate(()=>window.restoreVariantMake());
    await page.locator('#closeVariants').click();

    await page.locator('#openVariants').click();
    await page.selectOption('#variantMode','boxes');await page.locator('#variantAll').click();
    await page.locator('#downloadVariants').waitFor({state:'visible'});
    assert.match(await page.locator('#variantStatus').innerText(),/2\/3 bản biến tấu · 1 màn giữ bản gốc/);
    await page.locator('#variantChanges summary').click();
    await page.locator('#variantChangeRows button').last().click();
    await page.locator('#variantDiscard').click();
    assert.match(await page.locator('#variantStatus').innerText(),/1\/3 bản biến tấu · 2 màn giữ bản gốc/);
    const variantDownload=page.waitForEvent('download');await page.locator('#downloadVariants').click();
    const alternate=JSON.parse(fs.readFileSync(await (await variantDownload).path(),'utf8'));
    assert.equal(alternate.levels.length,3);
    assert.equal(alternate.levels[1].key,'variant-tutorial');
    assert.notDeepEqual(alternate.levels[0].order.map(b=>b.type),[1,2,3]);
    assert.equal(alternate.levels[0].proof.length,variantSource.items.length);
    assert.deepEqual(await page.evaluate(()=>batch.levels[0]),variantSource);
    await page.locator('#closeVariants').click();
    await page.waitForTimeout(450);await page.reload();await resumeDraft();
    await wait(()=>document.querySelector('#batchLevel').options.length===3);
    assert.match(await page.locator('#title').inputValue(),/Biến tấu 1/);
    await page.locator('#library').click();
    await page.locator('#files').setInputFiles({name:'alternates.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(alternate))});
    await page.waitForFunction(key=>batch?.key===key,alternate.key);
    assert.equal(await page.evaluate(()=>Offline.proofRoute(batch.levels[0])?.length),variantSource.items.length);

    const movedVariant=await page.evaluate(async source=>{
      let seed=201746;
      const random=()=>((seed=Math.imul(1664525,seed)+1013904223>>>0)/4294967296);
      const result=await TidyVariant.make(source,masks,{mode:'positions',random});
      if(!result.doc)return {reason:result.reason};
      const {doc}=result;
      const board=new TidyGame.Playtest(doc,masks);
      const proof=TidyGenerator.verifyRoute(doc,masks,doc.boxes,Offline.proofRoute(doc),board.cache);
      const before=new Map(source.items.map(it=>[it.uid,it]));
      const anchors=items=>items.map(it=>`${it.x},${it.y}`).sort().join('|');
      return {
        positions:result.positions,clusters:result.clusters,layerItems:result.layerItems,boxPositions:result.boxPositions,
        moved:doc.items.filter(it=>it.x!==before.get(it.uid).x||it.y!==before.get(it.uid).y).length,
        boundary:doc.items.every(it=>TidyGame.fitsBackground(doc.background,it)),won:!!proof,
        anchorsPreserved:anchors(doc.items)===anchors(source.items),difficultyDelta:result.difficulty.delta,
      };
    },variantSource);
    assert(movedVariant.positions>=Math.ceil(variantSource.items.length*.35),JSON.stringify(movedVariant));
    assert.equal(movedVariant.positions,movedVariant.moved);
    assert(movedVariant.won&&movedVariant.boundary&&movedVariant.anchorsPreserved&&Math.abs(movedVariant.difficultyDelta)<=7);
    await page.locator('#library').click();await page.locator('#allTidy').click();
    await page.waitForFunction(()=>batch?.key==='tidy57-original-100');
    assert.equal(await page.locator('#batchLevel option').count(),100);
    assert.match(await page.locator('#referenceInfo').innerText(),/Tidy Room 57 · Normal · 90s/);
    await page.selectOption('#batchLevel','99');
    assert(await page.evaluate(()=>batch.rejected.length===0&&TidyGame.check(level).ok&&!!TidyGame.sourceGeometry(level)));
    const originalTidy=await page.evaluate(()=>{
      const used=new Set(batch.levels.flatMap(l=>[l.background.asset,...l.items.map(it=>it.asset)]));
      const families=new Map([...Offline.catalog.items,...Offline.catalog.backgrounds].map(row=>[row.path,row.family]));
      return {
        tags:batch.levels.reduce((rows,l)=>(rows[l.reference.difficulty]++,rows),[0,0,0]),
        valid:batch.levels.every(l=>TidyGame.check(l).ok&&!!TidyGame.sourceGeometry(l)&&Offline.proofRoute(l)?.length===l.items.length),
        assets:[...used].map(asset=>new URL(assetURL(asset),location.href).href),
        originalArt:[...used].every(asset=>families.get(asset)==='tidy'),
      };
    });
    assert.deepEqual(originalTidy.tags,[80,10,10]);
    assert(originalTidy.valid&&originalTidy.originalArt&&originalTidy.assets.every(url=>fs.existsSync(fileURLToPath(url))));

    // A draped slot can trade with another compatible edge but not with a flat slot.
    const edgeCheck=await page.evaluate(async()=>{
      const source=newLevel();
      const rows=[
        ['11-1',11,-250,104,0],['11-2',11,250,104,0],
        ['611-1',611,0,435,0],['11-3',11,225,-225,0],['11-4',11,-225,-225,0],
        ['74-1',74,-125,-455,0],['74-2',74,125,-455,0],
      ];
      source.items=rows.map(([id,group,x,y,angle],i)=>({uid:`edge-${i}`,asset:`Art/RoomSortOffline/Items/${id}.png`,
        group,targetType:group,x,y,angle,width:120,height:100,scaleX:1,scaleY:1,layer:i}));
      source.boxes=[{group:11,targetType:11,count:4,label:'Đồ ghim mép'},{group:611,targetType:611,count:1,label:'Khăn phủ'},
        {group:74,targetType:74,count:2,label:'Khăn vắt'}];
      await Promise.all(source.items.map(it=>getMask(it.asset)));
      const uv=(x,y)=>[x/source.background.width+.5,.5-y/source.background.height];
      const template={zones:[],edges:[
        {asset:source.items[0].asset,points:[uv(-325,120),uv(-175,120)]},
        {asset:source.items[1].asset,points:[uv(175,120),uv(325,120)]},
      ]};
      const statuses=[];
      const options={mode:'positions',strength:2,effort:'extended',template,random:()=>.51,progress:p=>statuses.push(p.stage)};
      const result=await TidyVariant.make(source,masks,options);
      const cancelled=await TidyVariant.make(source,masks,{...options,stopped:()=>true});
      const auto=await TidyVariant.make(source,masks,{...options,strength:1,template:{zones:[],edges:[]},progress:()=>{}});
      if(!result.doc)return {reason:result.reason};
      const a=result.doc.items.find(it=>it.uid==='edge-0'),b=result.doc.items.find(it=>it.uid==='edge-1');
      const pinned=result.doc.items.find(it=>it.uid==='edge-2');
      return {draped:result.draped,pinned:result.pinned,statuses,cancelled:cancelled.cancelled,
        exchanged:a.x===250&&b.x===-250&&a.y===104&&b.y===104&&a.layer===1&&b.layer===0,
        autowrap:auto.doc?.items.find(it=>it.uid==='edge-5')?.x===125&&auto.doc?.items.find(it=>it.uid==='edge-6')?.x===-125,
        protected:pinned.x===0&&pinned.y===435&&pinned.layer===2};
    });
    assert.equal(edgeCheck.draped,4,JSON.stringify(edgeCheck));
    assert.equal(edgeCheck.pinned,1);
    assert(edgeCheck.exchanged&&edgeCheck.protected&&edgeCheck.autowrap&&edgeCheck.cancelled);
    assert.deepEqual(edgeCheck.statuses.slice(0,2),['baseline','layout']);

    await page.evaluate(([asset,room])=>{
      const doc=newLevel();batch=null;inspector='layer';
      const bg=Offline.catalog.backgrounds.find(a=>a.path===room);
      doc.background={asset:room,width:bg.w,height:bg.h,cameraX:0};
      doc.items=[[-145,115],[145,115],[220,-265]].map(([x,y],layer)=>({uid:`select-${layer}`,asset,group:11,
        targetType:11,x,y,layer,width:100,height:85,angle:0,scaleX:1,scaleY:1}));
      openLevel(doc);
    },[key,room]);
    const state=()=>page.evaluate(()=>({items:level.items.map(({uid,x,y,angle,scaleX,scaleY})=>[uid,x,y,angle,scaleX,scaleY]),selection:[...selection],edits:history.length}));
    const boxSelect=async(a,b)=>{
      await page.mouse.move(...await worldPoint(...a));await page.mouse.down();
      await page.mouse.move(...await worldPoint(...b),{steps:12});await page.mouse.up();
    };
    await board.focus();await page.keyboard.press('m');
    await boxSelect([-225,205],[220,40]);
    assert(await page.evaluate(()=>!marqueeMode));
    const original=await state();
    assert.deepEqual(original.selection,['select-0','select-1']);
    assert.match(await page.locator('#selectionCount').innerText(),/2 món/);
    await page.keyboard.down('Shift');await clickWorld(220,-265);await page.keyboard.up('Shift');
    assert.equal((await state()).selection.length,3);
    await page.keyboard.down('Shift');await clickWorld(220,-265);await page.keyboard.up('Shift');
    assert.deepEqual((await state()).selection,original.selection);

    await page.mouse.move(...await worldPoint(-145,115));await page.mouse.down();
    await page.mouse.move(...await worldPoint(-78,78),{steps:12});
    assert.deepEqual(await state(),original);
    assert(await page.evaluate(()=>drag?.projects?.size===2));
    await page.mouse.up();
    const moved=await state();
    assert.equal(moved.edits,1);
    assert(Math.abs(moved.items[0][1]+78)<3&&Math.abs(moved.items[1][1]-212)<3);
    assert.deepEqual(moved.items[2],original.items[2]);
    await page.keyboard.press('Control+z');assert.deepEqual(await state(),original);
    await page.keyboard.press('Control+Shift+z');assert.deepEqual(await state(),moved);
    await boxSelect([-78,78],[bg.w/2+100,78]);
    assert.deepEqual(await state(),moved);
    await page.mouse.move(...await worldPoint(-78,78));await page.mouse.down();
    await page.mouse.move(...await worldPoint(-25,160),{steps:8});await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await state(),moved);

    const dragResize=async factor=>{
      const {x,y,tx,ty}=await page.evaluate(factor=>{
        const {point:[x,y],pivot}=resizeHandles(currentBounds())[2];
        const [px,py]=screen(pivot.x,pivot.y),r=canvas.getBoundingClientRect();
        return {x:r.left+x,y:r.top+y,tx:r.left+px+(x-px)*factor,ty:r.top+py+(y-py)*factor};
      },factor);
      await page.mouse.move(x,y);await page.mouse.down();
      await page.mouse.move(tx,ty,{steps:10});await page.mouse.up();
    };
    await dragResize(1.4);
    const resized=await state();
    assert.equal(resized.edits,moved.edits+1);
    assert(Math.abs(resized.items[0][4]-1.4)<.03&&resized.items[0][4]===resized.items[1][4]);
    assert.deepEqual(resized.items[2],moved.items[2]);
    await page.keyboard.press('Control+z');assert.deepEqual(await state(),moved);
    await clickWorld(220,-265);
    await dragResize(.65);
    assert(Math.abs((await state()).items[2][4]-.65)<.04);
    await page.keyboard.press('Control+z');
    await page.evaluate(uids=>setSelection(uids),moved.selection);
    assert.deepEqual(await state(),moved);

    const gizmo=await page.evaluate(()=>{
      const bounds=currentBounds(),[x,y]=rotationHandle(bounds),[px,py]=screen(bounds.x,bounds.y),rect=canvas.getBoundingClientRect();
      return {x:x+rect.left,y:y+rect.top,tx:px+rect.left+Math.abs(py-y),ty:py+rect.top};
    });
    await page.keyboard.down('Shift');
    await page.mouse.move(gizmo.x,gizmo.y);await page.mouse.down();
    await page.mouse.move(gizmo.tx,gizmo.ty,{steps:12});await page.mouse.up();await page.keyboard.up('Shift');
    const turned=await state();
    assert.equal(Math.abs(turned.items[0][3]),90);
    assert.equal(turned.items[0][3],turned.items[1][3]);
    assert(Math.abs(turned.items[0][1]-turned.items[1][1])<1);
    await page.keyboard.press('Control+z');assert.deepEqual(await state(),moved);
    await page.locator('#turnLeft').click();
    assert.deepEqual((await state()).items.map(it=>it[3]),[15,15,0]);
    await page.locator('#undo').click();assert.deepEqual(await state(),moved);
    await page.locator('#alignGroup').selectOption('left');
    const aligned=await state();assert.equal(aligned.items[0][1],aligned.items[1][1]);
    await page.locator('#undo').click();assert.deepEqual(await state(),moved);
    await board.focus();await page.keyboard.press('Shift+ArrowUp');
    assert.equal((await state()).items[0][2],moved.items[0][2]+10);
    await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
    assert.equal((await state()).items.length,5);
    await page.keyboard.press('Delete');assert.equal((await state()).items.length,3);
    await page.keyboard.press('Control+z');assert.equal((await state()).selection.length,2);
    assert.equal((await state()).items.length,5);
    await page.keyboard.press('Control+a');assert.equal((await state()).selection.length,5);
    await page.locator('#editHelp').click();assert(await page.locator('#editorHelp').isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#portrait').getAttribute('aria-pressed'),'false');
    await page.locator('#portrait').click();assert.equal(await page.locator('#portrait').getAttribute('aria-pressed'),'true');
    await page.locator('#portrait').click();assert.equal(await page.locator('#portrait').getAttribute('aria-pressed'),'false');
    await page.locator('#center').click();
    const centered=await page.evaluate(()=>({height:canvas.clientHeight,backgroundHeight:level.background.height*makeTransform(canvas.clientWidth,canvas.clientHeight).s,dx:view.dx,dy:view.dy}));
    assert(Math.abs(centered.backgroundHeight-centered.height)<1);
    assert.equal(centered.dx,0);assert.equal(centered.dy,0);
    await page.evaluate(([asset,room])=>{
      const doc=newLevel();
      const bg=Offline.catalog.backgrounds.find(a=>a.path===room);
      doc.background={asset:room,width:bg.w,height:bg.h,cameraX:0};
      doc.items=[-200,0,200].map((x,i)=>({uid:`motion-${i}`,asset,x,y:0,group:11+i,targetType:11+i,layer:i,
        width:100,height:85,angle:0,scaleX:1,scaleY:1}));
      doc.boxes=[11,12,13].map((group,i)=>({group,targetType:group,count:1,label:`Hộp ${i+1}`}));
      openLevel(doc);
    },[key,room]);
    await page.locator('#play').click();
    await page.locator('#testTray').waitFor({state:'visible'});
    const hoverRules=await page.evaluate(()=>{
      const target=game.items[0];
      updatePlayHover(target.x,target.y);
      const selectable=playHover?.index===0;
      const higher=game.items[2];higher.x=target.x;higher.y=target.y;
      game.geom[2].item=higher;
      const original=game.covered.bind(game);game.covered=j=>j===2||original(j);
      updatePlayHover(target.x,target.y);
      const blocked=playHover===null;
      game.covered=original;
      higher.x=200;
      game.tray=[0,0,0,0,0];
      updatePlayHover(higher.x,higher.y);
      const fullTray=playHover===null;
      game.tray=[];
      return {selectable,blocked,fullTray};
    });
    assert.deepEqual(hoverRules,{selectable:true,blocked:true,fullTray:true});
    const tapGameItem=async j=>{
      const [x,y]=await page.evaluate(j=>game.pointFor(j),j);
      await clickWorld(x,y);
    };
    await tapGameItem(2);
    await page.locator('#testTray img').waitFor({state:'visible'});
    await tapGameItem(0);
    await page.waitForFunction(()=>playMotion?.queue.some(effect=>effect.kind==='box'&&effect.fromTray===0));
    await wait(()=>!playMotion&&game.delivered===2);
    assert.equal(await page.locator('#testTray img').count(),0);
    await tapGameItem(1);await page.locator('.play-flight').waitFor({state:'attached'});
    await page.locator('#exitPlay').click();
    assert.equal(await page.locator('.play-flight').count(),0);
    await page.locator('#jsonTab').click();
    for(const format of ['tool','unity']){
      await page.locator('#jsonFormat').selectOption(format);
      const expected=await page.locator('#jsonContent').inputValue();
      const download=page.waitForEvent('download');
      await page.locator('#saveJson').click();
      const file=await download;
      assert.equal(fs.readFileSync(await file.path(),'utf8'),expected);
      const chooser=page.waitForEvent('filechooser');
      await page.locator(format==='unity'?'#openLevelFile':'#openJson').click();
      await (await chooser).setFiles({name:file.suggestedFilename(),mimeType:'application/json',buffer:Buffer.from(expected)});
      await wait(()=>!busyImport&&$('notice').textContent.includes('Đã nhập 1 màn'));
      assert.equal(await page.locator('#jsonContent').inputValue(),expected);
    }
    await page.evaluate(()=>{
      window.qaFileWrites={};
      window.qaSavePrompts=[];
      window.qaHandle=name=>({
        name,
        async isSameEntry(other){return other.name===name;},
        async createWritable(){return {async write(value){window.qaFileWrites[name]=value;},async close(){}};},
      });
      window.showSaveFilePicker=async({suggestedName})=>{
        window.qaSavePrompts.push(suggestedName);
        return window.qaHandle(suggestedName);
      };
    });
    for(const [id,format] of [['download','JSON'],['unity','Unity']]){
      const control=page.locator('#'+id);
      assert.match(await control.innerText(),/^Xuất/);
      await control.click();
      await wait(()=>!fileSaveBusy);
      assert.equal(await control.innerText(),'Lưu Data '+format);
      await control.click();
      await wait(()=>!fileSaveBusy);
    }
    assert(await page.evaluate(()=>window.qaSavePrompts.length===2&&
      Object.values(window.qaFileWrites).some(value=>JSON.parse(value).schema==='tidy-level/2')&&
      Object.values(window.qaFileWrites).some(value=>JSON.parse(value).coverageMode==='art')));
    await page.evaluate(()=>{
      const data=window.qaFileWrites[fileTargets.tool.name];
      const handle=window.qaHandle('opened.tidy.json');
      handle.getFile=async()=>new File([data],handle.name);
      window.showOpenFilePicker=async()=>[handle];
    });
    await page.locator('#openJson').click();
    await wait(()=>fileTargets.tool?.name==='opened.tidy.json');
    await page.locator('#download').click();
    await wait(()=>Object.hasOwn(window.qaFileWrites,'opened.tidy.json'));
    assert.equal(await page.evaluate(()=>window.qaSavePrompts.length),2);
    const grades=await page.evaluate(async asset=>{
      const doc=newLevel();
      doc.rule='strict';
      doc.items=Array.from({length:6},(_,i)=>({uid:`difficulty-${i}`,asset,x:0,y:0,group:i+1,targetType:i+1,
        layer:i,width:100,height:85,angle:0,scaleX:1,scaleY:1}));
      const mask=await getMask(asset);
      const result=[];
      for(const difficulty of ['easy','medium','hard']){
        const sample=await TidyGenerator.boxesFromLayout(doc,new Map([[asset,mask]]),{maxBox:1,difficulty});
        result.push([sample.difficulty,sample.peak,sample.points.length]);
      }
      return result;
    },key);
    assert.deepEqual(grades.map(([grade])=>grade),['easy','medium','hard']);
    assert(grades[0][1]<grades[1][1]&&grades[1][1]<grades[2][1]&&grades.every(row=>row[2]===6));
    await page.setViewportSize({width:420,height:880});
    await wait(()=>canvas.clientHeight>550);
    const phoneCanvas=await board.boundingBox();
    assert(phoneCanvas.height>phoneCanvas.width);

    assert.deepEqual(errors,[]);
    assert.deepEqual(network,[]);
    console.log(`PASS: offline workflows, variant review, original Tidy Room 57, canvas marquee and multi-drag, group rotation, transform history, shortcuts and vertical layout`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
