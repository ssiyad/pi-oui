// Links out of a page. A shared page has no assistant and no tools, so a page
// can only open links: @OpenUrl buttons and links in Markdown. Both open only
// https links, and only after the reader agrees.
import { BuiltinActionType, type ActionEvent } from "@openuidev/react-lang";

export function handleAction(event: ActionEvent): void {
	if (event.type === BuiltinActionType.OpenUrl) openLink(event.params.url);
}

/**
 * Sends clicks on links through openLink(). Listens on the window in the
 * capture phase, so it runs before the handlers of the components. It guards
 * every link except links in a [data-trusted] element, because components such
 * as Modal render outside the page area. Returns a function that removes the listener.
 */
export function guardLinks(): () => void {
	const onClick = (event: MouseEvent) => {
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!link || link.closest("[data-trusted]")) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.type === "click" || event.button === 1) openLink(link.getAttribute("href"));
	};
	addEventListener("click", onClick, true);
	addEventListener("auxclick", onClick, true);
	return () => {
		removeEventListener("click", onClick, true);
		removeEventListener("auxclick", onClick, true);
	};
}

function openLink(value: unknown): void {
	const url = httpsUrl(value);
	if (url?.protocol !== "https:") {
		alert(`This page links to an address that is not https:\n\n${String(value)}\n\nThe viewer does not open it.`);
		return;
	}
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
