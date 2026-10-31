// Copies the renderer build into the Pi package, which serves it on localhost.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = new URL("../packages/renderer/dist/", import.meta.url);
const to = new URL("../packages/pi/renderer/", import.meta.url);

if (!existsSync(new URL("index.html", from))) throw new Error("Build the renderer first: npm run build:renderer");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("copied the renderer build to packages/pi/renderer");
