import argparse
import base64
import collections
import gzip
import io
import json
import math
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
from statistics import median
import sys
import threading
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile

from PIL import Image

HERE = Path(__file__).resolve().parent
UNITY = Path(os.environ.get('TIDY_UNITY_PROJECT', HERE.parent / 'TidyRoom Sort')).resolve()
ROOT = UNITY / 'Assets/StreamingAssets/TidyRoom'
OLD = Path(os.environ.get('TIDY_ANALYSIS_ROOT', 'D:/APK Works'))
RAW = {
    'roomsort': [UNITY / 'Tools/Source/room.json'],
    'happy': [OLD / 'RoomSort/analysis/happy-levels.json'],
}
FOLDERS = {'tidy': ('TidyRoom','TidyRoomBG'), 'room': ('Room','RoomBG'), 'happy': ('Happy','HappyBG')}
SCHEMA = 'tidy-level-tool/1'
MAX = 96 * 1024 * 1024
IMAGE_TYPES = {'.png','.jpg','.jpeg','.webp'}
STATIC = {'/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/game.js': 'game.js'}
install_lock = threading.Lock()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def optional(path):
    return read_json(path) if path.is_file() else {}


def number(v, key, default=None):
    if v is None: v = default
    if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>1e7:
        raise ValueError(f'{key} không hợp lệ')
    return v


def integer(v,key,minval=0,maxval=5000000):
    if isinstance(v,bool) or not isinstance(v,int) or not minval<=v<=maxval:
        raise ValueError(f'{key} không hợp lệ')
    return v


def slug(value):
    return re.sub(r'[^a-z0-9_-]+','-',str(value).lower()).strip('-_')[:70] or 'level'


def index():
    return read_json(ROOT / 'index.json')['levels']


@lru_cache(maxsize=1)
def metadata():
    room = optional(UNITY/'Tools/Source/room.json')
    mapping = optional(UNITY/'Tools/category-map.json')
    happy = optional(OLD/'HappyTidyRoom/analysis/mono/resources.assets_7861.json')
    config = optional(OLD/'HappyTidyRoom/analysis/mono/resources.assets_10789.json')
    legend = optional(OLD/'Tidy Room/analysis/RoomBackgroundLegacyNames.txt')
    if not legend:
        for entry in index():
            if entry['source']=='RoomSort':
                l=decode((ROOT / entry['file']).read_bytes(), entry['file'])
                if l.get('sourceBg') and l['bg'].startswith('Art/TidyRoomBG/'):
                    legend[Path(l['sourceBg']).stem]=Path(l['bg']).stem
    return {
        'roomShapes':room.get('shapes',{}), 'names':{int(k):v['sourceName'] for k,v in mapping.items()},
        'happyItems':{i['id']:i['subGroup'] for i in happy.get('items',[])},
        'happyNames':{g['value']:g['folder'] for g in happy.get('subGroups',[])},
        'scales':{m['key']:{x['type']:x['scale'] for x in m['itemScales']} for m in config.get('maps',[])},
        'legend':legend,
    }


@lru_cache(maxsize=1)
def catalog():
    md=metadata()
    result={'items':[], 'backgrounds':[], 'ui':{}}
    inferred={}
    if not md['happyItems']:
        for e in index():
            if e['source']=='Happy':
                l=decode((ROOT/e['file']).read_bytes(),e['file']); inferred.update({i['id']:i['sourceType'] for i in l['content']})
                md['happyNames'].update({o['sourceType']:o['label'] for o in l['order']})
    for family,(objects,backgrounds) in FOLDERS.items():
        for section,folder in [('items',objects),('backgrounds',backgrounds)]:
            for p in sorted((ROOT/'Art'/folder).iterdir(),key=lambda x:x.name.lower()):
                if p.suffix.lower() not in IMAGE_TYPES or not p.is_file(): continue
                key=p.relative_to(ROOT).as_posix()
                row={'path':key,'id':p.stem,'family':family}
                if section=='backgrounds':
                    with Image.open(p) as im: row.update(w=im.width,h=im.height)
                    row['label']=p.stem.replace('_',' ')
                else:
                    group = md['happyItems'].get(p.stem,inferred.get(p.stem)) if family=='happy' else (int(p.stem.split('-')[0]) if re.fullmatch(r'\d+-\d+',p.stem) else None)
                    row.update(group=group,label=(md['happyNames'] if family=='happy' else md['names']).get(group,f'Nhóm {group}' if group is not None else 'Chưa gán nhóm'))
                result[section].append(row)
    for name in ('GP_Box0','GP_Box_Unlock','GP_Slot','Hint','NewBooster_Icon_Clear','NewBooster_Icon_Vaccum'):
        p=f'Art/TidyRoomUI/{name}.png'
        if (ROOT/p).is_file(): result['ui'][name]=p
    return result


