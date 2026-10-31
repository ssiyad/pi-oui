// What the user must see before a page goes public: possible secrets, and the
// hosts that the page loads from or links to.

export interface SecretHit {
	kind: string;
	/** Line in page.oui, or "title". */
	where: number | "title";
	/** The match with most characters hidden. */
	preview: string;
}

export interface PageReview {
	secrets: SecretHit[];
	hosts: string[];
}

// Long lines are data, not secrets, and some patterns are slow on them.
const MAX_LINE = 4096;

const SECRET_PATTERNS: { kind: string; pattern: RegExp }[] = [
	{ kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
	{ kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
	{ kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
	{ kind: "API key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
	{ kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
	{ kind: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
	{ kind: "Frappe API token", pattern: /\btoken\s+[0-9a-f]{15}:[0-9a-f]{15}\b/i },
	{ kind: "password in a URL", pattern: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s/:@"]+:[^\s/@"]+@/i },
	{ kind: "password or secret", pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[^\s'",)]{6,}/i },
];

/** Reviews everything that goes public: the source and the title. */
export function reviewPage(source: string, title = ""): PageReview {
	const secrets = [...findSecrets(title).map((hit) => ({ ...hit, where: "title" as const })), ...findSecrets(source)];
	return { secrets, hosts: findHosts(source) };
}

export function findSecrets(source: string): SecretHit[] {
	const hits: SecretHit[] = [];
	source.split("\n").forEach((line, index) => {
		const text = line.slice(0, MAX_LINE);
		for (const { kind, pattern } of SECRET_PATTERNS) {
			const match = pattern.exec(text);
			if (match) hits.push({ kind, where: index + 1, preview: mask(match[0]) });
		}
	});
	return hits;
}

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

function mask(value: string): string {
	return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}
