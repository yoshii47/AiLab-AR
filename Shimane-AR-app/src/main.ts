import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';

import { MARKER_URL, TARGETS } from './targets';
import { createPortal, placeOnSpot } from './portal';
import type { Portal } from './portal';
import { RotateControl } from './rotate-control';
import type { TargetDef } from './targets';

const containerEl = document.querySelector<HTMLDivElement>('#ar-container')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const shutterEl = document.querySelector<HTMLButtonElement>('#shutter')!;
const flashEl = document.querySelector<HTMLDivElement>('#flash')!;

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

/**
 * モデルの大きさはファイルによってバラバラなので、
 * マーカーの幅を 1.0 とする座標系に収まるよう正規化し、
 * 「原点＝モデルの中心」になる親グループに入れて返す。
 *
 * 親を1枚かぶせるのは回転のため。Three.js の変換は T・R・S の順に合成され、
 * position は回転の影響を受けない。そのため中心合わせを model.position だけで
 * やると、回した瞬間にモデルが原点のまわりを半径 |中心のズレ| で公転してしまう。
 * glb の原点が隅に置かれているモデルほど派手に振り回される。
 * 回転は中心に原点を合わせた親に対してかけること。
 */
function fitToMarker(object: THREE.Object3D, targetSize = 1): THREE.Group {
  const pivot = new THREE.Group();

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 0) {
    const scale = targetSize / maxDimension;
    object.scale.setScalar(scale);
    // 中心が pivot の原点に重なるようにずらす（足元基準のモデルもあるため）
    object.position.sub(center.multiplyScalar(scale));
  }

  pivot.add(object);
  return pivot;
}

/** 撮影した瞬間に画面を一度光らせる */
function flash(): void {
  flashEl.classList.remove('is-on');
  void flashEl.offsetWidth; // 連続撮影でもアニメーションを確実に再生させる
  flashEl.classList.add('is-on');
}

/** `shimane-ar-2026-10-09T12-34-56.jpg` のような、重複しないファイル名を作る */
function makeFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `shimane-ar-${stamp}.jpg`;
}

/**
 * data URL を Blob に変換する。
 * canvas.toBlob() は非同期で、その間に「ユーザー操作中」という状態が切れてしまい、
 * iOS で共有シートが開けなくなる。同期で完結させるためにこの経路を取る。
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** <a download> でそのまま端末に落とす */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // すぐ解放するとダウンロードが始まらない端末があるので、少し待ってから捨てる
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 画像を端末に保存する。
 * iOS Safari は download 属性が効かないことが多く、共有シート経由が本命。
 * 使えない環境では従来どおりダウンロードに落とす。
 */
function saveImage(blob: Blob): void {
  const fileName = makeFileName();
  const file = new File([blob], fileName, { type: 'image/jpeg' });

  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch((error: unknown) => {
      // 共有シートを閉じただけなら、失敗ではないので何も言わない
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('[AR] 共有に失敗したためダウンロードに切り替えます', error);
      downloadBlob(blob, fileName);
    });
    return;
  }

  downloadBlob(blob, fileName);
}

