import { memo } from "react";

// A deterministic stipple illustration, not a survey or an image of arm locations.
// Keep the drawing stable while observation time and selection change.
type Point = { x: number; y: number; r: number; opacity: number };
function makeGalaxy(shape: "spiral" | "elliptical" | "irregular"): Point[] {
  let seed = 7419;
  const random = () =>
    ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const normal = () =>
    Math.sqrt(-2 * Math.log(Math.max(1e-8, random()))) *
    Math.cos(2 * Math.PI * random());
  const points: Point[] = [];
  const add = (x: number, y: number, opacity: number) => {
    if (Math.hypot(x, y) > 98) return;
    points.push({ x, y, r: 0.28 + random() * 0.47, opacity });
  };
  if (shape === "elliptical") {
    for (let i = 0; i < 2300; i++)
      add(normal() * 31, normal() * 27, 0.16 + random() * 0.45);
    return points;
  }
  if (shape === "irregular") {
    for (let i = 0; i < 1500; i++) {
      const cluster = i % 3;
      add(
        normal() * 19 + [-28, 24, 4][cluster],
        normal() * 17 + [-8, 4, 30][cluster],
        0.16 + random() * 0.4,
      );
    }
    return points;
  }
  for (let i = 0; i < 650; i++) {
    const r = Math.sqrt(random()) * 96,
      a = random() * Math.PI * 2;
    add(r * Math.cos(a), r * Math.sin(a), 0.06 + 0.2 * (1 - r / 100));
  }
  for (let arm = 0; arm < 4; arm++) {
    for (let i = 0; i < 430; i++) {
      const u = random(),
        radius = 12 + Math.pow(u, 0.8) * 80;
      const angle =
        (arm * Math.PI) / 2 +
        2.3 * Math.log(radius / 12) +
        normal() * (0.07 + u * 0.04);
      const r = radius + normal() * (1.1 + u * 2.4);
      add(
        r * Math.cos(angle),
        r * Math.sin(angle),
        0.12 + random() * 0.44 * (1 - u * 0.55),
      );
    }
  }
  for (let i = 0; i < 520; i++)
    add(normal() * 13, normal() * 7, 0.22 + random() * 0.45);
  return points;
}
const drawings = {
  spiral: makeGalaxy("spiral"),
  elliptical: makeGalaxy("elliptical"),
  irregular: makeGalaxy("irregular"),
};

const GalaxyDrawing = memo(function GalaxyDrawing({
  shape = "spiral",
}: {
  shape?: "spiral" | "elliptical" | "irregular";
}) {
  return (
    <g className="galaxy-stipple" aria-hidden="true">
      {drawings[shape].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} opacity={p.opacity} />
      ))}
    </g>
  );
});
export default GalaxyDrawing;
