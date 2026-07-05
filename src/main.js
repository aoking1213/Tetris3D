import * as THREE from "three";

const STAGE_SIZE = 7;
const CENTER = (STAGE_SIZE - 1) / 2;
const CELL = 0.9;
const BLOCK_SIZE = 0.74;
const START_INTERVAL = 1.05;
const MIN_INTERVAL = 0.22;

const DIRS = [
  { id: "X-", label: "LEFT", axis: "x", sign: 1, u: "z", v: "y" },
  { id: "X+", label: "RIGHT", axis: "x", sign: -1, u: "z", v: "y" },
  { id: "Y-", label: "BOTTOM", axis: "y", sign: 1, u: "x", v: "z" },
  { id: "Y+", label: "TOP", axis: "y", sign: -1, u: "x", v: "z" },
  { id: "Z-", label: "FRONT", axis: "z", sign: 1, u: "x", v: "y" },
  { id: "Z+", label: "BACK", axis: "z", sign: -1, u: "x", v: "y" },
];

const SHAPES = [
  {
    name: "bar",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ],
  },
  {
    name: "plate",
    cells: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 1, 1],
    ],
  },
  {
    name: "corner",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
  {
    name: "step",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    name: "hook",
    cells: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
      [1, 2, 0],
    ],
  },
  {
    name: "wedge",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 1],
    ],
  },
  {
    name: "cubelet",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
    ],
  },
].map((shape) => ({
  ...shape,
  cells: normalizeOffsets(shape.cells.map(([a, b, c]) => ({ a, b, c }))),
}));

const COLORS = [
  0x25d9ff,
  0xffbf35,
  0xff5c8a,
  0x7dff72,
  0xb36bff,
  0xff6b3d,
  0x66ffe1,
];

const canvas = document.querySelector("#game");
const scoreEl = document.querySelector("#score");
const levelEl = document.querySelector("#level");
const clearsEl = document.querySelector("#clears");
const incomingEl = document.querySelector("#incoming");
const gameOverEl = document.querySelector("#game-over");
const finalScoreEl = document.querySelector("#final-score");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07090d, 0.035);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(8.2, 7.4, 11.5);
camera.lookAt(0, 0, 0);

const stageGroup = new THREE.Group();
stageGroup.rotation.set(-0.56, 0.72, 0.12);
scene.add(stageGroup);

const targetRotation = new THREE.Euler(
  stageGroup.rotation.x,
  stageGroup.rotation.y,
  stageGroup.rotation.z,
);

const occupiedGroup = new THREE.Group();
const activeGroup = new THREE.Group();
const ghostGroup = new THREE.Group();
stageGroup.add(occupiedGroup, ghostGroup, activeGroup);

const occupied = new Map();
const clock = new THREE.Clock();
let active = null;
let pieceId = 0;
let score = 0;
let clears = 0;
let combo = 0;
let level = 1;
let dropTimer = 0;
let isPaused = false;
let isGameOver = false;
let clearPulse = 0;

const reusableBox = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.18,
  roughness: 0.45,
  metalness: 0.15,
});

setupLights();
buildStage();
bindInput();
resize();
restartGame();
requestAnimationFrame(animate);

function setupLights() {
  scene.add(new THREE.AmbientLight(0xb5d7ff, 0.62));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(6, 9, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 32;
  scene.add(keyLight);

  const cyan = new THREE.PointLight(0x25d9ff, 2.2, 18);
  cyan.position.set(-6, 2.5, 5);
  scene.add(cyan);

  const amber = new THREE.PointLight(0xffc64d, 1.5, 16);
  amber.position.set(5, -5, -4);
  scene.add(amber);
}

function buildStage() {
  const size = STAGE_SIZE * CELL;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({
      color: 0x9feaff,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
    }),
  );
  stageGroup.add(cube);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)),
    new THREE.LineBasicMaterial({
      color: 0xeafcff,
      transparent: true,
      opacity: 0.62,
    }),
  );
  stageGroup.add(edges);

  const grid = new THREE.Group();
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x8cecff,
    transparent: true,
    opacity: 0.16,
  });
  const half = size / 2;

  for (let i = 1; i < STAGE_SIZE; i += 1) {
    const p = -half + i * CELL;
    addLine(grid, gridMaterial, [-half, p, -half], [half, p, -half]);
    addLine(grid, gridMaterial, [-half, p, half], [half, p, half]);
    addLine(grid, gridMaterial, [p, -half, -half], [p, half, -half]);
    addLine(grid, gridMaterial, [p, -half, half], [p, half, half]);

    addLine(grid, gridMaterial, [-half, -half, p], [half, -half, p]);
    addLine(grid, gridMaterial, [-half, half, p], [half, half, p]);
    addLine(grid, gridMaterial, [p, -half, -half], [p, -half, half]);
    addLine(grid, gridMaterial, [p, half, -half], [p, half, half]);

    addLine(grid, gridMaterial, [-half, p, -half], [-half, p, half]);
    addLine(grid, gridMaterial, [half, p, -half], [half, p, half]);
    addLine(grid, gridMaterial, [-half, -half, p], [-half, half, p]);
    addLine(grid, gridMaterial, [half, -half, p], [half, half, p]);
  }

  stageGroup.add(grid);
}

