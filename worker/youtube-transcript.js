// Cloudflare Worker — YouTube transcript proxy for English Mastery (personal study use only).
// Deploy: dash.cloudflare.com → Workers & Pages → Create → Start with Hello World → Edit code → paste this → Deploy.
// Then put the worker URL into Settings → Video miner → Transcript proxy URL (or it is already the app default).
// GET /?v=<videoId>[&lang=en]  →  { videoId, title, channel, lang, auto, segments: [{ t: seconds, d: duration, text }] }
//
// Why InnerTube: since 2025 the caption URLs embedded in the watch page return empty bodies to non-browser
// clients (they need a proof-of-origin token). The player API used by the Android/iOS apps still returns working ones.

// Only the app's origins may call this worker (plus localhost for development). Anything else gets no CORS header, so browsers block it.
const ALLOWED_ORIGINS = ['https://pubgstore.github.io', 'http://127.0.0.1:8123', 'http://localhost:8123', 'http://localhost:8080', 'http://127.0.0.1:8080'];
// Fallback when YouTube bot-checks Cloudflare's IPs: public Piped instances (community-run; the list is tried in order).
const PIPED = ['https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.yt', 'https://pipedapi.drgns.space'];
// Several clients are tried in order: datacenter IPs get bot-checked on some of them.
const CLIENTS = [
  { clientName: 'ANDROID_VR', clientVersion: '1.62.27', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', id: 28, ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip' },
  { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', id: 5, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'en', id: 3, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', id: 85, ua: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15', embed: true },
  { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250901.01.00', hl: 'en', id: 56, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', embed: true },
  { clientName: 'MWEB', clientVersion: '2.20250901.01.00', hl: 'en', id: 2, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = { ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!allowed) return json({ error: 'origin not allowed' }, 403, cors); // browsers always send Origin on cross-site fetch; scripts without it are refused too
    const url = new URL(request.url);
    const v = (url.searchParams.get('v') || '').trim();
    const wantLang = (url.searchParams.get('lang') || 'en').toLowerCase();
    if (!/^[\w-]{11}$/.test(v)) return json({ error: 'missing or invalid ?v=<videoId>' }, 400, cors);
    const debug = url.searchParams.get('debug') === '1';
    let lastErr = 'no captions on this video'; let title = '', channel = ''; const trace = [];
    for (const c of CLIENTS) {
      try {
        const { id, ua, embed, ...client } = c;
        const body = { context: { client, ...(embed ? { thirdParty: { embedUrl: 'https://www.youtube.com/' } } : {}) }, videoId: v, contentCheckOk: true, racyCheckOk: true };
        const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'X-YouTube-Client-Name': String(id), 'X-YouTube-Client-Version': client.clientVersion, Origin: 'https://www.youtube.com', ...(embed ? { Referer: 'https://www.youtube.com/' } : {}) },
          body: JSON.stringify(body),
        });
        const txt = await res.text();
        let d; try { d = JSON.parse(txt); } catch { lastErr = `${client.clientName}: non-JSON response (${res.status})`; trace.push(lastErr); continue; }
        title = title || d.videoDetails?.title || ''; channel = channel || d.videoDetails?.author || '';
        const status = d.playabilityStatus?.status;
        if (status && status !== 'OK') { lastErr = `${client.clientName}: ${d.playabilityStatus?.reason || status}`; trace.push(lastErr); continue; }
        const tracks = d.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!tracks.length) { lastErr = 'no captions on this video'; trace.push(`${client.clientName}: OK but 0 tracks`); continue; }
        const track = tracks.find((t) => t.languageCode === wantLang && !t.kind) || tracks.find((t) => t.languageCode === wantLang) || tracks.find((t) => (t.languageCode || '').startsWith('en')) || tracks[0];
        const xml = await (await fetch(track.baseUrl + (track.baseUrl.includes('fmt=') ? '' : '&fmt=srv3'), { headers: { 'User-Agent': ua } })).text();
        const segments = parse(xml);
        if (!segments.length) { lastErr = 'caption track was empty'; trace.push(`${client.clientName}: ${tracks.length} tracks, empty body`); continue; }
        return json({ videoId: v, title, channel, lang: track.languageCode, auto: !!track.kind, client: client.clientName, segments, ...(debug ? { trace } : {}) }, 200, cors);
      } catch (e) { lastErr = String((e && e.message) || e); trace.push(`${c.clientName}: ${lastErr}`); }
    }
    // Piped fallback
    for (const base of PIPED) {
      try {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(`${base}/streams/${v}`, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }); clearTimeout(tm);
        if (!r.ok) { trace.push(`piped ${base}: ${r.status}`); continue; }
        const d = await r.json();
        title = title || d.title || ''; channel = channel || d.uploader || '';
        const subs = d.subtitles || [];
        if (!subs.length) { trace.push(`piped ${base}: 0 subtitles`); if (d.title) { lastErr = 'no captions on this video'; break; } continue; }
        const sub = subs.find((x) => x.code === wantLang && !x.autoGenerated) || subs.find((x) => x.code === wantLang) || subs.find((x) => (x.code || '').startsWith('en')) || subs[0];
        const body = await (await fetch(sub.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
        const segments = parse(body);
        if (!segments.length) { trace.push(`piped ${base}: empty subtitle body`); continue; }
        return json({ videoId: v, title, channel, lang: sub.code, auto: !!sub.autoGenerated, client: 'piped', segments, ...(debug ? { trace } : {}) }, 200, cors);
      } catch (e) { trace.push(`piped ${base}: ${String((e && e.message) || e)}`); }
    }
    const noCap = (trace.some((t) => /0 tracks|0 subtitles/.test(t)) && !trace.some((t) => /tracks, empty/.test(t))) || /no captions/.test(lastErr);
    return json({ error: noCap ? 'no captions on this video' : lastErr, title, channel, ...(debug ? { trace } : {}) }, noCap ? 404 : 502, cors);
  },
};

function parse(xml) {
  const out = []; let x;
  const re = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  while ((x = re.exec(xml))) { const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) out.push({ t: +x[1] / 1000, d: +(x[2] || 0) / 1000, text }); }
  if (!out.length) { const re2 = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g; while ((x = re2.exec(xml))) { const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) out.push({ t: +x[1], d: +(x[2] || 0), text }); } }
  if (!out.length) { // TTML (Piped): <p begin="00:00:04.220" end="00:00:05.400">text</p>
    const re3 = /<p[^>]*begin="([\d:.]+)"[^>]*end="([\d:.]+)"[^>]*>([\s\S]*?)<\/p>/g;
    const toS = (t) => t.split(':').reduce((a, b) => a * 60 + parseFloat(b), 0);
    while ((x = re3.exec(xml))) { const text = decode(x[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) out.push({ t: toS(x[1]), d: Math.max(0, toS(x[2]) - toS(x[1])), text }); }
  }
  if (!out.length && /-->/.test(xml)) { // WebVTT
    for (const block of xml.split(/\n\s*\n/)) { const m = block.match(/(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/); if (!m) continue; const toS = (h, mi, s, ms) => (+(h || '0').replace(':', '')) * 3600 + +mi * 60 + +s + +ms / 1000; const t = toS(m[1], m[2], m[3], m[4]); const e = toS(m[5], m[6], m[7], m[8]); const text = block.split('\n').filter((l) => !/-->/.test(l) && !/^\d+$/.test(l.trim()) && !/^WEBVTT/.test(l)).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (text) out.push({ t, d: Math.max(0, e - t), text }); }
  }
  return out;
}
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers }); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
