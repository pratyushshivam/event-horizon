// The shaders. `TRACE` is the one that matters: for every pixel it follows a
// light ray backwards from the camera through Schwarzschild spacetime.
//
// The integrator in TRACE is mirrored line for line by `traceRay` in
// src/engine/light.ts, which the tests check against known results.

import { DISK_PEAK } from "../engine/disk";
import { LUT_MAX_K, LUT_MIN_K } from "../engine/blackbody";
import { CELLS_PER_FACE, STAR_MAG_LO, STAR_MAG_SPAN } from "../engine/stars";

export const PATH_POINTS = 48;
export const MAX_STEPS = 128;

const f = (n: number) => (Number.isInteger(n) ? `${n}.` : `${n}`);

export const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*.5+.5; gl_Position = vec4(aPos,0.,1.); }`;

export const TRACE_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;
uniform vec2 uJitter;
uniform vec3 uCam, uRight, uUp, uFwd;
uniform vec2 uTan;
uniform vec2 uShift;
uniform float uTime;
uniform vec3 uDiskN, uDiskX, uDiskY;
uniform float uDiskOut, uTpeak, uDiskGain;
uniform vec3 uOrbX, uOrbY, uOrbN;
uniform vec2 uPath[${PATH_POINTS}];
uniform int uPathCount;
uniform float uPathAlpha, uRingAlpha, uHomeAlpha, uHomeR, uOverlayGain, uPathWarn;
uniform mat3 uSky;
uniform float uSkyGain, uStarGain, uStarSize;
uniform float uStep;
uniform int uSteps;
uniform float uEncode;
uniform sampler2D uSkyTex, uStarTex, uBBTex, uNoiseTex;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float S3 = 1.7320508075688772;
const float S6 = 2.449489742783178;
const float FPEAK = ${DISK_PEAK.f};
const float CELLS = ${f(CELLS_PER_FACE)};
const vec3 PAPER = vec3(0.887, 0.855, 0.783);

// ---- the disk ------------------------------------------------------------

// Page & Thorne (1974) flux for a non-spinning hole, as a fraction of its peak.
float diskFlux(float r){
  float x = sqrt(2.*r);
  float br = x - S6 + .5*S3*log(((x+S3)*(S6-S3))/((x-S3)*(S6+S3)));
  return max(br,0.)/(pow(x,5.)*(x*x-3.))/FPEAK;
}

vec3 blackbody(float kelvin){
  float i = log(clamp(kelvin, ${f(LUT_MIN_K)}, ${f(LUT_MAX_K)})/${f(LUT_MIN_K)})/log(${f(LUT_MAX_K / LUT_MIN_K)});
  return texture(uBBTex, vec2(i,.5)).rgb;
}

float gasNoise(float a, float lr, float lod){
  float n = textureLod(uNoiseTex, vec2(a*2., lr*2.6), lod+.5).r;
  float m = textureLod(uNoiseTex, vec2(a*5.+.31, lr*9.+.17), lod+1.8).g;
  float f = textureLod(uNoiseTex, vec2(a*13.+.63, lr*25.+.41), lod+2.6).r;
  return n*.5 + m*.32 + f*.18;
}

// Light from the point p of the disk (radius rc), carried by a photon with
// angular momentum lz about the disk's axis, to a camera with blueshift gCam.
vec4 shadeDisk(vec3 p, float rc, float lz, float gCam, float pixWorld){
  float F = diskFlux(rc);
  float om = sqrt(.5/(rc*rc*rc));                       // Kepler, exact here
  float g = sqrt(1.-1.5/rc)/(1.-om*lz)*gCam;            // gravity and Doppler together
  float th = atan(dot(p,uDiskY), dot(p,uDiskX));
  float lr = log(rc);
  // The gas pattern is carried round at the orbital rate of its own radius.
  // Two copies, half a cycle apart, fade into each other so the shear never
  // winds the pattern up for ever.
  const float P = 110.;
  float c1 = fract(uTime/P), c2 = fract(uTime/P+.5);
  float w1 = 1.-abs(2.*c1-1.);
  float lod = log2(max(pixWorld/rc*512.*1.15, 1.));
  float n1 = gasNoise((th - om*(c1-.5)*P)/TAU, lr, lod);
  float n2 = gasNoise((th - om*(c2-.5)*P)/TAU + .43, lr + .7, lod);
  float n = mix(n2, n1, w1);
  // Mixing two patterns flattens contrast in the middle of the fade: restore it.
  n = .5 + (n-.5)/sqrt(w1*w1 + (1.-w1)*(1.-w1));
  // Concentric lanes that do not shear: structure in radius alone.
  float band = textureLod(uNoiseTex, vec2(.37, lr*1.9), lod+1.).g;
  float lanes = smoothstep(.22,.8, n*.62 + band*.38);
  float edgeIn = smoothstep(3.,3.25,rc);
  float edgeOut = 1.-smoothstep(uDiskOut*.8, uDiskOut, rc + (n-.5)*2.2);
  float T = uTpeak*pow(max(F,1e-6),.25)*g;
  float g2 = g*g;
  vec3 col = blackbody(T)*F*g2*g2*mix(.3,1.65,lanes)*uDiskGain;
  float alpha = edgeIn*edgeOut*clamp(.74+lanes*.5,0.,1.);
  return vec4(col*alpha, alpha);
}

// ---- lines drawn in the plane of the ship's orbit --------------------------

float lineMask(float d, float px){ return clamp(1.6 - d/px, 0., 1.); }

vec3 shadeOverlay(vec3 p, float rc, float px){
  vec2 q = vec2(dot(p,uOrbX), dot(p,uOrbY));
  vec3 c = vec3(0.);
  if(uRingAlpha > 0.){
    float m = lineMask(abs(rc-1.5),px) + lineMask(abs(rc-3.),px) + lineMask(abs(rc-1.012),px);
    c += PAPER*m*.5*uRingAlpha;
  }
  if(uHomeAlpha > 0.){
    float dash = step(.5, fract(atan(q.y,q.x)/TAU*72.));
    c += PAPER*lineMask(abs(rc-uHomeR),px)*dash*.42*uHomeAlpha;
  }
  if(uPathAlpha > 0. && uPathCount > 1){
    float best = 1e9; float along = 0.;
    for(int i=0;i<${PATH_POINTS - 1};i++){
      if(i >= uPathCount-1) break;
      vec2 a = uPath[i], b = uPath[i+1];
      vec2 ab = b-a; float t = clamp(dot(q-a,ab)/max(dot(ab,ab),1e-9),0.,1.);
      float d = length(q-a-ab*t);
      if(d < best){ best = d; along = (float(i)+t)/float(uPathCount-1); }
    }
    c += mix(PAPER, vec3(1.,.2,.04)*1.5, uPathWarn)*lineMask(best,px)*(1.-along*along)*.8*uPathAlpha;
  }
  return c*uOverlayGain;
}

// ---- the sky ---------------------------------------------------------------

void cubeFace(vec3 d, out float face, out vec2 uv){
  vec3 a = abs(d);
  if(a.x>=a.y && a.x>=a.z){ face = d.x>0.?0.:1.; uv = vec2(d.y,d.z)/a.x; }
  else if(a.y>=a.z){ face = d.y>0.?2.:3.; uv = vec2(d.z,d.x)/a.y; }
  else { face = d.z>0.?4.:5.; uv = vec2(d.x,d.y)/a.z; }
  uv = uv*.5+.5;
}
vec3 cubeDir(float face, vec2 uv){
  vec2 ab = uv*2.-1.; float s = mod(face,2.)<.5?1.:-1.;
  vec3 d = face<2. ? vec3(s,ab.x,ab.y) : face<4. ? vec3(ab.y,s,ab.x) : vec3(ab.x,ab.y,s);
  return normalize(d);
}

// One catalogue star, if the cell that q points into holds one. The star is
// drawn as a round point in screen pixels: its offset from the pixel's own sky
// direction d is turned back into pixels through the local Jacobian (jx, jy),
// so stars stay sharp however the sky is stretched.
vec3 starIn(vec3 q, vec3 d, vec3 jx, vec3 jy, float invDet, float a, float b, float c){
  float face; vec2 uv; cubeFace(q, face, uv);
  vec2 cell = min(floor(uv*CELLS), CELLS-1.);
  vec4 t = texelFetch(uStarTex, ivec2(int(face*CELLS+cell.x), int(cell.y)), 0);
  if(t.b == 0.) return vec3(0.);
  vec3 del = cubeDir(face, (cell+t.rg)/CELLS) - d;
  vec2 rhs = vec2(dot(jx,del), dot(jy,del));
  vec2 pxy = vec2(c*rhs.x-b*rhs.y, a*rhs.y-b*rhs.x)*invDet;
  float mag = ${f(STAR_MAG_LO)} + (1.-t.b)*${f(STAR_MAG_SPAN)};
  float flux = pow(10., -.4*mag);
  float core = exp(-dot(pxy,pxy)/(2.*uStarSize*uStarSize));
  return texture(uBBTex, vec2(t.a,.5)).rgb*flux*core;
}

void main(){
  vec2 frag = gl_FragCoord.xy + uJitter;
  vec2 ndc = frag/uRes*2.-1. + uShift;
  vec3 rd = normalize(uFwd + ndc.x*uTan.x*uRight + ndc.y*uTan.y*uUp);
  float pixAngle = 2.*uTan.y/uRes.y;

  // The ray's plane: e1 points from the hole to the camera, e2 completes it.
  float r0 = length(uCam);
  vec3 e1 = uCam/r0;
  float cpsi = dot(rd,e1);
  vec3 tang = rd - cpsi*e1;
  float spsi = length(tang);
  vec3 e2 = spsi > 1e-5 ? tang/spsi : normalize(cross(e1, abs(e1.y)<.9?vec3(0,1,0):vec3(1,0,0)));
  spsi = max(spsi,1e-5);

  float u = 1./r0;
  float lapse = sqrt(1.-u);                 // sqrt(1 - rs/r) at the camera
  float w = -u*lapse*cpsi/spsi;             // du/dphi for a hovering observer
  float b = spsi/(u*lapse);                 // impact parameter
  float gCam = 1./lapse;
  vec3 axis = cross(e1,e2);
  float lzDisk = -b*dot(axis,uDiskN);       // photon's angular momentum about the disk axis

  // The ray meets a plane through the hole at angles known in advance.
  float aD = dot(e1,uDiskN), bD = dot(e2,uDiskN);
  float nextD = atan(-aD,bD); if(nextD < 1e-4) nextD += PI;
  float aO = dot(e1,uOrbN), bO = dot(e2,uOrbN);
  float nextO = atan(-aO,bO); if(nextO < 1e-4) nextO += PI;
  bool overlayOn = (uRingAlpha + uHomeAlpha + uPathAlpha) > 0.;
  if(!overlayOn) nextO = 1e9;

  vec3 col = vec3(0.);
  float A = 0.;
  float phi = 0.;
  float h = uStep;
  int fate = 0;                              // 1 captured, 2 escaped
  float phiEnd = 0.;

  for(int i=0;i<${MAX_STEPS};i++){
    if(i >= uSteps) break;
    // d2u/dphi2 = -u + (3/2) u^2, fourth-order Runge-Kutta.
    float k1u = w,              k1w = -u + 1.5*u*u;
    float u2 = u + .5*h*k1u;
    float k2u = w + .5*h*k1w,   k2w = -u2 + 1.5*u2*u2;
    float u3 = u + .5*h*k2u;
    float k3u = w + .5*h*k2w,   k3w = -u3 + 1.5*u3*u3;
    float u4 = u + h*k3u;
    float k4u = w + h*k3w,      k4w = -u4 + 1.5*u4*u4;
    float un = u + h/6.*(k1u + 2.*k2u + 2.*k3u + k4u);
    float wn = w + h/6.*(k1w + 2.*k2w + 2.*k3w + k4w);
    float phin = phi + h;

    for(int k=0;k<2;k++){
      bool isDisk = nextD <= nextO;
      float pc = isDisk ? nextD : nextO;
      if(pc > phin) break;
      float s = (pc-phi)/h, s2 = s*s, s3 = s2*s;
      float uc = (2.*s3-3.*s2+1.)*u + (s3-2.*s2+s)*h*w + (-2.*s3+3.*s2)*un + (s3-s2)*h*wn;
      if(uc > 0. && uc < 1.){
        float rc = 1./uc;
        vec3 p = rc*(cos(pc)*e1 + sin(pc)*e2);
        float px = pixAngle*max(length(p-uCam),.05);
        if(isDisk){
          if(rc > 3. && rc < uDiskOut + 2.){
            vec4 dk = shadeDisk(p, rc, lzDisk, gCam, px);
            col += (1.-A)*dk.rgb; A += (1.-A)*dk.a;
          }
        } else if(pc < PI + 1e-3){
          col += (1.-A)*shadeOverlay(p, rc, px);
        }
      }
      if(isDisk) nextD += PI; else nextO += PI;
    }

    if(un >= 1.){ fate = 1; break; }
    if(un <= 0.){ fate = 2; phiEnd = phi + h*u/(u-un); break; }
    u = un; w = wn; phi = phin;
    if(A > .995) break;
  }

  // Direction the ray leaves in, turned into the sky's own frame.
  vec3 dOut = fate == 2 ? cos(phiEnd)*e1 + sin(phiEnd)*e2 : rd;
  vec3 dc = uSky*dOut;
  vec3 jx = dFdx(dc), jy = dFdy(dc);

  if(fate == 2 && A < .995){
    float foot = max(length(jx), length(jy));          // radians of sky per pixel
    vec2 suv = vec2(.5 + atan(dc.z,dc.x)/TAU, .5 - asin(clamp(dc.y,-1.,1.))/PI);
    float lod = log2(max(foot*${f(4096 / (2 * Math.PI))}, 1.));
    vec3 sky = pow(textureLod(uSkyTex, suv, lod).rgb, vec3(2.2))*uSkyGain;
    // Catalogue stars, where the sky is not squeezed too far to tell them apart.
    float a = dot(jx,jx), bq = dot(jx,jy), c = dot(jy,jy);
    float det = a*c - bq*bq;
    if(foot < .012 && det > 1e-16){
      vec3 t1 = normalize(cross(dc, abs(dc.y)<.9?vec3(0,1,0):vec3(1,0,0)));
      vec3 t2 = cross(dc,t1);
      const float H = .0032;
      float inv = 1./det;
      vec3 st = starIn(dc + H*(t1+t2), dc, jx, jy, inv, a, bq, c);
      st = max(st, starIn(dc + H*(t1-t2), dc, jx, jy, inv, a, bq, c));
      st = max(st, starIn(dc - H*(t1+t2), dc, jx, jy, inv, a, bq, c));
      st = max(st, starIn(dc - H*(t1-t2), dc, jx, jy, inv, a, bq, c));
      // Lensing keeps surface brightness, so a magnified point source is brighter.
      float mu = clamp(pixAngle*pixAngle/sqrt(det), .25, 12.);
      sky += st*uStarGain*mu*(1.-smoothstep(.006,.012,foot));
    }
    col += (1.-A)*sky;
  }

  if(uEncode > .5) col = col/(1.+col);
  outColor = vec4(max(col,0.), 1.);
}`;

