// api/chkr.js — Vercel Function with developer lock + anti-theft protection

// ─── DEVELOPER CONFIG ───────────────────────────────────────────────────────
const DEV_LOCK = {
  // Only these secrets can call the API. Change these before deploy.
  API_KEYS: [
    "RASHIK69-9X7K2M-4P8Q1L-3Z5W0N",   // key 1
    "RASHIK69-B8T3Y6-2R7E4H-9K1M5V"    // key 2
  ],
  // Only these origins/referers are allowed (empty = allow all)
  ALLOWED_ORIGINS: [],
  
  // Signature salt for HMAC — used to sign responses
  SIGN_SALT: "RASHIK_SIG_2026_x9Qp3Lm7Z",
  // Watermark injected into every response so stolen copies can be traced
  WATERMARK: "@RASHIK_69"
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function jsonResponse(res, data, status = 200, extraHeaders = {}) {
  const payload = { ...data, _owner: DEV_LOCK.WATERMARK };
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("X-Powered-By", DEV_LOCK.WATERMARK);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  return res.json(payload);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// HMAC-SHA256 signature (Web Crypto — available in Node 18+ on Vercel)
async function signBody(bodyString) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(DEV_LOCK.SIGN_SALT),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(bodyString));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Extract API key from query, header, or body
function extractKey(req, params, body) {
  return (
    req.headers["x-api-key"] ||
    params.get("key") ||
    (body && body.key) ||
    null
  );
}

// Origin / referer check
function originAllowed(req) {
  if (!DEV_LOCK.ALLOWED_ORIGINS.length) return true;
  const origin  = req.headers["origin"] || "";
  const referer = req.headers["referer"] || "";
  return DEV_LOCK.ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
}

// ─── chkr.cc API Call ───────────────────────────────────────────────────────
async function callChkrAPI(ccData, retries = 3) {
  const headers = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json; charset=utf-8",
    "origin": "https://chkr.cc",
    "referer": "https://chkr.cc/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch("https://api.chkr.cc/", {
        method: "POST", headers,
        body: JSON.stringify({ data: ccData, charge: false })
      });

      if (r.status === 429) {
        const resetAfter = parseInt(r.headers.get("ratelimit-reset") || "10");
        if (attempt < retries) { await sleep((resetAfter + 1) * 1000); continue; }
        return { ok: false, status: 429, data: { error: "Rate limit exceeded", retry_after_seconds: resetAfter } };
      }

      const ct = r.headers.get("content-type") || "";
      let data;
      if (ct.includes("application/json")) data = await r.json();
      else { const raw = await r.text(); try { data = JSON.parse(raw); } catch { data = { raw }; } }

      const rem = r.headers.get("ratelimit-remaining");
      const rst = r.headers.get("ratelimit-reset");
      if (rem !== null) data._ratelimit = { remaining: parseInt(rem), reset_in: parseInt(rst || "0") + "s" };

      return { ok: true, status: r.status, data };
    } catch (e) {
      if (attempt === retries) return { ok: false, status: 500, data: { error: `Request failed: ${e.message}` } };
      await sleep(2000 * attempt);
    }
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const url    = new URL(req.url, `http://${req.headers.host}`);
    const path   = url.pathname;
    const params = url.searchParams;

    // CORS preflight — no auth needed
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      return res.status(204).end();
    }

    // Parse body once
    let body = null;
    if (req.method === "POST") {
      try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { body = null; }
    }

    // ─── AUTH LAYER 1: API key ─────────────────────────────────────────────
    const key = extractKey(req, params, body);
    if (!key || !DEV_LOCK.API_KEYS.includes(key)) {
      return jsonResponse(res, {
        code: 401,
        status: "Denied",
        message: "Invalid or missing API key. This API belongs to RASHIK_69."
      }, 401);
    }

    // ─── AUTH LAYER 2: Origin / Referer ────────────────────────────────────
    if (!originAllowed(req)) {
      return jsonResponse(res, {
        code: 403,
        status: "Denied",
        message: "Origin not allowed. Contact owner RASHIK_69."
      }, 403);
    }

    const isBatch = path.endsWith("/batch");
    const isChkr  = path.endsWith("/chkr") || path === "/api" || path === "/api/index";

    // ─── ROUTE: /api/chkr (single) ─────────────────────────────────────────
    if (isChkr) {
      let ccData = req.method === "POST"
        ? (body?.cc || body?.data)
        : (params.get("cc") || params.get("data"));

      if (!ccData) return jsonResponse(res, { error: "Missing 'cc' parameter. Format: NUMBER|MM|YYYY|CVV" }, 400);

      const result = await callChkrAPI(ccData);
      const signed = await signBody(JSON.stringify(result.data));
      return jsonResponse(res, result.data, result.status, { "X-Signature": signed });
    }

    // ─── ROUTE: /api/batch ─────────────────────────────────────────────────
    if (isBatch) {
      if (req.method !== "POST") return jsonResponse(res, { error: "Batch endpoint requires POST" }, 405);

      const cards = body?.cards;
      if (!Array.isArray(cards) || cards.length === 0)
        return jsonResponse(res, { error: "Provide 'cards' array" }, 400);
      if (cards.length > 10)
        return jsonResponse(res, { error: "Max 10 cards per batch request" }, 400);

      const results = [];
      for (const cc of cards) {
        const r = await callChkrAPI(cc);
        results.push({ cc, ...r.data });
        await sleep(2100);
      }

      const signed = await signBody(JSON.stringify(results));
      return jsonResponse(res, { results, total: cards.length }, 200, { "X-Signature": signed });
    }

    // ─── Default: info (still needs key) ───────────────────────────────────
    return jsonResponse(res, {
      service: "chkr.cc API — Owner: RASHIK_69",
      status: "running",
      usage: {
        single: "GET /api/chkr?cc=NUMBER|MM|YYYY|CVV&key=YOUR_KEY",
        batch:  "POST /api/batch  body: { key, cards: [...] }"
      },
      ratelimit: "5 requests/10s — auto-retry on 429"
    });

  } catch (e) {
    return jsonResponse(res, { error: `Function Error: ${e.message}` }, 500);
  }
          }
