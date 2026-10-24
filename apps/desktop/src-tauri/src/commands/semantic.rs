//! Knowledge layer — three IPC domains in a single module:
//!
//!   * `semantic:*`   → semantic search via embeddings
//!   * `knowledge:*`  → code graph (AST parsing)
//!   * `memory:*`     → textual session memory
//!
//! ## Implementation strategy
//!
//! - **Knowledge graph** and **session memory** are pure logic (regex parsing,
//!   BFS on the graph, text scoring): implemented **natively** in Rust, with
//!   stable fields/JSON shapes (the same names are needed because the
//!   renderer and the persisted index files are shared). The index files
//!   live in the app data folder (`semantic-index/<workspace key>/`), never in
//!   the user's repository.
//! - **Semantic embeddings** run on onnxruntime/transformers.js: there is no
//!   simple, lightweight Rust equivalent here. The *command surface* is fully
//!   defined; the heavy step (chunk/query embedding) is routed to
//!   a **Node sidecar** via JSON over stdio (see `Sidecar` + `// TODO:`).
//!   The final native path is the `ort` crate (ONNX Runtime for Rust).
//!
//! ## State (registered as `app.manage(Arc::new(...))` in lib.rs — NOT here)
//!   * `Arc<EmbeddingEngine>` — chunks + embeddings + content hash in memory
//!   * `Arc<CodeGraph>`       — graph nodes/edges/indexes in memory
//!   * `Arc<SessionMemory>`   — memory entries in memory
//!
//! All shared state uses `parking_lot::Mutex` behind `Arc`, like the
//! other managers (`terminal.rs`, `subagent.rs`).
//!
//! Push channels (via `AppHandle::emit`, trait `tauri::Emitter`):
//!   semantic:embedding-progress · semantic:ready
//!   knowledge:indexing-progress · knowledge:indexing-complete

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

// ════════════════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════════════════

// Embedding engine
const INDEX_VERSION: u32 = 1;
const SEM_MAX_CACHE_AGE_MS: i64 = 12 * 60 * 60 * 1000; // 12h
const CHUNK_MAX_LINES: usize = 60;
const CHUNK_OVERLAP_LINES: usize = 10;
const EMBEDDING_DIM: usize = 384; // all-MiniLM-L6-v2

// Code graph
const GRAPH_VERSION: u32 = 1;
const GRAPH_MAX_CACHE_AGE_MS: i64 = 24 * 60 * 60 * 1000; // 24h

// Session memory
const MEMORY_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 500;
const PRUNE_RESOLVED_DAYS: f64 = 7.0;
const PRUNE_OLD_DAYS: f64 = 30.0;

/// Now in epoch millis (like `Date.now()`).
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// md5 hex (ids and content hashes use md5, so the output stays
/// comparable and persisted files stay compatible).
fn md5_hex(input: &str) -> String {
    // md5 implemented inline to avoid adding extra external dependencies.
    md5_impl::hex(input.as_bytes())
}

fn md5_hex12(input: &str) -> String {
    md5_hex(input).chars().take(12).collect()
}

// ════════════════════════════════════════════════════════════════════════
//  AST parser (regex-based, never panics)
// ════════════════════════════════════════════════════════════════════════

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "vendor",
    ".git",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    "target",
    ".gradle",
    "coverage",
    ".cache",
    ".turbo",
    ".svelte-kit",
    ".output",
    "storage",
    ".idea",
    ".vscode",
    ".promptops",
];

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "php", "py", "go", "rs", "java", "vue", "svelte",
];

#[derive(Clone, Debug)]
struct ParsedNode {
    kind: String,
    name: String,
    line: usize,
    metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug)]
struct ParsedEdge {
    target_name: String,
    kind: String,
}

#[derive(Default)]
struct ParseResult {
    nodes: Vec<ParsedNode>,
    edges: Vec<ParsedEdge>,
}

/// `AstParser.listFiles` — walks the workspace honoring the skip-rules,
/// returns **relative** paths.
fn list_files(workspace: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_dir(workspace, workspace, &mut out);
    out
}

fn walk_dir(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let ft = match entry.file_type() {
            Ok(f) => f,
            Err(_) => continue,
        };
        let full = entry.path();
        if ft.is_dir() {
            // Hidden dirs (starting with '.') are skipped.
            if name.starts_with('.') {
                continue;
            }
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk_dir(root, &full, out);
            }
        } else if ft.is_file() {
            let ext = full
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                if let Ok(rel) = full.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
}

/// `AstParser.parseFile` — dispatch by extension, never panics.
///
/// NOTE: for robustness, the lexical queries are implemented with `regex`.
/// The `regex` crate doesn't support lookarounds, so no pattern here uses them.
fn parse_file(file_path: &str, content: &str) -> ParseResult {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte" => {
            parse_typescript(file_path, content)
        }
        "php" => parse_php(file_path, content),
        _ => parse_generic(file_path, content),
    }
}

/// The largest char boundary of `s` at or below `at`: byte offsets computed
/// by arithmetic can land inside a multibyte character, and slicing there panics.
fn char_floor(s: &str, at: usize) -> usize {
    let mut at = at.min(s.len());
    while !s.is_char_boundary(at) {
        at -= 1;
    }
    at
}

fn line_of(content: &str, byte_index: usize) -> usize {
    content[..byte_index.min(content.len())]
        .bytes()
        .filter(|&b| b == b'\n')
        .count()
        + 1
}

fn parse_typescript(file_path: &str, content: &str) -> ParseResult {
    use regex::Regex;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Imports
    let import_re = Regex::new(
        r#"import\s+(?:(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+)?['"]([^'"]+)['"]"#,
    )
    .unwrap();
    for c in import_re.captures_iter(content) {
        if let Some(source) = c.get(4).map(|m| m.as_str()) {
            if !source.starts_with('.') && !source.starts_with('/') {
                continue; // skip node_modules
            }
            edges.push(ParsedEdge {
                target_name: source.to_string(),
                kind: "imports".into(),
            });
        }
    }

    // Class declarations: class Foo extends Bar implements Baz, Qux
    let class_re = Regex::new(
        r"(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?",
    )
    .unwrap();
    for c in class_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        let name = c[1].to_string();
        let before = &content[char_floor(content, idx.saturating_sub(200))..idx];
        let mut kind = "class";
        if before.contains("@Component") {
            kind = "component";
        } else if before.contains("@Injectable") {
            kind = "service";
        } else if before.contains("@Controller") {
            kind = "controller";
        } else if before.contains("@Module") {
            kind = "module";
        } else if before.contains("@Middleware") || name.contains("Middleware") {
            kind = "middleware";
        }
        nodes.push(ParsedNode {
            kind: kind.into(),
            name,
            line: line_of(content, idx),
            metadata: None,
        });
        if let Some(parent) = c.get(2) {
            edges.push(ParsedEdge {
                target_name: parent.as_str().into(),
                kind: "extends".into(),
            });
        }
        if let Some(ifaces) = c.get(3) {
            for iface in ifaces
                .as_str()
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                edges.push(ParsedEdge {
                    target_name: iface.into(),
                    kind: "implements".into(),
                });
            }
        }
    }

    // Interfaces
    let iface_re =
        Regex::new(r"(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w\s,]+))?").unwrap();
    for c in iface_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "interface".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
        if let Some(parents) = c.get(2) {
            for parent in parents
                .as_str()
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                edges.push(ParsedEdge {
                    target_name: parent.into(),
                    kind: "extends".into(),
                });
            }
        }
    }

    // Type aliases
    let type_re = Regex::new(r"(?:export\s+)?type\s+(\w+)\s*=").unwrap();
    for c in type_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "type".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
    }

    // Enums
    let enum_re = Regex::new(r"(?:export\s+)?(?:const\s+)?enum\s+(\w+)").unwrap();
    for c in enum_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "enum".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
    }

    // Functions
    let func_re = Regex::new(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)").unwrap();
    for c in func_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "function".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
    }

    // Arrow exports
    let arrow_re = Regex::new(r"export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(").unwrap();
    for c in arrow_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "function".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
    }

    // Constructor injection
    let ctor_re = Regex::new(r"constructor\s*\(([^)]*)\)").unwrap();
    let inj_re = Regex::new(r"(?:private|protected|public|readonly)\s+\w+\s*:\s*(\w+)").unwrap();
    for c in ctor_re.captures_iter(content) {
        for inj in inj_re.captures_iter(&c[1]) {
            edges.push(ParsedEdge {
                target_name: inj[1].into(),
                kind: "injects".into(),
            });
        }
    }

    // Test files
    if file_path.contains(".spec.")
        || file_path.contains(".test.")
        || file_path.contains("__tests__")
    {
        let desc_re = Regex::new(r#"describe\s*\(\s*['"]([^'"]+)['"]"#).unwrap();
        for c in desc_re.captures_iter(content) {
            let idx = c.get(0).unwrap().start();
            nodes.push(ParsedNode {
                kind: "test".into(),
                name: c[1].into(),
                line: line_of(content, idx),
                metadata: None,
            });
            edges.push(ParsedEdge {
                target_name: c[1].into(),
                kind: "tests".into(),
            });
        }
    }

    ParseResult { nodes, edges }
}

