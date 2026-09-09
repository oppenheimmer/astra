import { describe, expect, it } from "vitest";
import {
  localDay,
  localInput,
  parseLocalInput,
  timeZoneAt,
} from "../src/local-time";
import { horizonAltitude, validTerrain } from "../src/terrain";
import type { TerrainProfile } from "../src/types";

describe("Observing-location local time", () => {
  it("looks up the observing zone independently of the computer's zone", () => {
    expect(timeZoneAt(46.948, 7.4474)).toBe("Europe/Zurich");
    expect(timeZoneAt(40.7128, -74.006)).toBe("America/New_York");
    expect(timeZoneAt(35.6762, 139.6503)).toBe("Asia/Tokyo");
    const instant = Date.parse("2026-09-06T12:00:00Z");
    expect(localInput(instant, "Europe/Zurich")).toBe("2026-09-06T14:00");
    expect(localInput(instant, "America/New_York")).toBe("2026-09-06T08:00");
  });
  it("round-trips across calendar boundaries and non-whole-hour zones", () => {
    for (const zone of [
      "Europe/Zurich",
      "America/New_York",
      "Asia/Kolkata",
      "Pacific/Auckland",
    ])
      for (const utc of ["2026-01-01T00:10Z", "2026-06-21T23:59Z"])
        expect(parseLocalInput(localInput(Date.parse(utc), zone), zone)).toBe(
          Date.parse(utc),
        );
  });
  it("rejects nonexistent spring-clock times and preserves either occurrence of autumn's repeated hour", () => {
    expect(() => parseLocalInput("2026-03-29T02:30", "Europe/Zurich")).toThrow(
      /skipped/,
    );
    for (const utc of ["2026-10-25T00:30Z", "2026-10-25T01:30Z"])
      expect(
        parseLocalInput("2026-10-25T02:30", "Europe/Zurich", Date.parse(utc)),
      ).toBe(Date.parse(utc));
  });
  it("lets the day slider traverse every real minute of 23-hour and 25-hour days", () => {
    for (const [utc, minutes] of [
      ["2026-03-29T12:00Z", 1380],
      ["2026-10-25T12:00Z", 1500],
    ] as const) {
      const day = localDay(Date.parse(utc), "Europe/Zurich");
      expect(day.minutes).toBe(minutes);
      expect(localInput(day.start, "Europe/Zurich").slice(11)).toBe("00:00");
      expect(
        localInput(
          day.start + (day.minutes - 1) * 60000,
          "Europe/Zurich",
        ).slice(11),
      ).toBe("23:59");
    }
  });
});

describe("Terrain mask", () => {
  const profile = {
    lat: 46.9,
    lon: 7.4,
    heightAboveGround: 1.5,
    altitudes: Array.from({ length: 360 }, (_, az) =>
      az === 0 ? 10 : az === 359 ? 8 : 2,
    ),
  } as TerrainProfile;
  it("interpolates continuously through north and wraps headings in either direction", () => {
    expect(horizonAltitude(profile, 359.5)).toBe(9);
    expect(horizonAltitude(profile, -0.5)).toBe(9);
    expect(horizonAltitude(profile, 720)).toBe(10);
    expect(horizonAltitude(profile, 90)).toBe(2);
  });
  it("rejects incomplete or corrupt profiles instead of drawing invented terrain", () => {
    expect(validTerrain(profile)).toBe(true);
    expect(validTerrain({ ...profile, altitudes: [5, 9] })).toBe(false);
    expect(
      validTerrain({ ...profile, altitudes: [...profile.altitudes, NaN] }),
    ).toBe(false);
    expect(
      validTerrain({ ...profile, altitudes: [...profile.altitudes, 95] }),
    ).toBe(false);
  });
});
