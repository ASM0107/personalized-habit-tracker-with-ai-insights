import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { handleAiInferenceRequest } from "./server/gateway.js";

function geminiServerGatewayPlugin(apiKey: string) {
  return {
    name: "gemini-server-gateway",
    configureServer(server: { middlewares: { use: (route: string, handler: (req: any, res: any) => void) => void } }) {
      server.middlewares.use("/api/ai/health", (_req: any, res: any) => {
        const hasKey = Boolean(apiKey && apiKey.trim().length > 0);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok", serverGatewayActive: true, hasServerKey: hasKey }));
      });

      server.middlewares.use("/api/ai/infer", (req: any, res: any) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return;
        }

        let rawBody = "";
        req.on("data", (chunk: any) => {
          rawBody += chunk;
        });

        req.on("end", async () => {
          try {
            const payload = JSON.parse(rawBody);
            const result = await handleAiInferenceRequest(payload, apiKey);
            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.body));
          } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Malformed JSON payload" }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const serverApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";

  return {
    plugins: [
      react(),
      geminiServerGatewayPlugin(serverApiKey),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "pwa-192x192.svg", "pwa-512x512.svg"],
        manifest: {
          name: "Personalized Habit Tracker with AI Insights",
          short_name: "HabitTracker",
          description: "Local-first habit tracking application with adaptive EMA momentum scoring and AI insights",
          theme_color: "#0f172a",
          background_color: "#020617",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/pwa-192x192.svg",
              sizes: "192x192",
              type: "image/svg+xml",
            },
            {
              src: "/pwa-512x512.svg",
              sizes: "512x512",
              type: "image/svg+xml",
            },
            {
              src: "/pwa-512x512.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,json}"],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ request, url }) =>
                url.origin === self.location.origin &&
                !url.pathname.startsWith("/api/") &&
                (request.destination === "style" ||
                  request.destination === "script" ||
                  request.destination === "image" ||
                  request.destination === "font" ||
                  /\.(?:js|css|html|ico|png|svg|webmanifest)$/.test(url.pathname)),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "habit-tracker-static-assets",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 3000,
      open: false,
    },
  };
});
