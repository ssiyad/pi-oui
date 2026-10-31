// Reads the library spec that scripts/library.ts writes, so Pi never imports React.
import { readFileSync } from "node:fs";
import { PageChecker } from "./checker.ts";

export function readChecker(path: string): PageChecker {
	try {
		return new PageChecker(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		throw new Error(`Cannot read the OpenUI library spec at ${path}. Run "npm run library". ${error}`);
	}
}
