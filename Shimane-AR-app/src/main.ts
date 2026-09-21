import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';

// ?url で読むと、ファイルが存在しない場合にビルドが失敗する。
// パスのタイポを実機まで持ち込まないための保険。
import markerUrl from './assets/markers/card.mind?url';
import modelUrl from './assets/glb/Present01.glb?url';

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

  const mindarThree = new MindARThree({
    container: containerEl,
    imageTargetSrc: markerUrl,
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

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  fitToMarker(model);
  // アンカーの座標系はマーカー面が XY 平面。X軸に90度回すとモデルがカードから立ち上がる。
  model.rotation.x = Math.PI / 2;

  const anchor = mindarThree.addAnchor(0);
  anchor.group.add(model);
  anchor.onTargetFound = () => setStatus('');
  anchor.onTargetLost = () => setStatus('マーカーを探しています…');

  await mindarThree.start();
  setStatus('マーカーを探しています…');

  renderer.setAnimationLoop(() => {
    model.rotation.z += 0.01; // 立ち上げた後の「その場で回転」はZ軸まわり
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
