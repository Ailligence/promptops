import type { MenuItemType } from '@common/menu-meta'


export const findAllParent = (menuItems: MenuItemType[], menuItem: any): any => {
  let parents = []
  const parent = findMenuItem(menuItems, menuItem['parentKey'])

  if (parent) {
    parents.push(parent['key'])
    if (parent['parentKey'])
      parents = [...parents, ...findAllParent(menuItems, parent)]
  }
  return parents
}

export const findMenuItem = (
  menuItems: MenuItemType[],
  menuItemKey: string
): any => {
  if (menuItems && menuItemKey) {
    for (var i = 0; i < menuItems.length; i++) {
      if (menuItems[i].key === menuItemKey) {
        return menuItems[i]
      }
      var found = findMenuItem(menuItems[i].children!, menuItemKey)
      if (found) return found
    }
  }
  return null
}


export const splitArray = (array: Array<any>, chunkSize: number) => {
  const chunks = Array(Math.ceil(array.length / chunkSize))
    .fill(1)
    .map((_, index) => index * chunkSize)
    .map((begin) => array.slice(begin, begin + chunkSize));
  return chunks;
};