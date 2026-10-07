import { ImageResponse } from "next/og";

import { iconArt } from "@/lib/ui/icon-art";

/**
 * Referenced by app/manifest.ts at a fixed path. Next's own icon conventions
 * emit content-hashed URLs, which a manifest cannot name, so the manifest
 * icons are plain route handlers instead.
 */
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(iconArt(192), { width: 192, height: 192 });
}
