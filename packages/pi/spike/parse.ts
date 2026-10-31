// Spike: parse pages in Node with lang-core and the generated library spec,
// and measure the fragment link for each page.
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createParser, parseMessage } from "@openuidev/lang-core";

const spec = JSON.parse(readFileSync(new URL("../library/library.spec.json", import.meta.url), "utf8"));
const parser = createParser(spec.schema, spec.root);

for (const name of ["sample.oui", "broken.oui"]) report(name);

function report(name: string) {
	const raw = readFileSync(new URL(name, import.meta.url), "utf8");
	const message = parseMessage(raw);
	const result = parser.parse(message.content ?? raw);
	console.log(`\n== ${name}`);
	console.log("message keys:", Object.keys(message));
	console.log("root:", result.root?.typeName ?? null, "| meta:", JSON.stringify({ ...result.meta, errors: result.meta.errors.length }));
	for (const e of result.meta.errors) console.log(" -", JSON.stringify(e));
	console.log(`text ${raw.length} B -> link ${fragmentLink(raw).length} B`);
}

function fragmentLink(text: string): string {
	return `https://example.github.io/viewer/#/s/1.${deflateRawSync(text, { level: 9 }).toString("base64url")}`;
}