@lru_cache(maxsize=1)
def by_path():
    c=catalog()
    return ({x['path']:x for x in c['items']},{x['path']:x for x in c['backgrounds']})


@lru_cache(maxsize=1)
def placement_sizes():
    """Displayed width/height as a fraction of the authored room height."""
    items, backgrounds = by_path()
    points = collections.defaultdict(list)
    on_bg = collections.defaultdict(lambda:collections.defaultdict(list))
    for entry in index():
        if entry['key'].startswith('html5_'): continue
        try:
            filename=entry['file']; level=decode((ROOT/filename).read_bytes(),filename)
        except (OSError,ValueError): continue
        bg=level['bg']; original=level.get('sourceBg'); size=level.get('bgSize')
        for it in level.get('content',[]):
            art=it.get('art'); w=abs(it['width']*it.get('scaleX',1)); h=abs(it['height']*it.get('scaleY',1))
            if art not in items or w<=0 or h<=0: continue
            for path in dict.fromkeys((bg,original)):
                if path not in backgrounds: continue
                height=size[1] if path==bg and size and size[1]>0 else backgrounds[path]['h']
                ratio=(w/height,h/height)
                if path==bg: points[art].append(ratio)
                on_bg[art][path].append(ratio)
    def ratio(rows): return [round(median(row[k] for row in rows),7) for k in (0,1)]
    return {key:{'default':ratio(rows), 'rooms':{bg:ratio(v) for bg,v in on_bg[key].items()}} for key,rows in points.items()}


def placement_catalog():
    info=metadata()
    return {'sizes':placement_sizes(), 'roomShapes':{key:[v['w'],v['h']] for key,v in info['roomShapes'].items()},'happyScales':info['scales']}


@lru_cache(maxsize=6000)
def shape(path):
    with Image.open(ROOT/path) as img:
        w,h=img.size
        alpha=img.convert('RGBA').getchannel('A')
        alpha.thumbnail((40,40))
        return {'w':w,'h':h,'maskW':alpha.width,'maskH':alpha.height,'alpha':[int(v>32) for v in alpha.tobytes()]}


def decode(blob, name):
    if name.lower().endswith('.gz') or blob[:2]==b'\x1f\x8b':
        with gzip.GzipFile(fileobj=io.BytesIO(blob)) as stream: blob=stream.read(MAX+1)
    if len(blob)>MAX: raise ValueError('JSON lớn hơn 96 MB')
    return json.loads(blob.decode('utf-8-sig'))


def clone_levels(doc):
    if isinstance(doc,list): return doc
    if not isinstance(doc,dict): raise ValueError('Cần object hoặc danh sách level JSON')
    if isinstance(doc.get('records'),list): return [x.get('level',x) if isinstance(x,dict) else x for x in doc['records']]
    if isinstance(doc.get('levels'),list): return doc['levels']
    if isinstance(doc.get('base'),dict) and isinstance(doc['base'].get('levels'),list): return doc['base']['levels']
    if 'content' in doc or 'items' in doc: return [doc]
    raise ValueError('Không tìm thấy level (content/items, levels[], base.levels[] hoặc records[])')


