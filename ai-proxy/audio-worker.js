// NougÆn IS rhythm-game audio proxy (Cloudflare Worker, standalone).
//
// Why this exists: Google Drive answers MP3 downloads with
// Content-Disposition: attachment and Cross-Origin-Resource-Policy:
// same-site, which makes browsers (notably iOS Safari) refuse to play
// them in an <audio> element. This worker fetches the file server-side
// and re-serves it with clean media headers (Range requests forwarded,
// so seeking/streaming works).
//
// It is a separate worker from kvw-ai-proxy on purpose: it holds no
// secrets and no env vars, so deploying it can never disturb the AI
// proxy. Only the AUDIO_IDS below are proxied; the files themselves
// are link-shared on Drive, so the proxy exposes nothing beyond what
// link sharing already does.
//
// Deployed as: https://nougaen-audio-proxy.aokassy.workers.dev

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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/audio") {
      return new Response("Not Found", { status: 404 });
    }
    const id = url.searchParams.get("id") || "";
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
  },
};
