import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type Office3DProps = {
  working: number;
  waiting: number;
  scheduled: number;
  done: number;
  headline?: string;
  tasks?: string[];
  desks: { name: string; short: string }[];
  mood: "working" | "waiting" | "resting";
  phase: "dawn" | "day" | "dusk" | "night";
};

type ViewKey = "panorama" | "boss" | "closeup";

const VIEWS: Record<ViewKey, { theta: number; phi: number; radius: number; tx: number; ty: number; tz: number }> = {
  // 全景： high isometric overview; 老板视角： low, close front-side with depth;
  // 近景： pushes right into the main desk so Muse fills the frame.
  panorama: { theta: 0.62, phi: 0.95, radius: 19.5, tx: 0, ty: 1.2, tz: -0.6 },
  boss: { theta: -0.58, phi: 1.34, radius: 11.2, tx: 0, ty: 1.25, tz: -1.2 },
  closeup: { theta: 0.3, phi: 1.1, radius: 4.7, tx: 0, ty: 1.5, tz: -3.4 },
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const BUBBLE_CYCLE = ["干活中", "喝口茶", "干活中", "想一下", "干活中", "伸个懒腰"];
const PHASE_AMBIENT: Record<Office3DProps["phase"], number> = {
  dawn: 0.5, day: 0.62, dusk: 0.45, night: 0.38,
};

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext("2d")! };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWallScreen(ctx: CanvasRenderingContext2D, w: number, h: number, p: Office3DProps) {
  ctx.fillStyle = "#0c1524";
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "rgba(43,64,102,0.5)");
  grad.addColorStop(1, "rgba(12,21,36,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e8a33d";
  ctx.font = "600 27px 'Noto Serif SC', serif";
  ctx.textAlign = "left";
  ctx.fillText("状态墙", 40, 50);
  ctx.fillStyle = "#7e8ea8";
  ctx.font = "17px sans-serif";
  ctx.fillText("与下方大屏同源 · 拍板销项即时同步", 138, 50);

  // — left: task list with the headline task highlighted (video layout) —
  const headline = p.headline ?? "暂无进行中的事";
  ctx.fillStyle = "rgba(232,163,61,0.13)";
  roundRect(ctx, 40, 72, 580, 86, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,163,61,0.65)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#e8a33d";
  ctx.font = "600 19px sans-serif";
  ctx.fillText("Muse 正在干", 62, 102);
  ctx.fillStyle = "#f2ede2";
  ctx.font = "600 23px sans-serif";
  const hl = headline.length > 24 ? `${headline.slice(0, 24)}…` : headline;
  ctx.fillText(hl, 62, 138);
  const tasks = (p.tasks ?? []).filter((t) => t !== p.headline).slice(0, 2);
  ctx.font = "20px sans-serif";
  tasks.forEach((t, i) => {
    const y = 196 + i * 42;
    ctx.fillStyle = "#5aa79b";
    ctx.beginPath();
    ctx.arc(56, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c3cede";
    const line = t.length > 30 ? `${t.slice(0, 30)}…` : t;
    ctx.fillText(line, 76, y);
  });
  if (tasks.length === 0) {
    ctx.fillStyle = "#7e8ea8";
    ctx.font = "19px sans-serif";
    ctx.fillText("任务清单在下方大屏查看完整版", 76, 200);
  }

  // — right: four count pills, same source as the boards below —
  const cells: { label: string; value: number; color: string }[] = [
    { label: "正在干", value: p.working, color: "#e8a33d" },
    { label: "等你拍板", value: p.waiting, color: "#eda3ad" },
    { label: "定时任务", value: p.scheduled, color: "#b9c6da" },
    { label: "今日已完成", value: p.done, color: "#5aa79b" },
  ];
  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 652 + col * 168;
    const y = 72 + row * 100;
    ctx.fillStyle = "rgba(33,51,79,0.9)";
    roundRect(ctx, x, y, 152, 86, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(214,226,245,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = cell.color;
    ctx.font = "700 40px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(cell.value), x + 76, y + 44);
    ctx.fillStyle = "#d7dde8";
    ctx.font = "18px sans-serif";
    ctx.fillText(cell.label, x + 76, y + 70);
    ctx.textAlign = "left";
  });
}

function drawMiniScreen(ctx: CanvasRenderingContext2D, w: number, h: number, p: Office3DProps, tick: number, variant: number) {
  ctx.fillStyle = variant % 2 === 0 ? "#101d33" : "#0e1a2e";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e8a33d";
  ctx.fillRect(0, 0, w, 26);
  ctx.fillStyle = "#241703";
  ctx.font = "700 15px sans-serif";
  ctx.fillText(variant === 0 ? "状态墙 · 迷你版" : "工作中", 10, 18);
  const lines = [
    `正在干  ${p.working} 件`,
    `等拍板  ${p.waiting} 件`,
    `已完成  ${p.done} 件`,
  ];
  ctx.font = "19px sans-serif";
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 1 && p.waiting > 0 ? "#eda3ad" : "#d7dde8";
    ctx.fillText(line, 14, 62 + i * 32);
  });
  // scrolling code-ish lines at the bottom — pure ambience flicker
  ctx.fillStyle = "rgba(90,167,155,0.75)";
  ctx.font = "12px monospace";
  for (let i = 0; i < 3; i++) {
    const y = 168 + i * 16;
    const off = (tick * (6 + i * 3) + i * 37) % 60;
    ctx.fillRect(14, y, 90 - off, 5);
    ctx.fillRect(120, y, 60 + off / 2, 5);
  }
}

