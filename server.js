import express from 'express';
import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
const { transit_realtime } = GtfsRealtimeBindings;
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// MTA GTFS-RT feed for A/C/E/S/H/N lines (no API key required)
const FEED_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace';

// Utica Av stop IDs on the A/C lines (GTFS stop_id: A48)
// A48N = northbound (Manhattan), A48S = southbound (Far Rockaway/Lefferts)
const STATION_ID = 'A48';

const DIRECTION_LABEL = {
  N: 'Manhattan',
  S: 'Far Rockaway / Lefferts',
};

// Cache feed data to avoid hammering the MTA
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 20_000; // 20 seconds

async function fetchFeed() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`MTA feed error: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  cache = { data: feed, fetchedAt: now };
  return feed;
}

function getArrivals(feed) {
  const now = Math.floor(Date.now() / 1000);
  const arrivals = [];

  for (const entity of feed.entity) {
    if (!entity.tripUpdate) continue;
    const { trip, stopTimeUpdate } = entity.tripUpdate;
    const route = trip?.routeId;

    if (!['A', 'C'].includes(route)) continue;

    for (const stop of (stopTimeUpdate || [])) {
      if (!stop.stopId?.startsWith(STATION_ID)) continue;
      const direction = stop.stopId.slice(-1); // 'N' or 'S'
      const arrivalTime = stop.arrival?.time ?? stop.departure?.time;
      if (!arrivalTime) continue;

      const secsAway = Number(arrivalTime) - now;
      if (secsAway < 0 || secsAway > 60 * 60) continue; // skip past / >1h

      arrivals.push({
        route,
        direction,
        directionLabel: DIRECTION_LABEL[direction] ?? direction,
        arrivalTime: Number(arrivalTime),
        minsAway: Math.ceil(secsAway / 60),
      });
    }
  }

  // Sort by arrival time
  arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return arrivals;
}

// API endpoint
app.get('/api/arrivals', async (req, res) => {
  try {
    const feed = await fetchFeed();
    const arrivals = getArrivals(feed);
    res.json({ ok: true, arrivals, fetchedAt: cache.fetchedAt });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚇 coco-mta running at http://localhost:${PORT}`);
});
