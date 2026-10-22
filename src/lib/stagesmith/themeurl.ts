/** Keep portable ./… url() refs in theme.css; runtime resolves them against its asset base.
 *  Every path segment is percent-encoded AND the URL stays quoted, so asset
 *  names with spaces, brackets, # or unicode all work inside CSS. */
export function rewriteThemeCss(css: string, deckId: string): string {
  return css.replace(/url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g, (_m, _prefix, rest) => {
    const rel = String(rest)
      .replace(/^assets\//, "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `url('./assets/${rel}')`;
  });
}

/** inverse of rewriteThemeCss — used when SAVING theme.css: turn edited
 *  route or virtual URLs back into portable ./assets/… refs (decoded, so a re-read
 *  never double-encodes). */
export function unrewriteThemeCss(css: string, deckId: string): string {
  const re = new RegExp(
    `url\\(\\s*(['"]?)(?:/api/assets/${deckId}/assets/|/__chasse_files__/${encodeURIComponent(deckId)}/assets/)([^'")]+)\\1\\s*\\)`,
    "g",
  );
  return css.replace(re, (_m, quote: string, rel: string) => {
    const decoded = rel
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join("/");
    return `url(${quote}./assets/${decoded}${quote})`;
  });
}
