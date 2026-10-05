import { _decorator, Animation, Color, Component, Label, Node, Sprite, SpriteFrame, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc';
import { World } from '../Manager/World';
import { PoolMember, PoolType } from '../Pool/PoolMember';
import { CustomerChat } from './CustomerChat';
import { CustomerFx } from './CustomerFx';
import { jumpTo, liftOff } from './TileJump';
const { ccclass, property } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    character: { id: 'character', name: 'Nhân vật & đĩa', displayOrder: 0, style: 'section' },
    ghost: { id: 'ghost', name: 'Ảnh mờ (Ghost)', displayOrder: 1, style: 'section' },
    slide: { id: 'slide', name: 'Trượt vào - ra', displayOrder: 2, style: 'section' },
    deliver: { id: 'deliver', name: 'Giao cốc', displayOrder: 3, style: 'section' },
    done: { id: 'done', name: 'Đủ đơn', displayOrder: 4, style: 'section' },
    praise: { id: 'praise', name: 'Chữ khen', displayOrder: 5, style: 'section' },
    heartFx: { id: 'heartFx', name: 'Tim & FX', displayOrder: 6, style: 'section' },
};

/**
 * Điều khiển một khách: avatar, hiển thị đơn (ảnh mờ, nhận cốc, dấu tick).
 * OrderManager chỉ làm việc với script này.
 *
 * Cấu trúc node:
 * Customer (CustomerController)
 * ├── Avatar
 * │   └── heart_emoji (điểm sinh tim khi đủ đơn)
 * ├── Praise         (chữ khen "Amazing", tùy chọn)
 * ├── Cup_0..2        (điểm đáp, mỗi node có con Ghost = ảnh mờ)
 * ├── Tick_0..2
 * └── Chat            (bong bóng lời thoại, xem CustomerChat)
 */
@ccclass('CustomerController')
export class CustomerController extends Component {
    @property({ type: Sprite, tooltip: 'Sprite nhân vật', group: GROUP.character })
    avatar: Sprite | null = null;

    @property({ type: [Node], tooltip: 'Điểm đáp của cốc trên đĩa (Cup_0..2), trái sang phải', group: GROUP.character })
    cupSlots: Node[] = [];

    @property({ type: [Node], tooltip: 'Dấu tick tương ứng từng cốc', group: GROUP.character })
    ticks: Node[] = [];

    @property({ type: [Sprite], tooltip: 'Ảnh mờ đồ uống khách gọi, mỗi điểm đáp một ảnh (giữ chiều cao, rộng theo tỉ lệ ảnh)', group: GROUP.ghost })
    ghosts: Sprite[] = [];

    @property({ type: Color, tooltip: 'Màu tint của ảnh Ghost', group: GROUP.ghost })
    ghostColor = new Color(99, 99, 99, 255);

    @property({ slide: true, range: [0, 255, 1], tooltip: 'Độ trong mờ của ảnh Ghost (0–255)', group: GROUP.ghost })
    ghostAlpha = 110;

    @property({ tooltip: 'Khoảng cách khách trượt vào / ra ở bên trái (px)', group: GROUP.slide })
    slideDistance = 800;

    @property({ tooltip: 'Thời gian khách trượt vào (giây)', group: GROUP.slide })
    slideDuration = 0.5;

    @property({ tooltip: 'Thời gian khách trượt ra (giây), nhanh hơn lúc vào', group: GROUP.slide })
    exitDuration = 0.2;

    @property({ tooltip: 'Cốc nhích lên bao nhiêu px trước khi bay (liftOff)', group: GROUP.deliver })
    liftHeight = 40;

    @property({ tooltip: 'Thời gian cốc nhích lên và thẻ nền mờ đi (giây)', group: GROUP.deliver })
    liftDuration = 0.15;

    @property({ tooltip: 'Thẻ nền phóng to tới bao nhiêu lần trong lúc mờ đi', group: GROUP.deliver })
    liftCardScale = 1.35;

    @property({ tooltip: 'Độ cao cung nhảy của cốc khi giao cho khách', group: GROUP.deliver })
    jumpHeight = 150;

    @property({ tooltip: 'Độ ép dẹt khi cốc chạm đĩa (0.15 = ép 15%)', group: GROUP.deliver })
    bounceSquash = 0.15;

