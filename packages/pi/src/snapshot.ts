// A shared page has no tools. render_ui runs the queries of a page and saves a
// snapshot: the page with each Query() replaced by its result, and without
// Mutation() and the parts that run or show a mutation. The preview shows the
// snapshot, and publish_ui shares it.
import { type ASTNode, mergeStatements, type ParseResult, type ToolProvider } from "@openuidev/lang-core";
import { AstPrinter, parseStatements } from "./ast.ts";
import type { PageChecker, Problem } from "./checker.ts";
import { QueryRunner } from "./queries.ts";
import { MAX_PAGE_BYTES, type PageBundle, type Snapshot } from "./store.ts";

export interface SnapshotOutcome {
	errors: Problem[];
	warnings: Problem[];
	/** The snapshot that the preview shows and publish_ui shares. */
	snapshot?: Snapshot;
}

/** The page has statements that need tools. */
export function hasData(result: ParseResult): boolean {
	return result.queryStatements.length > 0 || result.mutationStatements.length > 0;
}

export class Snapshots {
	#checker: PageChecker;
	#builder: SnapshotBuilder;

	constructor(checker: PageChecker) {
		this.#checker = checker;
		this.#builder = new SnapshotBuilder(checker.components);
	}

	/**
	 * Runs the queries with the tools and saves a new snapshot. Without tools,
	 * for example in a command, returns the saved snapshot if the page did not change.
	 */
	async take(bundle: PageBundle, source: string, tools?: ToolProvider): Promise<SnapshotOutcome> {
		const parsed = this.#checker.parse(source);
		const warnings = dataWarnings(parsed);
		if (!tools) {
			const snapshot = await bundle.readSnapshot(source);
			if (snapshot) return { errors: [], warnings, snapshot };
			return { errors: [], warnings: [...warnings, { code: "no-snapshot", message: "The page changed after the last render_ui, so the preview shows no query results. Ask the agent to call render_ui." }] };
		}

		// Never leave an old snapshot that publish_ui could share for this source.
		const errors = await this.#build(bundle, source, parsed, tools).catch(async (error) => {
			await bundle.clearSnapshot();
			throw error;
		});
		if (errors.length) await bundle.clearSnapshot();
		return { errors, warnings, snapshot: errors.length ? undefined : await bundle.readSnapshot(source) };
	}

	async #build(bundle: PageBundle, source: string, parsed: ParseResult, tools: ToolProvider): Promise<Problem[]> {
		const run = await new QueryRunner(tools).run(parsed);
		if (run.errors.length) return run.errors;

		const mutations = parsed.mutationStatements.map((m) => m.statementId);
		let content: string;
		try {
			content = this.#builder.build(source, run.values, mutations);
		} catch (error) {
			return [{ code: "snapshot-failed", message: (error as Error).message }];
		}
		const check = this.#checker.check(content);
		if (!check.ok) return check.errors.map((e) => ({ ...e, message: `In the snapshot: ${e.message}` }));
		const bytes = Buffer.byteLength(content);
		if (bytes > MAX_PAGE_BYTES) return [{ code: "snapshot-too-large", message: `The snapshot is ${Math.ceil(bytes / 1024)} KB. The renderer opens pages up to ${MAX_PAGE_BYTES / 1024} KB. Ask the tools for less data.` }];
		await bundle.saveSnapshot(source, content, [...run.values.keys()]);
		return [];
	}
}

/** Marks a node to delete. The deletion goes up to the nearest array. */
const GONE = Symbol("gone");
/** Marks an action step to leave out. The action stays. */
const SKIP = Symbol("skip");
type Pruned = ASTNode | typeof GONE | typeof SKIP;

export class SnapshotBuilder {
	#printer: AstPrinter;
	#components: Set<string>;

	constructor(components: Iterable<string>) {
		this.#components = new Set(components);
		this.#printer = new AstPrinter(this.#components);
	}

