import express from 'express';
import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
const { transit_realtime } = GtfsRealtimeBindings;
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Subway (A/C) ─────────────────────────────────────────────────────────────
const SUBWAY_FEED_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace';
const SUBWAY_STATION_ID = 'A48'; // Utica Av on A/C lines
const SUBWAY_DIRECTION_LABEL = {
  N: 'Manhattan',
  S: 'Far Rockaway / Lefferts',
};

// ── Bus (B15 / B65) ───────────────────────────────────────────────────────────
// MTA Bus Time SIRI API — requires an API key
// Stop 301072 = Bergen St / Utica Av (both B15 and B65 stop here)
const BUS_STOP_ID = '301072';
const BUS_LINES = ['MTA NYCT_B15', 'MTA NYCT_B65'];
const BUS_API_URL = 'https://bustime-classic.mta.info/api/siri/stop-monitoring.json';
const BUS_API_KEY = process.env.BUS_API_KEY || ''; // set when you have the key

// ── Caches ────────────────────────────────────────────────────────────────────
let subwayCache = { data: null, fetchedAt: 0 };
let busCache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 20_000;

// ── Subway ────────────────────────────────────────────────────────────────────
async function fetchSubwayFeed() {
  const now = Date.now();
  if (subwayCache.data && now - subwayCache.fetchedAt < CACHE_TTL_MS) {
    return subwayCache.data;
  }
  const res = await fetch(SUBWAY_FEED_URL);
  if (!res.ok) throw new Error(`Subway feed error: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  subwayCache = { data: feed, fetchedAt: now };
  return feed;
}

function getSubwayArrivals(feed) {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = [];

  for (const entity of feed.entity) {
    if (!entity.tripUpdate) continue;
    const { trip, stopTimeUpdate } = entity.tripUpdate;
    const route = trip?.routeId;
    if (!['A', 'C'].includes(route)) continue;

    for (const stop of (stopTimeUpdate || [])) {
      if (!stop.stopId?.startsWith(SUBWAY_STATION_ID)) continue;
      const direction = stop.stopId.slice(-1);
      if (direction !== 'N') continue; // only show Manhattan-bound trains
      const arrivalTime = stop.arrival?.time ?? stop.departure?.time;
      if (!arrivalTime) continue;

      const secsAway = Number(arrivalTime) - now;
      if (secsAway < 0 || secsAway > 3600) continue;

      arrivals.push({
        type: 'subway',
        route,
        direction,
        directionLabel: SUBWAY_DIRECTION_LABEL[direction] ?? direction,
        arrivalTime: Number(arrivalTime),
        minsAway: Math.ceil(secsAway / 60),
      });
    }
  }

  arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return arrivals;
}

// ── Bus ───────────────────────────────────────────────────────────────────────
async function fetchBusArrivals() {
  if (!BUS_API_KEY) return { arrivals: [], noKey: true };

  const now = Date.now();
  if (busCache.data && now - busCache.fetchedAt < CACHE_TTL_MS) {
    return { arrivals: busCache.data, noKey: false };
  }

  const allArrivals = [];

  for (const lineRef of BUS_LINES) {
    const url = new URL(BUS_API_URL);
    url.searchParams.set('key', BUS_API_KEY);
    url.searchParams.set('version', '2');
    url.searchParams.set('OperatorRef', 'MTA');
    url.searchParams.set('MonitoringRef', BUS_STOP_ID);
    url.searchParams.set('LineRef', lineRef);
    url.searchParams.set('MaximumStopVisits', '5');
    url.searchParams.set('StopMonitoringDetailLevel', 'minimum');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Bus API error: ${res.status}`);
    const data = await res.json();

    const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit ?? [];
    const nowSec = Math.floor(Date.now() / 1000);

    for (const visit of visits) {
      const mvj = visit.MonitoredVehicleJourney;
      const mc = mvj?.MonitoredCall;
      const expectedArrival = mc?.ExpectedArrivalTime ?? mc?.ExpectedDepartureTime
        ?? mc?.AimedArrivalTime ?? mc?.AimedDepartureTime;
      if (!expectedArrival) continue;

      const arrivalMs = new Date(expectedArrival).getTime();
      const secsAway = Math.floor((arrivalMs - Date.now()) / 1000);
      if (secsAway < 0 || secsAway > 3600) continue;

      const routeShort = Array.isArray(mvj?.PublishedLineName) ? mvj.PublishedLineName[0] : (mvj?.PublishedLineName ?? lineRef.split('_')[1]);
      const destRaw = mvj?.DestinationName ?? '';
      const dest = Array.isArray(destRaw) ? destRaw[0] : destRaw;

      allArrivals.push({
        type: 'bus',
        route: routeShort,
        direction: mvj?.DirectionRef ?? '',
        directionLabel: dest,
        arrivalTime: Math.floor(arrivalMs / 1000),
        minsAway: Math.ceil(secsAway / 60),
      });
    }
  }

  allArrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
  busCache = { data: allArrivals, fetchedAt: now };
  return { arrivals: allArrivals, noKey: false };
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/arrivals', async (req, res) => {
  try {
    const feed = await fetchSubwayFeed();
    const subway = getSubwayArrivals(feed);
    const { arrivals: buses, noKey } = await fetchBusArrivals();

    res.json({
      ok: true,
      subway,
      buses,
      busKeyMissing: noKey,
      fetchedAt: subwayCache.fetchedAt,
    });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚇 coco-mta running at http://localhost:${PORT}`);
  if (!BUS_API_KEY) console.log('⚠️  BUS_API_KEY not set — bus data disabled until key is added');
});
