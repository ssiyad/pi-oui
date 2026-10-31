// Actions from a page. A shared page has no assistant and no tools, so only
// @OpenUrl does something, and only for https links that the reader accepts.
import { BuiltinActionType, type ActionEvent } from "@openuidev/react-lang";

export function handleAction(event: ActionEvent): void {
	if (event.type !== BuiltinActionType.OpenUrl) return;
	const url = httpsUrl(event.params.url);
	if (url?.protocol !== "https:") return;
	if (!confirm(`This page wants to open a link:\n\n${url.href}\n\nOpen it?`)) return;
	// A new tab without opener: the viewer itself never navigates away.
	window.open(url.href, "_blank", "noopener,noreferrer");
}

function httpsUrl(value: unknown): URL | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url : undefined;
	} catch {
		return undefined;
	}
}