	/** The page with query results as literal values, and without mutations and the parts that use them. */
	build(source: string, results: Map<string, unknown>, mutations: string[]): string {
		const statements = parseStatements(source);
		const removed = this.#prune(statements, new Set(results.keys()), new Set(mutations));
		if (removed.gone.has("root")) throw new Error("The whole page uses a mutation, so nothing is left to share.");

		const patch = [
			...[...results].map(([id, value]) => `${id} = ${JSON.stringify(value)}`),
			...[...removed.changed].map(([id, node]) => `${id} = ${this.#printer.print(node)}`),
			// lang-core deletes a statement whose new value is null, and then the statements that root no longer reaches.
			...[...removed.gone].map((id) => `${id} = null`),
		];
		return mergeStatements(source, patch.join("\n"));
	}

	/** Removes statements that use a mutation, until no more statements change. */
	#prune(statements: Map<string, ASTNode>, queries: Set<string>, mutations: Set<string>) {
		const gone = new Set(mutations);
		const changed = new Map<string, ASTNode>();
		const parts = new Set<string>();
		// A statement can be a part through another statement, so repeat until the set stops growing.
		for (let size = -1; size !== parts.size; ) {
			size = parts.size;
			for (const [id, node] of statements) if (isPart(node, this.#components, parts)) parts.add(id);
		}
		for (let again = true; again; ) {
			again = false;
			for (const [id, original] of statements) {
				if (gone.has(id) || queries.has(id)) continue;
				const current = changed.get(id) ?? original;
				const pruned = new Pruner({ gone, queries, components: this.#components, parts }).node(current);
				if (pruned === GONE || pruned === SKIP) {
					gone.add(id);
					changed.delete(id);
					again = true;
				} else if (pruned !== current) changed.set(id, pruned);
			}
		}
		return { gone, changed };
	}
}

interface PruneScope {
	/** Statements that the snapshot deletes. */
	gone: Set<string>;
	queries: Set<string>;
	/** Component names of the library. */
	components: Set<string>;
	/** Statements whose value is a component. */
	parts: Set<string>;
}

/** Rewrites one AST. Returns the same object when nothing changes. */
class Pruner {
	#gone: Set<string>;
	#queries: Set<string>;
	#scope: PruneScope;

	constructor(scope: PruneScope) {
		this.#scope = scope;
		this.#gone = scope.gone;
		this.#queries = scope.queries;
	}

	node(node: ASTNode): Pruned {
		switch (node.k) {
			case "Ref":
			case "RuntimeRef":
				return this.#gone.has(node.n) ? GONE : node;
			case "Comp":
				return this.#call(node);
			case "Arr":
				return this.#array(node);
			case "Obj":
				return this.#same(node, node.entries.map(([, value]) => value), (values) => ({ ...node, entries: node.entries.map(([key], i) => [key, values[i]]) }));
			case "BinOp":
				return this.#same(node, [node.left, node.right], ([left, right]) => ({ ...node, left, right }));
			case "UnaryOp":
				return this.#same(node, [node.operand], ([operand]) => ({ ...node, operand }));
			case "Ternary":
				return this.#same(node, [node.cond, node.then, node.else], ([cond, then, otherwise]) => ({ ...node, cond, then, else: otherwise }));
			case "Member":
				return this.#same(node, [node.obj], ([obj]) => ({ ...node, obj }));
			case "Index":
				return this.#same(node, [node.obj, node.index], ([obj, index]) => ({ ...node, obj, index }));
			case "Assign":
				return this.#same(node, [node.value], ([value]) => ({ ...node, value }));
			default:
				return node;
		}
	}

	#call(node: Extract<ASTNode, { k: "Comp" }>): Pruned {
		if (node.name === "Run") return this.#runStep(node);
		if (node.name === "Action") return this.#action(node);
		if (node.name === "Each") return this.#each(node);
		return this.#same(node, node.args, (args) => ({ ...node, args }));
	}

	// @Each(list, "r", template): inside the template, r is the item and not a statement of that name.
	#each(node: Extract<ASTNode, { k: "Comp" }>): Pruned {
		const [list, name, template, ...rest] = node.args;
		if (name?.k !== "Str" || !template) return this.#same(node, node.args, (args) => ({ ...node, args }));
		const without = (names: Set<string>) => new Set([...names].filter((n) => n !== name.v));
		const inner = new Pruner({ ...this.#scope, gone: without(this.#gone), queries: without(this.#queries) });
		const prunedList = this.node(list);
		const prunedTemplate = inner.node(template);
		if (prunedList === GONE || prunedList === SKIP || prunedTemplate === GONE || prunedTemplate === SKIP) return GONE;
		if (prunedList === list && prunedTemplate === template) return node;
		return { ...node, args: [prunedList, name, prunedTemplate, ...rest] };
	}

	// @Run(mutation) makes its button go. @Run(query) refreshes a query, and a snapshot has no query to refresh.
	#runStep(node: Extract<ASTNode, { k: "Comp" }>): Pruned {
		const target = node.args[0];
		const name = target && (target.k === "Ref" || target.k === "RuntimeRef") ? target.n : undefined;
		if (name && this.#gone.has(name)) return GONE;
		if (name && this.#queries.has(name)) return SKIP;
		return node;
	}

	// An action that runs a mutation is gone, and so is its button. An action with no steps left does nothing, so it goes too.
	#action(node: Extract<ASTNode, { k: "Comp" }>): Pruned {
		const steps = node.args[0];
		if (steps?.k !== "Arr") return this.#same(node, node.args, (args) => ({ ...node, args }));
		const pruned = steps.els.map((step) => this.node(step));
		if (pruned.includes(GONE)) return GONE;
		const kept = pruned.filter((step): step is ASTNode => step !== SKIP);
		if (!kept.length) return GONE;
		if (kept.every((step, i) => step === steps.els[i]) && kept.length === steps.els.length) return node;
		return { ...node, args: [{ ...steps, els: kept }, ...node.args.slice(1)] };
	}

	// A deleted component leaves the array, and the array stays, also when it is
	// empty. A deleted value would move the values after it, so the array goes.
	#array(node: Extract<ASTNode, { k: "Arr" }>): Pruned {
		const pruned = node.els.map((el) => this.node(el));
		if (pruned.some((el, i) => (el === GONE || el === SKIP) && !this.#isPart(node.els[i]))) return GONE;
		const kept = pruned.filter((el): el is ASTNode => el !== GONE && el !== SKIP);
		if (kept.length === node.els.length && kept.every((el, i) => el === node.els[i])) return node;
		return { ...node, els: kept };
	}

	#isPart(node: ASTNode): boolean {
		return isPart(node, this.#scope.components, this.#scope.parts);
	}

	/** Prunes the children. A deleted child deletes the node. Builds a new node only when a child changes. */
	#same<T extends ASTNode>(node: T, children: ASTNode[], rebuild: (children: ASTNode[]) => ASTNode): Pruned {
		const pruned = children.map((child) => this.node(child));
		if (pruned.some((child) => child === GONE || child === SKIP)) return GONE;
		const next = pruned as ASTNode[];
		return next.every((child, i) => child === children[i]) ? node : rebuild(next);
	}
}

/** Something that renders: a component, @Each, a choice between parts, or a statement that is one of these. */
function isPart(node: ASTNode, components: Set<string>, parts: Set<string>): boolean {
	switch (node.k) {
		case "Comp":
			return node.name === "Each" || (!node.fn && components.has(node.name));
		case "Ternary":
			return isPart(node.then, components, parts) && isPart(node.else, components, parts);
		case "Ref":
		case "RuntimeRef":
			return parts.has(node.n);
		default:
			return false;
	}
}

/** What a snapshot changes, for the author. */
function dataWarnings(parsed: ParseResult): Problem[] {
	const queries = parsed.queryStatements.flatMap((q): Problem[] => {
		const state = (q.deps ?? []).filter((dep) => dep.startsWith("$"));
		if (state.length) return [{ code: "static-query", statement: q.statementId, message: `The query uses ${state.join(", ")}. The snapshot keeps the result for the first value, so a change in the page shows the same data.` }];
		if (q.refreshAST) return [{ code: "static-query", statement: q.statementId, message: "The snapshot does not refresh." }];
		return [];
	});
	const mutations = parsed.mutationStatements.map((m) => ({
		code: "mutation-removed",
		statement: m.statementId,
		message: "A shared page has no tools. The snapshot removes this mutation and the buttons and parts that use it.",
	}));
	return [...queries, ...mutations];
}
