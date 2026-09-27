import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';

import { MARKER_URL, TARGETS } from './targets';
import type { TargetDef } from './targets';

const containerEl = document.querySelector<HTMLDivElement>('#ar-container')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

/**
 * モデルの大きさはファイルによってバラバラなので、
 * マーカーの幅を 1.0 とする座標系に収まるよう正規化する。
 * これをしないと、巨大すぎて画面を埋めるか、小さすぎて見えないかになる。
 */
function fitToMarker(object: THREE.Object3D, targetSize = 1): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension === 0) return;

  const scale = targetSize / maxDimension;
  object.scale.setScalar(scale);
  // 原点がモデルの中心に来るようにずらす（足元基準のモデルもあるため）
  object.position.sub(center.multiplyScalar(scale));
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
  /** 描画ループで回すモデル。spin を付けたものだけ入る */
  const spinningModels: THREE.Object3D[] = [];
  /** 読み込み済み・読み込み中の index。onTargetFound は連続で呼ばれるので二重起動を防ぐ */
  const requested = new Set<number>();
  /** いま認識中のマーカー数。0 になったときだけ案内を出す */
  let visibleCount = 0;

  /**
   * glb を読んでアンカーにぶら下げる。同じターゲットでは1回しか実行されない。
   * announce は、読み込み中であることを画面に出すかどうか
   * （起動時のまとめ読みでは「読み込み中…」が既に出ているので不要）。
   */
  async function loadModel(def: TargetDef, anchor: any, announce: boolean): Promise<void> {
    if (requested.has(def.index)) return;
    requested.add(def.index);

    if (announce) setStatus(`${def.name} を読み込み中…`);

    try {
      const gltf = await loader.loadAsync(def.modelUrl);
      const model = gltf.scene;
      fitToMarker(model, def.scale ?? 1);
      // アンカーの座標系はマーカー面が XY 平面。X軸に90度回すとモデルがカードから立ち上がる。
      model.rotation.x = Math.PI / 2;
      anchor.group.add(model);
      if (def.spin) spinningModels.push(model);

      if (announce) setStatus('');
    } catch (error) {
      // 次にかざした時に読み直せるよう、印を消しておく
      requested.delete(def.index);
      console.error(`[AR] ${def.name} の読み込みに失敗`, error);
      setStatus(`${def.name} を読み込めませんでした。通信状態を確認してください。`, true);
    }
  }

  for (const def of TARGETS) {
    const anchor = mindarThree.addAnchor(def.index);

    anchor.onTargetFound = () => {
      visibleCount += 1;
      setStatus('');
      void loadModel(def, anchor, true);
    };
    anchor.onTargetLost = () => {
      visibleCount = Math.max(0, visibleCount - 1);
      if (visibleCount === 0) setStatus('マーカーを探しています…');
    };

    if (def.preload) await loadModel(def, anchor, false);
  }

  await mindarThree.start();
  setStatus('マーカーを探しています…');

  renderer.setAnimationLoop(() => {
    for (const model of spinningModels) {
      model.rotation.z += 0.01; // 立ち上げた後の「その場で回転」はZ軸まわり
    }
    renderer.render(scene, camera);
  });

  // タブを離れたらカメラを解放する（スマホの発熱とバッテリー対策）
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    mindarThree.stop();
  });
}

main().catch((error: unknown) => {
  console.error(error);
  setStatus(describeError(error), true);
});
