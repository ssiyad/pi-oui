import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base, so the same build works on GitHub Pages and on localhost.
export default defineConfig({
	base: "./",
	plugins: [react()],
});
