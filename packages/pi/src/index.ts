// Pi extension: make OpenUI pages and share them as links.
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Importer } from "./importer.ts";
import { GistClient } from "./links.ts";
import { Pages } from "./pages.ts";
import { Publisher } from "./publisher.ts";
import { confirmUI, listLine, publishText, registerTools } from "./tools.ts";

export default function piArtifacts(pi: ExtensionAPI): void {
	const exec = pi.exec.bind(pi);
	const pages = new Pages(exec);
	const publisher = new Publisher(pages, new GistClient(exec));

	registerTools(pi, pages, publisher, new Importer(pages));
	registerCommands(pi, pages, publisher);
	pi.on("session_shutdown", () => pages.close());
}

function registerCommands(pi: ExtensionAPI, pages: Pages, publisher: Publisher): void {
	const completions = async (prefix: string) => {
		const list = await pages.store.list();
		const items = list.filter((p) => p.id.startsWith(prefix)).map((p) => ({ value: p.id, label: `${p.id} ${p.title}` }));
		return items.length ? items : null;
	};

	pi.registerCommand("ui", {
		description: "Open an OpenUI page in the local preview",
		getArgumentCompletions: completions,
		handler: async (args, ctx) => {
			const id = args.trim() || (await pickPage(pages, ctx, "Open which page?"));
			if (!id) return;
			const { url, result } = await pages.render(id, false);
			if (!url) return ctx.ui.notify("The renderer build is missing. Run `npm run build` in the pi-oui repo.", "error");
			const opened = await pages.openBrowser(url);
			ctx.ui.notify(`${opened ? "Opened" : "Open"} ${url}${result.ok ? "" : ` (the page has ${result.errors.length} errors)`}`, result.ok ? "info" : "warning");
		},
	});

	pi.registerCommand("share", {
		description: "Publish an OpenUI page as a public link: /share [id]",
		getArgumentCompletions: completions,
		handler: async (args, ctx) => {
			const id = args.trim() || (await pickPage(pages, ctx, "Share which page?"));
			if (!id) return;
			try {
				const outcome = await publisher.publish(id, confirmUI(ctx));
				ctx.ui.notify(publishText(outcome), outcome.status === "published" ? "info" : "warning");
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});
}

async function pickPage(pages: Pages, ctx: ExtensionCommandContext, title: string): Promise<string | undefined> {
	const list = await pages.store.list();
	if (!list.length) {
		ctx.ui.notify("No pages yet. Ask the agent to make one.", "info");
		return undefined;
	}
	const choice = await ctx.ui.select(title, list.map(listLine));
	return choice?.slice(2).split(":")[0];
}
