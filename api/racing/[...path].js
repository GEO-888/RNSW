/* ════════════════════════════════════════════════════════════════
   RACING NSW · Vercel serverless proxy  ·  /api/racing/*
   ----------------------------------------------------------------
   Sits between the app and the Racing Australia API so the API key
   never reaches the client. The app (www/js/data-service.js in "api"
   mode) calls ${API_BASE_URL}/api/racing/<path>; this function reads
   the key from the RACING_API_KEY environment variable and forwards
   the request upstream.

   WHY THIS LIVES OUTSIDE www/
     www/ is the static bundle packaged into the native iOS/Android
     app. This directory is NOT — it deploys only to Vercel. The key
     is therefore server-side only: never in www, never in the app
     binary, never committed. See .env.example.

   UNTIL THE KEY EXISTS
     With RACING_API_KEY unset (the state today), every path returns
     a clear 503 "API key not configured" stub. The client treats a
     non-2xx as a failed refresh and falls back to cached/local data,
     so the app keeps working — this is the switch that flips when
     the key arrives.

   NOTE — one thing to confirm when the real API is wired:
     The upstream base URL (RACING_API_BASE) and the exact auth
     scheme. Racing Australia's auth mechanism isn't documented to us
     yet; this sends the key as an `x-api-key` header by default,
     overridable with RACING_API_AUTH_HEADER. Adjust once the API
     docs are in hand — it's the single integration point.
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* Per-data-type edge cache windows (seconds). Mirrors the client TTLs in
   www/js/config.js so the CDN and the app agree on what "stale" means.
   Keyed by the first path segment. Schedules cache for hours; results and
   the live feed for about a minute. */
const CACHE = {
  'race-days':   { s: 6 * 60 * 60, swr: 24 * 60 * 60 }, // fixtures — set well ahead
  'events':      { s: 6 * 60 * 60, swr: 24 * 60 * 60 },
  'network':     { s: 24 * 60 * 60, swr: 48 * 60 * 60 },
  'course-map':  { s: 24 * 60 * 60, swr: 48 * 60 * 60 },
  'jockeys':     { s: 60 * 60,     swr: 6 * 60 * 60 },
  'trainers':    { s: 60 * 60,     swr: 6 * 60 * 60 },
  'horses':      { s: 60 * 60,     swr: 6 * 60 * 60 },
  'results':     { s: 60,          swr: 5 * 60 },        // the live one
  'live-feed':   { s: 20,          swr: 60 },
  'replays':     { s: 10 * 60,     swr: 60 * 60 },
  'news':        { s: 5 * 60,      swr: 30 * 60 },
  'videos':      { s: 30 * 60,     swr: 2 * 60 * 60 },
  'podcasts':    { s: 30 * 60,     swr: 2 * 60 * 60 },
  'diary':       { s: 30 * 60,     swr: 2 * 60 * 60 },
  'leaderboard': { s: 2 * 60,      swr: 10 * 60 },
  'tickets':     { s: 5 * 60,      swr: 30 * 60 },
  'activations': { s: 60 * 60,     swr: 6 * 60 * 60 },
  'past-rounds': { s: 60 * 60,     swr: 6 * 60 * 60 },
  _default:      { s: 5 * 60,      swr: 30 * 60 },
};

function cacheHeader(firstSegment) {
  const c = CACHE[firstSegment] || CACHE._default;
  // s-maxage → the Vercel edge/CDN cache; stale-while-revalidate lets the CDN
  // serve slightly stale data while it refreshes in the background.
  return `public, s-maxage=${c.s}, stale-while-revalidate=${c.swr}`;
}

module.exports = async function handler(req, res) {
  // Read-only proxy: only GET is meaningful.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The [...path] catch-all gives req.query.path as an array of segments.
  const segments = [].concat(req.query.path || []);
  const first = segments[0] || '';
  const upstreamPath = segments.map(encodeURIComponent).join('/');

  const key = process.env.RACING_API_KEY;

  // ── Stub mode: no key yet ──────────────────────────────────────
  if (!key) {
    // Still advertise the cache policy so behaviour is identical once the
    // key lands and only the body changes.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'API key not configured',
      detail: 'RACING_API_KEY is not set on this deployment. Serving the ' +
              'not-configured stub; the app falls back to cached/local data. ' +
              'Set RACING_API_KEY in the Vercel project to enable live data.',
      path: '/' + upstreamPath,
    });
  }

  // ── Live mode: forward to Racing Australia ─────────────────────
  const base = (process.env.RACING_API_BASE || 'https://api.racingaustralia.horse')
    .replace(/\/+$/, '');
  const authHeader = process.env.RACING_API_AUTH_HEADER || 'x-api-key';

  // Forward the caller's query string, minus our own routing param.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach(x => params.append(k, x));
    else if (v != null) params.append(k, v);
  }
  const qs = params.toString();
  const url = `${base}/${upstreamPath}${qs ? '?' + qs : ''}`;

  // Bound the upstream call so a slow origin can't hang the function.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        [authHeader]: key,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();

    if (!upstream.ok) {
      // Pass through a compact error; the client falls back on any non-2xx.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({
        error: 'Upstream error',
        status: upstream.status,
        path: '/' + upstreamPath,
      });
    }

    res.setHeader('Cache-Control', cacheHeader(first));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Wrap in the envelope shape the client's apiGet() unwraps ({data}).
    // Upstream already returns JSON text; embed it verbatim to avoid a
    // parse/re-serialize round trip.
    return res.status(200).send(`{"data":${text}}`);
  } catch (err) {
    clearTimeout(timer);
    res.setHeader('Cache-Control', 'no-store');
    const aborted = err && err.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Upstream timeout' : 'Proxy error',
      path: '/' + upstreamPath,
    });
  }
};
