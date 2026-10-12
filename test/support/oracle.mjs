/** Independent oracle, written from SPEC.md P-03, not from lib/. */
export function expectedSources(data) {
  const results = data !== null && typeof data === 'object' && Array.isArray(data.results) ? data.results : [];
  const out = [];
  for (const r of results) {
    if (r === null || typeof r !== 'object' || typeof r.url !== 'string' || r.url.length === 0) continue;
    const s = { url: r.url };
    if (typeof r.title === 'string' && r.title.length > 0) s.title = r.title;
    const hs = Array.isArray(r.highlights)
      ? r.highlights.filter((h) => typeof h === 'string').map((h) => h.trim()).filter((h) => h.length > 0) : [];
    if (hs.length > 0) s.snippet = hs.join(' … ');
    else if (typeof r.summary === 'string' && r.summary.trim().length > 0) s.snippet = r.summary.trim();
    else if (typeof r.text === 'string' && r.text.trim().length > 0) s.snippet = r.text.trim().slice(0, 600);
    if (typeof r.publishedDate === 'string' && r.publishedDate.length > 0) s.publishedAt = r.publishedDate;
    out.push(s);
  }
  return out;
}

