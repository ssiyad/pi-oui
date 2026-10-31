// Pi extension: make OpenUI pages and share them as links.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Importer } from "./importer.ts";
import { GistClient } from "./links.ts";
import { Pages } from "./pages.ts";
import { Publisher } from "./publisher.ts";
import { registerTools } from "./tools.ts";

export default function piArtifacts(pi: ExtensionAPI): void {
	const pages = new Pages();
	const publisher = new Publisher(pages, new GistClient(pi.exec.bind(pi)));
	registerTools(pi, pages, publisher, new Importer(pages));
}
