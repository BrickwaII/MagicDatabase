import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Commander Tracker",
    short_name: "Commander",
    description: "Log your Commander pod's games and see who's really winning.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef1ec",
    theme_color: "#1d5c4c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [{ name: "Log a game", url: "/games/new" }],
  };
}
