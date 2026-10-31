// Writes the OpenUI library files that the Pi package reads, so that the
// Pi package never imports React:
// - packages/pi/library/library.spec.json, for the parser
// - packages/pi/skills/openui-page/reference.md, the component reference
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

// OpenUI's preamble is for chat replies that are only OpenUI Lang. In Pi, the
// agent also talks to the user, so the rules apply to page.oui only.
const PREAMBLE = [
	"# OpenUI Lang reference",
	"",
	"Write pages in openui-lang, a declarative UI language. These rules apply to the content of `page.oui` only.",
	"`page.oui` must contain only openui-lang statements: no markdown fences and no prose.",
].join("\n");

const version = readReactUiVersion();
const spec = new URL("../packages/pi/library/", import.meta.url);
const skill = new URL("../packages/pi/skills/openui-page/", import.meta.url);

mkdirSync(spec, { recursive: true });
mkdirSync(skill, { recursive: true });
writeFileSync(new URL("library.spec.json", spec), `${JSON.stringify(specFile(), null, 2)}\n`);
writeFileSync(new URL("reference.md", skill), `${openuiLibrary.prompt({ ...openuiPromptOptions, preamble: PREAMBLE })}\n`);
console.log(`wrote library.spec.json and reference.md for react-ui ${version}`);

function specFile() {
	return {
		library: `openui@${version}`,
		root: openuiLibrary.root,
		schema: openuiLibrary.toJSONSchema(),
	};
}

// react-ui exports "./*", so its own package.json cannot be resolved. The
// renderer pins an exact version, which is the version that renders pages.
function readReactUiVersion(): string {
	const path = new URL("../packages/renderer/package.json", import.meta.url);
	return JSON.parse(readFileSync(path, "utf8")).dependencies["@openuidev/react-ui"];
}
