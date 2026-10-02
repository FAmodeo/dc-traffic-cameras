# Build the DC traffic-camera map page from the snapshot in ../data
import json, math, re, sys, pathlib, datetime as dt
import pandas as pd
from shapely.geometry import shape
from shapely.ops import linemerge
from snap import Snapper, MILE

HERE = pathlib.Path(__file__).resolve().parent
DATA, BASE = HERE.parent / 'data', HERE.parent / 'data' / 'basemap'
OUT = HERE.parent / 'docs' / 'index.html'
SITE = json.load(open(HERE.parent / 'site.json'))   # tip link, public URL, repo URL

# Local equirectangular projection centred on the US Capitol; 100 user units = 1 mile
LAT0, LON0 = 38.88990, -77.00906
KX, KY, U = 69.172 * math.cos(math.radians(LAT0)), 69.0, 100


def P(lon, lat):
    return (lon - LON0) * KX * U, -(lat - LAT0) * KY * U


def ring_d(coords, closed, nd=0):
    pts, last = [], None
    for lon, lat, *_ in coords:
        x, y = P(lon, lat)
        q = (round(x, nd), round(y, nd))
        if q != last: pts.append(q); last = q
    if len(pts) < 2: return ''
    fmt = (lambda v: f'{v:g}') if nd else (lambda v: str(int(v)))
    s = 'M' + ' L'.join(f'{fmt(a)} {fmt(b)}' for a, b in pts)
    return s + ('Z' if closed else '')


def geom_d(g, nd=0):
    t, c = g['type'], g['coordinates']
    if t == 'LineString': return ring_d(c, False, nd)
    if t == 'MultiLineString': return ''.join(ring_d(l, False, nd) for l in c)
    if t == 'Polygon': return ''.join(ring_d(r, True, nd) for r in c)
    if t == 'MultiPolygon': return ''.join(ring_d(r, True, nd) for p in c for r in p)
    return ''


def area_sqmi(g):
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    tot = 0
    for p in polys:
        r = [P(*pt[:2]) for pt in p[0]]
        tot += abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]))) / 2
    return tot / U ** 2


load = lambda n: json.load(open(BASE / n))['features']

# ---------- basemap ----------
boundary = ''.join(geom_d(f['geometry']) for f in load('boundary.geojson'))
roads = {k: [] for k in ('fwy', 'art', 'min')}
for f in load('roads.geojson'):
    c = f['properties']['FHWAFUNCTIONALCLASS']
    roads['fwy' if c <= 2 else 'art' if c == 3 else 'min'].append(geom_d(f['geometry'], 1))   # 0.1 unit = 1.6 m, so bands sit on the line
water = ''.join(geom_d(f['geometry']) for f in load('water.geojson')
                if f['properties']['DESCRIPTION'] in ('River', 'Lake') or area_sqmi(f['geometry']) > 0.004)
parks = ''.join(geom_d(f['geometry']) for f in load('parks.geojson') if area_sqmi(f['geometry']) > 0.03)
local = ''.join(geom_d(f['geometry'], 1) for f in load('streets_all.geojson') if (f['properties']['FHWAFUNCTIONALCLASS'] or 7) > 4)
inset_water = ''.join(geom_d(f['geometry'], 1) for f in load('water.geojson'))
inset_parks = ''.join(geom_d(f['geometry'], 1) for f in load('parks.geojson'))

# ---------- cameras ----------
cams = pd.DataFrame([f['properties'] for f in json.load(open(DATA / 'cameras.geojson'))['features']])
cams = cams[cams.ENFORCEMENT_TYPE != 'Truck Restriction'].reset_index(drop=True)   # out of scope: trucks only
tab = pd.read_csv(DATA / 'cameras_table.csv', usecols=['ENFORCEMENT_SPACE_CODE', 'START_DATE', 'ENFORCEMENT_TYPE', 'CAMERA_LATITUDE'])
tab['START_DATE'] = pd.to_datetime(tab.START_DATE, unit='ms')
cams = cams.merge(tab[['ENFORCEMENT_SPACE_CODE', 'START_DATE']], on='ENFORCEMENT_SPACE_CODE', how='left')
unmapped = tab[tab.CAMERA_LATITUDE.isna()].ENFORCEMENT_TYPE.value_counts().to_dict()

