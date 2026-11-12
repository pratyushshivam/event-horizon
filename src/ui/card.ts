// The end of a run: the card on the page, the share text, and the image card.

import type { Hole } from "../engine/holes";
import type { Result } from "../engine/run";
import { calendarDate, duration, ending, nf, shareText } from "../engine/words";

export const LIVE_URL = "https://pratyushshivam.github.io/event-horizon/";

export interface CardInput {
  result: Result;
  hole: Hole;
  departMs: number;
  best: { stolenS: number; ratio: number } | undefined;
  isBest: boolean;
  breakup: number;
  canvas: HTMLCanvasElement;
  /** Draw a fresh frame so the canvas can be copied in the same task. */
  redraw: () => void;
  onAgain: () => void;
}

const $ = (id: string) => document.getElementById(id)!;

function cell(label: string, value: string, sub: string, cls = ""): string {
  return `<div class="${cls}"><span class="label">${label}</span><b>${value}</b><span>${sub}</span></div>`;
}

export function showCard(input: CardInput): void {
  const { result, hole, departMs, best, isBest } = input;
  const text = ending(result, hole, departMs);
  const earthDate = calendarDate(departMs + result.earthS * 1000);
  $("card-kicker").textContent = hole.name;
  $("card-title").textContent = text.title;

  const clocks = $("card-clocks");
  if (result.phase === "home") {
    clocks.innerHTML =
      cell("Your clock", duration(result.shipS), "since you left") +
      cell("Earth", duration(result.earthS), `It is now ${earthDate}`) +
      "";
    clocks.insertAdjacentHTML("beforeend", "");
  } else if (result.phase === "horizon") {
    clocks.innerHTML = cell("Your clock", duration(result.shipS), "to the horizon") + cell("Seen from Earth", "For ever", "you never arrive");
  } else {
    clocks.innerHTML = cell("Your clock", duration(result.shipS), "since you left") + cell("Earth", duration(result.earthS), `It is ${earthDate}`);
  }

  $("card-lines").innerHTML = text.lines.map((l) => `<p>${l}</p>`).join("");

  const stats: Array<[string, string]> = [];
  if (result.phase === "home") stats.push(["Time stolen", duration(result.stolenS)]);
  stats.push(["Lowest pass", `${nf(result.minR, 2)} radii`], ["Top speed", `${nf(result.maxSpeed, 3)} c`], ["Clocks peaked", `×${nf(result.maxDilation, 2)}`]);
  $("card-stats").innerHTML = stats.map(([k, v], i) => `<div class="${i === 0 && result.phase === "home" ? "stolen" : ""}"><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const bestEl = $("card-best");
  if (isBest) bestEl.innerHTML = `<b>Your best at ${hole.name}.</b>`;
  else if (best) bestEl.textContent = `Your best at ${hole.name}: ${duration(best.stolenS)} stolen.`;
  else bestEl.textContent = result.phase === "home" ? "" : "Come back alive and the time you stole is kept.";

  const share = $("share") as HTMLButtonElement;
  const save = $("save-card") as HTMLButtonElement;
  const again = $("again") as HTMLButtonElement;
  share.textContent = "Share";
  save.textContent = "Save card";
  again.onclick = input.onAgain;
  share.onclick = async () => {
    const t = shareText(result, hole, LIVE_URL);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text: t });
      else {
        await navigator.clipboard.writeText(t);
        share.textContent = "Copied";
      }
    } catch {
      share.textContent = "Could not share";
    }
  };
  save.onclick = async () => {
    const c = await drawCard(input);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `event-horizon-${hole.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      save.textContent = "Saved";
    }, "image/png");
  };

  $("card").hidden = false;
  again.focus({ preventScroll: true });
}

/** A 1200 x 630 picture of the run: the live view behind, the numbers in front. */
export async function drawCard(input: CardInput): Promise<HTMLCanvasElement> {
  const { result, hole, departMs } = input;
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  await document.fonts.load('600 60px "Geist"');
  input.redraw();
  const src = input.canvas;
  const k = Math.max(W / src.width, H / src.height);
  g.drawImage(src, (W - src.width * k) / 2, (H - src.height * k) / 2, src.width * k, src.height * k);
  const shade = g.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(5,5,6,0.88)");
  shade.addColorStop(0.55, "rgba(5,5,6,0.45)");
  shade.addColorStop(1, "rgba(5,5,6,0.1)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);

  const paper = "#f2eee5";
  const dim = "rgba(242,238,229,0.62)";
  const orange = "#ee6a36";
  const X = 64;
  const font = (w: number, s: number) => `${w} ${s}px "Geist", system-ui, sans-serif`;
  const small = (t: string, x: number, y: number) => {
    g.font = font(500, 15);
    g.fillStyle = dim;
    g.fillText(t.toUpperCase().split("").join(" "), x, y);
  };
  g.textBaseline = "alphabetic";
  g.font = font(600, 20);
  g.fillStyle = paper;
  g.fillText("Event Horizon", X, 74);
  g.fillStyle = "#d4491a";
  g.beginPath();
  g.arc(X + g.measureText("Event Horizon").width + 12, 67, 4, 0, 7);
  g.fill();
  small(hole.name, X, 150);
  const text = ending(result, hole, departMs);
  g.font = font(600, 76);
  g.fillStyle = paper;
  g.fillText(text.title, X - 3, 232);

  g.strokeStyle = "rgba(242,238,229,0.25)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(X, 270);
  g.lineTo(X + 560, 270);
  g.stroke();

  const col = (label: string, value: string, x: number, colour = paper) => {
    small(label, x, 306);
    g.font = font(500, 38);
    g.fillStyle = colour;
    g.fillText(value, x, 352);
  };
  if (result.phase === "home") {
    col("Your clock", duration(result.shipS), X);
    col("Earth", duration(result.earthS), X + 290);
    small("Time stolen", X, 420);
    g.font = font(600, 58);
    g.fillStyle = orange;
    g.fillText(duration(result.stolenS), X - 2, 482);
  } else {
    col("Your clock", duration(result.shipS), X);
    col(result.phase === "horizon" ? "Seen from Earth" : "Earth", result.phase === "horizon" ? "For ever" : duration(result.earthS), X + 290);
    small("Lowest pass", X, 420);
    g.font = font(600, 58);
    g.fillStyle = orange;
    g.fillText(`${nf(result.minR, 2)} radii`, X - 2, 482);
  }
  g.font = font(400, 19);
  g.fillStyle = dim;
  g.fillText(`Lowest pass ${nf(result.minR, 2)} radii · top speed ${nf(result.maxSpeed, 3)} c · clocks at ×${nf(result.maxDilation, 2)}`, X, 548);
  g.fillText("pratyushshivam.github.io/event-horizon", X, 580);
  return c;
}
