/**
 * mind-ar は型定義を同梱していないため、こちらで宣言する。
 * 実際に使うAPIだけを定義している（網羅はしない方針）。
 * 追加で使いたいAPIが出たら、実装を確認した上でここに足すこと。
 */
declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

  /** addAnchor() が返す、マーカー1枚に紐づくオブジェクト */
  export interface MindARAnchor {
    /** ここに 3Dモデルを add する。マーカーに追従して動く */
    group: Group;
    targetIndex: number;
    /** マーカーを見つけた瞬間に呼ばれる */
    onTargetFound: (() => void) | null;
    /** マーカーを見失った瞬間に呼ばれる */
    onTargetLost: (() => void) | null;
  }

  export interface MindARThreeOptions {
    /** AR映像を描画する親要素 */
    container: HTMLElement;
    /** コンパイル済みマーカー(.mind)のパス */
    imageTargetSrc: string;
    /** 同時に追跡するマーカー数。既定は 1 */
    maxTrack?: number;
    /** 組み込みUIの表示。切るときは 'no' */
    uiLoading?: string;
    uiScanning?: string;
    uiError?: string;
    /** 追従の滑らかさ。小さいほど滑らかだが遅延する */
    filterMinCF?: number;
    filterBeta?: number;
    /** 何フレーム見失ったらロスト扱いにするか */
    missTolerance?: number;
    /** 何フレーム連続で見つけたら検出扱いにするか */
    warmupTolerance?: number;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);

    readonly renderer: WebGLRenderer;
    readonly scene: Scene;
    readonly camera: PerspectiveCamera;

    /** マーカー番号を指定してアンカーを作る（.mind内の順番、0始まり） */
    addAnchor(targetIndex: number): MindARAnchor;

    /** カメラを起動して認識を開始する */
    start(): Promise<void>;

    /** 認識を停止し、カメラを解放する */
    stop(): void;

    /** 前面/背面カメラを切り替える */
    switchCamera(): void;
  }
}
