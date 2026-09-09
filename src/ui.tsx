import type { ReactNode } from "react";
import type { SkyObject } from "./types";

export const pad = (n: number) => String(n).padStart(2, "0");

export const kindLabel = (o: SkyObject) =>
  o.kind === "planet" ? o.subtitle : o.kind === "star" ? "STAR" : o.kind.toUpperCase();

export const signature = (kind: string, body?: string) =>
  body === "Sun" || body === "Moon" ? (
    "●"
  ) : kind === "star" ? (
    "·"
  ) : kind === "planet" ? (
    "⊙"
  ) : kind === "satellite" ? (
    "[·]"
  ) : kind === "galaxy" ? (
    <span className="galaxy-symbol" aria-label="Galaxy" />
  ) : (
    "◇"
  );

export const layerLabels = {
  star: "Stars",
  planet: "Planets",
  galaxy: "Deep sky",
  satellite: "Satellites",
  constellation: "Constellations",
  highlights: "Highlights",
  grid: "Grid",
} as const;
export type LayerKey = keyof typeof layerLabels;

export function LayerSymbol({ kind }: { kind: LayerKey }) {
  if (kind === "constellation")
    return <svg viewBox="0 0 20 20"><path d="M3 14L9 5l8 7"/><circle cx="3" cy="14" r="1.5"/><circle cx="9" cy="5" r="1.5"/><circle cx="17" cy="12" r="1.5"/></svg>;
  if (kind === "highlights")
    return <svg viewBox="0 0 20 20"><path d="M10 2l2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2Z"/></svg>;
  if (kind === "grid")
    return <svg viewBox="0 0 20 20"><path d="M6 2v16M14 2v16M2 6h16M2 14h16"/></svg>;
  return signature(kind);
}

export function SectionTitle({ n, children, aside }: { n: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <span>
        {n} / {children}
      </span>
      {aside}
    </div>
  );
}
