// Paths and settings. Environment variables override the defaults, so tests
// and users can move the store and the viewer.
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

	/** The public viewer. Shared links point here. */
	viewerUrl(): string {
		const url = process.env.PI_UI_VIEWER_URL ?? "https://ssiyad.github.io/pi-oui/";
		return url.endsWith("/") ? url : `${url}/`;
	},

	/** The library spec that the build writes. */
	specPath(): string {
		return join(PACKAGE_ROOT, "library", "library.spec.json");
	},

	/**
	 * The viewer build. A published package has it in viewer/. In the
	 * workspace, the viewer package builds it into its own dist/.
	 */
	viewerDir(): string | undefined {
		const candidates = [
			process.env.PI_UI_VIEWER_DIR,
			join(PACKAGE_ROOT, "viewer"),
			join(PACKAGE_ROOT, "..", "viewer", "dist"),
		];
		return candidates.find((dir) => dir && existsSync(join(dir, "index.html")));
	},

	/** Open the browser after a render. Set PI_UI_OPEN=0 to turn it off. */
	autoOpen(): boolean {
		return process.env.PI_UI_OPEN !== "0";
	},
};
