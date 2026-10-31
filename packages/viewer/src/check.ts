// The same checks as render_ui in Pi, so a page made without Pi shows its
// problems too. OpenUI drops broken statements without a word.
import { parseMessage } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { PageChecker, type Problem } from "../../pi/src/checker";

let checker: PageChecker | undefined;

export function findProblems(text: string): Problem[] {
	checker ??= new PageChecker({ library: "viewer", root: openuiLibrary.root as string, schema: openuiLibrary.toJSONSchema() });
	const result = checker.check(parseMessage(text).content);
	return [...result.errors, ...result.warnings];
}