function addLine(group, material, from, to) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ]);
  group.add(new THREE.Line(geometry, material));
}

function bindInput() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    targetRotation.y += dx * 0.008;
    targetRotation.x += dy * 0.008;
    targetRotation.x = THREE.MathUtils.clamp(targetRotation.x, -1.45, 1.45);
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });

  window.addEventListener("resize", resize);

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;

    if (event.code === "Enter" && isGameOver) {
      restartGame();
      return;
    }

    if (event.code === "KeyP") {
      togglePause();
      return;
    }

    if (!active || isPaused || isGameOver) return;

    if (event.code === "ArrowLeft" || event.code === "KeyA") moveLane(-1, 0);
    if (event.code === "ArrowRight" || event.code === "KeyD") moveLane(1, 0);
    if (event.code === "ArrowUp" || event.code === "KeyW") moveLane(0, 1);
    if (event.code === "ArrowDown" || event.code === "KeyS") moveLane(0, -1);
    if (event.code === "KeyQ") rotateActive(-1);
    if (event.code === "KeyE" || event.code === "KeyR") rotateActive(1);
    if (event.code === "Space") {
      event.preventDefault();
      hardDrop();
    }
  });

  document.querySelector("#rotate-left").addEventListener("click", () => rotateActive(-1));
  document.querySelector("#rotate-right").addEventListener("click", () => rotateActive(1));
  document.querySelector("#hard-drop").addEventListener("click", hardDrop);
  document.querySelector("#pause").addEventListener("click", togglePause);
  document.querySelector("#restart").addEventListener("click", restartGame);
  document.querySelector("#play-again").addEventListener("click", restartGame);

  document.querySelectorAll("[data-move-u][data-move-v]").forEach((button) => {
    bindMoveButton(button);
  });
}

function bindMoveButton(button) {
  const deltaU = Number(button.dataset.moveU);
  const deltaV = Number(button.dataset.moveV);
  let repeatId = null;

  const stopRepeat = () => {
    if (repeatId === null) return;
    window.clearInterval(repeatId);
    repeatId = null;
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    moveLane(deltaU, deltaV);
    stopRepeat();
    repeatId = window.setInterval(() => moveLane(deltaU, deltaV), 135);
  });

  button.addEventListener("pointerup", (event) => {
    stopRepeat();
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
  });

  button.addEventListener("pointercancel", stopRepeat);
  button.addEventListener("pointerleave", stopRepeat);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.position.z = width < 720 ? 14.5 : 11.5;
  camera.updateProjectionMatrix();
}

function restartGame() {
  clearGroup(occupiedGroup);
  occupied.clear();
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  active = null;
  score = 0;
  clears = 0;
  combo = 0;
  level = 1;
  dropTimer = 0;
  isPaused = false;
  isGameOver = false;
  clearPulse = 0;
  gameOverEl.hidden = true;
  updateHud();
  spawnPiece();
}

function togglePause() {
  if (isGameOver) return;
  isPaused = !isPaused;
  document.querySelector("#pause").textContent = isPaused ? "▶" : "Ⅱ";
}

function spawnPiece() {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const dir = DIRS[Math.floor(Math.random() * DIRS.length)];
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const offsets = shape.cells.map((cell) => ({ ...cell }));

  for (let i = 0; i < Math.floor(Math.random() * 4); i += 1) {
    rotateOffsets(offsets, 1);
  }

  const extents = getExtents(offsets);
  active = {
    id: pieceId,
    shape: shape.name,
    dir,
    color,
    offsets,
    depth: dir.sign === 1 ? -extents.maxA - 2 : STAGE_SIZE + extents.maxA + 1,
    renderDepth: dir.sign === 1 ? -extents.maxA - 2 : STAGE_SIZE + extents.maxA + 1,
    laneU: CENTER,
    laneV: CENTER,
    laneUFloat: CENTER,
    laneVFloat: CENTER,
  };
  pieceId += 1;

  randomizeLane(active);
  rebuildActiveMeshes();
  updateHud();
  updateGhost();
}

