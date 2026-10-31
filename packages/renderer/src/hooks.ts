import { useEffect, useState } from "react";
import type { Route } from "./source";

export function useHash(): string {
	const [hash, setHash] = useState(location.hash);
	useEffect(() => {
		const update = () => setHash(location.hash);
		addEventListener("hashchange", update);
		return () => removeEventListener("hashchange", update);
	}, []);
	return hash;
}

/** Counts renders of a local page, so the renderer reloads it. Only the Pi preview server sends them. */
export function useLiveReload(route: Route): number {
	const [revision, setRevision] = useState(0);
	const id = route.kind === "local" ? route.id : undefined;
	useEffect(() => {
		if (!id) return;
		const events = new EventSource(`./events?page=${encodeURIComponent(id)}`);
		events.addEventListener("render", (event) => {
			if (event.data === id) setRevision((n) => n + 1);
		});
		return () => events.close();
	}, [id]);
	return revision;
}
