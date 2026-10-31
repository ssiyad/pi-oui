import "./zod";
import "@openuidev/react-ui/styles/index.css";
import "./viewer.css";
import { parseMessage, Renderer } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { handleAction } from "./actions";
import { useHash, useLiveReload } from "./hooks";
import { loadPage, parseRoute } from "./source";

function App() {
	const hash = useHash();
	const route = useMemo(() => parseRoute(hash), [hash]);
	const revision = useLiveReload(route);
	const [page, setPage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

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
			<main className="viewer">
				{error ? <p>{error}</p> : <Renderer library={openuiLibrary} response={page} isStreaming={false} onAction={handleAction} />}
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
