const TidyGenerator = (() => {
  const {Playtest, fitsBackground, ROUND, check} = TidyGame;
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

  async function prepareBoard(level, masks) {
    const board = new Playtest(level, masks);
    const below = board.items.map(() => []);
    for (let i = 0; i < board.items.length; i++) {
      for (const {j} of board.coverData(i).covers) below[j].push(i);
      if (i % 20 === 19) await nextFrame();
    }
    return {board, below};
  }

  function takeOrder(board, below, maxBox, random, variant) {
    board.room = new Set(board.items.map((_, i) => i));
    const available = new Set([...board.room].filter(i => !board.covered(i)));
    const remaining = new Map();
    for (const {group} of board.items) remaining.set(group, (remaining.get(group) ?? 0) + 1);
    const order = [];
    let last, run = 0;
    while (board.room.size) {
      let best = -1;
      let high = -Infinity;
      for (const i of available) {
        const {group} = board.items[i];
        const same = group === last && run < maxBox ? (variant ? 8 : 18) : 0;
        const sameBelow = below[i].filter(j => board.room.has(j) && board.items[j].group === group).length;
        const value = same + Math.min(9, remaining.get(group)) * .38 + 1.6 * sameBelow
          + (variant === 2 ? i / board.items.length * 4 : 0) + random() * (variant ? 4 : 1);
        if (value > high) { high = value; best = i; }
      }
      if (best < 0) throw Error('Bố cục còn đồ không thể lấy theo luật lớp hiện tại.');
      const {group} = board.items[best];
      run = last === group ? run + 1 : 1;
      last = group;
      remaining.set(group, remaining.get(group) - 1);
      order.push(best);
      available.delete(best);
      board.room.delete(best);
      for (const j of below[best]) {
        if (board.room.has(j) && !board.covered(j)) available.add(j);
      }
    }
    return order;
  }

  function packBoxes(order, items, definitions, maxBox, activeLimit, sizes, random) {
    const next = new Map();
    const nextSame = [];
    for (let i = order.length - 1; i >= 0; i--) {
      const {group} = items[order[i]];
      nextSame[i] = next.get(group) ?? Infinity;
      next.set(group, i);
    }
    next.clear();
    const open = new Map(), limits = new Map(), boxes = [];
    for (const [i, uid] of order.entries()) {
      const {group} = items[uid];
      if (!open.has(group)) {
        if (open.size === activeLimit) {
          const closing = [...open.keys()].sort((a, b) => {
            const x = next.get(a), y = next.get(b);
            return x === y ? open.get(b).count - open.get(a).count : (x > y ? -1 : 1);
          })[0];
          open.delete(closing);
        }
        const box = {...definitions.get(group), count:0};
        open.set(group, box);
        limits.set(group,sizes.length?pick(sizes,random):maxBox);
        boxes.push(box);
      }
      const box = open.get(group);
      box.count++;
      next.set(group, nextSame[i]);
      if (box.count === limits.get(group) || nextSame[i] === Infinity) open.delete(group);
    }
    return boxes;
  }

  function verifyRoute(level, masks, boxes, order, coverCache) {
    const game = new Playtest({...level, boxes}, masks);
    game.cache = coverCache;
    const points = [];
    let waits=0;
    for (const i of order) {
      const point = game.pointFor(i);
      if (!point) return null;
      const result = game.tapAt(...point);
      if (result.j !== i || (result.kind !== 'box' && result.kind !== 'tray') || game.state === 'lose') return null;
      if(result.kind==='tray')waits++;
      points.push(point);
    }
    return game.state === 'win' ? {points, peak:game.peak, waits} : null;
  }

  const boxTiers=['easy','medium','hard'];
  const peakTier=peak=>peak<2?0:peak<4?1:2;
  function compareDifficulty(a,b,target){
    const distance=entry=>Math.abs(peakTier(entry.peak)-target);
    return distance(a)-distance(b) || (target===0?a.peak-b.peak:b.peak-a.peak) ||
      (target===0?a.waits-b.waits:b.waits-a.waits) || a.score-b.score;
  }

  async function findBoxDifficulty(level,masks,board,candidates,target,random){
    const proposals=new Map();
    const queueKey=boxes=>JSON.stringify(boxes.map(({group,count})=>[group,count]));
    for(const seed of candidates.slice(0,8)){
      const {boxes}=seed;
      proposals.set(queueKey(boxes),seed);
      if(target===0||boxes.length<3)continue;
      for(const cut of target===1?[2,3]:[3,4,5]){
        if(cut+1>=boxes.length)continue;
        const delayed=[...boxes.slice(cut,cut+2),...boxes.slice(0,cut),...boxes.slice(cut+2)];
        proposals.set(queueKey(delayed),{...seed,boxes:delayed});
      }
      for(let attempt=0;attempt<8;attempt++){
        const shuffled=[...boxes],from=Math.floor(random()*shuffled.length);
        const [moved]=shuffled.splice(from,1);
        const step=1+Math.floor(random()*(target===1?3:7));
        const to=Math.max(0,Math.min(shuffled.length,from+(random()<.5?-step:step)));
        if(from===to)continue;
        shuffled.splice(to,0,moved);
        proposals.set(queueKey(shuffled),{...seed,boxes:shuffled});
      }
    }
    // Rank queues with a few legal move orders before verifying actual click positions.
    const proven=[];
    const orders=[...new Set(candidates.map(entry=>entry.order))];
    for(const [index,entry] of [...proposals.values()].entries()){
      const trial=new Playtest({...level,boxes:entry.boxes},masks);
      trial.cache=board.cache;
      const bot=TidyBot.fromPlaytest(trial);
      const routes=[entry.order,...orders.filter(order=>order!==entry.order).slice(0,2)];
      for(const policy of ['visible','branch']){
        const sample=bot.run({policy,seed:31+index});
        if(sample.won)routes.push(sample.path);
      }
      let best=null;
      for(const order of routes){
        const walk=new Playtest({...level,boxes:entry.boxes},masks);
        walk.cache=board.cache;
        let waits=0;
        for(const uid of order){
          const {kind}=walk.tap(uid);
          if(kind==='tray')waits++;
          if(walk.state!=='playing'||(kind!=='box'&&kind!=='tray'))break;
        }
        if(walk.state==='win'&&(!best||walk.peak<best.peak||(walk.peak===best.peak&&waits<best.waits)))
          best={order,peak:walk.peak,waits};
      }
      if(best)proven.push({...entry,...best});
      if(index%4===3)await nextFrame();
    }
    proven.sort((a,b)=>compareDifficulty(a,b,target));
    for(const entry of proven){
      const proof=verifyRoute(level,masks,entry.boxes,entry.order,board.cache);
      if(proof)return {...entry,...proof,difficulty:boxTiers[peakTier(proof.peak)]};
    }
    // Fall back to the original proven route when a sampled route has no clickable point.
    for(const entry of candidates){
      const proof=verifyRoute(level,masks,entry.boxes,entry.order,board.cache);
      if(proof)return {...entry,...proof,difficulty:boxTiers[peakTier(proof.peak)]};
    }
    return null;
  }

  async function boxesFromLayout(level, masks, {maxBox = 5, label, neatopia = false, difficulty, random = Math.random} = {}) {
    if (!level.items.length) throw Error('Đặt ít nhất một món đồ trước khi sinh hộp.');
    const definitions = new Map();
    const labels = new Map(level.boxes.map(box => [box.group, box.label]));
    for (const {group, targetType = group} of level.items) {
      if (definitions.has(group) && definitions.get(group).targetType !== targetType)
        throw Error('Một nhóm đồ đang có nhiều mã Unity. Sửa nhóm nhận trước khi sinh hộp.');
      if (!definitions.has(group)) definitions.set(group, {group, targetType, label:labels.get(group) || label?.(group) || `Nhóm ${group}`});
    }
    const {board, below} = await prepareBoard(level, masks);
    const candidates = [];
    const sizes=neatopia?[3,3,3,3,4,4,4,4,5,5,6,7].filter(size=>size<=maxBox):[];
    for (let variant = 0; variant < 6; variant++) {
      const order = takeOrder(board, below, maxBox, random, variant % 3);
      for (const activeLimit of [2, 1]) {
        const boxes = packBoxes(order, board.items, definitions, maxBox, activeLimit, variant===5?[]:sizes, random);
        const small = boxes.filter(box => box.count < Math.min(3, maxBox)).length;
        const preferred = sizes.length ? boxes.filter(box=>box.count===3||box.count===4).length : 0;
        candidates.push({boxes, order, small, score:boxes.length + small * (sizes.length?1.3:.4) - preferred * .55});
      }
      if (variant % 2 === 1) await nextFrame();
    }
    candidates.sort((a, b) => a.score - b.score);
    if(boxTiers.includes(difficulty)){
      const result=await findBoxDifficulty(level,masks,board,candidates,boxTiers.indexOf(difficulty),random);
      if(result)return result;
    }
    for (const {boxes, order, small} of candidates) {
      if (!check({...level, boxes}).ok) continue;
      const proof = verifyRoute(level, masks, boxes, order, board.cache);
      if (proof) return {boxes, small, order, ...proof,difficulty:boxTiers[peakTier(proof.peak)]};
    }
    throw Error('Chưa tìm được hàng đợi có đường thắng cho bố cục này.');
  }

  const toWorld = ([u, v], bg) => [(u - .5) * bg.width, (.5 - v) * bg.height];
  function edgeFrame([a,b]){
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    const angle=((Math.atan2(dy,dx)*180/Math.PI+270)%180)-90;
    const radians=angle*Math.PI/180;
    return {a,dx,dy,length,angle,normal:[Math.sin(radians),-Math.cos(radians)]};
  }
  function edgePose(frame,t,height){
    const {a,dx,dy,normal,angle}=frame,drop=height*.16;
    return {point:[a[0]+dx*t+normal[0]*drop,a[1]+dy*t+normal[1]*drop],angle};
  }
  const pick = (values, random) => values[Math.floor(random() * values.length)];
  const bounds = points => ({
    x0:Math.min(...points.map(p => p[0])), y0:Math.min(...points.map(p => p[1])),
    x1:Math.max(...points.map(p => p[0])), y1:Math.max(...points.map(p => p[1])),
  });
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const turn = (a, b, q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  const crossing = (a, b, c, d) => turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;

  function onSegment(a,b,p) {
    return Math.abs(turn(a,b,p)) < 1e-9 && p.every((value,i)=>value>=Math.min(a[i],b[i])&&value<=Math.max(a[i],b[i]));
  }

  function polygonValid(points) {
    if (points.length < 3 || new Set(points.map(String)).size !== points.length) return false;
    const pairs = points.map((p, i) => [p, points[(i + 1) % points.length]]);
    const area = pairs.reduce((total, [a, b]) => total + a[0] * b[1] - b[0] * a[1], 0);
    return Math.abs(area) > .00015 && !pairs.some(([a, b], i) =>
      pairs.some(([c, d], j) => j > i+1 && !(i===0 && j===pairs.length-1) &&
        (crossing(a,b,c,d) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b))));
  }

  function inside([x, y], points) {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a,b] = points[i], [c,d] = points[j];
      if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) result = !result;
    }
    return result;
  }

  function rectFor(item) {
    const angle = item.angle * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const w=Math.abs(item.width*item.scaleX),h=Math.abs(item.height*item.scaleY);
    const halfX = (c*w+s*h)/2, halfY = (s*w+c*h)/2;
    return {x0:item.x-halfX, x1:item.x+halfX, y0:item.y-halfY, y1:item.y+halfY};
  }

  function fitsZone(rect, zone) {
    const corners = [[rect.x0,rect.y0], [rect.x1,rect.y0], [rect.x1,rect.y1], [rect.x0,rect.y1]];
    if (!corners.every(p => inside(p, zone.points))) return false;
    return !zone.points.some((p, i) => {
      const q = zone.points[(i + 1) % zone.points.length];
      return (p[0] > rect.x0 && p[0] < rect.x1 && p[1] > rect.y0 && p[1] < rect.y1)
        || corners.some((a, j) => crossing(a, corners[(j + 1) % 4], p, q));
    });
  }

  function scatter(background, template, pieces, {count, layers, angleRange = 0, stackBias = .75, random = Math.random}) {
    const zones = template.zones.map(zone => {
      const points = zone.points.map(point => toWorld(point, background));
      return {points, ...bounds(points), placed:[]};
    });
    if (!zones.length && count > template.edges.length)
      throw Error('Khoanh ít nhất một vùng đặt để rải các món ngoài mép vắt.');
    const byGroup = new Map();
    const spriteById = new Map();
    for (const piece of pieces) {
      if (!byGroup.has(piece.group)) byGroup.set(piece.group, []);
      byGroup.get(piece.group).push(piece);
      spriteById.set(piece.asset, piece);
    }
    const marked = new Set(template.edges.map(edge => edge.asset));
    const groups = [...byGroup.keys()];
    if (!groups.length || groups.length > count) throw Error('Số món phải đủ cho tất cả nhóm đã chọn.');
    const assets = new Map(groups.map(id => [id, byGroup.get(id).filter(piece => !marked.has(piece.asset))]));
    const placements = [];
    const commit = (piece, point, angle, used, zone) => {
      const item = {...piece, uid:`auto-${placements.length+1}`, layer:placements.length,
        x:ROUND(point[0]), y:ROUND(point[1]), angle:ROUND(angle), scaleX:1, scaleY:1};
      const rect = rectFor(item);
      if (!fitsBackground(background, item) || used.some(other => overlap(rect, other))
        || (zone && !fitsZone(rect, zone))) return false;
      used.push(rect);
      placements.push(item);
      zone?.placed.push(point);
      return true;
    };
    const usedGroups = new Set();
    const requestedLayerCount = Math.min(layers, count);
    for (let layer = 0; layer < requestedLayerCount; layer++) {
      const used = [];
      const until = Math.ceil((layer + 1) * count / requestedLayerCount);
      if (layer === 0) for (const edge of template.edges) {
        const piece = spriteById.get(edge.asset);
        if (!piece) throw Error('Một mép vắt thiếu sprite. Chọn lại sprite cho mép đó.');
        const frame=edgeFrame(edge.points.map(point=>toWorld(point,background)));
        const placed = [.5,.28,.72,.1,.9].some(t => {
          const {point,angle}=edgePose(frame,t,piece.height);
          return commit(piece, point, angle, used);
        });
        if (!placed) throw Error('Không đặt vừa sprite trên một mép vắt. Thử dời mép ra xa viền nền hoặc mép khác.');
        usedGroups.add(piece.group);
      }
      if (groups.length-usedGroups.size > count-placements.length)
        throw Error('Tăng số món để rải đủ các nhóm và giữ một món cho mỗi mép vắt.');
      while (placements.length < until) {
        const missing = groups.filter(id => !usedGroups.has(id));
        const candidates = missing.length ? missing : groups.filter(id => assets.get(id).length);
        if (!candidates.length) throw Error('Chọn thêm một nhóm có sprite để rải trong vùng đặt.');
        let ok = false;
        for (let tries = 0; tries < 165 && !ok; tries++) {
          const id = pick(candidates, random);
          const group = assets.get(id);
          if (!group.length) throw Error('Có nhóm thiếu sprite để rải trong vùng đặt.');
          const piece = pick(group, random);
          const zone = pick(zones, random);
          const w = zone.x1-zone.x0-piece.width, h = zone.y1-zone.y0-piece.height;
          if (w <= 0 || h <= 0) continue;
          const nearer = layer > 0 && zone.placed.length && tries < 110 && random() < stackBias;
          let point = [zone.x0+piece.width/2+w*random(), zone.y0+piece.height/2+h*random()];
          if (nearer) {
            const [x,y] = pick(zone.placed, random);
            point = [x+(random()-.5)*piece.width*.8, y+(random()-.5)*piece.height*.8];
          }
          ok = commit(piece, point, (random()*2-1)*angleRange, used, zone);
          if (ok) usedGroups.add(id);
        }
        if (!ok) throw Error(`Chỉ rải vừa ${placements.length}/${count} món. Thử mở rộng vùng, thêm lớp hoặc giảm số món.`);
      }
    }
    return placements;
  }

  const drapeSprite = /\/(?:1-(?:4|11|15|19|20)|12-(?:1|4)|74-[1-8]|107-6|611-1)\.png$/i;
  const footprint = item => Math.sqrt(Math.abs(item.width*item.height*item.scaleX*item.scaleY));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

  function contactOffset(item,mask) {
    if(!mask)return {x:0,y:rectFor({...item,x:0,y:0}).y0};
    const a=item.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const w=item.width*item.scaleX,h=item.height*item.scaleY;
    const points=[];
    let bottom=Infinity;
    for(let v=0;v<mask.maskH;v++)for(let u=0;u<mask.maskW;u++){
      if(!mask.alpha[v*mask.maskW+u])continue;
      const x=((u+.5)/mask.maskW-.5)*w,y=(.5-(v+.5)/mask.maskH)*h;
      const px=x*c-y*s,py=x*s+y*c;
      points.push([px,py]);bottom=Math.min(bottom,py);
    }
    if(!points.length)return {x:0,y:rectFor({...item,x:0,y:0}).y0};
    const base=points.filter(([,y])=>y<=bottom+Math.abs(h)*.08);
    return {x:base.reduce((total,[x])=>total+x,0)/base.length,y:bottom};
  }

  function learnLayout(source, background, rails, exclusions=[], {masks=new Map(),zones=[]}={}) {
    if(source.background.asset!==background.asset)throw Error('Bố cục mẫu phải dùng đúng ảnh nền này.');
    const sx=background.width/source.background.width,sy=background.height/source.background.height;
    const samples=TidyGame.sorted(source.items).map(it=>({...it,x:it.x*sx,y:it.y*sy,width:it.width*sx,height:it.height*sy}));
    const flat=samples.filter(it=>!drapeSprite.test(it.asset));
    const widths=flat.map(footprint).sort((a,b)=>a-b);
    const typical=widths[Math.floor(widths.length/2)]||Math.min(background.width,background.height)/12;
    const threshold=Math.max(.15*typical,Math.min(background.width,background.height)*.006);
    const grounded=new Map();
    const entries=flat.map((item,i)=>{
      const offset=contactOffset(item,masks.get(item.asset));
      let base={x:item.x+offset.x,y:item.y+offset.y};
      // A foot over the upper part of another sprite may be supported by that sprite.
      // Reuse the lower sprite's ground contact if the generated layout removes it.
      const lower=flat.slice(0,i).filter(other=>masks.has(other.asset)&&base.y>other.y);
      const beneath=TidyGame.itemAt(lower,base.x,base.y,masks);
      if(beneath)base=grounded.get(beneath);
      grounded.set(item,base);
      return {item,base};
    });
    const supports=entries.map(entry=>({...entry,near:entries.filter(other=>{
      const dx=Math.abs(entry.base.x-other.base.x),dy=Math.abs(entry.base.y-other.base.y);
      // A short, shallow span can be the same surface. A vertical jump may be a different shelf.
      return dx>threshold*.35&&dy<dx*.69+typical*.05&&distance(entry.base,other.base)<typical*1.04;
    })}));
    const edges=rails.filter(([index])=>samples[index]).map(([i,points,score])=>({item:samples[i],score,
      points:points.map(([x,y])=>[x*sx,y*sy])}));
    const original=samples.concat(exclusions.flatMap(doc=>doc.items.map(it=>({
      x:it.x*background.width/doc.background.width,y:it.y*background.height/doc.background.height}))));
    return {supports,edges,original,typical,threshold,masks,
      zones:zones.map(zone=>({points:zone.points.map(p=>toWorld(p,background))}))};
  }

  function synthesize(background, model, {count,layers,groups,neatopia,drape,random=Math.random}) {
    const {supports,edges,original,typical,threshold,masks,zones}=model;
    const pool=new Map();
    for(const entry of supports){
      const group=entry.item.group;
      if(!pool.has(group))pool.set(group,[]);
      pool.get(group).push(entry);
    }
    const rails=drape?edges.filter(edge=>!groups.size||groups.has(edge.item.group)):[];
    const groupCapacity=new Map();
    for(const [group,entries] of pool){
      const contacts=new Set(entries.map(({base})=>`${Math.round(base.x/typical*2)},${Math.round(base.y/typical*2)}`));
      const size=Math.min(...entries.map(entry=>footprint(entry.item)));
      groupCapacity.set(group,Math.sqrt(contacts.size)*Math.min(2,typical/size));
    }
    const ranked=Array.from(pool.keys(),group=>[group,random()**(1/groupCapacity.get(group))]);
    ranked.sort((a,b)=>b[1]-a[1]);
    const groupCount=Math.min(count,Math.max(1,Math.round(count/(neatopia?7.5:6))));
    const order=groups.size?[...groups]:ranked.slice(0,groupCount).map(([group])=>group);
    const placements=[],boundsByLayer=Array.from({length:Math.min(count,layers)},()=>[]);
    const farEnough=(item,min)=>!original.some(ref=>Math.abs(item.x-ref.x)<min&&Math.abs(item.y-ref.y)<min&&distance(item,ref)<min);
    const commit=(item,layer,min)=>{
      const box=rectFor(item);
      if(!fitsBackground(background,item)||!farEnough(item,min))return false;
      if(layer===null&&zones.length&&!zones.some(zone=>fitsZone(box,zone)))return false;
      if(placements.some(other=>distance(item,other)<.15*typical))return false;
      if(layer===null){
        let best=-1;
        for(let i=0;i<boundsByLayer.length;i++){
          const occupied=boundsByLayer[i];
          if(best>=0&&occupied.length>=boundsByLayer[best].length)continue;
          if(!occupied.some(other=>overlap(box,other)))best=i;
        }
        if(best<0)return false;
        layer=best;
      }else if(boundsByLayer[layer].some(other=>overlap(box,other)))return false;
      boundsByLayer[layer].push(box);
      placements.push({...item,layer});
      return true;
    };

    const desiredDrapes=rails.length?Math.min(rails.length,Math.max(1,Math.round(count*.035))):0;
    const orderedRails=rails.map(rail=>({rail,priority:rail.score*(.65+random()*.7)})).sort((a,b)=>b.priority-a.priority);
    for(const {rail} of orderedRails){
      if(placements.length>=desiredDrapes||placements.length>=count-groups.size+1)break;
      const group=rail.item.group;
      if(!groups.size&&order.length&&!order.includes(group)&&count<8)continue;
      const [[ax,ay],[bx,by]]=rail.points;
      const placed=Array.from({length:10},()=>random()).some(t=>commit({...rail.item,x:ROUND(ax+(bx-ax)*t),y:ROUND(ay+(by-ay)*t)},0,threshold));
      if(placed&&!order.includes(group)){
        if(order.length<groupCount)order.push(group);
        else order[order.length-1]=group;
      }
    }
    const missing=order.filter(group=>!placements.some(it=>it.group===group));
    if(!order.length||missing.some(group=>!pool.has(group)))throw Error('Bố cục cùng nền thiếu vị trí phù hợp cho một nhóm đã chọn. Dùng vùng đặt hoặc đánh dấu mép vắt cho nhóm đó.');
    const repeat=order.filter(group=>pool.has(group));
    const quota=[...missing];
    const demand=new Map(order.map(group=>[group,placements.filter(it=>it.group===group).length+Number(missing.includes(group))]));
    while(quota.length+placements.length<count){
      if(!repeat.length)throw Error('Cần thêm nhóm có đồ đặt trên mặt phẳng.');
      const load=group=>demand.get(group)/Math.sqrt(groupCapacity.get(group));
      const low=Math.min(...repeat.map(load));
      const group=pick(repeat.filter(group=>load(group)<=low+1.5),random);
      const size=neatopia?pick([3,3,4,4,5,6,7],random):pick([2,3,4,5],random);
      for(let i=0;i<size&&quota.length+placements.length<count;i++){
        quota.push(group);demand.set(group,demand.get(group)+1);
      }
    }
    for(let i=quota.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[quota[i],quota[j]]=[quota[j],quota[i]];}
    const groupSize=new Map(repeat.map(group=>[group,Math.min(...pool.get(group).map(entry=>footprint(entry.item)))]));
    const contactCache=new Map();
    quota.sort((a,b)=>groupSize.get(b)-groupSize.get(a));
    const nearbyByGroup=new Map();
    const eligible=groups.size?repeat:ranked.map(([group])=>group);
    for(const group of eligible){
      const known=pool.get(group);
      nearbyByGroup.set(group,supports.filter(entry=>known.some(sample=>
        Math.abs(entry.base.y-sample.base.y)<=typical*.45&&distance(entry.base,sample.base)<=typical)));
    }
    const exhausted=new Set();
    function placeGroup(group){
      const local=pool.get(group);
      const nearby=nearbyByGroup.get(group);
      let placed=false;
      for(let attempt=0;attempt<320&&!placed;attempt++){
        const chosen=pick(local,random).item;
        const {item:anchor,base,near}=pick(attempt%3===0?nearby:local,random);
        const itemSize=footprint(chosen),anchorSize=footprint(anchor);
        if(itemSize>Math.max(anchorSize*1.35,typical*.85))continue;
        const neighbor=near.length?pick(near,random).base:null;
        const t=random();
        const slide=neighbor?0:(t-.5)*Math.min(anchorSize*.44,typical*.40);
        const groundX=base.x+(neighbor?(neighbor.x-base.x)*t:slide);
        const groundY=base.y+(neighbor?(neighbor.y-base.y)*t:0);
        const angle=chosen.angle+pick([-4,0,4],random);
        const key=`${chosen.uid}:${angle}`;
        if(!contactCache.has(key))contactCache.set(key,contactOffset({...chosen,angle},masks.get(chosen.asset)));
        const offset=contactCache.get(key),zoom=.95+random()*.10;
        placed=commit({...chosen,x:ROUND(groundX-offset.x*zoom),y:ROUND(groundY-offset.y*zoom),angle:ROUND(angle),
          scaleX:ROUND(chosen.scaleX*zoom),scaleY:ROUND(chosen.scaleY*zoom)},null,threshold);
      }
      if(!placed)exhausted.add(group);
      return placed;
    }
    for(const group of quota){
      if(!exhausted.has(group)&&placeGroup(group))continue;
      const required=groups.has(group)&&!placements.some(it=>it.group===group);
      if(!required&&eligible.some(other=>!exhausted.has(other)&&placeGroup(other)))continue;
      throw Error(`Chỉ tìm được ${placements.length}/${count} chỗ mới. Giảm số món, tăng số lớp hoặc đánh dấu thêm vùng đặt.`);
    }
    return {items:placements.sort((a,b)=>a.layer-b.layer).map((it,i)=>({...it,uid:`auto-${i+1}`,layer:i})),
      draped:placements.length-quota.length,threshold};
  }

  return {boxesFromLayout, polygonValid, scatter, learnLayout, synthesize, toWorld, edgeFrame, edgePose, verifyRoute};
})();
