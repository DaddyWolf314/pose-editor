// Renderer, camera, lights, camera orbit, gizmo, floor grid and theme. Knows nothing about figures.
import {
  Color, DirectionalLight, GridHelper, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  SRGBColorSpace, Scene, Texture, Vector3, WebGLRenderTarget, WebGLRenderer, type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { PhotoCamera } from '../pose/estimator';

export interface ThemeColors { stage: Color; grid: Color; handle: Color; prop: Color }

function cssVar(n: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly dom: HTMLCanvasElement;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.05, 100);
  readonly orbit: OrbitControls;
  /** Created before any other pointer listener on the canvas, so `tc.axis` is current when ours run. */
  readonly tc: TransformControls;

  private grid: GridHelper | null = null;
  private backdrop: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  private themeListeners: ((c: ThemeColors) => void)[] = [];
  private raf = 0;
  private cleanup: (() => void)[] = [];

  constructor(container: HTMLElement) {
    // Throws if WebGL is unavailable; the caller shows a message.
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.dom = this.renderer.domElement;
    container.appendChild(this.dom);

    this.camera.position.set(0.6, 1.45, 4.4);
    // three.js r155+ uses physically based light units; scaling by PI matches the r128 prototype's brightness.
    this.scene.add(new HemisphereLight(0xffffff, 0x7d8690, 0.95 * Math.PI));
    const sun = new DirectionalLight(0xffffff, 0.65 * Math.PI);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);

    this.orbit = new OrbitControls(this.camera, this.dom);
    this.orbit.target.set(0.3, 0.95, 0);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.12; this.orbit.maxPolarAngle = Math.PI * 0.52;
    this.tc = new TransformControls(this.camera, this.dom);
    this.tc.setSize(0.75);
    this.scene.add(this.tc.getHelper());

    const resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const applyTheme = () => this.applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.cleanup.push(() => ro.disconnect(), () => mq.removeEventListener('change', applyTheme), () => mo.disconnect());
    this.applyTheme();
  }

  /** Register a theme listener; it is called immediately and on every theme change. */
  onTheme(fn: (c: ThemeColors) => void): void {
    this.themeListeners.push(fn);
    fn(this.themeColors());
  }

  private themeColors(): ThemeColors {
    return {
      stage: new Color(cssVar('--stage') || '#dde2e6'),
      grid: new Color(cssVar('--grid') || '#b9c2c9'),
      handle: new Color(cssVar('--handle') || '#ffb000'),
      prop: new Color(cssVar('--prop') || '#a3acb4'),
    };
  }

  private applyTheme(): void {
    const c = this.themeColors();
    this.renderer.setClearColor(c.stage);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); this.grid.dispose(); }
    this.grid = new GridHelper(12, 24, c.grid, c.grid);
    this.scene.add(this.grid);
    this.themeListeners.forEach(fn => fn(c));
  }

  /**
   * Show a photo on a plane across the view of `cam`, far enough back to sit behind every figure.
   * Seen from `cam` (see `viewFrom`), it lines up with figures placed by the estimate.
   */
  setBackdrop(image: HTMLImageElement | null, cam?: PhotoCamera): void {
    if (this.backdrop) {
      this.backdrop.removeFromParent();
      this.backdrop.geometry.dispose(); this.backdrop.material.map?.dispose(); this.backdrop.material.dispose();
      this.backdrop = null;
    }
    if (!image || !cam) return;
    const pos = new Vector3(...cam.position), axis = new Vector3(...cam.target).sub(pos).normalize();
    const h = 2 * cam.backdropDistance * Math.tan((cam.fov / 2) * Math.PI / 180);
    const tex = new Texture(image);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    const plane = new Mesh(new PlaneGeometry(h * cam.aspect, h), new MeshBasicMaterial({ map: tex, toneMapped: false }));
    plane.position.copy(pos).addScaledVector(axis, cam.backdropDistance);
    plane.lookAt(pos);
    plane.raycast = () => {};
    this.scene.add(plane);
    this.backdrop = plane;
  }

  setBackdropVisible(on: boolean): void {
    if (this.backdrop) this.backdrop.visible = on;
  }

  /** Put the camera where the photo was taken from. */
  viewFrom(cam: PhotoCamera): void {
    this.camera.position.set(...cam.position);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    this.orbit.target.set(...cam.target);
    this.orbit.update();
  }

  /** Largest image side `capture` accepts. */
  get maxCaptureSize(): number {
    return Math.min(8192, this.renderer.capabilities.maxTextureSize);
  }

  /**
   * Render the view to a `width` by `height` image, without the grid, gizmo or photo, and with
   * `hide` hidden too. The image covers the largest centred rectangle of that aspect inside the view
   * (see `captureFrame`). `background` null leaves it transparent.
   */
  capture(width: number, height: number, background: Color | null, hide: readonly Object3D[]): HTMLCanvasElement {
    const cam = this.camera.clone();
    const aspect = width / height;
    // Narrower than the view: same vertical field, cropped sides. Wider: the vertical field shrinks.
    if (aspect > this.camera.aspect) {
      const t = Math.tan(MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect / aspect;
      cam.fov = MathUtils.radToDeg(2 * Math.atan(t));
    }
    cam.aspect = aspect;
    cam.updateProjectionMatrix();

    const r = this.renderer;
    const rt = new WebGLRenderTarget(width, height, {
      samples: Math.min(4, r.capabilities.maxSamples), colorSpace: SRGBColorSpace,
    });
    const hidden = [this.grid, this.tc.getHelper(), this.backdrop, ...hide].filter((o): o is Object3D => !!o && o.visible);
    const clear = r.getClearColor(new Color()), clearAlpha = r.getClearAlpha();
    const px = new Uint8Array(width * height * 4);
    try {
      hidden.forEach(o => { o.visible = false; });
      r.setClearColor(background ?? 0x000000, background ? 1 : 0);
      r.setRenderTarget(rt);
      r.clear();
      r.render(this.scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, width, height, px);
    } finally {
      r.setRenderTarget(null);
      r.setClearColor(clear, clearAlpha);
      hidden.forEach(o => { o.visible = true; });
      rt.dispose();
    }

    // WebGL rows run bottom to top. A transparent clear blends edges toward black, so unpremultiply.
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * row, dst = y * row;
      for (let i = 0; i < row; i += 4) {
        const a = px[src + i + 3];
        const k = !background && a > 0 && a < 255 ? 255 / a : 1;
        img.data[dst + i] = Math.min(255, px[src + i] * k);
        img.data[dst + i + 1] = Math.min(255, px[src + i + 1] * k);
        img.data[dst + i + 2] = Math.min(255, px[src + i + 2] * k);
        img.data[dst + i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  start(frame: () => void): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.orbit.update(); frame();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach(fn => fn());
    this.tc.detach(); this.tc.dispose(); this.orbit.dispose();
    this.grid?.dispose();
    this.setBackdrop(null);
    this.renderer.dispose();
    this.dom.remove();
  }
}
