// Local page bundles: <root>/<id>/manifest.json and <root>/<id>/page.oui.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMessage, parseMessage } from "@openuidev/lang-core";

export interface GistLink {
	id: string;
	owner: string;
	url: string;
	at: string;
}

export interface PageManifest {
	id: string;
	title: string;
	created: string;
	updated: string;
	/** Where the page was made. */
	cwd?: string;
	session?: string;
	/** The last render_ui result. */
	check?: { at: string; ok: boolean };
	links: { gist?: GistLink };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class PageStore {
	readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	async create(title: string, origin: { cwd?: string; session?: string } = {}): Promise<PageBundle> {
		const now = new Date().toISOString();
		const manifest: PageManifest = { id: newId(title), title, created: now, updated: now, ...origin, links: {} };
		const bundle = new PageBundle(join(this.root, manifest.id), manifest);
		await mkdir(bundle.dir, { recursive: true });
		await writeFile(bundle.sourcePath, starterPage(title));
		await bundle.save();
		return bundle;
	}

	async load(id: string): Promise<PageBundle> {
		if (!isPageId(id)) throw new Error(`"${id}" is not a page ID.`);
		const dir = join(this.root, id);
		const raw = await readFile(join(dir, "manifest.json"), "utf8").catch(() => {
			throw new Error(`No page with ID "${id}". Call list_ui to see the pages.`);
		});
		try {
			return new PageBundle(dir, JSON.parse(raw));
		} catch {
			throw new Error(`The manifest of page "${id}" is not valid JSON: ${join(dir, "manifest.json")}`);
		}
	}

	/** All pages, the last updated first. Skips bundles that cannot be read. */
	async list(): Promise<PageManifest[]> {
		const names = await readdir(this.root).catch(() => []);
		const bundles = await Promise.all(names.filter(isPageId).map((id) => this.load(id).catch(() => undefined)));
		return bundles
			.filter((b) => b !== undefined)
			.map((b) => b.manifest)
			.sort((a, b) => b.updated.localeCompare(a.updated));
	}
}

export class PageBundle {
	readonly dir: string;
	manifest: PageManifest;

	constructor(dir: string, manifest: PageManifest) {
		this.dir = dir;
		this.manifest = manifest;
	}

	get sourcePath(): string {
		return join(this.dir, "page.oui");
	}

	/** The OpenUI Lang source. Removes stored message markers if the agent wrote them. */
	async readSource(): Promise<string> {
		const raw = await readFile(this.sourcePath, "utf8");
		return parseMessage(raw).content;
	}

	/** The page as an OpenUI stored message, which the renderer reads. Pass the source to publish the version that was checked. */
	async toMessage(library: string, source?: string): Promise<string> {
		const { title, created, updated } = this.manifest;
		return buildMessage({
			content: source ?? (await this.readSource()),
			context: { title, created, updated },
			attributes: { library },
			end: true,
		});
	}

	/**
	 * Changes the manifest on disk. Another tool call can change it at the same
	 * time, so updates run one at a time and start from the file, not from this
	 * object. Pass a function to change a field from its current value.
	 */
	update(change: Partial<PageManifest> | ((current: PageManifest) => Partial<PageManifest>)): Promise<void> {
		const path = join(this.dir, "manifest.json");
		const run = async () => {
			const current = (await readManifest(path)) ?? this.manifest;
			const changed = typeof change === "function" ? change(current) : change;
			this.manifest = { ...current, ...changed, updated: new Date().toISOString() };
			await this.save();
		};
		const next = (updates.get(path) ?? Promise.resolve()).then(run, run);
		updates.set(path, next);
		return next;
	}

	// Write a unique file and rename it, so a crash cannot leave half a manifest.
	async save(): Promise<void> {
		const path = join(this.dir, "manifest.json");
		const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
		await writeFile(tmp, `${JSON.stringify(this.manifest, null, 2)}\n`);
		await rename(tmp, path);
	}
}

/** The last update of each manifest path, so that updates run in order. */
const updates = new Map<string, Promise<void>>();

async function readManifest(path: string): Promise<PageManifest | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

export function isPageId(value: string): boolean {
	return ID_PATTERN.test(value);
}

function newId(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/, "");
	const suffix = randomBytes(3).toString("hex");
	return slug ? `${slug}-${suffix}` : `page-${suffix}`;
}

// A valid page, so that render_ui works before the agent writes anything.
function starterPage(title: string): string {
	return `root = Stack([header])\nheader = CardHeader(${JSON.stringify(title)})\n`;
}
