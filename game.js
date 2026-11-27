const TidyGame = (() => {
const sorted = items => [...items].sort((a,b)=>a.layer-b.layer);
const ROUND = n=>Math.round(n*1000)/1000;
const layoutKey = items => JSON.stringify(sorted(items).map(i=>[
  i.asset,i.x,i.y,i.width,i.height,i.scaleX,i.scaleY,i.angle,
]));
const sourceGeometry = level => level.sourceGeometry?.layout === layoutKey(level.items) ? level.sourceGeometry.items : null;

function geometry(item, mask){
  const a=item.angle*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  const halfW=Math.abs(item.width*item.scaleX)/2, halfH=Math.abs(item.height*item.scaleY)/2;
  return {item,mask,c,s,hx:Math.abs(c)*halfW+Math.abs(s)*halfH,hy:Math.abs(s)*halfW+Math.abs(c)*halfH};
}

function fitsBackground(background, item){
  const {hx,hy}=geometry(item);
  const epsilon=1e-7;
  return Math.abs(item.x)+hx<=background.width/2+epsilon &&
    Math.abs(item.y)+hy<=background.height/2+epsilon;
}
function itemBounds(item){
  const {hx,hy}=geometry(item);
  return {left:item.x-hx,right:item.x+hx,bottom:item.y-hy,top:item.y+hy};
}
function hit(g,x,y){
  const {item:i,mask:m,c,s}=g,dx=x-i.x,dy=y-i.y;
  const u=(dx*c+dy*s)/(i.scaleX*i.width)+.5, v=.5-(-dx*s+dy*c)/(i.scaleY*i.height);
  if(u<0||u>=1||v<0||v>=1)return false;
  return !m||!!m.alpha[Math.floor(v*m.maskH)*m.maskW+Math.floor(u*m.maskW)];
}

function hitSource(g,points,x,y){
  const dx=x-g.item.x, dy=y-g.item.y;
  const px=(dx*g.c+dy*g.s)/g.item.scaleX, py=(-dx*g.s+dy*g.c)/g.item.scaleY;
  return pointInPolygon(points,px,py);
}
function pointInPolygon(points,px,py){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [a,b]=points[i], [c,d]=points[j];
    if((b>py)!==(d>py)&&px<(c-a)*(py-b)/(d-b)+a)inside=!inside;
  }
  return inside;
}
function worldSource(g,point){
  const x=point[0]*g.item.scaleX,y=point[1]*g.item.scaleY;
  return [g.item.x+x*g.c-y*g.s,g.item.y+x*g.s+y*g.c];
}
function limits(points){
  const x=points.map(p=>p[0]),y=points.map(p=>p[1]);
  return [Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)];
}
function bitCount(value){
  let count=0;
  while(value){value&=value-1;count++;}
  return count;
}
function samplePolygon(poly,polygonSamples){
  if(!polygonSamples.has(poly)){
    const [left,bottom,right,top]=limits(poly),points=[];
    const density=48;
    for(let y=0;y<density;y++)for(let x=0;x<density;x++){
      const px=left+(right-left)*(x+.5)/density,py=bottom+(top-bottom)*(y+.5)/density;
      if(pointInPolygon(poly,px,py))points.push([px,py]);
    }
    polygonSamples.set(poly,points);
  }
  return polygonSamples.get(poly);
}

