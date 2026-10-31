// Reads a page from the route in the URL fragment.
//   #/s/1.<payload>    the page is in the link (raw deflate, base64url)
//   #/g/<owner>/<id>   the page is in a secret Gist
//   #/l/<id>           a local page on the Pi preview server
// A small link can inflate to a huge page. Stop before the tab runs out of memory.
const MAX_PAGE = 2 * 1024 * 1024;
const MAX_PAYLOAD = 1024 * 1024;

export type Route =
	| { kind: "fragment"; value: string }
	| { kind: "gist"; owner: string; id: string }
	| { kind: "local"; id: string }
	| { kind: "none" };

export function parseRoute(hash: string): Route {
	const [, kind, ...rest] = hash.replace(/^#/, "").split("/");
	if (kind === "s" && rest.length) return { kind: "fragment", value: rest.join("/") };
	if (kind === "g" && rest.length === 2) return { kind: "gist", owner: rest[0], id: rest[1] };
	if (kind === "l" && rest.length === 1) return { kind: "local", id: rest[0] };
	return { kind: "none" };
}

export async function loadPage(route: Route): Promise<string> {
	switch (route.kind) {
		case "fragment":
			return decodeFragment(route.value);
		case "gist":
			return fetchText(`https://gist.githubusercontent.com/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.id)}/raw/page.oui`);
		case "local":
			return fetchText(`./pages/${encodeURIComponent(route.id)}/page.oui`);
		case "none":
			throw new Error("This link has no page.");
	}
}

async function decodeFragment(value: string): Promise<string> {
	const [version, payload] = value.split(".", 2);
	if (version !== "1" || !payload) throw new Error("This link is not complete, or it is from a newer version of the viewer.");
	if (payload.length > MAX_PAYLOAD) throw new Error("This link is too long.");
	const stream = new Blob([fromBase64Url(payload)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return readLimited(stream);
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok || !response.body) throw new Error(`Cannot load the page (HTTP ${response.status}). The owner may have deleted it.`);
	return readLimited(response.body);
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
			throw new Error("This page is larger than 2 MB. The viewer does not open it.");
		}
		text += decoder.decode(value, { stream: true });
	}
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
