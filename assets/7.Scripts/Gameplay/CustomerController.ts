import { _decorator, Animation, CCObject, Color, Component, Label, Node, Sprite, SpriteFrame, Tween, UIOpacity, UITransform, Vec2, Vec3, tween } from 'cc';
import { World } from '../Manager/World';
import { PoolMember, PoolType } from '../Pool/PoolMember';
import { CustomerChat } from './CustomerChat';
import { CustomerFx } from './CustomerFx';
import { jumpTo, liftOff } from './TileJump';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
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
    angry: { id: 'angry', name: 'Nổi nóng', displayOrder: 7, style: 'section' },
};

/** Biểu cảm của khách. */
export enum Expression {
    Normal,
    Happy,
    Angry,
}

/** Một ảnh mặt và chỗ đặt nó trên ảnh thân (đơn vị: pixel của ảnh thân, so với tâm thân, y hướng lên). */
@ccclass('FaceSetting')
export class FaceSetting {
    @property({ type: SpriteFrame, tooltip: 'Ảnh mặt' })
    frame: SpriteFrame | null = null;

    @property({ tooltip: 'Vị trí tâm mặt so với tâm ảnh thân (pixel ảnh thân, y hướng lên)' })
    offset = new Vec2();

    @property({ tooltip: 'Tỉ lệ ảnh mặt so với ảnh thân (1 = đúng cỡ pixel)' })
    scale = 1;
}

/** Một nhân vật khách: ảnh thân (không mặt) + 3 mặt đặt chồng lên. Chỉnh trong CustomerLookLibrary. */
@ccclass('CustomerLook')
export class CustomerLook {
    @property({ tooltip: 'Tên để dễ nhận (không dùng trong code)' })
    name = '';

    @property({ type: SpriteFrame, tooltip: 'Ảnh thân, không có mặt' })
    body: SpriteFrame | null = null;

    @property({ type: FaceSetting, tooltip: 'Mặt bình thường (lúc chờ)' })
    normal = new FaceSetting();

    @property({ type: FaceSetting, tooltip: 'Mặt vui (khi đủ đơn, rời đi)' })
    happy = new FaceSetting();

    @property({ type: FaceSetting, tooltip: 'Mặt giận (sắp hết giờ / bỏ đi)' })
    angry = new FaceSetting();

    face(expression: Expression): FaceSetting {
        return expression === Expression.Happy ? this.happy : expression === Expression.Angry ? this.angry : this.normal;
    }
}

/** Số đơn vị node ứng với 1 pixel ảnh thân, khi Avatar đang hiện ảnh thân `body`. */
export function faceUnit(avatar: Node, body: SpriteFrame): number {
    const h = avatar.getComponent(UITransform)?.height ?? 0;
    return body.rect.height ? h / body.rect.height : 1;
}

