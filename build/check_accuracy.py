# Accuracy audit: does each camera sit on the street its description names, facing a sensible way?
import json, math, collections, pathlib, pandas as pd
from snap import Snapper
HERE = pathlib.Path(__file__).resolve().parent; DATA = HERE.parent / 'data'
LAT0, LON0 = 38.88990, -77.00906
KX, KY = 69.172 * math.cos(math.radians(LAT0)), 69.0
proj = lambda lon, lat: ((lon - LON0) * KX * 1609.344, (lat - LAT0) * KY * 1609.344)
S = Snapper(DATA / 'basemap' / 'streets_all.geojson', proj)
K = {'Speed': 'spd', 'Red Light': 'red', 'Stop Sign': 'stp'}
rows = []
for f in json.load(open(DATA / 'cameras.geojson'))['features']:
    c = f['properties']
    if c['ENFORCEMENT_TYPE'] not in K: continue
    r = S.snap(c['CAMERA_LONGITUDE'], c['CAMERA_LATITUDE'], c['LOCATION_DESCRIPTION'], K[c['ENFORCEMENT_TYPE']])
    rows.append(dict(id=c['ENFORCEMENT_SPACE_CODE'], type=c['ENFORCEMENT_TYPE'], status=c['CAMERA_STATUS'], desc=c['LOCATION_DESCRIPTION'],
                     named_street_found=r['matched'], metres_to_street=r['dist'], snapped_route=r['route'],
                     direction=r['parsed']['dir'], direction_unclear=r['ambiguous'], camera_limit=c['SPEED_LIMIT'],
                     road_layer_limits=','.join(map(str, r['seg_limit'] or []))))
df = pd.DataFrame(rows)
df['flag'] = ~df.named_street_found | (df.metres_to_street > 30) | df.direction_unclear
df.sort_values(['flag', 'metres_to_street'], ascending=False).to_csv(HERE.parent / 'accuracy_check.csv', index=False)
print(len(df), 'cameras | named street found:', int(df.named_street_found.sum()),
      '| within 20 m of it:', int((df.named_street_found & (df.metres_to_street <= 20)).sum()),
      '| flagged:', int(df.flag.sum()))
print(df[df.flag][['id', 'status', 'desc', 'named_street_found', 'metres_to_street', 'snapped_route', 'direction_unclear']].to_string())
