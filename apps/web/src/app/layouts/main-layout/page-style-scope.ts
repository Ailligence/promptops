/** Keep the complete Sessions, Ranking and AI Tech News sections on their existing skin. */
export function usesSharedPageStyle(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return /^\/admin(?:\/|$)/.test(path)
    && !/^\/admin\/(?:sessions|ranking|morning)(?:\/|$)/.test(path);
}
