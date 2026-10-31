import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseExpression, parseMessage, type ToolProvider, tokenize } from "@openuidev/lang-core";
import { AstPrinter, parseStatements } from "../src/ast.ts";
import { config } from "../src/config.ts";
import { GistClient, type Exec } from "../src/links.ts";
import { Pages } from "../src/pages.ts";
import { type ConfirmUI, Publisher } from "../src/publisher.ts";
import { MAX_RESULT, PiTools, QueryRunner } from "../src/queries.ts";
import { findSecrets, reviewPage } from "../src/review.ts";
import { SnapshotBuilder } from "../src/snapshot.ts";
import { readChecker } from "../src/spec.ts";
import { PageStore } from "../src/store.ts";
import { OWN_TOOLS, registerTools } from "../src/tools.ts";

const checker = readChecker(config.specPath());
const fixture = (name: string) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** A tool provider that answers from a map and records each call. */
function fakeTools(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
	const calls: [string, Record<string, unknown>][] = [];
	const tools: ToolProvider = {
		async callTool(name, args) {
			calls.push([name, args]);
			const answer = answers[name];
			if (!answer) throw new Error(`no tool ${name}`);
			return answer(args);
		},
	};
	return { tools, calls };
}

describe("AstPrinter", () => {
	const printer = new AstPrinter(checker.components);
	const roundTrip = (source: string) => {
		for (const [id, ast] of parseStatements(source)) {
			const printed = printer.print(ast);
			assert.deepEqual(parseExpression(tokenize(printed)), ast, `${id} = ${printed}`);
		}
	};

	it("prints the dashboard back to the same ASTs", async () => {
		roundTrip(await fixture("dashboard.oui"));
	});

	it("prints actions, operators, state and quoted keys", () => {
		roundTrip(
			[
				'b = Button("Go", Action([@Run(q), @Set($n, $n + 1), @Reset($n), @OpenUrl("https://a.example")]))',
				'f = TextContent(-(1 + 2) * 3 + "" + [1, 2][0] + {a: 1, "k-ey": "x\\n\\"y\\""}.a)',
				"t = !x.y ? (a ?? b) : null",
				'e = @Each(rows, "r", Tag(r.name))',
			].join("\n"),
		);
	});
});

describe("QueryRunner", () => {
	const parse = (source: string) => checker.parse(`root = Stack([TextContent("" + a)])\n${source}`);

	it("runs each query once, after the queries that it uses", async () => {
		const { tools, calls } = fakeTools({ first: () => ({ id: 7 }), second: (args) => ({ got: args.id }) });
		const run = await new QueryRunner(tools).run(parse('$region = "eu"\nb = Query("second", {id: a.id})\na = Query("first", {region: $region})'));
		assert.deepEqual(run.errors, []);
		assert.deepEqual(calls, [["first", { region: "eu" }], ["second", { id: 7 }]]);
		assert.deepEqual(run.values.get("b"), { got: 7 });
	});

	it("reports failed, empty, large, cyclic and skipped queries", async () => {
		const { tools, calls } = fakeTools({ boom: () => Promise.reject(new Error("no access")), none: () => null, big: () => "x".repeat(MAX_RESULT + 1), ok: () => 1 });
		const source = ['a = Query("boom", {})', 'b = Query("ok", {x: a.y})', 'c = Query("none", {})', 'd = Query("big", {})', 'e = Query("ok", {x: f})', 'f = Query("ok", {x: e})', "g = Query(42, {})"].join("\n");
		const run = await new QueryRunner(tools).run(parse(source));
		const found = run.errors.map((e) => `${e.code}:${e.statement}`).sort();
		assert.deepEqual(found, ["query-cycle:e", "query-cycle:f", "query-empty:c", "query-failed:a", "query-skipped:b", "query-too-large:d", "query-tool:g"]);
		assert.match(run.errors.find((e) => e.statement === "a")?.message ?? "", /no access/);
		assert.deepEqual(calls.map(([name]) => name).sort(), ["big", "boom", "none"]);
	});
});

