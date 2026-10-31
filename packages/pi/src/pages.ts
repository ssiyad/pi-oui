// The page workflow that tools and commands share: make, check and preview.
import type { CheckResult, PageChecker } from "./checker.ts";
import { config } from "./config.ts";
import type { Exec } from "./links.ts";
import { PreviewServer } from "./preview.ts";
import { readChecker } from "./spec.ts";
import { type PageBundle, PageStore } from "./store.ts";

export interface RenderOutcome {
	bundle: PageBundle;
	result: CheckResult;
	/** Preview URL, when the preview runs. */
	url?: string;
	/** Why there is no preview. */
	previewError?: string;
	opened: boolean;
}

export class Pages {
	readonly store: PageStore;
	#exec: Exec;
	#checker: PageChecker | undefined;
	#preview: Promise<PreviewServer | undefined> | undefined;
	/** When the browser last opened each page. A new tab needs time to connect. */
	#openedAt = new Map<string, number>();

	constructor(exec: Exec, store = new PageStore(config.storeDir())) {
		this.#exec = exec;
		this.store = store;
	}

	// Read the 95 KB spec on first use, not when Pi starts.
	get checker(): PageChecker {
		this.#checker ??= readChecker(config.specPath());
		return this.#checker;
	}

	/** Checks a page, saves the result and refreshes its open previews. Opens the browser when asked and the page has no open preview. */
	async render(id: string, open: boolean): Promise<RenderOutcome> {
		const bundle = await this.store.load(id);
		const result = this.checker.check(await bundle.readSource());
		await bundle.update({ check: { at: new Date().toISOString(), ok: result.ok } });

		// A preview failure must not hide the errors that the agent has to fix.
		let preview: PreviewServer | undefined;
		try {
			preview = await this.preview();
		} catch (error) {
			return { bundle, result, opened: false, previewError: (error as Error).message };
		}
		if (!preview) return { bundle, result, opened: false, previewError: "The viewer build is missing. Run `npm run build` in the pi-artifacts repo." };

		preview.notify(id);
		const url = preview.pageUrl(id);
		const justOpened = Date.now() - (this.#openedAt.get(id) ?? 0) < 15_000;
		const opened = open && config.autoOpen() && result.ok && !justOpened && preview.viewerCount(id) === 0 && (await this.openBrowser(url));
		if (opened) this.#openedAt.set(id, Date.now());
		return { bundle, result, url, opened };
	}

	/** The preview server, started once on first use. Undefined when the viewer build is missing. */
	preview(): Promise<PreviewServer | undefined> {
		this.#preview ??= this.#startPreview().catch((error) => {
			this.#preview = undefined;
			throw error;
		});
		return this.#preview;
	}

	async openBrowser(url: string): Promise<boolean> {
		const [command, ...args] = browserCommand(url);
		const result = await this.#exec(command, args, { timeout: 10_000 }).catch(() => undefined);
		return result?.code === 0;
	}

	async close(): Promise<void> {
		const pending = this.#preview;
		this.#preview = undefined;
		const server = await pending?.catch(() => undefined);
		await server?.close();
	}

	async #startPreview(): Promise<PreviewServer | undefined> {
		const dir = config.viewerDir();
		if (!dir) return undefined;
		const port = Number(process.env.PI_UI_PORT ?? 0);
		if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PI_UI_PORT is not a port: ${process.env.PI_UI_PORT}`);
		const server = new PreviewServer(dir, async (id) => (await this.store.load(id)).toMessage(this.checker.library));
		await server.start(port);
		return server;
	}
}

function browserCommand(url: string): string[] {
	if (process.platform === "darwin") return ["open", url];
	if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
	return ["xdg-open", url];
}
