import { useEffect, useLayoutEffect, useState } from "react";
import { monospaceFamily, type MonospaceFont } from "./fonts";
import { readMonospaceFont, saveMonospaceFont } from "./preferences";

export function useMonospaceFont() {
  const [font, setFont] = useState<MonospaceFont>(readMonospaceFont);
  const [fontRevision, setFontRevision] = useState(0);
  const fontFamily = monospaceFamily(font);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--font-mono", fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    saveMonospaceFont(font);
    // Canvas labels need fresh measurements when the bundled face finishes
    // loading, including when observation time is paused.
    let active = true;
    document.fonts?.load(`11px ${fontFamily}`).then(
      () => { if (active) setFontRevision((revision) => revision + 1); },
      () => { /* The selected stack's fallback remains usable if loading fails. */ },
    );
    return () => { active = false; };
  }, [font, fontFamily]);

  return { font, setFont, fontFamily, fontRevision };
}
