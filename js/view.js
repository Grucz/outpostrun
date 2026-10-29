import * as THREE from 'three';
import { TERRAIN, ZOMBIES } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const GROUND = new THREE.Plane(UP, 0);
const TILT_BLUR = 3.5;

/**
 * Grafiken. Två kameror: en vinklad med perspektiv och miniatyrlook
 * (skuggor och tilt-shift) och en rak ovanifrån för noggrant byggande.
 */
export class View {
  constructor(container, map, game) {
    this.container = container;
    this.map = map;
    this.game = game;
    this.meshes = new Map();
    this.effects = [];
    this.flowType = null;
    this.mode = 'angled';
    this.zoom = 1;
    this.composer = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9c3d6);
    this.scene.fog = new THREE.Fog(0xa9c3d6, 70, 140);

    this.center = new THREE.Vector3(map.cols / 2, 0, map.rows / 2);

    this.topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.position.set(this.center.x, 60, this.center.z);
    this.topCamera.lookAt(this.center);

    this.angledCamera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
    this.camera = this.angledCamera;

    this.buildLights();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.buildGround();
    this.buildGridLines();
    this.buildDecor();
    this.buildCamp();
    this.buildHelpers();

    this.barLayer = new THREE.Group();
    this.scene.add(this.barLayer);

