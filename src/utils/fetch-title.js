const SOCIAL_SUFFIXES = /\s*[|\-–]\s*(TikTok|Instagram|Facebook|Google Maps|YouTube|LINE|X|Twitter|Wongnai|วงใน).*$/i;
const HTML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&quot;': '"' };

function decodeEntities(str) {
  return str.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m] || m);
}

function cleanTitle(raw) {
  return decodeEntities(raw.replace(SOCIAL_SUFFIXES, '').trim());
}

async function fetchPageTitle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:title (two attribute orderings)
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:title["']/i)?.[1];
    if (og) return cleanTitle(og);

    // <title> fallback
    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1];
    return title ? cleanTitle(title) : null;
  } catch {
    return null;
  }
}

module.exports = { fetchPageTitle };
