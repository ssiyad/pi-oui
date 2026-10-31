import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildMessage } from "@openuidev/lang-core";
import { type Fetch, Importer } from "../src/importer.ts";
import { parseGistLink } from "../src/links.ts";
import { Pages } from "../src/pages.ts";
import { PageStore } from "../src/store.ts";

const RENDERER = "https://v.example/";
const LINK = "https://ssiyad.github.io/pi-oui/#/g/someone/abc123";
const PAGE = 'root = Stack([h])\nh = CardHeader("Hi")\n';

let root: string;
let pages: Pages;
let requested: string[];

/** A fetch that answers every URL with one response. */
function fakeFetch(body: string, status = 200): Fetch {
	return async (url) => {
		requested.push(url);
		return new Response(status === 404 ? "Not Found" : body, { status });
	};
}

const message = (content: string, context: object = { title: "Q3 revenue" }) => buildMessage({ content, context, attributes: { library: "openui@0.18.1" }, end: true });

before(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-ui-import-"));
	pages = new Pages(async () => ({ stdout: "", stderr: "", code: 0 }), new PageStore(join(root, "store")));
	requested = [];
});
after(async () => {
	await pages.close();
	await rm(root, { recursive: true, force: true });
});

describe("parseGistLink", () => {
	it("reads the owner and the Gist ID of any renderer", () => {
		assert.deepEqual(parseGistLink(LINK), { owner: "someone", id: "abc123" });
		assert.deepEqual(parseGistLink(" http://localhost:5173/#/g/a_corp/ABC "), { owner: "a_corp", id: "ABC" });
		assert.deepEqual(parseGistLink("#/g/someone/abc123"), { owner: "someone", id: "abc123" });
	});

	it("rejects other links", () => {
		for (const link of ["https://gist.github.com/someone/abc123", "#/l/page-abc123", "#/g/someone/xyz", "#/g/-bad/abc", "#/g/someone/abc/extra", "#/g/some one/abc", "#/g/someone/abc123?x=1"]) {
			assert.equal(parseGistLink(link), undefined, link);
		}
	});
});

describe("Importer", () => {
	it("copies the page into a new bundle without a Gist", async () => {
		requested = [];
		const { bundle, from, own } = await new Importer(pages, fakeFetch(message(PAGE)), RENDERER).import(LINK, { cwd: "/work" });
		assert.deepEqual(requested, ["https://gist.githubusercontent.com/someone/abc123/raw/page.oui"]);
		assert.equal(await readFile(bundle.sourcePath, "utf8"), PAGE);
		assert.equal(bundle.manifest.title, "Q3 revenue");
		assert.equal(bundle.manifest.cwd, "/work");
		assert.deepEqual(bundle.manifest.links, {});
		assert.equal(from.url, `${RENDERER}#/g/someone/abc123`);
		assert.deepEqual(bundle.manifest.remixOf, from);
		assert.equal(own, undefined);
		assert.equal(pages.checker.check(await bundle.readSource()).ok, true);
	});

	it("accepts a page made without Pi, with no markers and no title", async () => {
		const { bundle } = await new Importer(pages, fakeFetch(PAGE), RENDERER).import(LINK);
		assert.equal(bundle.manifest.title, "Remix of a page by @someone");
		assert.equal(await bundle.readSource(), PAGE);
	});

	it("cleans the title", async () => {
		const { bundle } = await new Importer(pages, fakeFetch(message(PAGE, { title: `a\n\u0007b\u202Ec\u200B${"x".repeat(300)}` })), RENDERER).import(LINK);
		assert.equal(bundle.manifest.title.length, 120);
		assert.match(bundle.manifest.title, /^a b c x/);
	});

	it("names the local page that published the Gist", async () => {
		const mine = await pages.store.create("Mine");
		await mine.update({ links: { gist: { id: "abc123", owner: "someone", url: LINK, at: "now" } } });
		const { bundle, own } = await new Importer(pages, fakeFetch(message(PAGE)), RENDERER).import(LINK);
		assert.equal(own, mine.manifest.id);
		assert.notEqual(bundle.manifest.id, mine.manifest.id);
	});

	it("refuses pages that call tools, wherever the call is", async () => {
		const before = (await pages.store.list()).length;
		const bash = 'Query("bash", {command: "rm -rf ~"}, [])';
		const cases = {
			statement: `root = Stack([t])\nissues = ${bash}\nt = Table([Col("N", issues.n)])\n`,
			orphan: `root = Stack([h])\nh = CardHeader("Hi")\nissues = ${bash}\n`,
			state: `root = Stack([h])\nh = CardHeader("Hi")\n$issues = ${bash}\n`,
			mutation: 'root = Stack([b])\nrm = Mutation("bash", {command: "rm -rf ~"})\nb = Button("Go", Action([@Run(rm)]))\n',
			"inline mutation": 'root = Stack([b])\nb = Button("Go", Action([@Run(Mutation("bash", {command: "rm -rf ~"}))]))\n',
			"query in an array": `root = Stack([h, ${bash}])\nh = CardHeader("Hi")\n`,
			"query in a column": `root = Stack([t])\nt = Table([Col("N", ${bash}.n)])\n`,
		};
		for (const [name, page] of Object.entries(cases)) {
			await assert.rejects(new Importer(pages, fakeFetch(message(page)), RENDERER).import(LINK), /Query\(\) or Mutation\(\)/, name);
		}
		assert.equal((await pages.store.list()).length, before);
	});

	it("copies a page that only mentions Query in its text", async () => {
		const page = 'root = Stack([t])\nt = TextContent("Use Query(tool, args) to read data.")\n';
		const { bundle } = await new Importer(pages, fakeFetch(message(page)), RENDERER).import(LINK);
		assert.equal(await bundle.readSource(), page);
	});

	it("rejects bad links, missing pages, empty pages and large pages", async () => {
		await assert.rejects(new Importer(pages, fakeFetch(PAGE), RENDERER).import("https://example.com/"), /not a pi-oui link/);
		await assert.rejects(new Importer(pages, fakeFetch("", 404), RENDERER).import(LINK), /No page at this link/);
		await assert.rejects(new Importer(pages, fakeFetch("", 500), RENDERER).import(LINK), /HTTP 500/);
		await assert.rejects(new Importer(pages, fakeFetch(message("  \n")), RENDERER).import(LINK), /empty/);
		await assert.rejects(new Importer(pages, fakeFetch("x".repeat(2 * 1024 * 1024 + 1)), RENDERER).import(LINK), /larger than 2 MB/);
	});
});
