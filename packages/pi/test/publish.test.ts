import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseMessage } from "@openuidev/lang-core";
import { GistClient, type Exec } from "../src/links.ts";
import { Pages } from "../src/pages.ts";
import { type ConfirmUI, Publisher } from "../src/publisher.ts";
import { PageStore } from "../src/store.ts";

const VIEWER = "https://v.example/";
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
	const viewer = join(root, "viewer");
	await mkdir(join(viewer, "assets"), { recursive: true });
	await writeFile(join(viewer, "index.html"), "<!doctype html><title>viewer</title>");
	await writeFile(join(viewer, "assets", "app.js"), "console.log(1)");
	await writeFile(join(root, "secret.txt"), "do not serve");
	process.env.PI_UI_VIEWER_DIR = viewer;
	ghCalls = [];
	pages = new Pages(exec, new PageStore(join(root, "store")));
	publisher = new Publisher(pages, new GistClient(exec), VIEWER);
});
after(async () => {
	await pages.close();
	await rm(root, { recursive: true, force: true });
});

describe("Publisher", () => {
	it("publishes nothing when the user says no", async () => {
		const { manifest } = await pages.store.create("No");
		const answer = ui(false);
		assert.deepEqual(await publisher.publish(manifest.id, answer), { status: "cancelled" });
		assert.match(answer.asked[0], /Anyone with the link can open this page/);
		assert.equal((await pages.store.load(manifest.id)).manifest.links.gist, undefined);
	});

	it("refuses without a UI to confirm", async () => {
		const { manifest } = await pages.store.create("Headless");
		await assert.rejects(publisher.publish(manifest.id, { hasUI: false, confirm: async () => true }), /must confirm/);
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
		assert.equal(outcome.status === "published" && outcome.url, `${VIEWER}#/g/ssiyad/abc123`);
		assert.ok(outcome.status === "published" && !outcome.url.includes("4711"));
	});

	it("builds the link again when the viewer URL changes", async () => {
		const { manifest } = await pages.store.create("Moved");
		const local = new Publisher(pages, new GistClient(exec), "http://127.0.0.1:4173/");
		const first = await local.publish(manifest.id, ui(true));
		assert.equal(first.status === "published" && first.url, "http://127.0.0.1:4173/#/g/ssiyad/abc123");
		const again = await publisher.publish(manifest.id, ui(true));
		assert.equal(again.status === "published" && again.url, `${VIEWER}#/g/ssiyad/abc123`);
		assert.equal((await pages.store.load(manifest.id)).manifest.links.gist?.url, `${VIEWER}#/g/ssiyad/abc123`);
	});

	it("warns about secrets in the confirm dialog", async () => {
		const bundle = await pages.store.create("Leaky");
		await writeFile(bundle.sourcePath, 'root = Stack([h])\nh = CardHeader("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")\n');
		const answer = ui(false);
		await publisher.publish(bundle.manifest.id, answer);
		assert.match(answer.asked[0], /may contain secrets[\s\S]*GitHub token/);
		assert.ok(!answer.asked[0].includes("abcdefghijklmnop"));
	});

	it("creates a Gist, updates it with the same link, and deletes it", async () => {
		const { manifest } = await pages.store.create("Gisted");
		ghCalls = [];
		const first = await publisher.publish(manifest.id, ui(true));
		assert.deepEqual(first, { status: "published", url: `${VIEWER}#/g/ssiyad/abc123`, updated: false, review: { secrets: [], hosts: [] } });

		const answer = ui(true);
		const again = await publisher.publish(manifest.id, answer);
		assert.deepEqual(again.status === "published" && [again.url, again.updated], [`${VIEWER}#/g/ssiyad/abc123`, true]);
		assert.match(answer.asked[0], /Updates secret Gist abc123/);
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

describe("PreviewServer", () => {
	it("renders, serves the viewer and the page, and opens the browser once", async () => {
		const { manifest } = await pages.store.create("Served");
		const outcome = await pages.render(manifest.id, true);
		assert.equal(outcome.result.ok, true);
		assert.match(outcome.url ?? "", new RegExp(`^http://127\\.0\\.0\\.1:\\d+/#/l/${manifest.id}$`));
		assert.equal(outcome.opened, true);

		const base = new URL(outcome.url ?? "");
		const index = await get(base, "/");
		assert.equal(index.status, 200);
		assert.match(index.headers["content-security-policy"] ?? "", /script-src 'self'/);
		assert.equal((await get(base, "/assets/app.js")).status, 200);

		const page = await get(base, `/pages/${manifest.id}/page.oui`);
		assert.equal(parseMessage(page.body).attributes.library, pages.checker.library);
	});

	it("starts one server for parallel renders", async () => {
		const fresh = new Pages(exec, pages.store);
		const [a, b] = await Promise.all([fresh.preview(), fresh.preview()]);
		assert.equal(a, b);
		await fresh.close();
	});

	it("refuses other hosts, other files and other methods", async () => {
		const base = new URL((await pages.preview())?.url ?? "");
		assert.equal((await get(base, "/", { host: "evil.example" })).status, 403);
		assert.equal((await get(base, "/../secret.txt")).status, 404);
		assert.equal((await get(base, "/%2e%2e/secret.txt")).status, 404);
		assert.equal((await get(base, "/pages/..%2f..%2fsecret/page.oui")).status, 404);
		assert.equal((await get(base, "/%E0%A4%A")).status, 400);
		assert.equal((await get(base, "/", {}, "POST")).status, 405);
		assert.equal((await get(base, "/events?page=../x")).status, 400);
	});

	it("tells open viewers about a new render", async () => {
		const { manifest } = await pages.store.create("Live");
		const server = await pages.preview();
		const base = new URL(server?.url ?? "");
		const event = new Promise<string>((done) => {
			request({ host: base.hostname, port: base.port, path: `/events?page=${manifest.id}` }, (res) => {
				res.on("data", (chunk: Buffer) => {
					if (chunk.includes("event: render")) {
						done(chunk.toString());
						res.destroy();
					}
				});
			}).end();
		});
		while (server?.viewerCount(manifest.id) === 0) await new Promise((r) => setTimeout(r, 10));
		const outcome = await pages.render(manifest.id, true);
		assert.equal(outcome.opened, false, "does not open a second tab");
		assert.match(await event, new RegExp(`data: ${manifest.id}`));
	});
});

function get(base: URL, path: string, headers: Record<string, string> = {}, method = "GET") {
	return new Promise<{ status: number; headers: Record<string, string | undefined>; body: string }>((done, reject) => {
		const req = request({ host: base.hostname, port: base.port, path, method, headers }, (res) => {
			let body = "";
			res.on("data", (chunk) => (body += chunk));
			res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string | undefined>, body }));
		});
		req.on("error", reject);
		req.end();
	});
}
