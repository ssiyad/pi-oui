// The page workflow that the tools share: make and check.
import type { ToolProvider } from "@openuidev/lang-core";
import type { CheckResult, PageChecker } from "./checker.ts";
import { config } from "./config.ts";
import { hasData, Snapshots } from "./snapshot.ts";
import { readChecker } from "./spec.ts";
import { type PageBundle, PageStore, type Snapshot } from "./store.ts";

export interface RenderOutcome {
	bundle: PageBundle;
	result: CheckResult;
	/** The query results that render_ui publishes. */
	snapshot?: Snapshot;
}

export class Pages {
	readonly store: PageStore;
	#checker: PageChecker | undefined;
	#snapshots: Snapshots | undefined;

	constructor(store = new PageStore(config.storeDir())) {
		this.store = store;
	}

	// Read the 95 KB spec on first use, not when Pi starts.
	get checker(): PageChecker {
		this.#checker ??= readChecker(config.specPath());
		return this.#checker;
	}

	get snapshots(): Snapshots {
		this.#snapshots ??= new Snapshots(this.checker);
		return this.#snapshots;
	}

	/** Checks a page and saves the result. With tools, runs the queries of the page and saves a snapshot of the results. */
	async render(id: string, tools?: ToolProvider): Promise<RenderOutcome> {
		const bundle = await this.store.load(id);
		const { result, snapshot } = await this.#check(bundle, tools);
		await bundle.update({ check: { at: new Date().toISOString(), ok: result.ok } });
		return { bundle, result, snapshot };
	}

	// Errors in the page come first: queries run only on a page without errors.
	async #check(bundle: PageBundle, tools?: ToolProvider): Promise<{ result: CheckResult; snapshot?: Snapshot }> {
		const source = await bundle.readSource();
		const result = this.checker.check(source, { allowData: true });
		if (!result.ok || !hasData(this.checker.parse(source))) {
			// A snapshot is for the source it came from. Delete it, so a revert to that source cannot share old data without a new render_ui.
			await bundle.clearSnapshot();
			return { result };
		}

		const outcome = await this.snapshots.take(bundle, source, tools);
		const errors = [...result.errors, ...outcome.errors];
		return { result: { ...result, ok: errors.length === 0, errors, warnings: [...result.warnings, ...outcome.warnings] }, snapshot: outcome.snapshot };
	}
}
