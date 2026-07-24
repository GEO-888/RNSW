/* ════════════════════════════════════════════════════════════════
   RACING NSW · Dash companion proxy  ·  /api/dash
   ----------------------------------------------------------------
   Dash (the in-app AI helper) POSTs {messages, system} here; this
   function calls the Anthropic Messages API with the key held
   server-side and returns {text}. The app (www/js/data-service.js →
   askDash) never sees the key, and www/ contains no absolute API URL.

   Raw fetch, no SDK — this stays a zero-dependency function so the
   /api directory adds nothing to install and is never bundled into
   the native app.

   UNTIL THE KEY EXISTS
     With ANTHROPIC_API_KEY unset, returns a 503 "API key not
     configured" stub. Dash then falls back to its on-device keyword
     knowledge base (localAnswer), so the chat UI is unchanged.

   MODEL
     Defaults to claude-opus-4-8. Override with DASH_MODEL — e.g. set
     it to claude-haiku-4-5 for a cheaper, faster helper — without a
     code change. See .env.example.
   ════════════════════════════════════════════════════════════════ */

'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function readBody(req) {
  // Vercel usually parses JSON into req.body, but fall back to reading the
  // stream so this works regardless of body-parser config.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: 'API key not configured',
      detail: 'ANTHROPIC_API_KEY is not set. Dash falls back to its ' +
              'on-device knowledge base.',
    });
  }

  const body = await readBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : null;
  const system = typeof body.system === 'string' ? body.system : undefined;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

  const model = process.env.DASH_MODEL || 'claude-opus-4-8';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream error', status: upstream.status });
    }

    const data = await upstream.json();
    // Concatenate the text blocks of the reply.
    const text = Array.isArray(data.content)
      ? data.content.filter(b => b && b.type === 'text').map(b => b.text).join('')
      : '';

    if (!text) return res.status(502).json({ error: 'Empty reply' });
    return res.status(200).json({ text });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Upstream timeout' : 'Proxy error',
    });
  }
};
