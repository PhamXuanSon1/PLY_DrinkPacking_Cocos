import { _decorator, Component, Label, Node, Tween, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    refs: { id: 'refs', name: 'Tham chiếu', displayOrder: 0, style: 'section' },
    chat: { id: 'chat', name: 'Lời thoại', displayOrder: 1, style: 'section' },
};

/**
 * Lời thoại của khách ("Hurry up!", "I'm thirsty!"...), hiện trong bong bóng chat cạnh đầu.
 * OrderManager quyết định khách nào nói; CustomerController gọi `say` khi khách trượt vào xong
 * và `stop` khi khách rời đi.
 *
 * Cấu trúc node:
 * Customer (CustomerController, CustomerChat)
 * └── Chat            (bubble, tắt sẵn)
 *     ├── Bubble      (Sprite bong bóng, scaleX = -1 nếu đuôi quay sang phải)
 *     └── Text        (Label)
 */
@ccclass('CustomerChat')
export class CustomerChat extends Component {
    @property({ type: Node, tooltip: 'Node bong bóng chat (bật / tắt và phóng to khi nói)', group: GROUP.refs })
    bubble: Node | null = null;

    @property({ type: Label, tooltip: 'Nhãn chứa lời thoại', group: GROUP.refs })
    label: Label | null = null;

    @property({ type: [String], tooltip: 'Các câu thoại, chọn ngẫu nhiên', group: GROUP.chat })
    lines: string[] = [
        'Hurry up!',
        "I'm thirsty!",
        'They said you have good drinks!',
        'So hot today...',
        "Can't wait!",
        'Make it quick, please!',
    ];

    @property({ tooltip: 'Câu nói khi vào gameplay, nếu khách này là người nói đầu tiên trong màn (khách đứng giữa). Để trống = câu ngẫu nhiên', group: GROUP.chat })
    firstLine = "It's raining! Hurry before your customers leave!";

    @property({ tooltip: 'Thời gian bong bóng hiện (giây)', group: GROUP.chat })
    showDuration = 2;

    /** Câu vừa nói (dùng chung cho mọi khách), tránh hai lần nói liên tiếp trùng câu. */
    private static lastLine = -1;

    /** Lần nói kế tiếp dùng `firstLine` thay câu ngẫu nhiên. OrderManager bật khi vào màn. */
    static firstPending = false;
    /** Đang giữ lời thoại (IntroRain đang chạy): khách nói trong lúc này được hoãn tới `release()`. */
    private static held = false;
    private static waiting: CustomerChat | null = null;

    /** Hoãn lời thoại của khách cho tới `release()` (vd chờ intro mưa mờ xong). */
    static hold(): void {
        CustomerChat.held = true;
    }

    /** Thôi hoãn: khách đã định nói trong lúc hoãn sẽ nói ngay. */
    static release(): void {
        CustomerChat.held = false;
        const chat = CustomerChat.waiting;
        CustomerChat.waiting = null;
        if (chat?.isValid && chat.node.activeInHierarchy) chat.say();
    }

    onLoad(): void {
        if (this.bubble) this.bubble.active = false;
    }

    /** Hiện `firstLine` nếu là câu đầu màn, không thì một câu ngẫu nhiên (khác câu trước); hiệu ứng nảy, tự ẩn sau `showDuration` giây. */
    say(): void {
        if (!this.bubble) return;
        if (CustomerChat.held) {
            CustomerChat.waiting = this;
            return;
        }
        let line = CustomerChat.firstPending ? this.firstLine : '';
        CustomerChat.firstPending = false;
        if (!line) {
            if (!this.lines.length) return;
            let index = Math.floor(Math.random() * this.lines.length);
            if (index === CustomerChat.lastLine && this.lines.length > 1) index = (index + 1) % this.lines.length;
            CustomerChat.lastLine = index;
            line = this.lines[index];
        }
        if (this.label) this.label.string = line;

        // Bong bóng tràn sang chỗ khách bên cạnh: đưa khách này (khay + avatar) lên trên cùng để không bị avatar bên cạnh che.
        // Gọi theo tên class để tránh import vòng (CustomerController đã import CustomerChat).
        (this.getComponent('CustomerController') as unknown as { bringToFront?(): void } | null)?.bringToFront?.();
        const bubble = this.bubble;
        this.unschedule(this.hide);
        Tween.stopAllByTarget(bubble);
        bubble.active = true;
        bubble.setScale(0, 0, 1);
        tween(bubble).to(0.25, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
        this.scheduleOnce(this.hide, this.showDuration);
    }

    /** Khách rời đi: tắt bong bóng ngay. */
    stop(): void {
        if (CustomerChat.waiting === this) CustomerChat.waiting = null;
        this.unschedule(this.hide);
        this.hideNow();
    }

    private hide(): void {
        const bubble = this.bubble;
        if (!bubble?.active) return this.hideNow();
        Tween.stopAllByTarget(bubble);
        tween(bubble)
            .to(0.15, { scale: new Vec3(0, 0, 1) }, { easing: 'quadIn' })
            .call(() => this.hideNow())
            .start();
    }

    private hideNow(): void {
        if (!this.bubble) return;
        Tween.stopAllByTarget(this.bubble);
        this.bubble.active = false;
    }

    onDestroy(): void {
        this.hideNow();
    }
}