mon = pd.read_csv(DATA / 'tickets_monthly.csv')
last_record = pd.to_datetime(mon.LAST_RECORD).max()
w_end = last_record.to_period('M')                     # current (partial) month excluded
w_months = [str(w_end - i) for i in range(12, 0, -1)]  # 12 complete months
fines = mon[mon.YEAR_MONTH.isin(w_months) & (mon.CAMERA_STATUS == 'Live')]   # status is recorded per month; warning/idle/test months are not fines
t12 = fines.groupby('ENFORCEMENT_SPACE_CODE').NUM_VIOLATIONS.sum()
cams['t12'] = cams.ENFORCEMENT_SPACE_CODE.map(t12)

DIRS = {'N': 'northbound', 'S': 'southbound', 'E': 'eastbound', 'W': 'westbound', 'NE': 'northeast-bound',
        'NW': 'northwest-bound', 'SE': 'southeast-bound', 'SW': 'southwest-bound'}
KEEP = {'NW', 'NE', 'SE', 'SW', 'DC295', 'I', 'US', 'BW', 'I-295', 'I-695', 'I-395'}


def pretty(s):
    s = re.sub(r'\s+', ' ', s.strip())
    m = re.search(r'\b(N|S|E|W|NE|NW|SE|SW)/B\b', s, re.I)
    d = DIRS[m.group(1).upper()] if m else ''
    s = re.sub(r'\s*\b(N|S|E|W|NE|NW|SE|SW)/B\b', '', s, flags=re.I)
    words = []
    for wd in s.split(' '):
        up = wd.upper()
        if up in KEEP or re.fullmatch(r'[A-Z]?\d+[A-Z]*', up) and not re.fullmatch(r'\d+(ST|ND|RD|TH)', up): words.append(up)
        elif up == 'BLK': words.append('block')
        elif up in ('@', '&'): words.append('at')
        elif up in ('S/O', 'N/O', 'E/O', 'W/O'): words.append({'S': 'south of', 'N': 'north of', 'E': 'east of', 'W': 'west of'}[up[0]])
        elif re.fullmatch(r'\d+(ST|ND|RD|TH)', up): words.append(wd.lower())
        elif len(up) == 1 and up.isalpha(): words.append(up)
        elif up.startswith('MAC'): words.append('Mac' + up[3:].capitalize())
        else: words.append(wd.capitalize())
    out = ' '.join(words).replace('Unit block', 'Unit block')
    return out + (f', {d}' if d else '')


TYPE = {'Speed': 'spd', 'Red Light': 'red', 'Stop Sign': 'stp'}
snapper = Snapper(BASE / 'streets_all.geojson', lambda lon, lat: ((lon - LON0) * KX * MILE, (lat - LAT0) * KY * MILE))
M2U = U / MILE   # metres -> map units
STAT = {'Live': 'live', 'Warning': 'warn'}   # anything else (Configuration, Test, Idle) = not yet live
recs = []
for r in cams.itertuples():
    x, y = P(r.CAMERA_LONGITUDE, r.CAMERA_LATITUDE)
    sn = snapper.snap(r.CAMERA_LONGITUDE, r.CAMERA_LATITUDE, r.LOCATION_DESCRIPTION, TYPE[r.ENFORCEMENT_TYPE])
    st = [[round(a * M2U, 1), round(-b * M2U, 1)] for a, b in sn['stretch']] if sn['matched'] and sn['stretch'] else None
    if st and sn.get('snapped') and (sn['dist'] or 0) <= 30: x, y = sn['snapped'][0] * M2U, -sn['snapped'][1] * M2U   # pole position -> street centreline
    recs.append(dict(id=r.ENFORCEMENT_SPACE_CODE, x=round(x, 1), y=round(y, 1), t=TYPE[r.ENFORCEMENT_TYPE],
                     s=STAT.get(r.CAMERA_STATUS, 'soon'), raw=r.CAMERA_STATUS, lim=int(r.SPEED_LIMIT) if pd.notna(r.SPEED_LIMIT) else None,
                     loc=pretty(r.LOCATION_DESCRIPTION), n=int(r.t12) if pd.notna(r.t12) else None,
                     since=r.START_DATE.strftime('%Y-%m-%d') if pd.notna(r.START_DATE) else None,
                     port=r.DEVICE_MOBILITY == 'Portable', ward=r.WARD, d=round(math.hypot(x, y) / U, 2), st=st,
                     off=not sn['matched'] or (sn['dist'] or 0) > 30))
