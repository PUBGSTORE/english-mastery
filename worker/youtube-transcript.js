// Cloudflare Worker — YouTube transcript proxy for English Mastery (personal study use only).
// Deploy: dash.cloudflare.com → Workers & Pages → Create → Start with Hello World → Edit code → paste this → Deploy.
// Then put the worker URL into Settings → Video miner → Transcript proxy URL (or it is already the app default).
// GET /?v=<videoId>[&lang=en]  →  { videoId, title, channel, lang, auto, segments: [{ t: seconds, d: duration, text }] }
//
// Why InnerTube: since 2025 the caption URLs embedded in the watch page return empty bodies to non-browser
// clients (they need a proof-of-origin token). The player API used by the Android/iOS apps still returns working ones.

const ALLOW = '*'; // restrict to your GitHub Pages origin if you like: 'https://<user>.github.io'
const CLIENTS = [
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', id: 3, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', hl: 'en', id: 5, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
];

export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': ALLOW, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const v = (url.searchParams.get('v') || '').trim();
    const wantLang = (url.searchParams.get('lang') || 'en').toLowerCase();
    if (!/^[\w-]{11}$/.test(v)) return json({ error: 'missing or invalid ?v=<videoId>' }, 400, cors);
    let lastErr = 'no captions on this video'; let title = '', channel = '';
    for (const c of CLIENTS) {
      try {
        const { id, ua, ...client } = c;
        const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'X-YouTube-Client-Name': String(id), 'X-YouTube-Client-Version': client.clientVersion },
          body: JSON.stringify({ context: { client }, videoId: v, contentCheckOk: true, racyCheckOk: true }),
        });
        const d = await res.json();
        title = title || d.videoDetails?.title || ''; channel = channel || d.videoDetails?.author || '';
        const status = d.playabilityStatus?.status;
        if (status && status !== 'OK') { lastErr = d.playabilityStatus?.reason || status; continue; }
        const tracks = d.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!tracks.length) { lastErr = 'no captions on this video'; continue; }
        const track = tracks.find((t) => t.languageCode === wantLang && !t.kind) || tracks.find((t) => t.languageCode === wantLang) || tracks.find((t) => (t.languageCode || '').startsWith('en')) || tracks[0];
        const xml = await (await fetch(track.baseUrl + (track.baseUrl.includes('fmt=') ? '' : '&fmt=srv3'), { headers: { 'User-Agent': ua } })).text();
        const segments = parse(xml);
        if (!segments.length) { lastErr = 'caption track was empty'; continue; }
        return json({ videoId: v, title, channel, lang: track.languageCode, auto: !!track.kind, segments }, 200, cors);
      } catch (e) { lastErr = String((e && e.message) || e); }
    }
    return json({ error: lastErr, title, channel }, /no captions|empty/i.test(lastErr) ? 404 : 502, cors);
  },
};

function parse(xml) {
  const out = []; let x;
  const re = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  while ((x = re.exec(xml))) { const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) out.push({ t: +x[1] / 1000, d: +(x[2] || 0) / 1000, text }); }
  if (!out.length) { const re2 = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g; while ((x = re2.exec(xml))) { const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) out.push({ t: +x[1], d: +(x[2] || 0), text }); } }
  return out;
}
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers }); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
