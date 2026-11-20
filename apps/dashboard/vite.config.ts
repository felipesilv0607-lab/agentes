
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const localSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// O GitHub Pages não permite cabeçalhos HTTP personalizados; por isso a CSP do
// build publicado é entregue por <meta http-equiv>. Limitações da meta tag:
// `frame-ancestors`, `report-uri` e `sandbox` são ignoradas pelos navegadores,
// logo não há proteção contra clickjacking no Pages. Aplicada somente no build:
// o servidor de desenvolvimento do Vite usa scripts inline (React Refresh).
const buildContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

function contentSecurityPolicyMeta(): Plugin {
  return {
    name: "agentes-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: buildContentSecurityPolicy },
          // Antes dos scripts, para valer para eles. Fica antes de <meta charset>,
          // que precisa continuar nos primeiros 1024 bytes: manter a política curta.
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  base: "/agentes/",
  plugins: [react(), contentSecurityPolicyMeta()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    headers: localSecurityHeaders,
  },
  preview: {
    host: "127.0.0.1",
    strictPort: true,
    headers: localSecurityHeaders,
  },
});