recs.sort(key=lambda c: c['d'])

# ---------- citywide figures for the landing screen ----------
FLOOR = {'Speed': 100, 'Red Light': 150, 'Stop Sign': 100}   # lowest fine per type (DDOT StreetSafe FAQ)
ids = set(cams.ENFORCEMENT_SPACE_CODE)
f12 = fines[fines.ENFORCEMENT_SPACE_CODE.isin(ids)]
by_type = f12.groupby('ENFORCEMENT_TYPE').NUM_VIOLATIONS.sum()
total = float(by_type.sum())
per_cam = f12.groupby('ENFORCEMENT_SPACE_CODE').NUM_VIOLATIONS.sum().sort_values(ascending=False)
live_all = mon[mon.ENFORCEMENT_SPACE_CODE.isin(ids) & (mon.CAMERA_STATUS == 'Live')]
monthly = live_all.groupby('YEAR_MONTH').NUM_VIOLATIONS.sum()
monthly = monthly[monthly.index < str(w_end)].tail(20)          # complete months only
stats = dict(fines=int(total), sec=round(365.25 * 86400 / total, 1), usd=int(sum(by_type.get(k, 0) * v for k, v in FLOOR.items())),
             by_type={TYPE[k]: int(v) for k, v in by_type.items()}, top10=round(float(per_cam.head(10).sum()) / total, 3),
             cams_fining=int((per_cam > 0).sum()), median=int(per_cam.median()),
             monthly=[[k, int(v)] for k, v in monthly.items()],
             warnings=int(mon[mon.YEAR_MONTH.isin(w_months) & mon.ENFORCEMENT_SPACE_CODE.isin(ids) & (mon.CAMERA_STATUS == 'Warning')].NUM_VIOLATIONS.sum()))

fetched = dt.date.fromisoformat(json.load(open(DATA / 'fetched.json'))['fetched'])
meta = dict(asof=fetched.strftime('%-d %b %Y'), asof_iso=fetched.isoformat(), last_record=last_record.strftime('%-d %b %Y'),
            window=f"{pd.Period(w_months[0]).strftime('%b %Y')} – {pd.Period(w_months[-1]).strftime('%b %Y')}",
            unmapped=unmapped, maxd=max(c['d'] for c in recs), stats=stats, site=SITE)

# Orientation labels (approximate centroids) — [lon, lat, text, kind]
LABELS = [(-77.0365, 38.8977, 'White House', 'poi'), (-77.0064, 38.8973, 'Union Station', 'poi'),
          (-77.0074, 38.8730, 'Nationals Park', 'poi'), (-77.0501, 38.8893, 'Lincoln Memorial', 'poi'),
          (-77.0650, 38.9070, 'Georgetown', 'hood'), (-77.0325, 38.9290, 'Columbia Heights', 'hood'),
          (-76.9945, 38.9330, 'Brookland', 'hood'), (-77.0800, 38.9480, 'Tenleytown', 'hood'),
          (-77.0235, 38.9425, 'Petworth', 'hood'), (-77.0180, 38.9740, 'Takoma', 'hood'),
          (-76.9870, 38.8625, 'Anacostia', 'hood'), (-76.9990, 38.8430, 'Congress Heights', 'hood'),
          (-76.9350, 38.9080, 'Deanwood', 'hood'), (-77.0890, 38.9280, 'Palisades', 'hood'),
          (-76.9700, 38.9150, 'Arboretum', 'hood'), (-77.0495, 38.9600, 'Rock Creek Park', 'park'),
          (-77.0520, 38.8700, 'Potomac River', 'water'), (-76.9780, 38.8770, 'Anacostia River', 'water'),
          (-76.9530, 38.8700, 'Hillcrest', 'hood')]


