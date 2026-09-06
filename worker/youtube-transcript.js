// Cloudflare Worker — YouTube transcript proxy for English Mastery (personal study use only).
// Deploy: dash.cloudflare.com → Workers & Pages → Create → paste this file → Deploy.
// Then put the worker URL (e.g. https://yt-transcript.<you>.workers.dev) into Settings → Transcript proxy URL.
// GET /?v=<videoId>[&lang=en]  →  { videoId, title, lang, segments: [{ t: seconds, d: duration, text }] }

const ALLOW = '*'; // restrict to your GitHub Pages origin if you like: 'https://<user>.github.io'

export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': ALLOW, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const v = (url.searchParams.get('v') || '').trim();
    const wantLang = (url.searchParams.get('lang') || 'en').toLowerCase();
    if (!/^[\w-]{11}$/.test(v)) return json({ error: 'missing or invalid ?v=<videoId>' }, 400, cors);
    try {
      const page = await (await fetch(`https://www.youtube.com/watch?v=${v}&hl=en`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'en' } })).text();
      const title = (page.match(/<title>(.*?)<\/title>/) || [])[1]?.replace(/ - YouTube$/, '') || '';
      const m = page.match(/"captionTracks":(\[.*?\])/);
      if (!m) return json({ error: 'no captions on this video', title }, 404, cors);
      const tracks = JSON.parse(m[1]);
      const track = tracks.find((t) => t.languageCode === wantLang && !t.kind) || tracks.find((t) => t.languageCode === wantLang) || tracks.find((t) => (t.languageCode || '').startsWith('en')) || tracks[0];
      const xml = await (await fetch(track.baseUrl + '&fmt=srv3')).text();
      const segments = [];
      const re = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
      let x;
      while ((x = re.exec(xml))) {
        const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (text) segments.push({ t: +x[1] / 1000, d: +(x[2] || 0) / 1000, text });
      }
      if (!segments.length) { // fallback: legacy format
        const re2 = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
        const xml2 = await (await fetch(track.baseUrl)).text();
        while ((x = re2.exec(xml2))) { const text = decode(x[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text) segments.push({ t: +x[1], d: +(x[2] || 0), text }); }
      }
      return json({ videoId: v, title, lang: track.languageCode, auto: !!track.kind, segments }, 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  },
};
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers }); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
