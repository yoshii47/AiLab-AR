/**
 * マーカーとモデルの対応表。
 *
 * 展示内容の差し替えは、原則このファイルの編集だけで済むようにしてある。
 * AR や 3D の処理は main.ts 側にあるので、そちらは触らなくてよい。
 *
 * ── マーカー（.mind）を作り直す手順 ────────────────────────────
 *
 *   1. https://hiukim.github.io/mind-ar-js-doc/tools/compile を開く
 *   2. 下の TARGETS に並んでいる順番どおりに、ポスター画像をアップロードする
 *   3. 出力を src/assets/markers/ に置き、下の markerUrl の import を合わせる
 *
 *   .mind は「1ファイルに全マーカー」という形式で、MindAR は .mind を1本しか
 *   読み込めない。ポスターを1枚足すときも、既存のぶんを含めて必ず全部まとめて
 *   コンパイルし直すこと。1枚ずつ作ったファイルを後から結合する手段は無い。
 *
 *   ⚠ index はアップロードした順番だけで決まる。ファイル名は .mind に残らないので、
 *     順番を取り違えてもエラーは一切出ず、「Aのポスターに Bのモデルが出る」という
 *     動いてはいるが間違っている状態になる。並び替えたら index も直すこと。
 */

// ?url で読むと、ファイルが存在しない場合にビルドが失敗する。
// パスのタイポを実機まで持ち込まないための保険。
import markerUrl from './assets/markers/card.mind?url';
import present01Url from './assets/glb/Present01.glb?url';

/** 全マーカー分をまとめた .mind。複数対応したらファイル名ごと差し替える。 */
export const MARKER_URL = markerUrl;

export type TargetDef = {
  /** .mind 内での順番。コンパイラへのアップロード順と一致させること */
  index: number;
  /** 取り違えに気づくための名前。画面表示とログに使う */
  name: string;
  /** 表示する glb */
  modelUrl: string;
  /** マーカーの幅を 1.0 とした時の大きさ。省略時は 1 */
  scale?: number;
  /** その場でくるくる回すか */
  spin?: boolean;
  /**
   * 起動時にまとめて読み込むか。
   * false（既定）だと、そのマーカーを初めて認識した時に読む。
   * 初回表示は速くなるが、認識してからモデルが出るまで一拍遅れる。
   * モデルが増えてきたら、目玉のもの以外を false にして起動を軽くする。
   */
  preload?: boolean;
};

export const TARGETS: TargetDef[] = [
  { index: 0, name: 'プレゼント', modelUrl: present01Url, spin: true, preload: true },
];
