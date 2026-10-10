import * as THREE from 'three';

/**
 * 画面をなぞって、いま映っているモデルを回す。
 *
 * ねらいは2つ。
 *   - 来場者に「自分で動かせる」手応えを渡す
 *   - 「隠れた〇〇」系で、スマホを大きく動かさなくても見える角度を探せるようにする
 *     （手元で回せば、ポスターの周りを歩き回らなくて済む）
 *
 * ── 操作 ──────────────────────────────────────────────
 *
 *   なぞる       … なぞった方向へ、ボールを転がすように回る（どの向きにも制限なし）
 *   指を離す     … 少し惰性で回ってから止まる
 *   ダブルタップ … 最初の向きに戻す
 *
 * 指がモデルに当たっている必要はなく、画面のどこをなぞってもよい。
 * MindAR は既定で同時に1枚しか追跡しないので、対象は「いま映っているモデル」に決まる。
 * 細い破片に指を当てるのは難しいので、当たり判定はあえてしていない。
 *
 * ── 回し方の仕組み（トラックボール方式）─────────────────────
 *
 *   モデルを「操作用の入れ物」に入れ、入れ物の方を回す。
 *   モデル自身の回転（立ち上げ・自動回転）とは別の層なので、互いに打ち消し合わない。
 *
 *   回す軸は「スマホの画面」を基準に決める。
 *     右になぞる → 画面の縦軸まわりに回す（手前の面が右へ流れる）
 *     下になぞる → 画面の横軸まわりに回す（手前の面が下へ流れる）
 *   この軸をカメラの向きから入れ物の座標に直し、いまの向きに「後から」掛け足す。
 *   毎回いまの画面を基準にするので、逆さまになっても操作が逆転せず、
 *   ポスターが机に置いてあっても壁に貼ってあっても同じ感覚で回せる。
 */

/** 1ピクセルなぞると何ラジアン回るか。画面幅をなぞると約1回転半 */
const RADIANS_PER_PIXEL = 0.012;
/** 惰性の減り方。1秒あたりの残り割合（小さいほど早く止まる） */
const INERTIA_KEEP_PER_SECOND = 0.04;
/** 惰性がこれより遅くなったら止める（rad/秒） */
const INERTIA_STOP = 0.02;
/** これより動かなければ「タップ」とみなす（px） */
const TAP_SLOP = 10;
/** 2回のタップをダブルタップとみなす間隔（ms） */
const DOUBLE_TAP_MS = 320;
/** 指を離してから、自動回転を再開するまでの秒数 */
const RESUME_SPIN_AFTER = 3;

export type RotateMode =
  /** 立ち上げたモデル。どの向きにも自由に回せる */
  | 'free'
  /** 窓の中のモデル。倒すと床にめり込むので、縦軸まわり（横になぞる）だけ */
  | 'yaw-only';

type Entry = {
  /** 回す入れ物 */
  handle: THREE.Object3D;
  mode: RotateMode;
  /** yaw-only のときの縦軸（入れ物の親の座標で） */
  upAxis: THREE.Vector3;
  /**
   * 惰性の回転速度。向きが回転軸、長さが速さ（rad/秒）。入れ物の親の座標で持つ。
   * 親（＝マーカー）の座標で持つので、スマホを動かしてもポスターに対して同じ向きに回り続ける。
   */
  velocity: THREE.Vector3;
  /** 最後に触られた時刻（秒）。自動回転の一時停止に使う */
  touchedAt: number;
};

// 毎回 new しないための作業用
const tmpAxis = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpParentQuat = new THREE.Quaternion();

export class RotateControl {
  private readonly surface: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly entries = new Map<number, Entry>();
  private activeIndex: number | null = null;
  private now = 0;

  /** なぞっている指。2本目以降の指は無視する */
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private lastMoveTime = 0;
  private lastTapTime = -Infinity;

  constructor(surface: HTMLElement, camera: THREE.Camera) {
    this.surface = surface;
    this.camera = camera;
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
  }

  /**
   * モデルを操作の対象に加える。
   * model をその場で入れ物に包み直し、入れ物を返す（呼び出し側は以後こちらを置き場所として扱う）。
   */
  register(index: number, model: THREE.Object3D, mode: RotateMode): THREE.Object3D {
    const parent = model.parent;
    const handle = new THREE.Group();
    // 入れ物をモデルの中心に置き、モデルは入れ物の原点へ。こうすると中心まわりに回る
    handle.position.copy(model.position);
    model.position.set(0, 0, 0);
    parent?.add(handle);
    handle.add(model);

    this.entries.set(index, {
      handle,
      mode,
      // 窓の中のモデルは部屋の Y が上
      upAxis: new THREE.Vector3(0, 1, 0),
      velocity: new THREE.Vector3(),
      touchedAt: -Infinity,
    });
    return handle;
  }