def validate(l, complete=False):
    if not isinstance(l,dict) or l.get('schema')!=SCHEMA: raise ValueError('Sai schema của tool')
    if not isinstance(l.get('name'),str) or not l['name'].strip() or len(l['name'])>120: raise ValueError('Tên màn rỗng hoặc quá dài')
    if not isinstance(l.get('key'),str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}',l['key']): raise ValueError('Key màn chỉ gồm chữ thường, số, dấu - và _')
    if l.get('rule') not in ('strict','direct'): raise ValueError('Luật khay không hợp lệ')
    assets,bgs=by_path()
    bg=l.get('background',{})
    if bg.get('asset') not in bgs: raise ValueError(f"Thiếu nền: {bg.get('asset')}")
    for field in ('width','height'):
        if not 0<number(bg.get(field),field)<=50000: raise ValueError(f'Kích thước nền {field} không hợp lệ')
    number(bg.get('cameraX'),'cameraX',0)
    items=l.get('items'); boxes=l.get('boxes')
    if not isinstance(items,list) or len(items)>3000 or not isinstance(boxes,list) or len(boxes)>3000: raise ValueError('items/boxes phải là mảng tối đa 3000 dòng')
    have=collections.Counter(); want=collections.Counter(); ids=set(); layers=set()
    for i,it in enumerate(items):
        if it.get('asset') not in assets: raise ValueError(f"Thiếu ảnh đồ: {it.get('asset')}")
        uid=it.get('uid'); layer=integer(it.get('layer'),'layer',0,99999)
        if not isinstance(uid,str) or not uid or len(uid)>100 or uid in ids or layer in layers: raise ValueError('UID và layer của đồ phải là duy nhất')
        ids.add(uid); layers.add(layer)
        for k in ('x','y','angle'): number(it.get(k),k)
        for k in ('width','height'):
            if not 0<number(it.get(k),k)<=50000: raise ValueError(f'{k} không hợp lệ ở đồ {i+1}')
        for k in ('scaleX','scaleY'):
            if not .0001<=abs(number(it.get(k),k))<=1000: raise ValueError(f'{k} không hợp lệ ở đồ {i+1}')
        group=integer(it.get('group'),'nhóm đồ'); integer(it.get('targetType',group),'nhóm Unity')
        have[group]+=1
    for box in boxes:
        group=integer(box.get('group'),'nhóm hộp'); integer(box.get('targetType',group),'nhóm Unity')
        want[group]+=integer(box.get('count'),'sức chứa hộp',1,3000)
        if not isinstance(box.get('label'),str) or len(box['label'])>120: raise ValueError('Tên hộp không hợp lệ')
    if complete and (not items or have!=want):
        detail='; '.join(f'{g}: {have[g]} đồ / {want[g]} chỗ' for g in sorted(have.keys()|want.keys()) if have[g]!=want[g])
        raise ValueError('Cần có đồ và tổng chỗ mỗi nhóm phải khớp. '+detail)
    return l


