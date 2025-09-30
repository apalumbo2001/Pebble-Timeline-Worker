
// Pebble Timeline Worker — schedule + fun colors + dedup IDs
const REBBLE = "https://timeline-api.rebble.io/v1/user/pins";
const NY_TZ = "America/New_York";

const pad2 = (n)=>String(n).padStart(2,"0");
const todayStr = ()=> new Date().toISOString().slice(0,10);
const plusMinutesISO = (mins) => new Date(Date.now() + mins*60*1000).toISOString();

function etOffsetMinutes() {
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "GMT-4";
  const m = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tzName);
  return m ? (parseInt(m[1],10) * 60 + (m[2]?parseInt(m[2],10):0)) : -240;
}
function etTodayDate(hour, minute) {
  const offMin = etOffsetMinutes();
  const now = Date.now();
  const localNow = new Date(now + offMin*60*1000);
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  const localTarget = localMidnight + (hour*60 + minute)*60*1000;
  return new Date(localTarget - offMin*60*1000);
}
function futureOrSoon(date, minutesAhead = 20) {
  const now = Date.now();
  if (date.getTime() <= now + 60*1000) return new Date(now + minutesAhead*60*1000);
  return date;
}

async function pushPin(userToken, pin) {
  const url = `${REBBLE}/${encodeURIComponent(pin.id)}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "X-User-Token": userToken, "Content-Type": "application/json" },
    body: JSON.stringify(pin)
  });
  try {
    const xrl = resp.headers?.get?.("x-ratelimit-percent") || "";
    console.log(`[pin] id=${pin.id} status=${resp.status} xrl=${xrl}`);
  } catch {}
  return resp;
}
async function pushAndLog(userToken, pin, label) {
  const resp = await pushPin(userToken, pin);
  try {
    const xrl = resp.headers?.get?.("x-ratelimit-percent") || "";
    console.log(`[pin] ${label} id=${pin.id} status=${resp.status} xrl=${xrl}`);
  } catch {}
  return resp;
}

// Icons + fun colors
const ICONS = {
  wotd: ["system://images/NOTIFICATION_FLAG","system://images/TIMELINE_CALENDAR","system://images/GENERIC_QUESTION"],
  hydrate: ["system://images/GENERIC_CONFIRMATION","system://images/TIMELINE_WEATHER","system://images/TIMELINE_SUN"],
  stretch: ["system://images/TIMELINE_SPORTS","system://images/GENERIC_CONFIRMATION","system://images/NOTIFICATION_REMINDER"],
  tiktok: ["system://images/GENERIC_SHARE","system://images/GENERIC_CONFIRMATION","system://images/NOTIFICATION_GENERIC"],
  aquarius: ["system://images/TIMELINE_WEATHER","system://images/TIMELINE_SUN","system://images/GENERIC_QUESTION"],
  sunday_reset: ["system://images/TIMELINE_CALENDAR","system://images/NOTIFICATION_REMINDER","system://images/GENERIC_CONFIRMATION"],
  weekly_mantra: ["system://images/TIMELINE_DAILY","system://images/GENERIC_CONFIRMATION","system://images/NOTIFICATION_GENERIC"],
  moon_new: ["system://images/TIMELINE_WEATHER","system://images/GENERIC_QUESTION","system://images/NOTIFICATION_LIGHTHOUSE"],
  moon_full: ["system://images/TIMELINE_WEATHER","system://images/TIMELINE_SUN","system://images/GENERIC_CONFIRMATION"],
  urban: ["system://images/GENERIC_WARNING","system://images/NOTIFICATION_FLAG","system://images/GENERIC_QUESTION"]
};
function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function icon(kind) { return pick(ICONS[kind] || ICONS.wotd); }

// Minimal RSS parsing helpers
function textBetween(s, start, end) {
  const i = s.indexOf(start);
  if (i === -1) return null;
  const j = s.indexOf(end, i + start.length);
  if (j === -1) return null;
  return s.slice(i + start.length, j);
}
function extractTag(item, tag) {
  let v = textBetween(item, `<${tag}><![CDATA[`, `]]></${tag}>`);
  if (v != null) return v.trim();
  v = textBetween(item, `<${tag}>`, `</${tag}>`);
  if (v != null) return v.replace(/<[^>]*>/g, "").trim();
  return null;
}
async function fetchFirstRSSItem(url) {
  const xml = await fetch(url, { cf: { cacheTtl: 900 } }).then(r => r.text());
  const start = xml.search(/<item\b/i);
  if (start === -1) return null;
  const end = xml.indexOf("</item>", start);
  if (end === -1) return null;
  const item = xml.slice(start, end + "</item>".length);
  return {
    title: extractTag(item, "title") || "",
    description: extractTag(item, "description") || "",
    link: extractTag(item, "link") || ""
  };
}
async function fetchMerriamWOTD() { return await fetchFirstRSSItem("https://www.merriam-webster.com/wotd/feed/rss2"); }
async function fetchAquarius(env) {
  const url = env.HORO_RSS_URL;
  if (!url) return null;
  return await fetchFirstRSSItem(url);
}
async function fetchUrban(env) {
  if (String(env.ENABLE_URBAN).toLowerCase()!=="true") return null;
  try {
    const urls = ["https://unofficialurbandictionaryapi.com/word_of_the_day","https://api.urbandictionary.com/v0/random"];
    for (const url of urls) {
      const r = await fetch(url, { cf: { cacheTtl: 1200 } });
      if (!r.ok) continue;
      const data = await r.json();
      let word = data.word || data?.list?.[0]?.word;
      let definition = data.definition || data?.list?.[0]?.definition;
      if (!word || !definition) continue;
      if (String(env.SAFE_MODE).toLowerCase()==="true") {
        const banned = /(fuck|shit|cunt|cum|cock|pussy|nig+|rape|blowjob|anal|dick|asshole|porn|slut|whore|jerk\s*off)/i;
        if (banned.test(word) || banned.test(definition)) return null;
      }
      return { word, definition };
    }
    return null;
  } catch { return null; }
}

// Moon helpers
function moonAge(date=new Date()) {
  const synodic = 29.53058867;
  const ref = Date.UTC(2000,0,6,18,14,0);
  const days = (date.getTime() - ref) / 86400000;
  let age = days % synodic;
  if (age < 0) age += synodic;
  return age;
}
function isNewMoonToday() { const age = moonAge(new Date()); return age < 1.2 || age > 28.3; }
function isFullMoonToday() { const age = moonAge(new Date()); return Math.abs(age - 14.765) < 1.2; }

// Internet service checks
const INTERNET_SERVICES = [
  { key: "openai",    name: "OpenAI",          api: { type: "statuspage", url: "https://status.openai.com/api/v2/summary.json" } },
  { key: "apple",     name: "Apple Services",  api: { type: "apple" } },
  { key: "youtube",   name: "YouTube",         api: { type: "google_incidents" } },
  { key: "meta",      name: "Meta (APIs)" },
  { key: "instagram", name: "Instagram (APIs)" },
  { key: "tiktok",    name: "TikTok" },
  { key: "snapchat",  name: "Snapchat" },
  { key: "x",         name: "X (Twitter) – Dev" },
  { key: "amazon",    name: "Amazon (AWS Health)" },
  { key: "spotify",   name: "Spotify" },
  { key: "metronet",  name: "Metronet" }
];
async function getJSON(url, { cfTTL = 60 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), 10000);
  try {
    const r = await fetch(url, {
      headers: { "accept": "application/json" },
      cf: { cacheTtl: cfTTL, cacheEverything: true },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getAppleStatus() {
  const url = "https://www.apple.com/support/systemstatus/data/system_status_en_US.js";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), 10000);
  try {
    const r = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const txt = await r.text();
    const start = txt.indexOf("{"); const end = txt.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error("Unexpected Apple status format");
    const json = JSON.parse(txt.slice(start, end + 1));
    const problems = [];
    const services = (json.services || []);
    for (const s of services) {
      const name = s.serviceName || s.name || "Apple Service";
      const events = (s.events || []).filter(e => !e.resolved);
      const status = s.status || s.serviceStatus;
      if ((events && events.length) || (status && /issue|degraded|outage|performance/i.test(String(status)))) {
        const note = (events?.[0]?.message || events?.[0]?.usersAffected || status || "Issue");
        problems.push({ component: name, note: String(note).slice(0, 140) });
      }
    }
    return { indicator: problems.length ? "minor" : "none", problems };
  } finally { clearTimeout(t); }
}
async function getYouTubeFromGoogle() {
  const url = "https://www.google.com/appsstatus/dashboard/incidents.json";
  const data = await getJSON(url, { cfTTL: 60 });
  const incidents = Array.isArray(data) ? data : [];
  const hits = [];
  for (const inc of incidents) {
    const title = inc?.external_desc || inc?.most_recent_update?.text || inc?.name || "Incident";
    const sev = inc?.most_recent_update?.status || "";
    const services = (inc?.service_key || inc?.services || []).join(", ");
    if (/youtube/i.test(title) || /youtube/i.test(services)) {
      hits.push({ title: String(title).slice(0, 120), status: String(sev || "unknown") });
    }
  }
  return { indicator: hits.length ? "minor" : "none", problems: hits };
}
async function getStatuspageSummary(url) {
  const data = await getJSON(url, { cfTTL: 60 });
  const indicator = (data?.status?.indicator || "none").toLowerCase();
  const unresolved = Array.isArray(data?.incidents) ? data.incidents.filter(i => i.status !== "resolved") : [];
  const broken = Array.isArray(data?.components) ? data.components.filter(c => c.status && c.status !== "operational") : [];
  const problems = [
    ...unresolved.map(i => ({ component: i.name, note: (i.impact || i.status || "issue") })),
    ...broken.map(c => ({ component: c.name, note: c.status }))
  ];
  return { indicator, problems };
}
async function checkService(svc) {
  try {
    if (svc.api?.type === "statuspage") return { svc, ok: true, ...(await getStatuspageSummary(svc.api.url)) };
    if (svc.api?.type === "apple")      return { svc, ok: true, ...(await getAppleStatus()) };
    if (svc.api?.type === "google_incidents") return { svc, ok: true, ...(await getYouTubeFromGoogle()) };
    return { svc, ok: true, indicator: "unknown", problems: [] };
  } catch (err) {
    return { svc, ok: false, error: String(err) };
  }
}
async function taskInternetAlerts(env) {
  const results = await Promise.all(INTERNET_SERVICES.map(checkService));
  let updated = 0;
  for (const r of results) {
    if (!r.ok) continue;
    const indicator = (r.indicator || "unknown").toLowerCase();
    if (indicator === "unknown") continue;
    if (!["major","critical","none"].includes(indicator)) continue;
    const first = (r.problems && r.problems[0]) || null;
    const note  = (first?.note || first?.status || "").toString().slice(0, 200);
    const id = `net-${r.svc.key}`;
    const isDown = indicator !== "none";
    const time = new Date(Date.now() + (isDown ? 45 : -1) * 60 * 1000).toISOString();
    const title = isDown ? `${r.svc.name} ${indicator.toUpperCase()}` : `${r.svc.name} recovered`;
    const body = isDown ? (note || `Ongoing ${indicator} incident`) : "Service is back to normal.";
    const pin = {
      id,
      time,
      layout: { ...(isDown ? { backgroundColor: "#E63946", primaryColor: "#FFFFFF", secondaryColor: "#FFE3E6" } : { backgroundColor: "#2A9D8F", primaryColor: "#FFFFFF", secondaryColor: "#CFF7F1" }),
        type: "genericPin",
        tinyIcon: isDown ? "system://images/GENERIC_WARNING" : "system://images/GENERIC_CONFIRMATION",
        title,
        body
      }
    };
    await pushAndLog(env.PEBBLE_USER_TOKEN, pin, `alerts:${r.svc.key}`);
    updated++;
  }
  return updated;
}

// Mood + quick fact + trash
async function taskMoodPin(env) {
  const dayKey = todayStr();
  const id = `mood-${dayKey}`;
  const base = env.PUBLIC_BASE || "";
  const k = env.RUN_KEY || "test";
  const mk = s => `${base}/mood/set?day=${dayKey}&score=${s}&key=${k}`;
  const pin = {
    id,
    time: plusMinutesISO(2),
    layout: { backgroundColor: "#6D597A", primaryColor: "#FFFFFF", secondaryColor: "#E9D8FD",
      type: "genericPin",
      title: "How are you feeling?",
      body: "Tap to log your mood.",
      tinyIcon: "system://images/GENERIC_QUESTION"
    },
    actions: [
      { title:"Good", type:"http", method:"GET", url: mk("good"), successText:"Logged", successIcon:"system://images/GENERIC_CONFIRMATION", failureText:"Failed", failureIcon:"system://images/RESULT_FAILED" },
      { title:"Okay", type:"http", method:"GET", url: mk("okay"), successText:"Logged", successIcon:"system://images/GENERIC_CONFIRMATION", failureText:"Failed", failureIcon:"system://images/RESULT_FAILED" },
      { title:"Rough", type:"http", method:"GET", url: mk("rough"), successText:"Logged", successIcon:"system://images/GENERIC_CONFIRMATION", failureText:"Failed", failureIcon:"system://images/RESULT_FAILED" }
    ]
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "mood-pin");
}
async function taskOneMinuteFact(env) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const commonHeaders = {
    "accept": "application/json",
    // Use your worker hostname/email so WMF can contact you if needed:
    "user-agent": "PebbleTimelineWorker/1.0 (+https://YOUR-WORKER.example; contact: you@example.com)"
  };
  let r = await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
    headers: commonHeaders, cf: { cacheTtl: 900, cacheEverything: true }, signal: ctrl.signal
  });
  if (!r.ok && (r.status === 400 || r.status === 403 || r.status === 429)) {
    // Fallback route that often behaves better on some edges:
    r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/Special:Random", {
      headers: commonHeaders, cf: { cacheTtl: 900, cacheEverything: true }, signal: ctrl.signal
    });
  }

    if (!r.ok) throw new Error(`wiki ${r.status}`);
    const data = await r.json();
    const title = data?.title || "1-minute fact";
    const extract = (data?.extract || "").slice(0, 300);
    const pin = {
      id: "fact-1min",
      time: plusMinutesISO(20),
      layout: { backgroundColor: "#4361EE", primaryColor: "#FFFFFF", secondaryColor: "#DCE1FF",
        type: "genericPin",
        title: `1-min: ${title}`,
        body: extract || "Open to read a quick fact.",
        tinyIcon: "system://images/NEWS_EVENT"
      }
    };
    return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "fact-1min");
  } finally { clearTimeout(t); }
}
function nextSunday2000ETtoUTC() {
  const offMin = etOffsetMinutes();
  const now = Date.now();
  const localNow = new Date(now + offMin*60*1000);
  const dow = localNow.getUTCDay();
  let days = (7 - dow) % 7;
  const localHour = localNow.getUTCHours();
  if (days === 0 && localHour >= 20) days = 7;
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  const localTarget = localMidnight + days*24*60*60*1000 + (20*60 + 0)*60*1000;
  const utcTarget = new Date(localTarget - offMin*60*1000);
  return utcTarget.toISOString();
}
async function taskTrash(env) {
  const timeISO = nextSunday2000ETtoUTC();
  const pin = {
    id: "trash-sunday",
    time: timeISO,
    layout: { backgroundColor: "#2D2D2D", primaryColor: "#FFFFFF", secondaryColor: "#BBBBBB",
      type: "genericPin",
      title: "Trash & Recycling",
      body: "Put bins to curb tonight.",
      tinyIcon: "system://images/SCHEDULED_EVENT"
    },
    reminders: [{
      time: new Date(new Date(timeISO).getTime() - 60*60*1000).toISOString(),
      layout: {
        type: "genericReminder",
        title: "Trash in 1 hour",
        tinyIcon: "system://images/NOTIFICATION_REMINDER"
      }
    }]
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "trash-sunday");
}

// Weather 'gotcha'
async function taskWeatherGotcha(env, lat, lon) {
  lat = parseFloat(lat || env.DEFAULT_LAT || "39.7684");
  lon = parseFloat(lon || env.DEFAULT_LON || "-86.1581");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "UTC");
  const r = await fetch(url, { headers: { accept: "application/json" }});
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const data = await r.json();
  const H = data?.hourly || {}, now = Date.now();
  const times = H.time || [], probs = H.precipitation_probability || [], temps = H.temperature_2m || [];
  const idxs = times.map((t,i)=>[i,Date.parse(t)]).filter(([,ms])=>ms>=now&&ms<=now+6*3600e3).map(([i])=>i);
  let gotcha = null;
  for (const i of idxs) if ((probs[i]||0) >= 35) { gotcha={kind:"rain", at:times[i], prob:probs[i], extra:H.precipitation?.[i]||0}; break; }
  if (!gotcha && idxs.length>=4) {
    for (let k=0;k+3<idxs.length;k++) {
      const i1=idxs[k], i2=idxs[k+3];
      if (temps[i1]-temps[i2] >= 8) { gotcha={kind:"tempdrop", from:temps[i1], to:temps[i2]}; break; }
    }
  }
  if (!gotcha) return new Response("no-op");
  const title = gotcha.kind==="rain" ? "Rain soon" : "Temp drop ahead";
  const body  = gotcha.kind==="rain" ? `Precip ≥ ${gotcha.prob}% in ~6h.` : `About ${Math.round(gotcha.from - gotcha.to)}°F cooler in ~3h.`;
  const icon  = gotcha.kind==="rain" ? "system://images/HEAVY_RAIN" : "system://images/TIMELINE_WEATHER";
  const pin = {
    id: "weather-gotcha",
    time: new Date(Date.now() + 20*60*1000).toISOString(),
    layout: { backgroundColor: "#0096C7", primaryColor: "#FFFFFF", secondaryColor: "#D0EFFF", type: "genericPin", title, body, tinyIcon: icon }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "weather-gotcha");
}

// Schedules
async function scheduleHydrateDay(env) {
  const hours = [9,12,15,18,21,23];
  const pushes = [];
  for (const h of hours) {
    const t = etTodayDate(h, 0);
    const id = `hydrate-${todayStr()}-${pad2(h)}00`;
    const pin = {
      id,
      time: t.toISOString(),
      layout: { backgroundColor: "#00B4D8", primaryColor: "#FFFFFF", secondaryColor: "#E0FBFC",
        type: "genericPin",
        title: "Hydrate",
        body: "Grab water & 60 sec stretch.",
        tinyIcon: icon("hydrate")
      }
    };
    pushes.push(pushAndLog(env.PEBBLE_USER_TOKEN, pin, "sched:hydrate"));
  }
  return Promise.all(pushes);
}
async function scheduleStretchDaily(env) {
  const slots = [{h:12,m:0},{h:17,m:0}];
  const pushes = [];
  for (const s of slots) {
    const t = etTodayDate(s.h, s.m);
    const id = `stretch-${todayStr()}-${pad2(s.h)}${pad2(s.m)}`;
    const pin = {
      id,
      time: t.toISOString(),
      layout: { backgroundColor: "#6A994E", primaryColor: "#FFFFFF", secondaryColor: "#E4F1DA",
        type: "genericPin",
        title: "Stretch break",
        body: "Neck/shoulder roll for 60 sec.",
        tinyIcon: icon("stretch")
      }
    };
    pushes.push(pushAndLog(env.PEBBLE_USER_TOKEN, pin, "sched:stretch"));
  }
  return Promise.all(pushes);
}
async function scheduleTikTokDaily(env) {
  const t = etTodayDate(16, 0);
  const id = `tiktok-${todayStr()}-1600`;
  const pin = {
    id,
    time: t.toISOString(),
    layout: { backgroundColor: "#F15BB5", primaryColor: "#FFFFFF", secondaryColor: "#FFE3F3",
      type: "genericPin",
      title: "Post TikTok",
      body: "Share a clip or behind-the-scenes.",
      tinyIcon: icon("tiktok")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "sched:tiktok");
}

// Daily "always visible" pins (23:55 ET)
async function taskWOTD(env) {
  const t = etTodayDate(23, 55);
  const it = await fetchMerriamWOTD();
  if (!it) return new Response("no wotd", { status: 204 });
  const word = it.title ? it.title.replace(/ - Word of the Day.*/i,"").trim() : "Word of the Day";
  const body = (it.description || "").slice(0, 220);
  const pin = {
    id: `wotd-${todayStr()}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#FFD166", primaryColor: "#000000", secondaryColor: "#6B4F00",
      type: "genericPin",
      title: "Word of the Day",
      body: `${word}\n${body}`.trim(),
      tinyIcon: icon("wotd")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:wotd");
}
async function taskAquariusToday(env) {
  const t = etTodayDate(23, 55);
  const h = await fetchAquarius(env);
  if (!h) return new Response("no horoscope", { status: 204 });
  const pin = {
    id: `horo-${todayStr()}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#3D405B", primaryColor: "#FFFFFF", secondaryColor: "#C7CCF3",
      type: "genericPin",
      title: "Horoscope",
      body: (h.description || "").slice(0, 220),
      tinyIcon: icon("aquarius")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:horoscope");
}
async function taskUrbanToday(env) {
  if (String(env.ENABLE_URBAN).toLowerCase()!=="true") return new Response("urban disabled", { status: 204 });
  const t = etTodayDate(23, 55);
  const ud = await fetchUrban(env);
  if (!ud) return new Response("no urban", { status: 204 });
  const pin = {
    id: `urban-${todayStr()}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#FF7F11", primaryColor: "#000000", secondaryColor: "#4A2A00",
      type: "genericPin",
      title: "Urban Word",
      body: `${ud.word}: ${ud.definition.replace(/\s+/g," ").slice(0, 220)}`,
      tinyIcon: icon("urban")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:urban");
}

// Optional weekly/special
async function taskWeeklyMantra(env) {
  const names = [
    "Show up small, win big.","Protect your focus. Guard your energy.","Ship it messy. Iterate in public.",
    "One brave thing a day.","You become what you repeat.","Tiny habits, giant doors.","Less scrolling, more creating."
  ];
  const weekday = new Date().getDay();
  if (weekday !== 1) return new Response("not Monday", { status: 204 });
  const t = futureOrSoon(etTodayDate(8, 30), 20);
  const pin = {
    id: `mantra-${todayStr()}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#14213D", primaryColor: "#FFFFFF", secondaryColor: "#E5E7EB",
      type: "genericPin",
      title: "Weekly Mantra",
      body: pick(names),
      tinyIcon: icon("weekly_mantra")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:weekly_mantra");
}
async function taskSundayReset(env) {
  const weekday = new Date().getDay(); // 0 = Sun
  if (weekday !== 0) return new Response("not Sunday", { status: 204 });
  const t = futureOrSoon(etTodayDate(21, 0), 20);
  const pin = {
    id: `sunday-${todayStr()}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#3A0CA3", primaryColor: "#FFFFFF", secondaryColor: "#E3D9FF",
      type: "genericPin",
      title: "Sunday Reset",
      body: "Plan top 3 for Mon, tidy desk, charge gear.",
      tinyIcon: icon("sunday_reset")
    }
  };
  return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:sunday_reset");
}
async function taskMoonPins(env) {
  const t = futureOrSoon(etTodayDate(20, 30), 20);
  if (isNewMoonToday()) {
    const pin = {
      id: `moonnew-${todayStr()}`,
      time: t.toISOString(),
      layout: { backgroundColor: "#0B132B", primaryColor: "#FFFFFF", secondaryColor: "#C5D6FF",
        type: "genericPin",
        title: "New Moon",
        body: "Set intentions; start a tiny habit this cycle.",
        tinyIcon: icon("moon_new")
      }
    };
    return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:moon_new");
  } else if (isFullMoonToday()) {
    const pin = {
      id: `moonfull-${todayStr()}`,
      time: t.toISOString(),
      layout: { backgroundColor: "#001F3F", primaryColor: "#FFFFFF", secondaryColor: "#D7E8FF",
        type: "genericPin",
        title: "Full Moon",
        body: "Reflect, release, and celebrate progress.",
        tinyIcon: icon("moon_full")
      }
    };
    return pushAndLog(env.PEBBLE_USER_TOKEN, pin, "daily:moon_full");
  }
  return new Response("no moon event", { status: 204 });
}

