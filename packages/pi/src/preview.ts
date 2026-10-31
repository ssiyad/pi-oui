// Localhost preview: serves the renderer build and local pages, and tells open
// tabs to reload when a page renders again.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { isPageId } from "./store.ts";

/** Returns the stored message of a local page. */
export type PageMessages = (id: string) => Promise<string>;

// Same policy as the published renderer, but pages come from this server.
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' https: data:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

export class PreviewServer {
	url: string | undefined;
	#hosts = new Set<string>();
	#rendererDir: string;
	#messages: PageMessages;
	#server: Server | undefined;
	/** Open event streams and the page each one shows. */
	#tabs = new Map<ServerResponse, string>();

	constructor(rendererDir: string, messages: PageMessages) {
		this.#rendererDir = resolve(rendererDir);
		this.#messages = messages;
	}

	async start(port = 0): Promise<string> {
		if (this.url) return this.url;
		const server = createServer((req, res) =>
			this.#handle(req, res).catch((error) => {
				console.error("pi-oui preview:", error);
				fail(res, 500, "Internal error");
			}),
		);
		await new Promise<void>((done, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", done);
		});
		this.#server = server;
		const actual = (server.address() as AddressInfo).port;
		// Browsers leave out the default port.
		this.#hosts = new Set(actual === 80 ? ["127.0.0.1", "127.0.0.1:80"] : [`127.0.0.1:${actual}`]);
		this.url = `http://127.0.0.1:${actual}/`;
		return this.url;
	}

	pageUrl(id: string): string {
		if (!this.url) throw new Error("The preview server is not running.");
		return `${this.url}#/l/${id}`;
	}

	/** Number of open tabs that show the page. */
	tabCount(id: string): number {
		return [...this.#tabs.values()].filter((page) => page === id).length;
	}

	/** Tells the tabs that show the page that it changed. */
	notify(id: string): void {
		for (const [tab, page] of this.#tabs) if (page === id) tab.write(`event: render\ndata: ${id}\n\n`);
	}

	async close(): Promise<void> {
		const server = this.#server;
		this.#server = undefined;
		this.url = undefined;
		if (!server) return;
		for (const tab of this.#tabs.keys()) tab.end();
		this.#tabs.clear();
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	}

	async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// Other sites can reach 127.0.0.1 through DNS rebinding. They cannot fake the Host header.
		if (!this.#hosts.has(req.headers.host ?? "")) return fail(res, 403, "Wrong host");
		// The page can hold tool output. Browsers send this header, and only another site sends "cross-site".
		if (req.headers["sec-fetch-site"] === "cross-site") return fail(res, 403, "Cross-site request");
		if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed");

		const url = requestUrl(req);
		if (url === undefined) return fail(res, 400, "Bad path");
		const { path, page: viewing } = url;
		if (path === "/events") return isPageId(viewing) ? this.#openEvents(res, viewing) : fail(res, 400, "Bad page");
		const page = /^\/pages\/([^/]+)\/page\.oui$/.exec(path);
		if (page) return this.#sendPage(res, page[1]);
		return this.#sendFile(res, path);
	}

	#openEvents(res: ServerResponse, id: string): void {
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
		res.write(": connected\n\n");
		this.#tabs.set(res, id);
		res.on("close", () => this.#tabs.delete(res));
	}

	async #sendPage(res: ServerResponse, id: string): Promise<void> {
		if (!isPageId(id)) return fail(res, 404, "Not found");
		const message = await this.#messages(id).catch(() => undefined);
		if (message === undefined) return fail(res, 404, "Not found");
		res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
		res.end(message);
	}

	async #sendFile(res: ServerResponse, path: string): Promise<void> {
		const file = resolve(this.#rendererDir, `.${path === "/" ? "/index.html" : path}`);
		if (!file.startsWith(this.#rendererDir + sep)) return fail(res, 404, "Not found");
		const info = await stat(file).catch(() => undefined);
		if (!info?.isFile()) return fail(res, 404, "Not found");

		const headers: Record<string, string> = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
		if (extname(file) === ".html") headers["content-security-policy"] = CSP;
		res.writeHead(200, headers);
		// pipeline() destroys both streams on a read error or a closed tab.
		pipeline(createReadStream(file), res, () => {});
	}
}

function requestUrl(req: IncomingMessage): { path: string; page: string } | undefined {
	try {
		const url = new URL(req.url ?? "/", "http://localhost");
		return { path: decodeURIComponent(url.pathname), page: url.searchParams.get("page") ?? "" };
	} catch {
		return undefined;
	}
}

function fail(res: ServerResponse, status: number, message: string): void {
	if (res.headersSent) return void res.end();
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	res.end(message);
}
