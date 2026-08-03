// ============================================================
// 4DMIXX — 2D 이미지 → 3D 부조(Relief) 변환 모듈
//
// 이미지의 밝기(또는 투명도)를 높이값으로 변환해
// 3D 프린팅 가능한 솔리드 메시를 생성하고,
// 기존 견적 파이프라인(onGeometryLoaded)에 그대로 연결합니다.
// STL 다운로드도 지원합니다. 100% 클라이언트 처리.
// ============================================================

const reliefState = {
  image: null,        // HTMLImageElement
  heightData: null,   // Float32Array 0..1
  gridW: 0,
  gridH: 0,
  fileName: "",
  // 설정
  widthMM: 100,
  reliefMM: 5,
  baseMM: 2,
  resolution: 160,
  invert: false,
  smooth: true,
  mode: "luminance",  // luminance | alpha
};

// ------------------------------------------------------------
// 모드 전환 (3D 파일 / 2D 이미지)
// ------------------------------------------------------------
function setQuoteMode(mode) {
  const isImage = mode === "image";
  document.querySelectorAll("[data-qmode]").forEach(b =>
    b.classList.toggle("active", b.dataset.qmode === mode));
  document.getElementById("relief-bar").style.display = isImage ? "block" : "none";
  document.getElementById("btn-relief-stl").style.display = isImage ? "" : "none";

  // 빈 화면 문구 전환
  const emptyTitle = document.getElementById("empty-title");
  const emptyDesc  = document.getElementById("empty-desc");
  const emptyIcon  = document.querySelector("#viewer-empty .drop-icon");
  const fmts = document.getElementById("empty-formats");
  if (isImage) {
    emptyIcon.textContent = "IMG";
    emptyTitle.textContent = "이미지를 끌어다 놓으세요";
    emptyDesc.textContent = "로고·사진·도안 이미지를 올리면 밝기를 높이로 변환해 3D 부조 모델을 만들고, 바로 견적까지 계산합니다.";
    fmts.innerHTML = '<span class="spec-tag">.PNG</span><span class="spec-tag metal">.JPG</span><span class="spec-tag metal">.WEBP</span>';
  } else {
    emptyIcon.textContent = "STL";
    emptyTitle.textContent = "3D 파일을 끌어다 놓으세요";
    emptyDesc.textContent = "또는 아래 버튼으로 파일을 선택하세요. 업로드 즉시 크기·부피를 분석해 견적을 계산합니다.";
    fmts.innerHTML = '<span class="spec-tag">.STL</span><span class="spec-tag metal">.OBJ</span>';
  }
  reliefState.uiMode = mode;
}

// ------------------------------------------------------------
// 파일 라우팅: quote.js의 parseFile을 감싸서 이미지도 처리
// ------------------------------------------------------------
function routeFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext);

  if (isImage) {
    if (reliefState.uiMode !== "image") setQuoteMode("image");
    loadReliefImage(file);
  } else {
    if (reliefState.uiMode !== "file") setQuoteMode("file");
    parseFile(file); // 기존 quote.js
  }
}

function loadReliefImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      reliefState.image = img;
      reliefState.fileName = file.name;
      document.getElementById("relief-filename").textContent = file.name;
      rebuildRelief();
    };
    img.onerror = () => showError("이미지를 읽을 수 없습니다.");
    img.src = e.target.result;
  };
  reader.onerror = () => showError("파일을 읽을 수 없습니다.");
  reader.readAsDataURL(file);
}

// ------------------------------------------------------------
// 이미지 → 하이트맵
// ------------------------------------------------------------
function computeHeightmap() {
  const img = reliefState.image;
  const target = reliefState.resolution;
  const scale = target / Math.max(img.width, img.height);
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));

  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const ctx = off.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  let data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i*4], g = px[i*4+1], b = px[i*4+2], a = px[i*4+3];
    data[i] = reliefState.mode === "alpha"
      ? a / 255
      : (0.299*r + 0.587*g + 0.114*b) / 255;
  }

  if (reliefState.smooth) data = reliefBlur(data, w, h);
  if (reliefState.invert) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];

  reliefState.heightData = data;
  reliefState.gridW = w;
  reliefState.gridH = h;
}

