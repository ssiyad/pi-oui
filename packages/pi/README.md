# pi-oui

A Pi package that makes web pages that anyone can open from a link, like
Claude artifacts. The agent writes the page in
[OpenUI Lang](https://github.com/thesysdev/openui), and the OpenUI components
render it. The reader needs no Pi, no account and no login.

## Install

```fish
pi install npm:pi-oui
```

Add `-l` to install it only for the current project.

To publish to a Gist, install the [GitHub CLI](https://cli.github.com) and run
`gh auth login`.

`@openuidev/lang-core` sends telemetry from its `postinstall` script. npm 12
blocks this script. With older npm, turn the telemetry off before you install:

```fish
set -x OPENUI_TELEMETRY_DISABLED 1
pi install npm:pi-oui
```

To update or remove the package:

```fish
pi update --extension npm:pi-oui
pi remove npm:pi-oui
```

## Use

Ask the agent for a page, for example "make a dashboard of these numbers". The
agent:

1. Makes a page with `scaffold_ui`.
2. Writes `page.oui`.
3. Calls `render_ui` until the page has no errors. If the page has `Query()`
   statements, `render_ui` runs them with the agent's tools.
4. When the page has no errors, `render_ui` publishes it and the agent gives
   you the link. You confirm first only when the page may contain secrets.

To change the page, ask the agent. It edits the same page and calls
`render_ui` again. The link stays the same.

Other requests that work:

- "Show my open GitHub issues as a table." The page gets the issues with
  `Query()`. See [Live data](#live-data).
- "Turn this CSV into a chart."
- "Change the title of my last page."

| Tool           | What it does                                                   |
| -------------- | -------------------------------------------------------------- |
| `scaffold_ui`  | Makes a page with a starter `page.oui`.                        |
| `import_ui`    | Copies a published page from its link into a new page.         |
| `render_ui`    | Checks the page, runs its queries and publishes it as a link.  |
| `list_ui`      | Lists the pages on this computer, with their links.            |
| `unpublish_ui` | Deletes the Gist of a page. You confirm first.                 |

## Remix a page

The banner of a shared page has a "Copy remix command" button. It copies a
command such as:

```fish
pi "remix https://ssiyad.github.io/pi-oui/#/g/<username>/<gist-id>"
```

The agent calls `import_ui` with the link. It copies the page into a new local
page, which you can change. `render_ui` publishes the copy with a new link. The
original page does not change.

`import_ui` does not copy a page that has `Query()` or `Mutation()`
statements, because `render_ui` runs them with your tools. A page from Pi has
no such statements, because its snapshot replaces them.

## Live data

A page can get data from a tool with `Query()`, for example
`Query("bash", {command: "gh issue list --json title"}, [])`. A shared page has
no tools, so `render_ui` takes a snapshot:

1. It runs each query once with the agent's tools. The calls go through the
   same permission checks as calls from the agent.
2. It replaces each `Query()` with its result as a literal value.
3. It removes each `Mutation()` and the buttons and parts that use it.

`render_ui` publishes the snapshot. The link shows the data from the last
`render_ui`, and the data does not refresh.

A query must only read data, because each `render_ui` runs it again. A query
cannot call the pi-oui tools. A query result can be up to 512 KB as JSON.

## Links

A link opens the renderer, a static site on GitHub Pages. The page is in a
secret GitHub Gist on your `gh` account. The link holds only your GitHub
username and the Gist ID, which GitHub makes from 128 random bits. The link
never holds the page.

- You can update the page. The link stays the same.
- You can delete the page. The link then stops working.
- GitHub caches the page, so an update or a delete can take about 5 minutes
  to show.
- A secret Gist is not private: anyone with the link can read it.
- GitHub keeps each earlier version of a Gist, and anyone with the link can
  read them. A change to the page does not remove data from an earlier
  version. To remove all versions, ask the agent to unpublish the page.

Before a page goes public, Pi looks for possible secrets in the page and in the
query results, such as tokens and passwords. If it finds any, Pi shows them and
you confirm. If you say no, nothing goes public. Without the Pi interface, for
example in print mode, Pi does not publish a page with possible secrets.

`render_ui` also lists the hosts that the page links to or loads images from.
When someone opens the page, these hosts see the reader's IP address.

## Pages made without Pi

The renderer can open any Gist that has a `page.oui` file in OpenUI Lang, also
when Pi did not make it:

```text
https://ssiyad.github.io/pi-oui/#/g/<username>/<gist-id>
```

The renderer runs the same checks as `render_ui`. If the page has problems, the
renderer lists them above the page.

## Security

- Pages contain only OpenUI components. They cannot contain HTML or scripts.
- Markdown shows raw HTML as text.
- `@OpenUrl` buttons and links in Markdown open only `https:` links, and the
  reader confirms first.
- A banner above each shared page shows the GitHub user who made it and says
  that the content is user-generated.
- The renderer does not open pages larger than 2 MB.
- The renderer sets a content security policy. Scripts load only from the
  renderer, and data loads only from `gist.githubusercontent.com`.

## Settings

| Variable             | Default                            | Use                               |
| -------------------- | ---------------------------------- | --------------------------------- |
| `PI_UI_DIR`          | `~/.pi/ui`                         | Where pages are kept.             |
| `PI_UI_RENDERER_URL` | `https://ssiyad.github.io/pi-oui/` | The renderer that links point to. |

## Develop

From the repository root:

```fish
npm install
npm run build   # library spec, skill reference, renderer
npm test
npm run check
```

Load the package in Pi without installing it:

```fish
pi -e packages/pi/src/index.ts --skill packages/pi/skills/openui-page
```