function rebuildActiveMeshes() {
  clearGroup(activeGroup);
  if (!active) return;

  const material = createBlockMaterial(active.color, false);
  active.offsets.forEach(() => {
    const mesh = new THREE.Mesh(reusableBox, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(reusableBox),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.42,
      }),
    );
    mesh.add(edges);
    activeGroup.add(mesh);
  });
}

function moveLane(deltaU, deltaV) {
  if (!active || isPaused || isGameOver) return;

  const previous = {
    laneU: active.laneU,
    laneV: active.laneV,
    laneUFloat: active.laneUFloat,
    laneVFloat: active.laneVFloat,
  };

  active.laneUFloat += deltaU;
  active.laneVFloat += deltaV;
  clampLane(active);

  if (pieceCollides(pieceCells(active, active.depth))) {
    Object.assign(active, previous);
  }

  updateGhost();
}

function rotateActive(direction) {
  if (!active || isPaused || isGameOver) return;

  const previousOffsets = active.offsets.map((cell) => ({ ...cell }));
  const previousLane = {
    laneU: active.laneU,
    laneV: active.laneV,
    laneUFloat: active.laneUFloat,
    laneVFloat: active.laneVFloat,
  };

  rotateOffsets(active.offsets, direction);
  clampLane(active);

  if (pieceCollides(pieceCells(active, active.depth))) {
    active.offsets = previousOffsets;
    Object.assign(active, previousLane);
  } else {
    rebuildActiveMeshes();
  }

  updateGhost();
}

function rotateOffsets(offsets, direction) {
  offsets.forEach((cell) => {
    const oldB = cell.b;
    const oldC = cell.c;
    if (direction > 0) {
      cell.b = oldC;
      cell.c = -oldB;
    } else {
      cell.b = -oldC;
      cell.c = oldB;
    }
  });

  const normalized = normalizeOffsets(offsets);
  offsets.splice(0, offsets.length, ...normalized);
}

function clampLane(piece) {
  const bounds = getLaneBounds(piece);
  piece.laneUFloat = THREE.MathUtils.clamp(piece.laneUFloat, bounds.minU, bounds.maxU);
  piece.laneVFloat = THREE.MathUtils.clamp(piece.laneVFloat, bounds.minV, bounds.maxV);
  piece.laneU = THREE.MathUtils.clamp(Math.round(piece.laneUFloat), bounds.minU, bounds.maxU);
  piece.laneV = THREE.MathUtils.clamp(Math.round(piece.laneVFloat), bounds.minV, bounds.maxV);
  piece.laneUFloat = piece.laneU;
  piece.laneVFloat = piece.laneV;
}

function randomizeLane(piece) {
  const bounds = getLaneBounds(piece);
  piece.laneU = randomInt(bounds.minU, bounds.maxU);
  piece.laneV = randomInt(bounds.minV, bounds.maxV);
  piece.laneUFloat = piece.laneU;
  piece.laneVFloat = piece.laneV;
}