def convert_level(l, mode='auto', key_hint=''):
    if not isinstance(l,dict): raise ValueError('Level phải là object JSON')
    if l.get('schema')==SCHEMA: return validate(l)
    content=l.get('content'); order=l.get('order')
    if not isinstance(content,list) or not isinstance(order,list) or not content: raise ValueError('Thiếu content[] hoặc order[]')
    assets,bgs=by_path(); md=metadata()
    bg=str(l.get('bg','')); bgid=Path(str(l.get('bgFile') or bg)).stem
    unity=bg in bgs and any('art' in it for it in content)
    if unity: mode='unity'
    elif mode=='auto':
        if bg in bgs: mode=bgs[bg]['family']
        elif bg.startswith('HT_BG_') or not re.fullmatch(r'\d+-\d+',str(content[0].get('id',''))): mode='happy'
        elif f'Art/TidyRoomBG/{bgid}.jpg' in bgs: mode='tidy'
        else: mode='room'
    if mode not in (*FOLDERS,'unity'): raise ValueError('Nguồn level chưa hỗ trợ')
    background_candidates=[bg] if bg in bgs else []
    if mode=='unity' and l.get('source')=='RoomSort' and l.get('sourceBg') in bgs:
        background_candidates.insert(0,l['sourceBg'])
    elif mode=='room': background_candidates.extend((f'Art/RoomBG/{bgid}.jpg',f'Art/TidyRoomBG/{md["legend"].get(bgid,bgid)}.jpg'))
    elif mode=='tidy': background_candidates.append(f'Art/TidyRoomBG/{md["legend"].get(bgid,bgid)}.jpg')
    elif mode=='happy': background_candidates.append(f'Art/HappyBG/{Path(bg).stem}.jpg')
    selected=next((p for p in background_candidates if p in bgs),None)
    if selected is None: raise ValueError(f'Thiếu nền trong Unity: {bg or bgid}')
    back=bgs[selected]
    use_source_size = selected==bg or not unity
    bw,bh=(l.get('bgSize') or [l.get('width',back['w']),l.get('height',back['h'])]) if use_source_size else (back['w'],back['h'])
    warnings=[]
    if l.get('coverageMode')=='source': warnings.append('Playtest dùng viền ảnh Unity để vẫn đúng sau khi kéo/thay đồ; luật che có thể khác bản gốc.')
    if not unity and mode=='tidy' and bgid.isdigit() and bgid in md['legend'] and f'Art/RoomBG/{bgid}.jpg' in bgs and not l.get('width') and not l.get('bgSize'):
        orig=bgs[f'Art/RoomBG/{bgid}.jpg']; fit=min(orig['w']/back['w'],orig['h']/back['h']); bw,bh=back['w']*fit,back['h']*fit
    boxes=[]; bybox={}
    for o in order:
        g=int(o.get('sourceType',o['type'])); target=int(o['type'])
        label=str(o.get('label') or (md['happyNames'] if mode=='happy' else md['names']).get(g) or f'Nhóm {g}')
        pair={'group':g,'targetType':target,'label':label,'count':int(o['count'])}
        boxes.append(pair)
        if 'box' in o: bybox[o['box']]=pair
    items=[]; failures=set(); fallback=set()
    for n,i in enumerate(content):
        aid=str(i.get('id','')); box=bybox.get(i.get('box')); asset=i.get('art'); numeric=re.fullmatch(r'(\d+)-\d+',aid)
        if asset not in assets:
            candidates=([f'Art/TidyRoom/{aid}.png',f'Art/Room/{aid}.png'] if numeric and mode!='happy' else [f'Art/Happy/{aid}.png'])
            asset=next((p for p in candidates if p in assets),None)
            if asset and asset.startswith('Art/Room/'): fallback.add(aid)
        if not asset: failures.add(aid or f'item {n+1}'); continue
        meta=assets[asset]; group=i.get('sourceType')
        if group is None: group=box['group'] if box else i.get('type',meta['group'])
        if group is None: raise ValueError(f'Không xác định được nhóm: {aid}')
        box_for_group=next((b for b in boxes if b['group']==group),None)
        target=i.get('type',(box_for_group or {}).get('targetType',group))
        w,h=i.get('width'),i.get('height')
        if w is None or h is None:
            s=shape(asset); w,h=s['w'],s['h']; orig=md['roomShapes'].get(aid) if numeric else None
            if orig and mode!='tidy':
                factor=min(orig['w']/w,orig['h']/h); w,h=w*factor,h*factor
            elif mode=='happy':
                factor=md['scales'].get(Path(bg).stem,{}).get(group,1); w,h=w*factor,h*factor
        items.append({'uid':f'i{n+1}','asset':asset,'group':int(group),'targetType':int(target),'layer':n,'x':i.get('x',0),'y':i.get('y',0),'width':w,'height':h,'angle':i.get('angle',0),'scaleX':i.get('scaleX',1),'scaleY':i.get('scaleY',1)})
    if failures: raise ValueError('Thiếu ảnh Unity: '+', '.join(sorted(failures)[:14])+('…' if len(failures)>14 else ''))
    if fallback: warnings.append(f'{len(fallback)} mã đồ dùng ảnh RoomSort dự phòng trong Unity.')
    key=slug(l.get('key') or key_hint or f'{mode}-{l.get("levelName",l.get("level","level"))}')
    name=str(l.get('name') or l.get('levelName') or l.get('level') or key).strip()[:120]
    out={'schema':SCHEMA,'key':key,'name':name,'background':{'asset':selected,'width':bw,'height':bh,'cameraX':l.get('bgPosX',0)},
        'rule':'strict' if l.get('source')=='Happy' or mode=='happy' else 'direct','items':items,'boxes':boxes,
        'origin':{'format':mode,'key':l.get('key') or key_hint,'warnings':warnings}}
    validate(out)
    try: validate(out,True)
    except ValueError as e: warnings.append(str(e))
    return out


