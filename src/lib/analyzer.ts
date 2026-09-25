import JSZip from "jszip";

export type NodeType = "folder" | "file" | "class" | "function";
export type Level = "Beginner" | "Intermediate" | "Advanced";
export interface GNode {
  id: string;
  label: string;
  type: NodeType;
  filePath: string;
  complexity: number;
  pedagogyLevel: Level;
  summary: string;
}
export interface GLink {
  source: string;
  target: string;
  type: "contains" | "imports" | "inherits" | "calls";
}
export interface Graph {
  nodes: GNode[];
  links: GLink[];
}

const IGNORE = /(^|\/)(\.git|node_modules|venv|\.venv|__pycache__|dist|build|\.next)(\/|$)/;
const LOCK = /(package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-lock\.yaml|poetry\.lock)$/;
const CODE = /\.(py|js|jsx|ts|tsx|mjs|cjs)$/;

export async function readZip(file: File): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(file);
  const out: Record<string, string> = {};
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const f of entries) {
    if (IGNORE.test(f.name) || LOCK.test(f.name) || !CODE.test(f.name)) continue;
    out[f.name] = await f.async("string");
  }
  return stripCommonRoot(out);
}

export async function readFileList(files: FileList): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of Array.from(files)) {
    const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (IGNORE.test(p) || LOCK.test(p) || !CODE.test(p)) continue;
    if (f.size > 500_000) continue;
    out[p] = await f.text();
  }
  return stripCommonRoot(out);
}

function stripCommonRoot(files: Record<string, string>) {
  const keys = Object.keys(files);
  if (!keys.length) return files;
  const first = keys[0]!.split("/")[0]!;
  if (keys.length > 1 && keys.every((k) => k.startsWith(first + "/"))) {
    return Object.fromEntries(keys.map((k) => [k.slice(first.length + 1), files[k]!])) as Record<string, string>;
  }
  return files;
}

const BRANCH = /\b(if|elif|else if|for|while|case|catch|except|and|or|&&|\|\||\?)\b/g;

function cyclomatic(src: string) {
  return 1 + (src.match(BRANCH)?.length ?? 0);
}

function score(src: string, depth: number) {
  return Math.max(1, Math.min(10, Math.round(Math.log2(cyclomatic(src) + 1) * 1.6 + depth * 0.5)));
}

function levelFor(path: string, name: string, cx: number): Level {
  const p = (path + "/" + name).toLowerCase();
  if (/(main|index|app|router|routes|config|settings|__init__|cli)\b/.test(p) && cx <= 5) return "Beginner";
  if (/(middleware|async|pool|thread|worker|queue|state|store|reducer|engine|core|pipeline|factory|abstract)/.test(p) || cx >= 7)
    return "Advanced";
  if (cx <= 2) return "Beginner";
  return "Intermediate";
}

interface Def {
  name: string;
  kind: "class" | "function";
  body: string;
  base?: string | undefined;
}

function extractPython(src: string): Def[] {
  const lines = src.split("\n");
  const defs: Def[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)(async\s+def|def|class)\s+(\w+)\s*(\(([^)]*)\))?/);
    if (!m) return;
    const indent = m[1]!.length;
    if (indent > 4) return;
    let j = i + 1;
    while (j < lines.length && (lines[j]!.trim() === "" || lines[j]!.match(/^\s*/)![0].length > indent)) j++;
    const kind = m[2] === "class" ? "class" : "function";
    defs.push({
      name: m[3]!,
      kind,
      body: lines.slice(i, j).join("\n"),
      base: kind === "class" ? m[5]?.split(",")[0]?.trim() : undefined,
    });
  });
  return defs;
}

function extractJs(src: string): Def[] {
  const defs: Def[] = [];
  const re =
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\s*\*?\s*(\w+)|class\s+(\w+)(?:\s+extends\s+([\w.]+))?|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index;
    const open = src.indexOf("{", start + m[0].length - 1);
    let body = m[0];
    if (open !== -1 && open - start < 400) {
      let d = 0;
      let k = open;
      for (; k < src.length; k++) {
        if (src[k] === "{") d++;
        else if (src[k] === "}" && --d === 0) break;
      }
      body = src.slice(start, k + 1);
    }
    const name = m[1] || m[2] || m[4];
    if (!name) continue;
    defs.push({ name, kind: m[2] ? "class" : "function", body, base: m[3] });
  }
  return defs;
}