describe("QueryRunner arguments", () => {
	const parse = (source: string) => checker.parse(`root = Stack([TextContent("" + a)])\n${source}`);

	it("skips the queries that use a cycle, and refuses arguments that use a mutation", async () => {
		const { tools, calls } = fakeTools({ ok: () => 1 });
		const run = await new QueryRunner(tools).run(parse('a = Query("ok", {x: b})\nb = Query("ok", {x: a})\nc = Query("ok", {x: a})\nd = Query("ok", {x: m.status})\nm = Mutation("w", {})'));
		assert.deepEqual(run.errors.map((e) => `${e.code}:${e.statement}`).sort(), ["query-args:d", "query-cycle:a", "query-cycle:b", "query-skipped:c"]);
		assert.deepEqual(calls, []);
	});

	it("counts the size in bytes", async () => {
		const { tools } = fakeTools({ wide: () => "é".repeat(MAX_RESULT / 2 + 1) });
		const run = await new QueryRunner(tools).run(parse('a = Query("wide", {})'));
		assert.deepEqual(run.errors.map((e) => e.code), ["query-too-large"]);
	});
});

describe("PiTools", () => {
	it("blocks every pi-oui tool", () => {
		const names: string[] = [];
		registerTools({ registerTool: (tool: { name: string }) => names.push(tool.name) } as never, {} as never, {} as never, {} as never);
		assert.deepEqual([...OWN_TOOLS].sort(), names.sort());
	});

	const outcome = (result: object, isError = false) => ({ toolCall: {}, result: { details: undefined, ...result }, isError }) as never;

	it("reads structured content, then JSON text, then text", async () => {
		const answers = [outcome({ content: [], structuredContent: { a: 1 } }), outcome({ content: [{ type: "text", text: '{"b":2}' }] }), outcome({ content: [{ type: "text", text: "plain" }] })];
		const tools = new PiTools({ executeTool: async () => answers.shift() as never }, []);
		assert.deepEqual(await tools.callTool("x", {}), { a: 1 });
		assert.deepEqual(await tools.callTool("x", {}), { b: 2 });
		assert.equal(await tools.callTool("x", {}), "plain");
	});

	it("throws on a tool error and on a blocked tool", async () => {
		const names: string[] = [];
		const tools = new PiTools({ executeTool: async (name) => (names.push(name), outcome({ content: [{ type: "text", text: "denied" }] }, true)) }, ["render_ui"]);
		await assert.rejects(tools.callTool("bash", {}), /denied/);
		await assert.rejects(tools.callTool("render_ui", {}), /pi-oui tool/);
		assert.deepEqual(names, ["bash"]);
	});
});

