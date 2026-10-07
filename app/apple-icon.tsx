import { ImageResponse } from "next/og";

import { iconArt } from "@/lib/ui/icon-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon. Next emits the <link rel="apple-touch-icon"> for it. */
export default function AppleIcon() {
  return new ImageResponse(iconArt(180), size);
}