    @property({ tooltip: 'Thời gian cốc nhún 1 lần khi chạm đĩa (giây)', group: GROUP.deliver })
    bounceDuration = 0.28;

    @property({ tooltip: 'Cốc nhấc lên bao nhiêu px khi đủ đơn', group: GROUP.done })
    raiseY = 25;

    @property({ tooltip: 'Cốc phồng to bao nhiêu lần khi nhấc lên', group: GROUP.done })
    raiseScale = 1.15;

    @property({ tooltip: 'Thời gian cốc nhấc lên (giây)', group: GROUP.done })
    raiseDuration = 0.15;

    @property({ tooltip: 'Cốc giữ ở trên bao lâu trước khi biến mất (giây)', group: GROUP.done })
    raiseHold = 0.15;

    @property({ tooltip: 'Thời gian cốc thu nhỏ biến mất (giây)', group: GROUP.done })
    popDuration = 0.12;

    @property({ tooltip: 'Thời gian khách còn đứng sau khi đủ đơn rồi mới biến mất (giây)', group: GROUP.done })
    doneHoldDuration = 0.3;

    @property({ type: Node, tooltip: 'Chữ khen (ví dụ "Amazing") bật ra khi đủ đơn; để trống = không hiện', group: GROUP.praise })
    praiseNode: Node | null = null;

    @property({ type: [String], tooltip: 'Các chữ khen, mỗi lần đủ đơn chọn ngẫu nhiên một chữ; để trống = giữ chữ đang có trên Label', group: GROUP.praise })
    praiseTexts: string[] = ['Amazing!', 'Great!', 'Awesome!', 'Perfect!', 'Excellent!', 'Wonderful!', 'Fantastic!', 'Nice!', 'Super!', 'Yummy!'];

    @property({ tooltip: 'Thời gian chữ khen hiện (giây); khách chỉ đi ra sau khi chữ khen đã tắt', group: GROUP.praise })
    praiseDuration = 0.8;

    @property({ tooltip: 'Chữ khen xuất phát thấp hơn vị trí đặt bao nhiêu px rồi bay lên khi hiện', group: GROUP.praise })
    praiseRise = 60;

    @property({ type: Node, tooltip: 'Node đặt tim (để trống = tìm node con "heart_emoji" của Avatar)', group: GROUP.heartFx })
    heartAnchor: Node | null = null;

    @property({ type: CustomerFx, tooltip: 'Lớp hiệu ứng (lấp lánh, confetti, vệt gió); để trống = không có FX', group: GROUP.heartFx })
    fx: CustomerFx | null = null;

    @property({ type: Node, tooltip: 'Lớp vẽ avatar phía sau quầy (đặt trước Table trong UI_SlotBar). Khi chạy, Avatar được chuyển sang lớp này và bám theo khách; để trống = Avatar nằm trong Customer như cũ', group: GROUP.character })
    avatarLayer: Node | null = null;

    /** Các node cốc thật đã giao cho khách hiện tại. */
    private delivered: Node[] = [];
    /** Vị trí đứng của Avatar đặt trong scene; Avatar trượt vào tới đây và trượt ra từ đây. */
    private homePosition: Vec3 | null = null;
    /** Target của tween trượt vào / ra (xem `slide`). */
    private readonly slideState = { x: 0 };
    /** Chiều cao Avatar đặt trong scene, dùng làm chuẩn khi đổi ảnh nhân vật. */
    private avatarHeight: number | null = null;
    /** Vị trí gốc của chữ khen đặt trong scene (chữ bay lên khi mờ dần). */
    private praiseHome: Vec3 | null = null;
    /** Node bám theo Customer trong `avatarLayer`, chứa Avatar để Avatar vẽ phía sau quầy. */
    private avatarRoot: Node | null = null;
    /** Tim đang hiện của khách hiện tại (lấy từ pool PoolType.HeartEmoji). */
    private heart: PoolMember | null = null;

    onLoad(): void {
        this.homePosition = this.slideNode.position.clone();
        if (this.praiseNode) this.praiseNode.active = false;
        if (!this.heartAnchor) this.heartAnchor = this.avatar?.node.getChildByName('heart_emoji') ?? null;
        this.moveAvatarBehindCounter();
    }

