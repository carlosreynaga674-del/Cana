import { defineConfig } from "vite";

function standaloneRouter() {
  let adapted = false;
  return {
    name: "standalone-declarative-router",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!/\/node_modules\/react-router\/dist\/(?:development|production)\/chunk-[^/]+\.mjs$/.test(id.split("?")[0])) return null;
      const component = this.parse(code).body.find((node) => node.type === "FunctionDeclaration" && node.id?.name === "PrefetchPageLinks");
      if (!component) return null;
      const source = code.slice(component.start, component.end);
      if (adapted || !source.includes("useFrameworkContext()") || !source.includes("PrefetchPageLinksImpl"))
        this.error("React Router framework prefetch changed; review the standalone adapter.");
      adapted = true;
      // The offline catalog uses declarative routers, without framework route
      // manifests or module prefetch. Remove that unused component so its
      // optional runtime loader is tree-shaken; all import guards stay strict.
      return { code: code.slice(0, component.body.start) + "{ return null; }" + code.slice(component.body.end), map: null };
    },
    buildEnd(error) {
      if (!error && !adapted) this.error("React Router framework prefetch was not found; review the standalone adapter.");
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: mode === "standalone" ? [standaloneRouter()] : [],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
}));