def convert_documents(docs, mode):
    levels=[]; rejected=[]; names=set()
    for filename,payload in docs:
        try: candidates=clone_levels(payload)
        except ValueError as e: rejected.append({'file':filename,'error':str(e)}); continue
        for i,l in enumerate(candidates):
            if len(levels)+len(rejected)>=2000: raise ValueError('Mỗi lượt tối đa 2000 màn')
            try:
                hint=(f'{mode}-{Path(filename).stem}-{i+1}' if len(candidates)>1 else slug(Path(filename).stem))
                level=convert_level(l,mode,hint)
                key=level['key']; n=2
                while level['key'] in names: level={**level,'key':key+'-'+str(n)}; n+=1
                names.add(level['key']); levels.append(level)
            except (ValueError,TypeError,KeyError,AttributeError,IndexError,OverflowError) as e:
                label=l.get('key',l.get('name',l.get('levelName',l.get('level',i+1)))) if isinstance(l,dict) else i+1
                rejected.append({'file':filename,'level':str(label)[:120],'error':str(e)})
    return {'schema':'tidy-level-pack/1','levels':levels,'rejected':rejected}


def uploaded(files, mode):
    docs=[]; failed=[]; total=0
    def add(name,blob):
        try: docs.append((name,decode(blob,name)))
        except (ValueError,UnicodeError,OSError,EOFError) as e: failed.append({'file':name,'error':str(e)})
    for entry in files:
        name=str(entry['name'])[:300]; blob=base64.b64decode(entry['data'],validate=True)
        total+=len(blob)
        if total>MAX: raise ValueError('Tổng dung lượng nhập vượt 96 MB')
        if not name.lower().endswith('.zip'): add(name,blob); continue
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                members=[x for x in z.infolist() if not x.is_dir() and x.filename.lower().endswith(('.json','.json.gz'))]
                if len(members)>2000 or sum(m.file_size for m in members)>MAX: raise ValueError('ZIP quá lớn (2000 file / 96 MB)')
                if not members: raise ValueError('ZIP không có file JSON hoặc JSON.GZ')
                for member in members:
                    try: add(member.filename[:300],z.read(member))
                    except (RuntimeError,OSError,zipfile.BadZipFile) as e: failed.append({'file':member.filename[:300],'error':str(e)})
        except (ValueError,zipfile.BadZipFile) as e: failed.append({'file':name,'error':str(e)})
    result=convert_documents(docs,mode); result['rejected']=failed+result['rejected']; return result


def unity_json(l):
    validate(l,True)
    items=sorted(l['items'],key=lambda it:it['layer']); bg=l['background']; lookup=by_path()[0]
    boxes=[]; available=collections.defaultdict(collections.deque)
    for i,o in enumerate(l['boxes']):
        target=o.get('targetType',o['group']); box=1000+i
        boxes.append({'type':target,'sourceType':o['group'],'label':o['label'],'count':o['count'],'box':box})
        available[o['group']].extend([box]*o['count'])
    content=[]
    for n,it in enumerate(items):
        path=it['asset']; asset=lookup[path]; s=shape(path)
        content.append({**{k:it.get(k,1 if k.startswith('scale') else 0) for k in ('x','y','angle','scaleX','scaleY','width','height')},
            'id':asset['id'],'sourceId':asset['id'],'art':path,'uid':n,'type':it.get('targetType',it['group']),'sourceType':it['group'],
            'box':available[it['group']].popleft(), **{k:s[k] for k in ('maskW','maskH','alpha')}})
    return {'key':l['key'],'levelName':l['name'],'name':l['name'],'source':'Happy' if l['rule']=='strict' else 'RoomSort',
        'bg':bg['asset'],'bgSize':[bg['width'],bg['height']],'bgPosX':bg.get('cameraX',0),'coverageMode':'art','blockThreshold':.045,
        'artTheme':'TidyRoom','order':boxes,'content':content,'issues':[],'proof':[]}