    game.on('added', (e) => this.addEntity(e));
    game.on('removed', (e) => this.removeEntity(e));
    game.on('shot', (s) => this.addShot(s));
    game.on('fields', () => this.drawFlow());

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'angled') return;
        e.preventDefault();
        this.zoom = Math.min(1.6, Math.max(0.45, this.zoom * (e.deltaY > 0 ? 1.08 : 0.92)));
        this.resize();
      },
      { passive: false },
    );

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.initPostprocessing();
  }

  // ---------- Ljus ----------

  buildLights() {
    const { cols, rows } = this.map;
    this.scene.add(new THREE.HemisphereLight(0xe4ecf7, 0x55603f, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.position.set(this.center.x - 14, 34, this.center.z - 10);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = Math.max(cols, rows) * 0.62;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun, sun.target);
  }

  // ---------- Efterbehandling (tilt-shift) ----------

  /**
   * Laddar tilt-shift. Om filerna inte går att hämta fortsätter spelet
   * utan effekten, i stället för att sluta fungera.
   */
  async initPostprocessing() {
    try {
      const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { OutputPass }, { HorizontalTiltShiftShader }, { VerticalTiltShiftShader }] =
        await Promise.all([
          import('three/addons/postprocessing/EffectComposer.js'),
          import('three/addons/postprocessing/RenderPass.js'),
          import('three/addons/postprocessing/ShaderPass.js'),
          import('three/addons/postprocessing/OutputPass.js'),
          import('three/addons/shaders/HorizontalTiltShiftShader.js'),
          import('three/addons/shaders/VerticalTiltShiftShader.js'),
        ]);
      const composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.scene, this.angledCamera);
      this.hblur = new ShaderPass(HorizontalTiltShiftShader);
      this.vblur = new ShaderPass(VerticalTiltShiftShader);
      this.hblur.uniforms.r.value = 0.5;
      this.vblur.uniforms.r.value = 0.5;
      composer.addPass(this.renderPass);
      composer.addPass(this.hblur);
      composer.addPass(this.vblur);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.resize();
    } catch (err) {
      console.warn('Tilt-shift kunde inte laddas, spelet körs utan effekten.', err);
      this.composer = null;
    }
  }

  // ---------- Kamera och storlek ----------

  setMode(mode) {
    this.mode = mode;
    this.camera = mode === 'top' ? this.topCamera : this.angledCamera;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const { cols, rows } = this.map;

    // Rak kamera ovanifrån: hela kartan med en liten marginal.
    const needW = cols + 1;
    const needH = rows + 1;
    let viewW;
    let viewH;
    if (needW / needH > aspect) {
      viewW = needW;
      viewH = needW / aspect;
    } else {
      viewH = needH;
      viewW = needH * aspect;
    }
    this.topCamera.left = -viewW / 2;
    this.topCamera.right = viewW / 2;
    this.topCamera.top = viewH / 2;
    this.topCamera.bottom = -viewH / 2;
    this.topCamera.updateProjectionMatrix();

    // Vinklad kamera: avståndet väljs så att kartan ryms, och kan ändras med mushjulet.
    const cam = this.angledCamera;
    cam.aspect = aspect;
    const elev = THREE.MathUtils.degToRad(52);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dV = (rows * Math.sin(elev) + 3) / (2 * halfTan);
    const dH = (cols + 2) / (2 * halfTan * aspect);
    const dist = Math.max(dV, dH) * 1.12 * this.zoom;
    const target = new THREE.Vector3(this.center.x, 0, this.center.z + 0.8);
    cam.position.set(target.x, dist * Math.sin(elev), target.z + dist * Math.cos(elev));
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.hblur.uniforms.h.value = TILT_BLUR / w;
      this.vblur.uniforms.v.value = TILT_BLUR / h;
    }
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
        const jitter = 0.95 + Math.random() * 0.08;
        let red = (((hex >> 16) & 255) / 255) * jitter;
        let green = (((hex >> 8) & 255) / 255) * jitter;
        let blue = ((hex & 255) / 255) * jitter;
        if (this.map.isSpawnZone(i) && !this.map.isImpassable(i)) {
          red = red * 0.7 + 0.3 * 0.62;
          green *= 0.78;
          blue *= 0.74;
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
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(cols, rows),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cols / 2, 0, rows / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Landskapet fortsätter utanför spelplanen, så att den vinklade vyn inte visar tomrum.
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(cols * 6, rows * 6),
      new THREE.MeshLambertMaterial({ color: 0x6f8c52 }),
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(cols / 2, -0.02, rows / 2);
    outside.receiveShadow = true;
    this.scene.add(outside);

    // En låg kant markerar spelplanens gräns.
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0x5b4a33 });
    const edges = [
      [cols / 2, -0.05, cols + 0.3, 0.3],
      [cols / 2, rows + 0.05, cols + 0.3, 0.3],
      [-0.05, rows / 2, 0.3, rows],
      [cols + 0.05, rows / 2, 0.3, rows],
    ];
    for (const [x, z, w, d] of edges) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), edgeMat);
      edge.position.set(x, 0.04, z);
      edge.receiveShadow = true;
      this.scene.add(edge);
    }

    // Lite spridda träd utanför planen ger känslan av ett större landskap.
    const outsideTrees = [];
    for (let k = 0; k < 160; k++) {
      const x = -14 + Math.random() * (cols + 28);
      const z = -12 + Math.random() * (rows + 24);
      if (x > -1.5 && x < cols + 1.5 && z > -1.5 && z < rows + 1.5) continue;
      outsideTrees.push([x, z, 0.8 + Math.random() * 0.7]);
    }
    this.addTrees(outsideTrees);
  }

  buildGridLines() {
    const { cols, rows } = this.map;
    const pts = [];
    for (let c = 0; c <= cols; c++) pts.push(c, 0.01, 0, c, 0.01, rows);
    for (let r = 0; r <= rows; r++) pts.push(0, 0.01, r, cols, 0.01, r);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.gridLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06 }),
    );
    this.scene.add(this.gridLines);
  }

  /** Träd som två instansierade nät: stam och krona. trees = [[x, z, skala], ...] */
  addTrees(trees) {
    if (trees.length === 0) return;
    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
    trunkGeo.translate(0, 0.15, 0);
    const crownGeo = new THREE.ConeGeometry(0.3, 0.85, 7);
    crownGeo.translate(0, 0.68, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b4330 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    trees.forEach(([x, z, scale], n) => {
      p.set(x, 0, z);
      q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
      s.set(scale, scale * (0.85 + Math.random() * 0.35), scale);
      mat.compose(p, q, s);
      trunks.setMatrixAt(n, mat);
      crowns.setMatrixAt(n, mat);
      color.setHSL(0.27 + Math.random() * 0.06, 0.35 + Math.random() * 0.15, 0.22 + Math.random() * 0.08);
      crowns.setColorAt(n, color);
    });
    for (const mesh of [trunks, crowns]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    crowns.instanceColor.needsUpdate = true;
  }

  buildDecor() {
    const m = this.map;
    const trees = [];
    const rocks = [];
    for (let i = 0; i < m.size; i++) {
      const { x, z } = m.center(i);
      if (m.terrain[i] === 'forest') {
        for (let k = 0; k < 2; k++) {
          trees.push([x + (Math.random() - 0.5) * 0.7, z + (Math.random() - 0.5) * 0.7, 0.75 + Math.random() * 0.5]);
        }
      }
      if (m.terrain[i] === 'rock') rocks.push(i);
    }
    this.addTrees(trees);

    const rockGeo = new THREE.DodecahedronGeometry(0.62, 0);
    const rockMesh = new THREE.InstancedMesh(
      rockGeo,
      new THREE.MeshLambertMaterial({ color: 0x9a978e, flatShading: true }),
      rocks.length,
    );
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    rocks.forEach((i, n) => {
      const { x, z } = m.center(i);
      const height = 0.6 + Math.random() * 0.9;
      p.set(x, height * 0.3, z);
      q.setFromEuler(new THREE.Euler(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.5));
      s.set(1 + Math.random() * 0.2, height, 1 + Math.random() * 0.2);
      mat.compose(p, q, s);
      rockMesh.setMatrixAt(n, mat);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    this.scene.add(rockMesh);

    // Vattenytan ligger lite ovanför marken och glänser svagt.
    const water = [];
    for (let i = 0; i < m.size; i++) if (m.terrain[i] === 'water') water.push(i);
    const waterMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.04, 1),
      new THREE.MeshPhongMaterial({ color: 0x4a7ea8, shininess: 80, specular: 0x9fc4e0, transparent: true, opacity: 0.88 }),
      water.length,
    );
    water.forEach((i, n) => {
      const { x, z } = m.center(i);
      p.set(x, 0.02, z);
      mat.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      waterMesh.setMatrixAt(n, mat);
    });
    waterMesh.instanceMatrix.needsUpdate = true;
    waterMesh.receiveShadow = true;
    this.scene.add(waterMesh);
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

    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };

    // Förrådet: en bod med tak och några lådor.
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.8), new THREE.MeshLambertMaterial({ color: 0x8a6a45 })), cx, 0.275, cz);
    const roof = add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.75, 0.35, 4), new THREE.MeshLambertMaterial({ color: 0x6b3f2a })),
      cx,
      0.72,
      cz,
    );
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.78);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0xa88454 });
    add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), crateMat), cx + 0.68, 0.125, cz + 0.32);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), crateMat), cx + 0.7, 0.1, cz + 0.05);

    const tentMat = new THREE.MeshLambertMaterial({ color: 0xd8cfb4 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1]]) {
      const tent = add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 4), tentMat), cx + dx * 0.95, 0.3, cz + dz * 0.95);
      tent.rotation.y = Math.PI / 4;
    }

    // Lägereld.
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 10), new THREE.MeshLambertMaterial({ color: 0x3a3632 })), cx + 0.9, 0.03, cz + 0.9);
    this.fire = new THREE.PointLight(0xff9a4a, 3, 3, 2);
    this.fire.position.set(cx + 0.9, 0.35, cz + 0.9);
    this.scene.add(this.fire);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), new THREE.MeshBasicMaterial({ color: 0xffb24a }));
    flame.position.set(cx + 0.9, 0.15, cz + 0.9);
    this.scene.add(flame);

    // Familjen: en symbol för vad lägret försvarar.
    const familyMat = new THREE.MeshLambertMaterial({ color: 0xe9dcc0 });
    for (const [dx, dz, size] of [[0.55, 0.85, 0.12], [0.62, 1.05, 0.09], [0.4, 1.0, 0.07]]) {
      add(new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.6, size * 1.4, 4, 8), familyMat), cx + dx, size * 1.3, cz + dz);
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
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    this.noiseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.noiseRing.rotation.x = -Math.PI / 2;
    this.noiseRing.visible = false;
    this.scene.add(this.noiseRing);

    this.flowLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
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
    this.hover.material.opacity = check ? 0.5 : 0.2;

    this.rangeRing.visible = range > 0;
    if (range > 0) {
      this.rangeRing.position.set(x, 0.06, z);
      this.rangeRing.scale.set(range, range, range);
    }
    this.noiseRing.visible = noise > 1.5;
    if (noise > 1.5) {
      this.noiseRing.position.set(x, 0.05, z);
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
    const entry = { group, bar: null, barrel: null, barHeight: 1 };
    const lambert = (color) => new THREE.MeshLambertMaterial({ color });

    if (e.kind === 'zombie') {
      // Enkel figur: kropp, huvud och framsträckta armar.
      const s = e.def.size;
      const skin = lambert(0x9aa682);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(s * 0.55, s * 1.0, 4, 8), lambert(e.def.color));
      body.position.y = s * 1.05;
      body.rotation.x = 0.18;
      const head = new THREE.Mesh(new THREE.SphereGeometry(s * 0.42, 10, 8), skin);
      head.position.set(0, s * 2.0, s * 0.18);
      const armGeo = new THREE.CapsuleGeometry(s * 0.14, s * 0.8, 3, 6);
      armGeo.rotateX(Math.PI / 2);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, skin);
        arm.position.set(side * s * 0.55, s * 1.45, s * 0.55);
        group.add(arm);
      }
      group.add(body, head);
      entry.bar = makeBar(s * 2 + 0.2);
      entry.barHeight = s * 2.7;
    } else if (e.kind === 'defender') {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.38, 4, 10), lambert(e.def.color));
      body.position.y = 0.36;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), lambert(0xd9b38c));
      head.position.y = 0.75;
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        lambert(0x4a5238),
      );
      helmet.position.y = 0.79;
      // Ett litet skyddsvärn av sandsäckar runt skytten.
      const sandbags = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.09, 6, 16), lambert(0xb59b6a));
      sandbags.rotation.x = Math.PI / 2;
      sandbags.position.y = 0.09;
      const pivot = new THREE.Group();
      pivot.position.y = 0.48;
      const weapon = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, e.key === 'rifle' ? 0.62 : 0.42),
        lambert(0x2a2a2a),
      );
      weapon.position.z = e.key === 'rifle' ? 0.26 : 0.18;
      pivot.add(weapon);
      if (e.key === 'crossbow') {
        const bow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.04), lambert(0x5a3f28));
        bow.position.z = 0.34;
        pivot.add(bow);
      }
      group.add(body, head, helmet, sandbags, pivot);
      entry.barrel = pivot;
      entry.bar = makeBar(0.8);
      entry.barHeight = 1.15;
    } else if (e.key === 'ditch') {
      const ditch = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.03, 0.96), lambert(0x4a3825));
      ditch.position.y = 0.015;
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.62), lambert(0x2a1f14));
      inner.position.y = 0.02;
      // Uppkastad jord längs kanterna.
      const ridgeMat = lambert(0x6b5235);
      for (const [dx, dz, w, d] of [[0, -0.42, 0.96, 0.12], [0, 0.42, 0.96, 0.12], [-0.42, 0, 0.12, 0.72], [0.42, 0, 0.12, 0.72]]) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), ridgeMat);
        ridge.position.set(dx, 0.04, dz);
        group.add(ridge);
      }
      group.add(ditch, inner);
    } else if (e.key === 'barricade') {
      // Sandsäckar i två lager.
      const bagMat = lambert(0xb59b6a);
      const bagGeo = new THREE.CapsuleGeometry(0.1, 0.22, 3, 8);
      bagGeo.rotateZ(Math.PI / 2);
      for (let layer = 0; layer < 3; layer++) {
        for (let k = 0; k < 4; k++) {
          for (const dz of [-0.2, 0.2]) {
            const bag = new THREE.Mesh(bagGeo, bagMat);
            bag.position.set(-0.33 + k * 0.22 + (layer % 2) * 0.08, 0.1 + layer * 0.16, dz);
            bag.scale.set(1, 0.8, 1.6);
            group.add(bag);
          }
        }
      }
      entry.bar = makeBar(0.8);
      entry.barHeight = 0.9;
    } else if (e.key === 'stakes') {
      const mat = lambert(0x6b4a2b);
      for (const [dx, dz] of [[-0.28, -0.28], [0.05, -0.3], [0.3, -0.05], [-0.3, 0.05], [0, 0], [-0.05, 0.3], [0.28, 0.28]]) {
        const stake = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 6), mat);
        stake.position.set(dx, 0.2, dz);
        stake.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
        group.add(stake);
      }
      entry.bar = makeBar(0.8);
      entry.barHeight = 0.8;
    }

    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (entry.bar) this.barLayer.add(entry.bar.group);
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
    if (entry.bar) {
      this.barLayer.remove(entry.bar.group);
      entry.bar.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.meshes.delete(e);
    if (e.kind === 'zombie' && e.hp <= 0) this.addPuff(e.x, e.z, e.def.color);
  }

  // ---------- Effekter ----------

  addShot({ from, x, z, noise }) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([from.x, 0.5, from.z, x, 0.35, z], 3));
    const color = from.key === 'rifle' ? 0xfff2b0 : 0xd8f0e8;
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ obj: line, life: 0.09, max: 0.09, kind: 'fade', base: 0.9 });

    if (from.key === 'rifle') {
      const flash = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1 }),
      );
      flash.position.set(from.x + Math.sin(from.aim) * 0.55, 0.5, from.z + Math.cos(from.aim) * 0.55);
      this.scene.add(flash);
      this.effects.push({ obj: flash, life: 0.06, max: 0.06, kind: 'fade', base: 1 });
    }

    if (noise > 1.5) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(from.x, 0.07, from.z);
      this.scene.add(ring);
      this.effects.push({ obj: ring, life: 0.6, max: 0.6, kind: 'ring', radius: noise, base: 0.35 });
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
    this.effects.push({ obj: puff, life: 0.5, max: 0.5, kind: 'puff', base: 0.6 });
  }

  updateEffects(dt) {
    const alive = [];
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
      fx.obj.material.opacity = fx.base * t;
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

  render(dt, time) {
    // Hälsostaplarna vänds mot kameran och placeras ovanför föremålet.
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const top = this.mode === 'top';
    for (const [e, entry] of this.meshes) {
      if (e.kind === 'zombie') {
        entry.group.position.set(e.x, 0, e.z);
        if (e.aimX !== undefined) entry.group.rotation.y = Math.atan2(e.aimX - e.x, e.aimZ - e.z);
        // Lätt gungande gång.
        entry.group.rotation.z = Math.sin(time * 6 + e.id) * 0.08;
      }
      if (entry.barrel) entry.barrel.rotation.y = e.aim;
      if (entry.bar) {
        setBar(entry.bar, e.hp / e.maxHp);
        const g = entry.bar.group;
        g.position.set(e.x, top ? 0.5 : entry.barHeight, e.z);
        if (top) g.position.addScaledVector(camUp, 0.55);
        g.quaternion.copy(this.camera.quaternion);
      }
    }
    if (this.fire) this.fire.intensity = 3 + Math.sin(time * 13) * 0.5 + Math.sin(time * 7.3) * 0.4;
    this.updateEffects(dt);

    if (this.composer && this.mode === 'angled') {
      this.renderPass.camera = this.angledCamera;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

/** Hälsostapel som vänds mot kameran, synlig när föremålet är skadat. */
function makeBar(width) {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false, transparent: true, opacity: 0.8 }),
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x7bd36a, depthTest: false, transparent: true }),
  );
  fg.position.z = 0.001;
  bg.renderOrder = 10;
  fg.renderOrder = 11;
  group.add(bg, fg);
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
