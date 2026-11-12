// Numbers into words: durations, dates, distances, and what happened on Earth
// while you were away. Pure functions, so the end card can be tested.

import { AU, C, DAY_S, JULIAN_YEAR_S, SYNODIC_MONTH_D } from "./constants";
import type { Hole } from "./holes";
import type { Result } from "./run";

const nf = (n: number, digits = 0) =>
  n.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** A duration in the two largest units that matter: "2 y 41 d", "3 h 12 min", "0.31 s", "212 μs". */
export function duration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 1e-6) return `${nf(s * 1e9)} ns`;
  if (s < 1e-3) return `${nf(s * 1e6, s < 1e-5 ? 1 : 0)} μs`;
  if (s < 1) return `${nf(s * 1e3, s < 0.01 ? 2 : s < 0.1 ? 1 : 0)} ms`;
  if (s < 60) return `${nf(s, s < 10 ? 2 : 1)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
  if (s < DAY_S) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s < JULIAN_YEAR_S) return `${Math.floor(s / DAY_S)} d ${Math.floor((s % DAY_S) / 3600)} h`;
  const y = Math.floor(s / JULIAN_YEAR_S);
  return `${nf(y)} y ${Math.floor((s - y * JULIAN_YEAR_S) / DAY_S)} d`;
}

/** A length in sensible units. */
export function distance(metres: number): string {
  const m = Math.abs(metres);
  if (m < 1e3) return `${nf(m)} m`;
  if (m < 1e7) return `${nf(m / 1e3, m < 1e5 ? 1 : 0)} km`;
  if (m < 1e10) return `${nf(m / 1e6, m < 1e8 ? 1 : 0)} thousand km`;
  if (m < 1e13) return `${nf(m / 1e9, m < 1e11 ? 1 : 0)} million km`;
  if (m < 0.1 * C * JULIAN_YEAR_S) return `${nf(m / AU, m < 100 * AU ? 1 : 0)} au`;
  return `${nf(m / (C * JULIAN_YEAR_S), 2)} light years`;
}

export function kilometres(metres: number): string {
  const km = metres / 1e3;
  if (km < 1e4) return `${nf(km, km < 100 ? 1 : 0)} km`;
  if (km < 1e7) return `${nf(km / 1e3, km < 1e5 ? 1 : 0)} thousand km`;
  if (km < 1e10) return `${nf(km / 1e6, km < 1e8 ? 1 : 0)} million km`;
  return `${nf(km / 1e9, km < 1e11 ? 1 : 0)} billion km`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ClockStyle = "calendar" | "day" | "fast";

/** How a hole's clocks read: M87* moves the calendar, Sagittarius A* the hour, Cygnus X-1 the millisecond. */
export function clockStyle(rsOverC: number): ClockStyle {
  if (rsOverC > 3600) return "calendar";
  if (rsOverC > 0.5) return "day";
  return "fast";
}

/** One clock face, in the visitor's own time zone: a date line and a time line. `ms` is a timestamp, fractional. */
export function clockFace(ms: number, style: ClockStyle): { date: string; time: string } {
  const d = new Date(Math.floor(ms));
  const p2 = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const hms = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  if (style === "fast") {
    const frac = ms - Math.floor(ms / 1000) * 1000;
    return { date, time: `${hms}.${frac.toFixed(2).padStart(6, "0")}` };
  }
  return { date, time: style === "calendar" ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : hms };
}

export function calendarDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Speed of Earth along its orbit, m/s, from the au and the year. */
export const EARTH_ORBIT_SPEED = (2 * Math.PI * AU) / JULIAN_YEAR_S;

const plural = (n: number, one: string, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;

/** What happened at home in the time you did not live through. One or two computed lines. */
export function missed(stolenS: number): string[] {
  const s = stolenS;
  if (s <= 0) return [];
  if (s < 1) {
    return [`In the time you skipped, light crossed ${kilometres(s * C)}.`];
  }
  if (s < 3600) {
    return [`Earth moved ${kilometres(s * EARTH_ORBIT_SPEED)} along its orbit without you.`];
  }
  if (s < 2 * DAY_S) {
    return [
      `Earth moved ${kilometres(s * EARTH_ORBIT_SPEED)} along its orbit without you.`,
      `That is ${nf((s / DAY_S) * 360, 0)}° of a turn you never saw.`,
    ];
  }
  const days = Math.floor(s / DAY_S);
  const moons = Math.floor(s / (SYNODIC_MONTH_D * DAY_S));
  if (s < JULIAN_YEAR_S) {
    const a = `You missed ${plural(days, "sunrise")}${moons > 0 ? ` and ${plural(moons, "full moon")}` : ""}.`;
    return [a];
  }
  const years = Math.floor(s / JULIAN_YEAR_S);
  return [
    `You missed ${plural(years, "birthday")} of everyone you know, and ${plural(moons, "full moon")}.`,
    `Earth went round the Sun ${years === 1 ? "once" : `${nf(years)} times`} without you.`,
  ];
}

/** The lines of the end card, by outcome. */
export function ending(result: Result, hole: Hole, departMs: number): { title: string; lines: string[] } {
  const back = calendarDate(departMs + result.earthS * 1000);
  switch (result.phase) {
    case "home":
      return {
        title: "Home",
        lines: [
          `Gone ${duration(result.shipS)} by your clock. On Earth, ${duration(result.earthS)} went by.`,
          ...missed(result.stolenS),
        ],
      };
    case "horizon":
      return {
        title: "Past the horizon",
        lines: [
          `From the station: your ship slowed, reddened and faded just above the horizon, and was never seen to cross.`,
          `For you: nothing marked the crossing. ${duration(result.fallS)} later, by your clock, the centre.`,
        ],
      };
    case "torn":
      return {
        title: "Pulled apart",
        lines: [
          `${hole.name} is small, so its pull changes steeply from nose to tail. At ${nf(result.minR, 1)} radii the stretch passed what the hull can take.`,
          `Around a giant like Sagittarius A* the same stretch never arrives outside the horizon.`,
        ],
      };
    case "adrift":
      return {
        title: "Adrift",
        lines: [
          result.minR < 11
            ? `The air ran out before you climbed back to the station.`
            : `Too far from the station to be fetched.`,
          `On Earth it is ${back}.`,
        ],
      };
    default:
      return { title: "", lines: [] };
  }
}

/** Plain text for sharing. */
export function shareText(result: Result, hole: Hole, url: string): string {
  const head = `Event Horizon · ${hole.name}`;
  if (result.phase === "home") {
    return [
      head,
      `Gone ${duration(result.shipS)} by my clock. ${duration(result.earthS)} passed on Earth.`,
      `I stole ${duration(result.stolenS)}. Lowest pass: ${nf(result.minR, 2)} radii, clocks at ×${nf(result.maxDilation, 2)}.`,
      url,
    ].join("\n");
  }
  const how = result.phase === "horizon" ? "I crossed the horizon" : result.phase === "torn" ? "The tides pulled my ship apart" : "I ran out of air";
  return [head, `${how} at ${nf(result.minR, 2)} radii, clocks at ×${nf(result.maxDilation, 2)}.`, url].join("\n");
}

export { nf };
