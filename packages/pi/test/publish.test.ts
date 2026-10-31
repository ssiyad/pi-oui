import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Importer } from "../src/importer.ts";
import { GistClient, type Exec } from "../src/links.ts";
import { Pages } from "../src/pages.ts";
import { type ConfirmUI, Publisher } from "../src/publisher.ts";
import { PageStore } from "../src/store.ts";
import { registerTools } from "../src/tools.ts";

const RENDERER = "https://v.example/";
const LEAK = 'root = Stack([h])\nh = CardHeader("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")\n';
let root: string;
let ghCalls: string[][];
let pages: Pages;
let publisher: Publisher;

const exec: Exec = async (command, args) => {
	if (command !== "gh") return { stdout: "", stderr: "", code: 0 };
	ghCalls.push(args);
	if (args[1] === "create") return { stdout: "https://gist.github.com/ssiyad/abc123\n", stderr: "", code: 0 };
	if (args[0] === "api") return { stdout: "ssiyad\n", stderr: "", code: 0 };
	return { stdout: "", stderr: "", code: 0 };
};

function ui(answer: boolean): ConfirmUI & { asked: string[] } {
	const asked: string[] = [];
	return { hasUI: true, asked, confirm: async (title, message) => (asked.push(`${title}\n${message}`), answer) };
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-ui-publish-"));
	ghCalls = [];
	pages = new Pages(new PageStore(join(root, "store")));
	publisher = new Publisher(pages, new GistClient(exec), RENDERER);
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Publisher", () => {
	it("publishes a page without secrets and does not ask", async () => {
		const { manifest } = await pages.store.create("Clean");
		const answer = ui(false);
		const outcome = await publisher.publish(manifest.id, answer);
		assert.equal(outcome.status, "published");
		assert.deepEqual(answer.asked, []);
	});

	it("publishes a page without secrets when there is no UI", async () => {
		const { manifest } = await pages.store.create("Headless");
		const outcome = await publisher.publish(manifest.id, { hasUI: false, confirm: async () => false });
		assert.equal(outcome.status, "published");
	});

	it("refuses a page with secrets when there is no UI", async () => {
		const bundle = await pages.store.create("Headless leak");
		await writeFile(bundle.sourcePath, LEAK);
		await assert.rejects(publisher.publish(bundle.manifest.id, { hasUI: false, confirm: async () => true }), /must confirm[\s\S]*GitHub token/);
		assert.equal((await pages.store.load(bundle.manifest.id)).manifest.links.gist, undefined);
	});

	it("refuses a page with errors", async () => {
		const bundle = await pages.store.create("Broken");
		await writeFile(bundle.sourcePath, "root = Stack([missing])\n");
		await assert.rejects(publisher.publish(bundle.manifest.id, ui(true)), /unresolved/);
	});

	it("never puts the page in the link", async () => {
		const bundle = await pages.store.create("Small");
		await writeFile(bundle.sourcePath, 'root = Stack([h])\nh = CardHeader("Unique marker 4711")\n');
		const outcome = await publisher.publish(bundle.manifest.id, ui(true));
		assert.equal(outcome.status === "published" && outcome.url, `${RENDERER}#/g/ssiyad/abc123`);
		assert.ok(outcome.status === "published" && !outcome.url.includes("4711"));
	});

	it("builds the link again when the renderer URL changes", async () => {
		const { manifest } = await pages.store.create("Moved");
		const local = new Publisher(pages, new GistClient(exec), "http://127.0.0.1:4173/");
		const first = await local.publish(manifest.id, ui(true));
		assert.equal(first.status === "published" && first.url, "http://127.0.0.1:4173/#/g/ssiyad/abc123");
		const again = await publisher.publish(manifest.id, ui(true));
		assert.equal(again.status === "published" && again.url, `${RENDERER}#/g/ssiyad/abc123`);
		assert.equal((await pages.store.load(manifest.id)).manifest.links.gist?.url, `${RENDERER}#/g/ssiyad/abc123`);
	});

	it("asks about secrets and publishes nothing when the user says no", async () => {
		const bundle = await pages.store.create("Leaky");
		await writeFile(bundle.sourcePath, LEAK);
		const answer = ui(false);
		assert.equal((await publisher.publish(bundle.manifest.id, answer)).status, "cancelled");
		assert.match(answer.asked[0], /may contain secrets[\s\S]*Anyone with the link[\s\S]*GitHub token/);
		assert.ok(!answer.asked[0].includes("abcdefghijklmnop"));
		assert.equal((await pages.store.load(bundle.manifest.id)).manifest.links.gist, undefined);
	});

	it("publishes a page with secrets when the user says yes", async () => {
		const bundle = await pages.store.create("Leaky yes");
		await writeFile(bundle.sourcePath, LEAK);
		const answer = ui(true);
		assert.equal((await publisher.publish(bundle.manifest.id, answer)).status, "published");
		assert.equal(answer.asked.length, 1);
	});

	it("creates a Gist, updates it with the same link, and deletes it", async () => {
		const { manifest } = await pages.store.create("Gisted");
		ghCalls = [];
		const first = await publisher.publish(manifest.id, ui(true));
		assert.deepEqual(first, { status: "published", url: `${RENDERER}#/g/ssiyad/abc123`, updated: false, review: { secrets: [], hosts: [] } });

		const again = await publisher.publish(manifest.id, ui(true));
		assert.deepEqual(again.status === "published" && [again.url, again.updated], [`${RENDERER}#/g/ssiyad/abc123`, true]);
		assert.deepEqual(ghCalls.map((c) => c.slice(0, 2).join(" ")), ["gist create", "gist edit"]);

		const deleted = await publisher.unpublish(manifest.id, ui(true));
		assert.equal(deleted.status, "deleted");
		assert.equal((await pages.store.load(manifest.id)).manifest.links.gist, undefined);
		await assert.rejects(publisher.unpublish(manifest.id, ui(true)), /not published/);
	});
});

