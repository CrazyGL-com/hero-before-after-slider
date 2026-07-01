import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as React from 'react';
import CrazyGLWrapper, { useContent, useHeroAnimationFrame, useHeroReady } from '@crazygl/core';
import metadata from './metadata.json';
import './style.css';
/* ─────────────────────────────────────────────────────────────────────────
   Cinematic Before / After Slider — two media blended across a glowing,
   draggable glass divider.

   Physics statement
     The split is not a hard wipe — it is a thin VERTICAL GLASS PLANE seen
     edge-on. Glass refracts via Snell's law (IOR ≈ 1.5). Modelling the
     divider edge as a half-cylinder lens (curved across X, flat along Y),
     the surface tilt near the line bends what is behind it: the horizontal
     screen-space shift is the small-angle Snell result
         shift_x = nx * (1 - 1/IOR) * thickness
     where nx is the cylinder normal's X component (-1..1 across the strip).
     Because the divider sits BETWEEN the two media, each side is sampled
     with this bend so the "before" and "after" appear to wrap around the
     glass edge — the canonical refraction tell.

     Chromatic dispersion = IOR varies by wavelength, so r/g/b refract at
     slightly different angles. We sample the three channels at three UVs
     offset by per-channel amounts (NOT a single tinted offset, which would
     be a hue shift — see skill anti-patterns). This gives the prism rim.

     The glass also GLOWS: a thin additive light band along the divider,
     exp(-(d/w)^2), tinted by glowColor — light scattering inside the edge.

     Parallax: the whole plane is a flat panel a little in front of the
     deep background. Moving the pointer shears the sampled UVs by an amount
     proportional to (pointer - 0.5) — a cheap fake of looking at the panel
     from a slightly different angle (motion parallax). Before/after get
     opposite micro-offsets so the divider reads as having real depth.

   Algorithm
     - Fullscreen triangle, two cover-fit textures (image OR <video> via
       per-frame texImage2D). Cover-fit keeps native aspect (skill: MUST).
     - splitUV space: rotate fragUV about the divider so a diagonal split is
       just a rotated vertical line. signedDist = (rotated x) - splitX.
     - mask = smoothstep across signedDist → before on one side, after on
       the other, antialiased at the line.
     - Near the line (|signedDist| < halfWidth) compute the cylinder normal
       nx and apply the biconvex refraction shift, per channel for CA.
     - Glow band + a bright specular core line + grain + vignette.

   Coordinate spaces in this shader:
     fragCoord  — pixels [0..res.x] × [0..res.y]; Y up (gl_FragCoord)
     uv         — fragCoord / resolution, [0..1]; Y up
     texUV      — sample coords for the media; we flip Y (textures Y-down)
     centred    — (uv - 0.5), aspect-corrected on X by canvasAspect so the
                  split angle rotates without skew
     splitX     — the draggable divider position along the rotated axis,
                  0..1 (this is the KEY coordinate the drag controls)
     u_input    — runtime pointer in 0..1 (top-left origin); we read it in
                  JS for drag/parallax, never directly in the shader
   ───────────────────────────────────────────────────────────────────────── */
const VERT = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D u_before;
uniform sampler2D u_after;
uniform vec2  u_resolution;
uniform vec2  u_beforeSize;   // native px of before media (cover-fit)
uniform vec2  u_afterSize;    // native px of after media
uniform float u_split;        // divider position along rotated axis, 0..1
uniform float u_angle;        // divider tilt in radians
uniform float u_refraction;   // edge refraction strength
uniform float u_chroma;       // chromatic dispersion strength
uniform float u_glowIntensity;
uniform vec3  u_glowColor;
uniform float u_parallax;     // pointer-driven shear amount (already scaled)
uniform vec2  u_parallaxDir;  // (pointer.x-0.5, pointer.y-0.5) * 2
uniform vec3  u_bgTone;
uniform float u_time;

