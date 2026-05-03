import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // When served through a devtunnel / reverse proxy, set VITE_HMR_HOST to the
  // public hostname (e.g. fjxmjtg3-8081.uks1.devtunnels.ms) so Vite's HMR
  // WebSocket connects via the tunnel instead of trying to reach localhost
  // directly (which the remote browser can't reach).
  const hmrHost = env.VITE_HMR_HOST;

  return {
    server: {
      host: "::",
      port: 8081,
      hmr: hmrHost
        ? { protocol: "wss", host: hmrHost, clientPort: 443, overlay: false }
        : { overlay: false },
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
        "/static": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
        "/media": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
