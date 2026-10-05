import { _decorator, Animation, BlockInputEvents, Color, Component, Graphics, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { gc } from '../Tool/GameController';
import { ui } from '../Manager/UI';
import { LEVEL_WIN_EVENT, OrderManager } from './OrderManager';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    refs: { id: 'refs', name: 'Tham chiếu', displayOrder: 0, style: 'section' },
    fx: { id: 'fx', name: 'Hiệu ứng', displayOrder: 1, style: 'section' },
    timing: { id: 'timing', name: 'Nhịp', displayOrder: 2, style: 'section' },
};

/** Màu tia lửa / pháo hoa (vàng cam như game gốc). */
const SPARK_COLORS = [new Color(255, 214, 90, 255), new Color(255, 170, 50, 255), new Color(255, 240, 160, 255)];

/**
 * Endcard khi thắng (thay cho End/Win cũ): ruy băng Level Complete, logo game và nút tải.
 * Nền tối + tia sáng xoay sau logo → ruy băng bật ra → logo bật ra → nút bật ra rồi chạy anim
 * nhún có sẵn (Animation trên nút), pháo hoa hai bên logo, tia lửa bay lên.
 * Chạm bất kỳ đâu (hoặc nút) mở store.
 *
 * Cấu trúc node:
 * WinPopup (WinPopup, BlockInputEvents)
 * ├── Dim            (Graphics: nền tối toàn màn hình)
 * ├── Rays           (Sprite fx_shine, xoay chậm, đặt theo vị trí logo)
 * ├── Endcard
 * │   ├── LevelComplete (ruy băng)
 * │   ├── Logo          (Sprite logo game)
 * │   └── Button        (nút tải, Animation Scale)
 * └── Fx             (tia lửa, pháo hoa sinh tạm)
 */
@ccclass('WinPopup')
export class WinPopup extends Component {
    @property({ type: OrderManager, tooltip: 'Nghe sự kiện thắng (level-win) để hiện endcard', group: GROUP.refs })
    orderManager: OrderManager | null = null;

    @property({ type: Node, tooltip: 'Nền tối (Graphics, tự vẽ)', group: GROUP.refs })
    dim: Node | null = null;

    @property({ type: Node, tooltip: 'Tia sáng xoay sau logo', group: GROUP.refs })
    rays: Node | null = null;

    @property({ type: Node, tooltip: 'Ruy băng Level Complete', group: GROUP.refs })
    levelComplete: Node | null = null;

    @property({ type: Node, tooltip: 'Logo game', group: GROUP.refs })
    logo: Node | null = null;

    @property({ type: Node, tooltip: 'Nút tải (có Animation thì phát sau khi nút bật ra)', group: GROUP.refs })
    button: Node | null = null;

    @property({ type: Node, tooltip: 'Lớp chứa tia lửa / pháo hoa sinh tạm', group: GROUP.refs })
    fxRoot: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Hạt lấp lánh (sparkle3)', group: GROUP.fx })
    sparkleFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Hạt tròn mềm (glow1) cho tia lửa bay lên', group: GROUP.fx })
    glowFrame: SpriteFrame | null = null;

    @property({ tooltip: 'Chờ bao lâu sau khi thắng mới hiện endcard (giây), để animation khách cuối chạy xong', group: GROUP.timing })
    showDelay = 1;

    @property({ slide: true, range: [0, 255, 1], tooltip: 'Độ tối của nền', group: GROUP.timing })
    dimAlpha = 190;

    private shown = false;

    onLoad(): void {
        this.getComponent(BlockInputEvents) ?? this.addComponent(BlockInputEvents);
        this.drawDim();
        // Endcard đã hiện thì chạm bất kỳ đâu cũng mở store: Dim phủ toàn màn hình nhận mọi chạm
        // ngoài nút; nút có listener riêng (Dim không phải cha của nút nên không gọi trùng).
        this.dim?.on(Node.EventType.TOUCH_END, this.onDownload, this);
        this.button?.on(Node.EventType.TOUCH_END, this.onDownload, this);
        this.orderManager?.node.on(LEVEL_WIN_EVENT, this.onWin, this);
        this.node.active = false;
    }

    onDestroy(): void {
        this.orderManager?.node.off(LEVEL_WIN_EVENT, this.onWin, this);
    }

    private onWin(): void {
        // Node đang tắt nên lịch hẹn chạy trên OrderManager (luôn bật).
        this.orderManager?.scheduleOnce(() => this.show(), this.showDelay);
    }

    /** Hiện endcard và chạy toàn bộ animation. */
    show(): void {
        if (this.shown) return;
        this.shown = true;
        Ply_SoundManager.Ins?.playFx(FxType.LevelWin);
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent ? this.node.parent.children.length - 1 : 0);
        // Logo + nút tải ở góc màn hình (UI.fisrtOn) trùng với endcard nên ẩn đi.
        ui?.hideFirstOn();

