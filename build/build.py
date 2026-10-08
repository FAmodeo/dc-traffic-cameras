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
# hand-checked corrections (data/corrections.csv): 'move' fixes coordinates where DDOT's own description and position disagree;
# 'include' shows a camera of a type otherwise left out. 'credit' thanks whoever reported it (first name + initial, or 'a visitor').
COR = pd.read_csv(DATA / 'corrections.csv', dtype=str).fillna('') if (DATA / 'corrections.csv').exists() else pd.DataFrame(columns=['camera_id', 'action', 'lat', 'lon', 'credit'])
for col in ('type', 'location', 'ward'): COR[col] = COR[col] if col in COR else ''
INCLUDE = set(COR[COR.action == 'include'].camera_id)
cams = cams[(cams.ENFORCEMENT_TYPE != 'Truck Restriction') | cams.ENFORCEMENT_SPACE_CODE.isin(INCLUDE)].reset_index(drop=True)   # trucks only where included
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
by_month = fines.groupby(['ENFORCEMENT_SPACE_CODE', 'YEAR_MONTH']).NUM_VIOLATIONS.sum()   # per-camera monthly series
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


for o in COR[COR.action == 'move'].itertuples():
    cams.loc[cams.ENFORCEMENT_SPACE_CODE == o.camera_id, ['CAMERA_LATITUDE', 'CAMERA_LONGITUDE']] = [float(o.lat), float(o.lon)]
FIX = {o.camera_id: dict(a=o.action, by=o.credit) for o in COR.itertuples()}

TYPE = {'Speed': 'spd', 'Red Light': 'red', 'Stop Sign': 'stp', 'Truck Restriction': 'trk'}
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
                     m=[int(by_month.get((r.ENFORCEMENT_SPACE_CODE, mo), 0)) for mo in w_months],
                     since=r.START_DATE.strftime('%Y-%m-%d') if pd.notna(r.START_DATE) else None,
                     port=r.DEVICE_MOBILITY == 'Portable', ward=r.WARD, d=round(math.hypot(x, y) / U, 2), st=st,
                     off=not sn['matched'] or (sn['dist'] or 0) > 30, fix=FIX.get(r.ENFORCEMENT_SPACE_CODE)))
# 'report': a camera several visitors describe that DDOT does not list (yet); shown dashed yellow as under verification,
# with no ticket figures and outside every total
for o in COR[COR.action == 'report'].itertuples():
    t = {'speed': 'spd', 'red light': 'red', 'stop sign': 'stp'}.get(o.type.lower(), 'stp')
    lon, lat = float(o.lon), float(o.lat); x, y = P(lon, lat)
    sn = snapper.snap(lon, lat, o.location, t)
    st = [[round(a * M2U, 1), round(-b * M2U, 1)] for a, b in sn['stretch']] if sn['matched'] and sn['stretch'] else None
    if st and sn.get('snapped') and (sn['dist'] or 0) <= 30: x, y = sn['snapped'][0] * M2U, -sn['snapped'][1] * M2U
    recs.append(dict(id=o.camera_id, x=round(x, 1), y=round(y, 1), t=t, s='unv', raw='Reported', lim=None, loc=pretty(o.location), n=None,
                     m=[0] * len(w_months), since=None, port=False, ward=o.ward, d=round(math.hypot(x, y) / U, 2), st=st,
                     off=not sn['matched'], fix=dict(a='report', by=o.credit)))
