/* ════════════════════════════════════════════════════════════════
   RACING NSW · runtime configuration
   ----------------------------------------------------------------
   Loaded before data-service.js and app.js. Plain global (no module
   system in this build) so it is readable from every script.

   THE TWO SETTINGS THAT MATTER
     DATA_SOURCE   'local' → screens read the bundled sample data.
                   'api'   → screens read our own /api/* endpoints.
                   Flip this to 'api' when the Racing Australia key
                   is live. Nothing else needs to change.

     API_BASE_URL  '' (empty) → same-origin. Correct for the web app,
                   where /api/* is served by Vercel off the same host.
                   For the native Capacitor build the WebView is served
                   from capacitor://localhost (iOS) or http://localhost
                   (Android), so /api is NOT the deployment — this must
                   be set to the full Vercel origin, e.g.
                     API_BASE_URL: 'https://rnsw-app.vercel.app'
                   No trailing slash. Never point this at the Racing
                   Australia API directly: the key is server-side only.
   ════════════════════════════════════════════════════════════════ */
var RNSW_CONFIG = {

  DATA_SOURCE: 'local',
  API_BASE_URL: '',

  /* ── Tuning ───────────────────────────────────────────────────
     Only consulted when DATA_SOURCE is 'api'. Kept here rather than
     buried in data-service.js so timeouts and freshness windows are
     adjustable without touching service logic. */

  /* Abort a request that has not responded in this long. Race-day
     grandstand wifi is the design target: fail fast, fall back to
     cached data, never leave the user on a spinner. */
  REQUEST_TIMEOUT_MS: 8000,

  /* How long a cached response stays fresh, per domain (ms).
     Mirrors the Cache-Control max-age the proxy sends, so the client
     and the CDN agree on what "stale" means. Schedules move rarely;
     results move every few minutes on race day. */
  CACHE_TTL_MS: {
    raceDays:       6 * 60 * 60 * 1000,   // 6h  — fixtures are set well ahead
    results:             60 * 1000,       // 60s — the live one
    liveFeed:            20 * 1000,       // 20s — race-by-race updates
    replays:        10 * 60 * 1000,       // 10m
    horses:         60 * 60 * 1000,       // 1h
    jockeys:        60 * 60 * 1000,       // 1h
    trainers:       60 * 60 * 1000,       // 1h
    news:            5 * 60 * 1000,       // 5m
    events:         60 * 60 * 1000,       // 1h
    videos:         30 * 60 * 1000,       // 30m
    podcasts:       30 * 60 * 1000,       // 30m
    diary:          30 * 60 * 1000,       // 30m
    leaderboard:     2 * 60 * 1000,       // 2m
    tickets:         5 * 60 * 1000,       // 5m
    activations:    60 * 60 * 1000,       // 1h
    pastRounds:     60 * 60 * 1000,       // 1h
    courseMap: 24 * 60 * 60 * 1000,       // 24h — effectively static
    network:   24 * 60 * 60 * 1000,       // 24h — site/social links
    _default:        5 * 60 * 1000,
  },

  /* localStorage key prefix for the offline fallback cache. */
  CACHE_PREFIX: 'rnsw_cache_',

  /* Cap on cached payload size (bytes) so a large response cannot
     blow the ~5MB localStorage quota and evict everything else. */
  CACHE_MAX_BYTES: 256 * 1024,
};
