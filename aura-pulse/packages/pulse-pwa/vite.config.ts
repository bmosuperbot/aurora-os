import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Aura Pulse",
        short_name: "Pulse",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#6366f1",
        icons: [
          { src: "/icons/pulse-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icons/pulse-512.svg", sizes: "512x512", type: "image/svg+xml" }
        ]
      }
    })
  ],
  server: {
    port: 7701
  }
});