recs.sort(key=lambda c: c['d'])
NL = sum(1 for c in recs if c['s'] != 'unv')   # cameras in DDOT's data

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
            months=w_months, window=f"{pd.Period(w_months[0]).strftime('%b %Y')} – {pd.Period(w_months[-1]).strftime('%b %Y')}",
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
for c in recs:   # reported cameras without a ward take the ward of the nearest listed camera
    if not c['ward']: c['ward'] = min((o for o in recs if o['ward']), key=lambda o: (o['x'] - c['x']) ** 2 + (o['y'] - c['y']) ** 2)['ward']
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
page = page.replace('__SITE_URL__', SITE['site_url'])
page = page.replace('<!--__GSV__-->', f'<meta name="google-site-verification" content="{SITE["google_verification"]}">' if SITE.get('google_verification') else '')
page = page.replace('__OG_IMAGE__', (SITE['site_url'].rstrip('/') + '/' if SITE['site_url'] else '') + 'og-card.png')
# public site: a complete HTML document; artifact copy: the bare fragment (the artifact host adds its own skeleton)
GF = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]+">')
assert GF.search(page), 'font links not found'
public = GF.sub('<link rel="stylesheet" href="fonts/fonts.css">', page)   # self-hosted fonts: no third-party requests
head, rest = public[:public.index('<style>')], public[public.index('<style>'):]   # title, meta, icons and font link belong in <head>
OUT.write_text('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
               '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n'
               + head + '</head>\n<body>\n' + rest + '\n</body>\n</html>\n')
# one small page per camera: real content for search engines and link previews. A shared link carries #map and sends
# people straight to the camera on the map; without it (search visitors) the page shows the camera's own numbers.
import html as _h, shutil, math as _m
CDIR = OUT.parent / 'c'; shutil.rmtree(CDIR, ignore_errors=True); CDIR.mkdir()
site = SITE['site_url'].rstrip('/') + '/' if SITE['site_url'] else ''
ranked = sorted((c for c in recs if c['n']), key=lambda c: -c['n']); rank = {c['id']: i + 1 for i, c in enumerate(ranked)}
def pace(n):
    m = 365.25 * 1440 / n
    return f'{max(1, round(m))} min' if m < 60 else f'{round(m / 60)} h' if m < 2880 else f'{round(m / 1440)} days'
KIND = {'spd': 'Speed camera', 'red': 'Red-light camera', 'stp': 'Stop-sign camera', 'trk': 'Truck-restriction camera'}
FINE = {'spd': '$100 for 11–15 mph over, rising to $150, $200 and $400–500 above that', 'red': '$150', 'stp': '$100', 'trk': 'see DDOT'}
STATUS = {'live': 'Fining', 'warn': 'Warning period (warnings only)', 'soon': 'Not live yet', 'unv': 'Reported by visitors, under verification (not in DDOT data yet)'}
MON = lambda ym: dt.date(int(ym[:4]), int(ym[5:]), 1).strftime('%b %Y')
slugof = lambda c: c['id'].replace(' ', '').lower()
E = _h.escape
GC = SITE.get('goatcounter', '')
CSS = (':root{--bg:#f3f4f5;--land:#fff;--ink:#111418;--ink-2:#4a5159;--muted:#666e77;--hair:#dde0e3;--spd:#226ac2;--red:#c2491a;color-scheme:light dark}'
       '@media (prefers-color-scheme:dark){:root{--bg:#0f1113;--land:#1a1c1f;--ink:#f2f4f5;--ink-2:#b9c0c7;--muted:#88909a;--hair:#2a2e32;--spd:#3987e5;--red:#f07a48}}'
       'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Overpass","Helvetica Neue",Arial,sans-serif}'
       'main{max-width:44rem;margin:0 auto;padding:1.4rem 16px 2.5rem}a{color:var(--spd)}'
       '.crumb{font-size:.8rem;color:var(--muted)}.crumb a{color:inherit}h1{font-size:1.7rem;line-height:1.15;margin:.4rem 0 .3rem}'
       '.sub{color:var(--ink-2);margin:0 0 1rem}.go{display:inline-block;margin:.2rem 0 1.2rem;padding:.6rem 1rem .5rem;border-radius:4px;background:var(--ink);color:var(--bg);font-weight:700;text-decoration:none}'
       '.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;margin:0 0 1.2rem;padding:1rem;background:var(--land);border:1px solid var(--hair);border-radius:8px}'
       '.stats b{display:block;font-size:1.5rem;line-height:1.1}.stats span{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}'
       'table{width:100%;border-collapse:collapse;font-size:.9rem;margin:.3rem 0 1.2rem}td,th{padding:.25rem 0;border-bottom:1px solid var(--hair);text-align:left}td:last-child,th:last-child{text-align:right;font-variant-numeric:tabular-nums}'
       '.credit{font-size:.8rem;color:var(--muted);font-style:italic;margin-top:1.2rem}h2{font-size:1.05rem;margin:1.2rem 0 .3rem}ul{padding-left:1.1rem}li{margin:.2rem 0}.foot{margin-top:2rem;font-size:.75rem;color:var(--muted)}')
