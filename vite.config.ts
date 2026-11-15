import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
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
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
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
});
