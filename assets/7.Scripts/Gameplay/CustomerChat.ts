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

    @property({ tooltip: 'Thời gian bong bóng hiện (giây)', group: GROUP.chat })
    showDuration = 2;

    /** Câu vừa nói (dùng chung cho mọi khách), tránh hai lần nói liên tiếp trùng câu. */
    private static lastLine = -1;

    onLoad(): void {
        if (this.bubble) this.bubble.active = false;
    }

    /** Hiện một câu ngẫu nhiên (khác câu trước) với hiệu ứng nảy, tự ẩn sau `showDuration` giây. */
    say(): void {
        if (!this.bubble || !this.lines.length) return;
        let index = Math.floor(Math.random() * this.lines.length);
        if (index === CustomerChat.lastLine && this.lines.length > 1) index = (index + 1) % this.lines.length;
        CustomerChat.lastLine = index;
        if (this.label) this.label.string = this.lines[index];

        // Bong bóng tràn sang chỗ khách bên cạnh: đưa khay của khách này lên trên cùng để không bị avatar bên cạnh che.
        const tray = this.node.parent;
        if (tray?.parent) tray.setSiblingIndex(tray.parent.children.length - 1);
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
