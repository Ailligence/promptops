import { _api, addCollection } from 'iconify-icon';
import { ICON_COLLECTIONS } from './icons.generated';

/**
 * Registers the icons bundled with the app and turns off Iconify's network
 * loader: an icon that is not bundled renders empty instead of being
 * downloaded from api.iconify.design. Regenerate the bundle with
 * `node scripts/build-icons.mjs`.
 */
export function registerOfflineIcons(): void {
  for (const collection of ICON_COLLECTIONS) addCollection(collection);
  _api.setFetch(() => Promise.reject(new Error('Icons are bundled; network loading is off.')));
}
