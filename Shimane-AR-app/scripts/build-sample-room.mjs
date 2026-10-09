/**
 * 窓（ポータル）表示用の「見本の部屋」を glb に書き出す。
 *
 *   node scripts/build-sample-room.mjs
 *   → src/assets/glb/sample-room.glb
 *
 * 本番の部屋はじんが Blender 等で作る。これはその見本で、
 * 「アプリが部屋の glb に何を期待しているか」を実物で示すためのもの。
 * glTF Viewer や Blender に読み込んで、中身の構成を確認できる。
 *
 * ── 部屋の glb の決まりごと ─────────────────────────────
 *
 *   座標（glTF の向き。Blender では書き出し時に自動変換される）
 *     Y が上。窓（ポスター面）は Z=0 の面で、部屋は -Z 側（奥）に広がる。
 *     カメラは +Z 側から覗く。
 *
 *   名前の決まったオブジェクト（アプリが名前で探す）
 *     Window    … 窓の大きさを示す長方形（Z=0 に置く）。アプリでは非表示になり、
 *                 この幅がポスター上の窓の幅に合うよう部屋全体が拡大縮小される。
 *                 縦横比もここで決まる。
 *     ModelSpot … マーカーごとのモデルを置く位置（空のオブジェクト）。
 *                 モデルの底面がここに来る。無ければモデルは置かない。
 *
 *   その他
 *     - 手前（Z=0 側）の壁は作らない。作ると窓が塞がる
 *     - 部屋は Window より広く作る。傾けたときに奥が回り込んで見えるため
 *     - 照明は色やテクスチャに焼き込む（照明を受けない unlit 素材にする）
 *     - 中に置く小物は通常の素材でもよい（アプリの照明で陰影がつく）
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter はブラウザ用で、glb の組み立てに FileReader を使う。Node には無いので最小限を補う
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const OUT = new URL('../src/assets/glb/sample-room.glb', import.meta.url);

// ── 寸法（単位は自由。アプリは Window の幅を基準に拡大縮小する）──
const WINDOW_W = 0.7;
const WINDOW_H = 0.9;
const ROOM_W = 1.4;
const ROOM_H = 1.1;
const ROOM_D = 1.0;
const FLOOR_Y = -ROOM_H / 2;

/** 照明を受けない素材。glb では KHR_materials_unlit として保存される */
function unlit(color) {
  return new THREE.MeshBasicMaterial({ color });
}

/** 小物用。アプリの照明で陰影がつく */
function lit(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
}

/** ローポリらしく面ごとに陰影が出るよう、頂点を共有しない形にする */
function faceted(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

function mesh(name, geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  return m;
}

const room = new THREE.Group();
room.name = 'SampleRoom';

// ── 窓 ──
const windowMarker = mesh('Window', new THREE.PlaneGeometry(WINDOW_W, WINDOW_H), unlit(0xff00ff));
room.add(windowMarker);

// ── 床・天井・壁（手前の壁は作らない）──
const cz = -ROOM_D / 2;

const floor = mesh('Floor', new THREE.PlaneGeometry(ROOM_W, ROOM_D), unlit(0xc89a62));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, FLOOR_Y, cz);

const ceiling = mesh('Ceiling', new THREE.PlaneGeometry(ROOM_W, ROOM_D), unlit(0x8c8678));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(0, ROOM_H / 2, cz);

// 奥の壁は暗め、左右は明るさを変えて、照明が当たっているように見せる（焼き込み）
const back = mesh('WallBack', new THREE.PlaneGeometry(ROOM_W, ROOM_H), unlit(0x4f6f94));
back.position.set(0, 0, -ROOM_D);

const left = mesh('WallLeft', new THREE.PlaneGeometry(ROOM_D, ROOM_H), unlit(0x7393b8));
left.rotation.y = Math.PI / 2;
left.position.set(-ROOM_W / 2, 0, cz);

const right = mesh('WallRight', new THREE.PlaneGeometry(ROOM_D, ROOM_H), unlit(0x6585aa));
right.rotation.y = -Math.PI / 2;
right.position.set(ROOM_W / 2, 0, cz);

room.add(floor, ceiling, back, left, right);

// 床の目地。奥ですぼまって見えるので、奥行きの手がかりになる
const TILE = 8;
const seamMaterial = unlit(0x9a7444);
for (let i = 1; i < TILE; i += 1) {
  const x = -ROOM_W / 2 + (ROOM_W / TILE) * i;
  const seamZ = mesh(`FloorSeamX${i}`, new THREE.PlaneGeometry(0.006, ROOM_D), seamMaterial);
  seamZ.rotation.x = -Math.PI / 2;
  seamZ.position.set(x, FLOOR_Y + 0.001, cz);

  const z = -(ROOM_D / TILE) * i;
  const seamX = mesh(`FloorSeamZ${i}`, new THREE.PlaneGeometry(ROOM_W, 0.006), seamMaterial);
  seamX.rotation.x = -Math.PI / 2;
  seamX.position.set(0, FLOOR_Y + 0.001, z);

  room.add(seamZ, seamX);
}

// ── 小物。手前・中・奥に散らすと、スマホを動かしたときの視差で立体感が出る ──
for (const [i, x] of [-ROOM_W * 0.32, ROOM_W * 0.32].entries()) {
  const pillar = mesh(`Pillar${i}`, faceted(new THREE.BoxGeometry(0.08, ROOM_H, 0.08)), lit(0xe7dccb));
  pillar.position.set(x, 0, -ROOM_D * 0.85);
  room.add(pillar);
}

const tree = new THREE.Group();
tree.name = 'Tree';
const trunk = mesh('TreeTrunk', faceted(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 5)), lit(0x7a5230));
trunk.position.y = 0.06;
const leaves = mesh('TreeLeaves', faceted(new THREE.ConeGeometry(0.1, 0.26, 6)), lit(0x4f9a5a));
leaves.position.y = 0.24;
tree.add(trunk, leaves);
tree.position.set(-ROOM_W * 0.38, FLOOR_Y, -ROOM_D * 0.25);
room.add(tree);

const rock = mesh('Rock', faceted(new THREE.IcosahedronGeometry(0.07, 0)), lit(0x9aa0a8));
rock.position.set(ROOM_W * 0.3, FLOOR_Y + 0.05, -ROOM_D * 0.45);
room.add(rock);

const PEDESTAL_H = 0.06;
const pedestal = mesh('Pedestal', faceted(new THREE.CylinderGeometry(0.14, 0.16, PEDESTAL_H, 8)), lit(0xd9cdb8));
pedestal.position.set(0, FLOOR_Y + PEDESTAL_H / 2, -ROOM_D * 0.55);
room.add(pedestal);

// ── モデルを置く位置（台座の上面）──
const modelSpot = new THREE.Object3D();
modelSpot.name = 'ModelSpot';
modelSpot.position.set(0, FLOOR_Y + PEDESTAL_H, -ROOM_D * 0.55);
room.add(modelSpot);

const glb = await new GLTFExporter().parseAsync(room, { binary: true });
writeFileSync(OUT, Buffer.from(glb));
console.log(`書き出しました: ${OUT.pathname} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
