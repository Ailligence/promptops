/** Public template repository: one template per section plus the visual playground. */
export const TEMPLATES_REPO = 'https://github.com/shellonback/promptops-plugin-templates';
/**
 * Static official index: the app reads it ONLY when the server registry does not exist.
 * Each entry pins the commit and SHA-256 of the bundle; installation stays the real one, in Rust.
 */
export const OFFICIAL_INDEX_URL = 'https://raw.githubusercontent.com/shellonback/promptops-plugin-templates/main/registry/official.json';
/** Template screenshots, served from the public repository. */
export const TEMPLATES_SHOTS = 'https://raw.githubusercontent.com/shellonback/promptops-plugin-templates/main/docs/screenshots';
