# Spike: phase 1

Date: 2026-10-31. Branch: `spike/phase-1`.

The spike answers three questions from the [design](design.md):

1. Can a Node script load `openuiLibrary`?
2. Can `lang-core` check pages in Node with the generated spec?
3. How large is the viewer?

## Setup

| Package                     | Version |
| --------------------------- | ------- |
| Node                        | 26.12.1 |
| npm                         | 12.2.1  |
| `@openuidev/react-ui`       | 0.18.1  |
| `@openuidev/react-lang`     | 1.0.2   |
| `@openuidev/react-headless` | 0.18.1  |
| `@openuidev/lang-core`      | 1.0.2   |
| `react`, `react-dom`        | 19.3.1  |
| `vite`                      | 8.3.5   |

`react-headless` needs `zustand` 4, so the viewer pins `zustand` 4.5.7.

## Result 1: the library loads in Node

`npm run library` runs `scripts/library.ts` with `tsx`. It imports
`openuiLibrary` and `openuiPromptOptions` from
`@openuidev/react-ui/genui-lib`. It needs no DOM and no browser shims.

It writes two files into `packages/pi/library/`:

| File                | Size   | Content                                         |
| ------------------- | ------ | ----------------------------------------------- |
| `library.spec.json` | 95 KB  | Root `Stack`, 83 definitions in the JSON Schema. |
| `prompt.md`         | 36 KB  | About 9,000 tokens.                             |

`react-ui` exports `"./*"`, so `@openuidev/react-ui/package.json` does not
resolve. The script reads the version from the viewer's `package.json`.

The prompt starts with a chat preamble: "Your ENTIRE response must be valid
openui-lang code — no markdown, no explanations". In Pi, the agent writes a
file and also talks to the user. The skill must say that the rules apply to
`page.oui` only. We can also pass our own `preamble` in the prompt options.

## Result 2: pages parse in Node

`npm run spike:parse -w packages/pi` parses two pages with `createParser()`
and the generated spec. `parseMessage()` reads the stored message format.

`spike/sample.oui` is a dashboard with 16 statements: KPI cards, tabs, a line
chart, a table with tags, a donut chart, Markdown and a code block. It parses
with no errors.

`spike/broken.oui` has five known faults. The parser reports two of them as
errors, with the statement ID and the component signature:

| Fault                                     | Reported as                       |
| ----------------------------------------- | --------------------------------- |
| `CardHeader(42)`                          | `type-mismatch`                   |
| `BarChart` without `series`               | `missing-required`                |
| `missing` is used but not defined         | `meta.unresolved`, not an error   |
| `widget = Sparkline(...)` is not used     | `meta.orphaned`, not an error     |
| `Sparkline` is not a component            | Not reported                      |

The parser checks only statements that `root` reaches. An unknown component in
an unused statement is not reported. `render_ui` must report the names in
`meta.unresolved` and `meta.orphaned` as errors. OpenUI drops these
statements, so the agent must know about them.

### Link length

| Page          | Text    | Fragment link |
| ------------- | ------- | ------------- |
| `sample.oui`  | 2,335 B | 1,455 B       |
| `broken.oui`  | 153 B   | 210 B         |

The link includes the domain. The dashboard fits in 1.5 KB, far below the
8 KB limit. Pages with large data sets will need the Gist adapter.

## Result 3: viewer size

`npm run build:viewer`, then `npm run size`. The first load is the entry
script and the stylesheet:

| File              | Raw      | gzip     | Brotli   |
| ----------------- | -------- | -------- | -------- |
| Entry script      | 2,415 KB | 701.5 KB | 518.7 KB |
| Stylesheet        | 348.7 KB | 36.8 KB  | 28.6 KB  |
| **First load**    | 2,764 KB | 738.3 KB | 547.3 KB |

GitHub Pages serves gzip, so a first visit downloads about 740 KB. The
prebuilt OpenUI bundle is about 900 KB gzipped.

These load only when a page needs them:

- KaTeX: 76 KB gzipped, for math in Markdown.
- Icons: 1,632 chunks of less than 1 KB each. A page loads only the icons it
  uses.

The build has 1,635 files in total.

### What is in the entry script

| Package                     | Raw    |
| --------------------------- | ------ |
| `@openuidev/react-ui`       | 732 KB |
| `refractor`                 | 577 KB |
| `react-dom`                 | 203 KB |
| `react-syntax-highlighter`  | 169 KB |
| `zod`                       | 91 KB  |
| `@openuidev/lang-core`      | 66 KB  |
| `@ag-ui/core`               | 63 KB  |
| Other                       | 514 KB |

`refractor` and `react-syntax-highlighter` are 31% of the entry script. The
`CodeBlock` component loads Prism with all its languages. This is inside the
OpenUI components, so the spike does not change it. A Vite alias to a smaller
`refractor` build could remove most of it later.

## Result 4: the viewer renders pages

Headless Firefox opened the sample page from a fragment link. The page used the
production build and `vite preview`.

- All components render. `@Count` and `@Filter` give the right KPI values.
- Tabs, the line chart, the donut chart, the table and the tags work.
- `<b>raw html</b>` in Markdown shows as text. The page has no `<b>` element.
- `[bad link](javascript:alert(1))` renders with an empty `href`.
- The console shows no errors.

The spike found two problems:

1. **Dark mode.** `ThemeProvider` sets its CSS variables on `body`, but it
   does not paint the page. In dark mode the text was light on a white page.
   `viewer.css` now sets the `body` background and text color from
   `--openui-background` and `--openui-text-neutral-primary`.
2. **Tabs.** `Tabs` opens on the last tab, not the first. This is OpenUI
   behavior. We do not change it.

## Other findings

- npm 12 blocks install scripts that are not on the allow list. The
  `postinstall` telemetry script of `lang-core` did not run. Users with
  npm 11 or earlier still run it.
- `react-lang` and `react-headless` install `@openuidev/observability`. It is
  a local event bus with no network calls.
- The spike did not test the Gist route. A test needs a real Gist, and a Gist
  is public to anyone with the link.

## Next steps

1. Report `meta.unresolved` and `meta.orphaned` as errors in `render_ui`.
2. Write the skill preamble for `prompt.md`.
3. Test the Gist route with a real secret Gist.
4. Test link length limits in Slack, WhatsApp and Raven.
