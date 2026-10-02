# DC Traffic Cameras

A free, independent map of every fixed speed, red-light and stop-sign camera in Washington, DC: where each one stands,
the stretch of road it watches and in which direction, its posted limit, and how many fines it issued in the last
12 months. Not affiliated with DDOT or the DC government.

The page is a single static file, `docs/index.html`, served by GitHub Pages. A GitHub Action rebuilds it on the 12th of
every month from the latest public data.

## Data

| What | Source (Open Data DC, CC BY 4.0) |
|---|---|
| Camera locations, type, status, posted limit | DDOT Automated Safety Cameras (layer 43) and table (layer 47) |
| Fines per camera per month | DDOT Automated Safety Cameras Violation Count By Month (layer 46) |
| Streets, water, parks, neighbourhood names | DC GIS |
| Fine amounts | DDOT StreetSafe FAQ |

In scope: fixed speed, red-light and stop-sign cameras. Out of scope: truck-route cameras (heavy trucks only) and the
bus-mounted bus-lane and school-bus cameras, which have no published fixed location.

## Method, briefly

- **Fines** are the monthly counts DDOT logs for each camera in months its status was *Live*. Warning-period, idle and
  test months are excluded. Headline figures use the last 12 complete months.
- **Dollar figure** prices every fine at the lowest amount for its type ($100 speed or stop sign, $150 red light). It is
  a floor on fines issued, and says nothing about what was collected.
- **Watched stretch**: each camera is matched to the street named in its DDOT description, within 80 m; travel direction
  comes from the description (e.g. "N/B"). The band runs about 150 m before a speed camera and 90 m before a red-light or
  stop-sign camera. It is an approximation; DDOT does not publish enforcement zones.
- **Accuracy check**: `accuracy_check.csv` lists, for every camera, the distance to its named street and any flags.

## Run it locally

```
pip install -r requirements.txt
python build/fetch_cameras.py && python build/fetch_basemap.py
python build/build.py          # writes docs/index.html; refuses implausible data
python build/check_accuracy.py # writes accuracy_check.csv
```

`build/render.js` (Node + Playwright, optional) renders screenshots: the 4K poster (`#poster`) and the share card (`#card`).

## Privacy

The page makes no third-party requests: no analytics, no ads, and the Overpass fonts are self-hosted in `docs/fonts/`
under the SIL Open Font License (`docs/fonts/OFL.txt`).

## Settings

`site.json` holds the public URL, the repository URL and an optional tip link. Leave `tip_url` empty to hide it.

## Disclaimer

For awareness only. Posted signs and the law govern; this is not legal advice. Camera positions and watched stretches
can be wrong; see `accuracy_check.csv`.
