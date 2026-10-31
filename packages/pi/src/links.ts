// Published pages live in secret GitHub Gists. A link holds only the Gist ID.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GIST_FILE = "page.oui";

/** Runs a command. Same shape as pi.exec(). */
export type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number }>;

export function gistLink(rendererUrl: string, owner: string, id: string): string {
	return `${rendererUrl}#/g/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;
}

/** Secret Gists through the GitHub CLI, so that we never handle a token. */
export class GistClient {
	#exec: Exec;

	constructor(exec: Exec) {
		this.#exec = exec;
	}

	async create(message: string, description: string): Promise<{ id: string; owner: string }> {
		const stdout = await this.#withFile(message, (path) => this.#gh(["gist", "create", path, "--desc", description]));
		// gh prints https://gist.github.com/<owner>/<id>. Older versions leave out the owner.
		const match = /gist\.github\.com\/(?:([\w-]+)\/)?([0-9a-f]+)\s*$/.exec(stdout.trim());
		if (!match) throw new Error(`Unexpected output from "gh gist create": ${stdout.trim()}`);
		const [, owner, id] = match;
		return { id, owner: owner ?? (await this.#ownerOrDelete(id)) };
	}

	// A Gist without an owner has no link. Do not leave it behind.
	async #ownerOrDelete(id: string): Promise<string> {
		try {
			return (await this.#gh(["api", `gists/${id}`, "--jq", ".owner.login"])).trim();
		} catch (error) {
			const deleted = await this.delete(id).then(() => true, () => false);
			const state = deleted ? "Deleted the new Gist." : `Gist ${id} was created but not deleted. Delete it with: gh gist delete ${id}`;
			throw new Error(`Cannot read the owner of the new Gist. ${state} ${(error as Error).message}`);
		}
	}

	async update(id: string, message: string): Promise<void> {
		await this.#withFile(message, (path) => this.#gh(["gist", "edit", id, "--filename", GIST_FILE, path]));
	}

	async delete(id: string): Promise<void> {
		await this.#gh(["gist", "delete", id, "--yes"]);
	}

	// gh names the Gist file after the local file, so the file is page.oui.
	async #withFile(message: string, run: (path: string) => Promise<string>): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "pi-ui-"));
		try {
			const path = join(dir, GIST_FILE);
			await writeFile(path, message);
			return await run(path);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}

	async #gh(args: string[]): Promise<string> {
		const result = await this.#exec("gh", args, { timeout: 30_000 });
		if (result.code !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
		return result.stdout;
	}
}
