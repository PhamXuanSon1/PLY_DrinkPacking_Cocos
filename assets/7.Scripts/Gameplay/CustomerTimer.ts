import { _decorator, Color, Component, instantiate, Node, Prefab, Tween, tween, Vec2 } from 'cc';
import { CustomerController } from './CustomerController';
import { ClockTimer } from './Effects/ClockTimer';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property } = _decorator;

/**
 * Đồng hồ đếm ngược bên cạnh khách (gắn trên node Customer, cạnh CustomerController).
 * Hình là prefab ClockTimer (Sprite Filled / Radial), script này tự đếm giờ và mỗi frame đặt
 * phần còn lại + màu (xanh → vàng → đỏ); còn ít thời gian (`warnRatio`) thì rung và mặt khách
 * đỏ dần (CustomerController.setAnger). Hết giờ gọi `onTimeout` do OrderManager truyền vào.
 */
@ccclass('CustomerTimer')
export class CustomerTimer extends Component {
    @property({ tooltip: 'Còn bao nhiêu phần thời gian (0–1) thì bắt đầu rung và khách đổi sang mặt giận' })
    warnRatio = 0.3;

    @property({ tooltip: 'Còn bấy nhiêu giây thì phát sound 2 giây cuối (Ply_SoundManager: Clock Last 2s)' })
    lastSeconds = 2;

    @property({ type: Prefab, tooltip: 'Prefab đồng hồ (5.Prefabs/ClockTimer), có component ClockTimer' })
    clockPrefab: Prefab | null = null;

    @property({ tooltip: 'Vị trí đồng hồ so với node Customer (px)' })
    offset = new Vec2(125, 260);

    @property({ tooltip: 'Scale của đồng hồ' })
    clockScale = 0.8;

    @property({ tooltip: 'Đổi màu vòng theo thời gian còn lại. Tắt = giữ màu đặt trong prefab' })
    tintFill = true;

    @property({ type: Color, tooltip: 'Màu vòng khi còn nhiều thời gian' })
    fullColor = new Color(90, 200, 90, 255);

    @property({ type: Color, tooltip: 'Màu vòng khi còn một nửa' })
    halfColor = new Color(250, 200, 50, 255);

    @property({ type: Color, tooltip: 'Màu vòng khi sắp hết' })
    lowColor = new Color(255, 71, 71, 255);

    private view: Node | null = null;
    private clock: ClockTimer | null = null;
    private duration = 0;
    private left = 0;
    private running = false;
    private paused = false;
    private shaking = false;
    private onTimeout: (() => void) | null = null;
    private customer: CustomerController | null = null;
    private readonly color = new Color();
    /** Đồng hồ này đang trong `lastSeconds` giây cuối (đã phát sound). */
    private ringing = false;
    /** Số đồng hồ đang trong giây cuối: sound dùng chung 1 nguồn, chỉ tắt khi không còn đồng hồ nào. */
    private static ringingCount = 0;

    onLoad(): void {
        this.customer = this.getComponent(CustomerController);
        if (!this.clockPrefab) {
            console.warn(`[CustomerTimer] "${this.node.name}" chưa gán Clock Prefab`);
            return;
        }
        const view = instantiate(this.clockPrefab);
        this.node.addChild(view);
        view.setPosition(this.offset.x, this.offset.y, 0);
        view.setScale(this.clockScale, this.clockScale, 1);
        view.active = false;
        this.view = view;
        this.clock = view.getComponent(ClockTimer);
    }

    /**
     * Bắt đầu đếm `duration` giây cho khách mới (OrderManager.customerTime quyết định thời gian).
     * `paused` = đứng yên tới khi `resume()`; `hidden` = ẩn đồng hồ tới khi `resume()` (chờ click đầu tiên).
     */
    begin(onTimeout: () => void, duration: number, paused = false, hidden = false): void {
        this.endRing(true);
        this.duration = Math.max(0.1, duration);
        this.left = this.duration;
        this.onTimeout = onTimeout;
        this.running = true;
        this.paused = paused;
        this.setShake(false);
        this.customer?.setAnger(0);
        if (this.view) this.view.active = !hidden;
        this.show(1);
    }

