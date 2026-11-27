const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {gunzipSync} = require('node:zlib');

const tool = __dirname;
const unityRoot = path.resolve(tool,'../TidyRoom Sort/Assets/StreamingAssets/TidyRoom');
const output = path.resolve(process.argv[2] ?? path.join(tool,'RoomSort Unity 139'));
const runtime = vm.createContext({window:{},atob});
for (const file of ['data/catalog.js','data/levels.js','game.js','offline.js'])
  vm.runInContext(fs.readFileSync(path.join(tool,file),'utf8'),runtime,{filename:file});
const offline = vm.runInContext('Offline',runtime);

function readJson(directory,filename){
  const bytes=fs.readFileSync(path.join(directory,filename));
  const json=filename.endsWith('.gz')?gunzipSync(bytes):bytes;
  return JSON.parse(json.toString('utf8').replace(/^\uFEFF/,''));
}

function write(filename,value){
  fs.writeFileSync(path.join(output,filename),Offline.formatJson(value)+'\n',{flag:'wx'});
}

const original = offline.library('roomsort');
assert.equal(original.levels.length,139);
assert.equal(original.rejected.length,0);
const current = new Map(readJson(unityRoot,'index.json').levels.map(entry=>[entry.key,entry]));
const items = new Set(), backgrounds = new Set();
const rows=[];
let variants=0,proofs=0,objects=0;
for(const level of original.levels){
  const sourceEntry=current.get(level.key);
  assert(sourceEntry,`Unknown Unity source: ${level.key}`);
  const source=readJson(unityRoot,sourceEntry.file);
  const converted=offline.unity(level);
  assert.equal(source.coverageMode,'source');
  assert.equal(source.content.length,converted.content.length);
  assert.equal(source.order.length,converted.order.length);
  source.order.forEach((box,i)=>{
    assert.equal(converted.order[i].sourceType,box.sourceType,`${level.key} box ${i} group`);
    assert.equal(converted.order[i].count,box.count,`${level.key} box ${i} count`);
    converted.order[i].label=box.label;
  });
  for(const [uid,originalItem] of converted.content.entries()){
    const baked=source.content[uid];
    assert.equal(originalItem.id,baked.sourceId,`${level.key} item ${uid} source`);
    assert.equal(baked.uid,uid);
    for(const key of ['x','y','scaleX','scaleY','angle','sourceType']) assert.equal(originalItem[key],baked[key],`${level.key} item ${uid} ${key}`);
    assert.equal(originalItem.width,baked.sourceWidth,`${level.key} item ${uid} width`);
    assert.equal(originalItem.height,baked.sourceHeight,`${level.key} item ${uid} height`);
    assert(baked.poly?.length>=3&&baked.reference,`${level.key} item ${uid} lacks collision data`);
    Object.assign(originalItem,{poly:baked.poly,reference:baked.reference});
    items.add(originalItem.art);
  }
  backgrounds.add(converted.bg);
  Object.assign(converted,{name:source.name,levelName:source.levelName,coverageMode:'source',proof:source.proof ?? []});
  delete converted.issues;
  if (!converted.proof.length) delete converted.proof;
  else proofs++;
  if (level.key.startsWith('ladder_')) variants++;
  objects+=converted.content.length;
  rows.push({entry:{key:converted.key,label:sourceEntry.label,source:'RoomSort',file:`Levels/${converted.key}.json`,review:false},level:converted});
}

for(const asset of [...items,...backgrounds])
  assert(fs.statSync(path.join(tool,asset)).isFile(),`Missing RoomSort art: ${asset}`);

fs.mkdirSync(output,{recursive:false});
fs.mkdirSync(path.join(output,'Levels'));
for(const {entry,level} of rows)write(entry.file,level);
write('index.json',{levels:rows.map(row=>row.entry)});
write('assets-used.json',{
  levels:rows.length,baseLevels:rows.length-variants-1,variants,tutorials:1,objects,proofs,
  items:[...items].sort(),backgrounds:[...backgrounds].sort(),
  catalog:{spriteIds:offline.catalog.items.filter(row=>row.palette).length+offline.catalog.missingRoomSprites.length,
    availableSprites:offline.catalog.items.filter(row=>row.palette).length,
    backgrounds:offline.catalog.backgrounds.filter(row=>row.palette).length,
    missingSpriteIds:offline.catalog.missingRoomSprites}
});
console.log(`${rows.length} Unity JSON files, ${objects} placements, ${items.size} sprites, ${backgrounds.size} backgrounds, ${proofs} solution replays.`);
