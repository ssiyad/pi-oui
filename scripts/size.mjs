// Prints the raw, gzip and brotli size of each file in the renderer build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dist = new URL("../packages/renderer/dist/", import.meta.url).pathname;
const rows = files(dist).map(measure).sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((sum, r) => ({ raw: sum.raw + r.raw, gzip: sum.gzip + r.gzip, brotli: sum.brotli + r.brotli }), { raw: 0, gzip: 0, brotli: 0 });

for (const r of [...rows, { file: "TOTAL", ...total }]) {
	console.log(`${r.file.padEnd(48)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)} ${kb(r.brotli).padStart(10)}`);
}

function measure(path) {
	const data = readFileSync(path);
	return {
		file: path.slice(dist.length),
		raw: data.length,
		gzip: gzipSync(data, { level: 9 }).length,
		brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
	};
}

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}
