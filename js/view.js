import * as THREE from 'three';
import { TERRAIN, ZOMBIES } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const GROUND = new THREE.Plane(UP, 0);

/**
 * Grafiken. Kameran tittar rakt ner på kartan, men scenen är i 3D så att
 * kameran kan vinklas och få perspektiv i en senare fas.
 */
export class View {
  constructor(container, map, game) {
    this.container = container;
    this.map = map;
    this.game = game;
    this.meshes = new Map();
    this.effects = [];
    this.flowType = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b211d);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(map.cols / 2, 60, map.rows / 2);
    this.camera.lookAt(map.cols / 2, 0, map.rows / 2);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(map.cols / 2 - 12, 40, map.rows / 2 - 8);
    sun.target.position.set(map.cols / 2, 0, map.rows / 2);
    this.scene.add(sun, sun.target);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.buildGround();
    this.buildGridLines();
    this.buildDecor();
    this.buildCamp();
    this.buildHelpers();

    game.on('added', (e) => this.addEntity(e));
    game.on('removed', (e) => this.removeEntity(e));
    game.on('shot', (s) => this.addShot(s));
    game.on('fields', () => this.drawFlow());

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  // ---------- Kamera och storlek ----------

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const needW = this.map.cols + 1;
    const needH = this.map.rows + 1;
    let viewW;
    let viewH;
    if (needW / needH > aspect) {
      viewW = needW;
      viewH = needW / aspect;
    } else {
      viewH = needH;
      viewW = needH * aspect;
    }
    this.camera.left = -viewW / 2;
    this.camera.right = viewW / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Översätter en skärmposition till en ruta på kartan, eller -1. */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(GROUND, hit)) return -1;
    return this.map.cellAt(hit.x, hit.z);
  }

  // ---------- Bana ----------

  buildGround() {
    const { cols, rows } = this.map;
    const data = new Uint8Array(cols * rows * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = this.map.index(c, r);
        // Färgerna läses direkt ur hexvärdet (sRGB), eftersom texturen är märkt som sRGB.
        const hex = TERRAIN[this.map.terrain[i]].color;
        const jitter = 0.94 + Math.random() * 0.1;
        let red = (((hex >> 16) & 255) / 255) * jitter;
        let green = (((hex >> 8) & 255) / 255) * jitter;
        let blue = ((hex & 255) / 255) * jitter;
        if (this.map.isSpawnZone(i) && !this.map.isImpassable(i)) {
          red = red * 0.7 + 0.3 * 0.62;
          green *= 0.75;
          blue *= 0.72;
        }
        // Texturens första rad hamnar längst ner i planet, det vill säga högsta raden på kartan.
        const k = ((rows - 1 - r) * cols + c) * 4;
        data[k] = Math.min(255, red * 255);
        data[k + 1] = Math.min(255, green * 255);
        data[k + 2] = Math.min(255, blue * 255);
        data[k + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, cols, rows);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(cols, rows),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cols / 2, 0, rows / 2);
    this.scene.add(ground);
  }

  buildGridLines() {
    const { cols, rows } = this.map;
    const pts = [];
    for (let c = 0; c <= cols; c++) pts.push(c, 0.01, 0, c, 0.01, rows);
    for (let r = 0; r <= rows; r++) pts.push(0, 0.01, r, cols, 0.01, r);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 }),
    );
    this.scene.add(lines);
  }

  buildDecor() {
    const m = this.map;
    const forest = [];
    const rocks = [];
    for (let i = 0; i < m.size; i++) {
      if (m.terrain[i] === 'forest') forest.push(i);
      if (m.terrain[i] === 'rock') rocks.push(i);
    }

    const treeGeo = new THREE.ConeGeometry(0.28, 0.9, 7);
    treeGeo.translate(0, 0.45, 0);
    const trees = new THREE.InstancedMesh(
      treeGeo,
      new THREE.MeshLambertMaterial({ color: 0x2f5a2e }),
      forest.length * 2,
    );
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let n = 0;
    for (const i of forest) {
      const { x, z } = m.center(i);
      for (let k = 0; k < 2; k++) {
        const scale = 0.7 + Math.random() * 0.5;
        p.set(x + (Math.random() - 0.5) * 0.6, 0, z + (Math.random() - 0.5) * 0.6);
        s.set(scale, scale, scale);
        mat.compose(p, q, s);
        trees.setMatrixAt(n++, mat);
      }
    }
    trees.instanceMatrix.needsUpdate = true;
    this.scene.add(trees);

    const rockGeo = new THREE.BoxGeometry(1, 1, 1);
    rockGeo.translate(0, 0.5, 0);
    const rockMesh = new THREE.InstancedMesh(
      rockGeo,
      new THREE.MeshLambertMaterial({ color: 0x9a978e }),
      rocks.length,
    );
    n = 0;
    for (const i of rocks) {
      const { x, z } = m.center(i);
      p.set(x, 0, z);
      s.set(0.95, 0.5 + Math.random() * 0.9, 0.95);
      mat.compose(p, q, s);
      rockMesh.setMatrixAt(n++, mat);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(rockMesh);
  }

  buildCamp() {
    const cells = this.map.campCells;
    let cx = 0;
    let cz = 0;
    for (const i of cells) {
      const c = this.map.center(i);
      cx += c.x;
      cz += c.z;
    }
    cx /= cells.length;
    cz /= cells.length;

    const store = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.7, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x8a6a45 }),
    );
    store.position.set(cx, 0.35, cz);
    this.scene.add(store);

    const tentMat = new THREE.MeshLambertMaterial({ color: 0xd8cfb4 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 4), tentMat);
      tent.position.set(cx + dx * 0.95, 0.35, cz + dz * 0.95);
      tent.rotation.y = Math.PI / 4;
      this.scene.add(tent);
    }

    // Familjen: en symbol för vad lägret försvarar.
    const familyMat = new THREE.MeshLambertMaterial({ color: 0xf2e6c8 });
    for (const [dx, dz, size] of [[0.8, 0, 0.13], [1.0, 0.15, 0.1], [0.9, -0.2, 0.08]]) {
      const person = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), familyMat);
      person.position.set(cx + dx, size, cz + dz);
      this.scene.add(person);
    }
  }

  buildHelpers() {
    this.hover = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.06, 0.98),
      new THREE.MeshBasicMaterial({ color: 0x9fe08a, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);

    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    this.noiseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.noiseRing.rotation.x = -Math.PI / 2;
    this.noiseRing.visible = false;
    this.scene.add(this.noiseRing);

    this.flowLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.flowLines.visible = false;
    this.scene.add(this.flowLines);
  }

  /**
   * Visar markören över rutan. check är resultatet från game.checkTool,
   * range och noise visas som ringar när ett vapen är valt eller pekas på.
   */
  setHover(i, check, range = 0, noise = 0) {
    if (i < 0) {
      this.hover.visible = false;
      this.rangeRing.visible = false;
      this.noiseRing.visible = false;
      return;
    }
    const { x, z } = this.map.center(i);
    this.hover.visible = true;
    this.hover.position.set(x, 0.05, z);
    const ok = !check || check.ok;
    this.hover.material.color.setHex(!check ? 0xffffff : ok ? 0x9fe08a : 0xe0705f);
    this.hover.material.opacity = check ? 0.45 : 0.18;

    this.rangeRing.visible = range > 0;
    if (range > 0) {
      this.rangeRing.position.set(x, 0.04, z);
      this.rangeRing.scale.set(range, range, range);
    }
    this.noiseRing.visible = noise > 1.5;
    if (noise > 1.5) {
      this.noiseRing.position.set(x, 0.03, z);
      this.noiseRing.scale.set(noise, noise, noise);
    }
  }

  // ---------- Vägvalspilar ----------

  setFlowType(type) {
    this.flowType = type || null;
    this.drawFlow();
  }

  drawFlow() {
    if (!this.flowType) {
      this.flowLines.visible = false;
      return;
    }
    const field = this.game.fields[this.flowType];
    const m = this.map;
    const pts = [];
    for (let i = 0; i < m.size; i++) {
      const n = field.next[i];
      if (n < 0 || n === i || m.isImpassable(i) || m.blocker(i)) continue;
      const a = m.center(i);
      const b = m.center(n);
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      const x0 = a.x - dx * 0.22;
      const z0 = a.z - dz * 0.22;
      const x1 = a.x + dx * 0.3;
      const z1 = a.z + dz * 0.3;
      pts.push(x0, 0.08, z0, x1, 0.08, z1);
      // Pilspets
      const hx = -dz * 0.1;
      const hz = dx * 0.1;
      pts.push(x1, 0.08, z1, x1 - dx * 0.14 + hx, 0.08, z1 - dz * 0.14 + hz);
      pts.push(x1, 0.08, z1, x1 - dx * 0.14 - hx, 0.08, z1 - dz * 0.14 - hz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.flowLines.geometry.dispose();
    this.flowLines.geometry = geo;
    this.flowLines.material.color.setHex(ZOMBIES[this.flowType].color).lerp(new THREE.Color(0xffffff), 0.5);
    this.flowLines.visible = true;
  }

  // ---------- Föremål och zombier ----------

  addEntity(e) {
    const group = new THREE.Group();
    const entry = { group, bar: null, barrel: null };

    if (e.kind === 'zombie') {
      const size = e.def.size;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.85, size, size * 1.6, 12),
        new THREE.MeshLambertMaterial({ color: e.def.color }),
      );
      body.position.y = size * 0.8;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.55, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xa9b38c }),
      );
      head.position.y = size * 1.9;
      group.add(body, head);
      entry.bar = makeBar(size * 2 + 0.2, -(size + 0.2));
    } else if (e.kind === 'defender') {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 0.5, 16),
        new THREE.MeshLambertMaterial({ color: e.def.color }),
      );
      body.position.y = 0.25;
      const pivot = new THREE.Group();
      pivot.position.y = 0.55;
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, e.key === 'rifle' ? 0.6 : 0.42),
        new THREE.MeshLambertMaterial({ color: 0x222222 }),
      );
      barrel.position.z = e.key === 'rifle' ? 0.3 : 0.21;
      pivot.add(barrel);
      if (e.key === 'crossbow') {
        const bow = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.05, 0.05),
          new THREE.MeshLambertMaterial({ color: 0x5a3f28 }),
        );
        bow.position.z = 0.36;
        pivot.add(bow);
      }
      group.add(body, pivot);
      entry.barrel = pivot;
      entry.bar = makeBar(0.8, -0.55);
    } else if (e.key === 'ditch') {
      const ditch = new THREE.Mesh(
        new THREE.BoxGeometry(0.96, 0.04, 0.96),
        new THREE.MeshLambertMaterial({ color: 0x4a3825 }),
      );
      ditch.position.y = 0.02;
      const inner = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.05, 0.6),
        new THREE.MeshLambertMaterial({ color: 0x2e2216 }),
      );
      inner.position.y = 0.025;
      group.add(ditch, inner);
    } else if (e.key === 'barricade') {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.45, 0.92),
        new THREE.MeshLambertMaterial({ color: 0xb59b6a }),
      );
      wall.position.y = 0.225;
      group.add(wall);
      entry.bar = makeBar(0.8, -0.55);
    } else if (e.key === 'stakes') {
      const mat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
      for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]]) {
        const stake = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 6), mat);
        stake.position.set(dx, 0.22, dz);
        stake.rotation.z = (Math.random() - 0.5) * 0.4;
        group.add(stake);
      }
      entry.bar = makeBar(0.8, -0.55);
    }

    if (entry.bar) group.add(entry.bar.group);
    group.position.set(e.x, 0, e.z);
    this.scene.add(group);
    this.meshes.set(e, entry);
  }

  removeEntity(e) {
    const entry = this.meshes.get(e);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.meshes.delete(e);
    if (e.kind === 'zombie' && e.hp <= 0) this.addPuff(e.x, e.z, e.def.color);
  }

  // ---------- Effekter ----------

  addShot({ from, x, z, noise }) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([from.x, 0.55, from.z, x, 0.4, z], 3));
    const color = from.key === 'rifle' ? 0xfff2b0 : 0xc8f0e8;
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ obj: line, life: 0.09, max: 0.09, kind: 'fade' });

    if (noise > 1.5) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(from.x, 0.06, from.z);
      this.scene.add(ring);
      this.effects.push({ obj: ring, life: 0.6, max: 0.6, kind: 'ring', radius: noise });
    }
  }

  addPuff(x, z, color) {
    const puff = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    puff.rotation.x = -Math.PI / 2;
    puff.position.set(x, 0.03, z);
    this.scene.add(puff);
    this.effects.push({ obj: puff, life: 0.5, max: 0.5, kind: 'puff' });
  }

  updateEffects(dt) {
    for (const fx of this.effects) {
      fx.life -= dt;
      const t = Math.max(0, fx.life / fx.max);
      if (fx.kind === 'ring') {
        const r = fx.radius * (1 - t * 0.8);
        fx.obj.scale.set(r, r, r);
      } else if (fx.kind === 'puff') {
        const r = 1 + (1 - t) * 0.8;
        fx.obj.scale.set(r, r, r);
      }
      fx.obj.material.opacity = (fx.kind === 'ring' ? 0.35 : fx.kind === 'puff' ? 0.6 : 0.9) * t;
    }
    const alive = [];
    for (const fx of this.effects) {
      if (fx.life > 0) {
        alive.push(fx);
      } else {
        this.scene.remove(fx.obj);
        fx.obj.geometry.dispose();
        fx.obj.material.dispose();
      }
    }
    this.effects = alive;
  }

  // ---------- Bildruta ----------

  render(dt) {
    for (const [e, entry] of this.meshes) {
      if (e.kind === 'zombie') {
        entry.group.position.set(e.x, 0, e.z);
        if (e.aimX !== undefined) entry.group.rotation.y = Math.atan2(e.aimX - e.x, e.aimZ - e.z);
        // Hälsostapeln ska inte rotera med zombien.
        if (entry.bar) entry.bar.group.rotation.y = -entry.group.rotation.y;
      }
      if (entry.barrel) entry.barrel.rotation.y = e.aim;
      if (entry.bar) setBar(entry.bar, e.hp / e.maxHp);
    }
    this.updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

/** Hälsostapel som ligger platt ovanför föremålet, synlig när det är skadat. */
function makeBar(width, offsetZ) {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  holder.position.set(0, 1.6, offsetZ);
  holder.rotation.x = -Math.PI / 2;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false, transparent: true, opacity: 0.8 }),
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x7bd36a, depthTest: false }),
  );
  fg.position.z = 0.001;
  bg.renderOrder = 10;
  fg.renderOrder = 11;
  holder.add(bg, fg);
  group.add(holder);
  group.visible = false;
  return { group, fg, width };
}

function setBar(bar, frac) {
  const f = Math.max(0, Math.min(1, frac));
  bar.group.visible = f < 0.999;
  if (!bar.group.visible) return;
  bar.fg.scale.x = Math.max(0.001, f);
  bar.fg.position.x = -(1 - f) * bar.width * 0.5;
  bar.fg.material.color.setHex(f > 0.5 ? 0x7bd36a : f > 0.25 ? 0xe0b84f : 0xd9584a);
}
