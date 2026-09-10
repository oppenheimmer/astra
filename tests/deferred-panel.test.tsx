// @vitest-environment jsdom
import { lazy } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DeferredPanel from "../src/DeferredPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps the desk available if an optional panel download fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Panel = lazy(() => Promise.reject(new Error("chunk unavailable")));
  render(<><button>Sky controls</button><DeferredPanel label="Context diagram"><Panel /></DeferredPanel></>);
  expect(await screen.findByText(/Context diagram unavailable/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sky controls" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /RELOAD PAGE/ })).toBeTruthy();
});
