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
 *      （src/assets/markers/ をファイル名順に選ぶと、ちょうどこの順になる）
 *        index 0 -> AIilblogoteisei.png
 *        index 1 -> fish_school.png
 *        index 2 -> gyroid-borrome-museum.png
 *        index 3 -> hidden-cat-fragments.png
 *        index 4 -> hidden-owl-clean.png
 *        index 5 -> line-rabbit-fragments.png
 *        index 6 -> mugen_gimbal.png
 *        index 7 -> poison-soup-room.png
 *        index 8 -> Present01.png
 *        index 9 -> spinning_sphere_2color.png
 *   3. 出力を src/assets/markers/targets.mind に置く
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
import markerUrl from './assets/markers/targets.mind?url';
import ailabLogoUrl from './assets/glb/AIlablogoteisei.glb?url';
import fishSchoolUrl from './assets/glb/fish_school.glb?url';
import gyroidMuseumUrl from './assets/glb/gyroid-borromean-museum.glb?url';
import hiddenCatUrl from './assets/glb/hidden-cat-fragments.glb?url';
import hiddenOwlUrl from './assets/glb/hidden-owl-clean.glb?url';
import lineRabbitUrl from './assets/glb/line-rabbit-fragments.glb?url';
import mugenGimbalUrl from './assets/glb/mugen_gimbal.glb?url';
import poisonSoupRoomUrl from './assets/glb/poison-soup-room.glb?url';
import present01Url from './assets/glb/Present01.glb?url';
import spinningSphereUrl from './assets/glb/spinning_sphere_2color.glb?url';

/** 全マーカー分をまとめた .mind。複数対応したらファイル名ごと差し替える。 */
export const MARKER_URL = markerUrl;

export type TargetDef = {
  /** .mind 内での順番。コンパイラへのアップロード順と一致させること */
  index: number;
  /** 取り違えに気づくための名前。画面表示とログに使う */
  name: string;
  /**
   * 表示する glb。
   * 窓（portal）の表示では省略できる。部屋の glb だけで完結している場合に使う。
   */
  modelUrl?: string;
  /** マーカーの幅を 1.0 とした時の大きさ。省略時は 1 */
  scale?: number;
  /** その場でくるくる回すか */
  spin?: boolean;
  /**
   * 画面をなぞってモデルを回せるようにするか。既定は回せる。
   * 触られている間と離してから3秒間は、spin の自動回転を止める。
   * 角度そのものに意味があって、回されると困る作品だけ false にする。
   */
  rotatable?: boolean;
  /**
   * glb に埋め込まれたアニメーションを再生するか。既定は再生する。
   * アニメーションが入っていないモデルでは何も起きないので、普段は指定不要。
   * 動きが激しすぎる等で止めたいときだけ false にする。
   */
  animate?: boolean;
  /**
   * 起動時にまとめて読み込むか。
   * false（既定）だと、そのマーカーを初めて認識した時に読む。
   * 初回表示は速くなるが、認識してからモデルが出るまで一拍遅れる。
   * モデルが増えてきたら、目玉のもの以外を false にして起動を軽くする。
   */
  preload?: boolean;
  /**
   * 指定すると、モデルを立ち上げる代わりに「ポスターが凹んで窓になり、
   * 奥の部屋を覗ける」表示にする。モデルは部屋の glb の ModelSpot に置かれる。
   */
  portal?: PortalDef;
};

export type PortalDef = {
  /**
   * 部屋の glb。決まりごとは scripts/build-sample-room.mjs の冒頭を参照
   * （Window と ModelSpot という名前のオブジェクトを入れておく）。
   */
  roomUrl: string;
  /**
   * ポスター上での窓の幅（マーカーの幅を 1.0 とした値）。
   * 高さは部屋の glb の Window の縦横比で決まるので、ポスターからはみ出さないこと。
   * 縁を残すほど、近づいても認識が切れにくい。
   */
  windowWidth: number;
};

export const TARGETS: TargetDef[] = [
  { index: 0, name: 'AIラボのロゴ', modelUrl: ailabLogoUrl, spin: true, preload: true },
  // 「Swim」アニメーションが入っているので、手動回転は切って泳ぎだけ見せる
  { index: 1, name: '魚の群れ', modelUrl: fishSchoolUrl, preload: true },
  { index: 2, name: 'ジャイロイドの美術館', modelUrl: gyroidMuseumUrl },
  // 「隠れた〇〇」系は、見る角度を探して形を見つける作品。回すと台無しなので spin は付けない
  { index: 3, name: '隠れた猫', modelUrl: hiddenCatUrl },
  { index: 4, name: '隠れたフクロウ', modelUrl: hiddenOwlUrl },
  { index: 5, name: '線のウサギ', modelUrl: lineRabbitUrl },
  // 「loop」アニメーションが入っている
  { index: 6, name: '無限ジンバル', modelUrl: mugenGimbalUrl },
  // 窓の表示。部屋の glb の Window は 0.7 x 0.9。
  // poison-soup-room.png は 1654x2339（高さ÷幅 = 1.41）なので、幅 0.7 なら上下左右に縁が残る
  {
    index: 7,
    name: '毒スープの部屋',
    portal: { roomUrl: poisonSoupRoomUrl, windowWidth: 0.7 },
  },
  { index: 8, name: 'プレゼント', modelUrl: present01Url, spin: true, preload: true },
  // 「Spin」アニメーションが入っているので、手動回転は付けない
  { index: 9, name: '回る2色の球', modelUrl: spinningSphereUrl },
];
