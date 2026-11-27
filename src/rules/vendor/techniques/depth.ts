// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/depth.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Depth: a React Three Fiber hero scene and a fragment-shader ground (reports/Expressive web
// audit.html, Part 2, "3D and WebGL heroes", and Part 3). Both read the look's colours in an
// effect, so the scene follows the look, and both cap the pixel ratio and stop off screen.
import type { Technique } from './types.js';

const SCENE_TSX = `import { Canvas, useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Color, type Mesh } from 'three';

/** A look colour as a three.js colour: whatever form look.css writes it in, the canvas parses it. */
function lookColor(el: Element, name: string): Color {
  const color = new Color(0.5, 0.5, 0.5);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = getComputedStyle(el).getPropertyValue(name).trim() || 'gray';
  ctx.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = ctx.getImageData(0, 0, 1, 1).data;
  return color.setRGB(r / 255, g / 255, b / 255, 'srgb');
}

function Sculpture({ color, still }: { color: Color; still: boolean }) {
  const mesh = useRef<Mesh>(null);
  useFrame((_state, delta) => {
    if (still || !mesh.current) return;
    mesh.current.rotation.y += delta * 0.25;
    mesh.current.rotation.x += delta * 0.06;
  });
  return (
    <mesh ref={mesh} rotation={[0.4, 0.6, 0]}>
      <icosahedronGeometry args={[1.1, 6]} />
      <meshPhysicalMaterial
        color={color}
        roughness={0.3}
        metalness={0.1}
        clearcoat={1}
        clearcoatRoughness={0.2}
      />
    </mesh>
  );
}

/**
 * The scene is one object built for this brand, never a generic floating blob. Replace the
 * geometry with the product (a glb from the project's files through drei's useGLTF) or a form
 * drawn from the brand's own world. The headline, copy and action stay in the DOM.
 */
export default function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [colors, setColors] = useState<{ brand: Color; accent: Color } | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setColors({ brand: lookColor(el, '--look-brand'), accent: lookColor(el, '--look-accent') });
    const observer = new IntersectionObserver(entries =>
      setVisible(entries.some(entry => entry.isIntersecting))
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const still = reduced === true;
  return (
    <section className="grid items-center gap-6 px-4 py-10 md:grid-cols-2 md:px-10">
      <div>
        <h1 className="font-[family-name:var(--look-heading)] text-5xl leading-[0.95] md:text-7xl">
          The lamp that follows the sun.
        </h1>
        <p className="mt-4 max-w-[38ch] text-lg">Warm at dawn, bright at noon, amber after dark.</p>
        <a
          href="#order"
          className="mt-6 inline-flex min-h-12 items-center rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
        >
          Pre-order
        </a>
      </div>
      <div
        ref={host}
        aria-hidden="true"
        className="relative h-[min(50svh,400px)] rounded-[calc(var(--look-radius)*2)] bg-(--look-surface) md:h-[min(70svh,560px)]"
      >
        {colors ? (
          <Canvas
            dpr={[1, 1.5]}
            frameloop={still || !visible ? 'demand' : 'always'}
            camera={{ position: [0, 0, 4], fov: 35 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
            fallback={null}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 4, 5]} intensity={2.2} color={colors.accent} />
            <directionalLight position={[-4, -2, -3]} intensity={0.5} />
            <Sculpture color={colors.brand} still={still} />
          </Canvas>
        ) : null}
      </div>
    </section>
  );
}
`;

const GROUND_TSX = `import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

const VERTEX = [
  'attribute vec2 uv;',
  'attribute vec2 position;',
  'varying vec2 vUv;',
  'void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }'
].join('\\n');

/** Slow flow: two octaves of value noise mix the look's ground, brand and accent, with grain. */
const FRAGMENT = [
  'precision highp float;',
  'uniform float uTime;',
  'uniform vec2 uRes;',
  'uniform vec3 uGround;',
  'uniform vec3 uBrand;',
  'uniform vec3 uAccent;',
  'varying vec2 vUv;',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float noise(vec2 p) {',
  '  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
  '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
  '}',
  'float fbm(vec2 p) {',
  '  float v = 0.0; float a = 0.5;',
  '  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }',
  '  return v;',
  '}',
  'void main() {',
  '  vec2 p = vUv * vec2(uRes.x / max(uRes.y, 1.0), 1.0) * 1.6;',
  '  float t = uTime * 0.04;',
  '  float n = fbm(p + vec2(t, -t) + fbm(p * 1.3 - t));',
  '  vec3 col = mix(uGround, uBrand, smoothstep(0.3, 0.8, n));',
  '  col = mix(col, uAccent, smoothstep(0.55, 0.95, fbm(p * 0.8 + t * 1.5)) * 0.55);',
  '  col += (hash(vUv * uRes + fract(uTime)) - 0.5) * 0.035;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\\n');

/** A look colour as linear numbers for a uniform. */
function lookRgb(el: Element, name: string): [number, number, number] {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return [0.5, 0.5, 0.5];
  ctx.fillStyle = getComputedStyle(el).getPropertyValue(name).trim() || 'gray';
  ctx.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/**
 * A shader ground behind the opener's type. The CSS gradient under it is the still and the
 * fallback: it shows before the first frame, without WebGL, and in stills.
 */
export function ShaderGround({ children }: { children?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: Renderer;
    try {
      renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 1.5), alpha: false });
    } catch {
      return; // No WebGL: the CSS ground stays.
    }
    const gl = renderer.gl;
    if (!gl) return;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:-1';
    el.prepend(canvas);

    const speed = parseFloat(getComputedStyle(el).getPropertyValue('--look-motion')) || 1;
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uRes: { value: [1, 1] },
        uGround: { value: lookRgb(el, '--look-bg') },
        uBrand: { value: lookRgb(el, '--look-brand') },
        uAccent: { value: lookRgb(el, '--look-accent') }
      }
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const still = reduced === true || speed === 0;

    const draw = (ms: number) => {
      program.uniforms.uTime!.value = (ms / 1000) * speed;
      renderer.render({ scene: mesh });
    };
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      program.uniforms.uRes!.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      draw(still ? 12000 : performance.now());
    };
    const resizer = new ResizeObserver(resize);
    resizer.observe(el);
    resize();

    let frame = 0;
    let visible = true;
    const tick = (ms: number) => {
      draw(ms);
      frame = visible && !still ? requestAnimationFrame(tick) : 0;
    };
    const watcher = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible && !still && !frame) frame = requestAnimationFrame(tick);
    });
    watcher.observe(el);
    if (!still) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      resizer.disconnect();
      watcher.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, [reduced]);

  return (
    <div
      ref={host}
      className="relative isolate overflow-clip"
      style={{
        background:
          'linear-gradient(160deg, var(--look-bg) 10%, color-mix(in oklch, var(--look-brand) 55%, var(--look-bg)) 60%, color-mix(in oklch, var(--look-accent) 45%, var(--look-bg)))'
      }}
    >
      {children}
    </div>
  );
}

export default function ShaderGroundDemo() {
  return (
    <ShaderGround>
      <div className="px-4 py-24 md:px-10 md:py-40">
        <h1 className="max-w-[12ch] font-[family-name:var(--look-heading)] text-5xl leading-[0.95] md:text-8xl">
          Sound you can stand in.
        </h1>
        <a
          href="#listen"
          className="mt-8 inline-flex min-h-12 items-center rounded-(--look-radius) bg-(--look-text) px-6 text-lg text-(--look-bg)"
        >
          Hear the room
        </a>
      </div>
    </ShaderGround>
  );
}
`;