function drawDeskScreen(ctx: CanvasRenderingContext2D, w: number, h: number, _color: string, tick: number, seed: number) {
  // Dark-green code screen like the reference hall: scrolling code/status lines.
  ctx.fillStyle = "#0b2921";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f3d2f";
  ctx.fillRect(0, 0, w, 16);
  ctx.fillStyle = "#57d9a3";
  ctx.beginPath();
  ctx.arc(10, 8, 3, 0, Math.PI * 2);
  ctx.arc(22, 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "11px monospace";
  const scroll = Math.floor(tick / 7) % 3;
  for (let row = 0; row < 6; row++) {
    const eff = row + scroll;
    const len = 34 + ((seed * 31 + eff * 47) % 100);
    const indent = (eff % 3) * 14;
    ctx.fillStyle = eff % 3 === 0 ? "rgba(140,240,200,0.9)" : eff % 3 === 1 ? "rgba(87,217,163,0.75)" : "rgba(190,220,200,0.65)";
    ctx.fillRect(10 + indent, 28 + row * 22, len, 6);
    if (eff % 2 === 0) ctx.fillRect(24 + indent + len, 28 + row * 22, 30, 6);
  }
}

/**
 * Two-tier station label, as in the reference video: a white name pill with a
 * green dot on top, and a pale blue-grey status pill below it (status word only).
 */
function drawStationLabel(
  ctx: CanvasRenderingContext2D, w: number, h: number, name: string, status: string,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  // name pill
  ctx.font = "600 37px sans-serif";
  const nameW = Math.min(w - 30, ctx.measureText(name).width + 92);
  const nx = (w - nameW) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  roundRect(ctx, nx, 14, nameW, 64, 32);
  ctx.fill();
  ctx.fillStyle = "#3fae6a";
  ctx.beginPath();
  ctx.arc(nx + 32, 46, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#14202f";
  ctx.fillText(name, w / 2 + 14, 60);
  // status pill
  ctx.font = "600 33px sans-serif";
  const stW = Math.min(w - 60, ctx.measureText(status).width + 56);
  const sx = (w - stW) / 2;
  ctx.fillStyle = "rgba(201,214,232,0.96)";
  roundRect(ctx, sx, 92, stW, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#1d3355";
  ctx.fillText(status, w / 2, 132);
  ctx.textAlign = "left";
}

function stationSprite(name: string, status: string) {
  const { canvas, ctx } = makeCanvas(512, 168);
  drawStationLabel(ctx, 512, 168, name, status);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.15, 0.71, 1);
  return { sprite, canvas, ctx, tex };
}

export function Office3D(props: Office3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const camRef = useRef({
    theta: VIEWS.panorama.theta, phi: VIEWS.panorama.phi, radius: VIEWS.panorama.radius,
    tx: VIEWS.panorama.tx, ty: VIEWS.panorama.ty, tz: VIEWS.panorama.tz,
    dTheta: VIEWS.panorama.theta, dPhi: VIEWS.panorama.phi, dRadius: VIEWS.panorama.radius,
    dTx: VIEWS.panorama.tx, dTy: VIEWS.panorama.ty, dTz: VIEWS.panorama.tz,
    vTheta: 0, vPhi: 0, inertia: false,
  });
  const rotateRef = useRef<{ mode: "off" | "once" | "auto"; startTheta: number }>({ mode: "off", startTheta: 0 });
  // True while the user is dragging: auto-rotation pauses, then resumes on release.
  const pausedRef = useRef(false);
  const subWorkersRef = useRef<THREE.Group[]>([]);
  const [view, setView] = useState<ViewKey>("panorama");
  const [rotating, setRotating] = useState<"off" | "once" | "auto">("off");
  const [error, setError] = useState<string | null>(null);

  const stopRotate = () => {
    rotateRef.current.mode = "off";
    setRotating("off");
  };

  const goView = (key: ViewKey) => {
    const v = VIEWS[key];
    const c = camRef.current;
    c.dTheta = v.theta; c.dPhi = v.phi; c.dRadius = v.radius;
    c.dTx = v.tx; c.dTy = v.ty; c.dTz = v.tz;
    c.vTheta = 0; c.vPhi = 0; c.inertia = false;
    setView(key);
    stopRotate();
  };

  const startPatrolOnce = () => {
    if (rotateRef.current.mode === "once") { stopRotate(); return; }
    rotateRef.current = { mode: "once", startTheta: camRef.current.dTheta };
    setRotating("once");
  };

  const toggleAuto = () => {
    if (rotateRef.current.mode === "auto") { stopRotate(); return; }
    rotateRef.current = { mode: "auto", startTheta: camRef.current.dTheta };
    setRotating("auto");
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    subWorkersRef.current = [];
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError("这台设备的浏览器没能开启 3D 渲染，下面的办公室数据照常可用。");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b111e");
    scene.fog = new THREE.Fog("#0b111e", 34, 62);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);

    // ——— lights ———
    const ambient = new THREE.AmbientLight("#5a6f96", PHASE_AMBIENT[propsRef.current.phase]);
    scene.add(ambient);
    const key = new THREE.DirectionalLight("#ffd9a0", 1.5);
    key.position.set(6, 11, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -13; key.shadow.camera.right = 13;
    key.shadow.camera.top = 13; key.shadow.camera.bottom = -13;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const fill = new THREE.DirectionalLight("#7ea0d8", 0.4);
    fill.position.set(-8, 6, -4);
    scene.add(fill);
    const lampLight = new THREE.PointLight("#e8a33d", 30, 16, 1.8);
    lampLight.position.set(0, 4.6, -2.8);
    scene.add(lampLight);

    // ——— materials ———
    const matFloor = new THREE.MeshStandardMaterial({ color: "#182a46", roughness: 0.85, metalness: 0.05 });
    const matWall = new THREE.MeshStandardMaterial({ color: "#131f36", roughness: 0.95 });
    const matWallSide = new THREE.MeshStandardMaterial({ color: "#101a2d", roughness: 0.95 });
    const matDeskTop = new THREE.MeshStandardMaterial({ color: "#2e4a73", roughness: 0.45, metalness: 0.15 });
    const matDeskBody = new THREE.MeshStandardMaterial({ color: "#1a2940", roughness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: "#0d1523", roughness: 0.5, metalness: 0.3 });
    const matAmber = new THREE.MeshStandardMaterial({ color: "#e8a33d", emissive: "#e8a33d", emissiveIntensity: 0.9, roughness: 0.4 });
    const matWoodLight = new THREE.MeshStandardMaterial({ color: "#c9a26b", roughness: 0.55, metalness: 0.05 });
    const matWhiteDesk = new THREE.MeshStandardMaterial({ color: "#e9e7de", roughness: 0.5, metalness: 0.05 });
    const matMintRug = new THREE.MeshStandardMaterial({ color: "#69b39c", roughness: 1 });
    const matSage = new THREE.MeshStandardMaterial({ color: "#7d9b76", roughness: 0.85 });
    const matCream = new THREE.MeshStandardMaterial({ color: "#f6ead2", roughness: 0.9 });
    const matCheek = new THREE.MeshStandardMaterial({ color: "#f3b8a0", roughness: 0.9 });
    const matEye = new THREE.MeshStandardMaterial({ color: "#3d2f1e", roughness: 0.35 });

    // ——— room ———
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.2, 17), matFloor);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);
    // floor inlay lines
    const lineMat = new THREE.MeshBasicMaterial({ color: "#e8a33d", transparent: true, opacity: 0.16 });
    for (const x of [-6, 0, 6]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 16.6), lineMat);
      l.position.set(x, 0.006, 0);
      scene.add(l);
    }
    // Each wall gets its own cloned material: walls fade out individually
    // when the camera orbits behind them (see applyFades in the loop).
    const matBackWall = matWall.clone();
    const matWallLeft = matWallSide.clone();
    const matWallRight = matWallSide.clone();
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 0.3), matBackWall);
    backWall.position.set(0, 4, -7.2);
    backWall.receiveShadow = true;
    scene.add(backWall);
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 17), matWallLeft);
    leftWall.position.set(-11, 4, 0);
    scene.add(leftWall);
    const rightWall = new THREE.Mesh(leftWall.geometry, matWallRight);
    rightWall.position.set(11, 4, 0);
    scene.add(rightWall);
    // window mullions on the back wall
    const mullMat = new THREE.MeshBasicMaterial({ color: "#dbe7ff", transparent: true, opacity: 0.07 });
    const backMullions: THREE.Mesh[] = [];
    for (const x of [-6, 6]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 8, 0.02), mullMat);
      m.position.set(x, 4, -7.02);
      scene.add(m);
      backMullions.push(m);
    }

    // ——— wall screen (live counts) ———
    const wallC = makeCanvas(1024, 300);
    drawWallScreen(wallC.ctx, 1024, 300, propsRef.current);
    const wallTex = new THREE.CanvasTexture(wallC.canvas);
    wallTex.colorSpace = THREE.SRGBColorSpace;
    wallTex.anisotropy = 8;
    const wallFrame = new THREE.Mesh(new THREE.BoxGeometry(10.4, 3.3, 0.14), matDark.clone());
    wallFrame.position.set(0, 4.9, -7.0);
    scene.add(wallFrame);
    const wallScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.95),
      new THREE.MeshBasicMaterial({ map: wallTex, transparent: true }),
    );
    wallScreen.position.set(0, 4.9, -6.92);
    scene.add(wallScreen);

    // ——— desk builder ———
    const screenUpdaters: { redraw: (tick: number) => void }[] = [];
    function buildDesk(
      w = 2.1, d = 1.05,
      topMat: THREE.Material = matDeskTop,
      chairMat: THREE.Material = matDeskBody,
      chairSide: 1 | -1 = 1,
    ): THREE.Group {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), topMat);
      top.position.y = 0.78;
      top.castShadow = true; top.receiveShadow = true;
      g.add(top);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, d - 0.15), matDeskBody);
        leg.position.set(sx * (w / 2 - 0.12), 0.39, 0);
        leg.castShadow = true;
        g.add(leg);
      }
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.55), chairMat);
      seat.position.y = 0.48;
      seat.castShadow = true;
      chair.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.09), chairMat);
      back.position.set(0, 0.98, 0.28 * chairSide);
      back.castShadow = true;
      chair.add(back);
      chair.position.set(0, 0, chairSide * (d / 2 + 0.42));
      g.add(chair);
      return g;
    }
    function buildMonitor(w: number, h: number, tex: THREE.CanvasTexture): THREE.Group {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, h + 0.07, 0.05), matDark);
      frame.castShadow = true;
      g.add(frame);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.z = 0.028;
      g.add(screen);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), matDark);
      stand.position.y = -(h / 2) - 0.14;
      g.add(stand);
      return g;
    }
    function monitorTexture(draw: (ctx: CanvasRenderingContext2D, tick: number) => void, w = 256, h = 176) {
      const c = makeCanvas(w, h);
      draw(c.ctx, 0);
      const tex = new THREE.CanvasTexture(c.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      screenUpdaters.push({
        redraw: (tick) => { draw(c.ctx, tick); tex.needsUpdate = true; },
      });
      return tex;
    }

    // ——— main workstation: big light-wood boss desk against the back wall (scene A) ———
    const MAIN_Z = -3.7;
    const mainDesk = buildDesk(4.2, 1.6, matWoodLight, matDeskBody, -1);
    mainDesk.position.set(0, 0, MAIN_Z);
    scene.add(mainDesk);

    const miniTexL = monitorTexture((ctx, tick) => drawMiniScreen(ctx, 256, 176, propsRef.current, tick, 0));
    const miniTexR = monitorTexture((ctx, tick) => drawMiniScreen(ctx, 256, 176, propsRef.current, tick, 1));
    const monL = buildMonitor(1.3, 0.88, miniTexL);
    monL.position.set(-0.75, 1.34, MAIN_Z - 0.25);
    monL.rotation.y = 0.16;
    scene.add(monL);
    const monR = buildMonitor(1.3, 0.88, miniTexR);
    monR.position.set(0.75, 1.34, MAIN_Z - 0.25);
    monR.rotation.y = -0.16;
    scene.add(monR);
    // keyboard glow strip
    const kb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.34), matDark);
    kb.position.set(0, 0.85, MAIN_Z + 0.35);
    scene.add(kb);
    const kbGlow = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.012, 0.28),
      new THREE.MeshBasicMaterial({ color: "#e8a33d", transparent: true, opacity: 0.35 }));
    kbGlow.position.set(0, 0.87, MAIN_Z + 0.35);
    scene.add(kbGlow);

    // ——— Muse plush at the main desk ———
    const muse = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 40, 28), matCream);
    body.scale.set(1, 0.92, 0.88);
    body.position.y = 0.62;
    body.castShadow = true;
    muse.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.56, 48, 36), matCream);
    head.position.y = 1.42;
    head.castShadow = true;
    muse.add(head);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), matEye);
      eye.position.set(sx * 0.19, 1.5, 0.5);
      muse.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#fff8ea" }));
      glint.position.set(sx * 0.19 + 0.02, 1.54, 0.55);
      muse.add(glint);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), matCheek);
      cheek.scale.set(1, 0.75, 0.35);
      cheek.position.set(sx * 0.33, 1.34, 0.46);
      muse.add(cheek);
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), matCream);
      arm.scale.set(1, 0.7, 1.5);
      arm.position.set(sx * 0.52, 0.78, 0.28);
      arm.castShadow = true;
      muse.add(arm);
    }
    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.02, 10, 24, Math.PI),
      matEye,
    );
    mouth.position.set(0, 1.32, 0.53);
    mouth.rotation.z = Math.PI;
    muse.add(mouth);
    muse.position.set(0, 0.55, MAIN_Z - 1.05);
    scene.add(muse);

    const mainLabel = stationSprite("Muse · 主工位", BUBBLE_CYCLE[0]!);
    mainLabel.sprite.scale.set(2.5, 0.82, 1);
    mainLabel.sprite.position.set(0, 3.15, MAIN_Z - 0.9);
    scene.add(mainLabel.sprite);

    // desk lamp over the main workstation
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 10), matDark);
    lampPole.position.set(-1.85, 1.35, MAIN_Z - 0.3);
    scene.add(lampPole);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 20, 1, true), matAmber);
    lampShade.position.set(-1.85, 1.95, MAIN_Z - 0.3);
    lampShade.rotation.x = 0.5;
    scene.add(lampShade);

    // ——— five business desks: front grid like the reference hall (scene B) ———
    // Each station: mint round rug, white desk, dual dark-green code screens,
    // sage high-back chair, one chibi worker (big head, small body) seated.
    const positions: { x: number; z: number }[] = [
      { x: -5.4, z: -0.6 },
      { x: 0, z: -0.6 },
      { x: 5.4, z: -0.6 },
      { x: -2.9, z: 2.9 },
      { x: 2.9, z: 2.9 },
    ];
    const accentColors = ["#d9707e", "#5aa79b", "#e8a33d", "#7ea0d8", "#b9c6da"];
    propsRef.current.desks.slice(0, 5).forEach((desk, i) => {
      const pos = positions[i];
      if (!pos) return;
      const accent = accentColors[i % accentColors.length]!;

      const rugDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.025, 36), matMintRug);
      rugDisc.position.set(pos.x, 0.013, pos.z - 0.3);
      rugDisc.receiveShadow = true;
      scene.add(rugDisc);

      const g = buildDesk(2.3, 1.1, matWhiteDesk, matSage, -1);
      g.position.set(pos.x, 0, pos.z);
      scene.add(g);

      for (const sx of [-0.52, 0.52]) {
        const tex = monitorTexture((ctx, tick) => drawDeskScreen(ctx, 256, 176, accent, tick, i * 2 + (sx > 0 ? 2 : 1)));
        const mon = buildMonitor(0.92, 0.64, tex);
        mon.position.set(pos.x + sx, 1.2, pos.z - 0.18);
        mon.rotation.y = sx > 0 ? -0.14 : 0.14;
        scene.add(mon);
      }

      // chibi worker: big head, small body, seated — only head & shoulders read over the desk
      const worker = new THREE.Group();
      const wBody = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 14),
        new THREE.MeshStandardMaterial({ color: accent, roughness: 0.85 }));
      wBody.scale.set(1, 0.85, 0.8);
      wBody.position.y = 0.52;
      wBody.castShadow = true;
      worker.add(wBody);
      const wHead = new THREE.Mesh(new THREE.SphereGeometry(0.34, 26, 20), matCream);
      wHead.position.y = 1.02;
      wHead.castShadow = true;
      worker.add(wHead);
      for (const sx of [-1, 1]) {
        const wEye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), matEye);
        wEye.position.set(sx * 0.11, 1.06, 0.3);
        worker.add(wEye);
      }
      worker.position.set(pos.x, 0.42, pos.z - 0.98);
      worker.userData.baseY = worker.position.y;
      worker.userData.phase = i * 1.3;
      scene.add(worker);
      subWorkersRef.current.push(worker);

      // two-tier floating label: name pill + status pill
      const label = stationSprite(desk.name, desk.short);
      label.sprite.position.set(pos.x, 2.6, pos.z - 0.4);
      scene.add(label.sprite);
    });

    // one walker crossing the hall — a small ambient figure, kept subtle
    const walker = new THREE.Group();
    const wkBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12),
      new THREE.MeshStandardMaterial({ color: "#7ea0d8", roughness: 0.85 }));
    wkBody.scale.set(1, 0.9, 0.8);
    wkBody.position.y = 0.5;
    walker.add(wkBody);
    const wkHead = new THREE.Mesh(new THREE.SphereGeometry(0.31, 24, 18), matCream);
    wkHead.position.y = 0.98;
    wkHead.castShadow = true;
    walker.add(wkHead);
    walker.position.set(-8.5, 0.42, 1.4);
    scene.add(walker);

    // ——— props: main rug, plants, window night view, orange sofa (scene A) ———
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.03, 40),
      new THREE.MeshStandardMaterial({ color: "#21334f", roughness: 1 }));
    rug.position.set(0, 0.015, MAIN_Z - 0.4);
    rug.receiveShadow = true;
    scene.add(rug);
    const plantMat = new THREE.MeshStandardMaterial({ color: "#3f7a5e", roughness: 0.9 });
    for (const px of [-9.6, 9.6]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.5, 14), matDeskBody);
      pot.position.set(px, 0.25, -5.6);
      pot.castShadow = true;
      scene.add(pot);
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), plantMat);
      foliage.scale.y = 1.25;
      foliage.position.set(px, 1.05, -5.6);
      foliage.castShadow = true;
      scene.add(foliage);
    }
    const clockRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 10, 32), matAmber.clone());
    clockRing.position.set(-8.6, 5.6, -7.0);
    scene.add(clockRing);

    // floor-to-ceiling window on the left wall: blue night city with lit windows
    const cityC = makeCanvas(768, 384);
    {
      const cx = cityC.ctx;
      const skyGrad = cx.createLinearGradient(0, 0, 0, 384);
      skyGrad.addColorStop(0, "#081426");
      skyGrad.addColorStop(1, "#16345e");
      cx.fillStyle = skyGrad;
      cx.fillRect(0, 0, 768, 384);
      let seedN = 7;
      const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
      for (let b = 0; b < 16; b++) {
        const bw = 34 + rnd() * 46;
        const bh = 130 + rnd() * 220;
        const bx = b * 48 + rnd() * 10;
        const by = 384 - bh;
        cx.fillStyle = b % 3 === 0 ? "#0d1f3a" : "#10294e";
        cx.fillRect(bx, by, bw, bh);
        for (let wy = by + 10; wy < 372; wy += 15) {
          for (let wx = bx + 5; wx < bx + bw - 7; wx += 11) {
            if (rnd() > 0.45) {
              cx.fillStyle = rnd() > 0.3 ? "rgba(255,196,110,0.9)" : "rgba(160,210,255,0.85)";
              cx.fillRect(wx, wy, 5, 7);
            }
          }
        }
      }
    }
    const cityTex = new THREE.CanvasTexture(cityC.canvas);
    cityTex.colorSpace = THREE.SRGBColorSpace;
    const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 5.2),
      new THREE.MeshBasicMaterial({ map: cityTex, transparent: true }));
    windowPane.rotation.y = Math.PI / 2;
    windowPane.position.set(-10.8, 3.6, -0.6);
    scene.add(windowPane);
    const frameMat = new THREE.MeshStandardMaterial({ color: "#0d1523", roughness: 0.4, metalness: 0.4 });
    const winParts: THREE.Mesh[] = [];
    for (const fz of [-3.2, 0.6, 4.4]) {
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5.4, 0.12), frameMat);
      mull.position.set(-10.75, 3.6, fz - 1.2);
      scene.add(mull);
      winParts.push(mull);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 11.4), frameMat);
    sill.position.set(-10.75, 0.95, -0.6);
    scene.add(sill);
    winParts.push(sill);

    // orange sofa on the right side, as in the CEO office scene
    const sofaMat = new THREE.MeshStandardMaterial({ color: "#d97b3f", roughness: 0.8 });
    const sofa = new THREE.Group();
    const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.42, 1.05), sofaMat);
    sofaSeat.position.y = 0.45;
    sofaSeat.castShadow = true;
    sofa.add(sofaSeat);
    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.85, 0.26), sofaMat);
    sofaBack.position.set(0, 0.95, -0.42);
    sofaBack.castShadow = true;
    sofa.add(sofaBack);
    for (const sx of [-1, 1]) {
      const armRest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 1.05), sofaMat);
      armRest.position.set(sx * 1.14, 0.72, 0);
      armRest.castShadow = true;
      sofa.add(armRest);
    }
    sofa.position.set(8.9, 0, 3.4);
    sofa.rotation.y = -0.7;
    scene.add(sofa);

    // ——— wall fade: a wall between the camera and the room fades out ———
    // Dollhouse convention: whichever wall the orbiting camera ends up
    // behind (back wall with the big screen, window wall, plain side wall)
    // eases to near-invisible so the desks are never blocked, and eases
    // back when the camera returns to the open front.
    type FadeMat = { m: THREE.Material; base: number };
    type FadeSet = { mats: FadeMat[]; cur: number; target: number };
    const collectFade = (objects: THREE.Object3D[]): FadeSet => {
      const mats: FadeMat[] = [];
      const seen = new Set<THREE.Material>();
      for (const o of objects) {
        o.traverse((child) => {
          const mat = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (!mat) return;
          for (const m of Array.isArray(mat) ? mat : [mat]) {
            if (seen.has(m)) continue;
            seen.add(m);
            m.transparent = true;
            mats.push({ m, base: m.opacity });
          }
        });
      }
      return { mats, cur: 1, target: 1 };
    };
    const backFade = collectFade([backWall, wallFrame, wallScreen, clockRing, ...backMullions]);
    const leftFade = collectFade([leftWall, windowPane, ...winParts]);
    const rightFade = collectFade([rightWall]);
    const fadeSets = [backFade, leftFade, rightFade];
    const applyFades = (dt: number) => {
      const cp = camera.position;
      // "Outsideness" per wall: how far the camera sits beyond that wall's
      // plane while still aligned with the wall's span (so a camera parked
      // in front of a wall's open edge does not fade it).
      const spanZ = 1 - smoothstep(6, 12, cp.z); // side walls span z ∈ [-8.5, 8.5]
      const outBack = (1 - smoothstep(-10, -5, cp.z)) * (1 - smoothstep(9, 14, Math.abs(cp.x)));
      const outRight = smoothstep(8, 13, cp.x) * spanZ;
      const outLeft = (1 - smoothstep(-13, -8, cp.x)) * spanZ;
      backFade.target = 1 - 0.93 * outBack;
      rightFade.target = 1 - 0.93 * outRight;
      leftFade.target = 1 - 0.93 * outLeft;
      const kf = 1 - Math.pow(0.002, dt); // smooth, frame-rate independent
      for (const s of fadeSets) {
        s.cur += (s.target - s.cur) * kf;
        if (Math.abs(s.target - s.cur) < 0.002) s.cur = s.target;
        for (const { m, base } of s.mats) {
          m.opacity = base * s.cur;
          // A faded wall must not write depth, or it would still hide the room.
          m.depthWrite = base >= 0.99 && s.cur > 0.6;
        }
      }
    };

    // ——— interaction: drag rotate / wheel & pinch zoom ———
    const el = renderer.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let lastMid: { x: number; y: number } | null = null;
    let lastMoveT = 0;
    // Drag sensitivity: ~210px of horizontal drag ≈ 90° of orbit.
    const THETA_SENS = 0.0075;
    const PHI_SENS = 0.006;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = camRef.current;
      c.inertia = false;
      c.vTheta = 0;
      c.vPhi = 0;
      lastMoveT = performance.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        lastMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      }
      // Dragging pauses patrol/auto-rotation; it resumes on release.
      if (rotateRef.current.mode !== "off") pausedRef.current = true;
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = camRef.current;
      if (pointers.size === 1) {
        const dTheta = -dx * THETA_SENS;
        const prevPhi = c.dPhi;
        c.dTheta += dTheta;
        c.dPhi = THREE.MathUtils.clamp(c.dPhi - dy * PHI_SENS, 0.5, 1.42);
        // Track release velocity (smoothed) so the orbit glides to a stop.
        const nowT = performance.now();
        const dtEv = THREE.MathUtils.clamp((nowT - lastMoveT) / 1000, 0.008, 0.1);
        lastMoveT = nowT;
        c.vTheta = THREE.MathUtils.clamp(c.vTheta * 0.6 + (dTheta / dtEv) * 0.4, -3.2, 3.2);
        c.vPhi = THREE.MathUtils.clamp(c.vPhi * 0.6 + ((c.dPhi - prevPhi) / dtEv) * 0.4, -2.2, 2.2);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist > 0) {
          c.dRadius = THREE.MathUtils.clamp(c.dRadius - (dist - pinchDist) * 0.03, 4.5, 24);
        }
        pinchDist = dist;
        // two-finger drag pans the target across the floor plane
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (lastMid) {
          const mdx = mid.x - lastMid.x;
          const mdy = mid.y - lastMid.y;
          const rx = Math.cos(c.dTheta);
          const rz = -Math.sin(c.dTheta);
          const fx = -Math.sin(c.dTheta);
          const fz = -Math.cos(c.dTheta);
          c.dTx = THREE.MathUtils.clamp(c.dTx - (rx * mdx + fx * -mdy) * 0.012, -5, 5);
          c.dTz = THREE.MathUtils.clamp(c.dTz - (rz * mdx + fz * -mdy) * 0.012, -5, 4);
        }
        lastMid = mid;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastMid = null;
      if (pointers.size === 0) {
        // Release: resume auto-rotation if it was on, and let the orbit
        // glide with the tracked flick velocity until it settles.
        pausedRef.current = false;
        camRef.current.inertia = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      c.dRadius = THREE.MathUtils.clamp(c.dRadius + e.deltaY * 0.012, 4.5, 22);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    // ——— resize ———
    let aspectK = 1;
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Portrait phones: widen the FOV and pull the default framing back so
      // the wall screen and all five desks stay inside the first frame.
      camera.fov = camera.aspect < 1 ? 56 : 42;
      aspectK = camera.aspect < 1 ? 1.28 : 1;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ——— data sync: redraw wall screen when counts change ———
    let lastCounts = "";
    const syncData = () => {
      const p = propsRef.current;
      const keyStr = `${p.working}|${p.waiting}|${p.scheduled}|${p.done}|${p.headline ?? ""}|${(p.tasks ?? []).join("~")}`;
      if (keyStr !== lastCounts) {
        lastCounts = keyStr;
        drawWallScreen(wallC.ctx, 1024, 300, p);
        wallTex.needsUpdate = true;
      }
      ambient.intensity = PHASE_AMBIENT[p.phase];
    };

    // ——— animate ———
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clockT = new THREE.Clock();
    let raf = 0;
    let tick = 0;
    let bubbleIdx = 0;
    let bubbleTimer = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      try {
        const dt = Math.min(clockT.getDelta(), 0.05);
        const t = clockT.elapsedTime;
        tick++;
        syncData();
        const c = camRef.current;
        if (rotateRef.current.mode !== "off" && !reduced && !pausedRef.current) {
          c.dTheta += dt * 0.14;
          if (rotateRef.current.mode === "once" && c.dTheta - rotateRef.current.startTheta >= Math.PI * 2) {
            rotateRef.current.mode = "off";
            setRotating("off");
          }
        }
        // Flick inertia: after a drag ends, keep orbiting with the release
        // velocity and ease it out over ~a second.
        if (c.inertia && pointers.size === 0 && !reduced) {
          if (rotateRef.current.mode === "off") {
            c.dTheta += c.vTheta * dt;
            c.dPhi = THREE.MathUtils.clamp(c.dPhi + c.vPhi * dt, 0.5, 1.42);
            const decay = Math.exp(-3.0 * dt);
            c.vTheta *= decay;
            c.vPhi *= decay;
            if (Math.hypot(c.vTheta, c.vPhi) < 0.04) c.inertia = false;
          } else {
            c.inertia = false;
          }
        }
        const k = 1 - Math.pow(0.0015, dt); // smooth ~frame-rate independent lerp
        c.theta += (c.dTheta - c.theta) * k;
        c.phi += (c.dPhi - c.phi) * k;
        c.radius += (c.dRadius - c.radius) * k;
        c.tx += (c.dTx - c.tx) * k;
        c.ty += (c.dTy - c.ty) * k;
        c.tz += (c.dTz - c.tz) * k;
        const radiusEff = c.radius * aspectK;
        camera.position.set(
          c.tx + radiusEff * Math.sin(c.phi) * Math.sin(c.theta),
          c.ty + radiusEff * Math.cos(c.phi),
          c.tz + radiusEff * Math.sin(c.phi) * Math.cos(c.theta),
        );
        camera.lookAt(c.tx, c.ty, c.tz);
        applyFades(dt);

        // Muse breathing / bobbing
        const bob = reduced ? 0 : Math.sin(t * 1.6) * 0.035;
        muse.position.y = 0.55 + bob;
        muse.scale.y = 1 + (reduced ? 0 : Math.sin(t * 1.6) * 0.012);
        mainLabel.sprite.position.y = 3.15 + bob * 1.6;
        // sub workers: small seated sway
        for (const w of subWorkersRef.current) {
          w.position.y = (w.userData.baseY as number) + (reduced ? 0 : Math.sin(t * 1.3 + (w.userData.phase as number)) * 0.018);
          w.rotation.z = reduced ? 0 : Math.sin(t * 0.9 + (w.userData.phase as number)) * 0.03;
        }
        // walker crosses the hall slowly, turns around at the ends
        if (!reduced) {
          const span = 17;
          const wt = (t * 0.55) % (span * 2);
          const wx = wt < span ? -8.5 + wt : -8.5 + (span * 2 - wt);
          walker.position.x = wx;
          walker.position.y = 0.42 + Math.abs(Math.sin(t * 5)) * 0.03;
          walker.rotation.y = wt < span ? Math.PI / 2 : -Math.PI / 2;
        }
        // lamp breathing glow
        lampLight.intensity = 30 + Math.sin(t * 0.9) * 3.5;
        // screens: redraw at ~8fps with flicker
        if (tick % 7 === 0) {
          for (const u of screenUpdaters) u.redraw(tick);
        }
        // main status pill ambience cycle (atmosphere only, no data claim)
        bubbleTimer += dt;
        if (bubbleTimer > 3.6) {
          bubbleTimer = 0;
          bubbleIdx = (bubbleIdx + 1) % BUBBLE_CYCLE.length;
          drawStationLabel(mainLabel.ctx, 512, 168, "Muse · 主工位", BUBBLE_CYCLE[bubbleIdx]!);
          mainLabel.tex.needsUpdate = true;
        }
        renderer.render(scene, camera);
      } catch (err) {
        console.error("Office3D render error", err);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); });
          else if (mat) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
        }
      });
      pmrem.dispose();
      renderer.dispose();
      mount.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const btnCls = (active: boolean) =>
    `rounded-full px-3.5 py-2 text-[13px] font-medium transition duration-200 ${
      active
        ? "bg-[var(--accent)] text-[#241703] shadow-[0_4px_16px_rgba(232,163,61,0.35)]"
        : "border border-white/15 bg-black/35 text-[#d7dde8] backdrop-blur hover:border-[rgba(232,163,61,0.5)] hover:text-white"
    }`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b111e]">
      <div ref={mountRef} className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing" aria-label="3D 办公室场景，可拖动旋转视角" role="img" />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-[var(--dim)]">{error}</p>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0b111e]/85 to-transparent" aria-hidden="true" />
      <div className="absolute bottom-8 left-1/2 flex w-max max-w-[96%] -translate-x-1/2 flex-wrap justify-center gap-1.5 sm:gap-2">
        <button type="button" className={btnCls(view === "panorama" && rotating === "off")} onClick={() => goView("panorama")} aria-label="切换到全景视角">全景</button>
        <button type="button" className={btnCls(view === "boss" && rotating === "off")} onClick={() => goView("boss")} aria-label="切换到老板视角">老板视角</button>
        <button type="button" className={btnCls(rotating === "once")} onClick={startPatrolOnce} aria-label={rotating === "once" ? "停止巡视" : "巡视一圈"} aria-pressed={rotating === "once"}>{rotating === "once" ? "停止巡视" : "巡视一圈"}</button>
        <button type="button" className={btnCls(view === "closeup" && rotating === "off")} onClick={() => goView("closeup")} aria-label="切换到主工位近景">主工位近景</button>
        <button type="button" className={btnCls(rotating === "auto")} onClick={toggleAuto} aria-label={rotating === "auto" ? "关闭自动旋转" : "开启自动旋转"} aria-pressed={rotating === "auto"}>自动转{rotating === "auto" ? " · 开" : ""}</button>
      </div>
      <p className="absolute inset-x-0 bottom-2 text-center text-[11px] tracking-wide text-[#8fa1bb]">
        拖动旋转 · 滚轮或双指缩放 · 双指拖动平移
      </p>
    </div>
  );
}
