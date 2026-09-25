import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3DBase from "react-force-graph-3d";
const ForceGraph3D = ForceGraph3DBase as any;
import type { Graph, GNode } from "@/lib/analyzer";

export const NODE_COLORS: Record<string, string> = {
  folder: "#3b82f6",
  file: "#10b981",
  class: "#a855f7",
  function: "#f59e0b",
};
const LINK_COLORS: Record<string, string> = {
  contains: "#475569",
  imports: "#38bdf8",
  inherits: "#c084fc",
  calls: "#fbbf24",
};

type N = GNode & { x?: number; y?: number; z?: number };
type L = { source: string | N; target: string | N; type: string };
const idOf = (v: string | N) => (typeof v === "string" ? v : v.id);

export default function Graph3D({
  graph,
  selected,
  onSelect,
}: {
  graph: Graph;
  selected: string | null;
  onSelect: (n: GNode | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => ({ nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) }),
    [graph],
  );

  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    f.d3Force("charge")?.strength(-180);
    f.d3Force("link")?.distance((l: L) => (l.type === "contains" ? 40 : 70));
    f.d3ReheatSimulation?.();
  }, [data]);

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    s.add(selected);
    for (const l of graph.links) {
      if (l.source === selected) s.add(l.target);
      if (l.target === selected) s.add(l.source);
    }
    return s;
  }, [selected, graph]);

  useEffect(() => {
    if (!selected) return;
    const n = data.nodes.find((x) => x.id === selected) as N | undefined;
    if (!n || n.x === undefined) return;
    const r = 1 + 90 / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
    fg.current?.cameraPosition({ x: n.x * r, y: (n.y || 0) * r, z: (n.z || 0) * r }, { x: n.x, y: n.y, z: n.z }, 900);
  }, [selected, data]);

  const dim = (id: string) => selected && !neighbors.has(id);

  return (
    <div ref={wrap} className="h-full w-full">
      <ForceGraph3D
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(n: N) => `${n.label} · ${n.type} · ${n.pedagogyLevel}`}
        nodeVal={(n: N) => (n.type === "folder" ? 6 : n.type === "file" ? 4 : 1 + n.complexity / 3)}
        nodeColor={(n: N) => (dim(n.id) ? "rgba(100,116,139,0.12)" : NODE_COLORS[n.type]!)}
        nodeOpacity={0.95}
        linkColor={(l: L) =>
          selected && !(idOf(l.source) === selected || idOf(l.target) === selected)
            ? "rgba(100,116,139,0.05)"
            : LINK_COLORS[l.type]!
        }
        linkWidth={(l: L) => (selected && (idOf(l.source) === selected || idOf(l.target) === selected) ? 1.6 : 0.4)}
        linkDirectionalArrowLength={(l: L) => (l.type === "contains" ? 0 : 3)}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={(l: L) =>
          selected && (idOf(l.source) === selected || idOf(l.target) === selected) && l.type !== "contains" ? 3 : 0
        }
        onNodeClick={(n: N) => {
          onSelect(n);
        }}
        onBackgroundClick={() => onSelect(null)}
      />
    </div>
  );
}
