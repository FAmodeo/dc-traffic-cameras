# CC Opus 5.5 — match each camera to its street, infer travel direction, cut the approach stretch it watches
import json, math, re
from shapely.geometry import LineString, Point, shape
from shapely.ops import linemerge, substring, transform
from shapely.strtree import STRtree

MILE = 1609.344
DIRV = {'N': (0, 1), 'S': (0, -1), 'E': (1, 0), 'W': (-1, 0), 'NE': (.7071, .7071), 'NW': (-.7071, .7071),
        'SE': (.7071, -.7071), 'SW': (-.7071, -.7071)}
ALIAS = {'MA': 'MASSACHUSETTS', 'N CAPITOL': 'NORTH CAPITOL', 'S CAPITOL': 'SOUTH CAPITOL', 'E CAPITOL': 'EAST CAPITOL',
         'MLK': 'MARTIN LUTHER KING JR', 'MLK JR': 'MARTIN LUTHER KING JR', 'MLK JR.': 'MARTIN LUTHER KING JR',
         'MARTIN LUTHER KING': 'MARTIN LUTHER KING JR', 'S DAKOTA': 'SOUTH DAKOTA', 'RI': 'RHODE ISLAND',
         'NY': 'NEW YORK', 'MT. OLIVET': 'MOUNT OLIVET', 'MT OLIVET': 'MOUNT OLIVET', 'W. VIRGINIA': 'WEST VIRGINIA',
         'POTOMAC RIVER': 'I66', 'I-695 OFF': 'I695', 'S CAPITOL RAMP': 'SOUTH CAPITOL', '3RD ST TUNNEL': 'I395'}
WORD = {'ROAD': 'RD', 'DRIVE': 'DR', 'STREET': 'ST', 'TERR': 'TER', 'AVENUE': 'AVE', 'PLACE': 'PL', 'RAMP': None}
TYPES = {'ST', 'AVE', 'RD', 'PL', 'DR', 'BLVD', 'PKWY', 'TER', 'CT', 'CIR', 'LN', 'FWY', 'WAY', 'SQ', 'BRG', 'XING'}
# Approach length upstream of the camera and run-out past it, in metres (approximate enforcement zone)
REACH = {'spd': (150, 30), 'red': (90, 10), 'stp': (90, 10)}
OFFSET = 0.0   # bands sit on the centreline; direction is carried by the arrow


def parse(desc):
    d = re.sub(r'\s+', ' ', desc.upper().strip())
    m = re.search(r'\b(NE|NW|SE|SW|N|S|E|W)/B\b', d)
    direction = m.group(1) if m else None
    d = re.sub(r'\s*\b(NE|NW|SE|SW|N|S|E|W)/B\b', '', d)
    main = d.split('@')[0]
    main = re.sub(r'^\s*(\d+|UNIT)\s+BLK\s+', '', main)
    main = re.sub(r'\(WZ\)', '', main)
    main = ' '.join(WORD.get(w, w) or '' for w in main.split()).strip()
    main = re.split(r'\b(?:BY|BEFORE|AT|S/O|N/O|E/O|W/O|EXIT)\b|\s\.?\d+(?:\.\d+)?\s+MILES?', main)[0].strip()
    words = main.split()
    quad = words.pop() if words and words[-1] in ('NW', 'NE', 'SE', 'SW') else None
    stype = words.pop() if words and words[-1] in TYPES else None
    name = ' '.join(words)
    name = ALIAS.get(name, name)
    return dict(dir=direction, name=name, stype=stype, quad=quad)


def name_ok(p, props):
    rn = (props.get('ROUTENAME') or '').upper()
    if not p['name']: return False
    if p['name'] == 'DC295': return any(k in rn for k in ('295', 'KENILWORTH AVE', 'ANACOSTIA FWY'))
    for key, tag in (('I395', '395'), ('I695', '695'), ('I66', 'INTERSTATE 66')):
        if p['name'] == key: return tag in rn
    sn = (props.get('STREETNAME') or '').upper()
    st = (props.get('STREETTYPE') or '').upper()
    return sn == p['name'] and (p['stype'] is None or st == p['stype'] or p['stype'] == 'RAMP')


class Snapper:
    def __init__(self, streets_path, proj):
        self.proj = proj                      # (lon, lat) -> metres east, north of the Capitol
        feats = json.load(open(streets_path))['features']
        self.props, self.geoms = [], []
        for f in feats:
            if not f['geometry']: continue
            g = transform(lambda x, y, z=None: proj(x, y), shape(f['geometry']))
            for part in getattr(g, 'geoms', [g]):
                self.props.append(f['properties']); self.geoms.append(part)
        self.tree = STRtree(self.geoms)
        self.by_route = {}
        for i, p in enumerate(self.props): self.by_route.setdefault(p.get('ROUTENAME'), []).append(i)
        self._merged = {}

    def merged(self, route):
        if route not in self._merged:
            m = linemerge([self.geoms[i] for i in self.by_route[route]])
            self._merged[route] = list(getattr(m, 'geoms', [m]))
        return self._merged[route]

    def snap(self, lon, lat, desc, kind):
        pt = Point(self.proj(lon, lat))
        p = parse(desc)
        cand = self.tree.query(pt.buffer(80))
        best = None
        for i in cand:
            dist = self.geoms[i].distance(pt)
            ok = name_ok(p, self.props[i])
            score = dist + (0 if ok else 60)
            if best is None or score < best[0]: best = (score, i, dist, ok)
        out = dict(parsed=p, matched=False, dist=None, route=None, ambiguous=False, seg_limit=None, stretch=None)
        if best is None: return out
        _, i, dist, ok = best
        props = self.props[i]
        out.update(matched=ok, dist=round(dist, 1), route=props.get('ROUTENAME'),
                   seg_limit=sorted({v for v in (props.get('SPEEDLIMITS_IB'), props.get('SPEEDLIMITS_OB')) if v}))
        line = min(self.merged(props.get('ROUTENAME')), key=lambda g: g.distance(pt))
        s0 = line.project(pt)
        a, b = line.interpolate(max(0, s0 - 8)), line.interpolate(min(line.length, s0 + 8))
        tx, ty = b.x - a.x, b.y - a.y
        n = math.hypot(tx, ty) or 1
        tx, ty = tx / n, ty / n
        if p['dir']:
            dx, dy = DIRV[p['dir']]
            dot = tx * dx + ty * dy
            out['ambiguous'] = abs(dot) < 0.35
            sign = 1 if dot >= 0 else -1
        else:
            sign, out['ambiguous'] = 1, True
        up, down = REACH[kind]
        if sign > 0: seg = substring(line, max(0, s0 - up), min(line.length, s0 + down))
        else: seg = LineString(list(substring(line, max(0, s0 - down), min(line.length, s0 + up)).coords)[::-1])
        if seg.length < 5: return out
        off = seg.offset_curve(-OFFSET, join_style='round') if OFFSET else seg   # negative = right of travel
        if off.is_empty or off.geom_type != 'LineString': off = seg
        out['stretch'] = list(off.coords)
        out['snapped'] = (line.interpolate(s0).x, line.interpolate(s0).y)
        return out