fn parse_php(file_path: &str, content: &str) -> ParseResult {
    use regex::Regex;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let lower_path = file_path.to_lowercase();

    // use statements
    let use_re = Regex::new(r"use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;").unwrap();
    for c in use_re.captures_iter(content) {
        let fqcn = &c[1];
        let alias = c
            .get(2)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| fqcn.split('\\').next_back().unwrap_or(fqcn).to_string());
        edges.push(ParsedEdge {
            target_name: alias,
            kind: "imports".into(),
        });
    }

    // Classes
    let class_re = Regex::new(
        r"(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,\\]+))?",
    )
    .unwrap();
    for c in class_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        let name = c[1].to_string();
        let mut kind = "class";
        if lower_path.contains("controller") {
            kind = "controller";
        } else if lower_path.contains("model") || lower_path.contains("/models/") {
            kind = "model";
        } else if lower_path.contains("middleware") {
            kind = "middleware";
        } else if lower_path.contains("service") {
            kind = "service";
        } else if lower_path.contains("migration") {
            kind = "migration";
        } else if lower_path.contains("test") {
            kind = "test";
        }
        nodes.push(ParsedNode {
            kind: kind.into(),
            name,
            line: line_of(content, idx),
            metadata: None,
        });
        if let Some(parent) = c.get(2) {
            edges.push(ParsedEdge {
                target_name: parent.as_str().into(),
                kind: "extends".into(),
            });
        }
        if let Some(ifaces) = c.get(3) {
            for iface in ifaces.as_str().split(',') {
                let short = iface.trim().split('\\').next_back().unwrap_or("").trim();
                if !short.is_empty() {
                    edges.push(ParsedEdge {
                        target_name: short.into(),
                        kind: "implements".into(),
                    });
                }
            }
        }
    }

    // Interfaces
    let iface_re = Regex::new(r"interface\s+(\w+)").unwrap();
    for c in iface_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "interface".into(),
            name: c[1].into(),
            line: line_of(content, idx),
            metadata: None,
        });
    }

    // Routes: Route::get('/path', [Controller::class, 'method'])
    let route_re = Regex::new(
        r#"Route::(get|post|put|patch|delete|any)\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[?\s*(\w+)::class"#,
    )
    .unwrap();
    for c in route_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        let method = c[1].to_uppercase();
        let route_path = c[2].to_string();
        let controller = c[3].to_string();
        nodes.push(ParsedNode {
            kind: "route".into(),
            name: format!("{} {}", method, route_path),
            line: line_of(content, idx),
            metadata: Some(
                json!({ "method": method, "path": route_path, "controller": controller }),
            ),
        });
        edges.push(ParsedEdge {
            target_name: controller,
            kind: "routes_to".into(),
        });
    }

    // Route::resource / apiResource
    let resource_re =
        Regex::new(r#"Route::(?:api)?[Rr]esource\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)::class"#)
            .unwrap();
    for c in resource_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "route".into(),
            name: format!("RESOURCE {}", &c[1]),
            line: line_of(content, idx),
            metadata: Some(json!({ "path": c[1].to_string(), "controller": c[2].to_string() })),
        });
        edges.push(ParsedEdge {
            target_name: c[2].into(),
            kind: "routes_to".into(),
        });
    }

    // Schema::create migrations
    let schema_re = Regex::new(r#"Schema::create\s*\(\s*['"](\w+)['"]"#).unwrap();
    for c in schema_re.captures_iter(content) {
        let idx = c.get(0).unwrap().start();
        nodes.push(ParsedNode {
            kind: "migration".into(),
            name: format!("table:{}", &c[1]),
            line: line_of(content, idx),
            metadata: Some(json!({ "table": c[1].to_string() })),
        });
        edges.push(ParsedEdge {
            target_name: c[1].into(),
            kind: "migrates".into(),
        });
    }

    // Eloquent relationships
    let rel_re = Regex::new(
        r"(?:return\s+\$this->)(hasMany|hasOne|belongsTo|belongsToMany|morphTo|morphMany|morphOne|morphToMany)\s*\(\s*(\w+)::class",
    )
    .unwrap();
    for c in rel_re.captures_iter(content) {
        edges.push(ParsedEdge {
            target_name: c[2].into(),
            kind: "uses".into(),
        });
    }

    // Constructor injection
    let ctor_re = Regex::new(r"function\s+__construct\s*\(([^)]*)\)").unwrap();
    let inj_re = Regex::new(r"(?:private|protected|public|readonly)\s+(\w+)\s+\$").unwrap();
    for c in ctor_re.captures_iter(content) {
        for inj in inj_re.captures_iter(&c[1]) {
            edges.push(ParsedEdge {
                target_name: inj[1].into(),
                kind: "injects".into(),
            });
        }
    }

    // Test methods
    if lower_path.contains("test") {
        let test_re = Regex::new(r"function\s+(test\w+)\s*\(").unwrap();
        for c in test_re.captures_iter(content) {
            let idx = c.get(0).unwrap().start();
            nodes.push(ParsedNode {
                kind: "test".into(),
                name: c[1].into(),
                line: line_of(content, idx),
                metadata: None,
            });
        }
    }

    ParseResult { nodes, edges }
}

