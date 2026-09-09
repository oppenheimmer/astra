// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { STORAGE_KEYS } from "../src/preferences";
import { SATELLITE_DATA_URL } from "../src/api";

vi.setConfig({ testTimeout: 30000 });

// jsdom rewrites import.meta.url, so fixtures are addressed from the repository root.
const load = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "public/data", name), "utf8"));
// Starlink is left out so the UI-thread SGP4 fallback stays quick; the visual group still loads.
const bundled: Record<string, unknown> = Object.fromEntries(
  ["stars.json", "messier.json", "constellations.lines.json", "constellations.json", "satellites.json", "satellite-catalogue.json"]
    .map((name) => [name, load(name)]),
);
const respond = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const OFFLINE = "Service unavailable in this test.";

/** The merged payload the scheduled refresh publishes, assembled from the same bundled groups. */
const published = () => {
  const visual = bundled["satellites.json"] as { fetchedAt: string; elements: Record<string, unknown>[] };
  return {
    fetchedAt: visual.fetchedAt,
    source: "CelesTrak visual groups",
    elements: visual.elements,
    catalogue: bundled["satellite-catalogue.json"],
    groups: { visual: visual.fetchedAt },
    cached: false,
  };
};

/**
 * Static catalogue files load. The published snapshot loads unless a test turns
 * it off, and the origin's API is always unreachable, so the fallback path is
 * exercised the moment `offline.snapshot` is cleared.
 */
const offline = { snapshot: true };
function offlineFetch(url: string) {
  if (url === SATELLITE_DATA_URL)
    return Promise.resolve(offline.snapshot ? respond(200, published()) : respond(503, { detail: OFFLINE }));
  const file = url.match(/^\/data\/(.+)$/)?.[1];
  if (file) return Promise.resolve(file in bundled ? respond(200, bundled[file]) : respond(404, { detail: "Not found" }));
  return Promise.resolve(respond(503, { detail: OFFLINE }));
}

const noop = () => {};
class ResizeObserverStub { observe = noop; unobserve = noop; disconnect = noop; }
class Path2DStub { addPath = noop; arc = noop; rect = noop; moveTo = noop; lineTo = noop; closePath = noop; }
beforeAll(() => {
  window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) as unknown as MediaQueryList;
  // A permissive 2D context: drawing calls are no-ops, measurements return fixed values, properties stick.
  const context = () =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) =>
        key in target ? target[key]
          : key === "measureText" ? () => ({ width: 8 })
          : key === "isPointInPath" ? () => false
          : key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop: noop })
          : noop,
      set: (target, key, value) => ((target[key] = value), true),
    });
  HTMLCanvasElement.prototype.getContext = (() => context()) as typeof HTMLCanvasElement.prototype.getContext;
});
/** Node's own experimental localStorage global shadows jsdom's, so tests use a plain in-memory store. */
class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-05T21:00:00Z"));
  offline.snapshot = true;
  vi.stubGlobal("fetch", vi.fn(offlineFetch));
  vi.stubGlobal("localStorage", new MemoryStorage());
  // Stubs are cleared after every test, so browser-only observers are re-registered here.
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("Path2D", Path2DStub);
  document.documentElement.dataset.theme = "light";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
/** Render and wait for the catalogue to load and the opening selection (a bright named star) to appear. */
async function mount() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText("Mapping the stars…")).toBeNull(), { timeout: 20000 });
  await waitFor(() => expect(heading()).toBeTruthy());
}

