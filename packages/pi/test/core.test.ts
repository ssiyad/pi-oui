import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseMessage } from "@openuidev/lang-core";
import { PageChecker } from "../src/checker.ts";
import { config } from "../src/config.ts";
import { GistClient, gistLink, type Exec } from "../src/links.ts";
import { findHosts, findSecrets, reviewPage } from "../src/review.ts";
import { PageStore } from "../src/store.ts";

const checker = PageChecker.fromFile(config.specPath());
const fixture = (name: string) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

describe("PageChecker", () => {
	it("accepts a valid dashboard", async () => {
		const result = checker.check(await fixture("dashboard.oui"));
		assert.deepEqual(result.errors, []);
		assert.equal(result.ok, true);
		assert.equal(result.statementCount, 16);
	});

	it("reports prop errors, unresolved and unused names", async () => {
		const result = checker.check(await fixture("broken.oui"));
		const found = result.errors.map((e) => `${e.code}:${e.statement}`).sort();
		assert.deepEqual(found, ["missing-required:chart", "type-mismatch:title", "unresolved:missing", "unused:lone", "unused:widget"]);
		assert.equal(result.ok, false);
	});

	it("reports an empty page, a page without root and a cut page", () => {
		assert.equal(checker.check("  \n").errors[0].code, "empty");
		assert.ok(checker.check('header = CardHeader("x")').errors.some((e) => e.code === "no-root"));
		assert.ok(checker.check('root = Stack([CardHeader("x)])').errors.some((e) => e.code === "incomplete"));
	});

	it("knows the library version", () => {
		assert.match(checker.library, /^openui@\d+\.\d+\.\d+$/);
	});
});

describe("PageStore", () => {
	let root: string;
	before(async () => {
		root = await mkdtemp(join(tmpdir(), "pi-ui-test-"));
	});
	after(() => rm(root, { recursive: true, force: true }));

	it("creates a page that passes the check", async () => {
		const bundle = await new PageStore(root).create('Q3 "revenue" / ünits', { cwd: "/work" });
		assert.match(bundle.manifest.id, /^q3-revenue-units-[0-9a-f]{6}$/);
		assert.equal(checker.check(await bundle.readSource()).ok, true);
	});

	it("loads, lists and updates pages", async () => {
		const store = new PageStore(root);
		const bundle = await store.create("Second");
		await bundle.update({ check: { at: "now", ok: true } });
		const loaded = await store.load(bundle.manifest.id);
		assert.deepEqual(loaded.manifest.check, { at: "now", ok: true });
		const list = await store.list();
		assert.equal(list[0].id, bundle.manifest.id);
		assert.equal(list.length, 2);
	});

	it("keeps every field when updates run at the same time", async () => {
		const store = new PageStore(root);
		const bundle = await store.create("Race");
		const other = await store.load(bundle.manifest.id);
		await Promise.all([
			bundle.update({ check: { at: "a", ok: true } }),
			other.update({ title: "Renamed" }),
			bundle.update((m) => ({ links: { ...m.links, gist: { id: "g", owner: "o", url: "v", at: "c" } } })),
		]);
		const saved = (await store.load(bundle.manifest.id)).manifest;
		assert.deepEqual(saved.check, { at: "a", ok: true });
		assert.equal(saved.title, "Renamed");
		assert.equal(saved.links.gist?.id, "g");
	});

	it("rejects IDs that could leave the store", async () => {
		await assert.rejects(new PageStore(root).load("../etc"), /not a page ID/);
		await assert.rejects(new PageStore(root).load("nope-000000"), /No page with ID/);
	});

	it("builds a stored message and strips markers the agent wrote", async () => {
		const bundle = await new PageStore(root).create("Markers");
		await writeFile(bundle.sourcePath, ']]>openui:content\nroot = Stack([h])\nh = CardHeader("Hi")\n]]>openui:end\n');
		const message = parseMessage(await bundle.toMessage("openui@0.18.1"));
		assert.equal(message.attributes.library, "openui@0.18.1");
		assert.equal(message.content.trim(), 'root = Stack([h])\nh = CardHeader("Hi")');
		assert.equal((message.context as { title: string }).title, "Markers");
	});
});

