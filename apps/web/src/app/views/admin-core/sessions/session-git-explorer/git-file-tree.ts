export interface WorkingTreeFile { path: string; status: string; staged: boolean; }
export interface FileTreeNode {
  name: string;
  fullPath: string;
  files: WorkingTreeFile[];
  children: FileTreeNode[];
  totalFiles: number;
}
export interface TreePage { path: string; page: number; pages: number; total: number; start: number; end: number; }
export interface FileTreeRow {
  key: string;
  depth: number;
  folder?: FileTreeNode;
  file?: WorkingTreeFile;
  pagination?: TreePage;
}
export const TREE_PAGE_SIZE = 50;

/** Index paths once, including filtered ancestors, without quadratic sibling scans. */
export function buildFileTree(files: WorkingTreeFile[], filter = ''): FileTreeNode {
  const root: FileTreeNode = { name: '', fullPath: '', files: [], children: [], totalFiles: 0 };
  const folders = new Map<string, FileTreeNode>([['', root]]);
  const query = filter.trim().toLowerCase();
  for (const file of files) {
    if (query && !file.path.toLowerCase().includes(query)) continue;
    const parts = file.path.split('/');
    parts.pop();
    let node = root;
    node.totalFiles++;
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let child = folders.get(path);
      if (!child) {
        child = { name: part, fullPath: path, files: [], children: [], totalFiles: 0 };
        folders.set(path, child);
        node.children.push(child);
      }
      child.totalFiles++;
      node = child;
    }
    node.files.push(file);
  }
  for (const node of folders.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
  }
  return root;
}

/** Only open branches and their current pages produce rows, including at root. */
export function visibleTreeRows(root: FileTreeNode, expanded: ReadonlySet<string>, pages: ReadonlyMap<string, number>): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  type Task = { node: FileTreeNode; depth: number } | { row: FileTreeRow };
  const stack: Task[] = [{ node: root, depth: 0 }];
  while (stack.length) {
    const task = stack.pop()!;
    if ('row' in task) { rows.push(task.row); continue; }
    const { node, depth } = task;
    const total = node.children.length + node.files.length;
    const pageCount = Math.max(1, Math.ceil(total / TREE_PAGE_SIZE));
    const page = Math.max(0, Math.min(pages.get(node.fullPath) ?? 0, pageCount - 1));
    const start = page * TREE_PAGE_SIZE;
    const end = Math.min(start + TREE_PAGE_SIZE, total);
    if (pageCount > 1) stack.push({ row: {
      key: `page:${node.fullPath}`, depth,
      pagination: { path: node.fullPath, page, pages: pageCount, total, start: start + 1, end },
    } });
    for (let i = end - 1; i >= start; i--) {
      if (i < node.children.length) {
        const folder = node.children[i];
        if (expanded.has(folder.fullPath)) stack.push({ node: folder, depth: depth + 1 });
        stack.push({ row: { key: `folder:${folder.fullPath}`, depth, folder } });
      } else {
        const file = node.files[i - node.children.length];
        stack.push({ row: { key: `file:${file.path}`, depth, file } });
      }
    }
  }
  return rows;
}
