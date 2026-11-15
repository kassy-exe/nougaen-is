// KVW -> NougÆn IS AI proxy (Cloudflare Worker)
//
// Why this exists: a static page can never hide an API key. Anything
// written into the page (like KVW's original code did) is public and
// will be abused. This worker keeps the Gemini API key on the server:
//
//   browser --(no key)--> this worker --(key from secret)--> Gemini API
//
// Production status (2026-11-15): this worker is deployed as the shared
// "kvw-ai-proxy" (https://kvw-ai-proxy.aokassy.workers.dev) and serves
// both KVW and NougÆn IS. NougÆn IS uses it as its built-in default
// proxy, so no per-user setup is needed. Its ALLOWED_ORIGINS var is:
//   https://a1234567890987654321a-kvw-for-school.static.hf.space,https://nougaen-is.vercel.app
//
// It also serves GET /audio?id=<drive-file-id> for the NougÆn IS rhythm
// game: Google Drive answers MP3 downloads with Content-Disposition:
// attachment and Cross-Origin-Resource-Policy: same-site, which makes
// browsers (notably iOS Safari) refuse to play them in an <audio>
// element. The worker fetches the file server-side and re-serves it
// with clean media headers. Only the AUDIO_IDS below are proxied.
//
// Setup (for a fresh deployment):
//   1. wrangler secret put GEMINI_API_KEY      (never commit the key)
//   2. Set the ALLOWED_ORIGINS var to the sites' origins, comma-separated
//   3. wrangler deploy
//   4. Or paste the worker URL into NougÆn IS -> AI -> Connection -> Proxy URL
//
// Notes:
//   - Origin checking is not real authentication, it just stops casual
//     cross-site use. Also set a quota / API restriction on the key in
//     Google Cloud, and consider a Cloudflare rate-limiting rule.
//   - The worker only forwards the fields the AI feature uses, caps the
//     request size, and never logs bodies or the key.

const MODEL = "gemini-flash-lite-latest"; // keep in sync with index.html
const MAX_BODY_BYTES = 256 * 1024;

// The rhythm game's 9 MP3 files on Google Drive (link-shared, reader).
// The proxy exposes nothing beyond what link sharing already does; the
// allowlist just keeps the route from becoming a general Drive proxy.
const AUDIO_IDS = [
  "1HI01ykWI4yvLPwOY98w90eegDJqYP_Pv", // 準透明少年
  "1y8bkzJb1k_oPz7RIg2KthUTSEZx5IEHR", // 靴の花火
  "1V6fjuk40A3N23qOC6h2gV18gspPfWMnt", // 冬眠
  "1qAk8JInMEOFatfmBv5sGYpqO1CnP7HRs", // あの夏に咲け
  "1vFVO43X9mUyD2l4xDyyjuAoJOP5Qix9o", // 言って。
  "1GXMbmuC9G7_FDqa4HH5xrmnUTUXy_xaY", // 藍二乗
  "1QzgSbXFjPMYuuGeEU3h90NJxAZ0m0Vaq", // ヒッチコック
  "1Wl70MrDNY75-UBHIHHhbTOBv3o2mhgIW", // 負け犬にアンコールはいらない
  "1kfOIQxKaa_GYK7NPVHzFZ5UgYm7MdCzc", // ただ君に晴れ
];

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    // Normalize trailing slashes: Origin headers never carry one, but a
    // hand-typed ALLOWED_ORIGINS entry easily ends up with one, and the
    // exact match then silently fails (this bit us on 2026-11-15).
    const norm = (s) => s.trim().replace(/\/+$/, "");
    const origin = norm(request.headers.get("Origin") || "");
    const allowed = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map(norm)
      .filter(Boolean);

    if (request.method === "OPTIONS") {
      if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Rhythm-game audio proxy (see the header comment). Media loads do
    // not run preflights, and the files are link-shared anyway, so this
    // route is gated by the AUDIO_IDS allowlist rather than by Origin.
    const reqUrl = new URL(request.url);
    if (request.method === "GET" && reqUrl.pathname === "/audio") {
      const id = reqUrl.searchParams.get("id") || "";
      if (!AUDIO_IDS.includes(id)) {
        return new Response("Not Found", { status: 404 });
      }
      const fwd = {};
      const range = request.headers.get("Range");
      if (range) fwd["Range"] = range;
      const up = await fetch(
        "https://drive.usercontent.google.com/download?id=" +
          encodeURIComponent(id) +
          "&export=download&authuser=0",
        { headers: fwd }
      );
      const headers = {
        "content-type": "audio/mpeg",
        "access-control-allow-origin": "*",
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=3600",
      };
      const len = up.headers.get("content-length");
      if (len) headers["content-length"] = len;
      const cr = up.headers.get("content-range");
      if (cr) headers["content-range"] = cr;
      return new Response(up.body, { status: up.status, headers });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!allowed.includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!env.GEMINI_API_KEY) {
      return new Response("Proxy is not configured", { status: 500 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return new Response("Payload Too Large", { status: 413 });
    }

    let incoming;
    try {
      incoming = JSON.parse(raw);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // Forward only the fields the chat feature is allowed to use.
    const body = {};
    if (Array.isArray(incoming.contents)) body.contents = incoming.contents;
    if (incoming.systemInstruction) body.systemInstruction = incoming.systemInstruction;
    if (Array.isArray(incoming.tools)) body.tools = incoming.tools;
    if (!body.contents) {
      return new Response("Bad Request", { status: 400 });
    }

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  },
};
