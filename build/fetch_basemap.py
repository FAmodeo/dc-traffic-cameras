# Fetch DC GIS basemap layers (boundary, roads, water, parks, Capitol Hill local streets)
import json, time, urllib.request, urllib.parse, pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'basemap'; OUT.mkdir(parents=True, exist_ok=True)
R = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/'
def get(path, where, fields, out, **extra):
    feats, off = [], 0
    while True:
        q = dict(where=where, outFields=fields, f='geojson', outSR=4326, resultOffset=off, resultRecordCount=1000,
                 maxAllowableOffset=0.00002, orderByFields='OBJECTID', **extra)
        for i in range(5):   # the DC GIS server drops connections now and then
            try: d = json.load(urllib.request.urlopen(R + path + '/query?' + urllib.parse.urlencode(q), timeout=120)); break
            except Exception as e:
                if i == 4: raise
                print(f'  retry {i + 1} after {type(e).__name__}'); time.sleep(2 ** (i + 1))
        if 'error' in d: raise RuntimeError(d['error'])
        fs = d.get('features', []); feats += fs; off += len(fs)
        if len(fs) < 1000: break
    json.dump(dict(type='FeatureCollection', features=feats), open(OUT / out, 'w')); print(out, len(feats))
get('Administrative_Other_Boundaries_WebMercator/MapServer/10', '1=1', '*', 'boundary.geojson')
get('Transportation_WebMercator/MapServer/48', 'FHWAFUNCTIONALCLASS<=4',
    'STREETNAME,STREETTYPE,FHWAFUNCTIONALCLASS', 'roads.geojson')
get('Environment_Water_WebMercator/MapServer/24', "DESCRIPTION IN ('River','Lake','Pond')", 'DESCRIPTION', 'water.geojson')
get('Recreation_WebMercator/MapServer/10', '1=1', 'NAME', 'parks.geojson')
# full street network (block segments) for snapping cameras and neighbourhood close-ups
get('Transportation_WebMercator/MapServer/48', '1=1',
    'ROUTENAME,STREETNAME,STREETTYPE,FHWAFUNCTIONALCLASS,SUMMARYDIRECTION,SPEEDLIMITS_IB,SPEEDLIMITS_OB,BLOCK_NAME',
    'streets_all.geojson')
get('Administrative_Other_Boundaries_WebMercator/MapServer/35', '1=1', '*', 'neighborhood_labels.geojson')