// Cover-fit (object-fit: cover) UV remap so non-matching aspects keep their
// native aspect rather than stretching to canvas.
vec2 coverUV(vec2 uv, vec2 mediaSize) {
	float mAspect = mediaSize.x / max(mediaSize.y, 1.0);
	float cAspect = u_resolution.x / max(u_resolution.y, 1.0);
	vec2 scale = vec2(1.0);
	if (mAspect > cAspect) scale.x = cAspect / mAspect;
	else                   scale.y = mAspect / cAspect;
	return (uv - 0.5) * scale + 0.5;
}
vec3 sampleBefore(vec2 uv) {
	vec2 c = coverUV(uv, u_beforeSize);
	return texture(u_before, vec2(c.x, 1.0 - c.y)).rgb;
}
vec3 sampleAfter(vec2 uv) {
	vec2 c = coverUV(uv, u_afterSize);
	return texture(u_after, vec2(c.x, 1.0 - c.y)).rgb;
}
// Per-channel single samples for chromatic dispersion at the rim.
float beforeR(vec2 uv){ vec2 c=coverUV(uv,u_beforeSize); return texture(u_before, vec2(c.x,1.0-c.y)).r; }
float beforeG(vec2 uv){ vec2 c=coverUV(uv,u_beforeSize); return texture(u_before, vec2(c.x,1.0-c.y)).g; }
float beforeB(vec2 uv){ vec2 c=coverUV(uv,u_beforeSize); return texture(u_before, vec2(c.x,1.0-c.y)).b; }
float afterR(vec2 uv){ vec2 c=coverUV(uv,u_afterSize); return texture(u_after, vec2(c.x,1.0-c.y)).r; }
float afterG(vec2 uv){ vec2 c=coverUV(uv,u_afterSize); return texture(u_after, vec2(c.x,1.0-c.y)).g; }
float afterB(vec2 uv){ vec2 c=coverUV(uv,u_afterSize); return texture(u_after, vec2(c.x,1.0-c.y)).b; }

