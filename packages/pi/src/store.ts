// Local page bundles: <root>/<id>/manifest.json, page.oui and snapshot.json.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMessage, parseMessage } from "@openuidev/lang-core";

export interface GistLink {
	id: string;
	owner: string;
	url: string;
	at: string;
}

/** The published page that import_ui copied. */
export interface RemixSource {
	owner: string;
	id: string;
	url: string;
	at: string;
}

/** Where a page was made. */
export interface PageOrigin {
	cwd?: string;
	session?: string;
	remixOf?: RemixSource;
}

export interface PageManifest {
	id: string;
	title: string;
	created: string;
	updated: string;
	/** Where the page was made. */
	cwd?: string;
	session?: string;
	remixOf?: RemixSource;
	/** The last render_ui result. */
	check?: { at: string; ok: boolean };
	links: { gist?: GistLink };
}

/** Query results from the last render_ui, in a copy of the page that needs no tools. */
export interface Snapshot {
	/** SHA-256 of the page.oui source that the snapshot was taken from. */
	source: string;
	at: string;
	/** The page with each Query() replaced by its result. */
	content: string;
	/** The statements of the queries. */
	queries: string[];
}

/** The source that the renderer gets: the snapshot, when the page has one. */
export interface SharedSource {
	source: string;
	snapshot?: Snapshot;
}

/** The renderer does not open larger pages. It counts bytes. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class PageStore {
	readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** Makes a bundle. Without a source, page.oui gets a starter page. */
	async create(title: string, origin: PageOrigin = {}, source = starterPage(title)): Promise<PageBundle> {
		const now = new Date().toISOString();
		const manifest: PageManifest = { id: newId(title), title, created: now, updated: now, ...origin, links: {} };
		const bundle = new PageBundle(join(this.root, manifest.id), manifest);
		await mkdir(bundle.dir, { recursive: true });
		await writeFile(bundle.sourcePath, source);
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

	get snapshotPath(): string {
		return join(this.dir, "snapshot.json");
	}

	/** The OpenUI Lang source. Removes stored message markers if the agent wrote them. */
	async readSource(): Promise<string> {
		const raw = await readFile(this.sourcePath, "utf8");
		return parseMessage(raw).content;
	}

	/** The snapshot of this source, if render_ui took one after the last change to page.oui. */
	async readSnapshot(source: string): Promise<Snapshot | undefined> {
		const raw = await readFile(this.snapshotPath, "utf8").catch(() => undefined);
		if (raw === undefined) return undefined;
		try {
			const snapshot = JSON.parse(raw) as Snapshot;
			return snapshot.source === sha256(source) && typeof snapshot.content === "string" ? snapshot : undefined;
		} catch {
			return undefined;
		}
	}

	async saveSnapshot(source: string, content: string, queries: string[]): Promise<void> {
		const snapshot: Snapshot = { source: sha256(source), at: new Date().toISOString(), content, queries };
		await writeAtomic(this.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
	}

	async clearSnapshot(): Promise<void> {
		await rm(this.snapshotPath, { force: true });
	}

	/** The snapshot of the current page if there is one, else the page. */
	async readShared(): Promise<SharedSource> {
		const source = await this.readSource();
		const snapshot = await this.readSnapshot(source);
		return snapshot ? { source: snapshot.content, snapshot } : { source };
	}

	/** The page as an OpenUI stored message, which the renderer reads. Pass the source to publish the version that was checked. */
	async toMessage(library: string, shared?: SharedSource): Promise<string> {
		const { title, created, updated } = this.manifest;
		const { source, snapshot } = shared ?? (await this.readShared());
		return buildMessage({
			content: source,
			context: { title, created, updated, ...(snapshot && { snapshot: snapshot.at }) },
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

	async save(): Promise<void> {
		await writeAtomic(join(this.dir, "manifest.json"), `${JSON.stringify(this.manifest, null, 2)}\n`);
	}
}

// Write a unique file and rename it, so a crash cannot leave half a file.
async function writeAtomic(path: string, text: string): Promise<void> {
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	await writeFile(tmp, text);
	await rename(tmp, path);
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
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
