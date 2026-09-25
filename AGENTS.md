<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Repository analysis runs client-side in src/lib/analyzer.ts (regex-based Python/JS/TS parsing of uploaded zip/folder) — the spec's FastAPI backend isn't supported on this stack.
- 3D graph (react-force-graph-3d) is lazy-loaded behind ClientOnly — it touches window/WebGL at import.
- Tutor chat streams from server route src/routes/api/tutor.ts (AI SDK + gateway); node context is built client-side and sent in the request body per message. No persistence — single in-memory conversation.
