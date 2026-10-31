// Remix: copy a published page from its link into a new local bundle. The
// copy has no Gist, so publish_ui makes a new link and the original stays as it is.
import { parseMessage, walkAST } from "@openuidev/lang-core";
import { parseStatements } from "./ast.ts";
import { config } from "./config.ts";
import { gistLink, parseGistLink, rawGistUrl } from "./links.ts";
import type { Pages } from "./pages.ts";
import { hasData } from "./snapshot.ts";
import { MAX_PAGE_BYTES, type PageBundle, type PageOrigin, type RemixSource } from "./store.ts";

/** Same shape as the global fetch(). */
export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface ImportOutcome {
	bundle: PageBundle;
	from: RemixSource;
	/** The local page that published this Gist, when it is on this computer. */
	own?: string;
}

const MAX_TITLE = 120;

export class Importer {
	#pages: Pages;
	#fetch: Fetch;
	#rendererUrl: string;

	constructor(pages: Pages, fetch: Fetch = globalThis.fetch, rendererUrl = config.rendererUrl()) {
		this.#pages = pages;
		this.#fetch = fetch;
		this.#rendererUrl = rendererUrl;
	}

	async import(link: string, origin: PageOrigin = {}): Promise<ImportOutcome> {
		const gist = parseGistLink(link);
		if (!gist) throw new Error(`This is not a pi-oui link: ${link}\nA link ends in #/g/<user>/<gist-id>.`);

		const message = parseMessage(await this.#download(rawGistUrl(gist.owner, gist.id)));
		const source = message.content;
		if (!source.trim()) throw new Error("The page at this link is empty.");
		// render_ui runs each Query() with the tools of this agent. Another person wrote these.
		if (hasData(this.#pages.checker.parse(source)) || hasToolCall(source)) {
			throw new Error("The page has Query() or Mutation() statements. render_ui would run them with your tools, so import_ui does not copy pages that another person can make call tools.");
		}

		const from: RemixSource = { ...gist, url: gistLink(this.#rendererUrl, gist.owner, gist.id), at: new Date().toISOString() };
		const bundle = await this.#pages.store.create(titleOf(message.context, gist.owner), { ...origin, remixOf: from }, source);
		const own = (await this.#pages.store.list()).find((p) => p.links.gist?.id === gist.id)?.id;
		return { bundle, from, own };
	}

	async #download(url: string): Promise<string> {
		const response = await this.#fetch(url, { signal: AbortSignal.timeout(30_000) });
		if (response.status === 404) throw new Error("No page at this link. The owner may have deleted it, or the link is wrong.");
		if (!response.ok || !response.body) throw new Error(`Cannot read the page (HTTP ${response.status}).`);
		return readLimited(response.body);
	}
}

/**
 * Finds Query() and Mutation() anywhere in the page, also inside other
 * expressions, where the parser does not list them. When the page does not
 * parse, any text that looks like a call counts.
 */
function hasToolCall(source: string): boolean {
	try {
		let found = false;
		for (const node of parseStatements(source).values()) {
			walkAST(node, (n) => {
				if (n.k === "Comp" && TOOL_CALLS.has(n.name)) found = true;
			});
		}
		return found;
	} catch {
		return /\b(?:Query|Mutation)\s*\(/.test(source);
	}
}

const TOOL_CALLS = new Set(["Query", "Mutation"]);

// The renderer does not open pages over the limit, so do not copy them. A copy
// of readLimited() in renderer/src/source.ts, which cannot import Node code.
async function readLimited(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		size += value.byteLength;
		if (size > MAX_PAGE_BYTES) {
			await reader.cancel();
			throw new Error("The page is larger than 2 MB. The renderer does not open it.");
		}
		text += decoder.decode(value, { stream: true });
	}
}

// A page made without Pi can have no context, or any value in it.
function titleOf(context: unknown, owner: string): string {
	const title = (context as { title?: unknown } | null)?.title;
	// Control and format characters, such as a right-to-left override, can hide text in the confirm dialog.
	const clean = typeof title === "string" ? title.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim().slice(0, MAX_TITLE) : "";
	return clean || `Remix of a page by @${owner}`;
}
