// What the user must see before a page goes public: possible secrets, and the
// hosts that the page loads from or links to.

export interface SecretHit {
	kind: string;
	/** Line in the published source, or "title". */
	where: number | "title";
	/** The statement on that line. A snapshot has other lines than page.oui, so show this. */
	statement?: string;
	/** The match with most characters hidden. */
	preview: string;
}

export interface PageReview {
	secrets: SecretHit[];
	hosts: string[];
}

// Some patterns are slow on long lines, so long lines are read in windows.
// Query results are one long line each. Each pattern has a bounded length up
// to its last fixed part, and the overlap is longer than that, so a secret on a
// window edge is in the next window.
const WINDOW = 32_768;
const OVERLAP = 4096;

// A key such as password or db_password, also in JSON and in JSON inside a string.
const SECRET_KEY = String.raw`(?<![A-Za-z0-9])(?:password|passwd|secret|client[_-]?secret|secret[_-]?key|(?:secret[_-]?)?access[_-]?key|api[_-]?key|(?:access|auth|refresh)[_-]?token|authorization)\\?["']?\s*[:=]\s*\\?["']?[^\s'",)\\]{6,}`;

const SECRET_PATTERNS: { kind: string; pattern: RegExp }[] = [
	{ kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
	{ kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
	{ kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
	{ kind: "API key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
	{ kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
	// The header and payload already leak data, so the signature is not needed.
	{ kind: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{8,500}\.eyJ[A-Za-z0-9_-]{8,}/ },
	{ kind: "Frappe API token", pattern: /\btoken\s+[0-9a-f]{15}:[0-9a-f]{15}\b/i },
	{ kind: "password in a URL", pattern: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s/:@"]{1,256}:[^\s/@"]{1,256}@/i },
	{ kind: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/ },
	{ kind: "password or secret", pattern: new RegExp(SECRET_KEY, "i") },
];

/** Reviews everything that goes public: the source and the title. */
export function reviewPage(source: string, title = ""): PageReview {
	const secrets = [...findSecrets(title).map((hit) => ({ ...hit, where: "title" as const })), ...findSecrets(source)];
	return { secrets, hosts: findHosts(source) };
}

export function findSecrets(source: string): SecretHit[] {
	const hits: SecretHit[] = [];
	let statement: string | undefined;
	source.split("\n").forEach((line, index) => {
		statement = STATEMENT.exec(line)?.[1] ?? statement;
		const parts = windows(line);
		for (const { kind, pattern } of SECRET_PATTERNS) {
			const match = firstMatch(pattern, parts);
			if (match) hits.push({ kind, where: index + 1, statement, preview: mask(match) });
		}
	});
	return hits;
}

/** A line that starts a statement. Other lines continue the statement before them. */
const STATEMENT = /^\s*(\$?[A-Za-z_]\w*)\s*=(?!=)/;

/** Hosts of all absolute and protocol-relative URLs. Images load from these hosts when someone opens the page. */
export function findHosts(source: string): string[] {
	const hosts = new Set<string>();
	for (const match of source.matchAll(/(?:\b(?:https?|wss?):|(?<![:\w/]))\/\/[^\s"'<>()\\/]+/gi)) {
		const value = match[0].startsWith("//") ? `https:${match[0]}` : match[0];
		try {
			hosts.add(new URL(value).host);
		} catch {
			// Not a URL after all.
		}
	}
	return [...hosts].sort();
}

function firstMatch(pattern: RegExp, parts: string[]): string | undefined {
	for (const text of parts) {
		const match = pattern.exec(text);
		if (match) return match[0];
	}
	return undefined;
}

function windows(line: string): string[] {
	if (line.length <= WINDOW) return [line];
	const parts: string[] = [];
	for (let start = 0; start < line.length; start += WINDOW - OVERLAP) parts.push(line.slice(start, start + WINDOW));
	return parts;
}

function mask(value: string): string {
	return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}