def place(x, y, text, pts):
    """Nudge a map label to the nearby spot that covers the fewest cameras (box sized for the full-city view)."""
    w, h = len(text) * 9.5 / 2 + 6, 11
    best = None
    for dx in range(-45, 46, 15):
        for dy in range(-36, 37, 12):
            cx, cy = x + dx, y + dy
            hit = sum(1 for px, py in pts if abs(px - cx) < w and abs(py - cy) < h)
            score = hit + 0.004 * (dx * dx + dy * dy) ** 0.5
            if best is None or score < best[0]: best = (score, cx, cy)
    return round(best[1], 1), round(best[2], 1)


hood_pts = sorted(({'n': f['properties']['NAME'], 'x': round(P(*f['geometry']['coordinates'][:2])[0], 1),
                    'y': round(P(*f['geometry']['coordinates'][:2])[1], 1)} for f in load('neighborhood_labels.geojson')),
                  key=lambda h: h['n'])
official = {h['n']: h for h in hood_pts}
for c in recs: c['hood'] = min(hood_pts, key=lambda h: (h['x'] - c['x']) ** 2 + (h['y'] - c['y']) ** 2)['n']
ALIAS_HOOD = {'Anacostia': 'Historic Anacostia'}
for i, (lon, lat, t, k) in enumerate(LABELS):
    h = official.get(ALIAS_HOOD.get(t, t))
    if k == 'hood' and h: LABELS[i] = (h['x'], h['y'], t, 'hood*')

# street-name anchors: every ~0.35 mi along each arterial, with the text angle
anchors = []
by_route = {}
for f in load('streets_all.geojson'):
    pr = f['properties']
    sn_, stp_ = (pr.get('STREETNAME') or '').title(), (pr.get('STREETTYPE') or '').title()
    if not sn_ or not f['geometry'] or (pr['FHWAFUNCTIONALCLASS'] or 7) <= 1: continue
    nm = sn_ if not stp_ or sn_.endswith(' ' + stp_) else f'{sn_} {stp_}'
    nm = re.sub(r'\bAnd\b', 'and', nm)
    minor = int((pr['FHWAFUNCTIONALCLASS'] or 7) > 4)
    g = shape(f['geometry'])
    by_route.setdefault((nm, minor), []).extend(getattr(g, 'geoms', [g]))
for (nm, minor), parts in by_route.items():
    nm = re.sub(r'^(\d+)(St|Nd|Rd|Th) ', lambda m: m.group(1) + m.group(2).lower() + ' ', nm)
    nm = nm.replace('Martin Luther King Jr Ave', 'MLK Jr Ave').replace('North Capitol', 'N Capitol').replace('South Capitol', 'S Capitol').replace('East Capitol', 'E Capitol')
    m = linemerge(parts)
    for line in getattr(m, 'geoms', [m]):
        pl = [P(x, y) for x, y, *_ in line.coords]
        L = sum(math.dist(a, b) for a, b in zip(pl, pl[1:]))
        if L < (5 if minor else 12): continue
        step = 18 if minor else 35
        acc, nxt = 0, step / 2
        for a, b in zip(pl, pl[1:]):
            seg = math.dist(a, b)
            while seg and acc + seg >= nxt:
                t = (nxt - acc) / seg
                ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
                ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
                anchors.append([round(a[0] + t * (b[0] - a[0]), 1), round(a[1] + t * (b[1] - a[1]), 1), round(ang), nm, minor])
                nxt += step
            acc += seg

pts = [(c['x'], c['y']) for c in recs]
labels = []
for a_, b_, t, k in LABELS:
    if k == 'hood*': x, y, k = *place(a_, b_, t, pts), 'hood'
    elif k in ('hood', 'park'): x, y = place(*P(a_, b_), t, pts)
    else: x, y = round(P(a_, b_)[0], 1), round(P(a_, b_)[1], 1)
    labels.append(dict(x=x, y=y, t=t, k=k))
STREETS = [(-76.9905, 38.88985, 'E Capitol St', 0), (-76.9905, 38.90005, 'H St NE', 0),
           (-76.9950, 38.87665, 'M St SE', 0), (-77.00906, 38.9040, 'N Capitol St', -90),
           (-77.0095, 38.8820, 'S Capitol St', -90), (-77.0235, 38.8880, 'Independence Ave SW', 0),
           (-76.9790, 38.8960, '17th St NE', -90)]