// Orchestrators
async function runDailyPack(env) {
  await Promise.allSettled([
    scheduleHydrateDay(env),
    scheduleStretchDaily(env),
    scheduleTikTokDaily(env),
    taskWOTD(env),
    taskAquariusToday(env),
    taskUrbanToday(env),
    taskWeeklyMantra(env),
    taskSundayReset(env),
    taskMoonPins(env)
  ]);
}
async function runAll(env) {
  await Promise.allSettled([
    runDailyPack(env),
    //taskMoodPin(env),
    taskOneMinuteFact(env),
    taskTrash(env),
    taskWeatherGotcha(env, env.DEFAULT_LAT, env.DEFAULT_LON),
    taskInternetAlerts(env)
  ]);
}
async function routeNoop(_request, _env) { return new Response("", { status: 204 }); }
async function pushTestPin(env, leadMinutes=35) { const t = new Date(Date.now() + Math.max(2, leadMinutes)*60*1000);
  const pin = {
    id: `test-${t.toISOString().replace(/[^\d]/g,"").slice(0,12)}`,
    time: t.toISOString(),
    layout: { backgroundColor: "#0B132B", primaryColor: "#FFFFFF", secondaryColor: "#C5D6FF",
      type: "genericPin",
      title: "Test Pin",
      body: "If you see me, everything works.",
      tinyIcon: "system://images/NOTIFICATION_FLAG"
    }
  };
  const r = await pushAndLog(env.PEBBLE_USER_TOKEN, pin, "test");
  if (!r.ok) { const txt = await r.text().catch(()=> ""); throw new Error(`Test pin failed: ${r.status} ${txt}`); }
  return pin;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(
`Pebble Timeline Worker (recurring schedule + fun colors)
Now (UTC): ${new Date().toISOString()}
Secrets/vars:
  PEBBLE_USER_TOKEN: ${env.PEBBLE_USER_TOKEN ? "set" : "missing"}
  RUN_KEY: ${env.RUN_KEY ? "set" : "missing (default 'test')"}
  HORO_RSS_URL: ${env.HORO_RSS_URL ? "set" : "unset"}
  ENABLE_URBAN: ${String(env.ENABLE_URBAN||"")}
  SAFE_MODE: ${String(env.SAFE_MODE||"")}

Schedule:
  Hydrate: 9a, 12p, 3p, 6p, 9p, 11p ET
  Stretch: 12p & 5p ET
  TikTok:  4:00p ET
  WOTD / Urban / Horoscope: 11:55p ET (stay in Upcoming all day)

Endpoints:
  /run-now?key=...           -> schedule all of today's pins immediately
  /push-test?key=...         -> push a test pin ~2 minutes ahead
  /alerts/internet?key=...   -> force-check internet alerts
  /noop                      -> action target (204)
  /mood/set?day=YYYY-MM-DD&score=good|okay|rough&key=... -> records mood tap (204)
`, { status: 200, headers: { "Content-Type":"text/plain" } }
      );
    }

    if (url.pathname === "/noop" && request.method === "GET") return routeNoop(request, env);
    if (url.pathname === "/mood/set" && request.method === "GET") {
      console.log("[mood] set", url.searchParams.get("day"), url.searchParams.get("score"));
      return new Response("", { status: 204 });
    }

    try { const k = url.searchParams.get("key"); const expected = env.RUN_KEY || "test"; if (k !== expected) throw new Error(); }
    catch { return new Response("Unauthorized", { status: 401 }); }

    if (url.pathname === "/run-now") {
      await runAll(env);
      return new Response("Triggered today's schedule ✅", { status: 200 });
    }
    if (url.pathname === "/push-test") { const lead = parseInt(url.searchParams.get("lead")||"35",10); try { const pin = await pushTestPin(env, Number.isFinite(lead)?lead:35);
        return new Response(`Test pin queued:\n- id: ${pin.id}\n- time (UTC): ${pin.time}\nIt should appear on your Timeline in a few minutes.`, { status: 200, headers: { "Content-Type":"text/plain" } });
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }
    if (url.pathname === "/alerts/internet") {
      const n = await taskInternetAlerts(env);
      return new Response(`Updated ${n} pins.\n`, { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
  async scheduled(event, env, ctx) { await runAll(env); }
};
