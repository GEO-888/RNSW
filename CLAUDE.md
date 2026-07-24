# Racing NSW app — working notes

Mobile app for Racing NSW. A static web app in `www/`, wrapped with **Capacitor**
for the iOS and Android app stores. It also runs as a plain web app. There is
**no bundler and no build step for the app itself** — `www/` ships as-is. The
only build is the Tailwind stylesheet (see Commands).

## Standing rules (do not break these)

1. **All app code stays inside `www/`.** That directory is what Capacitor
   packages into the native binary. Anything the app needs at runtime lives
   there.
2. **No CDN-loaded resources — vendor everything locally.** No `<script>`,
   `<link>`, `@import`, font, or image may load from an external host. The app
   must render fully offline inside the native WebView. (This is why Tailwind
   and all fonts are vendored — see below.) Outbound *navigation* links
   (`target="_blank"` to racingnsw.com.au, socials, YouTube) are fine — those
   open the user's browser, they don't load resources into the app.
3. **All asset references use relative paths** (`assets/…`, `css/…`,
   `js/…`) — never absolute (`/assets/…`) and never `http(s)://`. Absolute
   paths break under the `capacitor://localhost` / `http://localhost` origins
   the native WebView serves from.
4. **All backend calls go through the data service layer.** No render function
   or screen calls `fetch()` or names an API URL directly. Everything goes
   through `www/js/data-service.js`, which builds every URL from
   `API_BASE_URL` in `www/js/config.js`. See Data layer.
5. **The `/api` directory deploys to Vercel and is never packaged into the
   native app.** It lives at the repo root, *outside* `www/`, on purpose. It
   holds the server-side API keys. Never move it into `www/`, never put a key
   in `www/`, never commit a key.
6. **Flag anything that would break in an offline native WebView** — a new CDN
   dependency, an absolute path, a hardcoded `http(s)://` resource, a call that
   assumes the network is up. When in doubt, vendor it and use a relative path.

## Architecture

Three plain global scripts load in order (no modules, no bundler); inline
`onclick` handlers call functions off the global scope:

```
config.js  →  data-service.js  →  app.js
(switches)    (the only data door)  (state + render)
```

- **`www/js/config.js`** — two switches:
  - `DATA_SOURCE`: `'local'` (bundled sample data, the shipping default) or
    `'api'` (live). **Flip this to `'api'` when the Racing Australia key is
    live** — that's the whole switch; no screen changes.
  - `API_BASE_URL`: `''` for the web app (same-origin `/api`); the full Vercel
    origin (e.g. `https://rnsw-app.vercel.app`) for the native build, where
    `/api` is not the deployment. No trailing slash.
  - Plus per-domain cache TTLs and request timeout.

- **`www/js/data-service.js`** — the single door to data. Holds all the local
  sample data and one method per domain (`getRaceDays`, `getResults`,
  `searchHorses`, `getHorseProfile`, `getJockeys`, `getTrainers`, `getNews`,
  `getUpcomingEvents`, `getVideos`, `getPodcasts`, `getRaceDiary`,
  `getRaceReplays`, plus leaderboard/tickets/activations/live-feed/course-map/
  network, and `askDash`). Every method resolves the same envelope —
  `{data, source, fetchedAt, stale, error}` — and **never rejects**. In `api`
  mode it calls our own `/api/racing/*` proxy (never Racing Australia directly)
  and degrades **fresh cache → stale cache → bundled local data** on failure,
  so a screen can always render something. To add a data-backed screen, add a
  method here — don't reach for `fetch` elsewhere.

- **`www/js/app.js`** — app state + render functions only, **zero data**. At
  boot, `loadAppData()` pulls every domain into the `DATA` snapshot (painting
  loading skeletons first), then `renderAll()` paints. Render functions read
  `DATA` synchronously. `META[domain]` carries freshness for the "last updated"
  indicators.

## The `/api` Vercel proxy (repo root, not shipped in the app)

- `api/racing/[...path].js` — forwards `/api/racing/*` to the Racing Australia
  API, reading `RACING_API_KEY` from the environment. Until the key is set it
  returns a clear `503` stub and the app falls back to local data. Per-data-type
  `Cache-Control` (schedules hours, results ~a minute).
- `api/dash.js` — proxies the Dash companion to the Anthropic API
  (`ANTHROPIC_API_KEY`, model `claude-opus-4-8`, override with `DASH_MODEL`).
- Env vars documented in `.env.example`. `.env` is gitignored — never commit
  keys. One thing to confirm when the real API arrives: the upstream base URL
  (`RACING_API_BASE`) and auth header (`RACING_API_AUTH_HEADER`).
- Deploy layout is in `vercel.json` (`outputDirectory: "www"`, functions under
  `api/`). The Vercel project's **Root Directory must be the repo root**, not
  `www`, or the functions won't deploy.

## Fonts & branding

- **Helvetica Neue is the app's only typeface**, vendored as subsetted woff2 in
  `www/assets/fonts/` (`hn-*.woff2`). `@font-face` is in `www/css/app.css`:
  family `"Helvetica Neue"` for body (200–700 + italics), `"Helvetica Neue
  Condensed"` for the `.display` headings. Emoji render on the OS font (not
  subset in).
- **The Golden Mingle** (`www/golden-mingle.html`, a standalone embedded page)
  is the one exception to the single typeface: it uses **Cormorant Garamond**
  (OFL, vendored variable woff2) for display and Helvetica Neue for body — its
  own editorial look, also fully offline.
- **Logo**: `www/assets/rnsw-logo.png` (white+blue lockup) replaces the "Racing
  NSW" wordmark in the header, auth gate, and onboarding. Contextual "Racing
  NSW" copy stays as text.
- Note: Helvetica Neue is a proprietary Apple/Monotype font supplied by the
  project owner. Redistribution licensing for the app-store build is the
  owner's responsibility.

## Commands

```bash
npm run serve      # static dev server on http://localhost:5173
npm run build:css  # rebuild www/css/tailwind.css after adding utility classes
npm run sync       # npx cap sync (copy www into the native projects)
npm run ios        # cap sync + open Xcode
npm run android    # cap sync + open Android Studio
```

**Tailwind is compiled, not CDN.** `www/css/tailwind.css` is tree-shaken from
the class names in `index.html` + `app.js` by `tailwind.config.cjs`. After
adding or changing utility classes (including arbitrary values like
`text-[18px]`), run `npm run build:css` or the new classes won't have styles.
