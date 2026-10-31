// Runs the Query() statements of a page with Pi tools, for a snapshot.
//
// lang-core's createQueryManager() also works in Node, but it suits a live
// page: it fetches a failed query again on each evaluation and starts refresh
// timers. A snapshot calls each tool once, after the queries it depends on.
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { type EvaluationContext, evaluate, extractToolResult, type ParseResult, type QueryStatementInfo, type ToolProvider } from "@openuidev/lang-core";
import { refsOf } from "./ast.ts";
import type { Problem } from "./checker.ts";

/** The largest result of one query, in bytes of JSON. The renderer opens pages up to 2 MB. */
export const MAX_RESULT = 512 * 1024;

export interface QueryRun {
	/** Results by statement, as plain JSON values. */
	values: Map<string, unknown>;
	errors: Problem[];
}

export class QueryRunner {
	#tools: ToolProvider;

	constructor(tools: ToolProvider) {
		this.#tools = tools;
	}

	/** Runs every query of a parsed page. A query runs after the queries that its arguments use. */
	async run(result: ParseResult): Promise<QueryRun> {
		const { order, cyclic, blocked } = dependencyOrder(result.queryStatements);
		const run: QueryRun = {
			values: new Map(),
			errors: [
				...cyclic.map((id) => problem("query-cycle", id, "The arguments of this query use its own result, through other queries.")),
				...blocked.map((id) => problem("query-skipped", id, "Not run, because it uses a query in a cycle.")),
			],
		};
		// The same lookups as the OpenUI Renderer: $state defaults, and results of
		// other queries. The Renderer gives null for other names, but a snapshot
		// would then keep a result for the wrong arguments.
		const ctx: EvaluationContext = {
			getState: (name) => result.stateDeclarations[name],
			resolveRef: (name) => {
				if (!run.values.has(name)) throw new Error(`The arguments use \`${name}\`, which is not a query. They can use literal values, $state and other queries.`);
				return run.values.get(name);
			},
		};

		const failed = new Set([...cyclic, ...blocked]);
		for (const query of order) {
			const blocker = [...queryDeps(query)].find((id) => failed.has(id));
			const error = blocker ? problem("query-skipped", query.statementId, `Not run, because query \`${blocker}\` failed.`) : await this.#runOne(query, ctx, run.values);
			if (!error) continue;
			failed.add(query.statementId);
			run.errors.push(error);
		}
		return run;
	}

	/** Runs one query and saves its result. Returns the problem when it fails. */
	async #runOne(query: QueryStatementInfo, ctx: EvaluationContext, values: Map<string, unknown>): Promise<Problem | undefined> {
		const id = query.statementId;
		let tool: unknown;
		let args: unknown;
		try {
			tool = query.toolAST ? evaluate(query.toolAST, ctx) : undefined;
			args = query.argsAST ? evaluate(query.argsAST, ctx) : {};
		} catch (error) {
			return problem("query-args", id, (error as Error).message);
		}
		if (typeof tool !== "string" || !tool) return problem("query-tool", id, "The first argument of Query() must be the name of a tool.");
		if (!isRecord(args)) return problem("query-args", id, "The second argument of Query() must be an object.");

		let value: unknown;
		try {
			value = await this.#tools.callTool(tool, args);
		} catch (error) {
			return problem("query-failed", id, `Tool \`${tool}\` failed: ${(error as Error).message}`);
		}
		// A statement with the value null is a deleted statement for lang-core.
		if (value === null || value === undefined) return problem("query-empty", id, `Tool \`${tool}\` returned no data.`);
		const data = plainJson(value);
		if (!data) return problem("query-not-json", id, `Tool \`${tool}\` returned data that is not JSON.`);
		if (data.size > MAX_RESULT) return problem("query-too-large", id, `Tool \`${tool}\` returned ${Math.ceil(data.size / 1024)} KB. The limit is ${MAX_RESULT / 1024} KB. Ask for less data.`);
		values.set(id, data.value);
		return undefined;
	}
}

/** Pi tools as an OpenUI tool provider. Calls go through the same checks and permission hooks as calls from the model. */
export class PiTools implements ToolProvider {
	#ctx: Pick<ExtensionToolContext, "executeTool">;
	#blocked: Set<string>;

	/** `blocked` are tools that a query must not call, such as render_ui itself. */
	constructor(ctx: Pick<ExtensionToolContext, "executeTool">, blocked: Iterable<string>) {
		this.#ctx = ctx;
		this.#blocked = new Set(blocked);
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (this.#blocked.has(name)) throw new Error(`${name} is a pi-oui tool. A query cannot call it.`);
		const outcome = await this.#ctx.executeTool(name, args);
		// Prefers structuredContent, then text parsed as JSON, then the text.
		const content = outcome.result.content.map((part) => (part.type === "text" ? { type: part.type, text: part.text } : { type: part.type }));
		return extractToolResult({ content, structuredContent: outcome.result.structuredContent, isError: outcome.isError });
	}
}

/** Queries in an order where each comes after the queries that it uses. Queries in a cycle, and the queries that use them, never run. */
function dependencyOrder(queries: QueryStatementInfo[]): { order: QueryStatementInfo[]; cyclic: string[]; blocked: string[] } {
	const ids = new Set(queries.map((q) => q.statementId));
	const waiting = new Map(queries.map((q) => [q, new Set([...queryDeps(q)].filter((id) => ids.has(id)))]));
	const order: QueryStatementInfo[] = [];
	for (let ready = take(waiting); ready.length; ready = take(waiting)) {
		order.push(...ready);
		for (const deps of waiting.values()) for (const q of ready) deps.delete(q.statementId);
	}
	const left = new Map([...waiting].map(([q, deps]) => [q.statementId, deps]));
	const cyclic = [...left.keys()].filter((id) => reaches(left, id, id));
	return { order, cyclic, blocked: [...left.keys()].filter((id) => !cyclic.includes(id)) };
}

/** Whether a query uses the target, directly or through other queries. */
function reaches(deps: Map<string, Set<string>>, from: string, target: string, seen = new Set<string>()): boolean {
	for (const next of deps.get(from) ?? []) {
		if (next === target) return true;
		if (seen.has(next)) continue;
		seen.add(next);
		if (reaches(deps, next, target, seen)) return true;
	}
	return false;
}

/** Removes and returns the queries that wait for nothing. */
function take(waiting: Map<QueryStatementInfo, Set<string>>): QueryStatementInfo[] {
	const ready = [...waiting].filter(([, deps]) => deps.size === 0).map(([q]) => q);
	for (const q of ready) waiting.delete(q);
	return ready;
}

function queryDeps(query: QueryStatementInfo): Set<string> {
	return new Set([...refsOf(query.toolAST), ...refsOf(query.argsAST)]);
}

/** A copy of the value with only JSON types, and its size as JSON. */
function plainJson(value: unknown): { value: unknown; size: number } | undefined {
	try {
		const json = JSON.stringify(value);
		return json === undefined ? undefined : { value: JSON.parse(json), size: Buffer.byteLength(json) };
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function problem(code: string, statement: string, message: string): Problem {
	return { code, statement, message };
}
