import { _decorator, Color, Component, Node, Sprite, SpriteFrame, UITransform } from 'cc';
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

    /** Các node cốc thật đã giao cho khách hiện tại. */
    private delivered: Node[] = [];

    /** Hiện khách mới với ảnh mờ của loại đồ uống gọi. */
    show(avatarFrame: SpriteFrame | null, drinkFrame: SpriteFrame | null): void {
        this.node.active = true;
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
        });
    }

    /** Đủ đơn: đứng thêm một lúc rồi ẩn cùng các cốc; gọi `done` khi đã ẩn. */
    leave(done: () => void): void {
        this.scheduleOnce(() => {
            for (const n of this.delivered) n.destroy();
            this.delivered = [];
            this.node.active = false;
            done();
        }, this.doneHoldDuration);
    }
}
