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
	const tools = new Map<string, Tool>();
	const ctx = { hasUI: false, ui: { confirm: async () => false }, executeTool: async () => ({}) };
	const run = async (id: string) => {
		const result = await tools.get("render_ui")?.execute("call", { id }, undefined, undefined, ctx);
		return { text: result?.content[0].text ?? "", isError: result?.isError };
	};

	before(() => {
		registerTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never, pages, publisher, new Importer(pages));
	});

	it("publishes a page without errors and returns the link", async () => {
		const bundle = await pages.store.create("Tool");
		await writeFile(bundle.sourcePath, 'root = Stack([a])\na = Button("Docs", @OpenUrl("https://docs.example/x"))\n');
		const result = await run(bundle.manifest.id);
		assert.equal(result.isError, false);
		assert.match(result.text, /has no errors[\s\S]*Published\. Give the user this link:\nhttps:\/\/v\.example\/#\/g\/ssiyad\/abc123/);
		assert.match(result.text, /docs\.example\. These hosts see the IP address/);
	});

	it("does not publish a page with errors", async () => {
		const bundle = await pages.store.create("Tool broken");
		await writeFile(bundle.sourcePath, "root = Stack([missing])\n");
		ghCalls = [];
		const result = await run(bundle.manifest.id);
		assert.equal(result.isError, true);
		assert.doesNotMatch(result.text, /Published/);
		assert.deepEqual(ghCalls, []);
	});

	it("reports a failed publish with the check result", async () => {
		const bundle = await pages.store.create("Tool leak");
		await writeFile(bundle.sourcePath, LEAK);
		const result = await run(bundle.manifest.id);
		assert.equal(result.isError, true);
		assert.match(result.text, /has no errors[\s\S]*Not published: The page may contain secrets/);
	});
});
