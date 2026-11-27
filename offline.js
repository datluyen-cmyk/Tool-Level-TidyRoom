const Offline = (() => {
  'use strict';
  const catalog = window.TIDY_CATALOG;
  const sources = window.TIDY_LEVELS;
  const schema = 'tidy-level-tool/1';
  const compactSchema = 'tidy-level/2';
  const limit = 96 * 1024 * 1024;
  const prefix = 'Art/RoomSortOffline/';
  const items = new Map(catalog.items.map(row => [row.path, row]));
  const rooms = new Map(catalog.backgrounds.map(row => [row.path, row]));
  const roomAssets = new Map(catalog.items.filter(row => row.palette).map(row => [row.id, row]));
  const roomBackgrounds = new Map(catalog.backgrounds.filter(row => row.palette).map(row => [row.id, row]));
  const stem = value => String(value ?? '').split(/[\\/]/).at(-1).replace(/\.(?:json|gz|jpe?g|webp|png)$/gi, '');
  const keyFor = value => String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 70) || 'level';
  const exportPaths = new Map(Object.entries(window.TIDY_GDD_TIDY_ART ?? {}));
  const namedItems = new Map(), namedRooms = new Map();
  for (const [rows,aliases,folder] of [[items,namedItems,'Items'],[rooms,namedRooms,'Rooms']]) {
    for (const row of rows.values()) {
      if (row.displayName) {
        exportPaths.set(row.path,prefix+folder+'/'+row.url.split('/').at(-1));
        aliases.set(row.url,row);
      }
      if (exportPaths.has(row.path)) aliases.set(exportPaths.get(row.path),row);
    }
  }

  function shape(path) {
    const row = items.get(path);
    if (!row) throw Error(`Thiếu sprite ${path}`);
    const bits = atob(row.bits);
    const alpha = Array.from({length: row.maskW * row.maskH}, (_, i) => (bits.charCodeAt(i >> 3) >> (i & 7)) & 1);
    return {w: row.w, h: row.h, maskW: row.maskW, maskH: row.maskH, alpha};
  }

  function artURL(path) {
    const local = exportPaths.get(path) ?? items.get(path)?.url ?? rooms.get(path)?.url ?? path;
    return './' + local.split('/').map(encodeURIComponent).join('/');
  }

  function number(value, field, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`${field} không hợp lệ`);
    return value;
  }

  function integer(value, field, min = 0, max = 5000000) {
    if (!Number.isInteger(value)) throw Error(`${field} phải là số nguyên`);
    return number(value, field, min, max);
  }

  function validate(level, complete = false) {
    if (level?.schema !== schema || !Array.isArray(level.items) || !Array.isArray(level.boxes)) throw Error('JSON level chưa đúng định dạng của tool');
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(level.key ?? '') || typeof level.name !== 'string' || !level.name.trim() || level.name.length > 120)
      throw Error('Tên hoặc mã level không hợp lệ');
    if (!['direct','strict'].includes(level.rule)) throw Error('Luật khay không hợp lệ');
    if (level.items.length > 3000 || level.boxes.length > 3000) throw Error('Vượt quá 3000 dòng đồ hoặc hộp');
    const bg = level.background;
    if (!rooms.has(bg?.asset)) throw Error(`Thiếu nền ${bg?.asset}`);
    number(bg.width,'Chiều rộng nền',.001,50000);
    number(bg.height,'Chiều cao nền',.001,50000);
    number(bg.cameraX ?? 0,'Vị trí camera',-1e7,1e7);
    const ids = new Set(), layers = new Set();
    for (const it of level.items) {
      if (!items.has(it?.asset)) throw Error(`Thiếu ảnh đồ ${it?.asset}`);
      if (typeof it.uid !== 'string' || !it.uid || it.uid.length > 100 || ids.has(it.uid) || layers.has(it.layer)) throw Error('UID và layer của đồ phải là duy nhất');
      ids.add(it.uid);
      layers.add(integer(it.layer,'Layer',0,99999));
      integer(it.group,'Nhóm đồ');
      integer(it.targetType ?? it.group,'Nhóm Unity');
      for (const k of ['x', 'y', 'angle']) number(it[k],k,-1e7,1e7);
      for (const k of ['width', 'height']) number(it[k],k,.001,50000);
      for (const k of ['scaleX', 'scaleY']) number(Math.abs(it[k]),k,.0001,1000);
    }
    for (const b of level.boxes) {
      integer(b.group,'Nhóm hộp');
      integer(b.targetType ?? b.group,'Nhóm hộp Unity');
      integer(b.count,'Sức chứa hộp',1,3000);
      if (typeof b.label !== 'string' || b.label.length > 120) throw Error('Tên hộp không hợp lệ');
    }
    if (complete && !TidyGame.check(level).ok) throw Error('Cần có đồ và tổng chỗ mỗi nhóm phải khớp');
    return level;
  }

  const labelFor = group => catalog.roomGroups[group] ?? `Nhóm ${group}`;

  function artSet(row) {
    return row.palette ? 'roomsort' : row.family;
  }

  const catalogKey = row => `${artSet(row)}:${row.id}`;
  const itemIds = new Map(catalog.items.map(row => [catalogKey(row), row]));
  const roomIds = new Map(catalog.backgrounds.map(row => [catalogKey(row), row]));
  for (const row of catalog.items) if (row.displayName) itemIds.set(`${artSet(row)}:${row.displayName}`,row);
  for (const row of catalog.backgrounds) if (row.displayName) roomIds.set(`${artSet(row)}:${row.displayName}`,row);

  function defaultSize(art, bg) {
    if (art.native) return art.native;
    if (art.family === 'happy') {
      const factor = catalog.placement.happyScales[bg.id]?.[art.group] ?? 1;
      return [art.w * factor, art.h * factor];
    }
    const original = catalog.placement.roomShapes[art.id];
    if (original) {
      const factor = Math.min(original[0] / art.w, original[1] / art.h);
      return [art.w * factor, art.h * factor];
    }
    return [art.w, art.h];
  }

  function attachGeometry(level, refs) {
    if (refs === undefined) return level;
    const count = level.items.length;
    const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
    const isUnit = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const isCover = (cover, uid, words) => Number.isInteger(cover?.uid) && cover.uid > uid && cover.uid < count &&
      isUnit(cover.ratio) && Array.isArray(cover.bits) && cover.bits.length === words &&
      cover.bits.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff);
    if (!Array.isArray(refs) || refs.length !== count || refs.some((row, uid) => {
      const {poly, reference} = row ?? {};
      if (!Array.isArray(poly) || poly.length < 3 || poly.length > 4096 || !poly.every(finitePoint) ||
          !Number.isInteger(reference?.samples) || reference.samples < 0 || reference.samples > 4096 ||
          !Array.isArray(reference.covers) || !Array.isArray(reference.pairs)) return true;
      const words = Math.ceil(reference.samples / 32);
      return reference.covers.some(cover => !isCover(cover, uid, words)) || reference.pairs.some(pair =>
        !Number.isInteger(pair?.a) || !Number.isInteger(pair?.b) || pair.a===pair.b ||
        Math.min(pair.a,pair.b)<=uid || Math.max(pair.a,pair.b)>=count || !isUnit(pair.ratio));
    })) throw Error('Viền che gốc không khớp với level.');
    level.sourceGeometry = {layout:TidyGame.layoutKey(level.items),items:refs};
    return level;
  }

  const proofKey = level => JSON.stringify([
    TidyGame.layoutKey(level.items), TidyGame.sorted(level.items).map(it=>it.group),
    level.boxes.map(box=>[box.group,box.count]), level.rule, !!TidyGame.sourceGeometry(level)
  ]);
  const proofRoute = level => level.verifiedProof?.key === proofKey(level) ? level.verifiedProof.route : null;
  function tidyReference(value) {
    if (value?.source !== 'tidy57' || ![0,1,2].includes(value.difficulty) ||
        !Number.isInteger(value.timeLimit) || value.timeLimit < 0 || value.timeLimit > 86400) return undefined;
    return {source:value.source,difficulty:value.difficulty,timeLimit:value.timeLimit};
  }

  function attachProof(level, route) {
    const count = level.items.length;
    if (!Array.isArray(route) || !count || route.length !== count || new Set(route).size !== count ||
        route.some(uid=>!Number.isInteger(uid) || uid < 0 || uid >= count)) return level;
    level.verifiedProof = {key:proofKey(level),route};
    return level;
  }

  function compact(level) {
    validate(level);
    const bg = rooms.get(level.background.asset);
    const bgSet = artSet(bg);
    const usage = new Map();
    for (const it of level.items) {
      const set = artSet(items.get(it.asset));
      usage.set(set, (usage.get(set) ?? 0) + 1);
    }
    const itemSet = [...usage].sort((a,b) => b[1]-a[1])[0]?.[0] ?? 'roomsort';
    const data = {schema:compactSchema,key:level.key,name:level.name,bg:bg.displayName ?? bg.id};
    if (bgSet !== 'roomsort') data.bgSet = bgSet;
    if (itemSet !== 'roomsort') data.itemSet = itemSet;
    if (level.background.width !== bg.w || level.background.height !== bg.h)
      data.bgSize = [level.background.width,level.background.height];
    if (level.background.cameraX) data.bgPosX = level.background.cameraX;
    if (level.rule !== (bgSet === 'happy' ? 'strict' : 'direct')) data.rule = level.rule;

    const unityTypes = new Map();
    data.order = level.boxes.map(b => {
      const box = {type:b.group,count:b.count};
      const target = b.targetType ?? b.group;
      unityTypes.set(b.group,target);
      if (target !== b.group) box.unityType = target;
      if (b.label !== labelFor(b.group)) box.label = b.label;
      return box;
    });
    data.content = TidyGame.sorted(level.items).map(it => {
      const art = items.get(it.asset);
      const object = {id:art.displayName ?? art.id,x:it.x,y:it.y};
      if (artSet(art) !== itemSet) object.set = artSet(art);
      if (it.angle) object.angle = it.angle;
      if (it.scaleX !== 1) object.scaleX = it.scaleX;
      if (it.scaleY !== 1) object.scaleY = it.scaleY;
      if (it.group !== art.group) object.type = it.group;
      const target = it.targetType ?? it.group;
      if (target !== (unityTypes.get(it.group) ?? it.group)) object.unityType = target;
      const [w,h] = defaultSize(art,bg);
      if (it.width !== w || it.height !== h) object.size = [it.width,it.height];
      return object;
    });
    const geometry = TidyGame.sourceGeometry(level);
    if (geometry) data.sourceGeometry = geometry;
    const reference = tidyReference(level.reference);
    if (reference) data.reference = reference;
    const proof = proofRoute(level);
    if (proof) data.proof = proof;
    return data;
  }

  function expand(data) {
    const {key,name,order,content} = data;
    const bgSet = data.bgSet ?? 'roomsort';
    const bg = roomIds.get(`${bgSet}:${data.bg}`);
    if (!bg) throw Error(`Thiếu nền ${data.bg} trong catalog ${bgSet}`);
    if (!Array.isArray(order) || !Array.isArray(content)) throw Error('Thiếu order[] hoặc content[]');
    const boxes = order.map(o => ({group:o.type,targetType:o.unityType ?? o.type,count:o.count,label:o.label ?? labelFor(o.type)}));
    const unityTypes = new Map(boxes.map(b=>[b.group,b.targetType]));
    const objects = content.map((it,layer) => {
      const set = it.set ?? data.itemSet ?? 'roomsort';
      const art = itemIds.get(`${set}:${it.id}`);
      if (!art) throw Error(`Thiếu sprite ${it.id} trong catalog ${set}`);
      const [width,height] = it.size ?? defaultSize(art,bg);
      const group = it.type ?? art.group;
      return {uid:`i${layer+1}`,asset:art.path,layer,group,targetType:it.unityType ?? unityTypes.get(group) ?? group,
        x:it.x,y:it.y,width,height,angle:it.angle ?? 0,scaleX:it.scaleX ?? 1,scaleY:it.scaleY ?? 1};
    });
    const [width,height] = data.bgSize ?? [bg.w,bg.h];
    const level = validate({schema,key,name,background:{asset:bg.path,width,height,cameraX:data.bgPosX ?? 0},
      rule:data.rule ?? (bgSet === 'happy' ? 'strict' : 'direct'),items:objects,boxes});
    const reference = tidyReference(data.reference);
    if (reference) level.reference = reference;
    return attachProof(attachGeometry(level,data.sourceGeometry),data.proof);
  }

  function extractLevels(doc) {
    if (Array.isArray(doc)) return doc;
    if (doc?.schema === schema || doc?.content || doc?.items) return [doc];
    if (Array.isArray(doc?.records)) return doc.records.map(r => r?.level ?? r);
    if (Array.isArray(doc?.levels)) return doc.levels;
    if (Array.isArray(doc?.base?.levels)) return doc.base.levels;
    throw Error('Không thấy level JSON trong file');
  }

  function convertLevel(raw, format, hint) {
    if (raw?.schema === compactSchema) return expand(raw);
    if (raw?.schema === schema) return validate(raw);
    if (!Array.isArray(raw?.content) || !raw.content.length || !Array.isArray(raw.order)) throw Error('Thiếu content[] hoặc order[]');
    const bgId = stem(raw.bgFile ?? raw.bg);
    const unityBackground = rooms.get(raw.bg) ?? namedRooms.get(raw.bg);
    const isUnity = !!unityBackground && raw.content.some(it => it.art);
    let mode = format;
    if (isUnity) mode = 'unity';
    else if (mode === 'auto') {
      if (bgId.startsWith('HT_BG_')) mode = 'happy';
      else if (roomBackgrounds.has(bgId)) mode = 'room';
      else if (rooms.has(`Art/TidyRoomBG/${bgId}.jpg`)) mode = 'tidy';
      else mode = 'room';
    }
    let base;
    if (mode === 'unity') base = (raw.source === 'RoomSort' && rooms.get(raw.sourceBg)) || unityBackground;
    if (mode === 'room') base = roomBackgrounds.get(bgId);
    if (mode === 'tidy') base = rooms.get(`Art/TidyRoomBG/${catalog.legend[bgId] ?? bgId}.jpg`);
    if (mode === 'happy') base = rooms.get(`Art/HappyBG/${bgId}.jpg`);
    if (!base) throw Error(`Thiếu nền ${bgId}`);
    let [width, height] = base === unityBackground || !isUnity ? raw.bgSize ?? [raw.width ?? base.w,raw.height ?? base.h] : [base.w,base.h];
    if (mode === 'tidy' && !raw.bgSize && !raw.width && roomBackgrounds.has(bgId)) {
      const original = roomBackgrounds.get(bgId);
      const fit = Math.min(original.w / base.w, original.h / base.h);
      [width,height] = [base.w*fit,base.h*fit];
    }
    const boxSources = new Map();
    const boxes = raw.order.map(o => {
      const group = o.sourceType ?? o.type;
      const box = {group,targetType:o.type,label:o.label ?? labelFor(group),count:o.count};
      if (o.box !== undefined) boxSources.set(o.box,box);
      return box;
    });
    const byGroup = new Map(boxes.map(b=>[b.group,b]));
    const missing = new Set();
    const objects = raw.content.map((it, layer) => {
      const id = it.id;
      let art = items.get(it.art) ?? namedItems.get(it.art);
      if (!art && mode === 'room') art = roomAssets.get(id);
      if (!art && mode === 'tidy') art = items.get(`Art/TidyRoom/${id}.png`) ?? roomAssets.get(id);
      if (!art && mode === 'happy') art = items.get(`Art/Happy/${id}.png`);
      if (!art) { missing.add(id ?? `đồ ${layer+1}`); return null; }
      const group = it.sourceType ?? boxSources.get(it.box)?.group ?? it.type ?? art.group;
      let [w,h] = art.native ?? [art.w,art.h];
      if (mode === 'happy') {
        const scale = catalog.placement.happyScales[bgId]?.[group] ?? 1;
        [w,h] = [w*scale,h*scale];
      }
      return {uid:`i${layer+1}`,asset:art.path,group,targetType:it.type ?? byGroup.get(group)?.targetType ?? group,layer,
        x:it.x ?? 0,y:it.y ?? 0,width:it.width ?? w,height:it.height ?? h,angle:it.angle ?? 0,scaleX:it.scaleX ?? 1,scaleY:it.scaleY ?? 1};
    });
    if (missing.size) throw Error(`Thiếu sprite ${[...missing].slice(0,14).join(', ')}`);
    const name = String(raw.name ?? raw.levelName ?? raw.level ?? hint).trim().slice(0,120);
    const warnings = [];
    const geometry = isUnity && base === unityBackground && raw.coverageMode === 'source' &&
      raw.content.every((it,i)=>it.uid===i&&it.poly&&it.reference)
      ? raw.content.map(({poly,reference})=>({poly,reference})) : undefined;
    if (raw.coverageMode === 'source' && !geometry) warnings.push('Playtest tính che theo viền ảnh để hỗ trợ bố cục đã chỉnh.');
    const key = isUnity && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(raw.key ?? '') ? raw.key : keyFor(raw.key ?? hint);
    const level = {schema,key,name,rule:raw.source === 'Happy' || mode === 'happy' ? 'strict':'direct',
      background:{asset:base.path,width,height,cameraX:raw.bgPosX ?? 0},items:objects,boxes,origin:{format:mode,warnings}};
    validate(level);
    if (!TidyGame.check(level).ok) warnings.push('Số đồ và số chỗ chưa khớp theo nhóm.');
    return attachProof(attachGeometry(level,geometry),isUnity&&base===unityBackground?raw.proof:undefined);
  }

  function convert(docs, mode, rejected = []) {
    const levels = [], usedKeys = new Set();
    for (const [file,doc] of docs) {
      let rows;
      try { rows = extractLevels(doc); }
      catch (error) { rejected.push({file,error:error.message}); continue; }
      for (const [i, raw] of rows.entries()) {
        if (levels.length + rejected.length >= 2000) throw Error('Mỗi lượt tối đa 2000 màn');
        try {
          const l = convertLevel(raw,mode,rows.length > 1 ? `${stem(file)}-${i+1}` : stem(file));
          let key = l.key, n = 2;
          while (usedKeys.has(key)) key = `${l.key.slice(0,70)}-${n++}`;
          usedKeys.add(key);
          levels.push(key === l.key ? l : {...l,key});
        } catch (error) {
          rejected.push({file,level:String(raw?.key ?? raw?.name ?? raw?.levelName ?? i+1).slice(0,120),error:error.message});
        }
      }
    }
    const pack = {schema:'tidy-level-pack/1',levels,rejected};
    const input = docs.length === 1 ? docs[0][1] : null;
    if (input?.schema === pack.schema && typeof input.key === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.key)) pack.key = input.key;
    return pack;
  }

  function library(kind, key) {
    if (kind === 'unity' || kind === 'unity10') {
      const entries = kind === 'unity10' ? sources.unity.slice(0,10) : sources.unity.filter(row => !key || row.entry.key === key);
      const pack = convert(entries.map(r => [r.entry.file,r.level]),'auto');
      if (kind === 'unity10') pack.key = 'unity-levels-01-10';
      return pack;
    }
    if (kind === 'roomsort10') {
      const byKey = new Map(sources.roomsort.map(level=>[level.key,level]));
      const originals = sources.unity.slice(0,10).map(row=>byKey.get(row.entry.key));
      const pack = convert([['roomsort-01-10.json',originals]],'room');
      pack.key = 'roomsort-levels-01-10';
      return pack;
    }
    const levels = sources[kind];
    const chosen = key ? levels.filter(l => l.key === key) : levels;
    return convert([[`${kind}.json`,chosen]],kind === 'happy' ? 'happy' : 'room');
  }

  function compactPack(pack) {
    const result = {schema:'tidy-level-pack/1',levels:pack.levels.map(compact)};
    if (pack.key) result.key = pack.key;
    return result;
  }

  async function readGzip(bytes, budget) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const result = [];
    let length = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > budget) throw Error('Dữ liệu giải nén vượt 96 MB');
        result.push(value);
      }
      return new Uint8Array(await new Blob(result).arrayBuffer());
    } finally { await reader.cancel().catch(()=>{}); }
  }

  function readZipMember(member, budget) {
    return new Promise((resolve,reject) => {
      const chunks = [];
      let size = 0;
      const stream = member.internalStream('uint8array');
      stream.on('data',chunk => {
        size += chunk.byteLength;
        if (size > budget) { stream.pause(); reject(Error('Dữ liệu ZIP vượt 96 MB')); }
        else chunks.push(chunk);
      }).on('error',reject).on('end',async () => {
        try { resolve(new Uint8Array(await new Blob(chunks).arrayBuffer())); }
        catch (error) { reject(error); }
      }).resume();
    });
  }

  async function importFiles(files, mode, onSingleFormat) {
    let budget = limit;
    const docs = [], rejected = [];
    async function parse(name, bytes) {
      if (/\.gz$/i.test(name) || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = await readGzip(bytes,budget);
      if (bytes.byteLength > budget) throw Error('Dữ liệu nhập vượt 96 MB');
      budget -= bytes.byteLength;
      docs.push([name,JSON.parse(new TextDecoder().decode(bytes))]);
    }
    for (const file of files) {
      const name = file.webkitRelativePath || file.name;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!/\.zip$/i.test(name)) { await parse(name,bytes); continue; }
        const zip = await JSZip.loadAsync(bytes);
        const members = Object.values(zip.files).filter(m => !m.dir && /\.json(?:\.gz)?$/i.test(m.name));
        if (members.length > 2000 || !members.length) throw Error('ZIP phải có từ 1 đến 2000 file JSON hoặc JSON.GZ');
        for (const member of members) {
          try { await parse(member.name,await readZipMember(member,budget)); }
          catch (error) { rejected.push({file:member.name,error:error.message}); }
        }
      } catch (error) { rejected.push({file:name,error:error.message}); }
    }
    const pack = convert(docs, mode, rejected);
    if (onSingleFormat && files.length===1 && /\.json$/i.test(files[0].name) &&
        docs.length===1 && pack.levels.length===1 && !pack.rejected.length) {
      const raw = docs[0][1];
      if (raw?.schema===compactSchema) onSingleFormat('tool');
      else if (['art','source'].includes(raw?.coverageMode) && Array.isArray(raw.content) &&
               raw.content.every(it=>it.art && Number.isInteger(it.uid))) onSingleFormat('unity');
    }
    return pack;
  }

  function unity(level) {
    validate(level,true);
    const slots = new Map();
    const order = level.boxes.map((o,i) => {
      const box = i+1000;
      if (!slots.has(o.group)) slots.set(o.group,[]);
      slots.get(o.group).push(...Array(o.count).fill(box));
      return {type:o.targetType ?? o.group,sourceType:o.group,label:o.label,count:o.count,box};
    });
    const cursors = new Map();
    const content = TidyGame.sorted(level.items).map((it,uid) => {
      const {asset,group,targetType,x,y,angle,width,height,scaleX,scaleY} = it;
      const {maskW,maskH,alpha} = shape(asset);
      const art = items.get(asset);
      const cursor = cursors.get(group) ?? 0;
      cursors.set(group,cursor+1);
      return {id:art.displayName ?? art.id,sourceId:art.id,art:exportPaths.get(asset) ?? asset,uid,type:targetType ?? group,sourceType:group,x,y,angle,width,height,scaleX,scaleY,
        box:slots.get(group)[cursor],maskW,maskH,alpha};
    });
    const bg = level.background;
    const geometry = TidyGame.sourceGeometry(level);
    if (geometry) content.forEach((item,i)=>Object.assign(item,geometry[i]));
    return {key:level.key,levelName:level.name,name:level.name,source:level.rule === 'strict'?'Happy':'RoomSort',
      bg:exportPaths.get(bg.asset) ?? bg.asset,bgSize:[bg.width,bg.height],bgPosX:bg.cameraX ?? 0,coverageMode:geometry?'source':'art',blockThreshold:.045,
      artTheme:bg.asset.startsWith(prefix) ? 'RoomSort' : 'TidyRoom',order,content,issues:[],proof:proofRoute(level) ?? []};
  }

  function formatJson(data,indent=2) {
    const text = JSON.stringify(data,null,indent);
    return text.replace(/"(alpha|bits)": \[([\s\d,]+)\]/g,(_,field,values)=>
      `"${field}": [${values.replace(/\s+/g,'')}]`);
  }

  return {catalog,sources,artURL,shape,validate,library,importFiles,unity,compact,compactPack,formatJson,proofRoute,attachProof};
})();
