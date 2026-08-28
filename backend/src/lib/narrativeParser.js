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

// The reports site's pasted text often tacks an offense-count qualifier onto
// the end of a code's title — "Prohibited Parking: Third or more Offense",
// "Failure to Yield (2nd Offense)", etc. That count isn't trustworthy (it's
// whatever the citing officer typed, not this person's actual record here),
// so it's stripped from the title entirely — the app works out and appends
// its own, based on this person's real prior count for that exact code (see
// models.buildInfractionCodeLabel).
function stripOffenseSuffix(text) {
  return (text || '')
    .replace(/[\s,:;-]*\(?\s*(1st|first|2nd|second|3rd|third)\s*(or\s+(more|greater|subsequent))?\s*offen[cs]e\)?\.?\s*$/i, '')
    .trim();
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
// but tolerates a missing <strong>, a missing "IC", an em-dash or hyphen, extra
// whitespace, and an offense qualifier written either way ("Title: Nth
// Offense" or "Title (Nth Offense)") — the title capture only excludes "<"
// (so stray markup can't leak in) and is anchored to the trailing "($fine)",
// so anything in between, parens included, is fair game and gets cleaned up
// afterward by stripOffenseSuffix.
const CODE_LINE = /(?:<strong>)?\s*(?:IC\s*)?(\d{2,4})\s*(?:<\/strong>)?\s*[—-]\s*([^<]+?)\s*\(\$\s*([\d,]+)\s*\)\s*$/i;

function parseInfractionNarrative(rawHtml) {
  const html = sanitizeHtml(rawHtml || '');

  const citationItems = extractListItems(html, 'Citation(s):');
  const reasonItems = extractListItems(html, 'Citation Reason(s):');

  const codes = citationItems.map((item, i) => {
    const match = item.match(CODE_LINE);
    const reasonText = reasonItems[i] ? stripTags(reasonItems[i]) : null;
    if (!match) {
      const title = stripOffenseSuffix(stripTags(item));
      return { rawCode: null, title, codeLabel: title, fineAmount: 0, reasonText };
    }
    const [, code, rawTitle, fineRaw] = match;
    const title = stripOffenseSuffix(rawTitle.trim());
    return {
      rawCode: code,
      title,
      // codeLabel here is only a fallback for a code the offense-count pass
      // downstream can't resolve against the PenalCode table (no penalCodeId
      // match) — createInfractionReport recomputes it for every code it can.
      codeLabel: `IC ${code} — ${title}`,
      fineAmount: parseInt(fineRaw.replace(/,/g, ''), 10) || 0,
      reasonText,
    };
  });

  const images = [...html.matchAll(/<img[^>]+src\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);

  const displayNarrative = html.replace(/<img[^>]*>/gi, '');

  return { codes, images, sanitizedHtml: html, displayNarrative };
}

module.exports = { parseInfractionNarrative, sanitizeHtml, stripTags };