/** Đặt node mặt `face` (con của Avatar) theo `setting`: ảnh, cỡ và vị trí đổi từ pixel ảnh thân. */
export function layoutFace(avatar: Node, body: SpriteFrame, face: Node, setting: FaceSetting): void {
    const frame = setting.frame;
    if (!frame) return;
    const k = faceUnit(avatar, body);
    const sprite = face.getComponent(Sprite);
    if (sprite && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
    face.getComponent(UITransform)?.setContentSize(frame.rect.width * setting.scale * k, frame.rect.height * setting.scale * k);
    face.setPosition(setting.offset.x * k, setting.offset.y * k, 0);
    face.setScale(1, 1, 1);
}

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

    @property({ type: Node, tooltip: 'Icon giận hiện trên đầu khách khi bỏ đi; để trống = tự tạo chữ 💢', group: GROUP.angry })
    angryIcon: Node | null = null;

    @property({ tooltip: 'Khách giận rung người bao lâu trước khi bỏ đi (giây)', group: GROUP.angry })
    angryShakeDuration = 0.45;

    @property({ type: Node, tooltip: 'Lớp vẽ avatar phía sau quầy (đặt trước Table trong UI_SlotBar). Khi chạy, Avatar được chuyển sang lớp này và bám theo khách; để trống = Avatar nằm trong Customer như cũ', group: GROUP.character })
    avatarLayer: Node | null = null;

    /** Nhân vật của khách hiện tại (null = chỉ có 1 ảnh avatar, giận thì tô đỏ). */
    private look: CustomerLook | null = null;
    /** Biểu cảm đang hiện của `look`. */
    private expression = Expression.Normal;
    /** Node mặt (con của Avatar), tạo khi cần. */
    private faceNode: Node | null = null;
    /** Ảnh đang hiện trên Avatar, để không gán lại cùng một ảnh mỗi frame. */
    private shownFrame: SpriteFrame | null = null;
    /** Các node cốc thật đã giao cho khách hiện tại. */
    private delivered: Node[] = [];
    /** Vị trí đứng của Avatar đặt trong scene; Avatar trượt vào tới đây và trượt ra từ đây. */
    private homePosition: Vec3 | null = null;
    /** Target của tween trượt vào / ra (xem `slide`). */
    private readonly slideState = { x: 0 };
    /** Target tween rung người khi giận (cùng lý do với slideState: không gắn vào node). */
    private readonly shakeState = { t: 0 };
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
     * `arrived`: gọi khi khách đã đứng vào chỗ (trượt vào xong; `instant` thì gọi ngay).
     * `look`: nhân vật có biểu cảm (thân + mặt); có thì `avatarFrame` bị bỏ qua.
     */
    show(avatarFrame: SpriteFrame | null, drinkFrame: SpriteFrame | null, talk = false, instant = false, arrived?: () => void, look: CustomerLook | null = null): void {
        this.look = look?.body ? look : null;
        this.expression = Expression.Normal;
        if (!this.homePosition) this.homePosition = this.slideNode.position.clone();
        const home = this.homePosition;
        this.node.active = true;
        this.hideHeart();
        Tween.stopAllByTarget(this.shakeState);
        this.setAnger(0);
        this.hideAngryIcon();
        if (this.praiseNode) this.praiseNode.active = false;
        this.sendToBack();
        const chat = this.getComponent(CustomerChat);
        chat?.stop();
        if (instant) {
            // Khách đứng sẵn ở quầy (tutorial / lượt khách đầu màn): không trượt vào, không tiếng cửa.
            Tween.stopAllByTarget(this.slideState);
            const p = this.slideNode.position;
            this.slideNode.setPosition(home.x, p.y, p.z);
            if (talk) chat?.say();
        } else {
            this.slide(home.x - this.slideDistance, home.x, this.slideDuration, 'quadOut', () => {
                if (talk) chat?.say();
                arrived?.();
            });
            Ply_SoundManager.Ins?.playFxOneShot(FxType.DoorOpen, 0.6);
            this.fx?.speedLines(this.slideNode, this.slideDuration * 0.7);
        }
        if (this.look) this.applyLook(this.look, Expression.Normal);
        else {
            if (avatarFrame) this.setAvatarFrame(avatarFrame);
            const face = this.getFaceNode(false);
            if (face) face.active = false;
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
        if (instant) arrived?.();
    }

    /**
     * Cho cốc thật nhảy tới điểm đáp thứ `index`; gọi `landed` khi đáp xong.
     * `matchScale` = true: cốc to / nhỏ dần trong lúc bay cho bằng cỡ trên đĩa; false = giữ cỡ (cốc mẫu tutorial).
     */
    receive(tile: Node, index: number, landed: () => void, matchScale = true): void {
        const slot = this.cupSlots[index];
        this.delivered.push(tile);
        // Trên đĩa chỉ hiện cốc: thẻ nền mờ đi lúc cốc nhích lên (liftOff), rồi căn tâm của
        // node con "Cup" vào điểm đáp. Cốc lấy từ khay đã tắt thẻ nên liftOff chỉ nhích lên.
        const cup = tile.getChildByName('Cup');
        const offset = cup ? tile.worldPosition.clone().subtract(cup.worldPosition) : null;
        liftOff(tile, () => jumpTo(tile, slot, slot, offset, () => {
            this.snapFx(cup ?? tile);
            Ply_SoundManager.Ins?.playFxOneShot(FxType.StarToTable);
            const ghost = this.ghosts[index];
            if (ghost) ghost.node.active = false;
            const tick = this.ticks[index];
            if (tick) {
                tick.active = true;
                tick.setSiblingIndex(this.node.children.length - 1);
            }
            // Báo đã đáp sau khi nhún xong, để animation đủ đơn không cắt ngang cú nhún của cốc cuối.
            this.bounce(tile, landed);
        }, 0.35, this.jumpHeight, matchScale, this.ghostRatio(index, cup)), this.liftHeight, this.liftDuration, this.liftCardScale);
    }

    /** Cốc trên đĩa cao bằng ảnh Ghost: tỉ lệ chiều cao Ghost / chiều cao cốc (cùng hệ scale 1). */
    private ghostRatio(index: number, cup: Node | null): number {
        const ghost = this.ghosts[index]?.node;
        const gh = ghost?.getComponent(UITransform)?.height ?? 0;
        const ch = cup?.getComponent(UITransform)?.height ?? 0;
        return ghost && cup && gh && ch ? (gh * ghost.scale.y) / (ch * cup.scale.y) : 1;
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
        Ply_SoundManager.Ins?.playFxOneShot(FxType.CustomerDone);
        this.setExpression(Expression.Happy);
        this.showHeart();
        for (const tick of this.ticks) tick.active = false;
        this.popDrinks(() => {
            this.showPraise();
            Ply_SoundManager.Ins?.playFxOneShot(FxType.CollectCombo);
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

    /** Mức giận `t` (0 = bình thường, > 0 = đồng hồ đã vào vùng cảnh báo): đổi sang mặt giận / về mặt thường. */
    setAnger(t: number): void {
        if (this.look?.angry.frame) this.setExpression(t > 0 ? Expression.Angry : Expression.Normal);
    }

    /** Đổi biểu cảm của nhân vật hiện tại (bỏ qua nếu đang đúng biểu cảm đó hoặc không có `look`). */
    private setExpression(expression: Expression): void {
        if (!this.look || expression === this.expression) return;
        this.expression = expression;
        this.applyLook(this.look, expression);
    }

    /**
     * Hiện nhân vật `look` với biểu cảm `expression`: ảnh thân lên Avatar, ảnh mặt lên node Face.
     * `dontSave` = node Face tạo trong editor để xem trước, không lưu vào scene.
     */
    applyLook(look: CustomerLook, expression: Expression, dontSave = false): void {
        const avatar = this.avatar?.node;
        if (!avatar || !look.body) return;
        this.setAvatarFrame(look.body);
        const setting = look.face(expression);
        const face = this.getFaceNode(true, dontSave);
        if (!face) return;
        face.active = !!setting.frame;
        layoutFace(avatar, look.body, face, setting);
    }

    /** Node mặt: con của Avatar, vẽ ngay trên ảnh thân, dưới tim / icon giận. */
    getFaceNode(create: boolean, dontSave = false): Node | null {
        const avatar = this.avatar?.node;
        if (!avatar) return null;
        if (this.faceNode?.isValid && this.faceNode.parent === avatar) return this.faceNode;
        this.faceNode = avatar.getChildByName('Face');
        if (!this.faceNode && create) {
            const n = new Node('Face');
            n.layer = avatar.layer;
            if (dontSave) n.hideFlags |= CCObject.Flags.DontSave;
            n.addComponent(UITransform);
            n.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
            avatar.addChild(n);
            n.setSiblingIndex(0);
            this.faceNode = n;
        }
        return this.faceNode;
    }

    /** Đổi ảnh Avatar (bỏ qua nếu đang hiện đúng ảnh đó), giữ chiều cao chuẩn. */
    private setAvatarFrame(frame: SpriteFrame): void {
        if (!this.avatar || (this.shownFrame === frame && this.avatar.spriteFrame === frame)) return;
        this.avatar.spriteFrame = frame;
        this.shownFrame = frame;
        this.fitAvatar(frame);
    }

    /**
     * Hết giờ: khách đỏ mặt, hiện icon giận, rung người rồi trượt ra (không tim, không chữ khen);
     * gọi `done` khi đã ra khỏi màn. Đĩa và các cốc đã giao giữ nguyên trên quầy để khách sau
     * nhận tiếp cùng đơn (xem OrderManager), nên node Customer không bị tắt.
     */
    angryLeave(done: () => void): void {
        this.getComponent(CustomerChat)?.stop();
        this.setAnger(1);
        this.showAngryIcon();
        Tween.stopAllByTarget(this.slideState);
        const node = this.slideNode;
        const home = this.homePosition ?? node.position;
        const baseX = node.position.x;
        const shake = this.shakeState;
        Tween.stopAllByTarget(shake);
        shake.t = 0;
        tween(shake)
            .to(this.angryShakeDuration, { t: 1 }, {
                onUpdate: () => {
                    if (!node.isValid) return;
                    const p = node.position;
                    node.setPosition(baseX + Math.sin(shake.t * Math.PI * 10) * 12 * (1 - shake.t * 0.5), p.y, p.z);
                },
            })
            .call(() => {
                this.sendToBack();
                Ply_SoundManager.Ins?.playFxOneShot(FxType.DoorOpen, 0.6);
                this.slide(baseX, home.x - this.slideDistance, this.exitDuration * 1.5, 'quadIn', () => {
                    this.hideAngryIcon();
                    this.setAnger(0);
                    done();
                });
            })
            .start();
    }

    /**
     * Sau `show()` cho khách thay thế nhận tiếp đơn dở: các cốc đã giao / đang bay tới (`reserved`)
     * không hiện ảnh mờ, cốc đã đáp (`landed`) có dấu tick.
     */
    restoreProgress(reserved: number, landed: number): void {
        this.ghosts.forEach((g, i) => (g.node.active = i >= reserved));
        this.ticks.forEach((t, i) => (t.active = i < landed));
    }

    private showAngryIcon(): void {
        const avatar = this.avatar?.node;
        if (!avatar) return;
        let icon = this.angryIcon;
        if (!icon) {
            icon = new Node('AngryIcon');
            icon.layer = avatar.layer;
            icon.addComponent(UITransform);
            const label = icon.addComponent(Label);
            label.string = '💢';
            label.fontSize = 64;
            label.lineHeight = 70;
            const h = avatar.getComponent(UITransform)?.height ?? 200;
            avatar.addChild(icon);
            icon.setPosition(h * 0.25, h * 0.4, 0);
            this.angryIcon = icon;
        }
        icon.active = true;
        Tween.stopAllByTarget(icon);
        icon.setScale(0, 0, 1);
        tween(icon).to(0.2, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' }).to(0.1, { scale: Vec3.ONE }).start();
    }

    private hideAngryIcon(): void {
        if (this.angryIcon?.isValid) this.angryIcon.active = false;
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
    fitAvatar(frame: SpriteFrame): void {
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
        Tween.stopAllByTarget(this.shakeState);
        if (this.avatarRoot?.isValid) this.avatarRoot.destroy();
    }
}