fn parse_generic(file_path: &str, content: &str) -> ParseResult {
    use regex::Regex;
    let mut edges = Vec::new();

    if file_path.ends_with(".py") {
        let from_re = Regex::new(r"from\s+([\w.]+)\s+import").unwrap();
        for c in from_re.captures_iter(content) {
            edges.push(ParsedEdge {
                target_name: c[1].into(),
                kind: "imports".into(),
            });
        }
        let direct_re = Regex::new(r"(?m)^import\s+([\w.]+)").unwrap();
        for c in direct_re.captures_iter(content) {
            edges.push(ParsedEdge {
                target_name: c[1].into(),
                kind: "imports".into(),
            });
        }
    }

    if file_path.ends_with(".go") {
        // import ( ... ) | import "pkg"
        let go_re = Regex::new(r#"import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")"#).unwrap();
        let pkg_re = Regex::new(r#""([^"]+)""#).unwrap();
        for c in go_re.captures_iter(content) {
            let block = c
                .get(1)
                .or_else(|| c.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");
            for line in block.lines() {
                if let Some(pkg) = pkg_re.captures(line) {
                    edges.push(ParsedEdge {
                        target_name: pkg[1].into(),
                        kind: "imports".into(),
                    });
                }
            }
        }
    }

    if file_path.ends_with(".rs") {
        let use_re = Regex::new(r"use\s+([\w:]+)").unwrap();
        for c in use_re.captures_iter(content) {
            edges.push(ParsedEdge {
                target_name: c[1].into(),
                kind: "imports".into(),
            });
        }
    }

    if file_path.ends_with(".java") {
        let java_re = Regex::new(r"import\s+([\w.]+);").unwrap();
        for c in java_re.captures_iter(content) {
            let short = c[1].split('.').next_back().unwrap_or(&c[1]).to_string();
            edges.push(ParsedEdge {
                target_name: short,
                kind: "imports".into(),
            });
        }
    }

    ParseResult {
        nodes: Vec::new(),
        edges,
    }
}

// ════════════════════════════════════════════════════════════════════════
//  KNOWLEDGE GRAPH (native)
// ════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
    pub weight: u32,
}

#[derive(Serialize)]
pub struct GraphQueryResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub summary: String,
    #[serde(rename = "estimatedTokens")]
    pub estimated_tokens: usize,
}

#[derive(Serialize, Deserialize)]
struct SerializedGraph {
    version: u32,
    #[serde(rename = "indexedAt")]
    indexed_at: i64,
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    #[serde(rename = "fileHashes")]
    file_hashes: HashMap<String, String>,
}

/// Internal graph state (all under a single Mutex for atomic consistency).
#[derive(Default)]
struct GraphState {
    nodes: HashMap<String, GraphNode>,
    edges: Vec<GraphEdge>,
    adjacency: HashMap<String, HashSet<String>>,
    reverse_adjacency: HashMap<String, HashSet<String>>,
    name_index: HashMap<String, Vec<String>>,
    file_index: HashMap<String, Vec<String>>,
    file_hashes: HashMap<String, String>,
    /// "source:target" → indexes in `edges`
    edge_index: HashMap<String, Vec<usize>>,
    indexed_at: Option<i64>,
    workspace_path: Option<String>,
}

#[derive(Default)]
pub struct CodeGraph {
    state: Mutex<GraphState>,
}

impl CodeGraph {
    pub fn new() -> Self {
        Self::default()
    }
}

fn make_id(file_path: &str, kind: &str, name: &str) -> String {
    md5_hex12(&format!("{}:{}:{}", file_path, kind, name))
}

impl GraphState {
    fn clear(&mut self) {
        *self = GraphState::default();
    }

    fn add_edge(&mut self, source_id: &str, target_id: &str, kind: &str) {
        let pair_key = format!("{}:{}", source_id, target_id);
        if let Some(idxs) = self.edge_index.get(&pair_key) {
            for &i in idxs {
                if self.edges[i].kind == kind {
                    self.edges[i].weight += 1;
                    return;
                }
            }
        }
        let edge = GraphEdge {
            source: source_id.into(),
            target: target_id.into(),
            kind: kind.into(),
            weight: 1,
        };
        let edge_idx = self.edges.len();
        self.edges.push(edge);
        self.edge_index.entry(pair_key).or_default().push(edge_idx);
        self.adjacency
            .entry(source_id.into())
            .or_default()
            .insert(target_id.into());
        self.reverse_adjacency
            .entry(target_id.into())
            .or_default()
            .insert(source_id.into());
    }

    /// `resolveTarget` — resolves a name to a node-id (exact name → basename → file).
    fn resolve_target(&self, target_name: &str) -> Vec<String> {
        if let Some(by_name) = self.name_index.get(target_name) {
            if !by_name.is_empty() {
                return by_name.iter().take(3).cloned().collect();
            }
        }
        let base = basename_no_ext(target_name);
        if let Some(by_base) = self.name_index.get(&base) {
            if !by_base.is_empty() {
                return by_base.iter().take(3).cloned().collect();
            }
        }
        for (file_path, node_ids) in &self.file_index {
            let file_base = strip_ext(&basename(file_path));
            if file_base == base {
                return node_ids.iter().take(1).cloned().collect();
            }
        }
        Vec::new()
    }

    /// `findNodes` — by exact name, exact file, normalized file, partial.
    fn find_nodes(&self, symbol_or_path: &str) -> Vec<GraphNode> {
        if let Some(ids) = self.name_index.get(symbol_or_path) {
            if !ids.is_empty() {
                return ids
                    .iter()
                    .filter_map(|id| self.nodes.get(id).cloned())
                    .collect();
            }
        }
        if let Some(ids) = self.file_index.get(symbol_or_path) {
            if !ids.is_empty() {
                return ids
                    .iter()
                    .filter_map(|id| self.nodes.get(id).cloned())
                    .collect();
            }
        }
        let normalized = strip_ext(symbol_or_path.trim_start_matches("./"));
        for (file_path, ids) in &self.file_index {
            let file_norm = strip_ext(file_path);
            if file_norm == normalized || file_path == symbol_or_path {
                return ids
                    .iter()
                    .filter_map(|id| self.nodes.get(id).cloned())
                    .collect();
            }
        }
        let mut results = Vec::new();
        let lower = symbol_or_path.to_lowercase();
        for (name, ids) in &self.name_index {
            if name.to_lowercase().contains(&lower) {
                for id in ids.iter().take(3) {
                    if let Some(node) = self.nodes.get(id) {
                        results.push(node.clone());
                    }
                }
            }
        }
        results.into_iter().take(10).collect()
    }

    fn build_summary(
        &self,
        start_nodes: &[GraphNode],
        all_nodes: &[GraphNode],
        edges: &[GraphEdge],
    ) -> String {
        let mut lines = Vec::new();
        for start in start_nodes {
            lines.push(format!(
                "{} ({}, {}:{})",
                start.name,
                start.kind,
                start.file_path,
                start
                    .line
                    .map(|l| l.to_string())
                    .unwrap_or_else(|| "?".into())
            ));
            let incoming: Vec<&GraphEdge> = edges.iter().filter(|e| e.target == start.id).collect();
            let outgoing: Vec<&GraphEdge> = edges.iter().filter(|e| e.source == start.id).collect();
            if !incoming.is_empty() {
                let srcs: Vec<String> = incoming
                    .iter()
                    .filter_map(|e| {
                        self.nodes
                            .get(&e.source)
                            .map(|s| format!("{} [{}]", s.name, e.kind))
                    })
                    .collect();
                if !srcs.is_empty() {
                    lines.push(format!("  <- {}", srcs.join(", ")));
                }
            }
            if !outgoing.is_empty() {
                let tgts: Vec<String> = outgoing
                    .iter()
                    .filter_map(|e| {
                        self.nodes
                            .get(&e.target)
                            .map(|t| format!("{} [{}]", t.name, e.kind))
                    })
                    .collect();
                if !tgts.is_empty() {
                    lines.push(format!("  -> {}", tgts.join(", ")));
                }
            }
        }
        let start_ids: HashSet<&String> = start_nodes.iter().map(|n| &n.id).collect();
        let connected: Vec<&GraphNode> = all_nodes
            .iter()
            .filter(|n| !start_ids.contains(&n.id))
            .collect();
        if !connected.is_empty() {
            lines.push(format!(
                "Connected: {}",
                connected
                    .iter()
                    .map(|n| format!("{} ({})", n.name, n.kind))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        lines.join("\n")
    }
}

fn estimate_tokens(s: &str) -> usize {
    (s.len() as f64 * 0.25).round() as usize
}

fn basename(p: &str) -> String {
    p.rsplit('/').next().unwrap_or(p).to_string()
}

fn strip_ext(p: &str) -> String {
    match p.rfind('.') {
        // Only if the extension is after the last '/'
        Some(dot) if dot > p.rfind('/').map(|s| s + 1).unwrap_or(0) => p[..dot].to_string(),
        _ => p.to_string(),
    }
}

fn basename_no_ext(p: &str) -> String {
    strip_ext(&basename(p))
}

// ── knowledge:* command surface ─────────────────────────────────────────

/// `knowledge:index` — indexes the whole workspace (native).
/// Emits `knowledge:indexing-progress` (×3) and `knowledge:indexing-complete`.
/// spawn_blocking: parsing the whole workspace — the sync command froze
/// the UI for the entire indexing.
#[tauri::command]
pub async fn knowledge_index(
    app: AppHandle,
    graph: State<'_, Arc<CodeGraph>>,
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    let graph = graph.inner().clone();
    tauri::async_runtime::spawn_blocking(move || knowledge_index_impl(app, &graph, workspace_path))
        .await
        .map_err(|e| e.to_string())?
}

fn knowledge_index_impl(
    app: AppHandle,
    graph: &Arc<CodeGraph>,
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    let start = now_ms();
    let ws = PathBuf::from(&workspace_path);

    let _ = app.emit("knowledge:indexing-progress", json!({
        "workspacePath": workspace_path, "step": 0, "totalSteps": 3, "label": "Scanning files..."
    }));

    let files = list_files(&ws);

    let _ = app.emit(
        "knowledge:indexing-progress",
        json!({
            "workspacePath": workspace_path, "step": 1, "totalSteps": 3,
            "label": format!("Parsing {} files...", files.len())
        }),
    );

    // Phase 2: parse
    struct RawNode {
        file_path: String,
        node: GraphNode,
    }
    struct RawEdge {
        file_path: String,
        target_name: String,
        kind: String,
    }
    let mut raw_nodes: Vec<RawNode> = Vec::new();
    let mut raw_edges: Vec<RawEdge> = Vec::new();
    let mut file_hashes: HashMap<String, String> = HashMap::new();

    for rel_path in &files {
        let abs = ws.join(rel_path);
        let content = match std::fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(_) => continue,
        };
        file_hashes.insert(rel_path.clone(), md5_hex(&content));

        let file_node_id = make_id(rel_path, "file", &basename(rel_path));
        raw_nodes.push(RawNode {
            file_path: rel_path.clone(),
            node: GraphNode {
                id: file_node_id,
                kind: "file".into(),
                name: basename(rel_path),
                file_path: rel_path.clone(),
                line: Some(1),
                metadata: None,
            },
        });

        let result = parse_file(rel_path, &content);
        for parsed in result.nodes {
            let node_id = make_id(rel_path, &parsed.kind, &parsed.name);
            raw_nodes.push(RawNode {
                file_path: rel_path.clone(),
                node: GraphNode {
                    id: node_id,
                    kind: parsed.kind,
                    name: parsed.name,
                    file_path: rel_path.clone(),
                    line: Some(parsed.line),
                    metadata: parsed.metadata,
                },
            });
        }
        for edge in result.edges {
            raw_edges.push(RawEdge {
                file_path: rel_path.clone(),
                target_name: edge.target_name,
                kind: edge.kind,
            });
        }
    }

    let _ = app.emit("knowledge:indexing-progress", json!({
        "workspacePath": workspace_path, "step": 2, "totalSteps": 3, "label": "Resolving references..."
    }));

    let (node_count, edge_count) = {
        let mut s = graph.state.lock();
        // `indexWorkspace` always rebuilds from scratch (the clear applies both
        // on workspace change and on the first index): an unconditional clear.
        s.clear();
        s.workspace_path = Some(workspace_path.clone());

        // Phase 3: add nodes
        for rn in raw_nodes {
            let node = rn.node;
            let id = node.id.clone();
            let name = node.name.clone();
            s.name_index.entry(name).or_default().push(id.clone());
            s.file_index
                .entry(rn.file_path)
                .or_default()
                .push(id.clone());
            s.nodes.insert(id, node);
        }

        // Phase 4: resolve edges
        for raw in raw_edges {
            let source_file_nodes = s
                .file_index
                .get(&raw.file_path)
                .cloned()
                .unwrap_or_default();
            let source_id = source_file_nodes
                .iter()
                .find(|id| s.nodes.get(*id).map(|n| n.kind != "file").unwrap_or(false))
                .cloned()
                .or_else(|| source_file_nodes.first().cloned());
            let source_id = match source_id {
                Some(s) => s,
                None => continue,
            };
            let target_ids = s.resolve_target(&raw.target_name);
            if target_ids.is_empty() {
                continue;
            }
            for target_id in target_ids {
                if target_id == source_id {
                    continue;
                }
                s.add_edge(&source_id, &target_id, &raw.kind);
            }
        }

        s.file_hashes = file_hashes;
        s.indexed_at = Some(now_ms());
        (s.nodes.len(), s.edges.len())
    };

    let duration = now_ms() - start;

    let _ = app.emit(
        "knowledge:indexing-complete",
        json!({
            "workspacePath": workspace_path,
            "nodeCount": node_count, "edgeCount": edge_count, "duration": duration
        }),
    );

    // Persist
    persist_graph(graph, &workspace_path).map_err(|e| e.to_string())?;

    Ok(json!({ "ok": true, "stats": {
        "nodeCount": node_count, "edgeCount": edge_count, "duration": duration
    }}))
}

/// `knowledge:query` — BFS around a symbol/file up to `depth`.
#[tauri::command]
pub fn knowledge_query(
    graph: State<'_, Arc<CodeGraph>>,
    symbol: String,
    depth: Option<usize>,
) -> GraphQueryResult {
    let depth = depth.unwrap_or(1);
    let s = graph.state.lock();
    let start_nodes = s.find_nodes(&symbol);
    if start_nodes.is_empty() {
        return GraphQueryResult {
            nodes: vec![],
            edges: vec![],
            summary: format!("No nodes found for \"{}\"", symbol),
            estimated_tokens: 0,
        };
    }

    let mut visited: HashSet<String> = HashSet::new();
    let mut result_nodes: Vec<GraphNode> = Vec::new();
    let mut collected_keys: HashSet<String> = HashSet::new();
    let mut result_edges: Vec<GraphEdge> = Vec::new();
    let mut frontier: Vec<String> = start_nodes.iter().map(|n| n.id.clone()).collect();

    for id in &frontier {
        visited.insert(id.clone());
        if let Some(n) = s.nodes.get(id) {
            result_nodes.push(n.clone());
        }
    }

    for _ in 0..depth {
        if frontier.is_empty() {
            break;
        }
        let mut next: Vec<String> = Vec::new();
        for node_id in &frontier {
            // Clone the neighbors so we don't hold a borrow of `s` during mutations.
            let fwd: Vec<String> = s
                .adjacency
                .get(node_id)
                .map(|set| set.iter().cloned().collect())
                .unwrap_or_default();
            for target_id in &fwd {
                if !visited.contains(target_id) {
                    visited.insert(target_id.clone());
                    if let Some(t) = s.nodes.get(target_id) {
                        result_nodes.push(t.clone());
                        next.push(target_id.clone());
                    }
                }
                let key = format!("{}:{}", node_id, target_id);
                if !collected_keys.contains(&key) {
                    collected_keys.insert(key.clone());
                    if let Some(idxs) = s.edge_index.get(&key) {
                        for &i in idxs {
                            result_edges.push(s.edges[i].clone());
                        }
                    }
                }
            }

            let rev: Vec<String> = s
                .reverse_adjacency
                .get(node_id)
                .map(|set| set.iter().cloned().collect())
                .unwrap_or_default();
            for source_id in &rev {
                if !visited.contains(source_id) {
                    visited.insert(source_id.clone());
                    if let Some(src) = s.nodes.get(source_id) {
                        result_nodes.push(src.clone());
                        next.push(source_id.clone());
                    }
                }
                let key = format!("{}:{}", source_id, node_id);
                if !collected_keys.contains(&key) {
                    collected_keys.insert(key.clone());
                    if let Some(idxs) = s.edge_index.get(&key) {
                        for &i in idxs {
                            result_edges.push(s.edges[i].clone());
                        }
                    }
                }
            }
        }
        frontier = next;
    }

    let summary = s.build_summary(&start_nodes, &result_nodes, &result_edges);
    let estimated_tokens = estimate_tokens(&summary);
    GraphQueryResult {
        nodes: result_nodes,
        edges: result_edges,
        summary,
        estimated_tokens,
    }
}

/// `knowledge:find-path` — shortest path BFS between two symbols/files.
#[tauri::command]
pub fn knowledge_find_path(
    graph: State<'_, Arc<CodeGraph>>,
    from: String,
    to: String,
) -> GraphQueryResult {
    let s = graph.state.lock();
    let start_nodes = s.find_nodes(&from);
    let end_nodes = s.find_nodes(&to);
    if start_nodes.is_empty() || end_nodes.is_empty() {
        return GraphQueryResult {
            nodes: vec![],
            edges: vec![],
            summary: format!("Cannot find path: \"{}\" or \"{}\" not in graph", from, to),
            estimated_tokens: 0,
        };
    }

    let end_ids: HashSet<String> = end_nodes.iter().map(|n| n.id.clone()).collect();
    let mut visited: HashMap<String, Option<String>> = HashMap::new();
    let mut queue: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    for start in &start_nodes {
        visited.insert(start.id.clone(), None);
        queue.push_back(start.id.clone());
    }

    let mut found_end: Option<String> = None;
    while let Some(current) = queue.pop_front() {
        if end_ids.contains(&current) {
            found_end = Some(current);
            break;
        }
        let mut neighbors: HashSet<String> = HashSet::new();
        if let Some(adj) = s.adjacency.get(&current) {
            neighbors.extend(adj.iter().cloned());
        }
        if let Some(rev) = s.reverse_adjacency.get(&current) {
            neighbors.extend(rev.iter().cloned());
        }
        for n in neighbors {
            if !visited.contains_key(&n) {
                visited.insert(n.clone(), Some(current.clone()));
                queue.push_back(n);
            }
        }
    }

    let found_end = match found_end {
        Some(e) => e,
        None => {
            return GraphQueryResult {
                nodes: vec![],
                edges: vec![],
                summary: format!("No path found between \"{}\" and \"{}\"", from, to),
                estimated_tokens: 0,
            };
        }
    };

    // Reconstruct path
    let mut path_ids: Vec<String> = Vec::new();
    let mut current: Option<String> = Some(found_end);
    while let Some(cur) = current {
        path_ids.insert(0, cur.clone());
        current = visited.get(&cur).cloned().flatten();
    }

    let path_nodes: Vec<GraphNode> = path_ids
        .iter()
        .filter_map(|id| s.nodes.get(id).cloned())
        .collect();
    let mut path_edges: Vec<GraphEdge> = Vec::new();
    for i in 0..path_ids.len().saturating_sub(1) {
        if let Some(edge) = s.edges.iter().find(|e| {
            (e.source == path_ids[i] && e.target == path_ids[i + 1])
                || (e.source == path_ids[i + 1] && e.target == path_ids[i])
        }) {
            path_edges.push(edge.clone());
        }
    }

    let summary = format!(
        "Path: {}",
        path_nodes
            .iter()
            .map(|n| format!("{} ({})", n.name, n.kind))
            .collect::<Vec<_>>()
            .join(" → ")
    );
    let estimated_tokens = estimate_tokens(&summary);
    GraphQueryResult {
        nodes: path_nodes,
        edges: path_edges,
        summary,
        estimated_tokens,
    }
}

/// `knowledge:impact-analysis` — files impacted by a set of changed files.
#[tauri::command]
pub fn knowledge_impact_analysis(
    graph: State<'_, Arc<CodeGraph>>,
    files: Vec<String>,
) -> GraphQueryResult {
    let s = graph.state.lock();
    let mut impacted_ids: HashSet<String> = HashSet::new();
    let mut result_edges: Vec<GraphEdge> = Vec::new();

    for file_path in &files {
        // Normalize to a relative path.
        let rel_path = match &s.workspace_path {
            Some(ws) => {
                let ws_p = Path::new(ws);
                let resolved = ws_p.join(file_path);
                resolved
                    .strip_prefix(ws_p)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| file_path.clone())
            }
            None => file_path.clone(),
        };

        let node_ids = s.file_index.get(&rel_path).cloned().unwrap_or_default();
        for node_id in node_ids {
            impacted_ids.insert(node_id.clone());
            if let Some(dependents) = s.reverse_adjacency.get(&node_id) {
                for dep_id in dependents {
                    impacted_ids.insert(dep_id.clone());
                    for e in s
                        .edges
                        .iter()
                        .filter(|e| e.source == *dep_id && e.target == node_id)
                    {
                        result_edges.push(e.clone());
                    }
                    if let Some(trans) = s.reverse_adjacency.get(dep_id) {
                        for trans_id in trans {
                            impacted_ids.insert(trans_id.clone());
                        }
                    }
                }
            }
        }
    }

    let result_nodes: Vec<GraphNode> = impacted_ids
        .iter()
        .filter_map(|id| s.nodes.get(id).cloned())
        .collect();

    // Group by file for summary
    let mut file_groups: HashMap<String, Vec<&GraphNode>> = HashMap::new();
    for node in &result_nodes {
        file_groups
            .entry(node.file_path.clone())
            .or_default()
            .push(node);
    }
    let mut summary_lines = vec![format!(
        "Impact analysis for {} changed file(s):",
        files.len()
    )];
    for (file, nodes) in &file_groups {
        let symbols: Vec<String> = nodes
            .iter()
            .filter(|n| n.kind != "file")
            .map(|n| n.name.clone())
            .collect();
        if symbols.is_empty() {
            summary_lines.push(format!("- {}", file));
        } else {
            summary_lines.push(format!("- {} ({})", file, symbols.join(", ")));
        }
    }
    let summary = summary_lines.join("\n");
    let estimated_tokens = estimate_tokens(&summary);

    GraphQueryResult {
        nodes: result_nodes,
        edges: result_edges,
        summary,
        estimated_tokens,
    }
}

/// `knowledge:stats`
#[tauri::command]
pub fn knowledge_stats(graph: State<'_, Arc<CodeGraph>>) -> serde_json::Value {
    let s = graph.state.lock();
    json!({
        "nodes": s.nodes.len(),
        "edges": s.edges.len(),
        "indexedAt": s.indexed_at,
        "workspacePath": s.workspace_path,
    })
}

/// `knowledge:overview` — navigable overview of the graph (getOverview).
#[tauri::command]
pub fn knowledge_overview(graph: State<'_, Arc<CodeGraph>>) -> serde_json::Value {
    let s = graph.state.lock();
    if s.nodes.is_empty() {
        return json!({
            "stats": { "nodes": 0, "edges": 0, "indexedAt": serde_json::Value::Null },
            "byKind": {}, "topHubs": [], "byDirectory": {}, "dependencySummary": []
        });
    }

    // byKind (non-file, max 50 per kind)
    let mut by_kind: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for node in s.nodes.values() {
        if node.kind == "file" {
            continue;
        }
        let bucket = by_kind.entry(node.kind.clone()).or_default();
        if bucket.len() < 50 {
            bucket
                .push(json!({ "name": node.name, "filePath": node.file_path, "line": node.line }));
        }
    }

    // topHubs
    let mut hub_scores: Vec<(String, String, String, usize, usize, usize)> = Vec::new();
    for node in s.nodes.values() {
        if node.kind == "file" {
            continue;
        }
        let in_deg = s
            .reverse_adjacency
            .get(&node.id)
            .map(|x| x.len())
            .unwrap_or(0);
        let out_deg = s.adjacency.get(&node.id).map(|x| x.len()).unwrap_or(0);
        if in_deg + out_deg > 0 {
            hub_scores.push((
                node.name.clone(),
                node.kind.clone(),
                node.file_path.clone(),
                in_deg,
                out_deg,
                in_deg + out_deg,
            ));
        }
    }
    hub_scores.sort_by_key(|b| std::cmp::Reverse(b.5));
    let top_hubs: Vec<serde_json::Value> = hub_scores
        .iter()
        .take(20)
        .map(|(name, kind, fp, in_d, out_d, _)| {
            json!({
                "name": name, "kind": kind, "filePath": fp, "inDegree": in_d, "outDegree": out_d
            })
        })
        .collect();

    // byDirectory (top-level dir)
    let mut by_directory: HashMap<String, (usize, usize, Vec<String>)> = HashMap::new();
    for (file_path, node_ids) in &s.file_index {
        let top_dir = file_path
            .split('/')
            .next()
            .filter(|x| !x.is_empty())
            .unwrap_or(file_path)
            .to_string();
        let entry = by_directory.entry(top_dir).or_insert((0, 0, Vec::new()));
        entry.0 += 1;
        entry.1 += node_ids
            .iter()
            .filter(|id| s.nodes.get(*id).map(|n| n.kind != "file").unwrap_or(false))
            .count();
        if entry.2.len() < 20 {
            entry.2.push(file_path.clone());
        }
    }
    let by_directory_json: serde_json::Map<String, serde_json::Value> = by_directory
        .into_iter()
        .map(|(k, (fc, sc, files))| {
            (
                k,
                json!({ "fileCount": fc, "symbolCount": sc, "files": files }),
            )
        })
        .collect();

    // dependencySummary: heaviest edges (top 30)
    let mut sorted_edges: Vec<&GraphEdge> = s.edges.iter().collect();
    sorted_edges.sort_by_key(|b| std::cmp::Reverse(b.weight));
    let dependency_summary: Vec<serde_json::Value> = sorted_edges
        .iter()
        .take(30)
        .map(|e| json!({
            "source": s.nodes.get(&e.source).map(|n| n.name.clone()).unwrap_or_else(|| e.source.clone()),
            "target": s.nodes.get(&e.target).map(|n| n.name.clone()).unwrap_or_else(|| e.target.clone()),
            "kind": e.kind,
            "weight": e.weight,
        }))
        .collect();

    json!({
        "stats": { "nodes": s.nodes.len(), "edges": s.edges.len(), "indexedAt": s.indexed_at },
        "byKind": by_kind,
        "topHubs": top_hubs,
        "byDirectory": serde_json::Value::Object(by_directory_json),
        "dependencySummary": dependency_summary,
    })
}

/// Folder under the app data dir that holds the semantic index of each workspace.
pub(crate) const INDEX_STORE_DIR: &str = "semantic-index";

/// Where the code graph and embeddings of a workspace are persisted: the app
/// data folder, keyed by a hash of the workspace path (same key as the
/// context snapshots). Writing `.promptops/` into the user's repository on
/// every index run touched files the user never asked us to create.
fn index_dir(workspace_path: &str) -> PathBuf {
    index_dir_in(&crate::commands::hook::hook_data_dir(), workspace_path)
}

fn index_dir_in(data_dir: &Path, workspace_path: &str) -> PathBuf {
    data_dir
        .join(INDEX_STORE_DIR)
        .join(crate::commands::smart_context::workspace_key(
            workspace_path,
        ))
}

/// Kind under which the index files are sealed (`local_store::seal_blob`).
const INDEX_BLOB_KIND: &str = "semantic-index";

/// Writes one index file sealed with the local store key: the index holds
/// the workspace path, file and symbol names and embeddings of the code, and
/// every other file with workspace content is encrypted. Without a store
/// (it is always opened at start) nothing is written in clear.
/// `record` names the file in its envelope (workspace key and file name), so a
/// sealed file moved to another workspace or name does not open.
fn write_index_file(dir: &Path, record: &str, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let Some(store) = crate::local_store::get() else {
        return Ok(());
    };
    let id = format!("{record}/{name}");
    let sealed = store
        .seal_blob(INDEX_BLOB_KIND, &id, bytes)
        .map_err(std::io::Error::other)?;
    crate::local_store::write_private(&dir.join(name), &sealed).map_err(std::io::Error::other)
}

/// The workspace key of an index folder (its last path component).
fn index_record(index: &Path) -> String {
    index
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn persist_graph(graph: &CodeGraph, workspace_path: &str) -> std::io::Result<()> {
    persist_graph_in(&index_dir(workspace_path), graph, workspace_path)
}

fn persist_graph_in(dir: &Path, graph: &CodeGraph, workspace_path: &str) -> std::io::Result<()> {
    crate::local_store::create_private_dir(dir).map_err(std::io::Error::other)?;
    let s = graph.state.lock();
    let data = SerializedGraph {
        version: GRAPH_VERSION,
        indexed_at: s.indexed_at.unwrap_or_else(now_ms),
        workspace_path: workspace_path.to_string(),
        nodes: s.nodes.values().cloned().collect(),
        edges: s.edges.clone(),
        file_hashes: s.file_hashes.clone(),
    };
    let json = serde_json::to_string(&data).unwrap_or_default();
    write_index_file(dir, &index_record(dir), "code-graph.json", json.as_bytes())
}

// ════════════════════════════════════════════════════════════════════════
//  SESSION MEMORY (native)
// ════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub timestamp: i64,
    pub tags: Vec<String>,
    pub category: String, // MemoryCategory: bug|architecture|pattern|dependency|config|decision|warning
    pub content: String,
    #[serde(rename = "relatedFiles")]
    pub related_files: Vec<String>,
    #[serde(rename = "relatedSymbols")]
    pub related_symbols: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<bool>,
}

/// "Scored" entry — `MemoryEntry & { relevance }` (relevance is appended).
#[derive(Serialize)]
struct ScoredMemoryEntry {
    #[serde(flatten)]
    entry: MemoryEntry,
    relevance: f64,
}

#[derive(Serialize)]
pub struct MemorySearchResult {
    entries: Vec<ScoredMemoryEntry>,
    summary: String,
    #[serde(rename = "estimatedTokens")]
    estimated_tokens: usize,
}

/// Input of `memory:add` (entry without id/timestamp, generated natively).
#[derive(Deserialize)]
pub struct MemoryEntryInput {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub tags: Vec<String>,
    pub category: String,
    pub content: String,
    #[serde(rename = "relatedFiles")]
    pub related_files: Vec<String>,
    #[serde(rename = "relatedSymbols")]
    pub related_symbols: Vec<String>,
}

#[derive(Default)]
struct MemoryState {
    entries: HashMap<String, MemoryEntry>,
    #[allow(dead_code)]
    workspace_path: Option<String>,
}

#[derive(Default)]
pub struct SessionMemory {
    state: Mutex<MemoryState>,
}

impl SessionMemory {
    pub fn new() -> Self {
        Self::default()
    }
}

/// `memory:add`
#[tauri::command]
pub fn memory_add(
    memory: State<'_, Arc<SessionMemory>>,
    entry: MemoryEntryInput,
) -> serde_json::Value {
    let id: String = uuid::Uuid::new_v4().to_string().chars().take(12).collect();
    let full = MemoryEntry {
        id: id.clone(),
        session_id: entry.session_id,
        timestamp: now_ms(),
        tags: entry.tags,
        category: entry.category,
        content: entry.content,
        related_files: entry.related_files,
        related_symbols: entry.related_symbols,
        resolved: None,
    };

    let mut s = memory.state.lock();
    s.entries.insert(id.clone(), full.clone());

    // Enforce MAX_ENTRIES: remove the oldest ones.
    if s.entries.len() > MAX_ENTRIES {
        let mut sorted: Vec<(String, i64)> = s
            .entries
            .values()
            .map(|e| (e.id.clone(), e.timestamp))
            .collect();
        sorted.sort_by_key(|a| a.1);
        let to_remove = s.entries.len() - MAX_ENTRIES;
        for (rid, _) in sorted.into_iter().take(to_remove) {
            s.entries.remove(&rid);
        }
    }

    json!({ "ok": true, "entry": full })
}

/// `memory:search` — text + tags, score * recency.
#[tauri::command]
pub fn memory_search(
    memory: State<'_, Arc<SessionMemory>>,
    query: Option<String>,
    tags: Option<Vec<String>>,
    top_k: Option<usize>,
) -> MemorySearchResult {
    let top_k = top_k.unwrap_or(5);
    let s = memory.state.lock();

    let mut candidates: Vec<&MemoryEntry> = s.entries.values().collect();

    if let Some(tags) = &tags {
        if !tags.is_empty() {
            let tag_set: HashSet<String> = tags.iter().map(|t| t.to_lowercase()).collect();
            candidates.retain(|e| e.tags.iter().any(|t| tag_set.contains(&t.to_lowercase())));
        }
    }

    if candidates.is_empty() {
        return MemorySearchResult {
            entries: vec![],
            summary: String::new(),
            estimated_tokens: 0,
        };
    }

    let now = now_ms();
    let mut scored: Vec<(MemoryEntry, f64)> = Vec::new();

    for entry in candidates {
        let mut score: f64 = 0.0;

        if let Some(q) = &query {
            let lower_query = q.to_lowercase();
            let lower_content = entry.content.to_lowercase();
            if lower_content.contains(&lower_query) {
                score += 0.8;
            } else {
                let query_words: HashSet<String> = lower_query
                    .split_whitespace()
                    .filter(|w| w.len() > 2)
                    .map(|w| w.to_string())
                    .collect();
                let content_words: Vec<String> = lower_content
                    .split_whitespace()
                    .map(|w| w.to_string())
                    .collect();
                let mut overlap = 0usize;
                for w in &query_words {
                    for cw in &content_words {
                        if cw.contains(w) {
                            overlap += 1;
                            break;
                        }
                    }
                }
                if !query_words.is_empty() {
                    score += (overlap as f64 / query_words.len() as f64) * 0.6;
                }
            }
            for file in &entry.related_files {
                if lower_query.contains(&basename(file).to_lowercase()) {
                    score += 0.3;
                }
            }
            for sym in &entry.related_symbols {
                if lower_query.contains(&sym.to_lowercase()) {
                    score += 0.4;
                }
            }
        } else {
            score = 0.5;
        }

        // Recency boost (≤7 days → up to +20%)
        let age_ms = (now - entry.timestamp) as f64;
        let age_days = age_ms / (24.0 * 60.0 * 60.0 * 1000.0);
        if age_days < 7.0 {
            score *= 1.0 + (0.2 * (1.0 - age_days / 7.0));
        }

        if score > 0.1 {
            let relevance = (score * 100.0).round() / 100.0;
            scored.push((entry.clone(), relevance));
        }
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    let mut summary_lines = Vec::new();
    for (entry, _) in &scored {
        let date = iso_date(entry.timestamp);
        let files = if entry.related_files.is_empty() {
            "none".to_string()
        } else {
            entry.related_files.join(", ")
        };
        summary_lines.push(format!(
            "[{}] {} ({}, files: {})",
            entry.category, entry.content, date, files
        ));
    }
    let summary = summary_lines.join("\n");
    let estimated_tokens = estimate_tokens(&summary);

    let entries: Vec<ScoredMemoryEntry> = scored
        .into_iter()
        .map(|(entry, relevance)| ScoredMemoryEntry { entry, relevance })
        .collect();
    MemorySearchResult {
        entries,
        summary,
        estimated_tokens,
    }
}

/// `memory:search-files` — entries linked to specific files.
#[tauri::command]
pub fn memory_search_files(
    memory: State<'_, Arc<SessionMemory>>,
    files: Vec<String>,
) -> MemorySearchResult {
    let s = memory.state.lock();
    let base_names: HashSet<String> = files.iter().map(|f| basename(f).to_lowercase()).collect();
    let mut scored: Vec<(MemoryEntry, f64)> = Vec::new();

    for entry in s.entries.values() {
        let mut match_count = 0usize;
        for rel_file in &entry.related_files {
            if base_names.contains(&basename(rel_file).to_lowercase()) {
                match_count += 1;
            }
            for fp in &files {
                if rel_file.contains(fp) || fp.contains(rel_file) {
                    match_count += 1;
                }
            }
        }
        if match_count > 0 {
            scored.push((entry.clone(), match_count as f64));
        }
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(5);

    let summary = scored
        .iter()
        .map(|(e, _)| format!("[{}] {}", e.category, e.content))
        .collect::<Vec<_>>()
        .join("\n");
    let estimated_tokens = estimate_tokens(&summary);

    let entries: Vec<ScoredMemoryEntry> = scored
        .into_iter()
        .map(|(entry, relevance)| ScoredMemoryEntry { entry, relevance })
        .collect();
    MemorySearchResult {
        entries,
        summary,
        estimated_tokens,
    }
}

/// `memory:resolve`
#[tauri::command]
pub fn memory_resolve(
    memory: State<'_, Arc<SessionMemory>>,
    entry_id: String,
) -> serde_json::Value {
    let mut s = memory.state.lock();
    if let Some(entry) = s.entries.get_mut(&entry_id) {
        entry.resolved = Some(true);
    }
    json!({ "ok": true })
}

/// `memory:stats`
#[tauri::command]
pub fn memory_stats(memory: State<'_, Arc<SessionMemory>>) -> serde_json::Value {
    let s = memory.state.lock();
    let timestamps: Vec<i64> = s.entries.values().map(|e| e.timestamp).collect();
    json!({
        "entryCount": s.entries.len(),
        "oldestEntry": timestamps.iter().min().copied(),
        "newestEntry": timestamps.iter().max().copied(),
    })
}

/// `memory:prune` — removes old/resolved entries.
#[tauri::command]
pub fn memory_prune(memory: State<'_, Arc<SessionMemory>>) -> serde_json::Value {
    let mut s = memory.state.lock();
    let now = now_ms();
    let mut removed = 0usize;
    let ids: Vec<String> = s.entries.keys().cloned().collect();
    for id in ids {
        let (resolved, age_days) = {
            let e = &s.entries[&id];
            let age_days = (now - e.timestamp) as f64 / (24.0 * 60.0 * 60.0 * 1000.0);
            (e.resolved.unwrap_or(false), age_days)
        };
        if (resolved && age_days > PRUNE_RESOLVED_DAYS) || age_days > PRUNE_OLD_DAYS {
            s.entries.remove(&id);
            removed += 1;
        }
    }
    json!({ "ok": true, "removed": removed })
}

fn iso_date(ts_ms: i64) -> String {
    // Equivalent of `new Date(ts).toISOString().split('T')[0]` (YYYY-MM-DD, UTC).
    // Civil conversion from the epoch day without external date dependencies.
    let days = ts_ms.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Howard Hinnant's days→civil (proleptic Gregorian, UTC).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ════════════════════════════════════════════════════════════════════════
//  SEMANTIC EMBEDDINGS
//
//  NATIVE chunking/search/persistence logic; the embedding step
//  (onnxruntime/transformers.js) is routed to a Node SIDECAR.
// ════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    pub content: String,
    pub kind: String, // 'function' | 'class' | 'block' | 'file-header' | 'config'
    #[serde(rename = "symbolName", skip_serializing_if = "Option::is_none")]
    pub symbol_name: Option<String>,
}

/// Chunk with a score for search (`CodeChunk & { score }`).
#[derive(Serialize)]
struct ScoredChunk {
    #[serde(flatten)]
    chunk: CodeChunk,
    score: f64,
}

#[derive(Serialize)]
pub struct SemanticSearchResult {
    chunks: Vec<ScoredChunk>,
    summary: String,
    #[serde(rename = "estimatedTokens")]
    estimated_tokens: usize,
    /// True when this build has no embedding runtime (see `Sidecar::runtime_dir`):
    /// the UI says the feature is unavailable instead of showing "no results".
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unavailable: bool,
}

/// Persisted metadata (without content) — `Omit<CodeChunk,'content'>`.
#[derive(Serialize, Deserialize)]
struct ChunkMeta {
    id: String,
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "startLine")]
    start_line: usize,
    #[serde(rename = "endLine")]
    end_line: usize,
    kind: String,
    #[serde(rename = "symbolName", skip_serializing_if = "Option::is_none")]
    symbol_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct PersistedIndex {
    version: u32,
    #[serde(rename = "indexedAt")]
    indexed_at: i64,
    #[serde(rename = "chunkMeta")]
    chunk_meta: Vec<ChunkMeta>,
    #[serde(rename = "contentHashes")]
    content_hashes: HashMap<String, String>,
    #[serde(rename = "embeddingDim")]
    embedding_dim: usize,
}

#[derive(Default)]
struct EmbeddingState {
    chunks: HashMap<String, CodeChunk>,
    embeddings: HashMap<String, Vec<f32>>,
    content_hashes: HashMap<String, String>,
    is_ready: bool,
    embedding_dim: usize,
    indexed_at: Option<i64>,
}

#[derive(Default)]
pub struct EmbeddingEngine {
    state: Mutex<EmbeddingState>,
}

impl EmbeddingEngine {
    pub fn new() -> Self {
        let mut e = Self::default();
        e.state.get_mut().embedding_dim = EMBEDDING_DIM;
        e
    }
}

fn chunk_id(file_path: &str, start_line: usize, end_line: usize) -> String {
    md5_hex12(&format!("{}:{}:{}", file_path, start_line, end_line))
}

/// `chunkToText` — prefix + content for the embedding.
fn chunk_to_text(c: &CodeChunk) -> String {
    let prefix = match &c.symbol_name {
        Some(sym) => format!("{} {} {}", c.file_path, sym, c.kind),
        None => format!("{} {}", c.file_path, c.kind),
    };
    format!("{}\n{}", prefix, c.content)
}

fn is_config_file(rel_path: &str) -> bool {
    use regex::Regex;
    // /\.(json|ya?ml|toml|env|ini|cfg)$/ || /config\.(ts|js|mjs|php)$/
    let ext_re = Regex::new(r"\.(json|ya?ml|toml|env|ini|cfg)$").unwrap();
    let cfg_re = Regex::new(r"config\.(ts|js|mjs|php)$").unwrap();
    ext_re.is_match(rel_path) || cfg_re.is_match(rel_path)
}

/// `chunkFile` — AST boundaries when possible, sliding window as a fallback.
fn chunk_file(rel_path: &str, content: &str) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.split('\n').collect();
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let mut chunks = Vec::new();

    let is_config = is_config_file(rel_path);

    if is_config || lines.len() <= CHUNK_MAX_LINES {
        chunks.push(CodeChunk {
            id: chunk_id(rel_path, 1, lines.len()),
            file_path: rel_path.into(),
            start_line: 1,
            end_line: lines.len(),
            content: content.into(),
            kind: if is_config {
                "config".into()
            } else {
                "file-header".into()
            },
            symbol_name: None,
        });
        return chunks;
    }

    let boundaries = detect_boundaries(content, &ext);

    if !boundaries.is_empty() {
        for b in boundaries {
            let chunk_content = lines[(b.start_line - 1)..b.end_line.min(lines.len())].join("\n");
            chunks.push(CodeChunk {
                id: chunk_id(rel_path, b.start_line, b.end_line),
                file_path: rel_path.into(),
                start_line: b.start_line,
                end_line: b.end_line,
                content: chunk_content,
                kind: b.kind,
                symbol_name: b.name,
            });
        }
    } else {
        // Sliding window
        let step = CHUNK_MAX_LINES - CHUNK_OVERLAP_LINES;
        let mut start = 0usize;
        while start < lines.len() {
            let end = (start + CHUNK_MAX_LINES).min(lines.len());
            let chunk_content = lines[start..end].join("\n");
            chunks.push(CodeChunk {
                id: chunk_id(rel_path, start + 1, end),
                file_path: rel_path.into(),
                start_line: start + 1,
                end_line: end,
                content: chunk_content,
                kind: "block".into(),
                symbol_name: None,
            });
            if end >= lines.len() {
                break;
            }
            start += step;
        }
    }

    chunks
}

struct Boundary {
    start_line: usize,
    end_line: usize,
    kind: String,
    name: Option<String>,
}

/// `detectBoundaries` — JS-like decl match + matching brace for the block.
fn detect_boundaries(content: &str, ext: &str) -> Vec<Boundary> {
    use regex::Regex;
    let lines: Vec<&str> = content.split('\n').collect();
    let mut boundaries = Vec::new();

    let is_js_like = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "php"].contains(&ext);
    if !is_js_like {
        return boundaries;
    }

    let decl_re = Regex::new(
        r"(?:export\s+)?(?:async\s+)?(?:function|class|interface|enum)\s+(\w+)|(?:(?:public|private|protected|static|async)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{",
    )
    .unwrap();

    for m in decl_re.captures_iter(content) {
        let whole = m.get(0).unwrap();
        let name = m
            .get(1)
            .or_else(|| m.get(2))
            .map(|x| x.as_str().to_string());
        let start_line = line_of(content, whole.start());

        // Find the matching closing brace.
        let mut brace_depth: i32 = 0;
        let mut in_block = false;
        let mut end_line = start_line;
        let mut i = start_line - 1;
        while i < lines.len() {
            for ch in lines[i].chars() {
                if ch == '{' {
                    brace_depth += 1;
                    in_block = true;
                }
                if ch == '}' {
                    brace_depth -= 1;
                }
            }
            if in_block && brace_depth == 0 {
                end_line = i + 1;
                break;
            }
            if i.saturating_sub(start_line - 1) > CHUNK_MAX_LINES * 2 {
                end_line = (start_line + CHUNK_MAX_LINES).min(lines.len());
                break;
            }
            i += 1;
        }

        if end_line > start_line && end_line - start_line <= CHUNK_MAX_LINES * 2 {
            let kind = if whole.as_str().contains("class") {
                "class"
            } else {
                "function"
            };
            boundaries.push(Boundary {
                start_line,
                end_line,
                kind: kind.into(),
                name,
            });
        }
    }

    boundaries
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    let len = a.len().min(b.len());
    for i in 0..len {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

// ── semantic:* command surface ──────────────────────────────────────────

/// `semantic:index` — chunk + embed (via sidecar) + persist.
/// Emits `semantic:embedding-progress` during chunking/embedding.
///
/// Returns `{ ok, stats:{ chunks, embedded, chunkDuration, embedDuration } }`
/// on success, or `{ ok:false, error }`.
#[tauri::command]
pub async fn semantic_index(
    app: AppHandle,
    engine: State<'_, Arc<EmbeddingEngine>>,
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    // spawn_blocking: chunking + embedding of the whole workspace off the
    // main thread. The result stays {ok,...} (never reject).
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        match do_semantic_index(&app, &engine, &workspace_path) {
            Ok(stats) => json!({ "ok": true, "stats": stats }),
            Err(e) => json!({ "ok": false, "error": e }),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn do_semantic_index(
    app: &AppHandle,
    engine: &EmbeddingEngine,
    workspace_path: &str,
) -> Result<serde_json::Value, String> {
    // initialize() → signals the model is ready (the sidecar is the pipeline).
    {
        let mut s = engine.state.lock();
        s.is_ready = true;
        if s.embedding_dim == 0 {
            s.embedding_dim = EMBEDDING_DIM;
        }
    }
    let _ = app.emit("semantic:ready", json!({ "status": "ready" }));

    // ── Chunking (native) ──
    let chunk_start = now_ms();
    let ws = PathBuf::from(workspace_path);
    let files = list_files(&ws);
    let mut new_chunks: HashMap<String, CodeChunk> = HashMap::new();
    let mut content_hashes: HashMap<String, String> = HashMap::new();
    let mut processed = 0usize;

    for rel_path in &files {
        let abs = ws.join(rel_path);
        let content = match std::fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(_) => continue,
        };
        content_hashes.insert(rel_path.clone(), md5_hex(&content));
        for chunk in chunk_file(rel_path, &content) {
            new_chunks.insert(chunk.id.clone(), chunk);
        }
        processed += 1;
        if processed.is_multiple_of(100) {
            let _ = app.emit(
                "semantic:embedding-progress",
                json!({
                    "phase": "chunking", "processed": processed, "total": files.len()
                }),
            );
        }
    }
    let chunk_count = new_chunks.len();
    let chunk_duration = now_ms() - chunk_start;

    {
        let mut s = engine.state.lock();
        s.chunks = new_chunks;
        s.content_hashes = content_hashes;
        s.embeddings.clear();
    }

    // ── Embedding (sidecar) ──
    let embed_start = now_ms();
    let chunk_list: Vec<CodeChunk> = {
        let s = engine.state.lock();
        s.chunks.values().cloned().collect()
    };

    let texts: Vec<String> = chunk_list.iter().map(chunk_to_text).collect();
    let mut embedded = 0usize;
    let mut unavailable = false;

    // TODO: send batches of 32; for now the whole set goes in one
    // sidecar call. When the sidecar streams progress, re-emit
    // 'semantic:embedding-progress' { phase:'embedding', processed, total }.
    match Sidecar::embed(&texts) {
        Ok(vectors) => {
            let mut s = engine.state.lock();
            for (chunk, vec) in chunk_list.iter().zip(vectors) {
                if !vec.is_empty() {
                    s.embeddings.insert(chunk.id.clone(), vec);
                    embedded += 1;
                }
            }
            s.indexed_at = Some(now_ms());
            let _ = app.emit(
                "semantic:embedding-progress",
                json!({
                    "phase": "embedding", "processed": embedded, "total": chunk_list.len()
                }),
            );
        }
        Err(e) => {
            // Like embedAllChunks: a model failure is not fatal for
            // indexing (embedded=0). We log via eprintln.
            unavailable = e == SEMANTIC_UNAVAILABLE;
            eprintln!("[EmbeddingEngine] sidecar embed failed: {}", e);
        }
    }
    let embed_duration = now_ms() - embed_start;

    persist_embeddings(engine, workspace_path).map_err(|e| e.to_string())?;

    Ok(json!({
        "chunks": chunk_count,
        "embedded": embedded,
        "chunkDuration": chunk_duration,
        "embedDuration": embed_duration,
        "unavailable": unavailable,
    }))
}

/// `semantic:search` — embed query (sidecar) + cosine sim + topK with token budget.
/// Async + spawn_blocking: the sidecar can take seconds (model load), and a
/// sync command would run on the main thread and freeze the window.
#[tauri::command]
pub async fn semantic_search(
    engine: State<'_, Arc<EmbeddingEngine>>,
    query: String,
    top_k: Option<usize>,
    max_tokens: Option<usize>,
) -> Result<SemanticSearchResult, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        semantic_search_impl(&engine, query, top_k, max_tokens)
    })
    .await
    .map_err(|e| e.to_string())
}

fn semantic_search_impl(
    engine: &EmbeddingEngine,
    query: String,
    top_k: Option<usize>,
    max_tokens: Option<usize>,
) -> SemanticSearchResult {
    let top_k = top_k.unwrap_or(5);
    let mut token_budget = max_tokens.unwrap_or(2000) as i64;

    let empty = || SemanticSearchResult {
        chunks: vec![],
        summary: String::new(),
        estimated_tokens: 0,
        unavailable: Sidecar::runtime_dir().is_none(),
    };

    {
        let s = engine.state.lock();
        if !s.is_ready || s.embeddings.is_empty() {
            return empty();
        }
    }

    // Embed query via sidecar.
    let query_embedding = match Sidecar::embed(std::slice::from_ref(&query)) {
        Ok(mut v) if !v.is_empty() => v.remove(0),
        _ => return empty(),
    };
    if query_embedding.is_empty() {
        return empty();
    }

    let s = engine.state.lock();

    // Cosine sim against all.
    let mut scores: Vec<(String, f32)> = s
        .embeddings
        .iter()
        .map(|(id, emb)| (id.clone(), cosine_similarity(&query_embedding, emb)))
        .collect();
    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut top_chunks: Vec<ScoredChunk> = Vec::new();
    for (id, score) in scores.into_iter().take(top_k * 2) {
        if top_chunks.len() >= top_k {
            break;
        }
        let chunk = match s.chunks.get(&id) {
            Some(c) => c,
            None => continue,
        };
        let chunk_tokens = (chunk.content.len() as f64 * 0.25).round() as i64;
        if chunk_tokens > token_budget {
            continue;
        }
        token_budget -= chunk_tokens;
        top_chunks.push(ScoredChunk {
            chunk: chunk.clone(),
            score: score as f64,
        });
    }

    // Build summary.
    let mut summary_lines: Vec<String> = Vec::new();
    for sc in &top_chunks {
        let c = &sc.chunk;
        let header = match &c.symbol_name {
            Some(sym) => format!(
                "### {}:{} (lines {}-{}) [score: {:.2}]",
                c.file_path, sym, c.start_line, c.end_line, sc.score
            ),
            None => format!(
                "### {} (lines {}-{}) [score: {:.2}]",
                c.file_path, c.start_line, c.end_line, sc.score
            ),
        };
        summary_lines.push(header);
        summary_lines.push("```".into());
        summary_lines.push(c.content.chars().take(500).collect());
        summary_lines.push("```".into());
    }
    let summary = summary_lines.join("\n");
    let estimated_tokens = estimate_tokens(&summary);

    SemanticSearchResult {
        chunks: top_chunks,
        summary,
        estimated_tokens,
        unavailable: false,
    }
}

/// `semantic:status`
#[tauri::command]
pub fn semantic_status(engine: State<'_, Arc<EmbeddingEngine>>) -> serde_json::Value {
    let s = engine.state.lock();
    let available = Sidecar::runtime_dir().is_some();
    json!({
        "isReady": s.is_ready,
        "chunkCount": s.chunks.len(),
        "embeddingCount": s.embeddings.len(),
        "indexedAt": s.indexed_at,
        // false = this build ships no embedding runtime: semantic search cannot work
        // here (keyword knowledge search still does). The UI hides the semantic mode.
        "available": available,
        "unavailableReason": if available { serde_json::Value::Null } else { json!(SEMANTIC_UNAVAILABLE) },
    })
}

fn persist_embeddings(engine: &EmbeddingEngine, workspace_path: &str) -> std::io::Result<()> {
    persist_embeddings_in(&index_dir(workspace_path), engine)
}

fn persist_embeddings_in(index: &Path, engine: &EmbeddingEngine) -> std::io::Result<()> {
    let dir = index.join("embeddings");
    let record = format!("{}/embeddings", index_record(index));
    crate::local_store::create_private_dir(index).map_err(std::io::Error::other)?;
    crate::local_store::create_private_dir(&dir).map_err(std::io::Error::other)?;
    let s = engine.state.lock();

    // chunks.json (metadata without content)
    let index = PersistedIndex {
        version: INDEX_VERSION,
        indexed_at: s.indexed_at.unwrap_or_else(now_ms),
        chunk_meta: s
            .chunks
            .values()
            .map(|c| ChunkMeta {
                id: c.id.clone(),
                file_path: c.file_path.clone(),
                start_line: c.start_line,
                end_line: c.end_line,
                kind: c.kind.clone(),
                symbol_name: c.symbol_name.clone(),
            })
            .collect(),
        content_hashes: s.content_hashes.clone(),
        embedding_dim: s.embedding_dim,
    };
    write_index_file(
        &dir,
        &record,
        "chunks.json",
        serde_json::to_string(&index).unwrap_or_default().as_bytes(),
    )?;

    // embeddings.bin (Float32 little-endian) + embedding-order.json
    let dim = s.embedding_dim.max(1);
    let id_order: Vec<String> = s.embeddings.keys().cloned().collect();
    let mut buffer: Vec<u8> = Vec::with_capacity(id_order.len() * dim * 4);
    for id in &id_order {
        let emb = &s.embeddings[id];
        for i in 0..dim {
            let v = emb.get(i).copied().unwrap_or(0.0);
            buffer.extend_from_slice(&v.to_le_bytes());
        }
    }
    write_index_file(&dir, &record, "embeddings.bin", &buffer)?;
    write_index_file(
        &dir,
        &record,
        "embedding-order.json",
        serde_json::to_string(&id_order)
            .unwrap_or_default()
            .as_bytes(),
    )?;
    Ok(())
}

// Suppress dead-code warnings for cache constants kept for a future load().
#[allow(dead_code)]
const _CACHE_CONSTS: (u32, i64, i64) =
    (MEMORY_VERSION, SEM_MAX_CACHE_AGE_MS, GRAPH_MAX_CACHE_AGE_MS);

// ════════════════════════════════════════════════════════════════════════
//  SIDECAR seam — out-of-process embedding compute (Node)
// ════════════════════════════════════════════════════════════════════════
//
// TODO: SIDECAR CONTRACT
// -----------------------------------
// The transformers.js/onnxruntime pipelines have no simple, lightweight Rust
// equivalent in this module. The embedding step is delegated to a Node
// process that wraps `@xenova/transformers` (model `Xenova/all-MiniLM-L6-v2`,
// quantized, pooling 'mean', normalize true).
//
// Protocol (JSON, one request/response per line over stdio):
//   stdin  → { "texts": ["...", "..."] }
//   stdout ← { "vectors": [[f32; 384], ...] }   // same order, dim 384
//   (error) stdout ← { "error": "message" }
//
// Invocation: `node <APP_RESOURCES>/embeddings-sidecar.js`
//   - the JS file path must be resolved from the app bundle resources
//     (for now we look for PROMPTOPS_EMBEDDINGS_SIDECAR in env, local fallback).
//   - the same sidecar handles both chunks (semantic:index) and the query
//     (semantic:search): it is just "texts → vectors".
//
// NATIVE EVOLUTION: replace `Sidecar::embed` with the `ort` crate
// (ONNX Runtime for Rust) + a tokenizer (`tokenizers`), loading the
// MiniLM-L6-v2 model in ONNX. At that point the Node sidecar becomes unnecessary.
//
// TODO — known gaps in the embedding engine:
//   1. initialize(): here we don't download/load the model in-process; the
//      sidecar does it on the first send. The 'semantic:model-loading' /
//      'model-ready' events (status loading/ready/error) will have to be re-emitted when the
//      sidecar reports its own state.
//   2. embedAllChunks(): batching by 32 + per-batch progress not yet
//      streamed (we send everything at once — see note above).
//   3. updateIncremental()/load(): not implemented (not exposed via IPC). The
//      persistence paths and JSON shapes are already final, though, so a future load()
//      is trivial (chunks.json + embeddings.bin + embedding-order.json).

struct Sidecar;

/// Error code of an embedding request in a build without the embedding
/// runtime (`@xenova/transformers`). Packaged builds do not ship it (it is
/// ~100 MB with onnxruntime), so semantic search is a developer feature
/// unless the user points `PROMPTOPS_SIDECAR_NODE_MODULES` at a
/// `node_modules` folder that has it. The UI reads `semantic_status().available`.
pub(crate) const SEMANTIC_UNAVAILABLE: &str = "semantic_unavailable";

/// Longest wait for the sidecar: the first run may download the model.
const SIDECAR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Sidecar source, embedded in the binary and materialized in app-data
/// on first use (same pattern as the hook script in hook.rs).
const SIDECAR_SRC: &str = include_str!("../../resources/embeddings-sidecar.js");

impl Sidecar {
    /// Resolves the sidecar script: env override, otherwise the copy
    /// materialized in `<app-data>/sidecar/embeddings-sidecar.js`.
    fn script_path() -> String {
        if let Ok(p) = std::env::var("PROMPTOPS_EMBEDDINGS_SIDECAR") {
            return p;
        }
        let dir = crate::commands::hook::hook_data_dir().join("sidecar");
        let path = dir.join("embeddings-sidecar.js");
        let stale = match std::fs::read_to_string(&path) {
            Ok(existing) => existing != SIDECAR_SRC,
            Err(_) => true,
        };
        if stale {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&path, SIDECAR_SRC);
        }
        path.to_string_lossy().into_owned()
    }

    /// The `node_modules` folder that holds `@xenova/transformers`, if any:
    /// `PROMPTOPS_SIDECAR_NODE_MODULES`, then (debug builds) the repo's
    /// `apps/desktop/node_modules`, then `<app-data>/sidecar/node_modules`.
    /// Never the process cwd (a `node_modules` in the launch directory would
    /// run that directory's code).
    fn runtime_dir() -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(p) = std::env::var_os("PROMPTOPS_SIDECAR_NODE_MODULES") {
            candidates.push(PathBuf::from(p));
        }
        #[cfg(debug_assertions)]
        candidates.push(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../node_modules"
        )));
        candidates.push(
            crate::commands::hook::hook_data_dir()
                .join("sidecar")
                .join("node_modules"),
        );
        first_runtime_dir(candidates)
    }

    /// Sends `texts` to the Node sidecar and returns the vectors (one per text).
    ///
    /// If the sidecar is unavailable/errors, returns `Err` and the caller
    /// degrades gracefully (embedded=0 / empty search), the same as when the
    /// pipeline is not loaded.
    fn embed(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        // No runtime: say so without starting node (and without the sidecar
        // falling back to anything outside the folders listed below).
        let Some(modules) = Self::runtime_dir() else {
            return Err(SEMANTIC_UNAVAILABLE.into());
        };

        let mut child: Child = crate::commands::util_cmd::cmd("node")
            .env("PROMPTOPS_SIDECAR_NODE_MODULES", &modules)
            .arg(Self::script_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn node sidecar: {}", e))?;

        // Write the request (one JSON line).
        let request = json!({ "texts": texts }).to_string();
        {
            let stdin = child.stdin.as_mut().ok_or("sidecar stdin unavailable")?;
            stdin
                .write_all(request.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .map_err(|e| format!("write sidecar stdin: {}", e))?;
        }
        // Close stdin to signal EOF.
        drop(child.stdin.take());

        // Read the first line of stdout, under a deadline: a sidecar stuck
        // on the network (first model download) must not hang the caller.
        let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let res = reader.read_line(&mut line).map(|_| line);
            let _ = tx.send(res);
        });
        let line = match rx.recv_timeout(SIDECAR_TIMEOUT) {
            Ok(Ok(line)) => line,
            Ok(Err(e)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("read sidecar stdout: {}", e));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("embeddings sidecar timed out".into());
            }
        };
        let _ = child.wait();

        if line.trim().is_empty() {
            return Err("sidecar returned no output".into());
        }

        #[derive(Deserialize)]
        struct SidecarResponse {
            vectors: Option<Vec<Vec<f32>>>,
            error: Option<String>,
        }
        let resp: SidecarResponse = serde_json::from_str(line.trim())
            .map_err(|e| format!("parse sidecar response: {}", e))?;
        if let Some(err) = resp.error {
            return Err(err);
        }
        resp.vectors
            .ok_or_else(|| "sidecar response missing 'vectors'".into())
    }
}

