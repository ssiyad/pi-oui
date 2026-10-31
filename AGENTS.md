# AGENTS.md

pi-oui is a Pi extension. The agent writes a web page in OpenUI Lang, and the
extension checks it and publishes it to a secret GitHub Gist. A static React
renderer on GitHub Pages shows the page from a link `<renderer>#/g/<owner>/<gist-id>`.
There is no backend. The design is in `docs/design.md`.

## Commands

Use Node 24 and npm. Run these from the repository root:

```sh
npm install
npm test                 # node:test through tsx, packages/pi only
npm run check            # tsc --noEmit in packages/pi and packages/renderer
npm run library          # writes packages/pi/library/library.spec.json and skills/openui-page/reference.md
npm run build            # library, then the renderer (vite build -> packages/renderer/dist)
npm run size             # sizes of the files in the renderer build (build first)
npm run dev -w packages/renderer   # renderer dev server
```

Run one test file or one test (from `packages/pi`):

```sh
npx tsx --test test/core.test.ts
npx tsx --test --test-name-pattern="PageStore" test/core.test.ts
```

Load the extension in Pi without installing it:

```sh
pi -e packages/pi/src/index.ts --skill packages/pi/skills/openui-page
```

There is no linter and no formatter. `npm run check` and `npm test` are the
gates. CI (`.github/workflows/pages.yml`) only builds and deploys the renderer
on a push to `main`. It runs no tests.

## Layout

```text
packages/pi/            the published npm package "pi-oui" (ships TypeScript source, no build)
  src/index.ts          extension entry: wires Pages, Publisher, GistClient, Importer, tools
  src/tools.ts          the 5 tools: scaffold_ui, import_ui, render_ui, list_ui, unpublish_ui
  src/pages.ts          render workflow: load bundle, check, take snapshot
  src/checker.ts        PageChecker on the lang-core parser (shared with the renderer)
  src/snapshot.ts       runs queries, then rewrites the page with the results (SnapshotBuilder)
  src/queries.ts        QueryRunner (dependency order, size limits), PiTools (calls Pi tools)
  src/ast.ts            AstPrinter: lang-core AST back to OpenUI Lang source
  src/publisher.ts      publish / unpublish, secret confirm, size limit
  src/review.ts         secret and host detection for the confirm dialog
  src/links.ts          GistClient over the `gh` CLI, link parsing and building
  src/importer.ts       import_ui: fetch a published page into a new local bundle
  src/store.ts          PageStore / PageBundle on disk
  src/config.ts         PI_UI_DIR, PI_UI_RENDERER_URL, spec path
  library/library.spec.json    GENERATED, committed
  skills/openui-page/SKILL.md  the agent workflow (hand-written)
  skills/openui-page/reference.md  GENERATED, committed
  test/                 *.test.ts, fixtures/*.oui
packages/renderer/      private Vite + React 19 app, deployed to GitHub Pages
  src/main.tsx          App: hash route -> load page -> OpenUI <Renderer>
  src/source.ts         routes and Gist fetch (2 MB cap); landing.oui is the home page
  src/check.ts          imports ../../pi/src/checker to show problems in the page
  src/actions.ts        link guard: only https, reader confirms each link
  vite.config.ts        CSP meta tag, syntax-highlighter aliases (src/refractor.ts)
scripts/library.ts      generates the two library files from @openuidev/react-ui
docs/                   design.md (the design), spike-phase-1.md
```

## Architecture

- **Two packages, one parser.** Pi never imports React. `scripts/library.ts`
  reads `openuiLibrary` from `@openuidev/react-ui` and writes the JSON schema
  into `library.spec.json`. The Pi package reads it lazily (`Pages.checker`).
  The renderer builds the same `PageChecker` from the live library. So
  `src/checker.ts` must stay free of Node imports.
- **Library version.** The version in the spec comes from the exact
  `@openuidev/react-ui` version in `packages/renderer/package.json`. After a
  change to an `@openuidev/*` version, run `npm run library` and commit both
  generated files. Do not edit them by hand.
- **Page bundle** on disk: `<PI_UI_DIR or ~/.pi/ui>/<id>/` with
  `manifest.json`, `page.oui` and `snapshot.json`. IDs match
  `/^[a-z0-9][a-z0-9-]{0,79}$/` (path-traversal guard). Use
  `PageBundle.update()` to change the manifest: it serializes writes for each
  path and starts from the file on disk. Files are written atomically (tmp +
  rename).
