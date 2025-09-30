# Deploying a Cloudflare Worker for Pebble Timeline Pins

## About this Document
This guide walks you through deploying the provided Worker script to Cloudflare and summarizes each major section of the codebase so you understand what it does and how to operate it.  

---

## Step-by-Step Setup

### Prerequisites
- A Cloudflare account with Workers enabled (Free plan works).  
- Your Rebble Timeline X-User-Token (`PEBBLE_USER_TOKEN`) — (You can get this by using the Generate Token app by Willow Systems).  
- Optional feeds/vars for Horoscope and Urban Dictionary.  
- A Rebble subscription so timeline pins show up within reasonable time limits (~15m).  

### Create the Worker
1. In the Cloudflare Dashboard: **Workers & Pages → Create → Worker**  
2. Choose **Start with Hello World!** template.  
3. Name it (e.g., `pebble-timeline`)  
4. Click **Deploy**  

### Paste the Code
1. Click the **Edit Code** button  
2. Replace the default code with the contents of `worker-v12.js`  
3. Click **Deploy**  

### Add Environment Secrets & Vars
Navigate: **Workers → your worker → Settings → Variables**

- **Secrets**:  
  - `PEBBLE_USER_TOKEN`: [Your Timeline Token Generated from the Willow Systems App]  
  - `RUN_KEY`: [Any value you want, this is for manual triggering of the worker]  

- **Vars (plaintext)**:  
  - `HORO_RSS_URL`: [Your preferred RSS feed for the Horoscope pin]  
  - `ENABLE_URBAN`: `'true'`/`'false'` to enable/disable this pin  
  - `SAFE_MODE`: `'true'`/`'false'` to filter NSFW Urban Dictionary responses  
  - `DEFAULT_LAT`: Latitude for Weather Gotcha pins  
  - `DEFAULT_LON`: Longitude for Weather Gotcha pins  

### Enable Cron Triggers
Navigate: **Workers → your worker → Triggers → Cron Triggers → Add Trigger**

Recommended:  
- Every 15 mins (CRON: `*/15 * * * *`)  

---

## Smoke Test (HTTP)
Visit the root URL to confirm config:
```bash
GET https://<your-subdomain>.workers.dev/
GET https://<your-subdomain>.workers.dev/push-test?key=<RUN_KEY>&lead=5
```
You should see `OK(200)` in logs and the pin should appear in your Pebble Timeline shortly.  

---

## Run Everything Now
```bash
GET https://<your-subdomain>.workers.dev/run-now?key=<RUN_KEY>
```
This runs all tasks immediately and schedules today's pins.  

---

## Force Internet Alerts Check
```bash
GET https://<your-subdomain>.workers.dev/alerts/internet?key=<RUN_KEY>
```  

---

## Optional Route (Actions No-Op)
```bash
GET https://<your-subdomain>.workers.dev/noop
```
Returns `204`, used by action buttons.  

---

## Troubleshooting
- **401 Unauthorized**: Check `RUN_KEY` query parameter and that `RUN_KEY` is set in Variables/Secrets.  
- **4xx/5xx from Rebble**: Ensure `PEBBLE_USER_TOKEN` is valid; watch worker logs for status and `x-ratelimit-percent`.  
- **Duplicates**: IDs are date-stamped (e.g., `hydrate-YYYY-MM-DD-HHMM`), so repeated runs safely dedupe.  
- **Timezone**: ET helpers convert to UTC for the API; cron runs in UTC unless you set a timezone in Cloudflare.  
- **Urban Dictionary NSFW**: Set `SAFE_MODE='true'` to drop potentially offensive entries.  

---

## Code Walkthrough

### Overview & Purpose
This Worker deploys a Pebble Timeline utility that schedules and pushes multiple kinds of pins to the Rebble Timeline API.  
It includes daily/weekly schedules, quick actions, status alerts, and test endpoints, all running on both HTTP requests and Cron Triggers.

### Key Endpoints (HTTP)
- `/` — Health page that lists which secrets are set and shows the daily schedule.  
- `/run-now` — Triggers all tasks immediately (requires `?key=RUN_KEY`).  
- `/push-test` — Queues a test pin a few minutes ahead (requires `?key=RUN_KEY`; optional `&lead=minutes`).  
- `/alerts/internet` — Forces a check of major internet service statuses and posts alert pins.  
- `/noop` — Returns `204` and is used as an action target.  
- `/mood/set` — *(Not functional)* Records a mood tap (Good/Okay/Rough) via simple GET logging (204).  

### Environment Variables
- `PEBBLE_USER_TOKEN` (Secret): Rebble Timeline user token.  
- `RUN_KEY` (Secret or Var): Shared secret for protected endpoints (default: `'test'`).  
- `HORO_RSS_URL` (Var): RSS URL for daily horoscope.  
- `ENABLE_URBAN` (Var): `'true'` to enable Urban Word of the Day.  
- `SAFE_MODE` (Var): `'true'` to filter NSFW entries.  
- `DEFAULT_LAT` / `DEFAULT_LON` (Var): Fallback coordinates for Weather Gotcha checks.  

### Scheduling Model
Deterministic pin IDs (e.g., `hydrate-YYYY-MM-DD-HHMM`) prevent duplicates.  
The `scheduled` handler runs `runAll(env)`, orchestrating all daily tasks. Safe to trigger hourly.  

### Time & Timezone Helpers
`NY_TZ = America/New_York`. Functions compute ET-aware times and ensure future-safe pin timestamps.  

### Pin Push Utilities
`pushPin` / `pushAndLog` PUT to `https://timeline-api.rebble.io/v1/user/pins/{id}` and log rate-limit headers.  

### UI & Icons
Rotating system icons and themed colors keep pins visually distinct.  

### RSS & External Data
- Merriam-Webster WOTD (XML parsing).  
- Optional Aquarius Horoscope via `HORO_RSS_URL`.  
- Urban Dictionary (SAFE_MODE optional).  
- Wikipedia "1-minute fact" random summary.  

### Moon Phase & Special Events
Computes moon age to post New Moon / Full Moon guidance pins (around 8:30 PM ET).  

### Internet Service Alerts
Checks:
- OpenAI (Statuspage)  
- Apple System Status  
- Google Incidents (YouTube)  

Posts alert/recovery pins.  

### Daily/Weekly Tasks
- Hydrate: 9a / 12p / 3p / 6p / 9p / 11p ET  
- Stretch: 12p / 5p ET  
- TikTok Reminder: 4p ET  
- WOTD / Urban / Horoscope: 11:55p ET  
- Weekly Mantra: Mondays  
- Sunday Reset: Sundays  
- Trash & Recycling: Sunday 8p ET (+1h reminder)  
- Weather Gotcha: Next 6h rain or 3h temp drop  
- Mood Pin: Quick-tap actions  

### Orchestrators
- `runDailyPack(env)` bundles the daily pin creators.  
- `runAll(env)` runs everything, including alerts/utilities.  
- Default export wires `fetch()` routing and `scheduled()` Cron handling.  

---

## File Deployed
`worker-v12.js`

---

## [OPTIONAL] Modify Pins
If you wish for certain pins to be disabled from this code entirely, go to the Orchestrators section, and put a `//` before the pins you wish to not show up on your timeline (`taskMoodPin(env)` is disabled by default, as response actions do not function).  

Example:
```js
async function runAll(env) {
    await Promise.allSettled([
        […]
        // taskMoodPin(env),
        […]
    ]);
}
```
