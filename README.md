# Tallinn Live

Real-time map of every bus, tram and trolleybus in Tallinn, built on the public
`transport.tallinn.ee/gps.txt` feed.

**Live:** https://tallinn-live-plum.vercel.app (deploys automatically from `main`)
**Install on a phone:** https://tallinn-live-plum.vercel.app/install

## Run

```bash
node server.js
```

Then open http://localhost:5180. No dependencies, no API keys.

## Deploy

Hosted on Vercel: `public/` is served statically and `api/*.js` run as
serverless functions with edge caching (`s-maxage`), so many phones share one
upstream request. `vercel.json` sets a 10 s function timeout.

## What's inside

- `server.js` — zero-dependency Node server. Serves `public/` and proxies two
  endpoints (the upstream feed has no CORS):
  - `GET /api/vehicles` → `{ at, vehicles: [{ id, type, line, lat, lon, heading, dest, lowFloor }] }`
  - `GET /api/stops` → Tallinn city platforms (with SIRI ids) from `data/stops.txt`
  - `GET /api/departures?ids=1280,1322` → upcoming departures for one or more
    platforms, from `siri-stop-departures.php` (live expected vs scheduled time)
  - `GET /api/plan?from=lat,lon&to=lat,lon` → public-transport itineraries from
    [Transitous](https://transitous.org) (open MOTIS instance, no key), trimmed
    to legs, stops and decoded route geometry
  - `GET /api/geocode?q=...` → places, addresses and stops around Tallinn (Transitous)
  - `GET /api/trip?id=...` → a trip's full stop sequence, timetable and geometry
    (used to match the live vehicle you will board)
- `public/index.html` — MapLibre GL + OpenFreeMap light style, pastel UI with
  🚋 🚌 🚎 emoji markers (Nunito font, no build step). Vehicles animate
  smoothly between feed updates; heading arrow per vehicle; filter by type or
  line; click a vehicle to highlight its whole line; "Near me" lists vehicles
  within a radius sorted by approaching / moving away (right-click the map to
  move the location). Tap a stop for a departures timeline: minutes until each
  line arrives, delay vs timetable, platform letter matching the map; refreshes
  every 15 s. The search box also finds stops by name; each result lists its
  platforms with the destinations they serve (A → Männiku · Urda, B → Viru …)
  so you can pick the right side of the road, and the stop panel has matching
  platform tabs. Directions (🧭): A → B by public transport like Google Maps,
  from your location or any typed place to a stop, address or map pin; shows
  departure/arrival times, transfers, step-by-step legs, draws the route on the
  map and highlights the live vehicles of the lines you will ride. Live
  tracking then finds the actual vehicle for your first leg by projecting
  same-line GPS positions onto the trip's route (right direction, not past
  your stop, closest to it), shows "5 stops away · here in ~4 min (1 min
  late)" with a leave-now / too-tight verdict against your walking time, and
  pulses that vehicle on the map. Refreshes with every feed update.

## Feed format (gps.txt)

```
type,line,lon*1e6,lat*1e6,,heading,vehicleId,lowFloor(Z|false),?,destination
```

`type`: 1 = trolleybus, 2 = bus, 3 = tram.

## Feed cadence

The GPS feed is rewritten server-side every 10 s (all vehicles at once; about
two thirds change position per update, the rest are stationary). The page polls
every 3 s and glides each vehicle linearly over 10 s to its new position, so
motion is continuous at the cost of trailing reality by roughly one update.

## Departures format (siri-stop-departures.php)

```
Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<nowSecOfDay>,version
stop,<siriId>
bus,42,38566,38608,Väike-Õismäe,68,Z     # type,line,expected,scheduled,dest,secondsUntil,lowFloor
```

## Mobile

The layout is mobile-first: compact top bar with horizontally scrolling
filters, bottom sheets for stop departures and "near me" (tap the header to
expand), long-press on the map to place your location, and `watchPosition`
so the near-me list follows you as you walk. The location marker is
Google-style: blue dot, GPS accuracy ring, and a compass cone that turns with
the phone (DeviceOrientation; iOS asks for permission on the first tap). `manifest.json` + `icon.svg`
let it be added to the home screen as an app. `/install` is the share link for
that: on Android it fires Chrome's native install prompt (manifest with PNG
icons + `sw.js`), on iOS, where no API exists, it shows the Share → Add to
Home Screen steps tailored to the detected browser (Safari, Chrome, Firefox,
Edge, Opera, DuckDuckGo, in-app browsers), and on desktop it shows a QR code.
Append `?os=ios&browser=chrome` etc. to preview a variant.

Geolocation only works on HTTPS (or localhost). When opened over plain
`http://<lan-ip>:5180` from a phone the browser blocks it and the page falls
back to the map centre; long-press still works. Put it behind HTTPS (any
Node host, or a tunnel) for real on-the-go use.