- **render_ui flow** (`tools.ts` -> `pages.ts` -> `publisher.ts`):
  1. Check `page.oui` with `allowData: true`.
  2. If the page has `Query()`/`Mutation()`, `QueryRunner` calls Pi tools
     through `ctx.executeTool` (never the `OWN_TOOLS`), and `SnapshotBuilder`
     replaces each Query with its result and prunes mutations.
  3. The snapshot is checked again without `allowData`.
  4. `Publisher` checks again, builds an OpenUI stored message
     (`buildMessage`), runs `reviewPage` for secrets and hosts, and creates or
     updates the Gist. The user confirms only when secrets are found.
- **Snapshot validity** is a SHA-256 of the `page.oui` source. Any failed or
  data-less render deletes `snapshot.json`, so old query results can never be
  published for changed or reverted source. Keep this invariant.
- **Published bytes = checked bytes.** The publisher passes one `SharedSource`
  through the check, the review and the message. Do not read the page again
  between these steps.
- **Limits** are duplicated on purpose: `MAX_PAGE_BYTES` (store.ts) and
  `MAX_PAGE` (renderer source.ts) are both 2 MB. `MAX_RESULT` is 512 KB for
  each query. The owner and Gist ID regexes in `links.ts` and the renderer's
  `source.ts` must stay the same.
- **gh, not tokens.** `GistClient` runs `gh` through an injected `Exec`
  (`pi.exec`). Tests pass a fake `Exec`. `Importer` takes an injected `Fetch`.
- **Renderer security.** The page cannot contain HTML or scripts. The CSP
  allows `connect-src` only to `gist.githubusercontent.com`. `guardLinks`
  intercepts every `<a>` outside `[data-trusted]` (only the built-in landing
  page is trusted). Zod runs `jitless` because the CSP blocks eval.
- **Abort semantics.** `publish()` checks the signal before it starts and
  before it calls gh. It never kills a running gh call, because a stopped
  create can leave an orphan Gist.

## Conventions

- ESM everywhere. In `packages/pi`, imports use the `.ts` extension
  (`nodenext` + `allowImportingTsExtensions`). In `packages/renderer`, imports
  have no extension (bundler resolution).
- `erasableSyntaxOnly` is on in `packages/pi`: no enums, no namespaces, no
  constructor parameter properties. Assign fields in the constructor body.
- Tabs for indentation, double quotes, semicolons, long lines (about 150-200
  characters) are normal. Match the file you edit.
- Use classes with `#private` fields and constructor injection for
  dependencies (store, gh exec, fetch, renderer URL). Use plain functions for
  helpers, below the class that uses them.
- Each file starts with a short `//` comment that says why the file exists.
  Comments explain why, not what. `/** */` on exported members.
- Pin dependency versions exactly (`.npmrc` sets `save-exact=true`).
- **Error handling:** throw `Error` with a message that tells the agent what to
  do next ("Fix these errors first, then call render_ui"). Check findings are
  `Problem { code, statement?, message }` with a kebab-case `code`. Tools
  return `{ content: [text], details }` and set `isError` when the page is not
  published. A publish failure must not hide the check result (see `share()` in
  tools.ts).
- **Text style:** messages, comments and docs are in Simplified Technical
  English: short sentences, active voice, "do not" instead of "don't". Strings
  that the model reads are prompt text. Change them with care, and keep the
  tool descriptions, `SKILL.md` and `packages/pi/README.md` consistent.
- **Adding a tool:** register it in `tools.ts` and add its name to `OWN_TOOLS`.
  A test checks that the list has every registered tool. Also document it in
  `SKILL.md` and the package README.
- **Tests:** use `node:test` (`describe`/`it`) and `node:assert/strict`. Use a
  `mkdtemp` store directory for each suite, `fixtures/*.oui` for pages, and
  fakes for `Exec`, `ToolProvider` and `ConfirmUI`. Tests never call the real
  `gh` or the network. A test checks that the renderer's `landing.oui` passes
  the checker, so run the tests after you edit it.
- Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  `perf:`, `feat!:` for breaking changes), with a lowercase imperative subject.