function getLaneBounds(piece) {
  const extents = getExtents(piece.offsets);
  const centerB = Math.floor((extents.minB + extents.maxB) / 2);
  const centerC = Math.floor((extents.minC + extents.maxC) / 2);

  return {
    minU: centerB - extents.minB,
    maxU: STAGE_SIZE - 1 - (extents.maxB - centerB),
    minV: centerC - extents.minC,
    maxV: STAGE_SIZE - 1 - (extents.maxC - centerC),
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function advancePiece() {
  if (!active) return false;

  const nextDepth = active.depth + active.dir.sign;
  const nextCells = pieceCells(active, nextDepth);
  const currentCells = pieceCells(active, active.depth);
  const nextBlocked = hasFarOverflow(nextCells, active.dir) || pieceCollides(nextCells);

  if (!nextBlocked) {
    active.depth = nextDepth;
    updateGhost();
    return true;
  }

  if (!currentCells.every(isInside) || pieceCollides(currentCells)) {
    endGame();
    return false;
  }

  lockActive(currentCells);
  return false;
}

function lockActive(cells) {
  const lockedColor = active.color;
  const recentCells = uniqueCells(cells);

  clearGroup(activeGroup);
  recentCells.forEach((cell) => {
    const block = createLockedBlock(cell, lockedColor);
    occupied.set(keyOf(cell), block);
    occupiedGroup.add(block);
  });

  const clearResult = clearFilledPlanes(recentCells);
  if (clearResult.cells.length > 0) {
    combo += 1;
    clears += clearResult.planeCount;
    level = 1 + Math.floor(clears / 3);
    score += clearResult.cells.length * (30 + level * 6) * combo;
    clearPulse = 1;
  } else {
    combo = 0;
    score += recentCells.length * 2;
  }

  active = null;
  clearGroup(ghostGroup);
  updateHud();
  spawnPiece();
}

function hardDrop() {
  if (!active || isPaused || isGameOver) return;
  const id = active.id;
  let safety = STAGE_SIZE + 12;

  while (active && active.id === id && safety > 0) {
    advancePiece();
    safety -= 1;
  }
}

function endGame() {
  isGameOver = true;
  isPaused = false;
  active = null;
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  finalScoreEl.textContent = score.toLocaleString("ja-JP");
  gameOverEl.hidden = false;
  updateHud();
}

function pieceCells(piece, depth) {
  const extents = getExtents(piece.offsets);
  const centerB = Math.floor((extents.minB + extents.maxB) / 2);
  const centerC = Math.floor((extents.minC + extents.maxC) / 2);

  return piece.offsets.map((offset) => {
    const cell = { x: 0, y: 0, z: 0 };
    cell[piece.dir.axis] = depth + piece.dir.sign * offset.a;
    cell[piece.dir.u] = piece.laneU + offset.b - centerB;
    cell[piece.dir.v] = piece.laneV + offset.c - centerC;
    return cell;
  });
}

function pieceCollides(cells) {
  return cells.some((cell) => isInside(cell) && occupied.has(keyOf(cell)));
}

function hasFarOverflow(cells, dir) {
  return cells.some((cell) => {
    const value = cell[dir.axis];
    return dir.sign === 1 ? value >= STAGE_SIZE : value < 0;
  });
}

function isInside(cell) {
  return (
    cell.x >= 0 &&
    cell.x < STAGE_SIZE &&
    cell.y >= 0 &&
    cell.y < STAGE_SIZE &&
    cell.z >= 0 &&
    cell.z < STAGE_SIZE
  );
}

function updateGhost() {
  clearGroup(ghostGroup);
  if (!active || isGameOver) return;

  let depth = active.depth;
  let safety = STAGE_SIZE + 12;

  while (safety > 0) {
    const nextDepth = depth + active.dir.sign;
    const nextCells = pieceCells(active, nextDepth);
    if (hasFarOverflow(nextCells, active.dir) || pieceCollides(nextCells)) break;
    depth = nextDepth;
    safety -= 1;
  }

  const landingCells = pieceCells(active, depth);
  if (!landingCells.every(isInside)) return;

  uniqueCells(landingCells).forEach((cell) => {
    const mesh = new THREE.Mesh(reusableBox, ghostMaterial);
    mesh.position.copy(cellToPosition(cell));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(reusableBox),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.26,
      }),
    );
    mesh.add(edges);
    ghostGroup.add(mesh);
  });
}

function createLockedBlock(cell, color) {
  const mesh = new THREE.Mesh(reusableBox, createBlockMaterial(color, true));
  mesh.position.copy(cellToPosition(cell));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(reusableBox),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.24,
    }),
  );
  mesh.add(edge);
  return mesh;
}

function createBlockMaterial(color, settled) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: settled ? 0.42 : 0.28,
    metalness: settled ? 0.18 : 0.32,
    emissive: color,
    emissiveIntensity: settled ? 0.08 : 0.2,
  });
}

function clearFilledPlanes(recentCells) {
  const candidatePlanes = new Set();
  const removed = [];

  uniqueCells(recentCells).forEach((cell) => {
    candidatePlanes.add(`x:${cell.x}`);
    candidatePlanes.add(`y:${cell.y}`);
    candidatePlanes.add(`z:${cell.z}`);
  });

  const completedPlanes = [...candidatePlanes].filter((planeId) => {
    const [axis, rawIndex] = planeId.split(":");
    return planeCells(axis, Number(rawIndex)).every((cell) => occupied.has(keyOf(cell)));
  });

  const selected = new Set();
  completedPlanes.forEach((planeId) => {
    const [axis, rawIndex] = planeId.split(":");
    planeCells(axis, Number(rawIndex)).forEach((cell) => selected.add(keyOf(cell)));
  });

  selected.forEach((cellKey) => {
    const block = occupied.get(cellKey);
    if (!block) return;
    occupied.delete(cellKey);
    occupiedGroup.remove(block);
    disposeNode(block);
    removed.push(cellKey);
  });

  return {
    cells: removed,
    planeCount: completedPlanes.length,
  };
}

