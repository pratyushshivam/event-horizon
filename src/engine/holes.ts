import { C, DAY_S, G0, JULIAN_YEAR_S, LIGHT_YEAR, PARSEC, schwarzschildRadiusM } from "./constants";

/** A published black hole. Nothing here is typed from memory: see `source`. */
export interface Hole {
  id: "sgra" | "m87" | "cygx1";
  name: string;
  kind: string;
  where: string;
  /** Mass in solar masses, with the uncertainty as published. */
  massSolar: number;
  massNote: string;
  /** Distance from Earth in parsecs, with the uncertainty as published. */
  distancePc: number;
  distanceNote: string;
  source: { label: string; url: string };
  extra?: { label: string; url: string };
}

export const HOLES: readonly Hole[] = [
  {
    id: "sgra",
    name: "Sagittarius A*",
    kind: "Supermassive",
    where: "Centre of the Milky Way",
    massSolar: 4.297e6,
    massNote: "4.297 million Suns, known to about 0.25%",
    distancePc: 8277,
    distanceNote: "8,277 pc",
    source: {
      label: "GRAVITY Collaboration 2022, A&A 657, L12",
      url: "https://doi.org/10.1051/0004-6361/202142465",
    },
    extra: {
      label: "EHT Collaboration 2022, ApJL 930, L12 (ring 51.8 ± 2.3 μas)",
      url: "https://doi.org/10.3847/2041-8213/ac6674",
    },
  },
  {
    id: "m87",
    name: "M87*",
    kind: "Supermassive",
    where: "Galaxy Messier 87, Virgo",
    massSolar: 6.5e9,
    massNote: "6.5 ± 0.2 (stat) ± 0.7 (sys) billion Suns",
    distancePc: 16.8e6,
    distanceNote: "16.8 (+0.8, −0.7) Mpc",
    source: {
      label: "EHT Collaboration 2019, ApJL 875, L6",
      url: "https://doi.org/10.3847/2041-8213/ab1141",
    },
  },
  {
    id: "cygx1",
    name: "Cygnus X-1",
    kind: "Stellar mass",
    where: "Our galaxy, Cygnus",
    massSolar: 21.2,
    massNote: "21.2 ± 2.2 Suns",
    distancePc: 2220,
    distanceNote: "2.22 (+0.18, −0.17) kpc",
    source: {
      label: "Miller-Jones et al. 2021, Science 371, 1046",
      url: "https://doi.org/10.1126/science.abb3363",
    },
  },
];

export function holeById(id: string): Hole {
  return HOLES.find((h) => h.id === id) ?? HOLES[0]!;
}

/** Everything derived from the mass. The game runs in units of rs and rs/c. */
export interface HoleScale {
  /** Schwarzschild radius, metres. */
  rsM: number;
  /** Light-crossing time of one Schwarzschild radius, seconds. */
  rsOverC: number;
  /** c^2 / rs, m/s^2: the SI size of one unit of acceleration. */
  accelUnit: number;
  /** Stretch per metre of length at the horizon itself, in g per metre. */
  tideAtHorizonGPerM: number;
  distanceLy: number;
  /** Angular diameter of the shadow seen from Earth, microarcseconds. */
  shadowMuas: number;
}

export function holeScale(h: Hole): HoleScale {
  const rsM = schwarzschildRadiusM(h.massSolar);
  const distM = h.distancePc * PARSEC;
  const bCrit = (3 * Math.sqrt(3)) / 2; // in rs
  const shadowRad = (2 * bCrit * rsM) / distM;
  return {
    rsM,
    rsOverC: rsM / C,
    accelUnit: (C * C) / rsM,
    tideAtHorizonGPerM: (C * C) / (rsM * rsM) / G0,
    distanceLy: distM / LIGHT_YEAR,
    shadowMuas: (shadowRad * 180 * 3600 * 1e6) / Math.PI,
  };
}

export const SECONDS = { day: DAY_S, year: JULIAN_YEAR_S };
