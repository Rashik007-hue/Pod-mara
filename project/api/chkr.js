// api/chkr.js — Vercel Serverless Function
// Converted from Cloudflare Worker
// Rate limit: chkr.cc allows 5 requests per 10 seconds

// ─── Helper Functions ────────────────────────────────────────────────────────

function jsonResponse(res, data, status = 200) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return res.json(data);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── chkr.cc API Call with Retry on 429 ─────────────────────────────────────

async function callChkrAPI(ccData, retries = 3) {
  const headers = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json; charset=utf-8",
    "origin": "https://chkr.cc",
    "priority": "u=1, i",
    "referer": "https://chkr.cc/",
    "sec-ch-ua": '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.chkr.cc/", {
        method: "POST",
        headers,
        body: JSON.stringify({ data: ccData, charge: false })
      });

      if (response.status === 429) {
        const resetAfter = parseInt(response.headers.get("ratelimit-reset") || "10");
        if (attempt < retries) {
          await sleep((resetAfter + 1) * 1000);
          continue;
        }
        return {
          ok: false, status: 429,
          data: {
            error: "Rate limit exceeded",
            retry_after_seconds: resetAfter,
            tip: "chkr.cc allows 5 requests per 10 seconds"
          }
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const raw = await response.text();
        try { data = JSON.parse(raw); } catch (_) { data = { raw }; }
      }

      const remaining = response.headers.get("ratelimit-remaining");
      const reset     = response.headers.get("ratelimit-reset");
      if (remaining !== null) {
        data._ratelimit = {
          remaining: parseInt(remaining),
          reset_in: parseInt(reset || "0") + "s"
        };
      }

      return { ok: true, status: response.status, data };

    } catch (e) {
      if (attempt === retries) {
        return { ok: false, status: 500, data: { error: `Request failed: ${e.message}` } };
      }
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

    // CORS Preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin",  "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      return res.status(204).end();
    }

    // Vercel rewrite: /api/chkr and /api/batch both hit this function
    // Route by pathname suffix
    const isBatch = path.endsWith("/batch");
    const isChkr  = path.endsWith("/chkr") || path === "/api" || path === "/api/index";

    // 1. Home
    if (!isBatch && !isChkr) {
      return jsonResponse(res, {
        service: "chkr.cc Vercel Function",
        status: "running",
        usage: {
          single: "GET /api/chkr?cc=NUMBER|MM|YYYY|CVV",
          batch:  "POST /api/batch  body: { cards: ['cc1','cc2',...] }"
        },
        ratelimit: "5 requests/10s — auto-retry on 429"
      });
    }

    // 2. /api/chkr
    if (isChkr) {
      let ccData;

      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        ccData = body?.cc || body?.data;
      } else {
        ccData = params.get("cc") || params.get("data");
      }

      if (!ccData) {
        return jsonResponse(res, { error: "Missing 'cc' parameter. Format: NUMBER|MM|YYYY|CVV" }, 400);
      }

      const result = await callChkrAPI(ccData);
      return jsonResponse(res, result.data, result.status);
    }

    // 3. /api/batch
    if (isBatch) {
      if (req.method !== "POST") {
        return jsonResponse(res, { error: "Batch endpoint requires POST" }, 405);
      }

      let cards;
      try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        cards = body?.cards;
      } catch (_) {
        return jsonResponse(res, { error: "Invalid JSON body" }, 400);
      }

      if (!Array.isArray(cards) || cards.length === 0) {
        return jsonResponse(res, { error: "Provide 'cards' array" }, 400);
      }

      if (cards.length > 10) {
        return jsonResponse(res, { error: "Max 10 cards per batch request" }, 400);
      }

      const results = [];
      for (const cc of cards) {
        const result = await callChkrAPI(cc);
        results.push({ cc, ...result.data });
        await sleep(2100);
      }

      return jsonResponse(res, { results, total: cards.length });
    }

    return jsonResponse(res, { error: "Route not found", path, routes: ["/api/chkr", "/api/batch"] }, 404);

  } catch (e) {
    return jsonResponse(res, { error: `Function Error: ${e.message}` }, 500);
  }
        }