// A whole pile can move together without changing its precomputed coverage.
function reorderSourceGeometry(original,items,polygonSamples=new WeakMap()){
  const source=sourceGeometry(original);
  if(!source)return undefined;
  const before=sorted(original.items),oldIndex=new Map(before.map((it,i)=>[it.uid,i]));
  const order=sorted(items),oldIds=order.map(it=>oldIndex.get(it.uid));
  const newIndex=new Map(oldIds.map((id,i)=>[id,i]));
  const shapes=order.map((it,i)=>{
    const poly=source[oldIds[i]].poly,g=geometry(it);
    const old=before[oldIds[i]];
    return {poly,g,rect:limits(poly.map(p=>worldSource(g,p))),dx:it.x-old.x,dy:it.y-old.y};
  });
  const rows=shapes.map(({poly,g,rect,dx,dy},i)=>{
    const above=[];
    for(let j=i+1;j<shapes.length;j++){
      const other=shapes[j].rect;
      if(rect[0]<other[2]&&rect[2]>other[0]&&rect[1]<other[3]&&rect[3]>other[1])above.push(j);
    }
    const reference=source[oldIds[i]].reference;
    const relativeShift=j=>Math.abs(shapes[j].dx-dx)>1e-6||Math.abs(shapes[j].dy-dy)>1e-6;
    if(!above.some(j=>oldIds[j]<oldIds[i]||relativeShift(j))&&
        !reference.covers.some(c=>newIndex.get(c.uid)>i&&relativeShift(newIndex.get(c.uid)))){
      const {samples,covers,pairs}=reference;
      return {poly,reference:{samples,
        covers:covers.filter(c=>newIndex.get(c.uid)>i).map(c=>({...c,uid:newIndex.get(c.uid)})),
        pairs:pairs.filter(p=>newIndex.get(p.a)>i&&newIndex.get(p.b)>i)
          .map(p=>({...p,a:newIndex.get(p.a),b:newIndex.get(p.b)})),
      }};
    }
    const samples=samplePolygon(poly,polygonSamples).map(p=>worldSource(g,p));
    const covers=[];
    for(const uid of above){
      const other=shapes[uid],bits=Array(Math.ceil(samples.length/32)).fill(0);
      const [left,bottom,right,top]=other.rect;
      let hits=0;
      samples.forEach(([x,y],k)=>{
        if(x>=left&&x<=right&&y>=bottom&&y<=top&&hitSource(other.g,other.poly,x,y)){
          bits[k>>>5]=(bits[k>>>5]|1<<(k&31))>>>0;hits++;
        }
      });
      if(hits)covers.push({uid,bits,ratio:hits/samples.length});
    }
    const pairs=[];
    const partial=covers.filter(c=>c.ratio<coverThreshold);
    for(let a=0;a<partial.length;a++)for(let b=a+1;b<partial.length;b++){
      const first=partial[a],second=partial[b];
      if(first.ratio+second.ratio<coverThreshold)continue;
      const ratio=first.bits.reduce((sum,word,k)=>sum+bitCount(word|second.bits[k]),0)/samples.length;
      if(ratio>=coverThreshold)pairs.push({a:first.uid,b:second.uid,ratio});
    }
    return {poly,reference:{samples:samples.length,covers,pairs}};
  });
  return {layout:layoutKey(items),items:rows};
}
function itemAt(items,x,y,masks,visible=()=>true){
  for(let i=items.length-1;i>=0;i--){const it=items[i];if(visible(it)&&hit(geometry(it,masks.get(it.asset)),x,y))return it;}
  return null;
}

const coverThreshold=.045;

function boundsOverlap(a,b){
  return Math.abs(a.item.x-b.item.x)<a.hx+b.hx && Math.abs(a.item.y-b.item.y)<a.hy+b.hy;
}

function opaquePoints(g){
  const {item,mask,c,s}=g;
  const points=[];
  if(!mask)return points;
  for(let y=0;y<mask.maskH;y++)for(let x=0;x<mask.maskW;x++){
    if(!mask.alpha[y*mask.maskW+x])continue;
    const u=((x+.5)/mask.maskW-.5)*item.width*item.scaleX;
    const v=(.5-(y+.5)/mask.maskH)*item.height*item.scaleY;
    points.push([item.x+u*c-v*s,item.y+u*s+v*c]);
  }
  return points;
}

