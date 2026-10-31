import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GitHub Pages cannot send headers, so the build puts the policy in a meta
// tag. Pages load from the fragment, a Gist, or the Pi preview server.
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

// Relative base, so the same build works on GitHub Pages and on localhost.
export default defineConfig({
	base: "./",
	plugins: [react(), contentSecurityPolicy()],
});