describe("Starmap desk", () => {
  it("mounts from the bundled catalogue with the preview site and a bright star selected", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("STARMAP");
    expect(screen.getByText("OBSERVER / PREVIEW LOCATION")).toBeTruthy();
    expect(screen.getByText("Set your location to see your own sky.")).toBeTruthy();
    expect(heading()).toBeTruthy();
    expect(screen.getByText("↑ ABOVE HORIZON")).toBeTruthy();
    expect(document.querySelectorAll("canvas").length).toBeGreaterThan(0);
    expect(screen.getByText("LIVE SKY")).toBeTruthy();
    expect(screen.getByLabelText("Observing date and time in Europe/London")).toBeTruthy();
  });

  it("finds stars and planets by name and centres them", async () => {
    await mount();
    const search = screen.getByLabelText("Search sky objects");
    fireEvent.change(search, { target: { value: "Vega" } });
    await screen.findByRole("button", { name: /Vega/ });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(heading()).toBe("Vega"));
    expect(screen.getByText(/HIP 91262/)).toBeTruthy();
    fireEvent.change(search, { target: { value: "Jupiter" } });
    fireEvent.click(await screen.findByRole("button", { name: /Jupiter/ }));
    await waitFor(() => expect(heading()).toBe("Jupiter"));
    expect(screen.getByText("RADIUS / APPROX.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(await screen.findByText("No match in this catalogue.")).toBeTruthy();
  });

  it("switches projections, zooms, reports terrain failures and toggles the theme", async () => {
    await mount();
    expect(screen.getByText("FIELD 110°")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("FIELD 66°")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OBSERVER VIEW" }));
    expect(screen.getByText(/^FACING/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn right 15 degrees" }));
    expect(screen.getByRole("group", { name: "Direction you are facing" })).toBeTruthy();
    await screen.findByRole("button", { name: "RETRY" });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/horizon?lat=51.47790&lon=-0.00150&height=1.5", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "MOUNTAINS ON" }));
    expect(screen.queryByText(OFFLINE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ALL SKY" }));
    expect(screen.getByText("FIELD 180°")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("dark");
  });

  it("applies a preset location, saves it, and follows its time zone", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /EDIT/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Choose a location"), { target: { value: "1" } });
    expect((within(dialog).getByLabelText("Latitude") as HTMLInputElement).value).toBe("46.948");
    fireEvent.click(within(dialog).getByRole("button", { name: /UPDATE SKY/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Sky updated for Bern.")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.site)!)).toMatchObject({ name: "Bern", lat: 46.948, preview: false });
    expect(screen.getByText("OBSERVER / EARTH")).toBeTruthy();
    expect(screen.getByLabelText("Observing date and time in Europe/Zurich")).toBeTruthy();
  });

  it("explains when the browser cannot locate the observer", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /LOCATE ME/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Location is unavailable. Enter coordinates below.")).toBeTruthy();
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("opens the about dialog with the orbital-data timestamp and closes on Escape", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /ABOUT/ }));
    const dialog = screen.getByRole("dialog");
    const fetchedAt = published().fetchedAt.slice(0, 19).replace("T", " ");
    await waitFor(() => expect(within(dialog).getByText(/Last orbital-data fetch/).textContent).toContain(fetchedAt));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("drives the simulated telescope from the panel and the keyboard", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "TELESCOPE" }));
    expect(screen.getByText("SIMULATOR READY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /CONNECT SIMULATOR/ }));
    expect(screen.getByText("SIMULATING TRACKING")).toBeTruthy();
    expect(screen.getByText("Simulator connected. No hardware is being controlled.")).toBeTruthy();
    const slew = screen.getByRole("button", { name: /SLEW TO OBJECT/ }) as HTMLButtonElement;
    expect(slew.disabled).toBe(false);
    fireEvent.click(slew);
    expect(screen.getByText("Simulated slew started · 2°/second.")).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(screen.getByText("Simulator stopped.")).toBeTruthy();
    expect(screen.getByText("SIMULATOR STOPPED")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Field of view preset"), { target: { value: "camera" } });
    expect((screen.getByLabelText("Field width in degrees") as HTMLInputElement).value).toBe("0.321");
    fireEvent.click(screen.getByRole("button", { name: /DISCONNECT SIMULATOR/ }));
    expect(screen.getByText("SIMULATOR READY")).toBeTruthy();
  });

  it("requests the Gaia layer past magnitude 7.5 and offers a retry when it fails", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Faintest displayed star magnitude"), { target: { value: "8.5" } });
    expect(localStorage.getItem(STORAGE_KEYS.starMagnitude)).toBe("8.5");
    const retry = await screen.findByRole("button", { name: /RETRY OVERVIEW/ });
    expect(retry.closest(".deep-star-status")!.textContent).toContain(OFFLINE);
    expect(fetch).toHaveBeenCalledWith("/api/stars/overview?v=1", undefined);
  });
});
