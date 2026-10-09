import * as THREE from 'three';

/**
 * 「ポスターが凹んで窓になり、奥の部屋を覗ける」表示を作る。
 *
 * 部屋の見た目は glb（じん担当）、窓として成り立たせる仕組みはここ（コード）、という分担。
 * 部屋の glb の決まりごとは scripts/build-sample-room.mjs の冒頭を参照。
 *
 * ── 仕組み ──────────────────────────────────────────────
 *
 *   横から見た図（左がカメラ側）
 *
 *        z=0 ポスター面
 *          ┃
 *   カメラ ┃   ┌────────┐
 *     ──>  ┃ 窓│  部屋  │   部屋はマーカー面より奥（-Z）に置く
 *          ┃   └────────┘
 *          ┃
 *        遮蔽板（窓の部分だけ穴が空いている）
 *
 *   遮蔽板は「色を描かず、奥行きだけ書き込む」板。これより奥にあるものは
 *   深度テストで消えるので、板のある所にはカメラ映像（実物のポスター）が
 *   そのまま見え、穴の所だけ部屋が見える。
 *   この設定は glTF では表現できないので、遮蔽板は必ずコードで作る。
 *
 * ── 座標 ──────────────────────────────────────────────
 *
 *   MindAR のアンカー座標は、マーカーの中心が原点、幅が 1.0、
 *   マーカー面が XY 平面、+Z がカメラ側。glb の部屋も Y が上・-Z が奥なので、
 *   回転させずにそのまま置ける。
 */

export type Portal = {
  /** アンカーにぶら下げる一式 */
  root: THREE.Group;
  /** 部屋の中身。モデルはここに入れる（凹む演出で一緒に伸び縮みする） */
  room: THREE.Group;
  /** 部屋の glb の ModelSpot の位置（room 内の座標）。無ければ null */
  modelSpot: THREE.Vector3 | null;
  /** 窓の大きさ（マーカーの幅を 1.0 とした値） */
  windowWidth: number;
  windowHeight: number;
  /** 0 → 1 で「平らなポスターが凹んで部屋になる」演出を進める */
  setOpen: (t: number) => void;
};

/** 窓の縁の厚み。ポスターに厚みがあるように見せ、凹んだ感じを出す */
const REVEAL_DEPTH = 0.03;

/** 窓の部分だけ穴の空いた遮蔽板を作る */
function createOccluder(windowWidth: number, windowHeight: number): THREE.Mesh {
  // 斜めから覗かれても部屋が板の外に漏れないよう、十分に大きくする
  const half = 20;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.lineTo(-half, half);
  shape.closePath();

  const w = windowWidth / 2;
  const h = windowHeight / 2;
  const hole = new THREE.Path();
  hole.moveTo(-w, -h);
  hole.lineTo(-w, h);
  hole.lineTo(w, h);
  hole.lineTo(w, -h);
  hole.closePath();
  shape.holes.push(hole);

  const material = new THREE.MeshBasicMaterial({ colorWrite: false });
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  // 部屋より先に描いて、深度を先に埋めておく
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * 窓の縁（ポスターの厚み）。4辺の内側の面。
 * 窓の大きさに合わせる必要があるのでコードで作る。
 */
function createReveal(windowWidth: number, windowHeight: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xf2eee6, side: THREE.DoubleSide });
  const d = REVEAL_DEPTH;
  const w = windowWidth;
  const h = windowHeight;

  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, h / 2, -d / 2);

  const bottom = top.clone();
  bottom.position.y = -h / 2;

  const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), material);
  left.rotation.y = Math.PI / 2;
  left.position.set(-w / 2, 0, -d / 2);

  const right = left.clone();
  right.position.x = w / 2;

  group.add(top, bottom, left, right);
  return group;
}

/**
 * 部屋の glb から窓を組み立てる。
 *
 * @param roomScene    部屋の glb（gltf.scene）
 * @param windowWidth  ポスター上での窓の幅（マーカーの幅を 1.0 とした値）
 */
export function createPortal(roomScene: THREE.Object3D, windowWidth: number): Portal {
  const windowNode = roomScene.getObjectByName('Window');
  if (!windowNode) {
    throw new Error('部屋の glb に「Window」という名前のオブジェクトがありません');
  }

  // Window の大きさと位置を、部屋の glb の座標で測る
  roomScene.updateMatrixWorld(true);
  const windowBox = new THREE.Box3().setFromObject(windowNode);
  const windowSize = windowBox.getSize(new THREE.Vector3());
  const windowCenter = windowBox.getCenter(new THREE.Vector3());
  windowNode.visible = false;

  if (windowSize.x <= 0 || windowSize.y <= 0) {
    throw new Error('部屋の glb の「Window」に大きさがありません');
  }

  // 部屋を拡大縮小して、Window の幅をポスター上の窓の幅に合わせる。
  // 窓の中心が原点（＝マーカーの中心）に来るよう、部屋ごとずらす
  const scale = windowWidth / windowSize.x;
  const windowHeight = windowSize.y * scale;
  const fitted = new THREE.Group();
  roomScene.position.sub(windowCenter);
  fitted.add(roomScene);
  fitted.scale.setScalar(scale);

  // 凹む演出は Z 方向の伸び縮みで表すので、拡大縮小とは別の入れ物にする
  const room = new THREE.Group();
  room.add(fitted);

  let modelSpot: THREE.Vector3 | null = null;
  const spotNode = roomScene.getObjectByName('ModelSpot');
  if (spotNode) {
    room.updateMatrixWorld(true);
    modelSpot = room.worldToLocal(spotNode.getWorldPosition(new THREE.Vector3()));
  }

  const root = new THREE.Group();
  root.add(createOccluder(windowWidth, windowHeight));
  root.add(createReveal(windowWidth, windowHeight));
  root.add(room);

  function setOpen(t: number): void {
    // 0 にすると行列が潰れて描画が乱れるので、ごく薄い状態から始める
    const eased = 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
    room.scale.z = Math.max(eased, 0.001);
  }

  return { root, room, modelSpot, windowWidth, windowHeight, setOpen };
}

/**
 * モデル（中心が原点の pivot）を、底面が ModelSpot に来るよう置く。
 * ModelSpot が無い部屋では何もしない。
 */
export function placeOnSpot(portal: Portal, pivot: THREE.Object3D): boolean {
  if (!portal.modelSpot) return false;
  const height = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3()).y;
  pivot.position.copy(portal.modelSpot);
  pivot.position.y += height / 2;
  portal.room.add(pivot);
  return true;
}