function planeCells(axis, index) {
  const cells = [];
  const freeAxes = ["x", "y", "z"].filter((candidate) => candidate !== axis);

  for (let a = 0; a < STAGE_SIZE; a += 1) {
    for (let b = 0; b < STAGE_SIZE; b += 1) {
      const cell = { x: 0, y: 0, z: 0 };
      cell[axis] = index;
      cell[freeAxes[0]] = a;
      cell[freeAxes[1]] = b;
      cells.push(cell);
    }
  }

  return cells;
}

function normalizeOffsets(offsets) {
  const minA = Math.min(...offsets.map((cell) => cell.a));
  const minB = Math.min(...offsets.map((cell) => cell.b));
  const minC = Math.min(...offsets.map((cell) => cell.c));
  return offsets.map((cell) => ({
    a: cell.a - minA,
    b: cell.b - minB,
    c: cell.c - minC,
  }));
}

function getExtents(offsets) {
  return offsets.reduce(
    (extents, cell) => ({
      minA: Math.min(extents.minA, cell.a),
      maxA: Math.max(extents.maxA, cell.a),
      minB: Math.min(extents.minB, cell.b),
      maxB: Math.max(extents.maxB, cell.b),
      minC: Math.min(extents.minC, cell.c),
      maxC: Math.max(extents.maxC, cell.c),
    }),
    {
      minA: Infinity,
      maxA: -Infinity,
      minB: Infinity,
      maxB: -Infinity,
      minC: Infinity,
      maxC: -Infinity,
    },
  );
}

function cellToPosition(cell) {
  return new THREE.Vector3(
    (cell.x - CENTER) * CELL,
    (cell.y - CENTER) * CELL,
    (cell.z - CENTER) * CELL,
  );
}

function keyOf(cell) {
  return `${Math.round(cell.x)},${Math.round(cell.y)},${Math.round(cell.z)}`;
}

function uniqueCells(cells) {
  const byKey = new Map();
  cells.forEach((cell) => {
    byKey.set(keyOf(cell), {
      x: Math.round(cell.x),
      y: Math.round(cell.y),
      z: Math.round(cell.z),
    });
  });
  return [...byKey.values()];
}

function updateHud() {
  scoreEl.textContent = score.toLocaleString("ja-JP");
  levelEl.textContent = String(level);
  clearsEl.textContent = String(clears);
  incomingEl.textContent = active ? active.dir.label : "-";
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeNode(child);
  }
}

function disposeNode(node) {
  node.traverse((child) => {
    if (child.geometry && child.geometry !== reusableBox) {
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => {
          if (material !== ghostMaterial) material.dispose();
        });
      } else if (child.material !== ghostMaterial) {
        child.material.dispose();
      }
    }
  });
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);

  stageGroup.rotation.x = THREE.MathUtils.damp(stageGroup.rotation.x, targetRotation.x, 8, delta);
  stageGroup.rotation.y = THREE.MathUtils.damp(stageGroup.rotation.y, targetRotation.y, 8, delta);
  stageGroup.rotation.z = THREE.MathUtils.damp(stageGroup.rotation.z, targetRotation.z, 8, delta);

  if (clearPulse > 0) {
    clearPulse = Math.max(0, clearPulse - delta * 2.2);
    stageGroup.scale.setScalar(1 + Math.sin(clearPulse * Math.PI) * 0.018);
  } else {
    stageGroup.scale.setScalar(1);
  }

  if (active) {
    active.renderDepth = THREE.MathUtils.damp(active.renderDepth, active.depth, 13, delta);
    updateActiveVisuals();
  }

  if (!isPaused && !isGameOver) {
    dropTimer += delta;
    const interval = Math.max(MIN_INTERVAL, START_INTERVAL - (level - 1) * 0.075);
    if (dropTimer >= interval) {
      dropTimer = 0;
      advancePiece();
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function updateActiveVisuals() {
  if (!active) return;
  const cells = pieceCells(active, active.renderDepth);
  activeGroup.children.forEach((mesh, index) => {
    if (!cells[index]) return;
    mesh.position.copy(cellToPosition(cells[index]));
  });
}
