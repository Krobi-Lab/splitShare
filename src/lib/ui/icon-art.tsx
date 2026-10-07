import type { ReactElement } from "react";

/**
 * The app icon's artwork, as a single source of truth for every size.
 *
 * Drawn with ImageResponse (Satori) rather than checked in as PNGs: the icons
 * are then generated at build time from code, so there are no binary assets to
 * keep in step with each other, and no image toolchain in the dependency tree.
 *
 * Satori supports a subset of CSS — flexbox, backgrounds, borders, border-radius
 * — so the mark is built from shapes rather than text or an SVG path, which
 * keeps it font-free.
 *
 * The mark is two overlapping circles: one expense, split between two people.
 */
export function iconArt(size: number, options?: { padding?: number }): ReactElement {
  // A maskable icon is cropped to the platform's shape, so its artwork has to
  // sit inside the "safe zone" — roughly the middle 80%.
  const padding = options?.padding ?? 0;
  const inner = size - padding * 2;
  const circle = inner * 0.52;
  const overlap = circle * 0.3;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        // Only round the plain icon; a maskable one is clipped by the platform.
        borderRadius: padding > 0 ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: inner / 2 - circle + overlap / 2,
            width: circle,
            height: circle,
            borderRadius: circle,
            background: "#34d399",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: inner / 2 - overlap / 2,
            width: circle,
            height: circle,
            borderRadius: circle,
            background: "#60a5fa",
            // Satori has no blend modes, so the overlap is suggested with
            // transparency instead.
            opacity: 0.85,
          }}
        />
      </div>
    </div>
  );
}
