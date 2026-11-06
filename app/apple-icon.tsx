import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const dot = (left: number, top: number, color: string, d = 30) => (
  <div style={{ position: "absolute", left: left - d / 2, top: top - d / 2, width: d, height: d, borderRadius: d, background: color }} />
);

/** Home-screen icon: a round table with four seats, the top one the winner. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "#1d5c4c", display: "flex", position: "relative" }}>
        {dot(90, 90, "#eef1ec", 72)}
        {dot(90, 32, "#e2b44e")}
        {dot(148, 90, "#b9cfc6")}
        {dot(90, 148, "#b9cfc6")}
        {dot(32, 90, "#b9cfc6")}
      </div>
    ),
    size,
  );
}