fn first_runtime_dir(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|dir| {
        dir.join("@xenova")
            .join("transformers")
            .join("package.json")
            .is_file()
    })
}

// ════════════════════════════════════════════════════════════════════════
//  semantic:search-brief — searchTexts() over the Project Brief documents.
// ════════════════════════════════════════════════════════════════════════

/// Char-safe truncation (slice(0, n) without splitting UTF-8).
fn take_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// semantic:search-brief — embeds the query + brief documents (overview,
/// context file, agent memories, recent activity) and cosine ranking.
/// Async + spawn_blocking: the sidecar loads the model (seconds), never on the
/// main thread.
#[tauri::command]
pub async fn semantic_search_brief(
    workspace_path: String,
    query: String,
    top_k: Option<usize>,
) -> serde_json::Value {
    let top_k = top_k.unwrap_or(5);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let brief = crate::commands::workspace::collect_project_brief(&workspace_path);

        // briefToDocs: (id, label, text).
        let mut docs: Vec<(String, String, String)> = Vec::new();
        if let Some(summary) = &brief.summary {
            docs.push(("overview".into(), "Project overview".into(), summary.clone()));
        }
        for f in &brief.context_files {
            if !f.excerpt.is_empty() {
                docs.push((format!("ctx:{}", f.file_name), f.file_name.clone(), f.excerpt.clone()));
            }
        }
        for m in &brief.agent_memories.entries {
            let id = m.file.clone().unwrap_or_else(|| m.title.clone());
            docs.push((
                format!("mem:{id}"),
                format!("Memory — {}", m.title),
                format!("{}: {}", m.title, m.hook),
            ));
        }
        for (i, a) in brief.recent_activity.iter().enumerate() {
            docs.push((
                format!("act:{i}"),
                format!("Recent activity [{}]", a.category),
                a.content.clone(),
            ));
        }

        if docs.is_empty() || query.trim().is_empty() {
            return json!({ "chunks": [], "summary": "", "estimatedTokens": 0 });
        }

        let mut texts = vec![query.clone()];
        texts.extend(docs.iter().map(|(_, _, text)| take_chars(text, 2000)));

        let vectors = match Sidecar::embed(&texts) {
            Ok(v) if v.len() == texts.len() => v,
            Ok(_) => {
                return json!({ "chunks": [], "summary": "sidecar returned wrong vector count", "estimatedTokens": 0 })
            }
            Err(e) => {
                let unavailable = e == SEMANTIC_UNAVAILABLE;
                return json!({ "chunks": [], "summary": e, "estimatedTokens": 0, "unavailable": unavailable });
            }
        };

        let query_vec = &vectors[0];
        let mut scored: Vec<(f32, &(String, String, String))> = docs
            .iter()
            .enumerate()
            .map(|(i, doc)| (cosine_similarity(query_vec, &vectors[i + 1]), doc))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let top: Vec<&(f32, &(String, String, String))> = scored.iter().take(top_k).collect();

        let summary = top
            .iter()
            .map(|(score, (_, label, text))| {
                format!("### {label} [score: {score:.2}]\n{}", take_chars(text, 500))
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let estimated = (summary.len() as f64 * 0.25).round() as i64;
        let chunks: Vec<serde_json::Value> = top
            .iter()
            .map(|(score, (id, label, text))| {
                json!({ "id": id, "label": label, "text": text, "score": score })
            })
            .collect();
        json!({ "chunks": chunks, "summary": summary, "estimatedTokens": estimated })
    })
    .await;

    result
        .unwrap_or_else(|e| json!({ "chunks": [], "summary": e.to_string(), "estimatedTokens": 0 }))
}

