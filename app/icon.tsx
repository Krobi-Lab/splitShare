import { ImageResponse } from "next/og";

import { iconArt } from "@/lib/ui/icon-art";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Replaces the create-next-app favicon, which was still the Next.js logo. */
export default function Icon() {
  return new ImageResponse(iconArt(32), size);
}
