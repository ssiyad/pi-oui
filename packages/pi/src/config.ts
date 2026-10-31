// Paths and settings. Environment variables override the defaults, so tests
// and users can move the store and the renderer.
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
};