function stackLayers(items,masks){
  const order=sorted(items);
  const shapes=order.map(it=>geometry(it,masks.get(it.asset)));
  const layers=new Map(order.map(it=>[it.uid,{depth:0,above:null,below:null}]));
  const parent=order.map((_,i)=>i);
  const root=i=>{
    while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}
    return i;
  };
  const samples=[];
  const samplesOverlap=(from,other)=>{
    const points=samples[from]??(samples[from]=opaquePoints(shapes[from]));
    let remaining=Math.max(1,Math.ceil(coverThreshold*points.length));
    for(const [x,y] of points)if(hit(other,x,y)&&--remaining===0)return true;
    return false;
  };
  // Draw order breaks ties. Only overlapping silhouettes contribute to depth.
  for(let top=1;top<shapes.length;top++){
    const upper=shapes[top];
    const upperLayer=layers.get(upper.item.uid);
    for(let bottom=0;bottom<top;bottom++){
      const lower=shapes[bottom];
      if(!boundsOverlap(lower,upper)||!(samplesOverlap(bottom,upper)||samplesOverlap(top,lower)))continue;
      const a=root(top),b=root(bottom);
      if(a!==b)parent[a]=b;
      const lowerLayer=layers.get(lower.item.uid);
      upperLayer.depth=Math.max(upperLayer.depth,lowerLayer.depth+1);
      upperLayer.below=lower.item;
      lowerLayer.above??=upper.item;
    }
  }
  order.forEach((item,i)=>{layers.get(item.uid).stack=order[root(i)].uid;});
  return layers;
}

function check(level){
  const rows=new Map(); function row(k){if(!rows.has(k))rows.set(k,{group:k,have:0,want:0});return rows.get(k);}
  for(const it of level.items)row(it.group).have++;
  for(const b of level.boxes)row(b.group).want+=b.count;
  const deltas=[...rows.values()].filter(x=>x.have!==x.want);
  return {ok:level.items.length>0&&!deltas.length,deltas};
}

