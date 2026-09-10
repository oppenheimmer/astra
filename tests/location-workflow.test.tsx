// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGroundElevation, searchLocations, type GroundElevation } from "../src/api";
import { STORAGE_KEYS } from "../src/preferences";
import { presets } from "../src/sites";
import { useLocationWorkflow } from "../src/useLocationWorkflow";

vi.mock("../src/api", () => ({ fetchGroundElevation: vi.fn(), searchLocations: vi.fn() }));
const elevation = vi.mocked(fetchGroundElevation);
const search = vi.mocked(searchLocations);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const position = { coords: { latitude: 35, longitude: 139 } } as GeolocationPosition;
let onPosition: PositionCallback;
let onError: PositionErrorCallback | null | undefined;
const savedSite = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.site)!);
beforeEach(() => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback | null) => { onPosition = success; onError = error; } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Location workflow", () => {
  it("ignores a browser position delivered after a newer site was saved", async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => useLocationWorkflow(notify));
    act(() => result.current.locate());
    expect(result.current.busy).toBe(true);
    act(() => result.current.edit(presets[1]));
    act(() => result.current.apply());
    await act(async () => { onPosition(position); });
    expect(elevation).not.toHaveBeenCalled();
    expect(result.current.site.name).toBe("Bern");
    expect(savedSite().name).toBe("Bern");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("aborts geolocation elevation when a preset wins and ignores a late response", async () => {
    const pending = deferred<GroundElevation>();
    elevation.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => result.current.locate());
    act(() => { onPosition(position); });
    const signal = elevation.mock.calls[0][2]!;
    act(() => result.current.edit(presets[1]));
    act(() => result.current.apply());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ elevation: 1234, source: "test" }));
    expect(result.current.site).toMatchObject({ name: "Bern", elevation: 540 });
    expect(savedSite()).toMatchObject({ name: "Bern", elevation: 540 });
  });

  it("discards browser callbacks when the dialog closes and reopens", async () => {
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => result.current.locate());
    act(() => result.current.close());
    act(() => result.current.show());
    await act(async () => {
      onError?.({ code: 1 } as GeolocationPositionError);
      onPosition(position);
    });
    expect(result.current).toMatchObject({ open: true, message: "", busy: false });
    expect(elevation).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.site)).toBeNull();
  });

  it("blocks saving while manual elevation is pending, then saves the resolved value", async () => {
    const pending = deferred<GroundElevation>();
    elevation.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => result.current.show());
    act(() => { void result.current.lookupElevation(); });
    act(() => result.current.apply());
    expect(result.current).toMatchObject({ open: true, busy: true });
    expect(localStorage.getItem(STORAGE_KEYS.site)).toBeNull();
    await act(async () => pending.resolve({ elevation: 1234, source: "test" }));
    expect(result.current.busy).toBe(false);
    act(() => result.current.apply());
    expect(savedSite().elevation).toBe(1234);
  });

  it("keeps a manual elevation edit even if the original coordinates are selected again", async () => {
    const pending = deferred<GroundElevation>();
    elevation.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => { void result.current.lookupElevation(); });
    act(() => result.current.edit(presets[1]));
    act(() => result.current.edit({ ...presets[0], elevation: 88 }));
    await act(async () => pending.resolve({ elevation: 1234, source: "old lookup" }));
    expect(result.current.draft.elevation).toBe(88);
    expect(result.current.message).toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("rejects old address matches without clearing a newer request's busy state", async () => {
    const old = deferred<Awaited<ReturnType<typeof searchLocations>>>();
    const current = deferred<Awaited<ReturnType<typeof searchLocations>>>();
    const address = { name: "Bundesplatz 3 3011 Bern", lat: 46.948, lon: 7.447, easting: 2600000, northing: 1200000 };
    search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => result.current.changeQuery("Zurich"));
    act(() => { void result.current.search(); });
    const signal = search.mock.calls[0][1]!;
    act(() => result.current.changeQuery("Bern"));
    act(() => { void result.current.search(); });
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve([address]));
    expect(result.current.results).toEqual([]);
    expect(result.current.busy).toBe(true);
    await act(async () => current.resolve([address]));
    expect(result.current.results).toEqual([address]);
    expect(result.current.busy).toBe(false);

    const pending = deferred<GroundElevation>();
    elevation.mockReturnValueOnce(pending.promise);
    act(() => { void result.current.lookupElevation(address); });
    act(() => result.current.edit(presets[2]));
    await act(async () => pending.resolve({ elevation: 1234, source: "old address" }));
    expect(result.current.draft).toEqual(presets[2]);
    expect(result.current.message).toBe("");
  });

  it("cancels the active fetch on unmount", () => {
    elevation.mockReturnValueOnce(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => { void result.current.lookupElevation(); });
    const signal = elevation.mock.calls[0][2]!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