/** The ship and the station: small marks added to the scene in linear light. */
export const SPRITE_VS = `#version 300 es
in vec2 aPos;
uniform vec2 uCentre, uSize;
out vec2 vP;
void main(){ vP = aPos; gl_Position = vec4(uCentre + aPos*uSize, 0., 1.); }`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 outColor;
uniform float uKind, uAngle, uGain, uBurn, uPlumeAngle, uFade, uEncode;
uniform vec3 uTint;
const vec3 ORANGE = vec3(0.658, 0.067, 0.010);
void main(){
  vec3 c = vec3(0.);
  float cover = 0.;
  float r = length(vP);
  if(uKind < .5){
    float ca = cos(-uAngle), sa = sin(-uAngle);
    vec2 p = mat2(ca,sa,-sa,ca)*vP*3.2;
    // A small spaceplane seen from above: a tapered hull, two swept wings,
    // a pale canopy near the nose and a hot engine at the tail.
    float aa = .045, ax = p.x, ay = abs(p.y);
    float hull = smoothstep(aa,-aa, ay - .16*(1.-smoothstep(.3,1.02,ax)))*smoothstep(-.74-aa,-.74+aa,ax)*smoothstep(1.02+aa,1.02-aa,ax);
    float lead = .24 - 1.02*(ay-.1), trail = -.52 - .2*(ay-.1);
    float wing = smoothstep(-aa,aa,lead-ax)*smoothstep(-aa,aa,ax-trail)*smoothstep(.68+aa,.68-aa,ay);
    float tail = smoothstep(-aa,aa,(-.5-.7*(ay-.1))-ax)*smoothstep(-aa,aa,ax+.8)*smoothstep(.36+aa,.36-aa,ay);
    float canopy = smoothstep(.1,.04,length(vec2((ax-.5)*.5, p.y)))*hull;
    float engine = exp(-dot(p-vec2(-.8,0.),p-vec2(-.8,0.))*30.);
    // The ship hides what is behind it, so its outline stays sharp over the bright disk.
    cover = max(hull, max(wing, tail));
    c += ORANGE*(hull*4.6 + max(wing, tail)*(1.-hull)*2.7) + ORANGE*exp(-r*r*14.)*.2;
    c += vec3(0.887,0.855,0.783)*canopy*3.4 + vec3(1.,.72,.42)*engine*1.8;
    if(uBurn > 0.){
      float cb = cos(-uPlumeAngle), sb = sin(-uPlumeAngle);
      vec2 q = mat2(cb,sb,-sb,cb)*vP*3.2;
      float plume = exp(-q.y*q.y*26.)*smoothstep(0.,-.3,q.x)*exp(q.x*1.5);
      c += vec3(1.,.62,.3)*plume*4.*uBurn;
    }
    c = mix(c, vec3(dot(c,vec3(.3))*2.2, 0., 0.), 1.-uTint.x);
  } else {
    float ring = smoothstep(.09,.0,abs(r-.42)) + smoothstep(.16,.08,r);
    c += vec3(0.887,0.855,0.783)*ring*1.6;
  }
  c *= uGain*uFade;
  if(uEncode > .5) c = c/(1.+c);
  outColor = vec4(c, cover*uFade);
}`;

/** Bloom: a chain of halvings (13 taps each), then back up (9 taps each). */
export const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uFirst;
vec3 s(vec2 o){ return texture(uTex, vUv + o*uTexel).rgb; }
float w(vec3 c){ return 1./(1. + max(c.r,max(c.g,c.b))); }
void main(){
  vec3 a=s(vec2(-2,-2)), b=s(vec2(0,-2)), c=s(vec2(2,-2));
  vec3 d=s(vec2(-2,0)),  e=s(vec2(0,0)),  f=s(vec2(2,0));
  vec3 g=s(vec2(-2,2)),  h=s(vec2(0,2)),  i=s(vec2(2,2));
  vec3 j=s(vec2(-1,-1)), k=s(vec2(1,-1)), l=s(vec2(-1,1)), m=s(vec2(1,1));
  vec3 o;
  if(uFirst > .5){
    // Weight each group by 1/(1+max) so one very bright pixel cannot flicker the whole bloom.
    vec3 g0=(j+k+l+m)*.25, g1=(a+b+d+e)*.25, g2=(b+c+e+f)*.25, g3=(d+e+g+h)*.25, g4=(e+f+h+i)*.25;
    float w0=w(g0)*.5, w1=w(g1)*.125, w2=w(g2)*.125, w3=w(g3)*.125, w4=w(g4)*.125;
    o = (g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4);
  } else {
    o = e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125;
  }
  outColor = vec4(o,1.);
}`;

