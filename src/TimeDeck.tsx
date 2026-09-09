import type { localDateTime, localDay } from "./local-time";
import { localInput, parseLocalInput } from "./local-time";
import { pad } from "./ui";
import type { ObservingClock } from "./useObservingClock";

interface Props {
  clock: ObservingClock;
  timeZone: string;
  zoneLabel: string;
  localDate: ReturnType<typeof localDateTime>;
  day: ReturnType<typeof localDay>;
  siteName: string;
  notify: (message: string) => void;
}

/** The footer: live/preview status, hour steps, local date-time entry, day slider and playback speed. */
export default function TimeDeck({ clock, timeZone, zoneLabel, localDate, day, siteName, notify }: Props) {
  const { time, running, live, rate } = clock;
  return (
    <footer className="time-deck">
      <div className="time-status">
        <span className={`live-light ${running ? "pulse" : ""}`}>●</span>
        <span>{live && running ? "LIVE SKY" : running ? `TIME ×${rate}` : "TIME PREVIEW"}</span>
      </div>
      <div className="time-buttons">
        <button aria-label="One hour earlier" onClick={() => clock.shift(-3600000)}>
          −1H
        </button>
        <button aria-label={running ? "Pause time" : "Play time"} onClick={() => (running ? clock.pause() : clock.play())}>
          {running ? "Ⅱ" : "▷"}
        </button>
        <button aria-label="One hour later" onClick={() => clock.shift(3600000)}>
          +1H
        </button>
      </div>
      <label className="datetime-label">
        <span title={timeZone}>{zoneLabel}</span>
        <input
          aria-label={`Observing date and time in ${timeZone}`}
          title={`Local time at ${siteName} · ${timeZone}`}
          type="datetime-local"
          min="1900-01-01T00:00"
          max="2100-12-31T23:59"
          value={localInput(time, timeZone)}
          onChange={(e) => {
            if (!e.target.value) return;
            try {
              clock.preview(parseLocalInput(e.target.value, timeZone, time));
            } catch (error) {
              notify(error instanceof Error ? error.message : "Invalid local time.");
            }
          }}
        />
      </label>
      <input
        className="day-slider"
        aria-label={`Time of day in ${timeZone}`}
        aria-valuetext={`${pad(localDate.hour)}:${pad(localDate.minute)} ${zoneLabel}`}
        type="range"
        min="0"
        max={day.minutes - 1}
        value={Math.floor((time - day.start) / 60000)}
        onChange={(e) => clock.preview(day.start + +e.target.value * 60000)}
      />
      <select aria-label="Time playback speed" value={rate} onChange={(e) => clock.setSpeed(+e.target.value)}>
        <option value="1">×1</option>
        <option value="60">×60</option>
        <option value="600">×600</option>
      </select>
      <button className="now-button" onClick={clock.now}>
        ↺ NOW
      </button>
    </footer>
  );
}