    /**
     * Quầy (Table) vẽ trước các Tray nên Avatar trong Customer luôn đè lên quầy. Chuyển Avatar
     * sang `avatarLayer` (đặt trước Table) dưới một node bám theo Customer; Avatar giữ nguyên
     * vị trí cục bộ nên trượt vào / ra, tim, FX vẫn chạy như cũ.
     */
    private moveAvatarBehindCounter(): void {
        const avatar = this.avatar?.node;
        if (!this.avatarLayer || !avatar || this.avatarRoot) return;
        const root = new Node(`${this.node.parent?.name ?? this.node.name}_Avatar`);
        root.layer = this.node.layer;
        root.addComponent(UITransform);
        this.avatarLayer.addChild(root);
        this.avatarRoot = root;
        this.syncAvatarRoot();
        avatar.setParent(root, false);
        root.active = this.node.activeInHierarchy;
    }

    /** Node chứa Avatar trùng vị trí / scale world với Customer (đĩa có thể bị dời, quầy phóng to). */
    private syncAvatarRoot(): void {
        const root = this.avatarRoot;
        if (!root) return;
        root.setWorldPosition(this.node.worldPosition);
        root.setWorldScale(this.node.worldScale);
    }

    lateUpdate(): void {
        this.syncAvatarRoot();
    }

    onEnable(): void {
        if (this.avatarRoot) {
            this.avatarRoot.active = true;
            this.syncAvatarRoot();
        }
    }

    onDisable(): void {
        if (this.avatarRoot?.isValid) this.avatarRoot.active = false;
    }

    /**
     * Hiện khách mới: ảnh mờ của đơn hiện ngay trên đĩa, Avatar trượt vào từ bên trái.
     * `talk` = true: khách nói một câu (CustomerChat) ngay khi trượt vào xong.
     */
    show(avatarFrame: SpriteFrame | null, drinkFrame: SpriteFrame | null, talk = false): void {
        if (!this.homePosition) this.homePosition = this.slideNode.position.clone();
        const home = this.homePosition;
        this.node.active = true;
        this.hideHeart();
        if (this.praiseNode) this.praiseNode.active = false;
        this.sendToBack();
        const chat = this.getComponent(CustomerChat);
        chat?.stop();
        this.slide(home.x - this.slideDistance, home.x, this.slideDuration, 'quadOut', talk ? () => chat?.say() : undefined);
        this.fx?.speedLines(this.slideNode, this.slideDuration * 0.7);
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
        // Trên đĩa chỉ hiện cốc: thẻ nền mờ đi lúc cốc nhích lên (liftOff), rồi căn tâm của
        // node con "Cup" vào điểm đáp. Cốc lấy từ khay đã tắt thẻ nên liftOff chỉ nhích lên.
        const cup = tile.getChildByName('Cup');
        const offset = cup ? tile.worldPosition.clone().subtract(cup.worldPosition) : null;
        liftOff(tile, () => jumpTo(tile, slot, slot, offset, () => {
            this.snapFx(cup ?? tile);
            const ghost = this.ghosts[index];
            if (ghost) ghost.node.active = false;
            const tick = this.ticks[index];
            if (tick) {
                tick.active = true;
                tick.setSiblingIndex(this.node.children.length - 1);
            }
            // Báo đã đáp sau khi nhún xong, để animation đủ đơn không cắt ngang cú nhún của cốc cuối.
            this.bounce(tile, landed);
        }, 0.35, this.jumpHeight), this.liftHeight, this.liftDuration, this.liftCardScale);
    }

    /** FX lúc cốc snap vào điểm đáp: lóe sáng + kim tuyến theo kích thước cốc trên màn hình. */
    private snapFx(cup: Node): void {
        if (!this.fx) return;
        const box = cup.getComponent(UITransform)?.getBoundingBoxToWorld();
        if (box) this.fx.snap(new Vec3(box.center.x, box.center.y, cup.worldPosition.z), box.width, box.height);
        else this.fx.snap(cup.worldPosition, 80, 110);
    }

