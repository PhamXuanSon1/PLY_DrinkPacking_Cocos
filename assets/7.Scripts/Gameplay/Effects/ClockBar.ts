import { _decorator, Component, Node, Sprite, Tween, tween, UIOpacity, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Thanh thời gian chạy ngược (prefab ClockBar): nền ProgressBarBackground, thanh `green` / `red`
 * (Sprite Sliced, anchorX = 0) co dần từ phải sang trái, icon `clock` ở đầu trái.
 * Còn trên `redRatio` là thanh xanh; từ đó trở xuống đổi sang thanh đỏ nhấp nháy (fade loop)
 * và icon đồng hồ lắc qua lại. CustomerTimer gọi `SetProgress` mỗi frame.
 */
@ccclass('ClockBar')
export class ClockBar extends Component {
    @property({ type: Sprite, tooltip: 'Thanh xanh (Sprite Sliced, anchorX = 0)' })
    green: Sprite | null = null;

    @property({ type: Sprite, tooltip: 'Thanh đỏ (Sprite Sliced, anchorX = 0), cùng kích thước thanh xanh' })
    red: Sprite | null = null;

    @property({ type: Node, tooltip: 'Icon đồng hồ ở đầu thanh, lắc khi sang thanh đỏ' })
    clock: Node | null = null;

    @property({ tooltip: 'Còn bấy nhiêu phần thời gian (0–1) thì đổi sang thanh đỏ' })
    redRatio = 0.5;

    @property({ tooltip: 'Độ mờ thấp nhất của thanh đỏ khi nhấp nháy (0–255)' })
    blinkMinOpacity = 90;

    @property({ tooltip: 'Số giây cho một lần mờ đi (một nhịp nhấp nháy = 2 lần)' })
    blinkTime = 0.3;

    @property({ tooltip: 'Góc lắc của icon đồng hồ (độ)' })
    shakeAngle = 15;

    /** Bề ngang đầy của thanh (lấy từ thanh xanh lúc load). */
    private fullWidth = 0;
    /** Bề ngang nhỏ nhất để Sliced không vỡ hai đầu bo tròn; dưới mức này ẩn thanh. */
    private minWidth = 0;
    private redOpacity: UIOpacity | null = null;
    private isRed: boolean | null = null;

    protected onLoad(): void {
        const t = this.green?.getComponent(UITransform);
        this.fullWidth = t?.width ?? 0;
        this.minWidth = t ? t.height : 0;
        if (this.red) this.redOpacity = this.red.getComponent(UIOpacity) ?? this.red.addComponent(UIOpacity);
    }

    protected onDisable(): void {
        this.setRed(false, true);
    }

    /** Đặt phần còn lại (0–1). Tham số `_color` giữ cho khớp ClockTimer.SetProgress, không dùng. */
    public SetProgress(ratio: number, _color?: unknown): void {
        ratio = Math.min(1, Math.max(0, ratio));
        const width = this.fullWidth * ratio;
        const visible = width >= this.minWidth * 0.5;
        const w = Math.max(width, this.minWidth);
        for (const s of [this.green, this.red]) s?.getComponent(UITransform)?.setContentSize(w, s.getComponent(UITransform)!.height);
        const red = ratio <= this.redRatio;
        if (this.green) this.green.node.active = visible && !red;
        if (this.red) this.red.node.active = visible && red;
        this.setRed(red);
    }

    private setRed(on: boolean, force = false): void {
        if (!force && on === this.isRed) return;
        this.isRed = on;
        const op = this.redOpacity;
        const clock = this.clock;
        if (op) {
            Tween.stopAllByTarget(op);
            op.opacity = 255;
        }
        if (clock) {
            Tween.stopAllByTarget(clock);
            clock.angle = 0;
        }
        if (!on) return;
        if (op) {
            tween(op)
                .to(this.blinkTime, { opacity: this.blinkMinOpacity })
                .to(this.blinkTime, { opacity: 255 })
                .union()
                .repeatForever()
                .start();
        }
        if (clock) {
            const a = this.shakeAngle;
            tween(clock)
                .to(0.06, { angle: a })
                .to(0.12, { angle: -a })
                .to(0.06, { angle: 0 })
                .delay(0.15)
                .union()
                .repeatForever()
                .start();
        }
    }
}
