// "The physics": what the page computes, in plain words, with every formula
// used and every number sourced. Built once, when first opened.

import { C, G, G0, GM_SUN } from "../engine/constants";
import { DISK_PEAK, DISPLAY_PEAK_K } from "../engine/disk";
import { HOLES, type Hole, holeScale } from "../engine/holes";
import { RULES, breakupRadius, tideGPerM } from "../engine/run";
import { B_CRIT, circularDilation } from "../engine/schwarzschild";
import { duration, kilometres, nf } from "../engine/words";

const link = (s: { label: string; url: string }) => `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>`;

const sci = (x: number): string => {
  if (x >= 0.01 && x < 1e6) return nf(x, x < 1 ? 3 : x < 100 ? 1 : 0);
  const e = Math.floor(Math.log10(x));
  return `${(x / 10 ** e).toFixed(1)} × 10<sup>${e}</sup>`;
};

// Small diagrams, drawn in the page's own two colours.
const P = "#f2eee5";
const O = "#ee6a36";
const dia = (body: string, h = 150) => `<svg class="dia" viewBox="0 0 420 ${h}" role="img" aria-hidden="true">${body}</svg>`;

const raysDia = dia(
  `<circle cx="210" cy="75" r="16" fill="#000" stroke="${P}" stroke-opacity=".5"/>
   <circle cx="210" cy="75" r="24" fill="none" stroke="${P}" stroke-opacity=".3" stroke-dasharray="2 4"/>
   <path d="M10 20 C 140 22, 250 30, 410 62" fill="none" stroke="${P}" stroke-opacity=".8"/>
   <path d="M10 40 C 150 42, 230 50, 262 78 C 280 100, 330 122, 410 140" fill="none" stroke="${P}" stroke-opacity=".8"/>
   <path d="M10 53 C 150 54, 222 50, 236 72 C 246 96, 214 110, 194 96 C 176 82, 188 60, 210 62" fill="none" stroke="${O}"/>
   <text x="10" y="14" fill="${P}" fill-opacity=".6" font-size="11">far from the hole: barely bent</text>
   <text x="286" y="96" fill="${P}" fill-opacity=".6" font-size="11">close: swung round</text>
   <text x="118" y="128" fill="${O}" font-size="11">closer than 2.6 radii: captured</text>`,
);

const diskDia = dia(
  `<ellipse cx="210" cy="96" rx="170" ry="22" fill="none" stroke="${P}" stroke-opacity=".45"/>
   <ellipse cx="210" cy="96" rx="52" ry="7" fill="#050506" stroke="${P}" stroke-opacity=".45"/>
   <circle cx="210" cy="92" r="17" fill="#000" stroke="${P}" stroke-opacity=".5"/>
   <path d="M330 99 C 260 60, 236 40, 210 40 C 150 40, 90 60, 14 30" fill="none" stroke="${O}"/>
   <circle cx="330" cy="99" r="3" fill="${O}"/>
   <text x="14" y="22" fill="${P}" fill-opacity=".6" font-size="11">to you</text>
   <text x="300" y="122" fill="${O}" font-size="11">gas behind the hole</text>
   <text x="150" y="30" fill="${P}" fill-opacity=".6" font-size="11">its light bends over the top</text>`,
  135,
);

const clocksDia = (() => {
  // Earth seconds per ship second on a circular orbit, from 12 radii down to 1.5.
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const r = 1.56 + ((12 - 1.56) * i) / 60;
    const x = 30 + ((r - 1.5) / 10.5) * 370;
    const y = 130 - Math.min(4.4, circularDilation(r) - 1) * 26;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const xr = (r: number) => 30 + ((r - 1.5) / 10.5) * 370;
  return dia(
    `<path d="M30 130H400" stroke="${P}" stroke-opacity=".3"/>
     <path d="${d}" fill="none" stroke="${O}" stroke-width="1.5"/>
     <path d="M${xr(3)} 130V60" stroke="${P}" stroke-opacity=".3" stroke-dasharray="2 4"/>
     <path d="M${xr(1.5)} 130V12" stroke="${P}" stroke-opacity=".3" stroke-dasharray="2 4"/>
     <text x="${xr(3) + 5}" y="70" fill="${P}" fill-opacity=".6" font-size="11">3 radii: ×1.41</text>
     <text x="${xr(1.5) + 5}" y="20" fill="${P}" fill-opacity=".6" font-size="11">1.5 radii: no limit</text>
     <text x="${xr(12) - 60}" y="120" fill="${P}" fill-opacity=".6" font-size="11">station: ×1.07</text>
     <text x="30" y="146" fill="${P}" fill-opacity=".45" font-size="10">radius of a circular orbit →</text>`,
    150,
  );
})();