// Mirrors TidyModel's image collision and box / tray settlement.
class Playtest{
  constructor(level,masks){
    this.level=level;this.items=sorted(level.items);this.geom=this.items.map(i=>geometry(i,masks.get(i.asset)));
    this.source=sourceGeometry(level);
    if(this.geom.some(g=>!g.mask))throw Error('Chưa đủ viền ảnh để playtest.');
    this.room=new Set(this.items.map((_,i)=>i));this.tray=[];this.cache=new Map();this.boxes=[{index:-1,count:0},{index:-1,count:0}];
    this.next=0;this.moves=0;this.peak=0;this.delivered=0;this.state='playing';this.log=[];
    this.boxes.forEach(b=>this.assign(b));
  }
  assign(b){b.index=this.next<this.level.boxes.length?this.next++:-1;b.count=0;}
  order(b){return this.level.boxes[b.index];}
  box(group){let best=-1;this.boxes.forEach((b,i)=>{if(this.order(b)?.group===group&&(best<0||b.count>this.boxes[best].count))best=i});return best;}
  coverData(uid){
    if(this.cache.has(uid))return this.cache.get(uid);
    if(this.source){
      const {samples:all,covers,pairs}=this.source[uid].reference;
      const data={all,covers:covers.map(cover=>({...cover,j:cover.uid})),pairs};
      this.cache.set(uid,data);return data;
    }
    const g=this.geom[uid],points=opaquePoints(g),covers=[];
    for(let j=uid+1;j<this.geom.length;j++){
      const p=this.geom[j];if(!boundsOverlap(g,p))continue;
      const bits=new Uint32Array(Math.ceil(points.length/32));let n=0;
      points.forEach(([x,y],i)=>{if(hit(p,x,y)){bits[i>>>5]|=1<<(i&31);n++}});if(n)covers.push({j,bits});
    }
    const result={all:points.length,covers};this.cache.set(uid,result);return result;
  }
  covered(uid){
    const {all,covers,pairs}=this.coverData(uid);if(!covers.length)return false;
    const alive=covers.filter(({j})=>this.room.has(j));
    if(this.source&&alive.length<=2){
      if(alive.some(cover=>cover.ratio>=coverThreshold))return true;
      if(alive.length<2)return false;
      const [a,b]=alive.map(({j})=>j).sort((left,right)=>left-right);
      return pairs.some(pair=>Math.min(pair.a,pair.b)===a&&Math.max(pair.a,pair.b)===b&&pair.ratio>=coverThreshold);
    }
    const union=new Uint32Array(Math.ceil(all/32));let n=0;
    for(const {bits} of alive)for(let i=0;i<bits.length;i++)union[i]|=bits[i];
    for(const b of union)n+=bitCount(b);
    return n/Math.max(1,all)>=coverThreshold;
  }
  direct(){return [...this.room].some(i=>this.box(this.items[i].group)>=0&&!this.covered(i));}
  settle(effects){
    let changed=true;
    while(changed){changed=false;
      for(const [slot,b] of this.boxes.entries())if(this.order(b)&&b.count>=this.order(b).count){
        this.assign(b);changed=true;
        effects?.push({kind:'complete',slot,index:b.index});
      }
      for(const uid of [...this.tray]){
        const slot=this.box(this.items[uid].group),b=this.boxes[slot];if(b&&b.count<this.order(b).count){
          const fromTray=this.tray.indexOf(uid);
          b.count++;this.tray.splice(fromTray,1);this.delivered++;changed=true;
          effects?.push({kind:'box',j:uid,slot,fromTray,count:b.count});
        }
      }
    }
  }
  tapAt(x,y,effects){
    if(this.state!=='playing')return {kind:'ended'};
    const j=this.itemAt(x,y);
    if(j!==null)return this.tap(j,effects);
    return {kind:'blank'};
  }
  itemAt(x,y){
    for(let j=this.geom.length-1;j>=0;j--)if(this.room.has(j)&&this.hit(j,x,y))return j;
    return null;
  }
  canPick(j){
    return this.state==='playing'&&this.room.has(j)&&!this.covered(j)&&
      (this.tray.length<5||this.box(this.items[j].group)>=0);
  }
  hit(uid,x,y){
    const g=this.geom[uid];
    return this.source ? hitSource(g,this.source[uid].poly,x,y) : hit(g,x,y);
  }
  pointFor(j){
    if(!this.room.has(j)||this.covered(j))return null;
    const g=this.geom[j], {item}=g, {covers}=this.coverData(j);
    if(this.source){
      const upper=[...this.room].filter(uid=>uid>j);
      const exposed=([x,y])=>this.hit(j,x,y)&&!upper.some(uid=>this.hit(uid,x,y));
      const poly=this.source[j].poly, xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
      const [left,right,bottom,top]=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
      for(const n of [1,5,11,21])for(let k=0;k<n*n;k++){
        const x=(left+(right-left)*(k%n+.5)/n)*item.scaleX;
        const y=(bottom+(top-bottom)*(Math.floor(k/n)+.5)/n)*item.scaleY;
        const p=[item.x+x*g.c-y*g.s,item.y+x*g.s+y*g.c];
        if(exposed(p))return p;
      }
      return null;
    }
    const exposed=([x,y])=>hit(g,x,y)&&!covers.some(({j:other})=>this.room.has(other)&&hit(this.geom[other],x,y));
    const center=[item.x,item.y];
    if(hit(g,...center)&&![...this.room].some(other=>other>j&&hit(this.geom[other],...center)))return center;
    return opaquePoints(g).find(exposed)??null;
  }
  tap(j,effects){
    if(this.state!=='playing'||!this.room.has(j))return {kind:'ended'};
    if(this.covered(j))return {kind:'blocked',j};
    const slot=this.box(this.items[j].group),b=this.boxes[slot];
    if(!b&&this.tray.length===5)return {kind:'full',j};
    this.room.delete(j);this.moves++;
    if(b){
      b.count++;this.delivered++;
      effects?.push({kind:'box',j,slot,count:b.count});
    }else{
      effects?.push({kind:'tray',j,slot:this.tray.length});
      this.tray.push(j);
    }
    this.peak=Math.max(this.peak,this.tray.length);this.settle(effects);
    if(this.delivered===this.items.length)this.state='win';
    else if(this.tray.length===5&&(this.level.rule==='strict'||!this.direct()))this.state='lose';
    const result={kind:b?'box':'tray',j};this.log.push(result);return result;
  }
}
return {sorted, ROUND, fitsBackground, itemBounds, stackLayers, itemAt, check, Playtest, layoutKey, sourceGeometry, reorderSourceGeometry};
})();
