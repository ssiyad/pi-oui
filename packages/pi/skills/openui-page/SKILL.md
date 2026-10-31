---
name: openui-page
description: Make a web page that anyone can open from a link, like a Claude artifact. The page is written in OpenUI Lang and uses the OpenUI components (cards, tables, charts, tabs, Markdown). It can show a snapshot of data from your tools. Use with the scaffold_ui, render_ui, publish_ui, unpublish_ui and list_ui tools. Triggers - "make a dashboard", "make a page I can share", "share this as a link", "chart this", "make a report page", "artifact".
---

# OpenUI pages

A page is one file, `page.oui`, in OpenUI Lang. The renderer shows it with the
OpenUI components. You write no HTML, CSS or JavaScript.

## Workflow

1. Read [reference.md](reference.md) once. It lists the syntax and every
   component with its arguments.
2. Call `scaffold_ui({ title })`. It returns the page ID and the path of
   `page.oui`.
3. Write the page into `page.oui` with your file tools. Replace the starter
   content.
4. Call `render_ui({ id })`. It checks the page and opens a local preview.
5. If `render_ui` returns errors, fix each statement that it names, and call
   `render_ui` again. Continue until it returns no errors.
6. Tell the user the preview URL. Do not publish yet.
7. Call `publish_ui({ id })` only when the user asks for a link. The user
   confirms in Pi before anything goes public. Give the user the link that it
   returns.

To change a page, edit the same `page.oui` and call `render_ui` again. Do not
make a new page. If the page has a Gist, `publish_ui` updates the Gist and the
link stays the same.

## Rules

- `page.oui` contains only OpenUI Lang statements. Do not put Markdown fences
  or prose in it.
- Every statement except `root` must be reachable from `root`. `render_ui`
  reports unused and undefined names as errors, because they do not render.
- Put data in the page as literal values, or get it from a tool with
  `Query()`. See [Live data](#live-data).
- `@OpenUrl` buttons and links in Markdown open only `https:` links, and the
  reader confirms before the link opens. `render_ui` reports other `@OpenUrl`
  links as errors. `@ToAssistant` does nothing, because the reader has no
  assistant. A `Button` without an action also does nothing. The examples
  in the reference use `@ToAssistant`. Do not copy them into a page.
- Markdown in `TextContent` shows raw HTML as text.
- Images load from their host when someone opens the page. That host sees the
  reader's IP address. Use images only from hosts that the user trusts.
- Do not put secrets, tokens, passwords or private customer data in a page.
  Anyone with the link can read it.

## Live data

A page can show the result of a tool that you can call, such as `bash` or an
MCP tool:

```text
issues = Query("bash", {command: "gh issue list --json number,title"}, [])
table = Table([Col("Number", issues.number), Col("Title", issues.title)])
```

- `render_ui` runs each query once with your tools and saves a snapshot. The
  preview shows the snapshot, and `publish_ui` shares it. A reader sees the
  data from the last `render_ui`.
- The result is the structured content of the tool. A tool without it gives
  its text, parsed as JSON when the text is JSON.
- The arguments can use literal values, `$state` and the results of other
  queries. They cannot use other statements.
- A query cannot call the pi-oui tools.
- A query must only read data. Each `render_ui` runs it again.
- A query result can be up to 512 KB as JSON. Ask the tool for only the data
  that the page shows.
- The snapshot does not refresh, and it does not change with `$state`.
- A shared page has no tools. The snapshot removes each `Mutation()` and the
  buttons and parts that use it.
- After you change `page.oui`, call `render_ui` again before `publish_ui`.
- Query results go public. Do not query secrets or private customer data.

## Publishing

`publish_ui` puts the page in a secret GitHub Gist on the user's `gh` account.
The link holds only the Gist ID, never the page. Publishing again updates the
same Gist, and the link stays the same. `unpublish_ui({ id })` deletes the
Gist. GitHub caches the page, so an update or a delete takes about 5 minutes
to show. Tell the user this.

## Commands for the user

- `/ui [id]` opens a page in the local preview.
- `/share [id]` publishes a page.
