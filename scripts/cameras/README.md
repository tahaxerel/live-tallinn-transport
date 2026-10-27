# Traffic cameras (experimental)

Builds `public/cameras.json` from the city's junction cameras at https://ristmikud.tallinn.ee/index.php/cams.
The site lists names only, so positions come from OpenStreetMap: the two streets in a camera's name are
intersected, and the few landmarks, park-and-rides and tunnels are placed by hand in `3-build.mjs`.

1. Save the camera pages to `html/` (`all.html` plus `KE.html`, `LA.html`, … `1.html` … `ST.html`, one per `?area_tag=`), then `node 1-scrape.mjs <dir>` writes `cameras.json`.
2. Put the Overpass result next to `2-geocode.mjs` as `osm.json`:
   `[out:json][timeout:120];(way["highway"]["name"](59.33,24.48,59.53,24.98);way["railway"~"^(tram|rail)$"](59.33,24.48,59.53,24.98););out tags geom qt;`
   then `node 2-geocode.mjs cameras.json` writes `geo-auto.json` and lists what it could not place.
3. `node 3-build.mjs ../../public/cameras.json` groups cameras into one map dot per junction.

Images are loaded straight from `https://ristmikud.tallinn.ee/last/<id>.jpg`; the server renders a new frame per request.