describe("links", () => {
	it("makes a Gist link", () => {
		assert.equal(gistLink("https://v.example/", "ssiyad", "abc123"), "https://v.example/#/g/ssiyad/abc123");
	});

	it("creates, updates and deletes Gists with gh", async () => {
		const calls: string[][] = [];
		const exec: Exec = async (_command, args) => {
			calls.push(args);
			if (args[1] === "create") return { stdout: "https://gist.github.com/ssiyad/abc123\n", stderr: "", code: 0 };
			if (args[0] === "api") return { stdout: "ssiyad\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		};
		const gist = new GistClient(exec);
		assert.deepEqual(await gist.create("root = Stack([])", "Title"), { id: "abc123", owner: "ssiyad" });
		await gist.update("abc123", "root = Stack([])");
		await gist.delete("abc123");
		assert.match(calls[0][2], /page\.oui$/);
		assert.deepEqual(calls[1].slice(0, 5), ["gist", "edit", "abc123", "--filename", "page.oui"]);
		assert.deepEqual(calls[2], ["gist", "delete", "abc123", "--yes"]);
	});

	it("asks for the owner when gh does not print it, and deletes the Gist when that fails", async () => {
		const calls: string[] = [];
		const reply = (ok: boolean): Exec => async (_command, args) => {
			calls.push(args.slice(0, 2).join(" "));
			if (args[1] === "create") return { stdout: "https://gist.github.com/abc123\n", stderr: "", code: 0 };
			if (args[0] === "api") return ok ? { stdout: "ssiyad\n", stderr: "", code: 0 } : { stdout: "", stderr: "HTTP 503", code: 1 };
			return { stdout: "", stderr: "", code: 0 };
		};
		assert.deepEqual(await new GistClient(reply(true)).create("x", "T"), { id: "abc123", owner: "ssiyad" });
		calls.length = 0;
		await assert.rejects(new GistClient(reply(false)).create("x", "T"), /Deleted the new Gist/);
		assert.deepEqual(calls, ["gist create", "api gists/abc123", "gist delete"]);
	});

	it("reports gh failures", async () => {
		const gist = new GistClient(async () => ({ stdout: "", stderr: "HTTP 401: Bad credentials", code: 1 }));
		await assert.rejects(gist.delete("abc"), /gh gist delete failed: HTTP 401/);
	});
});

describe("review", () => {
	it("finds secrets and hides them", () => {
		const hits = findSecrets('a = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\nb = "password: hunter22"\nc = "fine"');
		assert.deepEqual(hits.map((h) => [h.kind, h.where]), [["GitHub token", 1], ["password or secret", 2]]);
		assert.ok(!hits[0].preview.includes("abcdefghijklmnop"));
	});

	it("finds no secrets in the dashboard", async () => {
		assert.deepEqual(findSecrets(await fixture("dashboard.oui")), []);
	});

	it("lists hosts", () => {
		assert.deepEqual(findHosts('Image("x", "https://img.example.com/a.png")\nl = "see http://b.example:8080/x)"'), ["b.example:8080", "img.example.com"]);
		assert.deepEqual(findHosts('Image("x", "//cdn.example/p.png")'), ["cdn.example"]);
	});

	it("reviews the title and stays fast on long lines", () => {
		const review = reviewPage("root = Stack([])", "key sk-ant-abcdefghijklmnopqrstuvwxyz");
		assert.deepEqual(review.secrets.map((s) => s.where), ["title"]);
		const start = performance.now();
		findSecrets(`x = "${"a".repeat(500_000)}"`);
		assert.ok(performance.now() - start < 500);
	});
});