def count_js(path):
    if not GC: return ''
    return ('<script>(function(){try{if(localStorage.getItem("dctc-nocount"))return}catch(e){}'
            f'if(location.host!=={json.dumps(site.split("/")[2] if site else "")})return;'
            f'var q=new URLSearchParams({{p:{json.dumps(path)},t:document.title,r:document.referrer,rnd:Math.random().toString(36).slice(2)}});'
            f'new Image().src="https://{GC}.goatcounter.com/count?"+q}})()</script>')
def cpage(path, title, desc, body, extra_head='', redirect=''):
    return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{E(title)}</title>\n<meta name="description" content="{E(desc)}">\n<link rel="canonical" href="{site}{path}">\n'
            f'<meta property="og:title" content="{E(title)}">\n<meta property="og:description" content="{E(desc)}">\n<meta property="og:type" content="website">\n'
            f'<meta property="og:url" content="{site}{path}">\n<meta property="og:image" content="{site}og-card.png">\n<meta name="twitter:card" content="summary_large_image">\n'
            f'<link rel="icon" href="{"../" * path.count("/")}favicon.svg" type="image/svg+xml">\n<link rel="stylesheet" href="{"../" * path.count("/")}fonts/fonts.css">\n'
            f'{redirect}{extra_head}<style>{CSS}</style>\n</head><body><main>\n{body}\n'
            '<p class="foot">Independent and non-commercial; not affiliated with DDOT or the DC Government. Data: DDOT Automated Safety Cameras via '
            '<a href="https://opendata.dc.gov/datasets/automated-safety-cameras">Open Data DC</a> (CC BY 4.0), adapted. Ticket counts cover months each camera was live. '
            'For information only; posted signs and the law govern.</p>\n</main></body></html>\n')
