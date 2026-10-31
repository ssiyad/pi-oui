import "@openuidev/react-ui/styles/index.css";
import "./viewer.css";
import { Renderer } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadPage } from "./source";

function App() {
	const [page, setPage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const load = () => loadPage(location.hash).then(setPage, (e) => setError(String(e)));
		load();
		addEventListener("hashchange", load);
		return () => removeEventListener("hashchange", load);
	}, []);

	if (error) return <p>{error}</p>;
	return (
		<ThemeProvider mode={colorScheme()}>
			<main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
				<Renderer library={openuiLibrary} response={page} isStreaming={false} />
			</main>
		</ThemeProvider>
	);
}

function colorScheme(): "light" | "dark" {
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
