"""Rebuild the bundled sources and artwork. Opening index.html needs no Python."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
from shutil import copy2
from statistics import median

from PIL import Image

import server as legacy

HERE = Path(__file__).resolve().parent
SOURCE = legacy.UNITY / 'Tools/Source/room.json'
ASSETS = legacy.OLD / 'RoomSort/analysis/www/assets'
ART = 'Art/RoomSortOffline'


def write_script(name, variable, data):
    target = HERE / 'data' / name
    target.parent.mkdir(exist_ok=True)
    temp = target.with_suffix('.tmp')
    temp.write_text(f'window.{variable} = ' + json.dumps(data, ensure_ascii=False, separators=(',',':')) + ';\n', encoding='utf-8')
    temp.replace(target)


def packed_alpha(image):
    a = image.convert('RGBA').getchannel('A')
    a.thumbnail((40, 40))
    bits = bytearray((a.width * a.height + 7) // 8)
    for i, value in enumerate(a.tobytes()):
        if value > 32:
            bits[i // 8] |= 1 << (i % 8)
    return {'maskW': a.width, 'maskH': a.height, 'bits': base64.b64encode(bits).decode('ascii')}


def prepare_image(job):
    row, source, copy = job
    with Image.open(source) as im:
        output = HERE / row['path']
        if copy:
            if not output.exists() or output.stat().st_mtime < source.stat().st_mtime:
                output.parent.mkdir(parents=True, exist_ok=True)
                if row['path'].endswith('.png'):
                    im.convert('RGBA').save(output, compress_level=4)
                else:
                    im.convert('RGB').save(output, quality=95, subsampling=0)
        else:
            bundle_file(row['path'])
        row['w'], row['h'] = im.size
        if 'group' in row:
            row.update(packed_alpha(im))
    return row


def bundle_file(path):
    source = legacy.ROOT / path
    output = HERE / path
    if not output.exists() or output.stat().st_mtime < source.stat().st_mtime:
        output.parent.mkdir(parents=True, exist_ok=True)
        copy2(source, output)
    return path


def main():
    source = legacy.read_json(SOURCE)
    cat = legacy.catalog()
    old = legacy.metadata()
    english_names = legacy.optional(ASSETS / 'i18n/system/en.json')
    room_groups = {}
    jobs = []
    missing = []
    for item, file in source['itemFiles'].items():
        path = ASSETS / file
        if not path.is_file():
            missing.append(item)
            continue
        group = int(re.match(r'^\d+', item).group())
        key = f'type.{group}'
        label = source['translations'].get(key) or old['names'].get(group) or english_names.get(key) or f'Nhóm {group}'
        room_groups[group] = label
        shape = source['shapes'][item]
        row = {'path':f'{ART}/Items/{item}.png','id':item,'family':'room','group':group,'label':label,
               'native':[shape['w'],shape['h']], 'palette':True}
        jobs.append((row,path,True))
    levels = source['levels']
    names = {Path(str(l.get('bgFile') or l.get('bg',''))).stem:l.get('name','') for l in levels}
    for key, file in source['backgrounds'].items():
        asset = Path(key).stem
        label = source['translations'].get(names.get(asset),names.get(asset,asset.replace('-', ' ')))
        row = {'path':f'{ART}/Rooms/{asset}.jpg','id':asset,'family':'room','label':f'{label} · {asset}' if label != asset else asset,'palette':True}
        jobs.append((row,ASSETS/file,True))
    total_room = len(jobs)-len(source['backgrounds'])
    for row in [*cat['items'], *cat['backgrounds']]:
        # Keep the Unity-relative paths and bundle the corresponding files.
        path = legacy.ROOT / row['path']
        jobs.append((row,path,False))
    print(f'Preparing {total_room} RoomSort sprites and {len(source["backgrounds"])} RoomSort backgrounds.',flush=True)
    with ThreadPoolExecutor(max_workers=9) as workers:
        rows = list(workers.map(prepare_image,jobs))
    items = [r for r in rows if 'group' in r]
    backgrounds = [r for r in rows if 'group' not in r]
    by_room = {r['id']:r for r in items if r.get('palette')}
    scales = {}
    for level in levels:
        bg = Path(str(level.get('bgFile') or level.get('bg',''))).stem
        for it in level['content']:
            if it['id'] not in by_room:
                raise ValueError(f'Built-in RoomSort level has missing art: {it["id"]}')
            scales.setdefault(it['id'],{}).setdefault(bg,[]).append([abs(it.get('scaleX',1)),abs(it.get('scaleY',1))])
    for item, rooms in scales.items():
        by_room[item]['roomScale'] = {bg:[median(p[0] for p in pairs),median(p[1] for p in pairs)] for bg,pairs in rooms.items()}
    ui = {key:bundle_file(path) for key,path in cat['ui'].items()}
    write_script('catalog.js','TIDY_CATALOG',{'items':items,'backgrounds':backgrounds,'roomGroups':room_groups,'ui':ui,
        'missingRoomSprites':missing,'placement':legacy.placement_catalog(),'legend':old['legend']})
    unity_entries = legacy.index()
    saved_unity = []
    for entry in unity_entries:
        filename = entry['file']
        data = legacy.decode((legacy.ROOT/filename).read_bytes(),filename)
        # A compact snapshot is enough to edit and playtest. Masks already live in the catalog.
        for it in data['content']:
            for field in ('alpha','poly','reference','maskW','maskH'):
                it.pop(field,None)
        saved_unity.append({'entry':entry,'level':data})
    happy = next((legacy.read_json(p) for p in legacy.RAW['happy'] if p.is_file()),[])
    write_script('levels.js','TIDY_LEVELS',{'roomsort':levels,'unity':saved_unity,'happy':happy})
    print(f'Packed {len(levels)} RoomSort, {len(happy)} Happy, {len(unity_entries)} Unity levels. {len(missing)} RoomSort catalog IDs lacked an image in the source dump.',flush=True)


if __name__ == '__main__':
    main()
