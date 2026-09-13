// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGroundElevation, type GroundElevation } from "../src/api";
import { STORAGE_KEYS } from "../src/preferences";
import { presets } from "../src/sites";
import { useLocationWorkflow } from "../src/useLocationWorkflow";

vi.mock("../src/api", () => ({ fetchGroundElevation: vi.fn() }));
const elevation = vi.mocked(fetchGroundElevation);
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
    expect(result.current.site.name).toBe("London");
    expect(savedSite().name).toBe("London");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("aborts geolocation elevation when a preset wins and ignores a late response", async () => {
    const pending = deferred<GroundElevation>();
    elevation.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => result.current.locate());
    act(() => { onPosition(position); });
    const signal = elevation.mock.calls[0][1]!;
    act(() => result.current.edit(presets[1]));
    act(() => result.current.apply());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ elevation: 1234, source: "test" }));
    expect(result.current.site).toMatchObject({ name: "London", elevation: 25 });
    expect(savedSite()).toMatchObject({ name: "London", elevation: 25 });
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

  it("cancels the active fetch on unmount", () => {
    elevation.mockReturnValueOnce(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useLocationWorkflow(vi.fn()));
    act(() => { void result.current.lookupElevation(); });
    const signal = elevation.mock.calls[0][1]!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
