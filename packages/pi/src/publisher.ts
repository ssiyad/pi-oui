// Publishing sends a page to a public place, so the user always confirms.
import { FRAGMENT_LIMIT, config } from "./config.ts";
import { formatProblems } from "./checker.ts";
import { fragmentLink, GistClient, gistLink } from "./links.ts";
import type { Pages } from "./pages.ts";
import { type PageReview, reviewPage } from "./review.ts";
import type { PageBundle } from "./store.ts";

export type Storage = "auto" | "fragment" | "gist";

/** The parts of the Pi UI that publishing needs. */
export interface ConfirmUI {
	hasUI: boolean;
	confirm(title: string, message: string): Promise<boolean>;
}

export type PublishOutcome =
	| { status: "published"; storage: "fragment" | "gist"; url: string; review: PageReview }
	| { status: "cancelled" };

interface Plan {
	storage: "fragment" | "gist";
	message: string;
	fragment: string;
	review: PageReview;
}

export class Publisher {
	#pages: Pages;
	#gist: GistClient;
	#viewerUrl: string;

	constructor(pages: Pages, gist: GistClient, viewerUrl = config.viewerUrl()) {
		this.#pages = pages;
		this.#gist = gist;
		this.#viewerUrl = viewerUrl;
	}

	async publish(id: string, storage: Storage, ui: ConfirmUI): Promise<PublishOutcome> {
		requireUI(ui);
		const bundle = await this.#pages.store.load(id);
		const plan = await this.#plan(bundle, storage);
		if (!(await ui.confirm(confirmTitle(bundle, plan), confirmMessage(bundle, plan)))) return { status: "cancelled" };

		const url = plan.storage === "fragment" ? plan.fragment : await this.#toGist(bundle, plan.message);
		if (plan.storage === "fragment") {
			await bundle.update((m) => ({ links: { ...m.links, fragment: { url, at: new Date().toISOString() } } }));
		}
		return { status: "published", storage: plan.storage, url, review: plan.review };
	}

	/** Deletes the Gist of a page. Fragment links cannot be deleted. */
	async unpublish(id: string, ui: ConfirmUI): Promise<{ status: "deleted" | "cancelled"; url?: string }> {
		requireUI(ui);
		const bundle = await this.#pages.store.load(id);
		const gist = bundle.manifest.links.gist;
		if (!gist) throw new Error("This page has no Gist. A fragment link cannot be deleted, because the page is in the link itself.");

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

	async #plan(bundle: PageBundle, storage: Storage): Promise<Plan> {
		const source = await bundle.readSource();
		const result = this.#pages.checker.check(source);
		if (!result.ok) throw new Error(`Fix these errors first, then call render_ui:\n${formatProblems(result.errors)}`);

		// The same source goes into the check, the review and the message.
		const message = await bundle.toMessage(this.#pages.checker.library, source);
		const fragment = fragmentLink(this.#viewerUrl, message);
		const review = reviewPage(source, bundle.manifest.title);
		return { storage: chooseStorage(storage, fragment.length, Boolean(bundle.manifest.links.gist)), message, fragment, review };
	}

	async #toGist(bundle: PageBundle, message: string): Promise<string> {
		const existing = bundle.manifest.links.gist;
		if (existing) {
			await this.#gist.update(existing.id, message);
			await bundle.update((m) => ({ links: { ...m.links, gist: { ...existing, at: new Date().toISOString() } } }));
			return existing.url;
		}
		const { id, owner } = await this.#gist.create(message, bundle.manifest.title);
		const url = gistLink(this.#viewerUrl, owner, id);
		await bundle.update((m) => ({ links: { ...m.links, gist: { id, owner, url, at: new Date().toISOString() } } }));
		return url;
	}
}

/** A page with a Gist keeps its Gist, so its link stays the same. */
export function chooseStorage(requested: Storage, fragmentLength: number, hasGist: boolean): "fragment" | "gist" {
	if (requested !== "auto") return requested;
	if (hasGist) return "gist";
	return fragmentLength <= FRAGMENT_LIMIT ? "fragment" : "gist";
}

function requireUI(ui: ConfirmUI): void {
	if (!ui.hasUI) throw new Error("The user must confirm this in the Pi interface. Ask the user to run /share in interactive mode.");
}

function confirmTitle(bundle: PageBundle, plan: Plan): string {
	const warning = plan.review.secrets.length ? " It may contain secrets." : "";
	return `Publish "${bundle.manifest.title}"?${warning}`;
}

function confirmMessage(bundle: PageBundle, plan: Plan): string {
	const lines = [
		"Anyone with the link can open this page.",
		"",
		`Storage: ${storageText(bundle, plan)}`,
		`Size: page ${kb(plan.message.length)}, link ${kb(plan.fragment.length)}`,
	];
	if (plan.storage === "fragment" && plan.fragment.length > FRAGMENT_LIMIT) {
		lines.push(`The link is longer than ${kb(FRAGMENT_LIMIT)}. Some chat apps cut long links.`);
	}
	lines.push(`Hosts in links and images: ${plan.review.hosts.join(", ") || "none"}`);
	if (plan.review.secrets.length) {
		lines.push("", "Possible secrets:", ...plan.review.secrets.map((s) => `  ${s.where === "title" ? "title" : `line ${s.where}`}: ${s.kind} ${s.preview}`));
	}
	return lines.join("\n");
}

function storageText(bundle: PageBundle, plan: Plan): string {
	if (plan.storage === "fragment") return "in the link. Nobody can change or delete the link after you share it.";
	const gist = bundle.manifest.links.gist;
	if (gist) return `updates secret Gist ${gist.id}. The link stays the same. The change can take 5 minutes to show.`;
	return "a new secret GitHub Gist on your gh account. A secret Gist is not private: anyone with the link can read it.";
}

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} KB`;
}
