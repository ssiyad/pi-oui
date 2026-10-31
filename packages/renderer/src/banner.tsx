// The parts of the renderer around a page: a banner that says who made it,
// and the problems that the page has.
import type { Problem } from "../../pi/src/checker";
import { Callout } from "@openuidev/react-ui";
import type { Route } from "./source";

/** A full-width bar above the page. Readers see who made the page before they trust it. */
export function Banner({ route }: { route: Route }) {
	return (
		<header className="banner" data-trusted>
			<div className="banner-inner">
				<span>{origin(route)}</span>
				<span>
					Rendered using{" "}
					<a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
						pi-oui
					</a>
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
