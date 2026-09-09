import { Temporal } from "@js-temporal/polyfill";
import tzLookup from "@photostructure/tz-lookup";

export function timeZoneAt(lat: number, lon: number): string {
  try {
    return tzLookup(lat, lon);
  } catch {
    return "UTC";
  }
}
export const localDateTime = (epoch: number, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(epoch).toZonedDateTimeISO(zone);
export const localInput = (epoch: number, zone: string) =>
  localDateTime(epoch, zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
export function zoneLabel(epoch: number, zone: string): string {
  return (
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(epoch)
      .find((p) => p.type === "timeZoneName")?.value || zone
  );
}
export function parseLocalInput(
  value: string,
  zone: string,
  previous?: number,
): number {
  const plain = Temporal.PlainDateTime.from(value);
  if (plain.year < 1900 || plain.year > 2100)
    throw Error("Choose a date from 1900 to 2100.");
  const early = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
  const late = plain.toZonedDateTime(zone, { disambiguation: "later" });
  if (!early.toPlainDateTime().equals(plain))
    throw Error(
      "That local time is skipped by a daylight-saving change. Choose another time.",
    );
  // In a repeated hour, preserve the currently displayed offset when possible.
  if (
    previous !== undefined &&
    localDateTime(previous, zone).offset === late.offset
  )
    return late.epochMilliseconds;
  return early.epochMilliseconds;
}
export function localDay(epoch: number, zone: string) {
  const start = localDateTime(epoch, zone).startOfDay();
  const end = start.add({ days: 1 }).startOfDay();
  return {
    start: start.epochMilliseconds,
    minutes: (end.epochMilliseconds - start.epochMilliseconds) / 60000,
  };
}
