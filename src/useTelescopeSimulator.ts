import { useEffect, useRef, useState } from "react";
import { angularDistance } from "./projection";
import { advanceTelescope, stopTelescope } from "./simulator";
import { equatorialToHorizontal, horizontalToEquatorial } from "./sky";
import type { Site, Sky, Telescope } from "./types";

export const INITIAL_TELESCOPE: Telescope = {
  connected: false,
  ra: 0,
  dec: 0,
  targetRa: 0,
  targetDec: 0,
  targetId: null,
  moving: false,
  tracking: true,
  shape: "circle",
  width: 0.625,
  height: 0.625,
};
export type FieldPreset = "eyepiece" | "camera" | "wide";
/** Angular fields on a 2000 mm telescope: a 25 mm / 50° eyepiece, an 11.2 × 6.3 mm sensor, a wide demo. */
export const FIELD_PRESETS: Record<FieldPreset, Pick<Telescope, "shape" | "width" | "height">> = {
  eyepiece: { shape: "circle", width: 0.625, height: 0.625 },
  camera: { shape: "rectangle", width: 0.321, height: 0.181 },
  wide: { shape: "circle", width: 5, height: 5 },
};

interface Options {
  sky: Sky | null;
  date: Date;
  site: Site;
  /** Where the chart is looking; a fresh connection points the simulator there. */
  heading: { az: number; alt: number };
  notify: (message: string) => void;
}

/** A simulated GoTo mount. No hardware is connected or controlled. */
export function useTelescopeSimulator({ sky, date, site, heading, notify }: Options) {
  const [tel, setTel] = useState<Telescope>(INITIAL_TELESCOPE);
  const [aiming, setAiming] = useState(false);
  const skyRef = useRef(sky);
  skyRef.current = sky;
  useEffect(() => {
    if (!tel.connected) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = (now - last) / 1000;
      last = now;
      setTel((t) => (skyRef.current ? advanceTelescope(t, dt, skyRef.current) : t));
    }, 50);
    return () => clearInterval(timer);
  }, [tel.connected]);
  function stop() {
    setTel((t) => (sky ? stopTelescope(t, sky) : t));
    setAiming(false);
    notify("Simulator stopped.");
  }
  function slew(ra: number, dec: number, id: string | null = null) {
    if (!tel.connected) {
      notify("Connect the simulator first.");
      return;
    }
    if (id === "Sun") {
      notify("Solar slewing is disabled.");
      return;
    }
    if (equatorialToHorizontal(ra, dec, date, site).alt < 0) {
      notify("That target is below the horizon. Change the observing time to plan a slew.");
      return;
    }
    setTel((t) => ({ ...t, targetRa: ra, targetDec: dec, targetId: id, moving: true, tracking: true }));
    setAiming(false);
    notify("Simulated slew started · 2°/second.");
  }
  function connect() {
    if (tel.connected) {
      setTel((t) => ({ ...t, connected: false, moving: false, targetId: null }));
      setAiming(false);
      return;
    }
    const e = horizontalToEquatorial(heading.az, Math.max(15, heading.alt), date, site);
    setTel((t) => ({ ...t, connected: true, tracking: true, ...e, targetRa: e.ra, targetDec: e.dec }));
    notify("Simulator connected. No hardware is being controlled.");
  }
  function toggleMotors() {
    if (tel.tracking || tel.moving) stop();
    else setTel((t) => ({ ...t, tracking: true, moving: false, targetId: null, targetRa: t.ra, targetDec: t.dec }));
  }
  const applyPreset = (preset: FieldPreset) => setTel((t) => ({ ...t, ...FIELD_PRESETS[preset] }));
  const horizontal = tel.connected ? equatorialToHorizontal(tel.ra, tel.dec, date, site) : null;
  const remaining = tel.moving ? angularDistance(tel.ra, tel.dec, tel.targetRa, tel.targetDec) : 0;
  return { tel, setTel, aiming, setAiming, stop, slew, connect, toggleMotors, applyPreset, horizontal, remaining };
}
export type TelescopeSimulator = ReturnType<typeof useTelescopeSimulator>;
