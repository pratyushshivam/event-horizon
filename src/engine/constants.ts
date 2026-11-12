// Physical constants, SI units. Every value is a defined or published figure;
// the source of each is given beside it and repeated in the README.

/** Speed of light in vacuum, m/s. Exact by definition of the metre (SI). */
export const C = 299_792_458;

/** Newtonian constant of gravitation, m^3 kg^-1 s^-2. CODATA 2022 (NIST). */
export const G = 6.6743e-11;

/**
 * Nominal solar mass parameter GM_sun, m^3 s^-2. IAU 2015 Resolution B3.
 * Known far more precisely than G or the Sun's mass separately, so every
 * black hole size here is computed from this product, never from G alone.
 */
export const GM_SUN = 1.327_124_4e20;

/** Standard acceleration of gravity, m/s^2. Exact (3rd CGPM, 1901). */
export const G0 = 9.806_65;

/** Astronomical unit, m. Exact (IAU 2012 Resolution B2). */
export const AU = 149_597_870_700;

/** Parsec, m. Exactly 648000/pi au (IAU 2015 Resolution B2). */
export const PARSEC = (AU * 648_000) / Math.PI;

/** Light year, m: the distance light covers in one Julian year. */
export const JULIAN_YEAR_S = 365.25 * 86_400;
export const LIGHT_YEAR = C * JULIAN_YEAR_S;

export const DAY_S = 86_400;

/** Mean synodic month (full moon to full moon), days. NASA Moon Fact Sheet. */
export const SYNODIC_MONTH_D = 29.53;

/** Planck constant, J s, and Boltzmann constant, J/K. Exact (SI, 2019). */
export const H_PLANCK = 6.626_070_15e-34;
export const K_BOLTZMANN = 1.380_649e-23;

/** Schwarzschild radius in metres for a mass given in solar masses. */
export function schwarzschildRadiusM(massSolar: number): number {
  return (2 * GM_SUN * massSolar) / (C * C);
}
