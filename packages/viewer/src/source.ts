// Reads a page from the URL fragment: #/s/<version>.<payload> or #/g/<user>/<gist-id>.
import sample from "../../pi/spike/sample.oui?raw";

export async function loadPage(hash: string): Promise<string> {
	const [, kind, ...rest] = hash.replace(/^#/, "").split("/");
	if (kind === "s") return decodeFragment(rest.join("/"));
	if (kind === "g") return fetchGist(rest[0], rest[1]);
	return sample;
}

async function decodeFragment(value: string): Promise<string> {
	const [version, payload] = value.split(".", 2);
	if (version !== "1") throw new Error(`Unknown link version: ${version}`);
	const stream = new Blob([fromBase64Url(payload)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Response(stream).text();
}

async function fetchGist(user: string, id: string): Promise<string> {
	const url = `https://gist.githubusercontent.com/${encodeURIComponent(user)}/${encodeURIComponent(id)}/raw/page.oui`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Gist not found (${response.status})`);
	return response.text();
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
