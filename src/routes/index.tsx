import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import type { TutorContext } from "@/components/TutorChat";
import { analyze, readFileList, readZip, SAMPLE, type Graph, type GNode, type Level } from "@/lib/analyzer";

const Graph3D = lazy(() => import("@/components/Graph3D"));
const TutorChat = lazy(() => import("@/components/TutorChat"));

const NODE_SWATCH: Record<string, string> = {
  folder: "bg-node-folder",
  file: "bg-node-file",
  class: "bg-node-class",
  function: "bg-node-function",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CodeMap.AI — Explore any codebase as a 3D map" },
      {
        name: "description",
        content: "Upload a repository and explore its files, classes and functions as an interactive 3D knowledge graph.",
      },
      { property: "og:title", content: "CodeMap.AI — Explore any codebase as a 3D map" },
      {
        property: "og:description",
        content: "Upload a repository and explore it as a 3D knowledge graph tuned to your level.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LEVELS: Level[] = ["Beginner", "Intermediate", "Advanced"];
const RANK: Record<Level, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };

function Bionic({ text, on }: { text: string; on: boolean }) {
  if (!on) return <>{text}</>;
  return (
    <>
      {text.split(/(\s+)/).map((w, i) => {
        if (!w.trim()) return w;
        const k = Math.ceil(w.length * 0.45);
        return (
          <span key={i}>
            <b className="font-bold text-foreground">{w.slice(0, k)}</b>
            <span className="opacity-75">{w.slice(k)}</span>
          </span>
        );
      })}
    </>
  );
}

function Index() {
  const [files, setFiles] = useState<Record<string, string>>(SAMPLE);
  const graph = useMemo<Graph>(() => analyze(files), [files]);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [repoName, setRepoName] = useState("sample-fastapi-app");
  const [level, setLevel] = useState<Level>("Advanced");
  const [bionic, setBionic] = useState(false);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const load = async (name: string, p: Promise<Record<string, string>>) => {
    setBusy(true);
    setError(null);
    try {
      const f = await p;
      if (!Object.keys(f).length) throw new Error("No Python, JavaScript or TypeScript files found.");
      setFiles(f);
      setRepoName(name);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that repository.");
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo<Graph>(() => {
    const nodes = graph.nodes.filter((n) => RANK[n.pedagogyLevel] <= RANK[level]);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
  }, [graph, level]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { folder: 0, file: 0, class: 0, function: 0 };
    visible.nodes.forEach((n) => c[n.type] = (c[n.type] ?? 0) + 1);
    return c;
  }, [visible]);

  const deps = useMemo(() => {
    if (!selected) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.links
      .filter((l) => l.type !== "contains" && (l.source === selected.id || l.target === selected.id))
      .map((l) => ({
        dir: l.source === selected.id ? "out" : "in",
        type: l.type,
        node: byId.get(l.source === selected.id ? l.target : l.source)!,
      }));
  }, [selected, graph]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [query, graph]);

  const jump = (n: GNode) => {
    if (RANK[n.pedagogyLevel] > RANK[level]) setLevel(n.pedagogyLevel);
    setSelected(n);
    setQuery("");
  };

  const tutorContext = useMemo<TutorContext>(() => {
    if (!selected) return null;
    const src = files[selected.filePath] ?? "";
    let snippet = src;
    if (selected.type === "class" || selected.type === "function") {
      const name = selected.id.split("::").pop()!;
      const i = src.search(new RegExp(`(def|class|function|const|let)\\s+${name}\\b`));
      snippet = i >= 0 ? src.slice(i, i + 2500) : src.slice(0, 2500);
    }
    return {
      nodeId: selected.id,
      level,
      nodeContext: `${selected.type} · ${selected.pedagogyLevel} · complexity ${selected.complexity}/10\nSummary: ${selected.summary}\nSource:\n${snippet.slice(0, 3500)}`,
      linkContext:
        deps.map((d) => (d.dir === "out" ? `${selected.id} --${d.type}--> ${d.node.id}` : `${d.node.id} --${d.type}--> ${selected.id}`)).join("\n") ||
        "none",
    };
  }, [selected, files, level, deps]);

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ repository: repoName, exportedAt: new Date().toISOString(), nodes: graph.nodes, links: graph.links }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${repoName}-codemap.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const addChip = (c: string) => setChips((cs) => (cs.includes(c) ? cs : [...cs, c]));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl font-bold tracking-tight">
            CodeMap<span className="text-primary">.AI</span>
          </h1>
          <span className="font-mono text-xs text-muted-foreground">/{repoName}</span>
        </div>
        <div className="relative mx-6 max-w-md flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) jump(results[0]);
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search symbols, files, folders…"
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          {results.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
              {results.map((n) => (
                <button
                  key={n.id}
                  onClick={() => jump(n)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${NODE_SWATCH[n.type]}`} />
                  <span className="font-mono">{n.label}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{n.filePath}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Btn onClick={exportJson}>Export JSON</Btn>
          <input
            ref={zipRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f.name.replace(/\.zip$/, ""), readZip(f)); }}
          />
          <input
            ref={dirRef}
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: "" } as object)}
            onChange={(e) => {
              const fl = e.target.files;
              if (fl?.length) load((fl[0] as any).webkitRelativePath?.split("/")[0] || "repository", readFileList(fl));
            }}
          />
          <Btn onClick={() => dirRef.current?.click()}>Upload folder</Btn>
          <Btn primary onClick={() => zipRef.current?.click()}>
            Upload .zip
          </Btn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border p-5">
          <Section title="Your level">
            <div className="flex flex-col gap-1">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    level === l ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {l}
                  <span className="block text-xs opacity-70">
                    {l === "Beginner" ? "Main flows only" : l === "Intermediate" ? "Core logic & data" : "Full topology"}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Legend">
            {Object.keys(counts).map((t) => (
              <div key={t} className="flex items-center justify-between py-1 text-sm">
                <span className="flex items-center gap-2 capitalize">
                  <span className={`h-3 w-3 rounded-full ${NODE_SWATCH[t]}`} />
                  {t}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{counts[t]}</span>
              </div>
            ))}
          </Section>

          <Section title="Reading">
            <label className="flex cursor-pointer items-center justify-between text-sm">
              Bionic reading
              <input type="checkbox" checked={bionic} onChange={(e) => setBionic(e.target.checked)} className="accent-primary" />
            </label>
          </Section>

          <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
            Drop a .zip anywhere on the map. Files stay in your browser — nothing is uploaded to a server.
          </p>
        </aside>

        <main
          className="relative min-w-0 flex-1 overflow-hidden canvas-bg"
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f?.name.endsWith(".zip")) load(f.name.replace(/\.zip$/, ""), readZip(f));
            else setError("Drop a .zip file of your repository.");
          }}
        >
          <ClientOnly fallback={<Center>Loading map…</Center>}>
            <Suspense fallback={<Center>Loading map…</Center>}>
              <Graph3D graph={visible} selected={selected?.id ?? null} onSelect={setSelected} />
            </Suspense>
          </ClientOnly>
          {(busy || drag) && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <p className="font-display text-lg">{busy ? "Analyzing repository…" : "Drop your .zip to map it"}</p>
            </div>
          )}
          {error && (
            <div className="absolute left-4 top-4 rounded-md border border-destructive bg-card px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-4 left-4 font-mono text-xs text-muted-foreground">
            {visible.nodes.length} nodes · {visible.links.length} links · drag to orbit, click a node to focus
          </div>
        </main>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-border">
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border p-4">
          {selected ? (
            <div className="flex flex-col gap-3">
              <div>
                <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <span className={`h-2.5 w-2.5 rounded-full ${NODE_SWATCH[selected.type]}`} />
                  {selected.type} · {selected.pedagogyLevel} · complexity {selected.complexity}/10
                </span>
                <h2 className="mt-1 break-all font-mono text-base font-semibold">{selected.label}</h2>
                <p className="break-all font-mono text-xs text-muted-foreground">{selected.filePath}</p>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Bionic text={selected.summary} on={bionic} />
              </p>
              <Section title={`Dependency paths (${deps.length})`}>
                {deps.length === 0 && <p className="text-sm text-muted-foreground">No direct imports or calls.</p>}
                {deps.map((d, i) => (
                  <div key={i} className="group flex items-center gap-1 rounded hover:bg-muted">
                    <button
                      onClick={() => jump(d.node)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                    >
                      <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                        {d.dir === "out" ? "→" : "←"} {d.type}
                      </span>
                      <span className="truncate font-mono">{d.node.label}</span>
                    </button>
                    <button
                      onClick={() =>
                        addChip(
                          d.dir === "out"
                            ? `[Querying path from ${selected.label} to ${d.node.label}]`
                            : `[Querying path from ${d.node.label} to ${selected.label}]`,
                        )
                      }
                      className="mr-1 rounded px-1.5 py-0.5 text-[11px] text-primary opacity-0 group-hover:opacity-100"
                      title="Ask the tutor about this path"
                    >
                      Ask
                    </button>
                  </div>
                ))}
              </Section>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              <Bionic on={bionic} text="Click a node on the map or search for a symbol to see its details and dependency paths." />
            </p>
          )}
          </div>
          <ClientOnly fallback={null}>
            <Suspense fallback={null}>
              <TutorChat context={tutorContext} chips={chips} onRemoveChip={(c) => setChips((cs) => cs.filter((x) => x !== c))} />
            </Suspense>
          </ClientOnly>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
function Center({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}
function Btn({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
