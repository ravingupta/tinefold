import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Where the app is served. Override with VITE_SITE_URL for another host. */
const DEFAULT_SITE_URL = "https://tinefold.ravingupta.me/";

/**
 * SEO: fills the absolute site URL into index.html (canonical, Open Graph, JSON-LD) and emits
 * robots.txt and sitemap.xml. The app routes with the URL hash, so the root is the only page.
 */
function seo(siteUrl: string): Plugin {
  const url = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return {
    name: "tinefold-seo",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", url),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${url}sitemap.xml\n` });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${url}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss(), seo(env.VITE_SITE_URL || process.env.VITE_SITE_URL || DEFAULT_SITE_URL)],
    base: "./",
    test: {
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"],
    },
  } as any;
});
