/**
 * `path` with the user's home folder written as `~` (macOS `/Users/<name>`,
 * Linux `/home/<name>`, Windows `C:\Users\<name>`). Any other path comes
 * back unchanged.
 */
export function homeRelativePath(path: string): string {
  const m = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/);
  return m ? '~' + path.slice(m[1].length) : path;
}