/** 例外の内容から、利用者が読んで分かる文言を作る */
function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'カメラの使用が許可されませんでした。ブラウザの設定から許可してください。';
    }
    if (error.name === 'NotFoundError') {
      return 'カメラが見つかりませんでした。';
    }
    if (error.name === 'NotReadableError') {
      return '他のアプリがカメラを使用中です。そのアプリを閉じてから再読み込みしてください。';
    }
  }
  return `起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}

async function main(): Promise<void> {
  // HTTP接続だと mediaDevices 自体が存在しない。型では防げないので実行時に確認する。
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('カメラを利用できません。https で開いているか確認してください。', true);
    return;
  }

  setStatus('読み込み中…');

  // どのポスターが何番なのかは .mind からは分からない。
  // 取り違えに気づけるよう、対応表をコンソールに出しておく。
  console.info(
    '[AR] ターゲット一覧 ' + TARGETS.map((t) => `${t.index}=${t.name}`).join(' / '),
  );

  const mindarThree = new MindARThree({
    container: containerEl,
    imageTargetSrc: MARKER_URL,
    // 組み込みUIは使わず、上の #status で自前に表示する
    uiLoading: 'no',
    uiScanning: 'no',
    uiError: 'no',
  });

  const { renderer, scene, camera } = mindarThree;

  // glTF は光が無いと真っ黒になる。環境光と平行光を1つずつ置く。
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(1, 2, 3);
  scene.add(keyLight);

  const loader = new GLTFLoader();
  /** 経過時間の計測。アニメーションの進行に使う */
  const clock = new THREE.Clock();
  /**
   * 描画ループで回すモデル。spin を付けたものだけ入る。
   * 立ち上げたモデルはZ軸、窓の中のモデルは立ったままなのでY軸まわりに回す。
   */
  const spinningModels: { index: number; object: THREE.Object3D; axis: 'y' | 'z' }[] = [];
  /** 画面をなぞってモデルを回す操作。対象は「いま映っているマーカー」のモデル */
  const rotator = new RotateControl(containerEl);
  /** 「なぞると回せる」の案内を出したか。しつこくならないよう1回だけ出す */
  let rotateHintShown = false;
  /** 窓（ポータル）。凹む演出の進み具合を管理する */
  const portals = new Map<number, { portal: Portal; openedAt: number | null; lostAt: number }>();
  /** 凹む演出にかける秒数 */
  const PORTAL_OPEN_SECONDS = 0.9;
  /** これより長く見失ってから再びかざしたら、もう一度凹む演出をする */
  const PORTAL_REOPEN_AFTER = 1.5;
  /** glb に埋め込まれたアニメーションの再生装置。モデル1体につき1つ */
  const mixers: THREE.AnimationMixer[] = [];
  /** 読み込み済み・読み込み中の index。onTargetFound は連続で呼ばれるので二重起動を防ぐ */
  const requested = new Set<number>();
  /** いま認識中のマーカー数。0 になったときだけ案内を出す */
  let visibleCount = 0;

  /**
   * glb を読んでアンカーにぶら下げる。同じターゲットでは1回しか実行されない。
   * announce は、読み込み中であることを画面に出すかどうか
   * （起動時のまとめ読みでは「読み込み中…」が既に出ているので不要）。
   */
  /**
   * glb にアニメーションが入っていれば再生する。
   * ボーン（リグ）の有無に関わらず、GLTFLoader が gltf.animations に詰めてくれる。
   */
  function playAnimations(label: string, gltf: GLTF): void {
    if (gltf.animations.length === 0) return;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play(); // 既定でループ再生
    }
    mixers.push(mixer);
    console.info(
      `[AR] ${label} のアニメーションを再生 ` +
        gltf.animations.map((c) => c.name || '(無名)').join(', '),
    );
  }

  async function loadModel(def: TargetDef, anchor: any, announce: boolean): Promise<void> {
    if (requested.has(def.index)) return;
    requested.add(def.index);

    if (announce) setStatus(`${def.name} を読み込み中…`);

    try {
      // 窓の表示では部屋の glb も要る。モデルと並行して読む
      const [gltf, roomGltf] = await Promise.all([
        def.modelUrl ? loader.loadAsync(def.modelUrl) : Promise.resolve(null),
        def.portal ? loader.loadAsync(def.portal.roomUrl) : Promise.resolve(null),
      ]);
      const pivot = gltf ? fitToMarker(gltf.scene, def.scale ?? 1) : null;

      if (def.portal && roomGltf) {
        const portal = createPortal(roomGltf.scene, def.portal.windowWidth);
        // 部屋は +Y が上なので、glb（Y軸が上）は回さずにそのまま立てて置ける。
        // モデルを指定しない（部屋だけで完結している）場合は何も置かない
        if (pivot) {
          if (placeOnSpot(portal, pivot)) {
            if (def.spin) spinningModels.push({ index: def.index, object: pivot, axis: 'y' });
            // 窓の中のモデルは、倒すと床にめり込むので横回転だけ
            if (def.rotatable !== false) rotator.register(def.index, pivot, 'yaw-only');
          } else {
            console.warn(`[AR] ${def.name} の部屋に ModelSpot が無いため、モデルは置きません`);
          }
        }
        anchor.group.add(portal.root);
        // 認識前に読み終わった場合も、見つけた瞬間から凹み始めるよう閉じておく
        portal.setOpen(0);
        portals.set(def.index, { portal, openedAt: null, lostAt: -Infinity });
        // 部屋の中の動き（揺れる小物など）は部屋の glb に入れてもらい、ここで再生する
        playAnimations(`${def.name} の部屋`, roomGltf);
      } else if (pivot) {
        // アンカーの座標系はマーカー面が XY 平面。X軸に90度回すとモデルがカードから立ち上がる。
        pivot.rotation.x = Math.PI / 2;
        anchor.group.add(pivot);
        if (def.spin) spinningModels.push({ index: def.index, object: pivot, axis: 'z' });
        if (def.rotatable !== false) rotator.register(def.index, pivot, 'free');
      } else {
        console.warn(`[AR] ${def.name} は modelUrl も portal も無いため、何も表示しません`);
      }

      if (gltf && def.animate !== false) playAnimations(def.name, gltf);

      if (announce) setStatus('');
    } catch (error) {
      // 次にかざした時に読み直せるよう、印を消しておく
      requested.delete(def.index);
      console.error(`[AR] ${def.name} の読み込みに失敗`, error);
      setStatus(`${def.name} を読み込めませんでした。通信状態を確認してください。`, true);
    }
  }

  /**
   * 初めてモデルが出たときに、なぞれば回せることを一度だけ知らせる。
   * 説明なしで使えることが目標なので、操作の存在だけは画面で伝える。
   */
  function showRotateHint(def: TargetDef): void {
    if (rotateHintShown || def.rotatable === false || !def.modelUrl) return;
    if (statusEl.textContent) return; // 読み込み失敗などの表示を上書きしない
    rotateHintShown = true;
    const hint = '画面をなぞると回せます';
    setStatus(hint);
    window.setTimeout(() => {
      if (statusEl.textContent === hint) setStatus('');
    }, 3500);
  }

  for (const def of TARGETS) {
    const anchor = mindarThree.addAnchor(def.index);

    anchor.onTargetFound = () => {
      visibleCount += 1;
      const entry = portals.get(def.index);
      const now = clock.elapsedTime;
      if (entry && (entry.openedAt === null || now - entry.lostAt > PORTAL_REOPEN_AFTER)) {
        entry.openedAt = now;
      }
      setStatus('');
      rotator.setActive(def.index);
      void loadModel(def, anchor, true).then(() => showRotateHint(def));
    };
    anchor.onTargetLost = () => {
      visibleCount = Math.max(0, visibleCount - 1);
      const entry = portals.get(def.index);
      if (entry) entry.lostAt = clock.elapsedTime;
      if (visibleCount === 0) rotator.setActive(null);
      if (visibleCount === 0) setStatus('マーカーを探しています…');
    };

    if (def.preload) await loadModel(def, anchor, false);
  }

  /**
   * カメラ映像と3Dを1枚の canvas に重ねる。
   *
   * 画面は <video>（カメラ）の上に透明な <canvas>（3D）を載せた2層構造で、
   * 合成しているのはブラウザの表示処理でしかない。データとしては別物なので、
   * renderer の canvas をそのまま書き出すと背景が抜けた画像になる。
   */
  function composite(): HTMLCanvasElement {
    const video = mindarThree.video;
    const source = renderer.domElement;

    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d')!;

    // renderer は devicePixelRatio 分だけ内部解像度が大きい。CSSピクセルとの倍率を出す
    const ratio = source.width / containerEl.clientWidth;

    // カメラ映像は画面からはみ出す形で置かれている（MindAR の resize() が決めた値）。
    // 自分で計算し直すとズレるので、実際に使われている数値をそのまま読む。
    const left = Number.parseFloat(video.style.left) || 0;
    const top = Number.parseFloat(video.style.top) || 0;
    const width = Number.parseFloat(video.style.width) || containerEl.clientWidth;
    const height = Number.parseFloat(video.style.height) || containerEl.clientHeight;

    ctx.drawImage(video, left * ratio, top * ratio, width * ratio, height * ratio);
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  function onShutter(): void {
    shutterEl.disabled = true;
    try {
      // WebGL は画面に出した後で描画バッファを捨てる。MindAR 側が
      // preserveDrawingBuffer を付けていないので、同じ処理の中で描き直して
      // すぐ読み出す（この時点ではまだ中身が残っている）。
      renderer.render(scene, camera);
      // PNG より速く、透過が無いぶん背景が黒くなる事故も起きない
      const dataUrl = composite().toDataURL('image/jpeg', 0.92);
      flash();
      saveImage(dataUrlToBlob(dataUrl));
    } catch (error) {
      console.error('[AR] 撮影に失敗', error);
      setStatus('写真を保存できませんでした。', true);
    } finally {
      shutterEl.disabled = false;
    }
  }

  shutterEl.addEventListener('click', onShutter);

  await mindarThree.start();
  setStatus('マーカーを探しています…');
  // カメラが動き出してから出す（それまで押しても撮るものが無い）
  shutterEl.hidden = false;

  renderer.setAnimationLoop(() => {
    // 前フレームからの経過秒。端末ごとのフレームレート差を吸収する
    const delta = clock.getDelta();
    for (const mixer of mixers) {
      mixer.update(delta);
    }
    rotator.update(delta, clock.elapsedTime);
    for (const { index, object, axis } of spinningModels) {
      // 触っている間と離した直後は、自動回転を止めて狙った角度を保つ
      if (rotator.isHeld(index)) continue;
      object.rotation[axis] += 0.01;
    }
    for (const entry of portals.values()) {
      if (entry.openedAt === null) continue;
      entry.portal.setOpen((clock.elapsedTime - entry.openedAt) / PORTAL_OPEN_SECONDS);
    }
    renderer.render(scene, camera);
  });

  // タブを離れたらカメラを解放する（スマホの発熱とバッテリー対策）
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    mindarThree.stop();
    shutterEl.hidden = true;
  });
}

main().catch((error: unknown) => {
  console.error(error);
  setStatus(describeError(error), true);
});
