// Checks a page with the OpenUI Lang parser, the same parser the renderer uses.
// The renderer runs this file too, so it must not import Node modules.
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

export interface SpecFile {
	library: string;
	root: string;
	schema: LibraryJSONSchema;
}

export interface CheckOptions {
	/** Accept Query() and Mutation(), because a snapshot replaces them. Only Pi has tools to take a snapshot. */
	allowData?: boolean;
}

export class PageChecker {
	/** Library marker of the spec, for example "openui@0.18.1". */
	readonly library: string;
	/** Names of the components in the library. */
	readonly components: string[];
	#parser: Parser;

	constructor(spec: SpecFile) {
		this.library = spec.library;
		this.components = Object.keys(spec.schema.properties ?? {});
		this.#parser = createParser(spec.schema, spec.root);
	}

	parse(source: string): ParseResult {
		return this.#parser.parse(source);
	}

	/** Checks OpenUI Lang source. Unresolved and unused names are errors. */
	check(source: string, options: CheckOptions = {}): CheckResult {
		if (!source.trim()) return failed([{ code: "empty", message: "The page is empty. Write a `root = Stack([...])` statement." }]);

		const result = this.#parser.parse(source);
		const code = codeOnly(source);
		const data = options.allowData ? [] : dataErrors(result);
		const errors = [...validationErrors(result), ...referenceErrors(result), ...data, ...linkErrors(source, code)];
		const warnings = [...result.meta.errors.filter((e) => isWarning(e) && e.code !== "no-root").map(fromValidation), ...actionWarnings(code)];

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

// A shared page has no tools, so Query() and Mutation() never run. In Pi,
// render_ui replaces them with a snapshot before the page goes out.
function dataErrors(result: ParseResult): Problem[] {
	const statements = [...result.queryStatements, ...result.mutationStatements];
	return statements.map(({ statementId }) => ({
		code: "needs-tools",
		statement: statementId,
		message: "Query() and Mutation() need tools, and a shared page has none. Publish the page from Pi, which shares a snapshot of the query results.",
	}));
}

// The renderer opens only https links, so a button with another link does nothing.
// `code` finds the actions, and `source` gives the text of their URLs.
function linkErrors(source: string, code: string): Problem[] {
	const links = [...code.matchAll(/@OpenUrl\(\s*(["'])/g)].map((m) => {
		const start = m.index + m[0].length;
		const end = code.indexOf(m[1], start);
		return source.slice(start, end < 0 ? source.length : end);
	});
	return links
		.filter((url) => !/^https:\/\//i.test(url))
		.map((url) => ({ code: "not-https", message: `@OpenUrl("${url}") does nothing: the renderer opens only https:// links.` }));
}

function actionWarnings(code: string): Problem[] {
	if (!/@ToAssistant\b/.test(code)) return [];
	return [{ code: "no-assistant", message: "@ToAssistant does nothing in a shared page, because the reader has no assistant. Use @OpenUrl with an https link, or remove the button." }];
}

// A page can write about actions in its text, for example `@ToAssistant` in
// Markdown. Only code runs, so the action checks must see only code. This
// blanks the rest as lang-core drops it: first the text outside Markdown
// fences, then strings and comments. The quotes stay and the offsets do not
// change, so a check can read the source at the same place.
function codeOnly(source: string): string {
	return blankStringsAndComments(blankOutsideFences(source));
}

// When a page has Markdown fences, lang-core keeps only the code in them, and
// drops the text around them and the line of each opening fence.
function blankOutsideFences(source: string): string {
	let code = "";
	let at = 0;
	for (const [start, end] of fencedCode(source)) {
		code += blank(source.slice(at, start)) + source.slice(start, end);
		at = end;
	}
	return at === 0 ? source : code + blank(source.slice(at));
}

// The same search as stripFences in lang-core. It skips ``` in "..." strings,
// but not in '...' strings.
function fencedCode(source: string): [number, number][] {
	const blocks: [number, number][] = [];
	let i = 0;
	while (i < source.length) {
		const open = findFence(source, i);
		if (open < 0) break;
		const line = source.indexOf("\n", open + 3);
		if (line < 0) {
			blocks.push([source.length, source.length]);
			break;
		}
		const close = findFence(source, line + 1);
		blocks.push([line + 1, close < 0 ? source.length : close]);
		i = close < 0 ? source.length : close + 3;
	}
	return blocks;
}

function findFence(source: string, from: number): number {
	for (let i = from; i < source.length; i++) {
		if (source.startsWith("```", i)) return i;
		if (source[i] !== '"') continue;
		for (i++; i < source.length && source[i] !== '"'; i++) {
			if (source[i] === "\\") i++;
		}
	}
	return -1;
}

// "..." and '...' strings with backslash escapes, and // and # comments to the
// end of the line, as the lexer and stripComments in lang-core read them.
function blankStringsAndComments(source: string): string {
	let code = "";
	let quote = "";
	let comment = false;
	for (let i = 0; i < source.length; i++) {
		const c = source[i];
		if (comment && c !== "\n") {
			code += " ";
		} else if (quote && c === "\\") {
			code += blank(source.slice(i, i + 2));
			i++;
		} else if (quote) {
			if (c === quote) quote = "";
			code += quote ? blank(c) : c;
		} else if (c === "#" || (c === "/" && source[i + 1] === "/")) {
			comment = true;
			code += " ";
		} else {
			if (c === "\n") comment = false;
			if (c === '"' || c === "'") quote = c;
			code += c;
		}
	}
	return code;
}

function blank(text: string): string {
	return text.replace(/[^\n]/g, " ");
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
