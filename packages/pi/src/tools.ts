// The tools that the agent calls. Each returns text for the agent and details for the transcript.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatProblems } from "./checker.ts";
import type { Pages, RenderOutcome } from "./pages.ts";
import type { ConfirmUI, Publisher, PublishOutcome } from "./publisher.ts";
import type { PageManifest } from "./store.ts";

const ID = Type.String({ description: "Page ID from scaffold_ui or list_ui." });

export function registerTools(pi: ExtensionAPI, pages: Pages, publisher: Publisher): void {
	pi.registerTool({
		name: "scaffold_ui",
		label: "Scaffold UI page",
		description: "Create a new OpenUI page. Returns its ID and the path of page.oui. Write the page in OpenUI Lang into that file, then call render_ui.",
		promptSnippet: "Create a shareable web page (dashboard, report, table, chart) written in OpenUI Lang",
		parameters: Type.Object({ title: Type.String({ description: "Page title. It shows in the browser tab." }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const bundle = await pages.store.create(params.title, origin(ctx));
			const { id } = bundle.manifest;
			return text(`Created page ${id}.\nWrite OpenUI Lang into ${bundle.sourcePath}, then call render_ui with id "${id}".\nRead the openui-page skill first if you have not.`, bundle.manifest);
		},
	});

	pi.registerTool({
		name: "render_ui",
		label: "Render UI page",
		description: "Check page.oui and show it in the local preview. Returns every error with its statement. Fix the errors in page.oui and call render_ui again until it reports no errors.",
		promptSnippet: "Check an OpenUI page and preview it in the browser",
		parameters: Type.Object({
			id: ID,
			open: Type.Optional(Type.Boolean({ description: "Open the browser if no preview is open. Default: true." })),
		}),
		async execute(_id, params) {
			const outcome = await pages.render(params.id, params.open ?? true);
			return { ...text(renderText(outcome), { id: params.id, ...outcome.result, url: outcome.url }), isError: !outcome.result.ok };
		},
	});

	pi.registerTool({
		name: "list_ui",
		label: "List UI pages",
		description: "List the OpenUI pages on this computer, the last updated first, with their links.",
		parameters: Type.Object({}),
		async execute() {
			const list = await pages.store.list();
			return text(list.length ? list.map(listLine).join("\n") : "No pages yet. Call scaffold_ui to make one.", { pages: list });
		},
	});

	pi.registerTool({
		name: "publish_ui",
		label: "Publish UI page",
		description:
			"Make a public link to a page. The user confirms first. storage: 'fragment' puts the page in the link, 'gist' puts it in a secret GitHub Gist that can be updated and deleted, 'auto' (default) uses the link when it is 8 KB or less. Publish only when the user asks.",
		parameters: Type.Object({
			id: ID,
			storage: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("fragment"), Type.Literal("gist")])),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const outcome = await publisher.publish(params.id, params.storage ?? "auto", confirmUI(ctx));
			return text(publishText(outcome), outcome);
		},
	});

	pi.registerTool({
		name: "unpublish_ui",
		label: "Unpublish UI page",
		description: "Delete the Gist of a page, so its Gist link stops working after about 5 minutes. The user confirms first. Fragment links cannot be deleted.",
		parameters: Type.Object({ id: ID }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const outcome = await publisher.unpublish(params.id, confirmUI(ctx));
			return text(outcome.status === "deleted" ? `Deleted the Gist. This link stops working in about 5 minutes, when the GitHub cache expires: ${outcome.url}` : "The user cancelled. Nothing changed.", outcome);
		},
	});
}

export function listLine(page: PageManifest): string {
	const state = page.check ? (page.check.ok ? "ok" : "has errors") : "not rendered";
	const links = [page.links.gist?.url, page.links.fragment && "fragment link"].filter(Boolean).join(", ");
	return `- ${page.id}: ${page.title} (${state}, updated ${page.updated.slice(0, 16).replace("T", " ")})${links ? ` — ${links}` : ""}`;
}

export function publishText(outcome: PublishOutcome): string {
	if (outcome.status === "cancelled") return "The user cancelled. Nothing was published. Do not try again unless the user asks.";
	const where = outcome.storage === "fragment" ? "The page is in the link." : "The page is in a secret Gist. Changes can take 5 minutes to show.";
	return `Published. Give the user this link:\n${outcome.url}\n${where}`;
}

function renderText({ bundle, result, url, opened, previewError }: RenderOutcome): string {
	const lines = [result.ok ? `Page ${bundle.manifest.id} has no errors (${result.statementCount} statements).` : `Page ${bundle.manifest.id} has ${result.errors.length} errors. Fix them in ${bundle.sourcePath} and call render_ui again:`];
	if (!result.ok) lines.push(formatProblems(result.errors));
	if (result.warnings.length) lines.push("Warnings:", formatProblems(result.warnings));
	if (url) lines.push(`Preview: ${url}${opened ? " (opened in the browser)" : ""}`);
	else lines.push(`No preview: ${previewError}`);
	return lines.join("\n");
}

export function confirmUI(ctx: ExtensionContext): ConfirmUI {
	return { hasUI: ctx.hasUI, confirm: (title, message) => ctx.ui.confirm(title, message) };
}

function origin(ctx: ExtensionContext): { cwd: string; session?: string } {
	return { cwd: ctx.cwd, session: ctx.sessionManager.getSessionFile() };
}

function text<T>(value: string, details: T) {
	return { content: [{ type: "text" as const, text: value }], details };
}