// Multi-step non-linear hash for film grain (NOT fract(sin) — skill catalog).
float grain(vec2 fragPx) {
	float frameSeed = fract(u_time * 71.41);
	vec2 p = fract((fragPx + vec2(frameSeed * 7919.0, frameSeed * 1283.0)) * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

void main() {
	vec2 fragPx = gl_FragCoord.xy;
	vec2 uv = fragPx / u_resolution;
	float cAspect = u_resolution.x / max(u_resolution.y, 1.0);

	// Aspect-corrected coords. We anchor rotation at the split position so
	// the divider rotates around the cursor (the handle's pivot), not the
	// canvas centre — otherwise the shader line drifts away from the DOM
	// handle proportionally to the angle.
	vec2 ap = vec2(uv.x * cAspect, uv.y);
	vec2 splitPos = vec2(u_split * cAspect, 0.5);
	vec2 local = ap - splitPos;
	// Rotate by -angle so a tilted divider becomes a vertical line in the
	// local frame. signedDist is the rotated x coordinate — positive on the
	// "after" side, negative on the "before" side. The line passes through
	// splitPos at the prescribed angle.
	float ca = cos(-u_angle), sa = sin(-u_angle);
	float signedDist = local.x * ca - local.y * sa;

	// Half-width of the glass strip (in centred-aspect units).
	float halfW = 0.018;

	// Cylinder normal across the strip: -1 at left rim, +1 at right rim, 0
	// at the centre line. Outside the strip it saturates to ±1 but the
	// refraction weight falls to zero so only the edge bends.
	float nx = clamp(signedDist / halfW, -1.0, 1.0);
	// Refraction weight peaks inside the strip, ~0 outside.
	float strip = exp(-pow(signedDist / (halfW * 1.6), 2.0));

	// Biconvex small-angle Snell shift, IOR 1.5 → (1 - 1/1.5) = 0.333.
	// Direction is the divider's local X (rotated back to screen X/Y).
	// Shift the sample AWAY from the line so each side wraps around the edge.
	float refrPow = (1.0 - 1.0 / 1.5);
	float bend = nx * refrPow * u_refraction * strip * 0.06;
	// Rotate the bend direction back into screen space (it acts along the
	// divider's normal, i.e. local +X).
	float bcx = cos(u_angle), bsx = sin(u_angle);
	vec2 bendDir = vec2(bcx, bsx); // local +X in screen space
	// Per-channel chromatic spread: r/g/b refract at slightly different
	// IORs. caBoost grows toward the rim where dispersion is visible.
	float caBoost = u_chroma * (0.4 + 0.6 * abs(nx)) * strip;
	vec2 offR = bendDir * (bend + 0.012 * caBoost);
	vec2 offG = bendDir * (bend);
	vec2 offB = bendDir * (bend - 0.012 * caBoost);

	// Parallax shear: opposite micro-offsets per side fake panel depth.
	vec2 par = u_parallaxDir * u_parallax;

	// Sample both sides with refraction + chromatic offset + parallax.
	vec3 bcol = vec3(
		beforeR(uv + offR - par * 1.0),
		beforeG(uv + offG - par * 1.0),
		beforeB(uv + offB - par * 1.0)
	);
	vec3 acol = vec3(
		afterR(uv + offR + par * 1.0),
		afterG(uv + offG + par * 1.0),
		afterB(uv + offB + par * 1.0)
	);

	// Select side. Antialiased across one strip half-width so the seam is
	// a clean glass edge, not a jaggy cut.
	float sel = smoothstep(-halfW * 0.6, halfW * 0.6, signedDist);
	vec3 col = mix(bcol, acol, sel);

	// Darken slightly under the glass body so the strip reads as a real
	// edge with thickness, not a painted line.
	col *= 1.0 - strip * 0.18;

	// ── Glow band along the divider ─────────────────────────────────────
	// Thin additive light bleeding off the glass edge. exp falloff gives a
	// soft core + wide halo. A tighter inner line is the specular highlight.
	float glowHalo = exp(-pow(signedDist / 0.040, 2.0));
	float glowCore = exp(-pow(signedDist / 0.0065, 2.0));
	float glow = (glowHalo * 0.45 + glowCore * 1.0) * u_glowIntensity;
	col += u_glowColor * glow * 0.9;
	// Pure-white hot centre line for the "lit glass" pop.
	col += vec3(1.0) * glowCore * u_glowIntensity * 0.35;

	// ── Vignette + bottom darkening toward the bg tone ──────────────────
	vec2 vc = uv - 0.5;
	float vig = smoothstep(0.95, 0.35, length(vec2(vc.x * 1.05, vc.y)));
	col = mix(u_bgTone, col, 0.18 + 0.82 * vig);
	// Gentle bottom darkening so the heading copy reads at the lower band.
	col *= 1.0 - smoothstep(0.45, 1.0, 1.0 - uv.y) * 0.16;

	// Subtle filmic grain.
	float g = grain(fragPx);
	col += (g - 0.5) * 0.025;

	outColor = vec4(col, 1.0);
}`;
function parseHex(hex) {
    const h = (hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : (h.length >= 6 ? h.slice(0, 6) : '000000');
    const n = parseInt(full, 16);
    if (Number.isNaN(n))
        return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function isVideoUrl(url) {
    return /\.(mp4|webm|mov|ogv|ogg|m4v)(\?|#|$)/i.test(url || '');
}
function compile(gl, t, s) {
    const sh = gl.createShader(t);
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('[before-after-slider]', gl.getShaderInfoLog(sh));
        throw new Error('compile');
    }
    return sh;
}
// Flat fallback texture so the shader never samples an undefined sampler.
function makeFallback(color) {
    const W = 64, H = 64;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = `rgb(${(color[0] * 255) | 0},${(color[1] * 255) | 0},${(color[2] * 255) | 0})`;
    ctx.fillRect(0, 0, W, H);
    return cv;
}
function BeforeAfterSliderHero(props) {
    const { size, input, reducedMotion, beforeMedia = 'https://crazygl.com/samples/nature1.avif', afterMedia = 'https://crazygl.com/samples/nature3.avif', splitPosition = 0.5, splitAngle = 0, refractionStrength = 1, chromaStrength = 1, glowColor = '#bfe3ff', glowIntensity = 1, parallaxStrength = 0, backgroundTone = '#0b1018', handleStyle = 'arrows', beforeLabel = 'BEFORE', afterLabel = 'AFTER', showLabels = true, interactivity = 'pointer', } = props;
    const content = useContent(props);
    const [assetsReady, setAssetsReady] = React.useState(false);
    useHeroReady(props, { until: assetsReady });
    const canvasRef = React.useRef(null);
    const glRef = React.useRef(null);
    const programRef = React.useRef(null);
    const uRef = React.useRef({});
    const beforeRef = React.useRef({ tex: null, size: { w: 64, h: 64 }, video: null, isVideo: false, ready: false, epoch: 0 });
    const afterRef = React.useRef({ tex: null, size: { w: 64, h: 64 }, video: null, isVideo: false, ready: false, epoch: 0 });
    // Both media sides feed GL textures; signal readiness once each side has
    // loaded (or settled with its fallback). Tracked per-side so a single
    // loaded side doesn't prematurely mark the hero ready.
    const sideLoadedRef = React.useRef({ before: false, after: false });
    const markSideReady = React.useCallback((which) => {
        sideLoadedRef.current[which] = true;
        if (sideLoadedRef.current.before && sideLoadedRef.current.after)
            setAssetsReady(true);
    }, []);
    // Live split position the rAF reads. Pointer writes to it;
    // reduced-motion / none let it rest at / sweep around splitPosition.
    const splitRef = React.useRef(splitPosition);
    // Smoothed visual split (eases toward the target so pointer feels fluid).
    const visSplitRef = React.useRef(splitPosition);
    // Direct DOM ref for the handle so we can mutate transform in the rAF
    // loop without going through React state — the shader uniform and the
    // DOM handle then update from the SAME vis value on the SAME frame.
    const handleRef = React.useRef(null);
    const interactive = interactivity !== 'none' && !reducedMotion;
    // ── Init GL (program + buffer + textures), once ──────────────────────
    React.useEffect(() => {
        const c = canvasRef.current;
        if (!c)
            return;
        const gl = c.getContext('webgl2', { antialias: false, alpha: false });
        if (!gl)
            return;
        glRef.current = gl;
        try {
            const p = gl.createProgram();
            gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
                console.error('[before-after-slider] link', gl.getProgramInfoLog(p));
                throw new Error('link');
            }
            programRef.current = p;
            gl.useProgram(p);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(p, 'a_position');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            for (const n of [
                'u_before', 'u_after', 'u_resolution', 'u_beforeSize', 'u_afterSize',
                'u_split', 'u_angle', 'u_refraction', 'u_chroma', 'u_glowIntensity',
                'u_glowColor', 'u_parallax', 'u_parallaxDir', 'u_bgTone', 'u_time',
            ]) {
                uRef.current[n] = gl.getUniformLocation(p, n);
            }
            // Sampler-to-unit binding once at init.
            gl.uniform1i(uRef.current.u_before, 0);
            gl.uniform1i(uRef.current.u_after, 1);
            const mkTex = (unit, fallback) => {
                const tex = gl.createTexture();
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeFallback(fallback));
                return tex;
            };
            beforeRef.current.tex = mkTex(0, [0.16, 0.2, 0.26]);
            afterRef.current.tex = mkTex(1, [0.2, 0.26, 0.3]);
        }
        catch (e) {
            console.error('[before-after-slider] init failed', e);
        }
        return () => {
            // Tear down videos so the GPU↔decoder pipeline is released.
            for (const side of [beforeRef.current, afterRef.current]) {
                if (side.video) {
                    side.video.pause();
                    side.video.removeAttribute('src');
                    side.video.load();
                    side.video = null;
                }
            }
        };
    }, []);
    // ── Media loader (per side), epoch-guarded ───────────────────────────
    const loadSide = React.useCallback((url, sideRef, unit, which) => {
        const gl = glRef.current;
        if (!gl || !sideRef.current.tex)
            return;
        const side = sideRef.current;
        const myEpoch = ++side.epoch;
        // Reset any previous video.
        if (side.video) {
            side.video.pause();
            side.video.removeAttribute('src');
            side.video.load();
            side.video = null;
        }
        side.isVideo = isVideoUrl(url);
        side.ready = false;
        if (!url) {
            markSideReady(which);
            return;
        }
        if (side.isVideo) {
            const v = document.createElement('video');
            v.muted = true;
            v.loop = true;
            v.autoplay = true;
            v.playsInline = true;
            v.crossOrigin = 'anonymous';
            v.src = url;
            const onMeta = () => {
                if (myEpoch !== side.epoch)
                    return; // stale
                side.size = { w: v.videoWidth || 1280, h: v.videoHeight || 720 };
                side.video = v;
                side.ready = true;
                v.play().catch(() => { });
                markSideReady(which);
            };
            v.addEventListener('loadedmetadata', onMeta, { once: true });
            v.load();
        }
        else {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                if (myEpoch !== side.epoch)
                    return; // stale load — drop
                const g = glRef.current;
                if (!g || !side.tex)
                    return;
                g.activeTexture(g.TEXTURE0 + unit);
                g.bindTexture(g.TEXTURE_2D, side.tex);
                g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
                g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
                side.size = { w: img.naturalWidth || 1280, h: img.naturalHeight || 720 };
                side.ready = true;
                markSideReady(which);
            };
            img.onerror = () => { markSideReady(which); /* keep fallback */ };
            img.src = url;
        }
    }, [markSideReady]);
    React.useEffect(() => { loadSide(beforeMedia, beforeRef, 0, 'before'); }, [beforeMedia, loadSide]);
    React.useEffect(() => { loadSide(afterMedia, afterRef, 1, 'after'); }, [afterMedia, loadSide]);
    // Reset split target when the default position prop changes.
    React.useEffect(() => {
        splitRef.current = splitPosition;
        if (!interactive)
            visSplitRef.current = splitPosition;
    }, [splitPosition, interactive]);
    // ── Resize ───────────────────────────────────────────────────────────
    React.useEffect(() => {
        const c = canvasRef.current, gl = glRef.current;
        if (!c || !gl)
            return;
        const dpr = Math.min(size.dpr, 2);
        const w = Math.max(1, Math.floor(size.width * dpr));
        const h = Math.max(1, Math.floor(size.height * dpr));
        if (c.width !== w)
            c.width = w;
        if (c.height !== h)
            c.height = h;
        gl.viewport(0, 0, w, h);
    }, [size.width, size.height, size.dpr]);
    // ── Pointer auto-follow on the hero root ─────────────────────────────
    // Map clientX directly to a 0..1 split via the hero element's bounding
    // rect — this is the SAME pixel space the canvas occupies, so the
    // divider line lands under the cursor with no offset. The slider always
    // follows the cursor as it moves across the hero; no drag required.
    // When interactivity is off, nothing is bound and the divider holds.
    React.useEffect(() => {
        const el = props.rootRef?.current;
        if (!el)
            return;
        if (!interactive)
            return;
        const localX = (clientX) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0)
                return splitRef.current;
            return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        };
        const onMove = (e) => {
            splitRef.current = localX(e.clientX);
        };
        el.addEventListener('pointermove', onMove);
        return () => {
            el.removeEventListener('pointermove', onMove);
        };
    }, [props.rootRef, interactive]);
    // Reflect interactivity on the root element so the CSS cursor selector
    // can swap between default and ew-resize without React re-renders here.
    React.useEffect(() => {
        const el = props.rootRef?.current;
        if (!el)
            return;
        el.setAttribute('data-interactive', interactive ? 'true' : 'false');
    }, [props.rootRef, interactive]);
    const glowRGB = React.useMemo(() => parseHex(glowColor), [glowColor]);
    const bgRGB = React.useMemo(() => parseHex(backgroundTone), [backgroundTone]);
    // Negate so the shader's Y-up rotation matches CSS's Y-down rotation:
    // positive splitAngle then tilts the top of the divider to the RIGHT in
    // BOTH the shader-rendered split AND the DOM handle line.
    const angleRad = -(splitAngle * Math.PI) / 180;
    useHeroAnimationFrame(props.rootRef, ({ elapsed, delta }) => {
        const gl = glRef.current, p = programRef.current, c = canvasRef.current;
        if (!gl || !p || !c)
            return;
        const before = beforeRef.current, after = afterRef.current;
        if (!before.tex || !after.tex)
            return;
        const dt = Math.min(0.05, delta);
        // ── Resolve the split target ────────────────────────────────────
        // Drag / auto-follow modes both write splitRef directly from the
        // pointermove handler (using the hero element's bounding rect), so
        // the divider tracks the cursor 1-to-1 with no edge biasing. When
        // the hero is non-interactive we auto-sweep around the rest point.
        let target;
        if (!interactive) {
            const sweep = reducedMotion ? 0 : Math.sin(elapsed * 0.22) * 0.12;
            target = Math.min(0.9, Math.max(0.1, splitPosition + sweep));
        }
        else {
            target = splitRef.current;
        }
        // Single source of truth for BOTH the effect mask and the handle
        // visual — smooth the same value lightly so cursor jitter is
        // dampened without introducing a visible lag between the line and
        // the underlying reveal. tau ≈ 60ms.
        const tau = 0.06;
        const k = 1 - Math.exp(-dt / tau);
        visSplitRef.current += (target - visSplitRef.current) * k;
        const vis = visSplitRef.current;
        // Push handle position directly to the DOM in the same frame as the
        // shader uniform — no React state, no re-render, no 1-frame lag
        // between the reveal and the visual handle. Both read `vis`.
        if (handleRef.current) {
            handleRef.current.style.transform =
                `translate(-50%, 0) translateX(${vis * c.clientWidth}px) rotate(${splitAngle}deg)`;
        }
        // ── Upload video frames ─────────────────────────────────────────
        const uploadVideo = (side, unit) => {
            if (side.isVideo && side.ready && side.video && side.video.readyState >= 2) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, side.tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, side.video);
            }
        };
        uploadVideo(before, 0);
        uploadVideo(after, 1);
        // Parallax direction from input (centred -1..1), eased lightly.
        const ix = interactive && input && typeof input.x === 'number' ? input.x : 0.5;
        const iy = interactive && input && typeof input.y === 'number' ? input.y : 0.5;
        const pdx = (ix - 0.5) * 2;
        const pdy = (iy - 0.5) * 2;
        const parScaled = parallaxStrength * 0.018;
        // ── Bind & draw ─────────────────────────────────────────────────
        gl.useProgram(p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, before.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, after.tex);
        const u = uRef.current;
        gl.uniform2f(u.u_resolution, c.width, c.height);
        gl.uniform2f(u.u_beforeSize, before.size.w, before.size.h);
        gl.uniform2f(u.u_afterSize, after.size.w, after.size.h);
        gl.uniform1f(u.u_split, vis);
        gl.uniform1f(u.u_angle, angleRad);
        gl.uniform1f(u.u_refraction, refractionStrength);
        gl.uniform1f(u.u_chroma, chromaStrength);
        gl.uniform1f(u.u_glowIntensity, glowIntensity);
        gl.uniform3f(u.u_glowColor, glowRGB[0], glowRGB[1], glowRGB[2]);
        gl.uniform1f(u.u_parallax, parScaled);
        gl.uniform2f(u.u_parallaxDir, pdx, pdy);
        gl.uniform3f(u.u_bgTone, bgRGB[0], bgRGB[1], bgRGB[2]);
        gl.uniform1f(u.u_time, elapsed);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    // Initial transform so first paint sits at the right place; subsequent
    // frames overwrite this via the rAF loop's direct DOM mutation.
    const initialTransform = `translate(-50%, 0) translateX(0px) rotate(${splitAngle}deg)`;
    return (_jsxs(_Fragment, { children: [_jsx("crazygl-stage", { style: { background: backgroundTone }, children: _jsx("canvas", { ref: canvasRef, className: "crazygl-bas-canvas", "aria-hidden": "true" }) }), _jsx("crazygl-overlay", { className: "crazygl-bas-overlay", "aria-hidden": "true", style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', overflow: 'hidden', zIndex: 2, pointerEvents: 'none' }, children: _jsx("div", { ref: handleRef, className: "crazygl-bas-divider", style: {
                        position: 'absolute',
                        top: '-10%',
                        height: '120%',
                        left: 0,
                        transform: initialTransform,
                        transformOrigin: '50% 50%',
                        willChange: 'transform',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }, children: handleStyle !== 'line' ? (_jsx("div", { className: "crazygl-bas-handle", "data-style": handleStyle, style: {
                            width: handleStyle === 'dot' ? 22 : 46,
                            height: handleStyle === 'dot' ? 22 : 46,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#0b1018',
                            flex: '0 0 auto',
                        }, children: handleStyle === 'arrows' ? (_jsxs("svg", { viewBox: "0 0 40 40", width: "26", height: "26", "aria-hidden": "true", children: [_jsx("path", { d: "M16 13 L9 20 L16 27", fill: "none", stroke: "currentColor", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M24 13 L31 20 L24 27", fill: "none", stroke: "currentColor", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round" })] })) : null })) : null }) }), showLabels && (beforeLabel || afterLabel) ? (_jsxs("crazygl-overlay", { className: "crazygl-bas-labels", "aria-hidden": "true", style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', zIndex: 2, pointerEvents: 'none' }, children: [beforeLabel ? _jsx("div", { className: "crazygl-bas-label", "data-side": "before", children: beforeLabel }) : null, afterLabel ? _jsx("div", { className: "crazygl-bas-label", "data-side": "after", children: afterLabel }) : null] })) : null, _jsx("crazygl-content", { children: content.node })] }));
}
export default function BeforeAfterSlider(props) {
    return _jsx(CrazyGLWrapper, { hero: BeforeAfterSliderHero, metadata: metadata, ...props });
}
export { metadata };