function reliefBlur(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) { sum += src[ny*w + nx]; n++; }
        }
      }
      out[y*w + x] = sum / n;
    }
  }
  return out;
}

// ------------------------------------------------------------
// 하이트맵 → 솔리드 메시 (윗면 + 바닥 + 4측벽)
// Three.js 좌표계: 바닥이 XZ 평면, 높이가 +Y (기존 뷰어와 동일)
// ------------------------------------------------------------
function buildReliefGeometry() {
  const { heightData, gridW: nx, gridH: ny, widthMM, reliefMM, baseMM } = reliefState;
  const depthMM = widthMM * (ny - 1) / (nx - 1); // 이미지 종횡비 유지

  const dx = widthMM / (nx - 1);
  const dz = depthMM / (ny - 1);

  const topY = (i, j) => baseMM + heightData[i*nx + j] * reliefMM;
  const X = j => j * dx;
  const Z = i => i * dz;

  const tris = [];
  const push = (...v) => tris.push(...v);

  // 윗면 (법선 +Y가 되도록 시계 반대 방향)
  for (let i = 0; i < ny - 1; i++) {
    for (let j = 0; j < nx - 1; j++) {
      const yA = topY(i, j),   yB = topY(i, j+1);
      const yC = topY(i+1, j), yD = topY(i+1, j+1);
      push(X(j),Z(i),yA,  X(j),Z(i+1),yC,  X(j+1),Z(i),yB);
      push(X(j+1),Z(i),yB, X(j),Z(i+1),yC, X(j+1),Z(i+1),yD);
    }
  }
  // 위에서 (x, z, y) 순으로 넣었으므로 실제 좌표 배치 시 재배열
  const positions = new Float32Array(tris.length);
  for (let t = 0; t < tris.length; t += 3) {
    positions[t]   = tris[t];       // x
    positions[t+1] = tris[t+2];     // y(높이)
    positions[t+2] = tris[t+1];     // z
  }

  // 바닥 + 측벽은 직접 (x,y,z)로 추가
  const extra = [];
  const E = (x,y,z) => extra.push(x,y,z);
  const x1 = (nx-1)*dx, z1 = (ny-1)*dz;

  // 바닥 (법선 -Y)
  E(0,0,0); E(x1,0,0); E(0,0,z1);
  E(x1,0,0); E(x1,0,z1); E(0,0,z1);

  // 측벽 4면
  for (let j = 0; j < nx - 1; j++) {   // z=0 변
    const ya = topY(0,j), yb = topY(0,j+1);
    E(X(j),0,0); E(X(j),ya,0); E(X(j+1),yb,0);
    E(X(j),0,0); E(X(j+1),yb,0); E(X(j+1),0,0);
  }
  for (let j = 0; j < nx - 1; j++) {   // z=z1 변
    const ya = topY(ny-1,j), yb = topY(ny-1,j+1);
    E(X(j+1),0,z1); E(X(j+1),yb,z1); E(X(j),ya,z1);
    E(X(j+1),0,z1); E(X(j),ya,z1); E(X(j),0,z1);
  }
  for (let i = 0; i < ny - 1; i++) {   // x=0 변
    const ya = topY(i,0), yb = topY(i+1,0);
    E(0,0,Z(i+1)); E(0,yb,Z(i+1)); E(0,ya,Z(i));
    E(0,0,Z(i+1)); E(0,ya,Z(i)); E(0,0,Z(i));
  }
  for (let i = 0; i < ny - 1; i++) {   // x=x1 변
    const ya = topY(i,nx-1), yb = topY(i+1,nx-1);
    E(x1,0,Z(i)); E(x1,ya,Z(i)); E(x1,yb,Z(i+1));
    E(x1,0,Z(i)); E(x1,yb,Z(i+1)); E(x1,0,Z(i+1));
  }

  const all = new Float32Array(positions.length + extra.length);
  all.set(positions, 0);
  all.set(extra, positions.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(all, 3));
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------
// 재생성 → 기존 견적 파이프라인 호출
// ------------------------------------------------------------
function rebuildRelief() {
  if (!reliefState.image) return;
  computeHeightmap();
  const geo = buildReliefGeometry();
  const baseName = reliefState.fileName.replace(/\.[^.]+$/, "");
  onGeometryLoaded(geo, `${reliefState.fileName} → ${baseName}_relief.stl`);
  document.getElementById("btn-relief-stl").disabled = false;
}

// ------------------------------------------------------------
// 바이너리 STL 내보내기 (현재 견적 대상 지오메트리)
// ------------------------------------------------------------
function downloadReliefSTL() {
  if (!state.geometry) return;
  const pos = state.geometry.getAttribute("position");
  const triCount = pos.count / 3;

  const buffer = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buffer);
  const header = "4DMIXX relief STL";
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  dv.setUint32(80, triCount, true);

  let off = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const u = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t*3);
    b.fromBufferAttribute(pos, t*3+1);
    c.fromBufferAttribute(pos, t*3+2);
    u.subVectors(b, a); v.subVectors(c, a);
    n.crossVectors(u, v).normalize();
    dv.setFloat32(off, n.x, true); dv.setFloat32(off+4, n.y, true); dv.setFloat32(off+8, n.z, true);
    dv.setFloat32(off+12, a.x, true); dv.setFloat32(off+16, a.y, true); dv.setFloat32(off+20, a.z, true);
    dv.setFloat32(off+24, b.x, true); dv.setFloat32(off+28, b.y, true); dv.setFloat32(off+32, b.z, true);
    dv.setFloat32(off+36, c.x, true); dv.setFloat32(off+40, c.y, true); dv.setFloat32(off+44, c.z, true);
    dv.setUint16(off+48, 0, true);
    off += 50;
  }

  const baseName = (reliefState.fileName || "model").replace(/\.[^.]+$/, "");
  const blob = new Blob([buffer], { type: "application/sla" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}_relief.stl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// 이벤트 바인딩
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  reliefState.uiMode = "file";

  // 모드 탭
  document.querySelectorAll("[data-qmode]").forEach(btn =>
    btn.addEventListener("click", () => setQuoteMode(btn.dataset.qmode)));

  // 파일 입력을 라우터로 교체 (quote.js 바인딩보다 나중에 실행되므로 capture 사용)
  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", (e) => {
    if (fileInput.files.length) {
      e.stopImmediatePropagation();
      routeFile(fileInput.files[0]);
      fileInput.value = "";
    }
  }, true);

  const panel = document.querySelector(".viewer-panel");
  panel.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) {
      e.stopImmediatePropagation();
      e.preventDefault();
      document.getElementById("viewer-empty").classList.remove("dragover");
      routeFile(e.dataTransfer.files[0]);
    }
  }, true);

  // 슬라이더/토글
  const bind = (id, valId, key, suffix, dec) => {
    const r = document.getElementById(id), v = document.getElementById(valId);
    const upd = () => {
      v.textContent = parseFloat(r.value).toFixed(dec) + suffix;
      reliefState[key] = parseFloat(r.value);
    };
    r.addEventListener("input", upd);
    r.addEventListener("change", () => rebuildRelief());
    upd();
  };
  bind("rl-width",  "rl-width-v",  "widthMM", " mm", 0);
  bind("rl-relief", "rl-relief-v", "reliefMM"," mm", 1);
  bind("rl-base",   "rl-base-v",   "baseMM",  " mm", 1);
  bind("rl-res",    "rl-res-v",    "resolution"," px", 0);

  const wireToggle = (id, key) => {
    const el = document.getElementById(id);
    el.addEventListener("click", () => {
      reliefState[key] = !reliefState[key];
      el.classList.toggle("active", reliefState[key]);
      rebuildRelief();
    });
  };
  wireToggle("rl-invert", "invert");
  document.getElementById("rl-smooth").classList.add("active");
  wireToggle("rl-smooth", "smooth");

  document.getElementById("rl-mode").addEventListener("change", (e) => {
    reliefState.mode = e.target.value;
    rebuildRelief();
  });

  document.getElementById("btn-relief-stl").addEventListener("click", downloadReliefSTL);
});
