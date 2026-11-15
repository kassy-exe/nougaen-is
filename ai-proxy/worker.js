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
