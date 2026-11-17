import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// CSP only in production builds: the dev server needs inline HMR scripts and websockets.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://avatars.githubusercontent.com; " +
  "connect-src 'self' https://api.github.com; worker-src 'self'; manifest-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'none'";

const csp = (): Plugin => ({
  name: "inject-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: "./",
  server: { host: "::", port: 8080 },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  plugins: [
    react(),
    tailwindcss(),
    csp(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      devOptions: { enabled: false },
      filename: "sw.js",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,ico,webmanifest}"],
        runtimeCaching: [
          { urlPattern: ({ request }) => request.mode === "navigate", handler: "NetworkFirst" },
        ],
      },
    }),
  ],
});
