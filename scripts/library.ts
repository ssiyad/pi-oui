// Writes the OpenUI library files that the Pi package reads, so that the
// Pi package never imports React.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

const out = new URL("../packages/pi/library/", import.meta.url);
const version = readReactUiVersion();

mkdirSync(out, { recursive: true });
writeFileSync(new URL("library.spec.json", out), `${JSON.stringify(spec(), null, 2)}\n`);
writeFileSync(new URL("prompt.md", out), `${openuiLibrary.prompt(openuiPromptOptions)}\n`);
console.log(`wrote library.spec.json and prompt.md for react-ui ${version}`);

function spec() {
	return {
		library: `openui@${version}`,
		root: openuiLibrary.root,
		schema: openuiLibrary.toJSONSchema(),
	};
}

// react-ui exports "./*", so its own package.json cannot be resolved. The
// viewer pins an exact version, which is the version that renders pages.
function readReactUiVersion(): string {
	const path = new URL("../packages/viewer/package.json", import.meta.url);
	return JSON.parse(readFileSync(path, "utf8")).dependencies["@openuidev/react-ui"];
}