describe("SnapshotBuilder", () => {
	const builder = new SnapshotBuilder(checker.components);
	const page = [
		"root = Stack([t, save, refresh, Button(\"Inline\", Action([@Run(m), @Set($x, 1)])), status, reset])",
		"$x = 0",
		't = Table([Col("Name", data.rows.name)])',
		'save = Button("Save", Action([@Run(m), @Run(data)]))',
		'refresh = Button("Refresh", Action([@Run(data)]))',
		'reset = Button("Reset", Action([@Run(data), @Set($x, 0)]))',
		'status = TextContent(m.status == "success" ? "Saved" : "")',
		'data = Query("rows", {x: $x}, {rows: []})',
		'only = Query("other", {})',
		'm = Mutation("write", {x: $x})',
		'hidden = Button("Go", Action([@Run(only)]))',
	].join("\n");

	it("replaces queries with their results and removes what uses a mutation", () => {
		const snapshot = builder.build(page, new Map<string, unknown>([["data", { rows: [{ name: "Ada" }] }], ["only", 1]]), ["m"]);
		assert.equal(checker.check(snapshot).ok, true, JSON.stringify(checker.check(snapshot).errors));
		assert.doesNotMatch(snapshot, /Query\(|Mutation\(|@Run|Save|Inline|Refresh|status|only/);
		assert.match(snapshot, /^root = Stack\(\[t, reset\]\)$/m);
		assert.match(snapshot, /^data = \{"rows":\[\{"name":"Ada"\}\]\}$/m);
		assert.match(snapshot, /^reset = Button\("Reset", Action\(\[@Set\(\$x, 0\)\]\)\)$/m);
	});

	it("removes a whole data array, so no value moves", () => {
		const snapshot = builder.build('root = Stack([t, other])\nt = TextContent("" + [1, m.count, 3])\nother = TextContent("kept")\nm = Mutation("w", {})', new Map(), ["m"]);
		assert.match(snapshot, /^root = Stack\(\[other\]\)$/m);
		assert.doesNotMatch(snapshot, /m\.count|\[1, 3\]/);
	});

	it("removes @Each and choices of components from an array of parts", () => {
		const page = 'root = Stack([TextContent("hi"), @Each(q, "r", Button("x", Action([@Run(m)]))), $s ? b : TextContent("n")])\n$s = true\nb = Button("y", Action([@Run(m)]))\nq = Query("rows", {}, [])\nm = Mutation("w", {})';
		const snapshot = builder.build(page, new Map([["q", [1]]]), ["m"]);
		assert.match(snapshot, /^root = Stack\(\[TextContent\("hi"\)\]\)$/m);
	});

	it("keeps @Each when its item has the name of a mutation", () => {
		const page = 'root = Stack([@Each(q, "r", TextContent(r.a))])\nq = Query("rows", {}, [])\nr = Mutation("w", {})';
		const snapshot = builder.build(page, new Map([["q", [{ a: "x" }]]]), ["r"]);
		assert.match(snapshot, /@Each\(q, "r", TextContent\(r\.a\)\)/);
		assert.equal(checker.check(snapshot).ok, true);
	});

	it("refuses a page whose root uses a mutation", () => {
		assert.throws(() => builder.build('root = TextContent(m.status)\nm = Mutation("w", {})', new Map(), ["m"]), /whole page/);
	});
});

describe("snapshots in render_ui and publish_ui", () => {
	let root: string;
	let pages: Pages;
	let publisher: Publisher;
	const exec: Exec = async (command, args) => {
		if (command === "gh" && args[1] === "create") return { stdout: "https://gist.github.com/ssiyad/abc123\n", stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 0 };
	};
	const ui = (): ConfirmUI & { asked: string[] } => {
		const asked: string[] = [];
		return { hasUI: true, asked, confirm: async (title, message) => (asked.push(`${title}\n${message}`), true) };
	};
	const dataPage = 'root = Stack([t])\nt = Table([Col("Name", data.rows.name)])\ndata = Query("rows", {}, {rows: []})\n';

	before(async () => {
		root = await mkdtemp(join(tmpdir(), "pi-ui-data-"));
		process.env.PI_UI_OPEN = "0";
		pages = new Pages(exec, new PageStore(join(root, "store")));
		publisher = new Publisher(pages, new GistClient(exec), "https://v.example/");
	});
	after(async () => {
		await pages.close();
		await rm(root, { recursive: true, force: true });
	});

	it("saves a snapshot that the preview shows and publish_ui shares", async () => {
		const bundle = await pages.store.create("Data");
		await writeFile(bundle.sourcePath, dataPage);
		await assert.rejects(publisher.publish(bundle.manifest.id, ui()), /Call render_ui/);

		const { tools, calls } = fakeTools({ rows: () => ({ rows: [{ name: "Ada" }] }) });
		const outcome = await pages.render(bundle.manifest.id, false, tools);
		assert.deepEqual(outcome.result.errors, []);
		assert.deepEqual(outcome.snapshot?.queries, ["data"]);
		assert.equal(calls.length, 1);

		const preview = parseMessage(await bundle.toMessage(checker.library));
		assert.match(preview.content, /data = \{"rows"/);
		assert.equal((preview.context as { snapshot?: string }).snapshot, outcome.snapshot?.at);

		const answer = ui();
		const published = await publisher.publish(bundle.manifest.id, answer);
		assert.equal(published.status, "published");
		assert.match(answer.asked[0], /Data: the query results from/);
	});

	it("shows no stale results after page.oui changes", async () => {
		const bundle = await pages.store.create("Stale");
		await writeFile(bundle.sourcePath, dataPage);
		await pages.render(bundle.manifest.id, false, fakeTools({ rows: () => ({ rows: [] }) }).tools);
		await writeFile(bundle.sourcePath, dataPage.replace("Name", "Who"));

		const outcome = await pages.render(bundle.manifest.id, false);
		assert.equal(outcome.snapshot, undefined);
		assert.ok(outcome.result.warnings.some((w) => w.code === "no-snapshot"));
		assert.match((await bundle.toMessage(checker.library)), /Query\(/);
		await assert.rejects(publisher.publish(bundle.manifest.id, ui()), /changed after the last snapshot/);
	});

	it("does not bring back an old snapshot when the page goes back to the old source", async () => {
		const bundle = await pages.store.create("Revert");
		await writeFile(bundle.sourcePath, dataPage);
		await pages.render(bundle.manifest.id, false, fakeTools({ rows: () => ({ rows: [] }) }).tools);
		await writeFile(bundle.sourcePath, "root = Stack([TextContent(\"no data\")])\n");
		await pages.render(bundle.manifest.id, false, fakeTools({}).tools);
		await writeFile(bundle.sourcePath, dataPage);
		assert.equal(await bundle.readSnapshot(dataPage), undefined);
		await assert.rejects(publisher.publish(bundle.manifest.id, ui()), /changed after the last snapshot/);
	});

	it("deletes the snapshot when a query fails", async () => {
		const bundle = await pages.store.create("Fails");
		await writeFile(bundle.sourcePath, dataPage);
		await pages.render(bundle.manifest.id, false, fakeTools({ rows: () => ({ rows: [] }) }).tools);
		const outcome = await pages.render(bundle.manifest.id, false, fakeTools({}).tools);
		assert.deepEqual(outcome.result.errors.map((e) => e.code), ["query-failed"]);
		assert.equal(await bundle.readSnapshot(await bundle.readSource()), undefined);
	});

	it("warns about secrets in query results", async () => {
		const bundle = await pages.store.create("Leak");
		await writeFile(bundle.sourcePath, dataPage);
		const rows = [...Array.from({ length: 300 }, (_, i) => ({ name: `user ${i}` })), { name: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }];
		await pages.render(bundle.manifest.id, false, fakeTools({ rows: () => ({ rows }) }).tools);
		const answer = { ...ui(), confirm: async (title: string, message: string) => (answer.asked.push(`${title}\n${message}`), false) };
		await publisher.publish(bundle.manifest.id, answer);
		assert.match(answer.asked[0], /may contain secrets/);
		assert.match(answer.asked[0], /`data`, a query result: GitHub token/);
	});
});

describe("findSecrets in query results", () => {
	it("finds a secret after the first window", () => {
		const hits = findSecrets(`x = "${"a ".repeat(40_000)}ghp_abcdefghijklmnopqrstuvwxyz0123456789"`);
		assert.deepEqual(hits.map((h) => [h.kind, h.statement]), [["GitHub token", "x"]]);
	});

	it("finds a long JSON web token on every window edge", () => {
		const jwt = `eyJ${"a".repeat(40)}.eyJ${"b".repeat(1500)}.${"c".repeat(43)}`;
		for (let pad = 32_768 - jwt.length - 10; pad < 32_768 + 10; pad += 3) {
			assert.equal(findSecrets(`x = "${"a".repeat(pad)} ${jwt}"`).length, 1, `pad ${pad}`);
		}
	});

	it("finds keys in compact JSON", () => {
		const json = JSON.stringify({ password: "hunter2hunter2", api_key: "abcdef123456", client_secret: "s3cr3tvalue", headers: { Authorization: "Bearer abcdefghijklmnop1234" } });
		const kinds = reviewPage(`d = ${json}`).secrets.map((h) => h.kind);
		assert.ok(kinds.includes("password or secret"), kinds.join());
		assert.ok(kinds.includes("bearer token"), kinds.join());
		for (const text of ['x = "{\\"password\\":\\"hunter2hunter2\\"}"', "AWS_SECRET_ACCESS_KEY=abcdefghij", "db_password: hunter2hunter2", "refresh_token=abcdefghij"]) {
			assert.equal(findSecrets(text).length, 1, text);
		}
		assert.deepEqual(findSecrets("secretary: Ada Lovelace"), []);
	});
});
