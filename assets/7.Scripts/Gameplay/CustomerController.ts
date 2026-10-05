import { _decorator, Color, Component, Node, Sprite, SpriteFrame, Tween, UITransform, Vec3, tween } from 'cc';
import { jumpTo } from './TileJump';
const { ccclass, property } = _decorator;

/** Màu ảnh mờ của đồ uống khách đang chờ. */
const GHOST_COLOR = new Color(255, 255, 255, 110);

/**
 * Điều khiển một khách: avatar, hiển thị đơn (ảnh mờ, nhận cốc, dấu tick).
 * OrderManager chỉ làm việc với script này.
 *
 * Cấu trúc node:
 * Customer (CustomerController)
 * ├── Avatar
 * ├── Cup_0..2        (điểm đáp, mỗi node có con Ghost = ảnh mờ)
 * └── Tick_0..2
 */
@ccclass('CustomerController')
export class CustomerController extends Component {
    @property({ type: Sprite, tooltip: 'Sprite nhân vật' })
    avatar: Sprite | null = null;

    @property({ type: [Node], tooltip: 'Điểm đáp của cốc trên đĩa (Cup_0..2), trái sang phải' })
    cupSlots: Node[] = [];

    @property({ type: [Sprite], tooltip: 'Ảnh mờ đồ uống khách gọi, mỗi điểm đáp một ảnh (giữ chiều cao, rộng theo tỉ lệ ảnh)' })
    ghosts: Sprite[] = [];

    @property({ type: [Node], tooltip: 'Dấu tick tương ứng từng cốc' })
    ticks: Node[] = [];

    @property({ tooltip: 'Thời gian khách còn đứng sau khi đủ đơn rồi mới biến mất (giây)' })
    doneHoldDuration = 0.3;

    @property({ tooltip: 'Độ cao cung nhảy của cốc khi giao cho khách' })
    jumpHeight = 150;

    @property({ tooltip: 'Khoảng cách khách trượt vào / ra ở bên trái (px)' })
    slideDistance = 800;

    @property({ tooltip: 'Thời gian khách trượt vào / ra (giây)' })
    slideDuration = 0.5;

    /** Các node cốc thật đã giao cho khách hiện tại. */
    private delivered: Node[] = [];
    /** Vị trí đứng đặt trong scene; khách trượt vào tới đây và trượt ra từ đây. */
    private homePosition: Vec3 | null = null;
    /** Target của tween trượt vào / ra (xem `slide`). */
    private readonly slideState = { x: 0 };

    onLoad(): void {
        this.homePosition = this.node.position.clone();
    }

    /** Hiện khách mới với ảnh mờ của loại đồ uống gọi; khách trượt vào từ bên trái. */
    show(avatarFrame: SpriteFrame | null, drinkFrame: SpriteFrame | null): void {
        if (!this.homePosition) this.homePosition = this.node.position.clone();
        const home = this.homePosition;
        this.node.active = true;
        this.slide(home.x - this.slideDistance, home.x);
        if (this.avatar && avatarFrame) this.avatar.spriteFrame = avatarFrame;
        for (const ghost of this.ghosts) {
            ghost.node.active = true;
            ghost.spriteFrame = drinkFrame;
            ghost.color = GHOST_COLOR;
            const ut = ghost.node.getComponent(UITransform);
            const rect = drinkFrame?.rect;
            if (ut && rect && rect.height) ut.width = ut.height * rect.width / rect.height;
        }
        for (const tick of this.ticks) tick.active = false;
    }

    /** Cho cốc thật nhảy tới điểm đáp thứ `index`; gọi `landed` khi đáp xong. */
    receive(tile: Node, index: number, landed: () => void): void {
        const slot = this.cupSlots[index];
        this.delivered.push(tile);
        // Trên đĩa chỉ hiện cốc: ẩn nền card và căn tâm của node con "Cup" vào điểm đáp.
        const card = tile.getComponent(Sprite);
        if (card) card.enabled = false;
        const cup = tile.getChildByName('Cup');
        const offset = cup ? tile.worldPosition.clone().subtract(cup.worldPosition) : null;
        jumpTo(tile, slot, slot, offset, () => {
            const ghost = this.ghosts[index];
            if (ghost) ghost.node.active = false;
            const tick = this.ticks[index];
            if (tick) {
                tick.active = true;
                tick.setSiblingIndex(this.node.children.length - 1);
            }
            landed();
        }, 0.35, this.jumpHeight);
    }

    /** Đủ đơn: đứng thêm một lúc, trượt ra bên trái cùng các cốc rồi ẩn; gọi `done` khi đã ẩn. */
    leave(done: () => void): void {
        this.scheduleOnce(() => {
            const home = this.homePosition ?? this.node.position;
            // Cốc đã là con của Cup_i nên trượt theo khách; hủy sau khi ra khỏi màn hình.
            this.slide(this.node.position.x, home.x - this.slideDistance, () => {
                for (const n of this.delivered) n.destroy();
                this.delivered = [];
                this.node.active = false;
                done();
            });
        }, this.doneHoldDuration);
    }

    /**
     * Trượt node theo trục x (linear). Tween chạy trên `slideState` chứ không phải trên node,
     * vì tween gắn vào Node bị dừng theo trạng thái active của node: `leave` tắt node rồi
     * `show` bật lại ngay trong callback, khiến tween trượt vào bị kẹt ở vị trí xuất phát.
     */
    private slide(fromX: number, toX: number, done?: () => void): void {
        Tween.stopAllByTarget(this.slideState);
        const p = this.node.position;
        this.node.setPosition(fromX, p.y, p.z);
        this.slideState.x = fromX;
        tween(this.slideState)
            .to(this.slideDuration, { x: toX }, {
                easing: 'linear',
                onUpdate: () => {
                    if (!this.node.isValid) return;
                    const cur = this.node.position;
                    this.node.setPosition(this.slideState.x, cur.y, cur.z);
                },
            })
            .call(() => done?.())
            .start();
    }

    onDestroy(): void {
        Tween.stopAllByTarget(this.slideState);
    }
}
