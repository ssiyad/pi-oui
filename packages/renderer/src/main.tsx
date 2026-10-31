import "./zod";
import "@openuidev/react-ui/styles/index.css";
import "./renderer.css";
import { parseMessage, Renderer } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { guardLinks, handleAction, handleOwnAction } from "./actions";
import { Banner, Problems } from "./banner";
import { findProblems } from "./check";
import { useHash, useLiveReload } from "./hooks";
import { LANDING, loadPage, parseRoute } from "./source";

function App() {
	const hash = useHash();
	const route = useMemo(() => parseRoute(hash), [hash]);
	const revision = useLiveReload(route);
	const [page, setPage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const problems = useMemo(() => (page ? findProblems(page) : []), [page]);
	// The landing page comes with the renderer, not from a user, so its links open without a question.
	// Check the page too: for one render after a route change, the page is still the old one.
	const own = route.kind === "home" && page === LANDING;
	useEffect(guardLinks, []);

	// A new route must not show the old page under the banner of the new owner.
	useEffect(() => {
		setPage(null);
		setError(null);
	}, [route]);

	useEffect(() => {
		let current = true;
		loadPage(route)
			.then((text) => {
				if (!current) return;
				setPage(text);
				setError(null);
				setTitle(text);
			})
			.catch((e: Error) => current && setError(e.message));
		return () => {
			current = false;
		};
	}, [route, revision]);

	return (
		<ThemeProvider mode={colorScheme()}>
			<Banner route={route} />
			<main className="renderer" data-trusted={own || undefined}>
				{error ? <p>{error}</p> : <Problems problems={problems} />}
				{!error && <Renderer library={openuiLibrary} response={page} isStreaming={false} onAction={own ? handleOwnAction : handleAction} />}
			</main>
		</ThemeProvider>
	);
}

function setTitle(text: string) {
	const title = (parseMessage(text).context as { title?: unknown } | null)?.title;
	if (typeof title === "string") document.title = title;
}

function colorScheme(): "light" | "dark" {
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