streets = [dict(x=round(P(a, b)[0], 1), y=round(P(a, b)[1], 1), t=t, r=r) for a, b, t, r in STREETS]
INSET_POI = [(-77.0064, 38.8973, 'Union Station'), (-76.9960, 38.8840, 'Eastern Market'),
             (-76.9935, 38.8912, 'Lincoln Park'), (-77.0074, 38.8752, 'Nationals Park'),
             (-77.0045, 38.8870, 'Library of Congress'), (-77.0220, 38.8895, 'National Mall'),
             (-77.0365, 38.8977, 'White House'), (-77.0501, 38.8893, 'Lincoln Memorial'), (-77.0353, 38.8895, 'Washington Monument'),
             (-77.0195, 38.8981, 'Capital One Arena'), (-77.0235, 38.9030, 'Convention Center'), (-77.0218, 38.9227, 'Howard University'),
             (-76.9988, 38.9332, 'Catholic University'), (-77.0752, 38.9076, 'Georgetown University'), (-77.0498, 38.9001, 'GWU'),
             (-77.0726, 38.9306, 'National Cathedral'), (-77.0498, 38.9296, 'National Zoo'), (-76.9719, 38.8899, 'RFK Campus'),
             (-77.0229, 38.8790, 'The Wharf'), (-76.9680, 38.9120, 'National Arboretum'), (-77.0435, 38.9097, 'Dupont Circle'),
             (-77.0298, 38.9095, 'Logan Circle'), (-77.0316, 38.9028, 'Franklin Square'), (-77.0003, 38.8762, 'Navy Yard Metro')]
inset_poi = [dict(x=round(P(a, b)[0], 1), y=round(P(a, b)[1], 1), t=t) for a, b, t in INSET_POI]

payload = dict(cams=recs, meta=meta, labels=labels, streets=streets, poi=inset_poi, hoods=hood_pts, anchors=anchors)
basemap = dict(boundary=boundary, water=water, parks=parks, fwy=''.join(roads['fwy']), art=''.join(roads['art']),
               min=''.join(roads['min']), local=local,
               iwater=inset_water, iparks=inset_parks)

problems = []
if len(recs) < 200: problems.append(f'only {len(recs)} cameras')
if (fetched - last_record.date()).days > 80: problems.append(f'ticket data stale: last record {last_record.date()}')
if sum(1 for c in recs if c['st']) < 0.85 * len(recs): problems.append('fewer than 85% of cameras matched to a street')
if not 1e6 < total < 1e7: problems.append(f'implausible 12-month fines: {total:,.0f}')
if problems: sys.exit('build refused: ' + '; '.join(problems))
OUT.parent.mkdir(exist_ok=True)
tpl = open(HERE / 'template.html').read().replace('/*__SCRIPT__*/', open(HERE / 'page.js').read())
page = tpl.replace('/*__DATA__*/null', json.dumps(payload, separators=(',', ':'))) \
          .replace('/*__BASEMAP__*/null', json.dumps(basemap, separators=(',', ':')))
page = page.replace('__OG_IMAGE__', (SITE['site_url'].rstrip('/') + '/' if SITE['site_url'] else '') + 'og-card.png')
# public site: a complete HTML document; artifact copy: the bare fragment (the artifact host adds its own skeleton)
GF = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]+">')
assert GF.search(page), 'font links not found'
public = GF.sub('<link rel="stylesheet" href="fonts/fonts.css">', page)   # self-hosted fonts: no third-party requests
OUT.write_text('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
               '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n'
               '</head>\n<body>\n' + public + '\n</body>\n</html>\n')
if '--artifact' in sys.argv: (HERE.parent / 'dc_traffic_cameras.html').write_text(page)   # private preview copy only
print(f'{OUT.name}: {len(page)/1e6:.2f} MB, {len(recs)} cameras, max distance {meta["maxd"]} mi, window {meta["window"]}')
print('unmapped', unmapped, '| last record', meta['last_record'], '| fines 12m', f"{stats['fines']:,}", '| every', stats['sec'], 's | floor $', f"{stats['usd']:,}")