    /**
     * Cốc nhún 1 lần khi chạm đĩa: ép dẹt xuống, bật dài lên, rồi về dáng cũ.
     * Dời y theo tỉ lệ để đáy cốc gần như đứng yên trên đĩa.
     */
    private bounce(tile: Node, done: () => void): void {
        const s = tile.scale.clone();
        const p = tile.position.clone();
        const k = this.bounceSquash;
        const t = this.bounceDuration;
        tween(tile)
            .to(t * 0.25, { scale: new Vec3(s.x * (1 + k), s.y * (1 - k), s.z), position: new Vec3(p.x, p.y - 6, p.z) }, { easing: 'quadOut' })
            .to(t * 0.35, { scale: new Vec3(s.x * (1 - k * 0.5), s.y * (1 + k * 0.7), s.z), position: new Vec3(p.x, p.y + 10, p.z) }, { easing: 'quadOut' })
            .to(t * 0.4, { scale: s, position: p }, { easing: 'backOut' })
            .call(done)
            .start();
    }

    /**
     * Đủ đơn (giống game gốc): tim hiện ngay, cốc nhấc lên phồng to rồi biến mất tại chỗ,
     * chữ khen bật ra kèm vầng sáng + confetti, lấp lánh quanh khách; khi chữ khen tắt
     * (và ít nhất `doneHoldDuration`) thì Avatar lướt nhanh ra bên trái kèm vệt gió,
     * đi phía sau các khách khác; gọi `done` khi đã ẩn.
     */
    leave(done: () => void): void {
        this.getComponent(CustomerChat)?.stop();
        this.showHeart();
        for (const tick of this.ticks) tick.active = false;
        this.popDrinks(() => {
            this.showPraise();
            this.twinkleAroundAvatar();
            this.scheduleOnce(() => {
                const home = this.homePosition ?? this.slideNode.position;
                this.sendToBack();
                this.fx?.twinkle(this.avatarCenter(), 60, 80, 3);
                this.fx?.speedLines(this.slideNode, this.exitDuration);
                this.slide(this.slideNode.position.x, home.x - this.slideDistance, this.exitDuration, 'quadIn', () => {
                    // Tim là con của Avatar nên đã trượt ra cùng khách; giờ mới trả về pool.
                    this.hideHeart();
                    this.node.active = false;
                    done();
                });
            }, Math.max(this.doneHoldDuration, this.praiseDuration));
        });
    }

    /** Vài ngôi sao trắng nhấp nháy quanh người khách. */
    private twinkleAroundAvatar(): void {
        const ut = this.avatar?.node.getComponent(UITransform);
        const w = ut ? ut.width * 0.5 : 100;
        const h = ut ? ut.height * 0.5 : 120;
        this.fx?.twinkle(this.avatarCenter(), w, h, 6);
    }

    /** Tâm hình Avatar (world), không phụ thuộc anchor. */
    private avatarCenter(): Vec3 {
        const node = this.slideNode;
        const box = node.getComponent(UITransform)?.getBoundingBoxToWorld();
        return box ? new Vec3(box.center.x, box.center.y, node.worldPosition.z) : node.worldPosition.clone();
    }

    /**
     * Đưa cả cụm khách (Tray chứa Customer) xuống dưới cùng trong UI_Orders để Avatar
     * đang lướt đi phía sau các khách khác như game gốc.
     */
    private sendToBack(): void {
        this.node.parent?.setSiblingIndex(0);
        this.avatarRoot?.setSiblingIndex(0);
    }

    /** Các cốc đã giao nhấc lên và phồng to, giữ một chút rồi thu nhỏ về 0 tại chỗ và bị hủy. */
    private popDrinks(done: () => void): void {
        const drinks = this.delivered.filter(n => n.isValid);
        this.delivered = [];
        if (!drinks.length) {
            done();
            return;
        }
        let remaining = drinks.length;
        for (const drink of drinks) {
            Tween.stopAllByTarget(drink);
            const base = drink.scale.clone();
            const up = drink.position.clone();
            up.y += this.raiseY;
            const big = new Vec3(base.x * this.raiseScale, base.y * this.raiseScale, base.z);
            tween(drink)
                .to(this.raiseDuration, { position: up, scale: big }, { easing: 'backOut' })
                .delay(this.raiseHold)
                .to(this.popDuration, { scale: new Vec3(0, 0, base.z) }, { easing: 'backIn' })
                .call(() => {
                    if (drink.isValid) this.fx?.landSparkle((drink.getChildByName('Cup') ?? drink).worldPosition);
                    if (drink.isValid) drink.destroy();
                    if (--remaining === 0) done();
                })
                .start();
        }
    }