export const DEPTH_TECHNIQUES: Technique[] = [
  {
    id: 'r3f-hero-scene',
    name: 'React Three Fiber hero scene',
    styles: ['3d-webgl'],
    summary:
      "A real-time 3D object beside the opener's type, in look colours, with the pixel ratio capped at 1.5 and a still under reduced motion.",
    keywords: [
      '3d',
      'three',
      'three.js',
      'r3f',
      'webgl',
      'scene',
      'model',
      'product',
      'object',
      'spin',
      'hero',
      'glb',
      'render'
    ],
    use: "For products with a physical form, launches and studios selling craft. Build one object for this brand: the product as a glb from the project's files (useGLTF from @react-three/drei with a /api/files/project/ path), or a form from the brand's world. drei's Environment presets load from another site: light with lights instead. Never a generic blob; never the only place the facts live.",
    code: [{ path: 'parts/hero-scene.tsx', content: SCENE_TSX }],
    needs: {
      packages: ['@react-three/fiber', 'three', 'motion/react'],
      browsers: 'WebGL in every current browser; WebGPU not needed.',
      assets: "Optional: a glb or gltf model, and ktx2 or hdr files, in the project's files."
    },
    cost: {
      bytes: 'About 150 KB gzipped for three and R3F, plus models.',
      phone:
        'Needs care: DPR capped at 1.5, the loop stops off screen, low-power GPU asked for, the box shorter at 390 px.'
    },
    floors: {
      reducedMotion: 'The object is drawn once and does not turn (frameloop "demand").',
      phone:
        'The scene sits under the type, at most half the screen tall; the action stays above it.',
      fallback: 'A plain surface where WebGL is missing; the DOM keeps every word and the action.'
    },
    checks: [
      {
        id: 'bytes-before-interaction',
        what: 'The bundle and models before the first interaction at 390 px.'
      },
      { id: 'dropped-frames', what: 'The turning object on a throttled phone.' },
      { id: 'motion-under-reduced', what: 'The object is still under reduced motion.' },
      { id: 'overflow-390', what: 'The canvas fits at 390 px.' }
    ]
  },
  {
    id: 'shader-ground',
    name: 'Fragment-shader ground',
    styles: ['3d-webgl', 'grain-mesh'],
    summary:
      "One full-screen triangle and a slow-flow fragment shader in OGL, mixing the look's ground, brand and accent, with grain.",
    keywords: [
      'shader',
      'glsl',
      'webgl',
      'ogl',
      'ground',
      'background',
      'flow',
      'noise',
      'aurora',
      'atmosphere',
      'gradient',
      'animated'
    ],
    use: "Behind type when the opener needs atmosphere and there is no photograph: 80% of a 3D scene at 5% of the weight. Change the shader's shape (flow, noise field, caustics) to suit the brand; the colours always come from the look through the uniforms. Keep text on the calmest part and check it.",
    code: [{ path: 'parts/shader-ground.tsx', content: GROUND_TSX }],
    needs: {
      packages: ['ogl', 'motion/react'],
      browsers: 'WebGL in every current browser.',
      assets: 'None.'
    },
    cost: {
      bytes: 'About 10 KB for OGL plus 2 KB of shader.',
      phone: 'Good with the DPR cap; the loop stops off screen and speed follows --look-motion.'
    },
    floors: {
      reducedMotion: 'One still frame, drawn again only on resize.',
      phone: 'Same shader at DPR 1.5 at most; the type keeps its own size rules.',
      fallback:
        'The CSS gradient of look colours under the canvas: before the first frame, without WebGL, and in stills.'
    },
    checks: [
      { id: 'contrast-behind', what: 'The headline against the rendered shader frame behind it.' },
      { id: 'dropped-frames', what: 'The flow on a throttled phone.' },
      { id: 'motion-under-reduced', what: 'The ground is one still frame under reduced motion.' }
    ]
  }
];
