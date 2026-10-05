import { _decorator, Animation, Color, Component, Node, Sprite, SpriteFrame, Tween, UITransform, Vec3, tween } from 'cc';
import { World } from '../Manager/World';
import { PoolMember, PoolType } from '../Pool/PoolMember';
import { jumpTo } from './TileJump';
const { ccclass, property } = _decorator;

/**
 * Điều khiển một khách: avatar, hiển thị đơn (ảnh mờ, nhận cốc, dấu tick).
 * OrderManager chỉ làm việc với script này.
 *
 * Cấu trúc node:
 * Customer (CustomerController)
 * ├── Avatar
 * │   └── heart_emoji (điểm sinh tim khi đủ đơn)
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

    @property({ type: Color, tooltip: 'Màu tint của ảnh Ghost' })
    ghostColor = new Color(99, 99, 99, 255);

    @property({ slide: true, range: [0, 255, 1], tooltip: 'Độ trong mờ của ảnh Ghost (0–255)' })
    ghostAlpha = 110;

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

    @property({ type: Node, tooltip: 'Node đặt tim (để trống = tìm node con "heart_emoji" của Avatar)' })
    heartAnchor: Node | null = null;

    @property({ tooltip: 'Thời gian tim hiện trước khi bị tắt (giây)' })
    heartDuration = 1;

    /** Các node cốc thật đã giao cho khách hiện tại. */
    private delivered: Node[] = [];
    /** Vị trí đứng đặt trong scene; khách trượt vào tới đây và trượt ra từ đây. */
    private homePosition: Vec3 | null = null;
    /** Target của tween trượt vào / ra (xem `slide`). */
    private readonly slideState = { x: 0 };
    /** Chiều cao Avatar đặt trong scene, dùng làm chuẩn khi đổi ảnh nhân vật. */
    private avatarHeight: number | null = null;
    /** Tim đang hiện của khách hiện tại (lấy từ pool PoolType.HeartEmoji). */
    private heart: PoolMember | null = null;

    onLoad(): void {
        this.homePosition = this.node.position.clone();
        if (!this.heartAnchor) this.heartAnchor = this.avatar?.node.getChildByName('heart_emoji') ?? null;
    }

    /** Hiện khách mới với ảnh mờ của loại đồ uống gọi; khách trượt vào từ bên trái. */
    show(avatarFrame: SpriteFrame | null, drinkFrame: SpriteFrame | null): void {
        if (!this.homePosition) this.homePosition = this.node.position.clone();
        const home = this.homePosition;
        this.node.active = true;
        this.unschedule(this.hideHeart);
        this.hideHeart();
        this.slide(home.x - this.slideDistance, home.x);
        if (this.avatar && avatarFrame) {
            this.avatar.spriteFrame = avatarFrame;
            this.fitAvatar(avatarFrame);
        }
        const ghostTint = new Color(this.ghostColor.r, this.ghostColor.g, this.ghostColor.b, this.ghostAlpha);
        for (const ghost of this.ghosts) {
            ghost.node.active = true;
            ghost.spriteFrame = drinkFrame;
            ghost.color = ghostTint;
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

    /** Đủ đơn: hiện tim, đứng thêm một lúc, trượt ra bên trái cùng các cốc rồi ẩn; gọi `done` khi đã ẩn. */
    leave(done: () => void): void {
        this.showHeart();
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
     * Lấy tim từ pool (PoolControl), gắn vào `heartAnchor` để đi theo khách khi trượt ra,
     * tự trả về pool sau `heartDuration` giây.
     */
    private showHeart(): void {
        const pool = World.ins.poolManager;
        if (!pool || !this.heartAnchor) return;
        this.unschedule(this.hideHeart);
        this.hideHeart();
        const heart = pool.spawn(PoolType.HeartEmoji);
        heart.node.setParent(this.heartAnchor);
        heart.node.setPosition(Vec3.ZERO);
        // Node lấy lại từ pool không tự chạy lại playOnLoad nên phát anim thủ công.
        heart.getComponent(Animation)?.play();
        this.heart = heart;
        this.scheduleOnce(this.hideHeart, this.heartDuration);
    }

    private hideHeart(): void {
        const heart = this.heart;
        this.heart = null;
        if (heart?.isValid) World.ins.poolManager.despawn(heart);
    }

    /**
     * Ảnh nhân vật có tỉ lệ khác nhau (512x512, 367x512...) nhưng Avatar để size CUSTOM cố định
     * nên bị kéo méo/lệch. Giữ chiều cao gốc của Avatar, rộng theo tỉ lệ ảnh; anchor 0.5 nên
     * nhân vật luôn nằm giữa và chân vẫn đặt cùng một đường.
     */
    private fitAvatar(frame: SpriteFrame): void {
        const ut = this.avatar?.node.getComponent(UITransform);
        const rect = frame.rect;
        if (!ut || !rect.height) return;
        if (this.avatarHeight === null) this.avatarHeight = ut.height;
        ut.setContentSize(this.avatarHeight * rect.width / rect.height, this.avatarHeight);
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
