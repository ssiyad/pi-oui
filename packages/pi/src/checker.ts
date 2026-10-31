// Checks a page with the OpenUI Lang parser, the same parser the viewer uses.
import { readFileSync } from "node:fs";
import { createParser, type LibraryJSONSchema, type ParseResult, type Parser, type ValidationError } from "@openuidev/lang-core";

export interface Problem {
	code: string;
	/** The statement to fix, when the problem has one. */
	statement?: string;
	message: string;
}

export interface CheckResult {
	ok: boolean;
	errors: Problem[];
	warnings: Problem[];
	statementCount: number;
}

interface SpecFile {
	library: string;
	root: string;
	schema: LibraryJSONSchema;
}

export class PageChecker {
	/** Library marker of the spec, for example "openui@0.18.1". */
	readonly library: string;
	#parser: Parser;

	constructor(spec: SpecFile) {
		this.library = spec.library;
		this.#parser = createParser(spec.schema, spec.root);
	}

	static fromFile(path: string): PageChecker {
		try {
			return new PageChecker(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			throw new Error(`Cannot read the OpenUI library spec at ${path}. Run "npm run library". ${error}`);
		}
	}

	/** Checks OpenUI Lang source. Unresolved and unused names are errors. */
	check(source: string): CheckResult {
		if (!source.trim()) return failed([{ code: "empty", message: "The page is empty. Write a `root = Stack([...])` statement." }]);

		const result = this.#parser.parse(source);
		const errors = [...validationErrors(result), ...referenceErrors(result), ...dataErrors(result), ...linkErrors(source)];
		const warnings = [...result.meta.errors.filter((e) => isWarning(e) && e.code !== "no-root").map(fromValidation), ...actionWarnings(source)];

		return { ok: errors.length === 0, errors, warnings, statementCount: result.meta.statementCount };
	}
}

/** Formats problems as one line each, for the agent. */
export function formatProblems(problems: Problem[]): string {
	return problems.map((p) => `- [${p.code}]${p.statement ? ` ${p.statement}:` : ""} ${p.message}`).join("\n");
}

// `no-root` is a warning in OpenUI, because the renderer falls back to
// another statement. A shared page must say what its root is.
function validationErrors(result: ParseResult): Problem[] {
	const errors = result.meta.errors.filter((e) => !isWarning(e) || e.code === "no-root").map(fromValidation);
	if (result.meta.incomplete) {
		errors.push({ code: "incomplete", message: "The page ends in the middle of a statement. Close all strings, brackets and parentheses." });
	}
	return errors;
}

// The parser checks only statements that root reaches. OpenUI drops the other
// statements without an error, so the agent must know about them.
function referenceErrors(result: ParseResult): Problem[] {
	const unresolved = result.meta.unresolved.map((name) => ({
		code: "unresolved",
		statement: name,
		message: `\`${name}\` is used but never defined. It renders as nothing. Define \`${name} = ...\`, or remove the reference.`,
	}));
	const orphaned = result.meta.orphaned.map((name) => ({
		code: "unused",
		statement: name,
		message: `\`${name}\` is defined but root does not reach it, so it does not render and is not checked. Add it to a parent, or delete it.`,
	}));
	return [...unresolved, ...orphaned];
}

// A shared page has no tools, so Query() and Mutation() never run. Snapshots
// of query results come in phase 2.
function dataErrors(result: ParseResult): Problem[] {
	const statements = [...result.queryStatements, ...result.mutationStatements];
	return statements.map(({ statementId }) => ({
		code: "needs-tools",
		statement: statementId,
		message: "Query() and Mutation() need tools, and a shared page has none. Put the data in the page as literal values.",
	}));
}

// The viewer opens only https links, so a button with another link does nothing.
function linkErrors(source: string): Problem[] {
	const links = [...source.matchAll(/@OpenUrl\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
	return links
		.filter((url) => !/^https:\/\//i.test(url))
		.map((url) => ({ code: "not-https", message: `@OpenUrl("${url}") does nothing: the viewer opens only https:// links.` }));
}

function actionWarnings(source: string): Problem[] {
	if (!/@ToAssistant\b/.test(source)) return [];
	return [{ code: "no-assistant", message: "@ToAssistant does nothing in a shared page, because the reader has no assistant. Use @OpenUrl with an https link, or remove the button." }];
}

function fromValidation(error: ValidationError): Problem {
	return { code: error.code, statement: error.statementId, message: error.message };
}

function isWarning(error: ValidationError): boolean {
	return error.severity === "warning";
}

function failed(errors: Problem[]): CheckResult {
	return { ok: false, errors, warnings: [], statementCount: 0 };
}
