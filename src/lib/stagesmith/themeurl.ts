/** rewrite ./… url() refs in theme.css to same-origin asset URLs (server decks) */
export function rewriteThemeCss(css: string, deckId: string): string {
  return css.replace(/url\(\s*['"]?(\.\/|\.\.\/)([^'")]+)['"]?\s*\)/g, (_m, _prefix, rest) => {
    return `url('/api/assets/${deckId}/assets/${String(rest).replace(/^assets\//, "")}')`;
  });
}
