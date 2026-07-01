<sub>*Hero made by [@ybouane](https://x.com/ybouane).*</sub>
<p align="center">
  <img src="https://crazygl.com/heroes/hero-before-after-slider/banner-full.png" alt="Cinematic Before / After Slider" width="640">
</p>

# @crazygl/hero-before-after-slider

Two images or videos blended in 3D across a glowing, draggable glass divider. The split refracts the scene with a chromatic edge, the whole plane tilts on pointer parallax, and corner labels call out before and after — a transformation showcase for AI enhancement, photo and video editing, design tools, and beauty tech.

## Demo
[Cinematic Before / After Slider](https://crazygl.com/hero/before-after-slider)

## Install

```bash
npm install @crazygl/hero-before-after-slider
```

## Usage

```tsx
import BeforeAfterSlider from '@crazygl/hero-before-after-slider';

export default function Hero() {
  return (
    <BeforeAfterSlider
      beforeMedia="https://example.com/raw.jpg"
      afterMedia="https://example.com/enhanced.jpg"
      splitPosition={0.5}
      glowColor="#bfe3ff"
    />
  );
}
```

## Customise

- **Media** — `beforeMedia` / `afterMedia` (photo or video, AVIF/WebP/PNG/JPG/MP4/WebM, cover-fitted), plus `beforeLabel` / `afterLabel` / `showLabels` corner tags.
- **Divider** — `splitPosition` (rest position 0.1–0.9), `splitAngle` (−30°–30° tilt), `refractionStrength`, `chromaStrength`, and `handleStyle` (arrows / dot / line).
- **Glow & light** — `glowColor`, `glowIntensity`, `parallaxStrength` (pointer shear), `backgroundTone`.
- **Content** — heading / two-columns / custom slot with optional `headingFontFamily`.

## Best for

- AI photo / video enhancement tools showing a clear transformation.
- Image and video editors, retouching and design apps.
- Beauty-tech and skincare brands (before/after results).
- Any product launch whose story is a side-by-side comparison.



This hero is part of [CrazyGL](https://crazygl.com), a collection of production-ready WebGL, canvas, 3D, and typography effects. Every CrazyGL hero ships with an agent-ready `SKILL.md` file that helps developers and coding agents adapt the effect into custom landing pages and interactive experiences.
