/**
 * Avatar with the person's initials, drawn on the device as an SVG data URL.
 * No image service is contacted, so names never leave the app.
 */
export function initialsAvatar(name: string | null | undefined): string {
  const initials =
    (name ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "U";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#6366f1"/>` +
    `<text x="32" y="32" font-family="system-ui,sans-serif" font-size="26" font-weight="500" ` +
    `fill="#ffffff" text-anchor="middle" dominant-baseline="central">${escapeXml(initials)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
