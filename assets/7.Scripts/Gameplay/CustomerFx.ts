import { _decorator, Color, Component, Node, Sprite, SpriteFrame, tween, UIOpacity, UITransform, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/** Màu giấy confetti khi khách đủ đơn (cam / vàng như game gốc). */
const CONFETTI_COLORS = [new Color(255, 160, 40, 255), new Color(255, 205, 60, 255), new Color(255, 130, 30, 255)];

/**
 * Hiệu ứng của khách, sinh tạm các node Sprite trên lớp FX này rồi tự hủy:
 * lấp lánh khi cốc đáp, vầng sáng + tia + confetti khi đủ đơn, lấp lánh quanh khách,
 * vệt gió khi khách lướt vào / ra. Đặt node này trên cùng (vẽ sau) các khách.
 * Mọi vị trí truyền vào là world position.
 */
@ccclass('CustomerFx')
export class CustomerFx extends Component {
    @property({ type: SpriteFrame, tooltip: 'Lấp lánh 4 cánh (sparkle3)' })
    sparkleFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Vầng sáng tròn mềm (glow1); cũng dùng cho confetti và vệt gió' })
    glowFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Tia sáng xoay sau chữ khen (fx_shine)' })
    shineFrame: SpriteFrame | null = null;

    @property({ type: Color, tooltip: 'Màu vầng sáng sau chữ khen' })
    glowColor = new Color(255, 190, 230, 170);

    @property({ type: Color, tooltip: 'Màu vệt gió khi khách lướt' })
    speedLineColor = new Color(170, 215, 255, 230);

    @property({ tooltip: 'Số mảnh confetti khi đủ đơn' })
    confettiCount = 16;

    /** Bụi vàng lấp lánh bung ra khi cốc đáp xuống đĩa. */
    landSparkle(pos: Vec3): void {
        for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 25 + Math.random() * 25;
            const size = 18 + Math.random() * 14;
            const n = this.spawn(this.sparkleFrame, pos, size, size, new Color(255, 225, 120, 255));
            if (!n) return;
            n.setScale(0.3, 0.3, 1);
            const to = n.position.clone().add3f(Math.cos(angle) * dist, Math.sin(angle) * dist + 10, 0);
            tween(n)
                .to(0.3, { position: to, scale: Vec3.ONE }, { easing: 'quadOut' })
                .start();
            this.fadeOutAndDestroy(n, 0.15, 0.2);
        }
    }

    /**
     * Cốc chạm đĩa (snap vào điểm đáp): lóe sáng vàng phủ lên cốc rồi tắt nhanh, kèm bụi kim tuyến
     * vàng bốc lên quanh cốc và vài ngôi sao trắng. `w`, `h` là kích thước cốc trên màn hình (px).
     */
    snap(pos: Vec3, w: number, h: number): void {
        const flash = this.spawn(this.glowFrame, pos, w * 1.5, h * 1.25, new Color(255, 236, 150, 220));
        if (flash) {
            flash.setScale(0.6, 0.6, 1);
            tween(flash).to(0.12, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'quadOut' }).start();
            this.fadeOutAndDestroy(flash, 0.06, 0.2);
        }
        for (let i = 0; i < 10; i++) {
            const start = pos.clone().add3f((Math.random() * 2 - 1) * w * 0.5, (Math.random() * 2 - 1) * h * 0.4, 0);
            const size = 10 + Math.random() * 10;
            const n = this.spawn(this.sparkleFrame, start, size, size, new Color(255, 220, 110, 255));
            if (!n) return;
            n.setScale(0, 0, 1);
            const life = 0.35 + Math.random() * 0.2;
            const to = n.position.clone().add3f((Math.random() * 2 - 1) * 12, 40 + Math.random() * 40, 0);
            tween(n)
                .delay(Math.random() * 0.08)
                .to(life * 0.35, { scale: Vec3.ONE }, { easing: 'backOut' })
                .to(life * 0.65, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'sineIn' })
                .start();
            tween(n).to(life, { position: to }, { easing: 'quadOut' }).start();
            this.fadeOutAndDestroy(n, life * 0.5, life * 0.6);
        }
        this.twinkle(pos, w * 0.6, h * 0.5, 2);
    }

    /**
     * Vầng sáng + tia xoay phía sau chữ khen và confetti bung ra từ `pos`.
     * Nếu có `behind` (node chữ khen), vầng sáng và tia được chèn ngay trước nó để vẽ phía sau chữ.
     */
    celebrate(pos: Vec3, behind?: Node | null): void {
        const glow = this.spawn(this.glowFrame, pos, 320, 170, this.glowColor, behind);
        if (glow) {
            glow.setScale(0.2, 0.2, 1);
            tween(glow).to(0.2, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'backOut' }).start();
            this.fadeOutAndDestroy(glow, 0.45, 0.3);
        }
        const shine = this.spawn(this.shineFrame, pos, 300, 300, new Color(255, 230, 245, 150), behind);
        if (shine) {
            shine.setScale(0.2, 0.2, 1);
            tween(shine).to(0.2, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
            tween(shine).by(0.75, { angle: -60 }).start();
            this.fadeOutAndDestroy(shine, 0.4, 0.35);
        }
        for (let i = 0; i < this.confettiCount; i++) this.confetti(pos);
    }

    /** Vài ngôi sao trắng nhấp nháy rải rác trong hình chữ nhật quanh `center`. */
    twinkle(center: Vec3, halfW: number, halfH: number, count = 5): void {
        for (let i = 0; i < count; i++) {
            const p = center.clone().add3f((Math.random() * 2 - 1) * halfW, (Math.random() * 2 - 1) * halfH, 0);
            const size = 22 + Math.random() * 18;
            const n = this.spawn(this.sparkleFrame, p, size, size, Color.WHITE);
            if (!n) return;
            n.setScale(0, 0, 1);
            tween(n)
                .delay(i * 0.07)
                .to(0.15, { scale: Vec3.ONE }, { easing: 'backOut' })
                .to(0.2, { scale: new Vec3(0, 0, 1) }, { easing: 'sineIn' })
                .call(() => n.destroy())
                .start();
        }
    }

    /**
     * Vệt gió xanh nhạt sinh liên tục theo `target` trong `duration` giây (khách lướt ngang).
     * Mỗi vệt kéo dài rồi mờ dần tại chỗ, tạo cảm giác chạy nhanh.
     */
    speedLines(target: Node, duration: number, halfH = 90): void {
        const count = 4;
        for (let i = 0; i < count; i++) {
            this.scheduleOnce(() => {
                if (!target.isValid) return;
                const p = target.worldPosition.clone().add3f(0, (Math.random() * 2 - 1) * halfH, 0);
                const n = this.spawn(this.glowFrame, p, 120, 8, this.speedLineColor);
                if (!n) return;
                n.setScale(0.3, 1, 1);
                tween(n).to(0.25, { scale: new Vec3(1.2, 0.6, 1) }, { easing: 'quadOut' }).start();
                this.fadeOutAndDestroy(n, 0.05, 0.25);
            }, (duration * i) / count);
        }
    }

    /** Một mảnh confetti bay theo hướng ngẫu nhiên, rơi theo trọng lực, xoay và mờ dần. */
    private confetti(pos: Vec3): void {
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const n = this.spawn(this.glowFrame, pos, 10 + Math.random() * 6, 6 + Math.random() * 4, color);
        if (!n) return;
        const start = n.position.clone();
        const angle = Math.PI * (0.1 + Math.random() * 0.8); // chủ yếu bắn lên trên, xòe hai bên
        const speed = 280 + Math.random() * 220;
        const vx = Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1);
        const vy = Math.sin(angle) * speed * 0.8;
        const spin = (Math.random() * 2 - 1) * 720;
        const gravity = -900;
        const life = 0.7 + Math.random() * 0.3;
        n.angle = Math.random() * 360;
        const state = { t: 0 };
        tween(state)
            .to(life, { t: life }, {
                onUpdate: () => {
                    if (!n.isValid) return;
                    const t = state.t;
                    n.setPosition(start.x + vx * t, start.y + vy * t + 0.5 * gravity * t * t, 0);
                    n.angle += spin / 60;
                },
            })
            .start();
        this.fadeOutAndDestroy(n, life * 0.6, life * 0.4);
    }

    /** Tạo node Sprite tạm tại world `pos`: trên lớp FX, hoặc ngay trước node `behind` (vẽ phía sau nó). */
    private spawn(frame: SpriteFrame | null, pos: Vec3, w: number, h: number, color: Color, behind?: Node | null): Node | null {
        if (!frame) return null;
        const n = new Node('fx');
        n.layer = this.node.layer;
        if (behind?.parent) {
            behind.parent.insertChild(n, behind.getSiblingIndex());
        } else {
            this.node.addChild(n);
        }
        n.addComponent(UITransform).setContentSize(w, h);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = frame;
        sp.color = color;
        n.addComponent(UIOpacity);
        n.setWorldPosition(pos);
        return n;
    }

    /** Sau `delay` giây mờ dần trong `duration` giây rồi hủy node. */
    private fadeOutAndDestroy(n: Node, delay: number, duration: number): void {
        const op = n.getComponent(UIOpacity)!;
        tween(op)
            .delay(delay)
            .to(duration, { opacity: 0 })
            .call(() => n.isValid && n.destroy())
            .start();
    }
}
