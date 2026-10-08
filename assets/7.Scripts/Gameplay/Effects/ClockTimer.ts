import { _decorator, Color, Component, Sprite, Tween, tween } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Hình đồng hồ đếm ngược (prefab ClockTimer): `fillSprite` là Sprite kiểu Filled (Radial),
 * fillRange 1 = đầy, 0 = hết. Có thể tự chạy (`PlayTimer`) hoặc để script khác điều khiển
 * từng frame qua `SetProgress` (CustomerTimer làm vậy để đồng bộ với mặt giận của khách).
 */
@ccclass('ClockTimer')
export class ClockTimer extends Component {
    @property({ type: Sprite, tooltip: 'Sprite already configured with the desired fill type.' })
    public fillSprite: Sprite | null = null;

    @property({ tooltip: 'Default countdown duration in seconds.' })
    public defaultDuration = 1;

    private tweenFill: Tween<Sprite> | null = null;
    private isRunning = false;
    private onComplete: (() => void) | null = null;

    protected onLoad(): void {
        if (!this.fillSprite) this.fillSprite = this.getComponentInChildren(Sprite);
    }

    protected onDisable(): void {
        this.StopTimer();
    }

    /** Tự chạy đếm ngược: fillRange 1 → 0 trong `duration` giây, xong gọi `onComplete`. */
    public PlayTimer(duration: number = this.defaultDuration, onComplete?: () => void): void {
        if (!this.fillSprite) {
            console.warn(`[ClockTimer] Fill Sprite is missing on "${this.node.name}".`);
            return;
        }
        this.StopTimer();
        this.isRunning = true;
        this.onComplete = onComplete ?? null;
        this.fillSprite.fillRange = 1;
        this.tweenFill = tween(this.fillSprite)
            .to(Math.max(0.01, duration), { fillRange: 0 })
            .call(() => this.FinishTimer())
            .start();
    }

    public StopTimer(): void {
        this.tweenFill?.stop();
        this.tweenFill = null;
        this.isRunning = false;
        this.onComplete = null;
        if (this.fillSprite) this.fillSprite.fillRange = 1;
    }

    /** Đặt phần còn lại (0–1) và màu vòng; dùng khi script khác tự đếm giờ. */
    public SetProgress(ratio: number, color?: Color): void {
        if (!this.fillSprite) return;
        this.fillSprite.fillRange = Math.min(1, Math.max(0, ratio));
        if (color) this.fillSprite.color = color;
    }

    public get IsRunning(): boolean {
        return this.isRunning;
    }

    public FinishTimer(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.tweenFill = null;
        const cb = this.onComplete;
        this.onComplete = null;
        cb?.();
    }
}
