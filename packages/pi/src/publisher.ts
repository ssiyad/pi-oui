// Publishing puts a page in a secret Gist, a public place. render_ui publishes
// each page without errors. The user confirms only a page that may contain
// secrets. The link holds only the Gist ID, never the page.
import { config } from "./config.ts";
import { formatProblems } from "./checker.ts";
import { GistClient, gistLink } from "./links.ts";
import type { Pages } from "./pages.ts";
import { type PageReview, reviewPage, type SecretHit } from "./review.ts";
import { hasData } from "./snapshot.ts";
import { MAX_PAGE_BYTES, type PageBundle, type Snapshot } from "./store.ts";

/** The parts of the Pi UI that publishing needs. */
export interface ConfirmUI {
	hasUI: boolean;
	confirm(title: string, message: string): Promise<boolean>;
}

export type PublishOutcome =
	| { status: "published"; url: string; updated: boolean; review: PageReview }
	| { status: "cancelled"; review: PageReview };

interface Plan {
	message: string;
	review: PageReview;
	snapshot?: Snapshot;
	bytes: number;
}

export class Publisher {
	#pages: Pages;
	#gist: GistClient;
	#rendererUrl: string;

	constructor(pages: Pages, gist: GistClient, rendererUrl = config.rendererUrl()) {
		this.#pages = pages;
		this.#gist = gist;
		this.#rendererUrl = rendererUrl;
	}

	/**
	 * Creates the Gist of a page, or updates it. The link stays the same after an
	 * update. The user confirms first only when the page may contain secrets.
	 */
	async publish(id: string, ui: ConfirmUI): Promise<PublishOutcome> {
		const bundle = await this.#pages.store.load(id);
		const plan = await this.#plan(bundle);
		if (plan.review.secrets.length) {
			if (!ui.hasUI) throw new Error(`The page may contain secrets, so the user must confirm it in the Pi interface, and there is none. Remove the secrets from the page, then call render_ui again.\n${secretList(plan)}`);
			if (!(await ui.confirm(`Publish "${bundle.manifest.title}"? It may contain secrets.`, confirmMessage(bundle, plan)))) return { status: "cancelled", review: plan.review };
		}

		const updated = Boolean(bundle.manifest.links.gist);
		const url = await this.#toGist(bundle, plan.message);
		return { status: "published", url, updated, review: plan.review };
	}

	/** Deletes the Gist of a page. The user always confirms. */
	async unpublish(id: string, ui: ConfirmUI): Promise<{ status: "deleted" | "cancelled"; url?: string }> {
		if (!ui.hasUI) throw new Error("The user must confirm this in the Pi interface. Ask the user to run Pi in interactive mode.");
		const bundle = await this.#pages.store.load(id);
		const gist = bundle.manifest.links.gist;
		if (!gist) throw new Error("This page is not published.");

		const message = `The link stops working in about 5 minutes. GitHub serves a cached copy until then:\n${gist.url}\n\nPeople who saved a copy of the page keep it.`;
		if (!(await ui.confirm(`Delete the Gist of "${bundle.manifest.title}"?`, message))) return { status: "cancelled" };

		// A Gist that is already gone is deleted.
		await this.#gist.delete(gist.id).catch((error: Error) => {
			if (!/\bHTTP 404\b/.test(error.message)) throw error;
		});
		await bundle.update((m) => {
			const { gist: _deleted, ...links } = m.links;
			return { links };
		});
		return { status: "deleted", url: gist.url };
	}

	async #plan(bundle: PageBundle): Promise<Plan> {
		const { checker } = this.#pages;
		const source = await bundle.readSource();
		const result = checker.check(source, { allowData: true });
		if (!result.ok) throw new Error(`Fix these errors first, then call render_ui:\n${formatProblems(result.errors)}`);

		// A page with queries goes out as the snapshot from the last render_ui.
		const needsSnapshot = hasData(checker.parse(source));
		const snapshot = needsSnapshot ? await bundle.readSnapshot(source) : undefined;
		if (needsSnapshot && !snapshot) throw new Error("The page has Query() or Mutation() statements, and page.oui changed after the last snapshot. Call render_ui to run the queries again, then publish.");
		const shared = snapshot ? { source: snapshot.content, snapshot } : { source };
		const check = checker.check(shared.source);
		if (!check.ok) throw new Error(`The snapshot has errors. Call render_ui again:\n${formatProblems(check.errors)}`);

		// The same source goes into the check, the review and the message.
		const message = await bundle.toMessage(checker.library, shared);
		const bytes = Buffer.byteLength(message);
		if (bytes > MAX_PAGE_BYTES) throw new Error(`The page is ${kb(bytes)}. The renderer opens pages up to ${kb(MAX_PAGE_BYTES)}. Make the page or its query results smaller.`);
		return { message, review: reviewPage(shared.source, bundle.manifest.title), snapshot, bytes };
	}

	async #toGist(bundle: PageBundle, message: string): Promise<string> {
		const existing = bundle.manifest.links.gist;
		if (existing) {
			await this.#gist.update(existing.id, message);
			// Build the link again: the renderer URL can change after the first publish.
			const url = gistLink(this.#rendererUrl, existing.owner, existing.id);
			await bundle.update((m) => ({ links: { ...m.links, gist: { ...existing, url, at: new Date().toISOString() } } }));
			return url;
		}
		const { id, owner } = await this.#gist.create(message, bundle.manifest.title);
		const url = gistLink(this.#rendererUrl, owner, id);
		await bundle.update((m) => ({ links: { ...m.links, gist: { id, owner, url, at: new Date().toISOString() } } }));
		return url;
	}
}

function confirmMessage(bundle: PageBundle, plan: Plan): string {
	const lines = ["Anyone with the link can open this page.", "", gistText(bundle), `Size: ${kb(plan.bytes)}`];
	if (plan.snapshot) lines.push(`Data: the query results from ${plan.snapshot.at.slice(0, 16).replace("T", " ")} UTC.`);
	lines.push(`Hosts in links and images: ${plan.review.hosts.join(", ") || "none"}`, "", secretList(plan));
	return lines.join("\n");
}

function secretList(plan: Plan): string {
	return ["Possible secrets:", ...plan.review.secrets.map((s) => `  ${secretPlace(s, plan.snapshot)}: ${s.kind} ${s.preview}`)].join("\n");
}

// Lines of a snapshot are not lines of page.oui, so name the statement.
function secretPlace(hit: SecretHit, snapshot: Snapshot | undefined): string {
	if (hit.where === "title") return "title";
	if (!hit.statement) return `line ${hit.where}`;
	const result = snapshot?.queries.includes(hit.statement) ? ", a query result" : "";
	return snapshot ? `\`${hit.statement}\`${result}` : `line ${hit.where} (\`${hit.statement}\`)`;
}

function gistText(bundle: PageBundle): string {
	const gist = bundle.manifest.links.gist;
	if (gist) return `Updates secret Gist ${gist.id}. The link stays the same. The change can take 5 minutes to show.`;
	return "Makes a new secret GitHub Gist on your gh account. A secret Gist is not private: anyone with the link can read it.";
}

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} KB`;
}
