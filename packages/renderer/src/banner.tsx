// The parts of the renderer around a page: a banner that says who made it,
// and the problems that the page has.
import type { Problem } from "../../pi/src/checker";
import { Button, Callout } from "@openuidev/react-ui";
import { useEffect, useState } from "react";
import type { Route } from "./source";

/** A full-width bar above the page. Readers see who made the page before they trust it. */
export function Banner({ route }: { route: Route }) {
	return (
		<header className="banner" data-trusted>
			<div className="banner-inner">
				<span>{origin(route)}</span>
				<span className="banner-end">
					{route.kind === "gist" && <RemixButton owner={route.owner} id={route.id} />}
					<span>
						Rendered using{" "}
						<a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
							pi-oui
						</a>
					</span>
				</span>
			</div>
		</header>
	);
}

/** The problems of a page. They tell the author why a part does not show. */
export function Problems({ problems }: { problems: Problem[] }) {
	if (!problems.length) return null;
	const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
	return (
		<Callout
			variant="warning"
			title={`This page has ${count}. Some parts may not show.`}
			description={
				<details>
					<summary>Show the problems</summary>
					<ul>
						{problems.map((p, i) => (
							<li key={i}>{p.statement ? `${p.statement}: ${p.message}` : p.message}</li>
						))}
					</ul>
				</details>
			}
		/>
	);
}

/** Copies a command that starts Pi with a request to remix this page. */
function RemixButton({ owner, id }: { owner: string; id: string }) {
	const [copied, setCopied] = useState(false);
	const command = remixCommand(owner, id);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
		} catch {
			// No clipboard access: let the reader copy the command by hand.
			prompt("Copy this command and run it in a terminal:", command);
		}
	};

	return (
		<Button variant="tertiary" size="extra-small" title={command} onClick={copy}>
			{copied ? "Copied" : "Copy remix command"}
		</Button>
	);
}

/**
 * The reader pastes the command into a shell, so it must hold no characters
 * that a shell reads. The route accepts none in the owner and the ID. A server
 * can send the renderer for any path, so a path with other characters goes.
 */
export function remixCommand(owner: string, id: string, { origin, pathname } = location): string {
	const path = SAFE_PATH.test(pathname) ? pathname : "/";
	return `pi "remix ${origin}${path}#/g/${owner}/${id}"`;
}

const SAFE_PATH = /^[A-Za-z0-9._~/-]*$/;

const PROJECT_URL = "https://github.com/ssiyad/pi-oui";

function origin(route: Route) {
	if (route.kind === "local") return "Local preview. Only you can see this page.";
	if (route.kind === "none") return null;
	return (
		<>
			<a href={`https://github.com/${encodeURIComponent(route.owner)}`} target="_blank" rel="noopener noreferrer">
				@{route.owner}
			</a>
			{" "}· User-generated content
		</>
	);
}
