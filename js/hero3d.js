// ============================================================
// 히어로 3D — "레이어가 쌓이며 만들어지는" 기어 오브젝트
// 3D프린팅의 적층 과정을 모티프로: 슬라이스가 아래부터 차오르고,
// 완성되면 천천히 회전. 마우스를 따라 살짝 기울어짐.
// ============================================================
(function(){
  const canvas = document.getElementById('hero3d');
  if(!canvas || !window.THREE) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wrap = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.1, 7.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xe8eef0, 0x14161a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(3, 6, 4); scene.add(key);
  const rim = new THREE.PointLight(0xff5a1f, 0.9, 20);   // 오렌지 림
  rim.position.set(-4, 1, -2); scene.add(rim);
  const cyan = new THREE.PointLight(0x00d9ff, 0.6, 20);  // 레이저 시안
  cyan.position.set(4, -2, 3); scene.add(cyan);

  // ── 기어 형상 (톱니 12개 원판 + 중심 보스 + 축 구멍 느낌)
  function gearShape(teeth, rOut, rIn, depth){
    const shape = new THREE.Shape();
    const steps = teeth * 4;
    for(let i = 0; i <= steps; i++){
      const a = i / steps * Math.PI * 2;
      const tooth = Math.floor(i / 4) % 1;
      const seg = i % 4;
      const r = (seg === 1 || seg === 2) ? rOut : rIn;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, rOut * 0.28, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:true, bevelThickness:0.05, bevelSize:0.05, bevelSegments:2});
  }

  const group = new THREE.Group();
  scene.add(group);

  const mat = new THREE.MeshStandardMaterial({color:0xd9dde3, metalness:0.55, roughness:0.35});
  const matWire = new THREE.LineBasicMaterial({color:0x00d9ff, transparent:true, opacity:0.16});

  const gearGeo = gearShape(12, 1.9, 1.55, 0.55);
  gearGeo.center();
  const gear = new THREE.Mesh(gearGeo, mat);
  gear.rotation.x = Math.PI / 2;
  group.add(gear);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(gearGeo), matWire);
  wire.rotation.x = Math.PI / 2;
  group.add(wire);

  // 작은 보조 기어
  const smallGeo = gearShape(9, 0.85, 0.68, 0.45);
  smallGeo.center();
  const small = new THREE.Mesh(smallGeo, mat.clone());
  small.rotation.x = Math.PI / 2;
  small.position.set(2.55, 0.28, 0.4);
  group.add(small);

  // ── 적층 연출: 클리핑 평면이 아래→위로 올라가며 "출력되는" 느낌
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), -2.2);
  renderer.clippingPlanes = [clip];
  renderer.localClippingEnabled = true;

  // 프린트 헤드 라인 (클리핑 높이를 따라다니는 시안 스캔라인)
  const lineGeo = new THREE.PlaneGeometry(7, 0.02);
  const scanline = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({color:0x00d9ff, transparent:true, opacity:0.7}));
  scene.add(scanline);

  let mx = 0, my = 0;
  wrap.addEventListener('pointermove', e => {
    const r = wrap.getBoundingClientRect();
    mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    my = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });

  function resize(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  const t0 = performance.now();
  (function loop(){
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;

    // 처음 3.2초: 아래부터 적층 → 이후 완성 상태 유지
    const build = Math.min(t / 3.2, 1);
    const level = -1.6 + build * 3.6;
    clip.constant = level;
    scanline.position.y = Math.min(level, 1.55);
    scanline.material.opacity = build < 1 ? 0.7 : Math.max(0, 0.7 - (t - 3.2));

    group.rotation.y = t * 0.35;
    small.rotation.z = -t * 0.9;
    group.rotation.x = my * 0.12;
    group.rotation.z = mx * 0.06;

    renderer.render(scene, camera);
  })();
})();
