// Milestone 3: the lit page. The score lies flat on a paper "desk" in the dark, lit by a
// spotlight that travels with the playhead; bloom + vignette in post.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPaperTextures } from './paper.js';
import { Glow } from './glow.js';
import { Balls } from './balls.js';
import { CameraRig } from './camera.js';

const WORLD_PER_PX = 1 / 300; // raster pixels -> world units

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 1.1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);
      float v = smoothstep(0.85, 0.2, length(d) * strength);
      gl_FragColor = vec4(c.rgb * mix(0.08, 1.0, v), c.a);
    }`,
};

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.maxTextureSize = Math.min(8192, this.renderer.capabilities.maxTextureSize);
    this.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.05);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    this.rig = new CameraRig(this.camera);
    this.rig.attachControls(canvas);

    this.scene.add(new THREE.HemisphereLight(0x9aa0b0, 0x000000, 0.12));
    // Cone angle sized so the lit circle on the paper is 25% wider than the original 0.6 rad cone.
    this.spot = new THREE.SpotLight(0xfff1e0, 1.4, 0, Math.atan(1.25 * Math.tan(0.6)), 1, 0);
    this.spot.castShadow = false;
    this.scene.add(this.spot, this.spot.target);

    const paperTex = createPaperTextures();
    paperTex.map.anisotropy = paperTex.bumpMap.anisotropy = this.anisotropy;
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: paperTex.map,
        bumpMap: paperTex.bumpMap,
        bumpScale: 0.6,
        roughness: 0.92,
        metalness: 0,
      }),
    );
    this.scene.add(this.paper);

    this.scoreGroup = new THREE.Group();
    this.scene.add(this.scoreGroup);
    this.glow = null;
    this.balls = null;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(VignetteShader));
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  /**
   * @param {{width: number, height: number, notes: Map, tiles: {canvas: HTMLCanvasElement, x: number, width: number}[]}} layout
   * @param {{notes: Map<string, {on: number, off: number}>, timemap: object[], durationMs: number}} score
   */
  setScore(layout, score) {
    this._clearScore();
    const k = WORLD_PER_PX;
    const toX = (px) => px * k;
    const toZ = (py) => (py - layout.height / 2) * k;
    const worldW = layout.width * k;
    const worldH = layout.height * k;

    // Ink layer: transparent tiles of the rasterized SVG, a hair above the paper.
    for (const tile of layout.tiles) {
      const tex = new THREE.CanvasTexture(tile.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.anisotropy;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(tile.width * k, worldH).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          roughness: 0.45, // printed ink has a faint sheen at grazing angles
          metalness: 0,
        }),
      );
      mesh.position.set(toX(tile.x + tile.width / 2), 0.001, 0);
      mesh.renderOrder = 1;
      this.scoreGroup.add(mesh);
    }

    // The desk-sized sheet of paper under the score.
    const margin = worldH * 4;
    this.paper.scale.set(worldW + margin * 2, 1, worldH * 6);
    this.paper.position.set(worldW / 2, 0, 0);
    const repeatPerUnit = 1 / 3;
    this.paper.material.map.repeat.set(this.paper.scale.x * repeatPerUnit, this.paper.scale.z * repeatPerUnit);
    this.paper.material.bumpMap.repeat.copy(this.paper.material.map.repeat);

    // Notes that are both engraved and timed.
    const notes = [];
    for (const [id, timing] of score.notes) {
      const pos = layout.notes.get(id);
      if (!pos) continue;
      notes.push({ id, ...timing, x: toX(pos.x), z: toZ(pos.y), w: pos.w * k, d: pos.h * k, staff: pos.staff, layer: pos.layer });
    }
    this.glow = new Glow(notes);
    this.scoreGroup.add(this.glow.group);
    this.balls = new Balls(notes);
    this.scoreGroup.add(this.balls.group);

    // Playhead path: leftmost onset x at each timemap event, kept monotonic.
    const keyframes = [];
    let lastX = -Infinity;
    for (const ev of score.timemap) {
      const xs = (ev.on ?? []).map((id) => layout.notes.get(id)?.x).filter((x) => x !== undefined);
      if (!xs.length) continue;
      lastX = Math.max(lastX, toX(Math.min(...xs)));
      keyframes.push({ t: ev.tstamp, x: lastX });
    }
    if (!keyframes.length) keyframes.push({ t: 0, x: 0 });
    keyframes.push({ t: score.durationMs + 1500, x: Math.min(worldW, lastX + worldH * 0.3) });
    const zCenter = notes.length ? notes.reduce((s, n) => s + n.z, 0) / notes.length : 0;
    this.rig.setPath(keyframes, zCenter, worldH);
    this.worldH = worldH;
  }

  _clearScore() {
    this.glow?.dispose();
    this.balls?.dispose();
    this.glow = null;
    this.balls = null;
    for (const child of [...this.scoreGroup.children]) {
      this.scoreGroup.remove(child);
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
    }
  }

  /**
   * @param {number} t score time (ms), from the audio clock
   * @param {number} dt frame delta (s)
   * @param {number} elapsed wall-clock seconds
   */
  render(t, dt, elapsed) {
    if (this.glow) {
      this.rig.update(t, dt, elapsed);
      this.glow.update(t);
      this.balls.update(t);
      const f = this.rig.focus;
      const s = this.worldH;
      this.spot.position.set(f.x - 0.1 * s, 1.6 * s, f.z + 0.5 * s);
      this.spot.target.position.set(f.x + 0.35 * s, 0, f.z - 0.05 * s);
    }
    this.composer.render(dt);
  }
}
