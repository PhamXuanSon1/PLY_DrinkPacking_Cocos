import { _decorator, Color, Component, ParticleSystem2D, Tween, tween, UIOpacity } from 'cc';
import { LEVEL_START_EVENT, OrderManager } from './OrderManager';
import { CustomerChat } from './CustomerChat';
import { TutorialManager } from './TutorialManager';
const { ccclass, property } = _decorator;

/**
 * Khi vào gameplay (OrderManager phát LEVEL_START_EVENT, tức sau tutorial nếu có): màn đen mờ + mưa trước,
 * sau `appearDelay` giây khách mới trượt vào (OrderManager.holdCustomers) cùng thuyền trưởng. Có thuyền trưởng (TutorialManager.useGuide): thuyền trưởng nói, mưa kéo dài tới khi người chơi chạm
 * sau câu cuối. Không có: giữ `holdTime` giây. Sau đó màn đen và mưa cùng mờ dần trong `fadeTime` giây,
 * đồng hồ khách chạy luôn (có thuyền trưởng), rồi khách nói câu đầu màn. Chỉ chạy ở lần vào đầu tiên.
 * Màn đen (BlackPanel) setup sẵn trong scene: Sprite (màu / độ mờ), Widget phủ kín Canvas,
 * BlockInputEvents chặn chạm suốt intro, UIOpacity để fade.
 */
@ccclass('IntroRain')
export class IntroRain extends Component {
    @property({ type: OrderManager, tooltip: 'Bắt đầu intro khi OrderManager vào màn chơi' })
    orderManager: OrderManager | null = null;

    @property({ type: TutorialManager, tooltip: 'Thuyền trưởng nói trong lúc mưa (bật Use Guide trên TutorialManager)' })
    tutorial: TutorialManager | null = null;

    @property({ type: UIOpacity, tooltip: 'UIOpacity trên BlackPanel' })
    panel: UIOpacity | null = null;

    @property({ type: ParticleSystem2D, tooltip: 'Hiệu ứng mưa (RainPTC)' })
    rain: ParticleSystem2D | null = null;

    @property({ tooltip: 'Số giây chỉ có màn đen + mưa, sau đó khách và thuyền trưởng mới xuất hiện' })
    appearDelay = 1;

    @property({ tooltip: 'Không có thuyền trưởng: số giây giữ màn đen + mưa (sau khi khách vào) trước khi bắt đầu mờ đi' })
    holdTime = 2;

    @property({ tooltip: 'Số giây màn đen mờ dần' })
    fadeTime = 1;

    private played = false;

    onLoad(): void {
        // Ẩn tới khi vào gameplay (lúc tutorial đang chạy thì chưa hiện).
        if (this.panel) this.panel.node.active = false;
        if (this.rain) this.rain.node.active = false;
        this.orderManager?.node.on(LEVEL_START_EVENT, this.play, this);
        // Khách nói câu đầu màn (CustomerChat.firstLine) chỉ sau khi mưa mờ xong.
        if (this.panel) CustomerChat.hold();
        // Tối + mưa trước, khách vào sau: OrderManager chưa gọi khách khi bắt đầu màn.
        if (this.panel && this.orderManager) this.orderManager.holdCustomers = true;
    }

    onDestroy(): void {
        this.orderManager?.node?.off(LEVEL_START_EVENT, this.play, this);
        CustomerChat.release();
        if (this.panel) Tween.stopAllByTarget(this.panel);
    }

    play(): void {
        const panel = this.panel;
        if (!panel || this.played) return;
        this.played = true;
        panel.node.active = true;
        panel.opacity = 255;
        if (this.rain) {
            this.rain.node.active = true;
            this.rain.resetSystem();
        }
        tween(panel)
            .delay(this.appearDelay)
            .call(() => this.appear())
            .start();
    }

    /** Khách trượt vào cùng thuyền trưởng (Guide trong node Rain, trên BlackPanel); chạm sau lời thoại thì hết intro. */
    private appear(): void {
        this.orderManager?.releaseCustomers();
        if (this.tutorial?.playGuide(() => this.fadeOut(true))) return;
        tween(this.panel!)
            .delay(this.holdTime)
            .call(() => this.fadeOut(false))
            .start();
    }

    /** Màn đen + mưa mờ dần; `startClocks` = đồng hồ khách chạy luôn, không chờ click cốc đầu tiên. */
    private fadeOut(startClocks: boolean): void {
        const panel = this.panel!;
        if (startClocks) this.orderManager?.startClocks();
        this.fadeRain();
        Tween.stopAllByTarget(panel);
        tween(panel)
            .to(this.fadeTime, { opacity: 0 })
            .call(() => {
                panel.node.active = false;
                if (this.rain) this.rain.node.active = false;
                CustomerChat.release();
            })
            .start();
    }

    /**
     * Mưa mờ dần cùng màn đen. Particle 2D không ăn theo UIOpacity nên giảm alpha màu hạt:
     * hạt mới (startColor / endColor) và chặn alpha các hạt đang rơi theo cùng tỉ lệ.
     */
    private fadeRain(): void {
        const rain = this.rain;
        if (!rain) return;
        const start = rain.startColor.clone();
        const end = rain.endColor.clone();
        const cap = Math.max(start.a, end.a);
        const fade = { k: 1 };
        tween(fade)
            .to(this.fadeTime, { k: 0 }, {
                onUpdate: () => {
                    if (!rain.isValid) return;
                    const k = fade.k;
                    rain.startColor = new Color(start.r, start.g, start.b, start.a * k);
                    rain.endColor = new Color(end.r, end.g, end.b, end.a * k);
                    const max = cap * k;
                    for (const p of rain._simulator.particles) if (p.color.a > max) p.color.a = max;
                },
            })
            .call(() => {
                rain.startColor = start;
                rain.endColor = end;
            })
            .start();
    }
}
