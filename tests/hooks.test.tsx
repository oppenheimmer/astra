// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHorizonProfile } from "../src/useHorizonProfile";
import { useObservingClock } from "../src/useObservingClock";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Observing clock", () => {
  it("previews, shifts, plays back and returns to live time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T20:00:00Z"));
    const { result } = renderHook(() => useObservingClock());
    expect(result.current).toMatchObject({ live: true, running: true, rate: 1, time: Date.now() });
    const instant = Date.parse("2026-09-07T01:00:00Z");
    act(() => result.current.preview(instant));
    expect(result.current).toMatchObject({ time: instant, live: false, running: false });
    act(() => result.current.shift(3600000));
    expect(result.current.time).toBe(instant + 3600000);
    act(() => result.current.setSpeed(60));
    expect(result.current).toMatchObject({ rate: 60, running: true, live: false });
    act(() => result.current.pause());
    expect(result.current.running).toBe(false);
    act(() => result.current.play());
    expect(result.current).toMatchObject({ running: true, live: false });
    act(() => result.current.now());
    expect(result.current).toMatchObject({ time: Date.now(), live: true, running: true, rate: 1 });
  });
});

describe("Mountain skyline requests", () => {
  const site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };
  const profile = {
    lat: 46.948, lon: 7.4474, heightAboveGround: 1.5, groundElevation: 540, step: 0.25,
    altitudes: Array(1440).fill(2), rangeKm: 200, source: "test", approximate: true,
  };
  it("requests only while active, keys profiles by site, and offers a retry after failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => profile });
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(
      ({ site, active }) => useHorizonProfile(site, active),
      { initialProps: { site, active: false } },
    );
    expect(fetch).not.toHaveBeenCalled();
    rerender({ site, active: true });
    await waitFor(() => expect(result.current.profile).toEqual(profile));
    expect(fetch.mock.calls[0][0]).toBe("/api/horizon?lat=46.94800&lon=7.44740&height=1.5");

    fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: "Terrain is busy. Try again shortly." }) });
    const raised = { ...site, heightAboveGround: 20 };
    rerender({ site: raised, active: true });
    expect(result.current.profile).toBeNull();
    await waitFor(() => expect(result.current.message).toBe("Terrain is busy. Try again shortly."));
    expect(fetch.mock.calls[1][0]).toBe("/api/horizon?lat=46.94800&lon=7.44740&height=20.0");

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...profile, heightAboveGround: 20 }) });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.profile?.heightAboveGround).toBe(20));
    expect(result.current.message).toBe("");

    rerender({ site, active: false });
    expect(result.current.profile).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
