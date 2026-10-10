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
 *   横になぞる   … モデルの縦軸まわりに回る（くるくる）
 *   縦になぞる   … 手前・奥に倒れる（上から覗く／下から覗く）
 *   指を離す     … 少し惰性で回ってから止まる
 *   ダブルタップ … 最初の向きに戻す
 *
 * 指がモデルに当たっている必要はなく、画面のどこをなぞってもよい。
 * MindAR は既定で同時に1枚しか追跡しないので、対象は「いま映っているモデル」に決まる。
 * 細い破片に指を当てるのは難しいので、当たり判定はあえてしていない。
 *
 * ── 回し方の仕組み ──────────────────────────────────────
 *
 *   モデルを「操作用の入れ物」に入れ、入れ物の方を回す。
 *   モデル自身の回転（立ち上げ・自動回転）とは別の層なので、互いに打ち消し合わない。
 *   縦軸まわり（yaw）を先に、倒す向き（pitch）を後にかけるので、
 *   倒した状態で横になぞっても、モデルは自分の縦軸まわりに回る。
 */

/** 1ピクセルなぞると何ラジアン回るか。画面幅をなぞると約1回転半 */
const RADIANS_PER_PIXEL = 0.012;
/** 倒せる角度の上限（真上・真下から覗く手前まで） */
const MAX_PITCH = Math.PI * 0.45;
/** 惰性の減り方。1秒あたりの残り割合（小さいほど早く止まる） */
const INERTIA_KEEP_PER_SECOND = 0.04;
/** これより動かなければ「タップ」とみなす（px） */
const TAP_SLOP = 10;
/** 2回のタップをダブルタップとみなす間隔（ms） */
const DOUBLE_TAP_MS = 320;
/** 指を離してから、自動回転を再開するまでの秒数 */
const RESUME_SPIN_AFTER = 3;

type Entry = {
  /** 回す入れ物 */
  handle: THREE.Object3D;
  /** モデルの縦軸（handle の親の座標で） */
  upAxis: THREE.Vector3;
  /** 倒す軸（handle の親の座標で）。null なら倒さない */
  tiltAxis: THREE.Vector3 | null;
  yaw: number;
  pitch: number;
  /** 惰性の速さ（rad/秒） */
  yawVelocity: number;
  pitchVelocity: number;
  /** 最後に触られた時刻（秒）。自動回転の一時停止に使う */
  touchedAt: number;
};

export type RotateMode =
  /** 立ち上げたモデル。縦軸まわりにも、手前・奥にも回せる */
  | 'free'
  /** 窓の中のモデル。倒すと床にめり込むので、縦軸まわりだけ */
  | 'yaw-only';

export class RotateControl {
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

  private readonly surface: HTMLElement;

  constructor(surface: HTMLElement) {
    this.surface = surface;
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

    // 立ち上げたモデルはアンカーの Z が上（マーカー面から立ち上がる向き）、
    // 窓の中のモデルは部屋の Y が上。倒す軸はどちらもポスターの横方向（X）
    const upAxis = mode === 'free' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const tiltAxis = mode === 'free' ? new THREE.Vector3(1, 0, 0) : null;

    this.entries.set(index, {
      handle,
      upAxis,
      tiltAxis,
      yaw: 0,
      pitch: 0,
      yawVelocity: 0,
      pitchVelocity: 0,
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
      if (!dragging && (entry.yawVelocity !== 0 || entry.pitchVelocity !== 0)) {
        this.rotate(entry, entry.yawVelocity * delta, entry.pitchVelocity * delta);
        entry.yawVelocity *= keep;
        entry.pitchVelocity *= keep;
        if (Math.abs(entry.yawVelocity) < 0.01) entry.yawVelocity = 0;
        if (Math.abs(entry.pitchVelocity) < 0.01) entry.pitchVelocity = 0;
      }
    }
  }

  private get active(): Entry | null {
    return this.activeIndex === null ? null : (this.entries.get(this.activeIndex) ?? null);
  }

  private rotate(entry: Entry, dYaw: number, dPitch: number): void {
    entry.yaw += dYaw;
    if (entry.tiltAxis) {
      entry.pitch = THREE.MathUtils.clamp(entry.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
    }
    const yawQ = new THREE.Quaternion().setFromAxisAngle(entry.upAxis, entry.yaw);
    const pitchQ = entry.tiltAxis
      ? new THREE.Quaternion().setFromAxisAngle(entry.tiltAxis, entry.pitch)
      : new THREE.Quaternion();
    // pitch * yaw … 先に縦軸で回し、その後で倒す
    entry.handle.quaternion.copy(pitchQ.multiply(yawQ));
  }

  private reset(entry: Entry): void {
    entry.yaw = 0;
    entry.pitch = 0;
    entry.yawVelocity = 0;
    entry.pitchVelocity = 0;
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
    entry.yawVelocity = 0;
    entry.pitchVelocity = 0;
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

    // 右になぞると、手前側が右へ流れるように回る。下になぞると、上側が手前に倒れてくる
    const dYaw = dx * RADIANS_PER_PIXEL;
    const dPitch = dy * RADIANS_PER_PIXEL;
    this.rotate(entry, dYaw, dPitch);

    // 指を離したときの惰性のために、直近の速さを覚えておく
    const t = performance.now();
    const dt = Math.max((t - this.lastMoveTime) / 1000, 1 / 120);
    this.lastMoveTime = t;
    entry.yawVelocity = dYaw / dt;
    entry.pitchVelocity = dPitch / dt;
    entry.touchedAt = this.now;
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const entry = this.active;
    if (!entry) return;
    entry.touchedAt = this.now;

    // 離す直前に指が止まっていたら、惰性はつけない（狙った角度で止めたいとき）
    if (performance.now() - this.lastMoveTime > 80) {
      entry.yawVelocity = 0;
      entry.pitchVelocity = 0;
    }

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