        // Nền tối + tia sáng sau logo.
        if (this.dim) this.fade(this.dim, 0, this.dimAlpha, 0.25);
        if (this.rays) {
            if (this.logo) this.rays.setWorldPosition(this.logo.worldPosition);
            this.fade(this.rays, 0, 200, 0.4);
            this.rays.setScale(0.6, 0.6, 1);
            tween(this.rays).to(0.4, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
            tween(this.rays).repeatForever(tween(this.rays).by(6, { angle: -360 })).start();
        }

        // Ruy băng → logo → nút lần lượt bật ra. Anim nhún của nút cũng đổi scale nên tạm dừng,
        // chờ nút bật ra xong mới phát.
        const buttonAnim = this.button?.getComponent(Animation) ?? null;
        buttonAnim?.stop();
        this.popIn(this.levelComplete, 0.1);
        this.popIn(this.logo, 0.3);
        this.popIn(this.button, 0.5, () => buttonAnim?.play());

        this.scheduleOnce(() => this.fireworks(), 0.35);
        this.scheduleOnce(() => this.fireworks(), 0.75);
        this.scheduleOnce(() => this.fireworks(), 1.15);
        this.schedule(this.risingSpark, 0.06, 25, 0.1);
    }

    /** Node phóng từ 0 lên hơi to rồi về cỡ thường, kèm hiện dần. */
    private popIn(node: Node | null, delay: number, done?: () => void): void {
        if (!node) return;
        const base = node.scale.clone();
        node.setScale(0, 0, base.z);
        this.fade(node, 0, 0, 0);
        tween(node)
            .delay(delay)
            .call(() => this.fade(node, 0, 255, 0.15))
            .to(0.25, { scale: new Vec3(base.x * 1.12, base.y * 1.12, base.z) }, { easing: 'quadOut' })
            .to(0.12, { scale: base }, { easing: 'sineOut' })
            .call(() => done?.())
            .start();
    }

    private onDownload(): void {
        gc?.redirectToStore();
    }

    /** Pháo hoa lấp lánh ở hai bên logo. */
    private fireworks(): void {
        const anchor = this.logo ?? this.node;
        const ut = anchor.getComponent(UITransform);
        const w = ut ? ut.width * 0.5 : 200;
        const h = ut ? ut.height * 0.5 : 200;
        for (const side of [-1, 1]) {
            const p = anchor.worldPosition.clone().add3f(side * (w * (0.9 + Math.random() * 0.3)), h * (Math.random() * 1.2 - 0.3), 0);
            this.burst(p, 14, 200);
        }
    }

    /** Một chùm hạt lấp lánh bung tròn từ `pos` (world). */
    private burst(pos: Vec3, count: number, radius: number): void {
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
            const dist = radius * (0.5 + Math.random() * 0.5);
            const size = 18 + Math.random() * 18;
            const n = this.spawn(this.sparkleFrame, pos, size, size, SPARK_COLORS[i % SPARK_COLORS.length]);
            if (!n) return;
            n.setScale(0.2, 0.2, 1);
            const to = n.position.clone().add3f(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
            tween(n).to(0.45, { position: to, scale: Vec3.ONE }, { easing: 'quadOut' }).start();
            this.fadeOutAndDestroy(n, 0.25, 0.35);
        }
    }

    /** Tia lửa vàng bay lên từ đáy màn hình. */
    private risingSpark(): void {
        const root = this.fxRoot ?? this.node;
        const rootUt = this.node.getComponent(UITransform);
        const halfW = rootUt ? rootUt.width * 0.45 : 480;
        const bottom = rootUt ? -rootUt.height * 0.5 : -1100;
        const start = new Vec3((Math.random() * 2 - 1) * halfW, bottom + Math.random() * 200, 0);
        const n = this.spawn(this.glowFrame, Vec3.ZERO, 8, 40 + Math.random() * 30, SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)]);
        if (!n) return;
        n.setParent(root);
        n.setPosition(start);
        const life = 0.8 + Math.random() * 0.6;
        tween(n).by(life, { position: new Vec3(0, 500 + Math.random() * 400, 0) }, { easing: 'sineOut' }).start();
        this.fadeOutAndDestroy(n, life * 0.5, life * 0.5);
    }

    private spawn(frame: SpriteFrame | null, worldPos: Vec3, w: number, h: number, color: Color): Node | null {
        if (!frame) return null;
        const n = new Node('fx');
        n.layer = this.node.layer;
        (this.fxRoot ?? this.node).addChild(n);
        n.addComponent(UITransform).setContentSize(w, h);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = frame;
        sp.color = color;
        n.addComponent(UIOpacity);
        n.setWorldPosition(worldPos);
        return n;
    }

    private fadeOutAndDestroy(n: Node, delay: number, duration: number): void {
        const op = n.getComponent(UIOpacity)!;
        tween(op).delay(delay).to(duration, { opacity: 0 }).call(() => n.isValid && n.destroy()).start();
    }

    private fade(n: Node, from: number, to: number, duration: number): void {
        const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        op.opacity = from;
        if (duration > 0) tween(op).to(duration, { opacity: to }).start();
        else op.opacity = to;
    }

    /** Nền tối phủ toàn màn hình. */
    private drawDim(): void {
        const g = this.dim?.getComponent(Graphics);
        const ut = this.dim?.getComponent(UITransform);
        if (!g || !ut) return;
        g.clear();
        g.fillColor = new Color(20, 14, 10, 255);
        g.rect(-ut.width * ut.anchorX, -ut.height * ut.anchorY, ut.width, ut.height);
        g.fill();
    }
}
