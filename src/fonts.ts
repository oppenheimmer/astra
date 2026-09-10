/** Local font stacks only: unavailable faces fall back to a system monospace. */
export const MONOSPACE_FONTS = [
  { id: "departure", label: "Departure Mono", family: 'Departure, "Courier New", monospace' },
  { id: "system", label: "System monospace", family: "ui-monospace, monospace" },
  { id: "consolas", label: "Consolas", family: 'Consolas, "Liberation Mono", monospace' },
  { id: "menlo", label: "Menlo", family: 'Menlo, "DejaVu Sans Mono", monospace' },
  { id: "dejavu", label: "DejaVu Sans Mono", family: '"DejaVu Sans Mono", monospace' },
  { id: "courier", label: "Courier New", family: '"Courier New", "Liberation Mono", monospace' },
] as const;

export type MonospaceFont = (typeof MONOSPACE_FONTS)[number]["id"];
export const DEFAULT_FONT: MonospaceFont = "departure";
export const isMonospaceFont = (value: unknown): value is MonospaceFont =>
  MONOSPACE_FONTS.some((font) => font.id === value);
export const monospaceFamily = (id: MonospaceFont): string =>
  MONOSPACE_FONTS.find((font) => font.id === id)!.family;