  /** いま映っているマーカー。見失ったら null */
  setActive(index: number | null): void {
    this.activeIndex = index;
    if (index === null) this.pointerId = null;
  }

  /** 触られている最中か、離してから間もないか。自動回転を止める判断に使う */
  isHeld(index: number): boolean {
    const entry = this.entries.get(index);
    return !!entry && this.now - entry.touchedAt < RESUME_SPIN_AFTER;
  }

  /** 描画ループから毎フレーム呼ぶ。惰性で回す */
  update(delta: number, now: number): void {
    this.now = now;
    const keep = Math.pow(INERTIA_KEEP_PER_SECOND, delta);
    for (const [index, entry] of this.entries) {
      const dragging = this.pointerId !== null && index === this.activeIndex;
      const speed = entry.velocity.length();
      if (dragging || speed === 0) continue;
      this.rotateInParent(entry, tmpAxis.copy(entry.velocity).divideScalar(speed), speed * delta);
      entry.velocity.multiplyScalar(keep);
      if (entry.velocity.length() < INERTIA_STOP) entry.velocity.set(0, 0, 0);
    }
  }

  private get active(): Entry | null {
    return this.activeIndex === null ? null : (this.entries.get(this.activeIndex) ?? null);
  }

  /** 入れ物の親の座標で表した軸まわりに、いまの向きへ後から回転を掛け足す */
  private rotateInParent(entry: Entry, axis: THREE.Vector3, angle: number): void {
    tmpQuat.setFromAxisAngle(axis, angle);
    entry.handle.quaternion.premultiply(tmpQuat).normalize();
  }

  /**
   * なぞった量（px）から、回転軸（入れ物の親の座標）と角度を求める。
   * 戻り値の軸は使い回しのベクトルなので、必要なら呼び出し側で複製すること。
   */
  private dragToRotation(entry: Entry, dx: number, dy: number): { axis: THREE.Vector3; angle: number } | null {
    if (entry.mode === 'yaw-only') {
      if (dx === 0) return null;
      // 右になぞると手前の面が右へ流れる向き（上から見て反時計回り）
      return { axis: tmpAxis.copy(entry.upAxis), angle: dx * RADIANS_PER_PIXEL };
    }

    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    // カメラ座標（右が +X、上が +Y、手前が +Z）での回転軸。
    // 右になぞる → +Y 軸まわり、下になぞる → +X 軸まわり（どちらも手前の面がなぞった方へ流れる）。
    // 画面の Y は下向きが正なので、dy はそのまま X 成分に入れてよい
    tmpAxis.set(dy, dx, 0).divideScalar(length);
    // カメラ座標 → ワールド座標 → 入れ物の親の座標
    tmpAxis.applyQuaternion(this.camera.getWorldQuaternion(tmpQuat));
    const parent = entry.handle.parent;
    if (parent) tmpAxis.applyQuaternion(parent.getWorldQuaternion(tmpParentQuat).invert());
    tmpAxis.normalize();
    return { axis: tmpAxis, angle: length * RADIANS_PER_PIXEL };
  }

  private reset(entry: Entry): void {
    entry.velocity.set(0, 0, 0);
    entry.handle.quaternion.identity();
  }

  private onDown = (event: PointerEvent): void => {
    if (this.pointerId !== null || !this.active) return;
    this.pointerId = event.pointerId;
    this.surface.setPointerCapture(event.pointerId);
    this.lastX = this.downX = event.clientX;
    this.lastY = this.downY = event.clientY;
    this.lastMoveTime = performance.now();
    const entry = this.active;
    entry.velocity.set(0, 0, 0);
    entry.touchedAt = this.now;
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const entry = this.active;
    if (!entry) return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    entry.touchedAt = this.now;

    const rotation = this.dragToRotation(entry, dx, dy);
    if (!rotation) return;
    this.rotateInParent(entry, rotation.axis, rotation.angle);

    // 指を離したときの惰性のために、直近の回転速度を覚えておく
    const t = performance.now();
    const dt = Math.max((t - this.lastMoveTime) / 1000, 1 / 120);
    this.lastMoveTime = t;
    entry.velocity.copy(rotation.axis).multiplyScalar(rotation.angle / dt);
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const entry = this.active;
    if (!entry) return;
    entry.touchedAt = this.now;

    // 離す直前に指が止まっていたら、惰性はつけない（狙った角度で止めたいとき）
    if (performance.now() - this.lastMoveTime > 80) entry.velocity.set(0, 0, 0);

    const moved = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    if (moved < TAP_SLOP) {
      const t = performance.now();
      if (t - this.lastTapTime < DOUBLE_TAP_MS) {
        this.reset(entry);
        this.lastTapTime = -Infinity;
      } else {
        this.lastTapTime = t;
      }
    }
  };
}
