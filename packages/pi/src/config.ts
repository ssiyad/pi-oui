// Paths and settings. Environment variables override the defaults, so tests
// and users can move the store and the renderer.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const config = {
	/** Local page bundles: <storeDir>/<id>/{manifest.json,page.oui}. */
	storeDir(): string {
		return process.env.PI_UI_DIR ?? join(homedir(), ".pi", "ui");
	},

	/** The public renderer. Shared links point here. */
	rendererUrl(): string {
		const url = process.env.PI_UI_RENDERER_URL ?? "https://ssiyad.github.io/pi-oui/";
		return url.endsWith("/") ? url : `${url}/`;
	},

	/** The library spec that the build writes. */
	specPath(): string {
		return join(PACKAGE_ROOT, "library", "library.spec.json");
	},

	/**
	 * The renderer build. A published package has it in renderer/. In the
	 * workspace, the renderer package builds it into its own dist/.
	 */
	rendererDir(): string | undefined {
		const candidates = [
			process.env.PI_UI_RENDERER_DIR,
			join(PACKAGE_ROOT, "renderer"),
			join(PACKAGE_ROOT, "..", "renderer", "dist"),
		];
		return candidates.find((dir) => dir && existsSync(join(dir, "index.html")));
	},

	/** Open the browser after a render. Set PI_UI_OPEN=0 to turn it off. */
	autoOpen(): boolean {
		return process.env.PI_UI_OPEN !== "0";
	},
};
