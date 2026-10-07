import type { MetadataRoute } from "next";

/**
 * The web app manifest, which is what makes SplitHome installable.
 *
 * `display: standalone` so it opens without browser chrome, and `start_url`
 * points at the household list rather than the marketing page — somebody who
 * installed this already knows what it is.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SplitHome — household expenses",
    short_name: "SplitHome",
    description: "Share household expenses without the spreadsheet.",
    start_url: "/households",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      // A maskable icon is drawn edge to edge and cropped to the platform's
      // shape, so it needs its own padded artwork rather than reusing the above.
      {
        src: "/icon-maskable-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Add an expense",
        short_name: "Add expense",
        url: "/households?action=new-expense",
      },
      { name: "Balances", short_name: "Balances", url: "/households" },
    ],
  };
}
