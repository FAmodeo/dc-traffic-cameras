# CC Opus 5.5 — snapshot DDOT automated-camera feeds (locations, start dates, monthly tickets)
# Retries each request; writes nothing unless every download succeeds, so a failed run keeps the last good snapshot.
import json, time, datetime as dt, urllib.request, urllib.parse, pandas as pd, pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data'
B = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/'


def get(url, tries=5):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(url, timeout=120))
        except Exception as e:
            if i == tries - 1: raise
            print(f'  retry {i + 1} after {type(e).__name__}'); time.sleep(2 ** (i + 1))


def rows(layer, where, geo=False):
    out, off = [], 0
    while True:
        q = dict(where=where, outFields='*', f='geojson' if geo else 'json', outSR=4326,
                 resultOffset=off, resultRecordCount=1000, orderByFields='OBJECTID')
        d = get(B + f'{layer}/query?' + urllib.parse.urlencode(q))
        if 'error' in d: raise RuntimeError(d['error'])
        fs = d['features']; out += fs; off += len(fs)
        if len(fs) < 1000: return out


since = (dt.date.today().replace(day=1) - dt.timedelta(days=640)).replace(day=1)   # ~21 months of monthly counts
cams = rows(43, '1=1', geo=True)
tab = pd.DataFrame([f['attributes'] for f in rows(47, '1=1')])
v = pd.DataFrame([f['attributes'] for f in rows(46, f"YEAR_MONTH >= DATE '{since:%Y-%m-%d}'")])
v['YEAR_MONTH'] = pd.to_datetime(v.YEAR_MONTH, unit='ms').dt.strftime('%Y-%m')
v['LAST_RECORD'] = pd.to_datetime(v.LAST_RECORD, unit='ms')

json.dump(dict(type='FeatureCollection', features=cams), open(OUT / 'cameras.geojson', 'w'))
tab.to_csv(OUT / 'cameras_table.csv', index=False)
v[['ENFORCEMENT_SPACE_CODE', 'ENFORCEMENT_TYPE', 'YEAR_MONTH', 'CAMERA_STATUS', 'NUM_VIOLATIONS', 'LAST_RECORD']] \
    .sort_values(['ENFORCEMENT_SPACE_CODE', 'YEAR_MONTH']).to_csv(OUT / 'tickets_monthly.csv', index=False)
json.dump({'fetched': dt.date.today().isoformat()}, open(OUT / 'fetched.json', 'w'))
print(len(cams), 'cameras;', len(tab), 'table rows;', len(v), 'monthly rows; last record', v.LAST_RECORD.max())