    /**
     * Chữ khen vừa bay lên từ dưới (`praiseRise`) vừa bật to rồi về cỡ thường (kèm vầng sáng
     * phía sau và confetti), phồng nhẹ, cuối cùng bay tiếp lên và mờ dần; tự ẩn sau `praiseDuration` giây.
     */
    private showPraise(): void {
        const praise = this.praiseNode;
        if (!praise) return;
        Tween.stopAllByTarget(praise);
        const op = praise.getComponent(UIOpacity) ?? praise.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        if (!this.praiseHome) this.praiseHome = praise.position.clone();
        const home = this.praiseHome;
        const label = praise.getComponent(Label);
        if (label && this.praiseTexts.length > 0) {
            label.string = this.praiseTexts[Math.floor(Math.random() * this.praiseTexts.length)];
        }
        praise.active = true;
        // Vầng sáng + confetti đặt ở vị trí đích; chữ xuất phát thấp hơn rồi bay lên tới đó.
        praise.setPosition(home);
        this.fx?.celebrate(praise.worldPosition, praise);
        praise.setPosition(home.x, home.y - this.praiseRise, home.z);
        praise.setScale(0, 0, 1);
        op.opacity = 255;
        const fade = 0.25;
        const hold = Math.max(0, this.praiseDuration - 0.25 - fade);
        tween(praise)
            .to(0.15, { scale: new Vec3(1.25, 1.25, 1), position: new Vec3(home.x, home.y + 8, home.z) }, { easing: 'quadOut' })
            .to(0.1, { scale: Vec3.ONE, position: home }, { easing: 'sineOut' })
            .to(hold, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
            .to(fade, { position: new Vec3(home.x, home.y + 25, home.z) }, { easing: 'sineOut' })
            .call(() => {
                praise.active = false;
                praise.setPosition(home);
                op.opacity = 255;
            })
            .start();
        tween(op).delay(0.25 + hold).to(fade, { opacity: 0 }).start();
    }

    /**
     * Lấy tim từ pool (PoolControl), gắn vào `heartAnchor` (con của Avatar) để đi theo khách khi trượt ra.
     * Tim được giữ tới khi khách trượt ra xong (`leave`) rồi mới trả về pool.
     */
    private showHeart(): void {
        const pool = World.ins.poolManager;
        if (!pool || !this.heartAnchor) return;
        this.hideHeart();
        const heart = pool.spawn(PoolType.HeartEmoji);
        heart.node.setParent(this.heartAnchor);
        heart.node.setPosition(Vec3.ZERO);
        // Node lấy lại từ pool không tự chạy lại playOnLoad nên phát anim thủ công.
        heart.getComponent(Animation)?.play();
        this.heart = heart;
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

    /** Node trượt vào / ra: chỉ Avatar (đĩa và cốc đứng yên); không có Avatar thì cả khách. */
    private get slideNode(): Node {
        return this.avatar?.node ?? this.node;
    }

    /**
     * Trượt `slideNode` theo trục x. Tween chạy trên `slideState` chứ không phải trên node,
     * vì tween gắn vào Node bị dừng theo trạng thái active của node: `leave` tắt node rồi
     * `show` bật lại ngay trong callback, khiến tween trượt vào bị kẹt ở vị trí xuất phát.
     */
    private slide(fromX: number, toX: number, duration: number, easing: 'linear' | 'quadIn' | 'quadOut', done?: () => void): void {
        Tween.stopAllByTarget(this.slideState);
        const target = this.slideNode;
        const p = target.position;
        target.setPosition(fromX, p.y, p.z);
        this.slideState.x = fromX;
        tween(this.slideState)
            .to(duration, { x: toX }, {
                easing,
                onUpdate: () => {
                    if (!target.isValid) return;
                    const cur = target.position;
                    target.setPosition(this.slideState.x, cur.y, cur.z);
                },
            })
            .call(() => done?.())
            .start();
    }

    onDestroy(): void {
        Tween.stopAllByTarget(this.slideState);
        if (this.avatarRoot?.isValid) this.avatarRoot.destroy();
    }
}
