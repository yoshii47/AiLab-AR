/**
 * 窓（ポータル）表示を、カメラもマーカーも使わずに PC で確認するためのページ。
 * 実機ではカメラ映像に写ったポスターが背景になるが、ここでは画像を板に貼って代用する。
 * 開発用で、本番の index.html からは読み込まれない。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createPortal, placeOnSpot } from './portal';
import type { Portal } from './portal';
import { TARGETS } from './targets';
// 窓の表示にしているマーカーのポスター画像。窓のマーカーを変えたらここも変える
import posterUrl from './assets/markers/poison-soup-room.png?url';

const def = TARGETS.find((t) => t.portal)!;
const portalDef = def.portal!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2b2b);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(1, 2, 3);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 1.6);

// ポスター（実機ではカメラ映像）。奥行きを書かずに先に描くので、窓の中は部屋で上書きされる
const texture = new THREE.TextureLoader().load(posterUrl, (tex) => {
  const aspect = tex.image.height / tex.image.width;
  poster.scale.set(1, aspect, 1);
});
texture.colorSpace = THREE.SRGBColorSpace;
const poster = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: texture, depthWrite: false }),
);
poster.renderOrder = -2;
scene.add(poster);

const loader = new GLTFLoader();
let portal: Portal | null = null;
let spinning: THREE.Object3D | null = null;
const mixers: THREE.AnimationMixer[] = [];

/** 本番（main.ts）と同じ手順で、部屋の glb とモデルを組み立てる */
async function build(): Promise<void> {
  const [gltf, roomGltf] = await Promise.all([
    def.modelUrl ? loader.loadAsync(def.modelUrl) : Promise.resolve(null),
    loader.loadAsync(portalDef.roomUrl),
  ]);
  portal = createPortal(roomGltf.scene, portalDef.windowWidth);
  scene.add(portal.root);

  if (gltf) {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = (def.scale ?? 1) / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(scale);
    model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scale));
    const pivot = new THREE.Group();
    pivot.add(model);
    if (placeOnSpot(portal, pivot) && def.spin) spinning = pivot;
  }

  for (const g of [gltf, roomGltf]) {
    if (!g) continue;
    if (g.animations.length === 0) continue;
    const mixer = new THREE.AnimationMixer(g.scene);
    for (const clip of g.animations) mixer.clipAction(clip).play();
    mixers.push(mixer);
  }
}
void build();


const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
// 実機でも、ポスターの裏や真横からは覗けない
controls.minAzimuthAngle = -1.2;
controls.maxAzimuthAngle = 1.2;
controls.minPolarAngle = 0.4;
controls.maxPolarAngle = Math.PI - 0.4;
controls.minDistance = 0.3;
controls.maxDistance = 4;

// ダブルクリックで凹む演出を再生し直す
const clock = new THREE.Clock();
let openedAt = 0;
renderer.domElement.addEventListener('dblclick', () => {
  openedAt = clock.elapsedTime;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const t = clock.elapsedTime;
  for (const mixer of mixers) mixer.update(delta);
  portal?.setOpen((t - openedAt) / 0.9);
  if (spinning) spinning.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
});
