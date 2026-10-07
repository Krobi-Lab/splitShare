import { ImageResponse } from "next/og";

import { iconArt } from "@/lib/ui/icon-art";

export const dynamic = "force-static";

/**
 * The maskable variant. Platforms crop a maskable icon to their own shape, so
 * the artwork is padded into the safe zone and left unrounded.
 */
export function GET() {
  return new ImageResponse(iconArt(512, { padding: 56 }), { width: 512, height: 512 });
}
