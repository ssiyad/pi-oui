// OpenUI Lang statements as ASTs, and back to source. A snapshot changes some
// statements, and lang-core can print an evaluated tree but not an AST.
import { type ASTNode, parseExpression, split, tokenize, walkAST } from "@openuidev/lang-core";

/** Calls that the language writes without "@": components, and these. */
const BARE_CALLS = new Set(["Action", "Query", "Mutation"]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class AstPrinter {
	#components: Set<string>;

	/** Pass the component names of the library. Other calls print with "@". */
	constructor(components: Iterable<string>) {
		this.#components = new Set(components);
	}

	print(node: ASTNode): string {
		switch (node.k) {
			case "Comp":
				return this.#call(node);
			case "Str":
				return JSON.stringify(node.v);
			case "Num":
			case "Bool":
				return String(node.v);
			case "Null":
				return "null";
			case "Arr":
				return `[${node.els.map((el) => this.print(el)).join(", ")}]`;
			case "Obj":
				return `{${node.entries.map(([key, value]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${this.print(value)}`).join(", ")}}`;
			case "Ref":
			case "Ph":
			case "StateRef":
			case "RuntimeRef":
				return node.n;
			// Parentheses on every operator, so the printer needs no precedence table.
			case "BinOp":
				return `(${this.print(node.left)} ${node.op} ${this.print(node.right)})`;
			case "UnaryOp":
				return `(${node.op}(${this.print(node.operand)}))`;
			case "Ternary":
				return `(${this.print(node.cond)} ? ${this.print(node.then)} : ${this.print(node.else)})`;
			case "Member":
				return `${this.print(node.obj)}.${node.field}`;
			case "Index":
				return `${this.print(node.obj)}[${this.print(node.index)}]`;
			case "Assign":
				return `${node.target} = ${this.print(node.value)}`;
		}
	}

	#call(node: Extract<ASTNode, { k: "Comp" }>): string {
		if (node.mappedProps) throw new Error(`Cannot print the named arguments of ${node.name}().`);
		const bare = !node.fn && (this.#components.has(node.name) || BARE_CALLS.has(node.name));
		return `${bare ? "" : "@"}${node.name}(${node.args.map((arg) => this.print(arg)).join(", ")})`;
	}
}

/** The statements of a page in order, each with the AST of its value. */
export function parseStatements(source: string): Map<string, ASTNode> {
	return new Map(split(tokenize(source)).map((statement) => [statement.id, parseExpression(statement.tokens)]));
}

/** The names that a node refers to. */
export function refsOf(node: ASTNode | null): Set<string> {
	const names = new Set<string>();
	if (node) walkAST(node, (n) => (n.k === "Ref" || n.k === "RuntimeRef") && names.add(n.n));
	return names;
}
