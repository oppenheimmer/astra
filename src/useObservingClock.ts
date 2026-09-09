import { useEffect, useState } from "react";

/**
 * The observing time. Live mode follows the wall clock; playback advances at a
 * multiple of real time; a preview holds a chosen instant still. Sky positions
 * target ten updates per second while running.
 */
export function useObservingClock() {
  const [time, setTime] = useState(Date.now()),
    [running, setRunning] = useState(true),
    [live, setLive] = useState(true),
    [rate, setRate] = useState(1);
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = now - last;
      last = now;
      setTime((t) => (live ? Date.now() : Math.round(t + dt * rate)));
    }, 100);
    return () => clearInterval(timer);
  }, [running, live, rate]);
  const hold = () => {
    setLive(false);
    setRunning(false);
  };
  return {
    time,
    running,
    live,
    rate,
    /** Freeze the clock at an instant. */
    preview(instant: number) {
      setTime(instant);
      hold();
    },
    shift(ms: number) {
      hold();
      setTime((t) => t + ms);
    },
    pause: hold,
    play() {
      setRunning(true);
    },
    setSpeed(multiplier: number) {
      setRate(multiplier);
      setLive(false);
      setRunning(true);
    },
    now() {
      setTime(Date.now());
      setLive(true);
      setRunning(true);
      setRate(1);
    },
  };
}
export type ObservingClock = ReturnType<typeof useObservingClock>;
