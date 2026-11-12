/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "cards.scryfall.io" }] },
  // Loaded at runtime from node_modules instead of bundled (PGlite ships WASM files; ws has native extras).
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
};
export default nextConfig;
