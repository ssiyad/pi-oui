import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GitHub Pages cannot send headers, so the build puts the policy in a meta
// tag. Pages load from a Gist or from the Pi preview server.
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' https: data:",
	"font-src 'self' data:",
	"connect-src 'self' https://gist.githubusercontent.com",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
	return {
		name: "content-security-policy",
		apply: "build",
		transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
	};
}

// The OpenUI CodeBlock makes the syntax highlighter about a third of the entry
// script. These aliases keep only what the renderer uses:
// - `refractor/all` has all Prism languages. src/refractor.ts has fewer.
// - The CommonJS theme index has all themes and cannot be tree-shaken. The ES
//   module index can, so only the themes that OpenUI uses stay.
const highlighterAliases = [
	{ find: /^refractor\/all$/, replacement: fileURLToPath(new URL("src/refractor.ts", import.meta.url)) },
	{
		find: /^react-syntax-highlighter\/dist\/cjs\/styles\/prism(\/index\.js)?$/,
		replacement: "react-syntax-highlighter/dist/esm/styles/prism/index.js",
	},
];

// Relative base, so the same build works on GitHub Pages and on localhost.
export default defineConfig({
	base: "./",
	plugins: [react(), contentSecurityPolicy()],
	resolve: { alias: highlighterAliases },
});
