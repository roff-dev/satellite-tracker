/**
 * GLSL shared by everything that draws objects from the element buffer. Needs #include <common> first
 * (for PI), and the colour key needs the uniforms below declared.
 */

/** Where an object is, dt seconds from its anchor: Kepler's equation, then SGP4's secular drift (mean motion and drag, perigee, node). TEME km. */
export const ORBIT_GLSL = /* glsl */ `
  vec3 orbitPosition(vec3 elements, float mdot, vec4 P, vec4 Q, float t2, float dt) {
    float a = elements.x;
    float e = elements.y;
    float M = mod(elements.z + mdot * dt + t2 * dt * dt, 6.2831853);
    float E = e < 0.8 ? M : PI;
    for (int i = 0; i < 5; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    vec2 xy = vec2(a * (cos(E) - e), a * sqrt(1.0 - e * e) * sin(E));
    float dw = P.w * dt;
    float dO = Q.w * dt;
    xy = mat2(cos(dw), sin(dw), -sin(dw), cos(dw)) * xy;
    vec3 r = xy.x * P.xyz + xy.y * Q.xyz;
    r.xy = mat2(cos(dO), sin(dO), -sin(dO), cos(dO)) * r.xy;
    return r;
  }

  /** TEME km to scene units: (x, z, -y), one Earth radius to the unit. */
  vec3 toScene(vec3 r) {
    return vec3(r.x, r.z, -r.y) / 6371.0;
  }

  /** In sunlight, outside Earth's shadow cylinder; softened a little at the edge so objects fade rather than blink. */
  float inSunlight(vec3 p, vec3 sun) {
    return dot(p, sun) > 0.0 ? 1.0 : smoothstep(0.985, 1.015, length(cross(p, sun)));
  }
`;

export const KEY_UNIFORMS_GLSL = /* glsl */ `
  uniform float uColourBy;
  uniform float uFilter;
  uniform float uDay;
  uniform vec3 uPayload;
  uniform vec3 uRocket;
  uniform vec3 uDebris;
  uniform vec3 uShadow;
  uniform vec3 uFlare;
  uniform vec3 uGlint;
  uniform vec3 uMuted;
  uniform vec3 uInk;
`;

/** An object's colour: by sunlight (its kind's colour when lit), by what it is, or by the kind of orbit it's on. */
export const KEY_GLSL = /* glsl */ `
  vec3 keyColour(int kind, float a, float e) {
    vec3 base = kind <= 1 ? uPayload : kind == 2 ? uRocket : uDebris;
    if (uColourBy > 0.5 && uColourBy < 1.5) return kind == 0 ? uGlint : kind == 1 ? uMuted : kind == 2 ? uFlare : uDebris;
    if (uColourBy > 1.5) return e >= 0.25 ? uInk : a < 8413.0 ? uShadow : a >= 41060.0 && a <= 43420.0 ? uFlare : uGlint;
    return base;
  }

  /** 1 for members of the group picked out (or when none is), 0.08 for everything else, so the rest stays as context. */
  float membership(int kind, float glint, float launchDay, float groups) {
    if (uFilter < 0.0) return 1.0;
    bool inside;
    if (uFilter > 101.5) inside = kind >= 2;
    else if (uFilter > 100.5) inside = glint >= 3.98;
    else if (uFilter > 99.5) inside = uDay - launchDay <= 30.0;
    else inside = ((int(groups + 0.5) >> int(uFilter + 0.5)) & 1) == 1;
    return inside ? 1.0 : 0.08;
  }
`;
