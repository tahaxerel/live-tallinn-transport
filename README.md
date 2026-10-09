# Tallinn Live

Real-time map of every bus, tram and trolleybus in Tallinn, built on the public
`transport.tallinn.ee/gps.txt` feed (updates every ~3 s).

## Run

```bash
node server.js
```

Then open http://localhost:5180. No dependencies, no API keys.

## What's inside

- `server.js` — zero-dependency Node server. Serves `public/` and proxies two
  endpoints (the upstream feed has no CORS):
  - `GET /api/vehicles` → `{ at, vehicles: [{ id, type, line, lat, lon, heading, dest, lowFloor }] }`
  - `GET /api/stops` → Tallinn city platforms (with SIRI ids) from `data/stops.txt`
  - `GET /api/departures?ids=1280,1322` → upcoming departures for one or more
    platforms, from `siri-stop-departures.php` (live expected vs scheduled time)
- `public/index.html` — MapLibre GL + OpenFreeMap dark style. Vehicles animate
  smoothly between feed updates; heading arrow per vehicle; filter by type or
  line; click a vehicle to highlight its whole line; "Near me" lists vehicles
  within a radius sorted by approaching / moving away (right-click the map to
  move the location). Tap a stop for a departures timeline: minutes until each
  line arrives, delay vs timetable, platform letter matching the map; refreshes
  every 15 s.

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
