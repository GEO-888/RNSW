// ============================================================
// sync-news — Supabase Edge Function
// Fetches the Racing NSW news RSS feed and upserts new items
// into public.news_stories. Designed to be invoked hourly by
// pg_cron (see supabase/setup-sync-news.sql), but also works as
// a manual POST for testing — it returns JSON stats either way.
//
// Env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by
// the platform automatically):
//   NEWS_RSS_URL   the RSS/Atom feed to poll.
//                  Set with: supabase secrets set NEWS_RSS_URL="..."
//                  Confirm the real Racing NSW feed URL before relying on it.
//
// Dedupe: upserts on the unique `url` column (added in setup SQL).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4";

const RSS_URL = Deno.env.get("NEWS_RSS_URL") ?? "https://www.racingnsw.com.au/feed/";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Normalise a value that fast-xml-parser may hand back as string | number | { "#text": ... }. */
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"]);
  return "";
}

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** RSS <link>text</link> or Atom <link href="..."/> (possibly an array). */
function pickLink(it: Record<string, unknown>): string {
  const l = it.link;
  if (typeof l === "string") return l.trim();
  if (Array.isArray(l)) {
    const alt = l.find((x) => x?.["@_rel"] === "alternate") ?? l.find((x) => x?.["@_href"]) ?? l[0];
    return (alt?.["@_href"] ?? text(alt)).trim();
  }
  if (l && typeof l === "object") {
    const o = l as Record<string, unknown>;
    return (String(o["@_href"] ?? "") || text(o)).trim();
  }
  return "";
}

/** "16 Jun" to match the shape renderStories() already expects. */
function fmtLabel(d: Date): string | null {
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

type NewsRow = {
  title: string;
  url: string;
  tag: string | null;
  published_label: string | null;
  sort_order: number;
};

function mapItem(it: Record<string, unknown>): NewsRow {
  const title = clean(text(it.title));
  const url = clean(pickLink(it));

  let category = it.category;
  if (Array.isArray(category)) category = category[0];
  const tag = clean(text(category)).toUpperCase().slice(0, 40) || "NEWS";

  const pub = text(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]);
  const d = pub ? new Date(pub) : null;
  const published_label = d ? fmtLabel(d) : null;

  // Newest first when the app orders by sort_order ascending:
  // negative minutes-since-epoch → newer items get the smaller value.
  const sort_order = d && !isNaN(d.getTime()) ? -Math.floor(d.getTime() / 60000) : 0;

  return { title, url, tag, published_label, sort_order };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const res = await fetch(RSS_URL, {
      headers: { "user-agent": "RacingNSW-App/1.0 (+news-sync)", "accept": "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    const xml = await res.text();

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });
    const doc = parser.parse(xml);

    // Support both RSS (rss.channel.item) and Atom (feed.entry).
    const rawItems = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    // Map, keep only usable rows, and dedupe by url within this batch.
    const seen = new Set<string>();
    const rows = items
      .map(mapItem)
      .filter((r) => r.title && r.url)
      .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));

    if (rows.length === 0) {
      return json({ ok: true, fetched: items.length, upserted: 0, message: "no usable items" });
    }

    const { data, error } = await supabase
      .from("news_stories")
      .upsert(rows, { onConflict: "url" })
      .select("id");

    if (error) throw error;

    return json({ ok: true, feed: RSS_URL, fetched: items.length, upserted: data?.length ?? 0 });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