const tideDia = dia(
  `<circle cx="60" cy="60" r="20" fill="#000" stroke="${P}" stroke-opacity=".5"/>
   <rect x="230" y="50" width="70" height="20" rx="3" fill="none" stroke="${P}" stroke-opacity=".8"/>
   <path d="M228 60H170m10-5l-10 5l10 5" fill="none" stroke="${O}" stroke-width="1.5"/>
   <path d="M302 60H330m-8-4l8 4l-8 4" fill="none" stroke="${O}" stroke-width="1.5"/>
   <text x="150" y="96" fill="${P}" fill-opacity=".6" font-size="11">the near end is pulled harder than the far end</text>`,
  110,
);

export function buildPhysics(root: HTMLElement, current: Hole): void {
  const rows = HOLES.map((h) => {
    const s = holeScale(h);
    const br = breakupRadius(s);
    return `<tr>
      <td>${h.name}<br><span class="note">${h.where}</span></td>
      <td>${h.massNote}<br><span class="note">${link(h.source)}</span></td>
      <td>${h.distanceNote}<br><span class="note">${nf(s.distanceLy, s.distanceLy > 1e5 ? 0 : 0)} light years</span></td>
      <td>${kilometres(s.rsM)}<br><span class="note">light crosses it in ${duration(s.rsOverC)}</span></td>
      <td>${sci(tideGPerM(1, s))} g/m<br><span class="note">${br > 1 ? `hull fails at ${nf(br, 1)} radii` : "hull never fails outside"}</span></td>
    </tr>`;
  }).join("");
  const here = holeScale(current);

  root.innerHTML = `
  <h2>The physics</h2>
  <p class="lede">Nothing on this page is painted. The picture is light followed through curved space, pixel by pixel; the ship follows the same equations a real one would.</p>

  <section>
    <h3>One number sets everything</h3>
    <p>A black hole that does not spin is described by its mass alone. The mass fixes the size of the horizon, the Schwarzschild radius:</p>
    <p class="eq"><i>r</i><sub>s</sub> = 2<i>GM</i> / <i>c</i>²<small>The page measures every distance in these radii and every time in <i>r</i><sub>s</sub>/<i>c</i>, the time light takes to cross one.</small></p>
    <table>
      <tr><th>Hole</th><th>Mass</th><th>Distance</th><th>One radius</th><th>Stretch at horizon</th></tr>
      ${rows}
    </table>
    <p class="note">Shadow sizes follow from mass and distance: ${nf(holeScale(HOLES[0]!).shadowMuas, 1)} μas for Sagittarius A* (the Event Horizon Telescope measured a ring of 51.8 ± 2.3, ${link(HOLES[0]!.extra!)}) and ${nf(holeScale(HOLES[1]!).shadowMuas, 1)} μas for M87* (measured 42 ± 3).</p>
  </section>

  <section>
    <h3>How the picture is made</h3>
    <p>For every pixel, a ray of light is followed backwards from the camera. Near a mass, light does not travel straight. In the plane of each ray, with <i>u</i> = <i>r</i><sub>s</sub>/<i>r</i> and φ the angle swept round the hole, its path obeys</p>
    <p class="eq">d²<i>u</i>/dφ² = −<i>u</i> + (3/2) <i>u</i>²<small>The first term alone is a straight line. The second is general relativity. Solved by fourth-order Runge–Kutta on the graphics card, up to ${nf(100)} steps a pixel.</small></p>
    ${raysDia}
    <p>Three things can happen to a ray. It falls in: that pixel is black, and together those pixels are the <b>shadow</b>. It escapes: the pixel shows the star it came from, displaced. Or it crosses the disk, and the pixel shows the gas there.</p>
    <p class="eq"><i>b</i><sub>crit</sub> = (3√3 / 2) <i>r</i><sub>s</sub> ≈ ${nf(B_CRIT, 3)} <i>r</i><sub>s</sub><small>Light aimed closer than this is captured. It is why the shadow looks 2.6 times wider than the horizon itself.</small></p>
    <p>At 1.5 radii light can circle the hole: the <b>photon sphere</b>. Rays that skim it go round once or more before leaving, and draw the thin bright ring at the shadow’s edge.</p>
  </section>

  <section>
    <h3>The disk</h3>
    <p>Gas spirals in on near-circular orbits, heats by friction, and glows. Below 3 radii no circular orbit is stable, so the disk ends there: the <b>innermost stable circular orbit</b>.</p>
    ${diskDia}
    <p>The arch over the top of the shadow is the far side of the disk, seen by light bent over the hole. The thinner arc below is its underside.</p>
    <p class="eq"><i>F</i>(<i>r</i>) ∝ <i>N</i>(<i>x</i>) / ( <i>x</i>⁵ (<i>x</i>² − 3) )<br><i>N</i> = <i>x</i> − <i>x</i><sub>0</sub> + (√3/2) ln[ (<i>x</i>+√3)(<i>x</i><sub>0</sub>−√3) / ((<i>x</i>−√3)(<i>x</i><sub>0</sub>+√3)) ]<small>Energy radiated by each ring, with <i>x</i> = √(2<i>r</i>/<i>r</i><sub>s</sub>), <i>x</i><sub>0</sub> = √6. Page &amp; Thorne 1974. It peaks at ${nf(DISK_PEAK.r, 2)} radii. Each ring glows as a blackbody at <i>T</i> ∝ <i>F</i><sup>¼</sup>.</small></p>
    <p class="eq"><i>g</i> = √(1 − 3<i>r</i><sub>s</sub>/2<i>r</i>) / (1 − Ω <i>ℓ</i>) × 1/√(1 − <i>r</i><sub>s</sub>/<i>r</i><sub>cam</sub>)<small>How much the light’s frequency shifts on the way to the camera: gravity and the gas’s motion together. Ω = √(<i>GM</i>/<i>r</i>³) is the orbital rate, <i>ℓ</i> the photon’s angular momentum about the disk’s axis. The colour is that of a blackbody at <i>gT</i>; the brightness scales as <i>g</i>⁴. So the side turning towards you is brighter and bluer.</small></p>
  </section>

  <section>
    <h3>The ship</h3>
    <p>The ship follows a geodesic, the straightest path through curved spacetime, plus whatever the engine adds. In its orbital plane, per unit of its own time τ:</p>
    <p class="eq">d²<i>r</i>/dτ² = −<i>GM</i>/<i>r</i>² + (<i>r</i> − 3<i>GM</i>/<i>c</i>²) (dφ/dτ)² + <i>a</i><sup>r</sup><br>d²φ/dτ² = −(2/<i>r</i>) (d<i>r</i>/dτ)(dφ/dτ) + <i>a</i><sup>φ</sup><small>Newton’s version has <i>r</i> where this has <i>r</i> − 3<i>GM</i>/<i>c</i>². That one change makes orbits precess, makes them unstable below 3 radii, and below 1.5 turns spin against you: going faster pulls you in.</small></p>
    <p>The engine gives a steady ${nf(RULES.accel, 3)} <i>c</i>²/<i>r</i><sub>s</sub> and holds ${nf(RULES.deltaV, 1)} <i>c</i> of speed change. Around ${current.name} that is ${sci((RULES.accel * here.accelUnit) / G0)} g. The flight feels the same at every hole because the page scales the engine with the hole; no real engine does that.</p>
  </section>

  <section>
    <h3>The two clocks</h3>
    <p>Your clock and a far-away clock disagree for two reasons at once: you are deep in gravity, and you are moving fast. Both are in one expression, added up along the path you actually fly:</p>
    <p class="eq">d<i>t</i>/dτ = √( (1 + (d<i>r</i>/dτ)²/<i>f</i> + <i>r</i>²(dφ/dτ)²) / <i>f</i> ),  <i>f</i> = 1 − <i>r</i><sub>s</sub>/<i>r</i></p>
    <p class="eq">circular orbit: d<i>t</i>/dτ = 1 / √(1 − 3<i>r</i><sub>s</sub>/2<i>r</i>)</p>
    ${clocksDia}
    <p>Time runs at ${nf(RULES.rate)} <i>r</i><sub>s</sub>/<i>c</i> per second of play. At ${current.name} one second of play is ${duration(RULES.rate * here.rsOverC)} for the ship.</p>
  </section>

  <section>
    <h3>Tides</h3>
    ${tideDia}
    <p class="eq">stretch per metre = 2<i>GM</i> / <i>r</i>³<small>At the horizon this is <i>c</i>⁶ / (4 <i>G</i>²<i>M</i>²): the bigger the hole, the gentler its edge.</small></p>
    <p>The hull is rated to ${nf(RULES.hullGPerM)} g per metre. A giant hole never reaches that outside its horizon. Cygnus X-1 passes it at ${nf(breakupRadius(holeScale(HOLES[2]!)), 1)} radii.</p>
  </section>

  <section>
    <h3>What is simplified</h3>
    <ul>
      <li><b>The holes do not spin.</b> Real ones do, which flattens one side of the shadow and moves the inner edge of the disk.</li>
      <li><b>The disk is a thin, opaque sheet</b> with painted turbulence carried round at the true orbital rate. Sagittarius A* and M87* really have thick, faint, hot flows that shine in radio, not a thin bright disk.</li>
      <li><b>The colours are shifted into what eyes see.</b> The hottest ring is set to ${nf(DISPLAY_PEAK_K)} K. Real disks peak in ultraviolet or X-rays.</li>
      <li><b>The camera hovers.</b> It does not share the ship’s speed, so the view is not squeezed forwards by the ship’s motion.</li>
      <li><b>The sky is Earth’s sky</b>, placed around each hole.</li>
      <li><b>The ship is drawn far too large</b>, and its engine is far too strong.</li>
      <li><b>The stretch gauge</b> uses the value for a body falling straight in.</li>
    </ul>
  </section>

  <section>
    <h3>Sources</h3>
    <table>
      <tr><th>What</th><th>Value</th><th>From</th></tr>
      <tr><td>Speed of light</td><td>${nf(C)} m/s</td><td>Exact, by definition of the metre (SI)</td></tr>
      <tr><td>Gravitational constant</td><td>${G.toExponential(5)} m³ kg⁻¹ s⁻²</td><td><a href="https://physics.nist.gov/cgi-bin/cuu/Value?bg" target="_blank" rel="noopener">CODATA 2022, NIST</a></td></tr>
      <tr><td>Sun’s <i>GM</i></td><td>${GM_SUN.toExponential(7)} m³ s⁻²</td><td><a href="https://arxiv.org/abs/1510.07674" target="_blank" rel="noopener">IAU 2015 Resolution B3</a></td></tr>
      <tr><td>Sagittarius A*</td><td>mass, distance</td><td>${link(HOLES[0]!.source)}</td></tr>
      <tr><td>M87*</td><td>mass, distance, ring</td><td>${link(HOLES[1]!.source)}</td></tr>
      <tr><td>Cygnus X-1</td><td>mass, distance</td><td>${link(HOLES[2]!.source)}</td></tr>
      <tr><td>Disk brightness</td><td>thin-disk flux</td><td><a href="https://ui.adsabs.harvard.edu/abs/1974ApJ...191..499P" target="_blank" rel="noopener">Page &amp; Thorne 1974, ApJ 191, 499</a></td></tr>
      <tr><td>Milky Way</td><td>all-sky map</td><td><a href="https://svs.gsfc.nasa.gov/4851" target="_blank" rel="noopener">NASA/Goddard Space Flight Center Scientific Visualization Studio</a>; Gaia DR2: ESA/Gaia/DPAC</td></tr>
      <tr><td>Stars</td><td>15,597 to magnitude 7</td><td><a href="https://codeberg.org/astronexus/hyg" target="_blank" rel="noopener">HYG database v4.4</a>, CC BY-SA 4.0</td></tr>
      <tr><td>Star colours</td><td>B−V to temperature</td><td><a href="https://arxiv.org/abs/1201.1809" target="_blank" rel="noopener">Ballesteros 2012</a></td></tr>
      <tr><td>Colour of heat</td><td>CIE 1931 fit</td><td><a href="https://jcgt.org/published/0002/02/01/" target="_blank" rel="noopener">Wyman, Sloan &amp; Shirley 2013</a></td></tr>
    </table>
    <p class="note">The picture was checked against <a href="https://svs.gsfc.nasa.gov/13326" target="_blank" rel="noopener">NASA Goddard’s black hole visualisation</a> (J. Schnittman, 2019), which uses the same non-spinning hole and thin disk.</p>
  </section>`;
}
