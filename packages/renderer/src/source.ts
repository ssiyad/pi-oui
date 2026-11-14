// Reads a page from the route in the URL fragment. A link never holds the page.
//   #/g/<owner>/<id>   the page is in a secret Gist
//   (no fragment)      the landing page of pi-oui, which the renderer holds
import { buildMessage } from "@openuidev/lang-core";
import landing from "./landing.oui?raw";

// Stop before a huge page uses up the memory of the tab.
const MAX_PAGE = 2 * 1024 * 1024;

// Some networks block the Gist host and hold the request open for minutes.
// Without a limit, the reader sees an empty page and no reason.
const TIMEOUT = 20_000;

// The landing page in the same form as a published page, so it gets a title.
export const LANDING = buildMessage({ content: landing, context: { title: "pi-oui: make a web page in Pi and share it with a link" }, end: true });

export type Route = { kind: "gist"; owner: string; id: string } | { kind: "home" } | { kind: "none" };

// The banner shows the owner, so accept only the characters of GitHub names.
// Enterprise managed users have a suffix such as "_corp".
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const GIST_ID = /^[0-9a-f]{1,40}$/i;

export function parseRoute(hash: string): Route {
	if (/^#?\/?$/.test(hash)) return { kind: "home" };
	const [, kind, ...rest] = hash.replace(/^#/, "").split("/");
	if (kind === "g" && rest.length === 2 && OWNER.test(rest[0]) && GIST_ID.test(rest[1])) return { kind: "gist", owner: rest[0], id: rest[1] };
	return { kind: "none" };
}

export async function loadPage(route: Route): Promise<string> {
	switch (route.kind) {
		case "gist":
			return fetchText(`https://gist.githubusercontent.com/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.id)}/raw/page.oui`);
		case "home":
			return LANDING;
		case "none":
			throw new Error("This link has no page.");
	}
}

async function fetchText(url: string): Promise<string> {
	const signal = AbortSignal.timeout(TIMEOUT);
	try {
		const response = await fetch(url, { cache: "no-store", signal });
		if (!response.ok || !response.body) throw new Error(`Cannot load the page (HTTP ${response.status}). The owner may have deleted it.`);
		return await readLimited(response.body);
	} catch (e) {
		// fetch rejects with a TypeError when the network fails, and with the signal's reason on a timeout.
		if (e instanceof TypeError || signal.aborted) {
			const host = new URL(url).host;
			throw new Error(`Cannot reach ${host}. Your network or a browser extension may block it. Try again, or open the link on another network.`);
		}
		throw e;
	}
}

async function readLimited(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		size += value.byteLength;
		if (size > MAX_PAGE) {
			await reader.cancel();
			throw new Error("This page is larger than 2 MB. The renderer does not open it.");
		}
		text += decoder.decode(value, { stream: true });
	}
}
