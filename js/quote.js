// ============================================================
// 4DMIXX — 3D 자동 견적 프로그램
//
// STL(바이너리/ASCII), OBJ 파일을 브라우저에서 직접 파싱하여
// 부피·표면적·바운딩박스를 계산하고 견적을 산출합니다.
// 서버 업로드 없이 100% 클라이언트에서 동작합니다.
// ============================================================

// ------------------------------------------------------------
// [설정] 견적 단가 — 4DMIXX 내부 기준으로 자유롭게 수정하세요
// ------------------------------------------------------------
const PRICING = {
  materials: {
    pla:   { name: "PLA",       density: 1.24, pricePerGram: 150,  speedFactor: 1.0 },  // g/cm3, 원/g
    abs:   { name: "ABS",       density: 1.04, pricePerGram: 180,  speedFactor: 1.1 },
    petg:  { name: "PETG",      density: 1.27, pricePerGram: 200,  speedFactor: 1.15 },
    resin: { name: "레진(SLA)", density: 1.15, pricePerGram: 350,  speedFactor: 1.6 },
  },
  infill: {
    // 실제 재료 사용률 근사치 (쉘 포함)
    20:  0.35,
    50:  0.60,
    100: 1.00,
  },
  baseFee: 5000,            // 기본 셋업비 (원)
  machineRatePerHour: 3000, // 장비 가동비 (원/시간)
  printSpeedCm3PerHour: 15, // 기준 출력 속도 (cm3/시간, FDM 기준)
  minPrice: 8000,           // 최소 주문 금액
  qtyDiscount: [            // 수량 할인
    { min: 10, rate: 0.10 },
    { min: 5,  rate: 0.05 },
  ],
  maxSizeMm: 300,           // 출력 가능 최대 크기 (한 변 기준)
};

// ------------------------------------------------------------
// 상태
// ------------------------------------------------------------
const state = {
  geometry: null,     // THREE.BufferGeometry
  mesh: null,
  volumeCm3: 0,
  areaCm2: 0,
  bbox: null,         // {x,y,z} mm
  material: "pla",
  infill: 20,
  qty: 1,
  fileName: "",
};

let scene, camera, renderer, controlsState;

// ------------------------------------------------------------
// Three.js 뷰어 초기화
// ------------------------------------------------------------
function initViewer() {
  const container = document.getElementById("viewer");
  const w = container.clientWidth, h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2025);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
  camera.position.set(120, 90, 120);

  renderer = new THREE.WebGLRenderer({ canvas: container, antialias: true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 조명
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8b92a0, 0.35);
  fill.position.set(-1.5, -0.5, -1);
  scene.add(fill);

  // 빌드플레이트 그리드
  const grid = new THREE.GridHelper(300, 30, 0x33373e, 0x24272d);
  scene.add(grid);

  // 간단한 궤도 컨트롤 (OrbitControls 미사용 — r128 호환 자체 구현)
  controlsState = { rotX: 0.5, rotY: 0.8, dist: 200, panX: 0, panY: 30, dragging: false, lastX: 0, lastY: 0, btn: 0 };

  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => {
    controlsState.dragging = true;
    controlsState.btn = e.button;
    controlsState.lastX = e.clientX;
    controlsState.lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointerup", (e) => {
    controlsState.dragging = false;
    el.releasePointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!controlsState.dragging) return;
    const dx = e.clientX - controlsState.lastX;
    const dy = e.clientY - controlsState.lastY;
    controlsState.lastX = e.clientX;
    controlsState.lastY = e.clientY;
    if (controlsState.btn === 2 || e.shiftKey) {
      controlsState.panX -= dx * controlsState.dist * 0.001;
      controlsState.panY += dy * controlsState.dist * 0.001;
    } else {
      controlsState.rotY += dx * 0.008;
      controlsState.rotX += dy * 0.008;
      controlsState.rotX = Math.max(-1.5, Math.min(1.5, controlsState.rotX));
    }
  });
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    controlsState.dist *= e.deltaY > 0 ? 1.1 : 0.9;
    controlsState.dist = Math.max(20, Math.min(2000, controlsState.dist));
  }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    const w2 = container.clientWidth, h2 = container.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2, false);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  const c = controlsState;
  const cx = c.dist * Math.cos(c.rotX) * Math.sin(c.rotY);
  const cy = c.dist * Math.sin(c.rotX);
  const cz = c.dist * Math.cos(c.rotX) * Math.cos(c.rotY);
  camera.position.set(cx + c.panX, cy + c.panY, cz);
  camera.lookAt(c.panX, c.panY, 0);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------
// 파일 파싱 (STL 바이너리/ASCII, OBJ)
// ------------------------------------------------------------
function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      let geometry;
      if (ext === "stl") {
        geometry = parseSTL(e.target.result);
      } else if (ext === "obj") {
        geometry = parseOBJ(new TextDecoder().decode(e.target.result));
      } else {
        throw new Error(`'.${ext}' 형식은 지원하지 않습니다. STL 또는 OBJ 파일을 올려주세요.`);
      }
      onGeometryLoaded(geometry, file.name);
    } catch (err) {
      showError(err.message || "파일을 읽는 중 오류가 발생했습니다.");
    }
  };
  reader.onerror = () => showError("파일을 읽을 수 없습니다.");
  reader.readAsArrayBuffer(file);
}

