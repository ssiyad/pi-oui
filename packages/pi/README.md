# pi-artifacts

A Pi package that makes web pages that anyone can open from a link, like
Claude artifacts. The agent writes the page in
[OpenUI Lang](https://github.com/thesysdev/openui), and the OpenUI components
render it. The reader needs no Pi, no account and no login.

## Install

lang-core sends telemetry from its `postinstall` script. npm 12 blocks this
script. With older npm, turn the telemetry off before you install:

```fish
set -x OPENUI_TELEMETRY_DISABLED 1
pi install npm:pi-artifacts
```

To publish to a Gist, install the [GitHub CLI](https://cli.github.com) and run
`gh auth login`.

## Use

Ask the agent for a page, for example "make a dashboard of these numbers that I
can share". The agent:

1. Makes a page with `scaffold_ui`.
2. Writes `page.oui`.
3. Calls `render_ui` until the page has no errors. The page opens in a local
   preview, and the preview reloads after each render.
4. Calls `publish_ui` when you ask for a link. You confirm in Pi first.

| Tool           | What it does                                                     |
| -------------- | ---------------------------------------------------------------- |
| `scaffold_ui`  | Makes a page with a starter `page.oui`.                          |
| `render_ui`    | Checks the page and shows it in the local preview.               |
| `list_ui`      | Lists the pages on this computer.                                |
| `publish_ui`   | Makes a public link. You confirm first.                          |
| `unpublish_ui` | Deletes the Gist of a page. You confirm first.                   |

| Command                         | What it does                       |
| ------------------------------- | ---------------------------------- |
| `/ui [id]`                      | Opens a page in the local preview. |
| `/share [id] [fragment\|gist]`  | Publishes a page.                  |

## Links

A link opens the viewer, a static site on GitHub Pages. The page is in one of
two places:

- **In the link.** The page is compressed into the URL fragment. Browsers do
  not send the fragment to a server. You cannot change or delete the link.
- **In a secret GitHub Gist.** You can update and delete the page, and the
  link stays the same. GitHub caches the page, so an update or a delete can
  take about 5 minutes to show. A secret Gist is not private: anyone with the
  link can read it.

`publish_ui` puts the page in the link when the link is 8 KB or less.

Before a page goes public, Pi shows:

- Possible secrets in the page, such as tokens and passwords.
- The hosts that the page links to or loads images from. When someone opens
  the page, these hosts see the reader's IP address.

## Security

- Pages contain only OpenUI components. They cannot contain HTML or scripts.
- Markdown shows raw HTML as text.
- An `@OpenUrl` button opens only `https:` links, and the reader confirms
  first. Links in Markdown open in a new tab without a confirm.
- The viewer does not open pages larger than 2 MB.
- The viewer sets a content security policy. Scripts load only from the viewer,
  and data loads only from the viewer and `gist.githubusercontent.com`.
- The local preview listens on `127.0.0.1` only and refuses other `Host`
  headers.

## Settings

| Variable           | Default                                  | Use                                       |
| ------------------ | ---------------------------------------- | ----------------------------------------- |
| `PI_UI_DIR`        | `~/.pi/ui`                               | Where pages are kept.                     |
| `PI_UI_VIEWER_URL` | `https://ssiyad.github.io/pi-artifacts/` | The viewer that links point to.           |
| `PI_UI_OPEN`       | `1`                                      | `0` stops `render_ui` opening the browser. |
| `PI_UI_PORT`       | Random                                   | Port of the local preview.                |
| `PI_UI_VIEWER_DIR` | The package's `viewer/`                  | Another viewer build for the preview.     |

## Develop

From the repository root:

```fish
npm install
npm run build   # library spec, skill reference, viewer
npm test
npm run check
```

Load the package in Pi without installing it:

```fish
pi -e packages/pi/src/index.ts --skill packages/pi/skills/openui-page
```