export const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec2 d = uTexel;
  vec3 o = texture(uTex,vUv).rgb*4.;
  o += (texture(uTex,vUv+vec2(d.x,0)).rgb + texture(uTex,vUv-vec2(d.x,0)).rgb + texture(uTex,vUv+vec2(0,d.y)).rgb + texture(uTex,vUv-vec2(0,d.y)).rgb)*2.;
  o += texture(uTex,vUv+d).rgb + texture(uTex,vUv-d).rgb + texture(uTex,vUv+vec2(d.x,-d.y)).rgb + texture(uTex,vUv+vec2(-d.x,d.y)).rgb;
  outColor = vec4(o/16.,1.);
}`;

/** Copy, scaled: used to add frames together for photographs. */
export const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uScale;
void main(){ outColor = vec4(texture(uTex,vUv).rgb*uScale, 1.); }`;

/** Exposure, bloom, a filmic curve, grain, and the step to the screen's encoding. */
export const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uBloomAmount, uGrain, uSeed, uVignette, uEncode, uFade;
uniform vec2 uOut;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec3 filmic(vec3 x){
  // ACES fit (Narkowicz 2015)
  return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.);
}
void main(){
  vec3 scene = texture(uScene,vUv).rgb;
  vec3 bloom = texture(uBloom,vUv).rgb;
  if(uEncode > .5){ scene = scene/max(1.-scene,1e-3); bloom = vec3(0.); }
  vec3 c = (scene + bloom*uBloomAmount)*uExposure;
  vec2 q = vUv-.5;
  c *= 1. - uVignette*dot(q,q)*1.6;
  // Half per-channel (bright light runs to white), half on brightness alone
  // (colour kept), so the disk keeps its orange without going flat.
  float l = dot(c, vec3(.2126,.7152,.0722));
  vec3 kept = c*(filmic(vec3(l)).r/max(l,1e-5));
  c = mix(min(kept,vec3(1.)), filmic(c), .5);
  c = mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-.055, step(.0031308,c));
  vec2 px = vUv*uOut;
  float n = hash(px + uSeed*61.7) + hash(px*1.37 + uSeed*17.3 + 11.) - 1.;   // triangular
  float lum = dot(c, vec3(.3,.59,.11));
  c += n*(uGrain*(.35 + .65*(1.-lum)) + 1./255.);
  outColor = vec4(c*uFade, 1.);
}`;