function parseSTL(buffer) {
  // ASCII 여부 판별
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)));
  const isAscii = head.trimStart().startsWith("solid") && head.includes("facet");
  return isAscii
    ? parseSTLAscii(new TextDecoder().decode(buffer))
    : parseSTLBinary(buffer);
}

function parseSTLBinary(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) throw new Error("올바른 STL 파일이 아닙니다.");
  const triCount = view.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (expected > buffer.byteLength) throw new Error("STL 파일이 손상되었거나 형식이 맞지 않습니다.");

  const positions = new Float32Array(triCount * 9);
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // normal skip
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // attribute byte count
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function parseSTLAscii(text) {
  const verts = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (verts.length < 9) throw new Error("STL에서 삼각형 데이터를 찾지 못했습니다.");
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.computeVertexNormals();
  return geo;
}

function parseOBJ(text) {
  const v = [];
  const tris = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("v ")) {
      const p = t.split(/\s+/);
      v.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (t.startsWith("f ")) {
      const idx = t.split(/\s+/).slice(1).map(s => {
        let i = parseInt(s.split("/")[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      // 팬 트라이앵글화
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push(idx[0], idx[i], idx[i + 1]);
      }
    }
  }
  if (tris.length === 0) throw new Error("OBJ에서 면(face) 데이터를 찾지 못했습니다.");
  const positions = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const p = v[tris[i]];
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------
// 메쉬 측정 (부피 / 표면적 / 바운딩박스)
// ------------------------------------------------------------
function measureGeometry(geo) {
  const pos = geo.getAttribute("position");
  let volume = 0, area = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    // 부피: 원점 기준 사면체의 부호 있는 부피 합
    volume += a.dot(b.clone().cross(c)) / 6;
    // 표면적
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    area += cross.crossVectors(ab, ac).length() / 2;
  }

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);

  return {
    volumeCm3: Math.abs(volume) / 1000, // mm3 → cm3
    areaCm2: area / 100,                // mm2 → cm2
    bbox: { x: size.x, y: size.y, z: size.z },
  };
}

// ------------------------------------------------------------
// 견적 계산
// ------------------------------------------------------------
function calcQuote() {
  if (!state.geometry) return null;

  const mat = PRICING.materials[state.material];
  const infillFactor = PRICING.infill[state.infill];

  const usedVolumeCm3 = state.volumeCm3 * infillFactor;
  const weightG = usedVolumeCm3 * mat.density;
  const materialCost = weightG * mat.pricePerGram;

  const printHours = (usedVolumeCm3 / PRICING.printSpeedCm3PerHour) * mat.speedFactor;
  const machineCost = printHours * PRICING.machineRatePerHour;

  let unitPrice = materialCost + machineCost;
  let total = PRICING.baseFee + unitPrice * state.qty;

  // 수량 할인
  let discountRate = 0;
  for (const d of PRICING.qtyDiscount) {
    if (state.qty >= d.min) { discountRate = d.rate; break; }
  }
  total *= (1 - discountRate);
  total = Math.max(total, PRICING.minPrice);
  total = Math.round(total / 100) * 100; // 백원 단위 반올림

  return {
    weightG, printHours, unitPrice, total, discountRate,
    oversize: Math.max(state.bbox.x, state.bbox.y, state.bbox.z) > PRICING.maxSizeMm,
  };
}

// ------------------------------------------------------------
// UI 갱신
// ------------------------------------------------------------
function fmt(n, d = 1) { return n.toLocaleString("ko-KR", { maximumFractionDigits: d }); }

function refreshUI() {
  const q = calcQuote();
  const has = !!state.geometry;

  document.getElementById("m-size").textContent  = has ? `${fmt(state.bbox.x)} × ${fmt(state.bbox.y)} × ${fmt(state.bbox.z)} mm` : "—";
  document.getElementById("m-vol").textContent   = has ? `${fmt(state.volumeCm3, 2)} cm³` : "—";
  document.getElementById("m-area").textContent  = has ? `${fmt(state.areaCm2, 1)} cm²` : "—";
  document.getElementById("m-weight").textContent= q ? `약 ${fmt(q.weightG, 1)} g` : "—";
  document.getElementById("m-time").textContent  = q ? `약 ${fmt(q.printHours, 1)} 시간` : "—";

  const priceEl = document.getElementById("price-value");
  const perUnitEl = document.getElementById("price-per-unit");
  if (q) {
    priceEl.innerHTML = `${fmt(q.total, 0)}<span class="won"> 원</span>`;
    // 개당 단가는 관리자(admin.html 인증 세션)에게만 노출 — 원가 역산 방지
    const isAdmin = sessionStorage.getItem('adm') === '1';
    let sub = '';
    if (isAdmin) {
      sub = `[관리자] 1개당 약 ${fmt(q.unitPrice, 0)}원`;
      if (q.discountRate > 0) sub += ` · 수량할인 ${q.discountRate * 100}% 적용`;
    } else if (q.discountRate > 0) {
      sub = `수량할인 ${q.discountRate * 100}% 적용됨`;
    } else {
      sub = `부가세 별도 · 소재/후가공에 따라 변동될 수 있습니다`;
    }
    perUnitEl.textContent = sub;
  } else {
    priceEl.innerHTML = `—<span class="won"> 원</span>`;
    perUnitEl.textContent = "파일을 업로드하면 자동 계산됩니다";
  }

  const err = document.getElementById("err-msg");
  if (q && q.oversize) {
    err.textContent = `⚠ 한 변이 ${PRICING.maxSizeMm}mm를 초과합니다. 분할 출력 여부는 상담을 통해 안내드립니다.`;
    err.classList.add("show");
  } else {
    err.classList.remove("show");
  }

  document.getElementById("order-btn").disabled = !has;

  // HUD
  document.getElementById("hud-tri").textContent = has
    ? `TRI ${(state.geometry.getAttribute("position").count / 3).toLocaleString()}`
    : "";
}

// ------------------------------------------------------------
// 지오메트리 로드 완료 처리
// ------------------------------------------------------------
function onGeometryLoaded(geometry, fileName) {
  // 기존 메쉬 제거
  if (state.mesh) {
    scene.remove(state.mesh);
    state.mesh.geometry.dispose();
    state.mesh.material.dispose();
  }

  const m = measureGeometry(geometry);
  state.geometry = geometry;
  state.volumeCm3 = m.volumeCm3;
  state.areaCm2 = m.areaCm2;
  state.bbox = m.bbox;
  state.fileName = fileName;

  // 메쉬 생성 및 중앙 정렬 (바닥에 안착)
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8dce3, metalness: 0.15, roughness: 0.55,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const center = new THREE.Vector3();
  bb.getCenter(center);
  mesh.position.set(-center.x, -bb.min.y, -center.z);

  scene.add(mesh);
  state.mesh = mesh;

  // 카메라 거리 자동 조정
  const maxDim = Math.max(m.bbox.x, m.bbox.y, m.bbox.z);
  controlsState.dist = maxDim * 2.2;
  controlsState.panY = m.bbox.y / 2;

  document.getElementById("viewer-empty").classList.add("hidden");
  document.getElementById("file-name").textContent = fileName;
  refreshUI();
}

function showError(msg) {
  const err = document.getElementById("err-msg");
  err.textContent = "⚠ " + msg;
  err.classList.add("show");
}

// ------------------------------------------------------------
// 이벤트 바인딩
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initViewer();
  refreshUI();

  const fileInput = document.getElementById("file-input");
  const dropzone = document.getElementById("viewer-empty");
  const panel = document.querySelector(".viewer-panel");

  // 파일 선택은 label(for="file-input")이 네이티브로 처리 — JS click() 불필요
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) parseFile(fileInput.files[0]);
    fileInput.value = "";
  });

  // 드래그&드롭
  ["dragenter", "dragover"].forEach(ev =>
    panel.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach(ev =>
    panel.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  panel.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) parseFile(e.dataTransfer.files[0]);
  });

  // 재질 선택
  document.querySelectorAll("[data-material]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-material]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.material = btn.dataset.material;
      refreshUI();
    });
  });

  // 내부채움 선택
  document.querySelectorAll("[data-infill]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-infill]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.infill = parseInt(btn.dataset.infill, 10);
      refreshUI();
    });
  });

  // 수량
  const qtyInput = document.getElementById("qty");
  document.getElementById("qty-minus").addEventListener("click", () => {
    qtyInput.value = Math.max(1, parseInt(qtyInput.value || 1, 10) - 1);
    state.qty = parseInt(qtyInput.value, 10);
    refreshUI();
  });
  document.getElementById("qty-plus").addEventListener("click", () => {
    qtyInput.value = parseInt(qtyInput.value || 1, 10) + 1;
    state.qty = parseInt(qtyInput.value, 10);
    refreshUI();
  });
  qtyInput.addEventListener("input", () => {
    state.qty = Math.max(1, parseInt(qtyInput.value || 1, 10));
    refreshUI();
  });

  // 주문 문의 → contact 페이지로 견적 정보 전달
  document.getElementById("order-btn").addEventListener("click", () => {
    const q = calcQuote();
    if (!q) return;
    const mat = PRICING.materials[state.material];
    const summary =
      `[3D 자동견적 문의]\n` +
      `파일명: ${state.fileName}\n` +
      `크기: ${fmt(state.bbox.x)} × ${fmt(state.bbox.y)} × ${fmt(state.bbox.z)} mm\n` +
      `부피: ${fmt(state.volumeCm3, 2)} cm³\n` +
      `재질: ${mat.name} / 내부채움 ${state.infill}%\n` +
      `수량: ${state.qty}개\n` +
      `예상 견적: ${fmt(q.total, 0)}원\n\n` +
      `※ 도면 파일은 이메일로 함께 보내주세요.`;
    sessionStorage.setItem("quoteSummary", summary);
    location.href = "contact.html?from=quote";
  });
});
