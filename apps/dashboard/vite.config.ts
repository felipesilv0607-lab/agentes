import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", strictPort: true, headers: localSecurityHeaders },
  preview: { host: "127.0.0.1", strictPort: true, headers: localSecurityHeaders }
});
