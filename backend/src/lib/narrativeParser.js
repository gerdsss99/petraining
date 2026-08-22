// Parses the HTML report staff paste in from the external "reports website"
// into structured pieces: attached penal codes (with fine + per-citation
// reason), evidence image URLs, and a "display" narrative with the raw
// <img> tags stripped out (images get their own gallery on the report view
// instead, so they don't render twice).
//
// Expected shape of a pasted report (see README/seed for a full example):
//
//   <strong>Citation(s):</strong>
//   <ul><li><strong>IC 418</strong> — Prohibited Parking... ($5000)</li></ul>
//   <strong>Citation Reason(s):</strong>
//   <ul><li>Against a red curb (except where permitted).</li></ul>
//   <strong>Evidence:</strong><br>
//   <img src="...">
//
// This is a trusted-staff-only training tool, but the pasted text ends up
// rendered as HTML on other people's screens, so a light sanitize pass is
// worth the cost even here.

function sanitizeHtml(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
}

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

function extractListItems(html, afterLabel) {
  const labelIdx = html.indexOf(afterLabel);
  if (labelIdx === -1) return [];
  const ulStart = html.indexOf('<ul', labelIdx);
  if (ulStart === -1) return [];
  const ulEnd = html.indexOf('</ul>', ulStart);
  if (ulEnd === -1) return [];
  const ulHtml = html.slice(ulStart, ulEnd);
  return [...ulHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
}

// Matches e.g. `<strong>IC 418</strong> — Prohibited Parking: Third or more Offense ($5000)`
// but tolerates a missing <strong>, a missing "IC", an em-dash or hyphen, and extra whitespace.
const CODE_LINE = /(?:<strong>)?\s*(?:IC\s*)?(\d{2,4})\s*(?:<\/strong>)?\s*[—-]\s*([^($<]+?)\s*\(\$\s*([\d,]+)\s*\)/i;

function parseInfractionNarrative(rawHtml) {
  const html = sanitizeHtml(rawHtml || '');

  const citationItems = extractListItems(html, 'Citation(s):');
  const reasonItems = extractListItems(html, 'Citation Reason(s):');

  const codes = citationItems.map((item, i) => {
    const match = item.match(CODE_LINE);
    const reasonText = reasonItems[i] ? stripTags(reasonItems[i]) : null;
    if (!match) {
      return { rawCode: null, codeLabel: stripTags(item), fineAmount: 0, reasonText };
    }
    const [, code, title, fineRaw] = match;
    return {
      rawCode: code,
      codeLabel: `IC ${code} — ${title.trim()}`,
      fineAmount: parseInt(fineRaw.replace(/,/g, ''), 10) || 0,
      reasonText,
    };
  });

  const images = [...html.matchAll(/<img[^>]+src\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);

  const displayNarrative = html.replace(/<img[^>]*>/gi, '');

  return { codes, images, sanitizedHtml: html, displayNarrative };
}

module.exports = { parseInfractionNarrative, sanitizeHtml, stripTags };