describe("checker rules for shared pages", () => {
	it("rejects Query() and warns about @ToAssistant", () => {
		const query = pages.checker.check('root = Stack([t])\nt = Table([Col("A", data.rows)])\ndata = Query("get_rows", {}, {rows: []})\n');
		assert.ok(query.errors.some((e) => e.code === "needs-tools" && e.statement === "data"), JSON.stringify(query.errors));
		const ask = pages.checker.check('root = Stack([b])\nb = Button("Ask", @ToAssistant("Hi"))\n');
		assert.equal(ask.ok, true);
		assert.equal(ask.warnings[0].code, "no-assistant");
		const http = pages.checker.check('root = Stack([b])\nb = Button("Go", @OpenUrl("http://example.com"))\n');
		assert.deepEqual(http.errors.map((e) => e.code), ["not-https"]);
	});
});

describe("render_ui", () => {
	type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; isError?: boolean }> };
	type Options = { hasUI?: boolean; answer?: boolean; signal?: AbortSignal; tools?: Record<string, unknown> };
	const tools = new Map<string, Tool>();
	const run = async (id: string, { hasUI = false, answer = false, signal, tools: answers = {} }: Options = {}) => {
		const ctx = {
			hasUI,
			ui: { confirm: async () => answer },
			executeTool: async (name: string) => ({ toolCall: {}, result: { content: [], structuredContent: answers[name] }, isError: !(name in answers) }),
		};
		const result = await tools.get("render_ui")?.execute("call", { id }, signal, undefined, ctx);
		return { text: result?.content[0].text ?? "", isError: result?.isError };
	};
	const page = async (title: string, source: string) => {
		const bundle = await pages.store.create(title);
		await writeFile(bundle.sourcePath, source);
		return bundle.manifest.id;
	};

	before(() => {
		registerTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never, pages, publisher, new Importer(pages));
	});

	it("publishes a page without errors, then updates it with the same link", async () => {
		const id = await page("Tool", 'root = Stack([a])\na = Button("Docs", @OpenUrl("https://docs.example/x"))\n');
		ghCalls = [];
		const first = await run(id);
		assert.equal(first.isError, false);
		assert.match(first.text, /has no errors[\s\S]*Published\. Give the user this link:\nhttps:\/\/v\.example\/#\/g\/ssiyad\/abc123/);
		assert.match(first.text, /docs\.example\. These hosts see the IP address/);

		const again = await run(id);
		assert.match(again.text, /Updated the Gist\. The link is the same[\s\S]*/);
		assert.match(again.text, /https:\/\/v\.example\/#\/g\/ssiyad\/abc123/);
		assert.deepEqual(ghCalls.map((c) => c.slice(0, 2).join(" ")), ["gist create", "gist edit"]);
	});

	it("publishes the snapshot of a page with queries", async () => {
		const id = await page("Tool data", 'root = Stack([t])\nt = Table([Col("Name", data.rows.name)])\ndata = Query("rows", {}, {rows: []})\n');
		const result = await run(id, { tools: { rows: { rows: [{ name: "Ada" }] } } });
		assert.equal(result.isError, false, result.text);
		assert.match(result.text, /Ran 1 queries: data[\s\S]*Published/);
		const created = ghCalls.find((c) => c[1] === "create");
		assert.ok(created, "made a Gist");
	});

	it("does not publish a page with errors", async () => {
		const id = await page("Tool broken", "root = Stack([missing])\n");
		ghCalls = [];
		const result = await run(id);
		assert.equal(result.isError, true);
		assert.doesNotMatch(result.text, /Published/);
		assert.deepEqual(ghCalls, []);
	});

	it("does not publish after the call is cancelled", async () => {
		const id = await page("Tool abort", 'root = Stack([TextContent("hi")])\n');
		ghCalls = [];
		const result = await run(id, { signal: AbortSignal.abort() });
		assert.equal(result.isError, true);
		assert.match(result.text, /has no errors[\s\S]*Not published: render_ui was cancelled/);
		assert.deepEqual(ghCalls, []);
		assert.equal((await pages.store.load(id)).manifest.links.gist, undefined);
	});

	it("reports secrets without their characters when there is no UI", async () => {
		const id = await page("Tool leak", LEAK);
		const result = await run(id);
		assert.equal(result.isError, true);
		assert.match(result.text, /has no errors[\s\S]*Not published: The page may contain secrets[\s\S]*GitHub token/);
		assert.doesNotMatch(result.text, /ghp_/);
	});

	it("reports a page that the user did not confirm as not published", async () => {
		const id = await page("Tool leak no", LEAK);
		ghCalls = [];
		const result = await run(id, { hasUI: true, answer: false });
		assert.equal(result.isError, true);
		assert.match(result.text, /Not published: the page may contain secrets, and the user said no/);
		assert.deepEqual(ghCalls, []);
	});
});
