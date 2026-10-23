# coco-mta 🚇

Real-time A/C train arrival display for **Utica Av** station — built for a Raspberry Pi kiosk.

## Stack
- **Backend:** Node.js + Express, pulls MTA's free GTFS-RT feed (no API key needed)
- **Frontend:** Single HTML page, updates every 30 seconds
- **Kiosk:** Run in Chromium fullscreen on the Pi

## Run it
```bash
npm install
npm start
# → http://localhost:3000
```

## Pi Kiosk Setup
1. Copy the project to your Pi
2. `npm install && npm start` (or set up PM2 to keep it running)
3. Launch Chromium in kiosk mode on boot:
   ```bash
   chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:3000
   ```
4. Add both commands to `/etc/rc.local` or a systemd service

### ⚠️ Keep the Pi clock synced
The app computes arrival countdowns by comparing the Pi's system time against MTA's Unix timestamps. If the clock is wrong, all countdowns will be off by the same amount.

Make sure NTP is enabled on the Pi (it is by default on Raspberry Pi OS, but just in case):
```bash
sudo timedatectl set-ntp true
```

As long as the Pi has internet access (required for the MTA feed anyway), `systemd-timesyncd` will keep the clock accurate automatically.

## Data Source
MTA GTFS-RT feed for the A/C/E line:
`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace`

No API key required. Feed refreshes every ~30 seconds on the server; client polls every 30s.

## Stop Info
- **Station:** Utica Av (A/C lines, Brooklyn)
- **GTFS Stop ID:** `A48`
- **Northbound (A48N):** towards Manhattan
- **Southbound (A48S):** towards Far Rockaway / Lefferts Blvd

## Departure API for voice assistants

`GET /api/departure` returns one computed answer for the next catchable Manhattan-bound A train at Utica Av. The API uses the kiosk's **10-minute** walk time (the current UI value, not 9). It skips trains arriving before the walk is complete. No query parameters or MTA key are needed.

A successful response contains `ok: true`, `fetchedAt` (Unix milliseconds), and `departure`. When a train is available, `departure` includes `route`, `station`, `directionLabel`, `arrivalTime` and `leaveAt` (Unix seconds), `leaveInMinutes`, and `walkMinutes`. When none is catchable, `departure` is `null` and `message` explains why. If the live MTA feed fails or its timestamp is more than two minutes old, the route returns HTTP 503 with `ok: false`. Voice clients should use `leaveAt` for the local leave time and avoid redoing the walk calculation.

This is specific to the Manhattan-bound A at Utica Av. It does not plan trips to arbitrary destinations, southbound trains, or buses.
