import { useEffect, useState } from "react";

export function useHash(): string {
	const [hash, setHash] = useState(location.hash);
	useEffect(() => {
		const update = () => setHash(location.hash);
		addEventListener("hashchange", update);
		return () => removeEventListener("hashchange", update);
	}, []);
	return hash;
}