function imports(path: string, src: string): string[] {
  const out: string[] = [];
  if (path.endsWith(".py")) {
    for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) out.push((m[1] || m[2])!);
  } else {
    for (const m of src.matchAll(/(?:from\s+|require\(\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) out.push(m[1]!);
  }
  return out;
}

function resolveImport(fromPath: string, spec: string, files: Set<string>): string | null {
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.tsx", "/index.js", "/__init__.py"];
  let base: string;
  if (spec.startsWith(".") && !fromPath.endsWith(".py")) {
    const parts = fromPath.split("/").slice(0, -1);
    for (const s of spec.split("/")) {
      if (s === "..") parts.pop();
      else if (s !== ".") parts.push(s);
    }
    base = parts.join("/");
  } else if (spec.startsWith("@/")) {
    base = "src/" + spec.slice(2);
  } else if (fromPath.endsWith(".py")) {
    const dots = spec.match(/^\.*/)![0].length;
    const rest = spec.slice(dots).replace(/\./g, "/");
    if (dots) {
      const parts = fromPath.split("/").slice(0, -dots);
      base = [...parts, rest].filter(Boolean).join("/");
    } else base = rest;
  } else return null;
  for (const e of exts) {
    if (files.has(base + e)) return base + e;
    for (const f of files) if (f.endsWith("/" + base + e)) return f;
  }
  return null;
}

function summarize(d: Def | null, path: string, type: NodeType, cx: number): string {
  if (d) {
    const doc = d.body.match(/"""([\s\S]*?)"""|\/\*\*([\s\S]*?)\*\//);
    if (doc) {
      const t = (doc[1] || doc[2] || "").replace(/^\s*\*\s?/gm, "").trim().split("\n")[0];
      if (t) return t;
    }
    return `${d.kind === "class" ? "Class" : "Function"} ${d.name} in ${path}, with ${cyclomatic(d.body)} decision paths.`;
  }
  if (type === "folder") return `Folder grouping related modules under ${path || "the project root"}.`;
  return `Source module ${path} (complexity ${cx}/10).`;
}

export function analyze(files: Record<string, string>): Graph {
  const nodes = new Map<string, GNode>();
  const links: GLink[] = [];
  const fileSet = new Set(Object.keys(files));
  const nameIndex = new Map<string, string[]>();
  const defsByFile = new Map<string, { id: string; def: Def }[]>();

  const addFolder = (dir: string) => {
    if (!dir || nodes.has(dir)) return;
    const parts = dir.split("/");
    nodes.set(dir, {
      id: dir,
      label: parts[parts.length - 1] + "/",
      type: "folder",
      filePath: dir,
      complexity: Math.min(10, parts.length),
      pedagogyLevel: parts.length <= 1 ? "Beginner" : parts.length <= 3 ? "Intermediate" : "Advanced",
      summary: summarize(null, dir, "folder", 0),
    });
    const parent = parts.slice(0, -1).join("/");
    if (parent) {
      addFolder(parent);
      links.push({ source: parent, target: dir, type: "contains" });
    }
  };

  for (const [path, src] of Object.entries(files)) {
    const depth = path.split("/").length - 1;
    const dir = path.split("/").slice(0, -1).join("/");
    addFolder(dir);
    const cx = score(src, depth);
    const name = path.split("/").pop()!;
    nodes.set(path, {
      id: path,
      label: name,
      type: "file",
      filePath: path,
      complexity: cx,
      pedagogyLevel: levelFor(dir, name, cx),
      summary: summarize(null, path, "file", cx),
    });
    if (dir) links.push({ source: dir, target: path, type: "contains" });

    const defs = path.endsWith(".py") ? extractPython(src) : extractJs(src);
    const list: { id: string; def: Def }[] = [];
    for (const d of defs) {
      const id = `${path}::${d.name}`;
      if (nodes.has(id)) continue;
      const dcx = score(d.body, depth);
      nodes.set(id, {
        id,
        label: d.kind === "function" ? `${d.name}()` : d.name,
        type: d.kind,
        filePath: path,
        complexity: dcx,
        pedagogyLevel: levelFor(path, d.name, dcx),
        summary: summarize(d, path, d.kind, dcx),
      });
      links.push({ source: path, target: id, type: "contains" });
      list.push({ id, def: d });
      nameIndex.set(d.name, [...(nameIndex.get(d.name) ?? []), id]);
    }
    defsByFile.set(path, list);
  }

  for (const [path, src] of Object.entries(files)) {
    const imported = new Set<string>();
    for (const spec of imports(path, src)) {
      const t = resolveImport(path, spec, fileSet);
      if (t && t !== path && !imported.has(t)) {
        imported.add(t);
        links.push({ source: path, target: t, type: "imports" });
      }
    }
    for (const { id, def } of defsByFile.get(path) ?? []) {
      if (def.base) {
        const targets = nameIndex.get(def.base.split(".").pop()!) ?? [];
        const t = targets.find((x) => nodes.get(x)?.type === "class");
        if (t) links.push({ source: id, target: t, type: "inherits" });
      }
      const seen = new Set<string>();
      for (const m of def.body.matchAll(/\b(\w+)\s*\(/g)) {
        const n = m[1]!;
        if (n === def.name || seen.has(n)) continue;
        const targets = nameIndex.get(n);
        if (!targets) continue;
        const t =
          targets.find((x) => x.startsWith(path + "::")) ??
          targets.find((x) => imported.has(x.split("::")[0]!));
        if (t && t !== id) {
          seen.add(n);
          links.push({ source: id, target: t, type: "calls" });
        }
      }
    }
  }

  return { nodes: [...nodes.values()], links };
}

export const SAMPLE: Record<string, string> = {
  "main.py": `from src.auth import router\nfrom src.db import session\n\ndef create_app():\n    """Boots the FastAPI application and mounts routers."""\n    app = build()\n    router.register(app)\n    return app\n\ndef build():\n    return object()\n`,
  "src/auth/router.py": `from .service import generate_token, verify_password\nfrom ..db.repository import UserRepository\n\ndef register(app):\n    """Registers auth endpoints on the app."""\n    pass\n\ndef login_user(email, password):\n    """Handles the login request and returns a token."""\n    user = UserRepository().find(email)\n    if not user or not verify_password(user, password):\n        return None\n    return generate_token(user)\n`,
  "src/auth/service.py": `import hmac\n\ndef generate_token(user):\n    """Generates a signed JWT access token for user sessions."""\n    if user.is_admin:\n        return sign(user, 'admin')\n    return sign(user, 'user')\n\ndef sign(user, role):\n    return hmac.new(b'k', role.encode()).hexdigest()\n\ndef verify_password(user, password):\n    """Compares a password against the stored hash."""\n    return user.hash == password\n`,
  "src/auth/middleware.py": `from .service import verify_password\n\nclass AuthMiddleware:\n    """Async middleware pipeline that guards protected routes."""\n    async def __call__(self, request, call_next):\n        if request.path.startswith('/public') or request.method == 'OPTIONS':\n            return await call_next(request)\n        for header in request.headers:\n            if header == 'x-token' and verify_password(request.user, header):\n                return await call_next(request)\n        return None\n`,
  "src/db/session.py": `class Session:\n    """Holds the database connection."""\n    def query(self, model):\n        return []\n`,
  "src/db/repository.py": `from .session import Session\n\nclass BaseRepository:\n    """Shared data-access helpers."""\n    def __init__(self):\n        self.session = Session()\n\nclass UserRepository(BaseRepository):\n    """Looks up users in the database."""\n    def find(self, email):\n        rows = self.session.query('User')\n        for r in rows:\n            if r.email == email:\n                return r\n        return None\n`,
  "src/utils/pool.py": `import asyncio\n\nclass WorkerPool:\n    """Async thread pool driving background jobs."""\n    async def run(self, jobs):\n        results = []\n        for j in jobs:\n            try:\n                results.append(await j())\n            except Exception:\n                if len(results) > 3 and j:\n                    break\n        return results\n`,
};
