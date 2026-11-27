const TidyVariant = (() => {
  const {sorted, Playtest, stackLayers, layoutKey, reorderSourceGeometry, fitsBackground} = TidyGame;
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const boxId = box => `${box.group}:${box.count}`;
  const queue = boxes => {
    const ids = boxes.map(boxId);
    return [...ids.slice(0,2).sort(), ...ids.slice(2)].join(',');
  };
  const signature = level => JSON.stringify([layoutKey(level.items), sorted(level.items).map(i => i.group), queue(level.boxes)]);
  const pick = (choices, random) => choices[Math.floor(random() * choices.length)];
  const profiles = {
    1:{positions:.20,boxes:.20,layers:.14,clusters:.30},
    2:{positions:.35,boxes:.34,layers:.23,clusters:.45},
    3:{positions:.50,boxes:.45,layers:.32,clusters:.55},
  };
  const searchProfiles={
    quick:{layouts:12,time:10_000,finalists:1,width:12,fanOut:5},
    deep:{layouts:24,time:28_000,finalists:3,width:32,fanOut:8},
    extended:{layouts:42,time:65_000,finalists:5,width:64,fanOut:10},
  };
  // Color variants of the same baked-in fold in the RoomSort and Tidy Room art.
  const drapePoses=new Map([
    ['1-4','arch-pants'],['1-11','arch-pants'],
    ['1-15','hook-pants'],['1-19','hook-pants'],['1-20','hook-pants'],
    ['12-1','hook-towel'],['12-4','edge-towel'],
    ...Array.from({length:8},(_,i)=>[`74-${i+1}`,'rail-towel']),
    ['107-6','edge-pants'],['611-1','draped-cloth'],
  ]);

  function shuffled(items,random) {
    const result=[...items];
    for(let i=result.length-1;i>0;i--){
      const j=Math.floor(random()*(i+1));
      [result[i],result[j]]=[result[j],result[i]];
    }
    return result;
  }

  function spriteFootprint(it) {
    const a=it.angle*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
    const w=Math.abs(it.width*it.scaleX),h=Math.abs(it.height*it.scaleY);
    return {hx:(w*c+h*s)/2,hy:(w*s+h*c)/2,size:Math.sqrt(w*h)};
  }

  function overlap(a,b,extents) {
    const A=extents.get(a.uid),B=extents.get(b.uid);
    const x=Math.min(a.x+A.hx,b.x+B.hx)-Math.max(a.x-A.hx,b.x-B.hx);
    const y=Math.min(a.y+A.hy,b.y+B.hy)-Math.max(a.y-A.hy,b.y-B.hy);
    return x>0&&y>0 ? x*y/(4*Math.min(A.hx*A.hy,B.hx*B.hy)) : 0;
  }

  function inZone({x,y},points) {
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [a,b]=points[i],[c,d]=points[j];
      if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
    }
    return inside;
  }

  const angleDistance=(a,b)=>Math.abs(((a-b+180)%360+360)%360-180);
  function atEdge(item,frame) {
    const {a,dx,dy,length,normal,angle}=frame;
    if(!length||angleDistance(item.angle,angle)>12)return null;
    const x=item.x-a[0],y=item.y-a[1];
    const t=(x*dx+y*dy)/(length*length);
    const drop=(x*normal[0]+y*normal[1])/Math.abs(item.height*item.scaleY);
    return t>=0&&t<=1&&drop>=-.03&&drop<=.4?{t,drop}:null;
  }
  function nearEdge(item,{a,dx,dy,length},extent){
    if(!length)return false;
    const x=item.x-a[0],y=item.y-a[1];
    const t=Math.max(0,Math.min(1,(x*dx+y*dy)/(length*length)));
    return Math.hypot(x-dx*t,y-dy*t)<1.2*Math.max(extent.hx,extent.hy);
  }

  function placementRules(source,template) {
    const zones=template.zones.map(z=>z.points.map(p=>TidyGenerator.toWorld(p,source.background)));
    const edges=template.edges.map(e=>({asset:e.asset,frame:TidyGenerator.edgeFrame(
      e.points.map(p=>TidyGenerator.toWorld(p,source.background)))}));
    const extents=new Map(source.items.map(it=>[it.uid,spriteFootprint(it)]));
    const anchors=new Map(source.items.map(it=>[it.uid,zones.filter(z=>inZone(it,z))]));
    const locked=new Set(),mounts=new Map(),protectedLayers=new Set();
    for(const it of source.items){
      const bakedPose=drapePoses.get(it.asset.split('/').at(-1).replace(/\.png$/i,''));
      const nearby=edges.filter(e=>(e.asset===it.asset||bakedPose)&&nearEdge(it,e.frame,extents.get(it.uid)));
      if(!bakedPose&&!nearby.length)continue;
      protectedLayers.add(it.uid);
      const choices=nearby
        .map(e=>({frame:e.frame,attachment:atEdge(it,e.frame)}))
        .filter(e=>e.attachment)
        .sort((a,b)=>Math.abs(a.attachment.drop-.16)-Math.abs(b.attachment.drop-.16));
      if(choices.length||bakedPose)mounts.set(it.uid,{pose:bakedPose,frame:choices[0]?.frame});
      else locked.add(it.uid);
    }
    return {extents,anchors,locked,mounts,protectedLayers};
  }

  function moveLayout(source,profile,rules,random,guided) {
    const {extents,anchors,locked,mounts}=rules,room=source.background;
    const live=new Map(source.items.map(it=>[it.uid,it])), moved=new Set();
    const goal=Math.ceil(source.items.length*profile.positions);
    const available=shuffled(source.items.filter(it=>!locked.has(it.uid)),random);
    const partners=new Map(available.map(it=>[it.uid,[]]));
    let clusters=0,clusterItems=0,draped=0;
    const clusterGoal=Math.ceil(goal*profile.clusters);

    function compatible(a,b) {
      if(a.asset===b.asset&&a.group===b.group&&a.angle===b.angle&&
        a.scaleX===b.scaleX&&a.scaleY===b.scaleY)return false;
      const A=extents.get(a.uid),B=extents.get(b.uid);
      if(guided&&a.group!==b.group)return false;
      if(Math.max(A.hx/B.hx,B.hx/A.hx,A.hy/B.hy,B.hy/A.hy)>1.30||
        Math.max(A.size/B.size,B.size/A.size)>1.20)return false;
      const mountA=mounts.get(a.uid),mountB=mounts.get(b.uid);
      if(mountA||mountB){
        if(!mountA||!mountB||a.group!==b.group||mountA.pose!==mountB.pose
          || Math.sign(a.scaleX)!==Math.sign(b.scaleX)||Math.sign(a.scaleY)!==Math.sign(b.scaleY))return false;
        const {frame:edgeA}=mountA,{frame:edgeB}=mountB;
        if(edgeA||edgeB){
          if(!edgeA||!edgeB||angleDistance(edgeA.angle,edgeB.angle)>12)return false;
          if(!atEdge({...a,x:b.x,y:b.y},edgeB)||!atEdge({...b,x:a.x,y:a.y},edgeA))return false;
        }else if(angleDistance(a.angle,b.angle)>8)return false;
      }
      const from=anchors.get(a.uid),to=anchors.get(b.uid);
      if(!mountA?.frame&&(from.length||to.length)&&!from.some(zone=>to.includes(zone)))return false;
      const distance=Math.hypot(a.x-b.x,a.y-b.y),larger=Math.max(A.size,B.size);
      return distance>=Math.max(larger*.67,Math.min(room.width,room.height)*.022)
        &&(mountA?.frame||from.length||distance<=larger*3.3)
        &&fitsBackground(room,{...a,x:b.x,y:b.y})&&fitsBackground(room,{...b,x:a.x,y:a.y});
    }
    for(const [i,a] of available.entries())for(let j=i+1;j<available.length;j++){
      const b=available[j];
      if(!compatible(a,b))continue;
      partners.get(a.uid).push(b);partners.get(b.uid).push(a);
    }

    function exchange(pairs) {
      const swaps=pairs.flatMap(([a,b])=>[[a,b],[b,a]]);
      const replaced=new Map(swaps.map(([a,b])=>[b.uid,{...a,x:b.x,y:b.y,layer:guided||mounts.has(a.uid)?b.layer:a.layer}]));
      for(const [,anchor] of swaps){
        const incoming=replaced.get(anchor.uid);
        let addedOverlap=0;
        for(const other of live.values()){
          if(other.uid===anchor.uid)continue;
          const next=overlap(incoming,replaced.get(other.uid)??other,extents);
          if(next<.14)continue;
          const before=overlap(anchor,other,extents);
          if(next>=.86&&next-before>.24)return false;
          addedOverlap+=Math.max(0,next-before-.10);
          if(addedOverlap>.53)return false;
        }
      }
      for(const [a,b] of swaps){live.set(a.uid,replaced.get(b.uid));moved.add(a.uid);}
      return true;
    }

    for(const a of available){
      if(moved.size>=goal)break;
      if(!mounts.has(a.uid)||moved.has(a.uid))continue;
      const b=partners.get(a.uid).find(it=>!moved.has(it.uid)&&exchange([[a,it]]));
      if(b)draped+=2;
    }
    for(const a of available){
      if(clusterItems>=clusterGoal||moved.size>=goal)break;
      if(moved.has(a.uid)||mounts.has(a.uid))continue;
      const close=available.filter(it=>it!==a&&!moved.has(it.uid)&&!mounts.has(it.uid)
        &&Math.hypot(it.x-a.x,it.y-a.y)<extents.get(a.uid).size*1.15);
      if(!close.length)continue;
      for(const b of partners.get(a.uid).slice(0,12)){
        if(moved.has(b.uid))continue;
        const dx=b.x-a.x,dy=b.y-a.y,pairs=[[a,b]],used=new Set([a.uid,b.uid]);
        for(const c of close){
          if(used.has(c.uid))continue;
          const size=extents.get(c.uid).size;
          let best=null,bestDistance=size*.66;
          for(const d of partners.get(c.uid)){
            if(used.has(d.uid)||moved.has(d.uid)||Math.hypot(b.x-d.x,b.y-d.y)>extents.get(b.uid).size*1.2)continue;
            const distance=Math.hypot(c.x+dx-d.x,c.y+dy-d.y);
            if(distance<bestDistance){best=d;bestDistance=distance;}
          }
          if(!best)continue;
          pairs.push([c,best]);used.add(c.uid);used.add(best.uid);
          if(pairs.length>=3)break;
        }
        if(pairs.length<2)continue;
        if(exchange(pairs)||(pairs.length===3&&exchange(pairs.slice(0,2)))){
          clusters+=2;clusterItems+=pairs.filter(([c])=>moved.has(c.uid)).length*2;
          break;
        }
      }
    }
    for(const a of available){
      if(moved.size>=goal)break;
      if(moved.has(a.uid)||mounts.has(a.uid))continue;
      for(const b of partners.get(a.uid)){
        if(!moved.has(b.uid)&&exchange([[a,b]]))break;
      }
    }
    return {items:source.items.map(it=>live.get(it.uid)),positions:moved.size,clusters,draped};
  }

  function reorderBoxes(boxes, swaps, random) {
    const result = [...boxes];
    const used = new Set();
    for (let n = 0; n < swaps; n++) {
      const candidates = [];
      for (let a = 0; a < result.length; a++) {
        if (used.has(a)) continue;
        for (let b = Math.max(a+1,2); b < Math.min(result.length,a+4); b++) {
          if (!used.has(b) && boxId(result[a]) !== boxId(result[b])) candidates.push([a,b]);
        }
      }
      if (!candidates.length) break;
      const [a,b] = pick(candidates,random);
      [result[a],result[b]] = [result[b],result[a]];
      used.add(a);used.add(b);
    }
    return result;
  }

  function reorderItems(order, pairs, swaps, random) {
    const result = [...order], altered = new Set();
    for (let n = 0; n < swaps; n++) {
      const options = pairs.filter(([a,b]) => !altered.has(a) && !altered.has(b) &&
        result.indexOf(a) < result.indexOf(b));
      if (!options.length) break;
      const [lower,upper] = pick(options,random);
      result.splice(result.indexOf(upper),1);
      result.splice(result.indexOf(lower),0,upper);
      altered.add(lower);altered.add(upper);
    }
    // Keep the same layer IDs so only their assignment changes.
    return result.map((it,i) => ({...it,layer:order[i].layer}));
  }

  function layerSections(order,protectedLayers){
    let section=0;
    const result=new Map();
    for(const it of order){
      if(protectedLayers.has(it.uid))section++;
      else result.set(it.uid,section);
    }
    return result;
  }

  function tryRoute(board, masks, path) {
    return path && TidyGenerator.verifyRoute(board.level,masks,board.level.boxes,path,board.cache);
  }
  function reorderWithProof(board,masks,sourceBoxes,path,minChanges,random){
    if(!path)return null;
    const playable=boxes=>{
      const game=new Playtest({...board.level,boxes},masks);
      game.cache=board.cache;
      for(const i of path){
        const {kind}=game.tap(i);
        if(kind!=='box'&&kind!=='tray'||game.state==='lose')return false;
      }
      return game.state==='win';
    };
    if(!playable(sourceBoxes))return null;
    const boxes=[...sourceBoxes],positions=()=>boxes.filter((box,i)=>boxId(box)!==boxId(sourceBoxes[i])).length;
    const pairs=sourceBoxes.flatMap((_,i)=>[i+1,i+2,i+3].filter(j=>j>=2&&j<sourceBoxes.length).map(j=>[i,j]));
    for(const [i,j] of shuffled(pairs,random).slice(0,32)){
      if(boxId(boxes[i])===boxId(boxes[j]))continue;
      const before=positions();
      [boxes[i],boxes[j]]=[boxes[j],boxes[i]];
      if(positions()>before&&playable(boxes)){
        if(positions()>=minChanges)return boxes;
      }else [boxes[i],boxes[j]]=[boxes[j],boxes[i]];
    }
    return null;
  }
  const difficultyTrials=[
    {policy:'visible',seed:41},{policy:'visible',seed:43},
    {policy:'chain',seed:41},{policy:'chain',seed:43},
    {policy:'branch',seed:41},{policy:'branch',seed:43},
  ];

  function measureDifficulty(bot){
    let sum=0,won=0;
    for(const trial of difficultyTrials){
      const result=bot.run(trial),size=bot.groups.length;
      const pressure=.6*result.waits/size+.4*result.tight/size;
      sum+=.45*(1-result.picked/size)+.22*Number(!result.won)+.20*result.peak/5+.13*pressure;
      won+=Number(result.won);
    }
    return {score:Math.round(sum/difficultyTrials.length*1000)/10,won,trials:difficultyTrials.length};
  }

  function matchesDifficulty(target,delta){
    if(target==='harder')return delta>=3;
    if(target==='easier')return delta<=-3;
    return Math.abs(delta)<=7;
  }

  // Choose the next existing box when a slot opens, using the current room and tray.
  function adaptQueue(doc,masks,preferred,cache,random,bias,priorities) {
    const boxes=[],remaining=[...preferred],plan={...doc,boxes};
    const game=new Playtest(plan,masks),below=game.items.map(()=>[]);
    game.cache=cache;
    for(const [i] of game.items.entries())for(const {j} of game.coverData(i).covers)below[j].push(i);
    const free=new Set([...game.room].filter(i=>!game.covered(i)));
    game.assign=function(slot){
      const ready=new Map(),waiting=new Map();
      for(const i of free){
        if(!game.room.has(i))continue;
        const group=game.items[i].group;
        ready.set(group,(ready.get(group)??0)+1);
      }
      for(const i of game.tray){
        const group=game.items[i].group;
        waiting.set(group,(waiting.get(group)??0)+1);
      }
      let choice=-1,best=-Infinity;
      const other=game.boxes.find(box=>box!==slot);
      const active=game.order(other)?.group;
      const upcoming=new Map();
      if(priorities)for(const i of priorities){
        if(!game.room.has(i))continue;
        const group=game.items[i].group;
        if(!upcoming.has(group))upcoming.set(group,upcoming.size);
        if(upcoming.size>=12)break;
      }
      for(const [i,order] of remaining.entries()){
        const {group,count}=order,visible=ready.get(group)??0,held=waiting.get(group)??0;
        const chance=(visible+held)/count;
        const score=Math.min(1,chance)*12+Math.min(count,held)*3+(chance>=1?7:0)
          +(group===active?-14:0)-Math.min(i,25)*bias-(priorities?(upcoming.get(group)??12)*1.1:0)+random()*2.8;
        if(score>best){choice=i;best=score;}
      }
      slot.index=choice<0?-1:boxes.length;slot.count=0;
      if(choice>=0){boxes.push(remaining.splice(choice,1)[0]);game.next++;}
    };
    game.boxes.forEach(box=>game.assign(box));
    const path=[];
    while(game.state==='playing'){
      const wanted=new Set(game.boxes.map(b=>game.order(b)?.group));
      const canWait=game.tray.length < (game.level.rule==='strict'?4:5);
      const options=[];
      for(const i of free){
        const group=game.items[i].group,slot=game.box(group);
        if(slot<0&&!canWait)continue;
        const box=game.boxes[slot],order=box&&game.order(box);
        const unlocks=below[i].filter(j=>game.room.has(j)&&!free.has(j)&&wanted.has(game.items[j].group)).length;
        const rank=priorities?.indexOf(i)??-1;
        const score=(order?20+5/(order.count-box.count):0)+unlocks*3+(rank<0?0:12*(1-rank/game.items.length))+random();
        options.push({i,score});
      }
      options.sort((a,b)=>b.score-a.score);
      const move=options.find(({i})=>game.pointFor(i));
      if(!move)return null;
      const {i}=move;
      free.delete(i);
      // Expose neighbours before assign() looks for the next box.
      game.room.delete(i);
      for(const j of below[i])if(game.room.has(j)&&!game.covered(j))free.add(j);
      game.room.add(i);
      game.tap(i);
      path.push(i);
    }
    return game.state==='win'?{doc:plan,path}:null;
  }

  async function make(source, masks, {
    mode = 'both', strength = 2, template = {zones:[],edges:[]}, exclude = new Set(),
    difficulty = 'same', effort = 'deep', stopped = () => false, progress = () => {}, random = Math.random,
  } = {}) {
    Offline.validate(source,true);
    const changeBoxes=mode==='both'||mode==='boxes';
    const changeLayers=mode==='both'||mode==='layers';
    const changePositions=mode==='both'||mode==='positions';
    const profile=profiles[strength]??profiles[2];
    const budget=searchProfiles[effort]??searchProfiles.deep;
    const started=performance.now(),deadline=started+budget.time;
    const layoutDeadline=started+budget.time*.7;
    let expired=false;
    const report=(stage,current,total)=>progress({stage,current,total,elapsed:performance.now()-started});
    const order = sorted(source.items), originalQueue = queue(source.boxes);
    const sourceBoard=new Playtest(source,masks);
    const tried = new Set([...exclude,signature(source)]);
    const initialPairs=[];
    const rules=changePositions||changeLayers?placementRules(source,template):null;
    const polygonSamples=new WeakMap();
    const minimumPositions=changePositions?Math.ceil(order.length*profile.positions):0;
    const boxSwaps=changeBoxes?Math.max(1,Math.ceil(source.boxes.length*profile.boxes/2)):0;
    if (changeBoxes && (source.boxes.length < 3 || new Set(source.boxes.map(box => box.group)).size < 2))
      return {reason:'Cần ít nhất ba hộp và có hộp khác nhau để đổi lượt mở.'};
    if(changeLayers){
      const stacks=stackLayers(order,masks);
      const sections=layerSections(order,rules.protectedLayers);
      for(const upper of order){
        const lower=stacks.get(upper.uid).below;
        if(lower&&sections.has(upper.uid)&&sections.get(lower.uid)===sections.get(upper.uid)&&
          (lower.group!==upper.group||lower.asset!==upper.asset||
          lower.x!==upper.x||lower.y!==upper.y))initialPairs.push([lower.uid,upper.uid]);
      }
      if(!initialPairs.length&&mode==='layers')return {reason:'Không có cặp chồng đồ phù hợp để đổi lớp mà vẫn giữ lớp đồ vắt.'};
    }
    const varyLayers=changeLayers&&initialPairs.length>0;
    report('baseline',0,0);
    await nextFrame();
    if(stopped())return {cancelled:true};
    const sourceBot=TidyBot.fromPlaytest(sourceBoard);
    const baseline=measureDifficulty(sourceBot);
    let originalRoute=Offline.proofRoute(source);
    if(!originalRoute){
      for(const policy of ['visible','chain','branch']){
        const route=sourceBot.run({policy,seed:41});
        if(route.won){originalRoute=route.path;break;}
      }
    }
    const originalSlots=new Map(order.map((it,i)=>[`${it.x},${it.y},${it.layer}`,i]));
    if(difficulty==='easier'&&baseline.score<3)
      return {reason:`Điểm khó của màn gốc đã ở mức ${baseline.score}/100. Bot chưa thể xác nhận mức giảm 3 điểm.`};
    const promising = [];
    let nearest=null;
    const finish = (entry,path,proof) => {
      const {doc, stats} = entry;
      const measured=measureDifficulty(entry.bot??TidyBot.fromPlaytest(entry.board));
      const delta=Math.round((measured.score-baseline.score)*10)/10;
      const distance=d=>difficulty==='harder'?Math.max(0,3-d):difficulty==='easier'?Math.max(0,3+d):Math.abs(d);
      Offline.validate(doc,true);
      Offline.attachProof(doc,path);
      const result={doc,...stats,peak:proof.peak,difficulty:{baseline,measured,delta}};
      if(matchesDifficulty(difficulty,delta))return result;
      if(!nearest||distance(delta)<distance(nearest.difficulty.delta))nearest=result;
      return null;
    };
    let largestMove=0,mostBoxChanges=0;
    const countBoxChanges=boxes=>boxes.filter((b,i)=>boxId(b)!==boxId(source.boxes[i])).length;
    const minBoxChanges=Math.max(2,Math.ceil(boxSwaps*1.5));
    for (let attempt = 0; attempt < budget.layouts; attempt++) {
      await nextFrame();
      if (stopped()) return {cancelled:true};
      if(attempt>=3&&performance.now()>=layoutDeadline){expired=true;break;}
      report('layout',attempt+1,budget.layouts);
      const boxes = changeBoxes ? reorderBoxes(source.boxes,boxSwaps,random) : source.boxes;
      const boxPositions=countBoxChanges(boxes);
      mostBoxChanges=Math.max(mostBoxChanges,boxPositions);
      if (changeBoxes && queue(boxes) === originalQueue) continue;
      if(changeBoxes&&boxPositions<minBoxChanges)continue;
      const laterAttempt=changePositions&&attempt>=4;
      const guided=changePositions&&attempt%3===1;
      const moved=changePositions?moveLayout(source,profile,rules,random,guided):{items:source.items,positions:0,clusters:0,draped:0};
      largestMove=Math.max(largestMove,moved.positions);
      if(moved.positions<minimumPositions)continue;
      const movedOrder=sorted(moved.items);
      const indexed=new Map(movedOrder.map(it=>[it.uid,it]));
      const movedSections=guided?layerSections(movedOrder,rules.protectedLayers):null;
      const pairs=initialPairs.map(([a,b])=>[indexed.get(a),indexed.get(b)])
        .filter(([a,b])=>a.layer<b.layer&&(!movedSections||movedSections.get(a.uid)===movedSections.get(b.uid))
          &&(!changePositions||overlap(a,b,rules.extents)>=.12));
      const layerSwaps=Math.max(1,Math.ceil(pairs.length*profile.layers*(laterAttempt?.65:1)));
      const items = varyLayers ? reorderItems(movedOrder,pairs,layerSwaps,random) : movedOrder;
      const layerIndex = new Map(sorted(items).map((it,i) => [it.uid,i]));
      const inverted=pairs.filter(([a,b])=>layerIndex.get(a.uid)>layerIndex.get(b.uid));
      if(varyLayers&&!inverted.length)continue;
      const doc = {...source,items,boxes};
      const key = signature(doc);
      if (tried.has(key)) continue;
      tried.add(key);
      if (varyLayers||changePositions) doc.sourceGeometry=reorderSourceGeometry(source,items,polygonSamples);
      const board=new Playtest(doc,masks);
      const changed=inverted.filter(([a,b])=>board.coverData(layerIndex.get(b.uid)).covers
        .some(c=>c.j===layerIndex.get(a.uid)));
      const layerPairs=changed.length,layerItems=new Set(changed.flat().map(it=>it.uid)).size;
      const minLayerItems=Math.min(initialPairs.length+1,Math.max(2,Math.ceil(order.length*profile.layers*.4)));
      if(varyLayers&&(layerPairs<Math.max(1,Math.floor(layerSwaps*.5))||layerItems<minLayerItems))continue;
      const stats={positions:moved.positions,clusters:moved.clusters,draped:moved.draped,
        pinned:(rules?.protectedLayers.size??0)-moved.draped,boxPositions,layerPairs,layerItems};
      const entry = {doc,stats,board};
      const slotItems=new Map(movedOrder.map(it=>[originalSlots.get(`${it.x},${it.y},${it.layer}`),it.uid]));
      let path=originalRoute?.map(i=>layerIndex.get(order[i].uid));
      let proof=tryRoute(board,masks,path);
      if(proof){
        const result=finish(entry,path,proof);
        if(result)return result;
      }
      const slotPath=guided&&originalRoute&&slotItems.size===order.length&&!slotItems.has(undefined)
        ?originalRoute.map(i=>layerIndex.get(slotItems.get(i))):null;
      if(slotPath){
        proof=tryRoute(board,masks,slotPath);
        if(proof){
          const result=finish(entry,slotPath,proof);
          if(result)return result;
        }
      }
      if(changeBoxes&&slotPath){
        const safe=reorderWithProof(board,masks,source.boxes,slotPath,minBoxChanges,random);
        if(safe&&queue(safe)!==originalQueue){
          const revised={...doc,boxes:safe},safeKey=signature(revised);
          if(!tried.has(safeKey)){
            tried.add(safeKey);
            const proof=TidyGenerator.verifyRoute(revised,masks,safe,slotPath,board.cache);
            if(proof){
              const candidate=new Playtest(revised,masks);
              candidate.cache=board.cache;
              const result=finish({doc:revised,board:candidate,stats:{...stats,boxPositions:countBoxChanges(safe)}},slotPath,proof);
              if(result)return result;
            }
          }
        }
      }
      if(changePositions&&changeBoxes){
        const variants=[[boxes,.2,null],[source.boxes,.75,null]];
        if(guided&&slotPath)variants.push([source.boxes,.4,slotPath]);
        for(const [preferred,bias,priorities] of variants){
          const adapted=adaptQueue(doc,masks,preferred,board.cache,random,bias,priorities);
          if(!adapted||queue(adapted.doc.boxes)===originalQueue)continue;
          const adaptedKey=signature(adapted.doc);
          if(adaptedKey!==key&&tried.has(adaptedKey))continue;
          const boxPositions=countBoxChanges(adapted.doc.boxes);
          if(boxPositions<minBoxChanges)continue;
          const proof=TidyGenerator.verifyRoute(adapted.doc,masks,adapted.doc.boxes,adapted.path,board.cache);
          if(proof){
            tried.add(adaptedKey);
            const adaptedBoard=new Playtest(adapted.doc,masks);
            adaptedBoard.cache=board.cache;
            const result=finish({doc:adapted.doc,board:adaptedBoard,stats:{...stats,boxPositions}},adapted.path,proof);
            if(result)return result;
          }
        }
      }
      const bot = TidyBot.fromPlaytest(board);
      const policy = attempt % 3 === 2 ? 'branch' : attempt % 3 === 1 ? 'chain' : 'visible';
      const run = bot.run({policy,seed:41+attempt});
      path = run.path;
      proof = run.won && tryRoute(board,masks,path);
      if(proof){
        const result=finish({...entry,bot},path,proof);
        if(result)return result;
      }else{
        promising.push({...entry,bot,run});
        promising.sort((a,b)=>b.run.picked-a.run.picked||a.run.peak-b.run.peak);
        if(promising.length>budget.finalists)promising.pop();
      }
    }
    for (const [i,entry] of promising.entries()) {
      report('route',i+1,promising.length);
      await nextFrame();
      if (stopped()) return {cancelled:true};
      const targets=promising.length-i;
      const passDeadline=performance.now()+Math.max(0,deadline-performance.now())/targets;
      const {bot,run}=entry,attempts=[];
      if(budget.finalists>1&&!run.won&&run.picked>order.length*.65){
        const prefix=run.path.slice(0,-Math.max(12,Math.ceil(run.picked*.12)));
        if(prefix.length){
          const first=prefix.reduce((state,i)=>bot.tap(state,i),bot.initial);
          attempts.push({first,prefix,until:(performance.now()+passDeadline)/2});
        }
      }
      attempts.push({until:passDeadline});
      for(const {first,prefix,until} of attempts){
        const search=bot.searchRoute({first,prefix,width:budget.width,fanOut:budget.fanOut,trayCost:difficulty==='harder'?1.8:2.5});
        let step=search.next(),yieldAt=performance.now()+30;
        while(!step.done){
          const now=performance.now();
          if(now>=until){expired=true;break;}
          if(now>=yieldAt){
            report('route',i+1,promising.length);
            await nextFrame();
            if(stopped())return {cancelled:true};
            yieldAt=performance.now()+30;
          }
          step=search.next();
        }
        const path=step.done?step.value?.path:null;
        const proof=tryRoute(entry.board,masks,path);
        if(proof){
          const result=finish(entry,path,proof);
          if(result)return result;
          break;
        }
      }
    }
    if(!nearest&&changeBoxes&&changePositions&&promising.length){
      report('repack',1,1);
      await nextFrame();
      if(stopped())return {cancelled:true};
      const entry=promising[0];
      try{
        const maxBox=Math.max(...source.boxes.map(box=>box.count));
        const solved=await TidyGenerator.boxesFromLayout(entry.doc,masks,{maxBox,random});
        if(stopped())return {cancelled:true};
        const doc={...entry.doc,boxes:solved.boxes};
        if(!tried.has(signature(doc))){
          Offline.validate(doc,true);
          Offline.attachProof(doc,solved.order);
          const board=new Playtest(doc,masks);
          board.cache=entry.board.cache;
          const measured=measureDifficulty(TidyBot.fromPlaytest(board));
          const delta=Math.round((measured.score-baseline.score)*10)/10;
          return {
            fallback:{doc,...entry.stats,repacked:true,
              peak:solved.peak,difficulty:{baseline,measured,delta}},
            reason:`Chưa tìm được đường thắng khi giữ số chỗ từng hộp. Có bản chia lại hộp đã kiểm đường thắng (${source.boxes.length} → ${solved.boxes.length} hộp).`,
          };
        }
      }catch{
        // The layout can be legal yet have no replay with the available hit points.
      }
    }
    if(nearest){
      const {delta}=nearest.difficulty;
      return {fallback:nearest,reason:`Có bản chơi thắng, nhưng chưa đạt độ khó đã chọn. Điểm gốc ${baseline.score}/100, bản gần nhất chênh ${delta>0?'+':''}${delta} điểm.`};
    }
    if(promising.length)return {reason:expired?'Hết thời gian tìm. Chưa xác minh được đường thắng ở mức thay đổi đã chọn.':'Chưa xác minh được đường thắng ở mức thay đổi đã chọn.'};
    if(largestMove<minimumPositions)
      return {reason:`Chỉ hoán đổi được ${largestMove}/${minimumPositions} món gần cỡ nhau. Thử mức xáo trộn thấp hơn.`};
    if(changeBoxes&&mostBoxChanges<minBoxChanges)
      return {reason:'Hàng đợi hộp chưa đủ đa dạng để xáo trộn ở mức này.'};
    return {reason:'Chưa có phương án mới đạt mức thay đổi đã chọn.'};
  }
  return {make,signature};
})();
