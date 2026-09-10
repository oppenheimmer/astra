// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts } from "../src/useWorkspaceShortcuts";

afterEach(cleanup);
function setup() {
  const handlers = { zoom: vi.fn(), turn: vi.fn(), stop: vi.fn(), search: vi.fn(), escape: vi.fn() };
  function Workspace({ modalOpen }: { modalOpen: boolean }) {
    const workspace = useRef<HTMLDivElement>(null);
    useWorkspaceShortcuts({ workspace, modalOpen, ...handlers });
    return <>
      <div ref={workspace}>
        <div data-testid="canvas" tabIndex={0} />
        <button><span>Theme</span></button>
        <a href="#help">Help</a>
        <input aria-label="Name" />
        <div contentEditable suppressContentEditableWarning>Editable</div>
        <div role="button" tabIndex={0}>Custom</div>
      </div>
      <div data-testid="outside" />
    </>;
  }
  return { ...handlers, ...render(<Workspace modalOpen={false} />), Workspace };
}

describe("Workspace shortcuts", () => {
  it("preserves native interactive targets, editable descendants and handled events", () => {
    const { stop, search, zoom } = setup();
    for (const target of [screen.getByText("Theme"), screen.getByText("Help"), screen.getByLabelText("Name"), screen.getByText("Editable"), screen.getByText("Custom")]) {
      expect(fireEvent.keyDown(target, { key: " ", code: "Space" })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "/" })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "+" })).toBe(true);
    }
    const handled = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    handled.preventDefault();
    fireEvent(screen.getByTestId("canvas"), handled);
    fireEvent.keyDown(screen.getByTestId("canvas"), { key: "/", isComposing: true });
    fireEvent.keyDown(screen.getByTestId("canvas"), { key: "/", ctrlKey: true });
    expect(stop).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(zoom).not.toHaveBeenCalled();
  });

  it("runs workspace actions, including stop, while ignoring outside targets and modals", () => {
    const { stop, search, zoom, turn, escape, rerender, Workspace } = setup();
    const canvas = screen.getByTestId("canvas");
    expect(fireEvent.keyDown(canvas, { key: " ", code: "Space" })).toBe(false);
    fireEvent.keyDown(canvas, { key: "/" });
    fireEvent.keyDown(canvas, { key: "+" });
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(zoom).toHaveBeenCalledWith(0.6);
    expect(turn).toHaveBeenCalledWith(-15);
    expect(escape).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("outside"), { key: "/" });
    rerender(<Workspace modalOpen />);
    for (const key of [" ", "/", "+", "ArrowLeft", "Escape"]) expect(fireEvent.keyDown(canvas, { key })).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(escape).toHaveBeenCalledTimes(1);
  });
});
