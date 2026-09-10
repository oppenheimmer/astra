import { useEffect, type RefObject } from "react";

const INTERACTIVE = 'button,a[href],input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="textbox"],[role="slider"],[role="combobox"],[role="menuitem"]';

/** Workspace shortcuts yield to native controls, handled events, composition and modal dialogs. */
export function useWorkspaceShortcuts({ workspace, modalOpen, zoom, turn, stop, search, escape }: {
  workspace: RefObject<HTMLElement | null>;
  modalOpen: boolean;
  zoom: (factor: number) => void;
  turn?: (degrees: number) => void;
  stop: () => void;
  search: () => void;
  escape: () => void;
}) {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (modalOpen || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest(INTERACTIVE)) return;
        if (target !== document.body && !workspace.current?.contains(target)) return;
      }
      if (event.key === "Escape") escape();
      else if (event.key === "+" || event.key === "=") zoom(0.6);
      else if (event.key === "-") zoom(1.6);
      else if (turn && (event.key === "ArrowLeft" || event.key === "ArrowRight")) turn(event.key === "ArrowLeft" ? -15 : 15);
      else if (event.code === "Space" || event.key === " ") stop();
      else if (event.key === "/") search();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [workspace, modalOpen, zoom, turn, stop, search, escape]);
}