    /** Dừng đếm (khách đã nhận đủ cốc / màn kết thúc). `hide` = ẩn luôn đồng hồ. */
    stop(hide = true): void {
        // Dừng trước khi hết giờ (khách đã nhận đủ cốc / màn kết thúc): tắt sound giây cuối.
        this.endRing(true);
        this.running = false;
        this.onTimeout = null;
        this.setShake(false);
        if (hide && this.view) this.view.active = false;
    }

    get isRunning(): boolean {
        return this.running;
    }

    /** Tạm dừng: đồng hồ vẫn hiện, đứng yên (chờ click đầu tiên / game đã ra store). */
    pause(): void {
        this.paused = true;
        this.setShake(false);
        this.endRing(true);
    }

    /** Chạy tiếp (và hiện đồng hồ nếu đang ẩn) — chỉ khi khách vẫn đang chờ. */
    resume(): void {
        this.paused = false;
        if (this.running && this.view) this.view.active = true;
    }

    update(dt: number): void {
        if (!this.running || this.paused) return;
        this.left = Math.max(0, this.left - dt);
        const ratio = this.duration > 0 ? this.left / this.duration : 0;
        this.show(ratio);
        const warn = this.warnRatio > 0 && ratio <= this.warnRatio;
        this.setShake(warn);
        this.customer?.setAnger(warn ? 1 - ratio / this.warnRatio : 0);
        if (this.left > 0) {
            if (this.left <= this.lastSeconds) this.startRing();
            return;
        }
        // Hết giờ: để sound giây cuối phát nốt (nó cũng vừa hết), không cắt ngang.
        this.endRing(false);
        const cb = this.onTimeout;
        this.stop();
        cb?.();
    }

    onDisable(): void {
        this.endRing(true);
    }

    /** Vào `lastSeconds` giây cuối: phát sound một lần cho lượt đếm này. */
    private startRing(): void {
        if (this.ringing) return;
        this.ringing = true;
        CustomerTimer.ringingCount++;
        Ply_SoundManager.Ins?.playFx(FxType.ClockLast2s);
    }

    /** Ra khỏi giây cuối; `silence` = tắt sound nếu không còn đồng hồ nào khác đang ở giây cuối. */
    private endRing(silence: boolean): void {
        if (!this.ringing) return;
        this.ringing = false;
        CustomerTimer.ringingCount = Math.max(0, CustomerTimer.ringingCount - 1);
        if (silence && CustomerTimer.ringingCount === 0) Ply_SoundManager.Ins?.stopFx(FxType.ClockLast2s);
    }

    private show(ratio: number): void {
        this.clock?.SetProgress(ratio, this.tintFill ? this.colorAt(ratio) : undefined);
    }

    /** Xanh (đầy) → vàng (nửa) → đỏ (hết). */
    private colorAt(ratio: number): Color {
        if (ratio >= 0.5) return Color.lerp(this.color, this.halfColor, this.fullColor, (ratio - 0.5) * 2);
        return Color.lerp(this.color, this.lowColor, this.halfColor, ratio * 2);
    }

    /** Rung nhẹ (lắc qua lại) khi sắp hết giờ. */
    private setShake(on: boolean): void {
        const view = this.view;
        if (!view || on === this.shaking) return;
        this.shaking = on;
        Tween.stopAllByTarget(view);
        view.angle = 0;
        if (!on) return;
        tween(view)
            .to(0.06, { angle: 12 })
            .to(0.12, { angle: -12 })
            .to(0.06, { angle: 0 })
            .delay(0.15)
            .union()
            .repeatForever()
            .start();
    }
}