// ════════════════════════════════════════════════════════════════════════
//  md5 — minimal implementation (RFC 1321), to avoid extra dependencies.
//  Used only for reproducible, stable ids/content hashes.
// ════════════════════════════════════════════════════════════════════════

mod md5_impl {
    pub fn hex(input: &[u8]) -> String {
        let digest = compute(input);
        let mut s = String::with_capacity(32);
        for b in digest.iter() {
            s.push_str(&format!("{:02x}", b));
        }
        s
    }

    fn compute(message: &[u8]) -> [u8; 16] {
        const S: [u32; 64] = [
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20,
            5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
        ];
        const K: [u32; 64] = [
            0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
            0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
            0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
            0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
            0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
            0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
            0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
            0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
            0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
            0xeb86d391,
        ];

        let mut a0: u32 = 0x67452301;
        let mut b0: u32 = 0xefcdab89;
        let mut c0: u32 = 0x98badcfe;
        let mut d0: u32 = 0x10325476;

        // Padding
        let mut msg = message.to_vec();
        let orig_len_bits = (message.len() as u64).wrapping_mul(8);
        msg.push(0x80);
        while msg.len() % 64 != 56 {
            msg.push(0);
        }
        msg.extend_from_slice(&orig_len_bits.to_le_bytes());

        for chunk in msg.chunks(64) {
            let mut m = [0u32; 16];
            for i in 0..16 {
                m[i] = u32::from_le_bytes([
                    chunk[i * 4],
                    chunk[i * 4 + 1],
                    chunk[i * 4 + 2],
                    chunk[i * 4 + 3],
                ]);
            }
            let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
            for i in 0..64 {
                let (f, g) = if i < 16 {
                    ((b & c) | (!b & d), i)
                } else if i < 32 {
                    ((d & b) | (!d & c), (5 * i + 1) % 16)
                } else if i < 48 {
                    (b ^ c ^ d, (3 * i + 5) % 16)
                } else {
                    (c ^ (b | !d), (7 * i) % 16)
                };
                let f = f.wrapping_add(a).wrapping_add(K[i]).wrapping_add(m[g]);
                a = d;
                d = c;
                c = b;
                b = b.wrapping_add(f.rotate_left(S[i]));
            }
            a0 = a0.wrapping_add(a);
            b0 = b0.wrapping_add(b);
            c0 = c0.wrapping_add(c);
            d0 = d0.wrapping_add(d);
        }

        let mut out = [0u8; 16];
        out[0..4].copy_from_slice(&a0.to_le_bytes());
        out[4..8].copy_from_slice(&b0.to_le_bytes());
        out[8..12].copy_from_slice(&c0.to_le_bytes());
        out[12..16].copy_from_slice(&d0.to_le_bytes());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decorator_lookback_never_splits_a_character() {
        // Every offset of the class keyword relative to the 200-byte
        // look-back window, with 2- and 3-byte characters before it.
        for pad in 0..8 {
            for ch in ["\u{e0}", "\u{20ac}", "\u{1f600}"] {
                let src = format!(
                    "{}// {}\n@Component({{}})\nexport class Foo extends Bar {{}}\n",
                    "x".repeat(pad),
                    ch.repeat(120)
                );
                let parsed = parse_file("a.ts", &src);
                assert!(parsed.nodes.iter().any(|n| n.name == "Foo"));
            }
        }
        assert_eq!(char_floor("a\u{e9}", 2), 1);
        assert_eq!(char_floor("a\u{e9}", 99), 3);
    }

    #[test]
    fn the_index_lives_in_the_app_data_dir_not_in_the_repo() {
        let data = Path::new("/data");
        let a = index_dir_in(data, "/home/u/repo");
        assert!(a.starts_with("/data/semantic-index"));
        assert!(!a.to_string_lossy().contains("repo"));
        // Same workspace with a trailing slash: same folder; another workspace: another one.
        assert_eq!(a, index_dir_in(data, "/home/u/repo/"));
        assert_ne!(a, index_dir_in(data, "/home/u/other"));
    }

    /// The index names the workspace, its files and symbols: on disk it is
    /// sealed like the rest of the workspace data, never plain JSON.
    #[test]
    fn the_persisted_index_is_sealed() {
        let store = crate::local_store::init_for_tests();
        let root =
            std::env::temp_dir().join(format!("po-sem-seal-{}", crate::local_store::new_id()));
        let index = root.join("semantic-index").join("abc123");
        let workspace = "/home/u/topsecret-client";

        let graph = CodeGraph::new();
        {
            let mut s = graph.state.lock();
            s.nodes.insert(
                "n1".into(),
                GraphNode {
                    id: "n1".into(),
                    kind: "class".into(),
                    name: "AcquisitionPlanner".into(),
                    file_path: "src/merger/acquisition.ts".into(),
                    line: Some(1),
                    metadata: None,
                },
            );
        }
        persist_graph_in(&index, &graph, workspace).unwrap();

        let engine = EmbeddingEngine::new();
        {
            let mut s = engine.state.lock();
            s.chunks.insert(
                "c1".into(),
                CodeChunk {
                    id: "c1".into(),
                    file_path: "src/merger/acquisition.ts".into(),
                    start_line: 1,
                    end_line: 2,
                    content: "class AcquisitionPlanner {}".into(),
                    kind: "class".into(),
                    symbol_name: Some("AcquisitionPlanner".into()),
                },
            );
            s.embeddings.insert("c1".into(), vec![0.5; EMBEDDING_DIM]);
        }
        persist_embeddings_in(&index, &engine).unwrap();

        let files = [
            ("abc123", index.join("code-graph.json")),
            ("abc123/embeddings", index.join("embeddings/chunks.json")),
            (
                "abc123/embeddings",
                index.join("embeddings/embedding-order.json"),
            ),
            ("abc123/embeddings", index.join("embeddings/embeddings.bin")),
        ];
        for (record, path) in &files {
            let raw = std::fs::read(path).unwrap();
            let text = String::from_utf8_lossy(&raw);
            for clear in ["topsecret", "AcquisitionPlanner", "merger"] {
                assert!(!text.contains(clear), "{} holds {clear}", path.display());
            }
            let name = path.file_name().unwrap().to_str().unwrap();
            let opened = store
                .open_blob(INDEX_BLOB_KIND, &format!("{record}/{name}"), &raw)
                .unwrap_or_else(|| panic!("{} does not open", path.display()));
            assert!(!opened.is_empty());
            // Bound to its own name: the graph file does not open as another file.
            assert!(store
                .open_blob(INDEX_BLOB_KIND, &format!("{record}/other.json"), &raw)
                .is_none());
        }
        let graph_json = store
            .open_blob(
                INDEX_BLOB_KIND,
                "abc123/code-graph.json",
                &std::fs::read(&files[0].1).unwrap(),
            )
            .unwrap();
        assert!(String::from_utf8_lossy(&graph_json).contains("AcquisitionPlanner"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_runtime_is_found_only_where_transformers_is_installed() {
        let root = std::env::temp_dir().join(format!("po-sem-rt-{}", crate::local_store::new_id()));
        let empty = root.join("empty");
        let full = root.join("full");
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::create_dir_all(full.join("@xenova/transformers")).unwrap();
        std::fs::write(full.join("@xenova/transformers/package.json"), "{}").unwrap();
        assert_eq!(first_runtime_dir(vec![empty.clone()]), None);
        assert_eq!(
            first_runtime_dir(vec![empty, root.join("missing"), full.clone()]),
            Some(full)
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_search_without_runtime_says_unavailable() {
        let r = SemanticSearchResult {
            chunks: vec![],
            summary: String::new(),
            estimated_tokens: 0,
            unavailable: true,
        };
        assert_eq!(serde_json::to_value(&r).unwrap()["unavailable"], true);
        let r = SemanticSearchResult {
            unavailable: false,
            ..r
        };
        assert!(serde_json::to_value(&r)
            .unwrap()
            .get("unavailable")
            .is_none());
    }
}