def atomic(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    os.replace(tmp,path)


def install(level,root=ROOT):
    data=unity_json(level)
    with install_lock:
        path=root/'index.json'; manifest=read_json(path); entries=manifest['levels']
        base='html5_'+slug(data['key']).replace('-','_'); key=base; n=2
        while any(e['key']==key for e in entries) or (root/f'Levels/{key}.json').exists(): key=f'{base}_{n}'; n+=1
        data['key']=key
        entry={'key':key,'label':f'HTML5 · {level["name"]}','source':data['source'],'file':f'Levels/{key}.json','review':False}
        atomic(root/entry['file'],data)
        try: atomic(path,{**manifest,'levels':[*entries,entry]})
        except OSError:
            (root/entry['file']).unlink(missing_ok=True)
            raise
        return entry


def packed_source(entries):
    documents=[]
    for e in entries:
        name=e['file']; doc=decode((ROOT/name).read_bytes(),name)
        documents.append((name,doc))
    return documents


class Handler(BaseHTTPRequestHandler):
    def output(self,data,mime='application/json; charset=utf-8',status=200):
        self.send_response(status); self.send_header('Content-Type',mime); self.send_header('Content-Length',str(len(data)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store' if mime.startswith(('application/json','text/html','text/javascript')) else 'private, max-age=1800')
        self.end_headers(); self.wfile.write(data)

    def json(self,val,status=200): self.output(json.dumps(val,ensure_ascii=False,separators=(',',':')).encode('utf8'),status=status)

    def dispatch(self,method):
        try:
            host=self.headers.get('Host',''); origin=self.headers.get('Origin')
            if host not in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'} or (origin and origin!=f'http://{host}'):
                self.json({'error':'Chỉ hỗ trợ truy cập localhost cùng origin.'},403); return
            url=urlsplit(self.path); path=unquote(url.path); q=parse_qs(url.query)
            if method=='GET' and path in STATIC:
                p=HERE/STATIC[path]; self.output(p.read_bytes(),(mimetypes.guess_type(p.name)[0] or 'text/plain')+'; charset=utf-8'); return
            if method=='GET' and path.startswith('/asset/'):
                rel=path.removeprefix('/asset/'); pp=PurePosixPath(rel)
                if pp.is_absolute() or '..' in pp.parts or '\\' in rel or not rel.startswith('Art/'): raise ValueError('Đường dẫn ảnh không hợp lệ')
                file=(ROOT/rel).resolve()
                if not file.is_relative_to((ROOT/'Art').resolve()) or file.suffix.lower() not in IMAGE_TYPES or not file.is_file(): self.json({'error':'Không tìm thấy ảnh'},404); return
                self.output(file.read_bytes(),mimetypes.guess_type(file.name)[0]); return
            if method=='GET' and path=='/api/catalog':
                self.json({**catalog(),'placement':placement_catalog(),'unity':str(UNITY),'library':index(),'sources':{k:all(p.is_file() for p in v) for k,v in RAW.items()}}); return
            if method=='GET' and path=='/api/shape':
                key=q.get('asset',[''])[0]
                if key not in by_path()[0]: raise ValueError('Ảnh không có trong catalog')
                self.json(shape(key)); return
            if method=='GET' and path=='/api/library':
                kind=q.get('source',['unity'])[0]; key=q.get('key',[''])[0]
                if kind=='unity':
                    entries=[e for e in index() if not key or e['key']==key]
                    if not entries: raise ValueError('Không thấy màn trong Unity')
                    self.json(convert_documents(packed_source(entries),'auto'))
                elif kind in RAW:
                    self.json(convert_documents([(p.name,read_json(p)) for p in RAW[kind]],'room' if kind=='roomsort' else 'happy'))
                else: raise ValueError('Nguồn không hợp lệ')
                return
            if method=='POST' and path in ('/api/convert','/api/export','/api/install'):
                if self.headers.get_content_type()!='application/json': raise ValueError('Cần gửi application/json')
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=MAX*4//3+1024*1024: raise ValueError('Payload rỗng hoặc quá lớn')
                body=json.loads(self.rfile.read(size))
                if path=='/api/convert': data=uploaded(body['files'],body.get('mode','auto'))
                elif path=='/api/export': data=unity_json(body['level'])
                else: data=install(body['level'])
                self.json(data); return
            self.json({'error':'Không tìm thấy'},404)
        except (ValueError,KeyError,TypeError,AttributeError,IndexError,OSError,zipfile.BadZipFile) as e:
            try: self.json({'error':str(e)},400)
            except (BrokenPipeError,ConnectionResetError): pass

    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',default=37848,type=int); args=parser.parse_args()
    if not (ROOT/'index.json').is_file(): sys.exit(f'Không thấy Unity project: {UNITY}')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Tidy Room Level Tool · http://127.0.0.1:{server.server_port}',flush=True)
    server.serve_forever()