near = lambda c, k=5: sorted((o for o in recs if o is not c), key=lambda o: (o['x'] - c['x']) ** 2 + (o['y'] - c['y']) ** 2)[:k]
months = meta['months']
for c in recs:
    slug = slugof(c); path = f'c/{slug}/'; go = f'../../#cam-{slug}'; kind = KIND.get(c['t'], 'Camera')
    title = f"{kind}: {c['loc']} · DC Traffic Cameras"
    desc = (f"{kind} at {c['loc']}, Washington DC: {c['n']:,} tickets in 12 months, one every {pace(c['n'])} on average, #{rank[c['id']]} of {NL} DC cameras."
            if c['n'] else f"{kind} at {c['loc']}, Washington DC. {STATUS.get(c['s'], '')}.")
    facts = [f"{kind}", STATUS.get(c['s'], c['s'])] + ([f"Posted limit {c['lim']} mph"] if c.get('lim') and c['t'] == 'spd' else []) \
            + [f"Near {c['hood']}, Ward {c['ward']}"] + ([f"Since {dt.date.fromisoformat(c['since']).strftime('%b %Y')}"] if c.get('since') else []) \
            + (['Portable unit'] if c.get('port') else [])
    statbox = (f'<div class="stats"><div><b>{c["n"]:,}</b><span>tickets, 12 months</span></div><div><b>1 / {pace(c["n"])}</b><span>on average</span></div>'
             f'<div><b>#{rank[c["id"]]}</b><span>of {NL} cameras</span></div></div>') if c['n'] else ''
    m = c.get('m') or []
    table = ('<h2>Tickets per month</h2><table><tr><th>Month</th><th>Tickets</th></tr>' +
             ''.join(f'<tr><td>{MON(ym)}</td><td>{v:,}</td></tr>' for ym, v in zip(months, m)) + '</table>') if c['n'] and m else ''
    nearby = ''.join(f'<li><a href="../{slugof(o)}/">{E(o["loc"])}</a> ({KIND.get(o["t"], "camera").lower()}{", " + format(o["n"], ",") + " tickets" if o["n"] else ""})</li>' for o in near(c))
    body = (f'<p class="crumb"><a href="../../">DC Traffic Cameras</a> › <a href="../">All cameras</a> › Ward {E(str(c["ward"]))}</p>\n'
            f'<h1>{E(c["loc"])}</h1>\n<p class="sub">{" · ".join(E(f) for f in facts)}</p>\n<a class="go" href="{go}">See it on the map →</a>\n{statbox}\n'
            f'<p>Fine if caught: {FINE.get(c["t"], "see DDOT")}. Cameras run 24/7. Ticket counts come from DDOT and cover {E(meta["window"])}.</p>\n{table}'
            f'<h2>Nearby cameras</h2><ul>{nearby}</ul>')
    fx = c.get('fix')
    if fx and fx.get('by'): body += f'<p class="credit">{ {"move": "Location corrected", "include": "Added to the map", "report": "Reported"}[fx["a"]] } thanks to {E(fx["by"].rstrip("."))}. Thank you!</p>'
    redirect = f'<script>if(location.hash==="#map")location.replace("{go}")</script>\n'
    d = CDIR / slug; d.mkdir()
    (d / 'index.html').write_text(cpage(path, title, desc, body + count_js(f'/c/{slug}/'), redirect=redirect))
# list of every camera by ward, linked from the map page and the sitemap
wards = {}
for c in recs: wards.setdefault(str(c['ward']), []).append(c)
lst = ''.join(f'<h2>Ward {w} · {len(cs)} cameras</h2><ul>' + ''.join(
    f'<li><a href="{slugof(c)}/">{E(c["loc"])}</a> ({KIND.get(c["t"], "camera").lower()}{", " + format(c["n"], ",") + " tickets" if c["n"] else ", not fining yet"})</li>'
    for c in sorted(cs, key=lambda c: -(c['n'] or 0))) + '</ul>' for w, cs in sorted(wards.items()))
(CDIR / 'index.html').write_text(cpage('c/', 'All traffic cameras in Washington DC, by ward · DC Traffic Cameras',
    f'Every one of DC\'s {NL} fixed speed, red-light and stop-sign cameras, listed by ward with tickets issued over {meta["window"]}.',
    f'<p class="crumb"><a href="../">DC Traffic Cameras</a> › All cameras</p>\n<h1>All {NL} traffic cameras in DC</h1>\n'
    f'<p class="sub">By ward, busiest first. Tickets over {E(meta["window"])}.</p>\n<a class="go" href="../">Open the map →</a>\n{lst}' + count_js('/c/')))
# sitemap for search engines
urls = [site, site + 'c/'] + [f'{site}c/{slugof(c)}/' for c in recs]
(OUT.parent / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    ''.join(f'<url><loc>{u}</loc><lastmod>{meta["asof_iso"]}</lastmod></url>\n' for u in urls) + '</urlset>\n')
if '--artifact' in sys.argv: (HERE.parent / 'dc_traffic_cameras.html').write_text(page)   # private preview copy only
print(f'{OUT.name}: {len(page)/1e6:.2f} MB, {len(recs)} cameras, max distance {meta["maxd"]} mi, window {meta["window"]}')
print('unmapped', unmapped, '| last record', meta['last_record'], '| fines 12m', f"{stats['fines']:,}", '| every', stats['sec'], 's | floor $', f"{stats['usd']:,}")
