// Copies the viewer build into the Pi package, which serves it on localhost.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = new URL("../packages/viewer/dist/", import.meta.url);
const to = new URL("../packages/pi/viewer/", import.meta.url);

if (!existsSync(new URL("index.html", from))) throw new Error("Build the viewer first: npm run build:viewer");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("copied the viewer build to packages/pi/viewer");
