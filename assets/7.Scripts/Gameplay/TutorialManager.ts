import { _decorator, Animation, BlockInputEvents, Color, Component, Graphics, Label, Node, RichText, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { DrinkTile } from '../MapTool/DrinkTile';
import { LevelMapBuilder } from '../MapTool/LevelMapBuilder';
import { ui } from '../Manager/UI';
import { CustomerController } from './CustomerController';
import { OrderManager } from './OrderManager';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    refs: { id: 'refs', name: 'Tham chiếu', displayOrder: 0, style: 'section' },
    guide: { id: 'guide', name: 'Thuyền trưởng', displayOrder: 1, style: 'section' },
    play: { id: 'play', name: 'Lượt chơi mẫu', displayOrder: 2, style: 'section' },
};

/**
 * Tutorial đầu game:
 * 1. Bàn trống, một vị khách đứng sẵn ở quầy (khách đứng giữa).
 * 2. Thuyền trưởng trượt vào ở góc dưới, bong bóng thoại hiện chữ dần:
 *    câu 1 → "Tap to continue" → câu 2.
 * 3. Đơn của khách hiện trên đĩa, bàn chỉ có 3 cốc đúng loại; bàn tay chỉ vào từng cốc,
 *    người chơi bấm để giao (dùng chung animation giao cốc / đủ đơn của CustomerController).
 * 4. Đủ đơn: câu 3 → "Tap to continue" → thuyền trưởng rời đi, bàn thật hiện ra và
 *    OrderManager.startLevel() bắt đầu màn chơi.
 *
 * Cấu trúc node:
 * Tutorial (TutorialManager)
 * ├── TutorialBoard   (chứa 3 cốc mẫu)
 * ├── Blocker         (chặn chạm toàn màn hình lúc thoại; chạm = qua câu / hiện hết chữ)
 * └── Guide           (thuyền trưởng, góc dưới)
 *     ├── Captain
 *     ├── Bubble      (Sprite bubble_chat; nếu dùng Graphics thì vẽ khung bằng code)
 *     │   └── Text    (RichText hoặc Label)
 *     └── TapHint     ("Tap to continue", hiện tĩnh, nằm ngoài khung thoại)
 */
@ccclass('TutorialManager')
export class TutorialManager extends Component {
    @property({ tooltip: 'Bật tutorial khi vào màn. Tắt = vào thẳng màn chơi' })
    playTutorial = true;

    @property({ type: OrderManager, group: GROUP.refs })
    orderManager: OrderManager | null = null;

    @property({ type: LevelMapBuilder, tooltip: 'Tạo cốc mẫu giống cốc thật (createTile) và lấy sprite đồ uống', group: GROUP.refs })
    mapBuilder: LevelMapBuilder | null = null;

    @property({ type: Node, tooltip: 'Bàn cốc thật, ẩn trong lúc tutorial', group: GROUP.refs })
    board: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa 3 cốc mẫu', group: GROUP.refs })
    tileRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Lớp chặn chạm toàn màn hình (BlockInputEvents) trong lúc thoại', group: GROUP.refs })
    blocker: Node | null = null;

    @property({ type: Node, tooltip: 'Bàn tay chỉ (Tut/Hand)', group: GROUP.refs })
    hand: Node | null = null;

    @property({ type: Node, tooltip: 'Gốc thuyền trưởng (trượt vào / ra)', group: GROUP.guide })
    guide: Node | null = null;

    @property({ type: Node, tooltip: 'Khung thoại; nếu có Graphics thì tự vẽ khung bo góc', group: GROUP.guide })
    bubble: Node | null = null;

    @property({ type: Label, tooltip: 'Chữ trong khung thoại (Label thường; dùng RichText thì để trống ô này)', group: GROUP.guide })
    textLabel: Label | null = null;

    @property({ type: RichText, tooltip: 'Chữ trong khung thoại dạng RichText: câu thoại được dùng thẻ <color=#..>..</color>', group: GROUP.guide })
    richText: RichText | null = null;

    @property({ type: Color, tooltip: 'Màu chữ nổi bật trong câu thoại: phần chữ đặt trong <hl>...</hl> (ví dụ tên game). Màu chữ thường chỉnh ở Font Color của RichText', group: GROUP.guide })
    highlightColor = new Color(92, 196, 240, 255);

    @property({ type: Node, tooltip: '"Tap to continue"', group: GROUP.guide })
    tapHint: Node | null = null;

    @property({ type: [String], tooltip: 'Câu 1, câu 2 (trước lượt chơi), câu 3 (sau khi đủ đơn)', group: GROUP.guide })
    lines: string[] = [
        'Welcome to\n<hl>Cozy Drink Match</hl>!\nLet’s serve our first customer.',
        'Check their order and pick the right drinks',
        'Great job! Ready for the next order?',
    ];

    @property({ tooltip: 'Tốc độ hiện chữ (ký tự / giây)', group: GROUP.guide })
    charsPerSecond = 40;

    @property({ tooltip: 'Thuyền trưởng trượt vào từ bên trái bao nhiêu px', group: GROUP.guide })
    guideSlide = 600;

    @property({ tooltip: 'Thời gian thuyền trưởng trượt vào / ra (giây)', group: GROUP.guide })
    guideSlideDuration = 0.35;

    @property({ type: SpriteFrame, tooltip: 'Avatar vị khách đầu tiên', group: GROUP.play })
    customerAvatar: SpriteFrame | null = null;

    @property({ tooltip: 'Loại đồ uống của đơn mẫu (index trong drinkFrames)', group: GROUP.play })
    drinkId = 0;

    @property({ tooltip: 'Khoảng cách giữa 3 cốc mẫu (px)', group: GROUP.play })
    tileSpacing = 410;

    @property({ tooltip: 'Cốc mẫu to hơn cốc thật bao nhiêu lần; giữ nguyên cỡ này khi bay và đáp lên đĩa', group: GROUP.play })
    tileScale = 1.5;

    @property({ type: Node, tooltip: 'Cụm quầy (khách + đĩa + khay chờ) phóng to trong lúc tutorial, ví dụ UI_SlotBar', group: GROUP.play })
    focusRoot: Node | null = null;

    @property({ tooltip: 'Cụm quầy to hơn bao nhiêu lần trong lúc tutorial (chỉ hiện 1 đĩa ở giữa)', group: GROUP.play })
    focusScale = 1.3;

    @property({ type: [Node], tooltip: 'Các ô khay chờ hiện trong lúc tutorial (ví dụ Slot_0..2); các ô cùng cha còn lại bị ẩn. Để trống = giữ nguyên khay', group: GROUP.play })
    tutorialSlots: Node[] = [];

    @property({ tooltip: 'Khoảng cách giữa các ô khay chờ trong lúc tutorial (px), căn giữa', group: GROUP.play })
    tutorialSlotSpacing = 170;

    private customer: CustomerController | null = null;
    /** Trạng thái gốc để trả lại khi tutorial xong: scale cụm quầy, vị trí đĩa tutorial, các đĩa bị ẩn. */
    private focusBaseScale: Vec3 | null = null;
    private trayBasePos: Vec3 | null = null;
    private hiddenTrays: Node[] = [];
    /** Vị trí gốc của các ô khay chờ dùng trong tutorial, và các ô bị ẩn, để trả lại khi xong. */
    private slotBasePos = new Map<Node, Vec3>();
    private hiddenSlots: Node[] = [];
    private tiles: DrinkTile[] = [];
    private used = new Set<DrinkTile>();
    private landed = 0;
    private guideHome: Vec3 | null = null;
    /** Câu đang hiện dần; `done` gọi đúng một lần khi đã hiện hết chữ. */
    private typing: { text: string; shown: number; done: () => void } | null = null;
    /** Việc làm tiếp khi người chơi chạm "Tap to continue". */
    private onTap: (() => void) | null = null;

    onLoad(): void {
        if (this.guide) {
            this.guideHome = this.guide.position.clone();
            this.guide.active = false;
        }
        if (this.blocker) {
            this.blocker.active = false;
            this.blocker.getComponent(BlockInputEvents) ?? this.blocker.addComponent(BlockInputEvents);
            this.blocker.on(Node.EventType.TOUCH_END, this.onBlockerTap, this);
        }
        if (this.hand) this.hand.active = false;
        if (this.tapHint) this.tapHint.active = false;
        this.drawBubble();
        if (!this.playTutorial) return;
        // onLoad của mọi node chạy trước start, nên OrderManager sẽ không tự bắt đầu màn.
        if (this.orderManager) this.orderManager.autoStart = false;
    }

    start(): void {
        if (!this.playTutorial) return;
        // Logo / nút tải (UI.fisrtOn) chỉ hiện khi tutorial xong, không hiện ở lần chạm đầu.
        if (ui) ui.deferFirstOn = true;
        // Chờ một frame để DrinkItemManager quét xong bàn và CustomerController lưu vị trí đứng.
        this.scheduleOnce(() => this.begin(), 0);
    }

    update(dt: number): void {
        const t = this.typing;
        if (!t) return;
        const total = visibleLength(t.text);
        t.shown = Math.min(total, t.shown + dt * this.charsPerSecond);
        this.setText(revealRich(t.text, Math.floor(t.shown)));
        if (t.shown >= total) this.finishTyping();
    }

    /** Bước 1: ẩn bàn thật, một vị khách đứng sẵn ở quầy (chưa hiện đơn). */
    private begin(): void {
        this.setBoardVisible(false, 0);
        const all = this.node.scene.getComponentsInChildren(CustomerController);
        for (const c of all) c.node.active = false;
        this.customer = this.middle(all);
        if (!this.customer) return this.finish();
        this.focusOn(this.customer, all);
        const frame = this.mapBuilder?.drinkFrames[this.drinkId] ?? null;
        // Khách tutorial đứng sẵn ở quầy, không trượt vào.
        this.customer.show(this.customerAvatar, frame, false, true);
        for (const g of this.customer.ghosts) g.node.active = false;
        this.scheduleOnce(() => this.showGuide(), 0.3);
    }

    /** Bước 2: thuyền trưởng trượt vào, nói câu 1 → chạm → câu 2 → vào lượt chơi mẫu. */
    private showGuide(): void {
        const guide = this.guide;
        if (!guide || !this.guideHome) return this.startPlay();
        const home = this.guideHome;
        guide.active = true;
        if (this.bubble) this.bubble.active = false;
        guide.setPosition(home.x - this.guideSlide, home.y, home.z);
        tween(guide)
            .to(this.guideSlideDuration, { position: home }, { easing: 'backOut' })
            .call(() => this.say(0, () => this.waitTap(() => this.say(1, () => this.startPlay()))))
            .start();
    }

    /** Bước 3: hiện đơn trên đĩa, bày 3 cốc mẫu, bàn tay chỉ vào cốc đầu tiên. */
    private startPlay(): void {
        if (this.blocker) this.blocker.active = false;
        const customer = this.customer!;
        customer.ghosts.forEach((g, i) => {
            g.node.active = true;
            g.node.setScale(0, 0, 1);
            tween(g.node).delay(i * 0.08).to(0.25, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
        });
        this.spawnTiles();
        this.scheduleOnce(() => this.showHand(), 0.5);
    }

    private spawnTiles(): void {
        const builder = this.mapBuilder;
        const root = this.tileRoot;
        if (!builder || !root) return;
        root.removeAllChildren();
        this.tiles = [];
        this.used.clear();
        this.landed = 0;
        for (let i = 0; i < 3; i++) {
            const node = builder.createTile(root, this.drinkId, `TutTile_${i}`);
            const tile = node.getComponent(DrinkTile) ?? node.addComponent(DrinkTile);
            tile.drinkId = this.drinkId;
            node.setPosition((i - 1) * this.tileSpacing, 0, 0);
            node.setScale(0, 0, 1);
            const s = this.tileScale;
            tween(node).delay(i * 0.1).to(0.3, { scale: new Vec3(s, s, 1) }, { easing: 'backOut' }).start();
            node.on(Node.EventType.TOUCH_END, () => this.onTileTap(tile), this);
            this.tiles.push(tile);
        }
    }

    private onTileTap(tile: DrinkTile): void {
        if (this.used.has(tile) || !this.customer) return;
        this.used.add(tile);
        Ply_SoundManager.Ins?.playFxOneShot(FxType.TapTile);
        tile.node.off(Node.EventType.TOUCH_END);
        Tween.stopAllByTarget(tile.node);
        // Giữ nguyên cỡ khi bay và đáp lên đĩa (quầy đang phóng to nên cốc vừa với cốc mẫu);
        // bấm lúc cốc còn đang bật lên thì đặt luôn về đủ cỡ.
        tile.node.setScale(this.tileScale, this.tileScale, 1);
        this.hideHand();
        const index = this.used.size - 1;
        this.customer.receive(tile.node, index, () => {
            if (++this.landed === this.tiles.length) this.complete();
        }, false);
        if (this.used.size < this.tiles.length) this.scheduleOnce(() => this.showHand(), 0.45);
    }

    /** Bước 4: đủ đơn → khách vui rồi đi, thuyền trưởng nói câu 3; cả hai xong mới cho chạm để vào game. */
    private complete(): void {
        let typed = false;
        let left = false;
        const next = (): void => {
            if (typed && left) this.waitTap(() => this.finish());
        };
        this.customer?.leave(() => {
            left = true;
            next();
        });
        this.say(2, () => {
            typed = true;
            next();
        });
    }

    /** Kết thúc: thuyền trưởng rời đi, bàn thật hiện ra, bắt đầu màn chơi. */
    private finish(): void {
        if (this.blocker) this.blocker.active = false;
        this.hideHand();
        const guide = this.guide;
        if (guide?.active && this.guideHome) {
            const home = this.guideHome;
            tween(guide)
                .to(this.guideSlideDuration, { position: new Vec3(home.x - this.guideSlide, home.y, home.z) }, { easing: 'backIn' })
                .call(() => {
                    guide.active = false;
                    guide.setPosition(home);
                })
                .start();
        }
        this.tileRoot?.removeAllChildren();
        this.unfocus();
        this.setBoardVisible(true, 0.3);
        this.orderManager?.startLevel();
        ui?.showFirstOn();
    }

    /** Hiện câu `index` trong khung thoại, chữ hiện dần; `done` khi đã hiện hết. */
    private say(index: number, done: () => void): void {
        const text = this.applyHighlight(this.lines[index] ?? '');
        if (this.blocker) this.blocker.active = true;
        const bubble = this.bubble;
        if (bubble && !bubble.active) {
            bubble.active = true;
            bubble.setScale(0, 0, 1);
            tween(bubble).to(0.2, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
        }
        this.setText('');
        this.typing = { text, shown: 0, done };
    }

    private finishTyping(): void {
        const t = this.typing;
        if (!t) return;
        this.typing = null;
        this.setText(t.text);
        t.done();
    }

    /** Hiện "Tap to continue"; chạm thì chạy `next`. */
    private waitTap(next: () => void): void {
        if (this.blocker) this.blocker.active = true;
        this.onTap = next;
        const hint = this.tapHint;
        if (!hint) return;
        // Hiện tĩnh, không nhấp nháy.
        hint.active = true;
        const op = hint.getComponent(UIOpacity);
        if (op) {
            Tween.stopAllByTarget(op);
            op.opacity = 255;
        }
    }

    /** Chạm lúc chữ đang hiện → hiện hết ngay; chạm lúc đang chờ → qua bước tiếp. */
    private onBlockerTap(): void {
        // Lớp chặn giữ lại chạm nên InputManager chưa bật nhạc: bật ở chạm đầu tiên trong tutorial.
        Ply_SoundManager.Ins?.playBGM();
        if (this.typing) return this.finishTyping();
        const next = this.onTap;
        if (!next) return;
        this.onTap = null;
        if (this.tapHint) {
            const op = this.tapHint.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            this.tapHint.active = false;
        }
        next();
    }

    private showHand(): void {
        const hand = this.hand;
        const tile = this.tiles.find(t => !this.used.has(t));
        if (!hand || !tile) return;
        hand.active = true;
        hand.setWorldPosition(tile.node.worldPosition);
        hand.getComponent(Animation)?.play();
    }

    private hideHand(): void {
        if (this.hand) this.hand.active = false;
    }

    /** Tutorial chỉ dùng 1 đĩa: ẩn các đĩa khác, đưa đĩa của khách ra giữa và phóng to cả cụm quầy. */
    private focusOn(customer: CustomerController, all: CustomerController[]): void {
        const tray = customer.node.parent;
        if (tray) {
            this.trayBasePos = tray.position.clone();
            tray.setPosition(0, this.trayBasePos.y, this.trayBasePos.z);
        }
        this.hiddenTrays = all.map(c => c.node.parent).filter((t): t is Node => !!t && t !== tray && t.active);
        for (const t of this.hiddenTrays) t.active = false;
        this.focusSlots();
        const root = this.focusRoot;
        if (root) {
            this.focusBaseScale = root.scale.clone();
            const s = this.focusScale;
            root.setScale(this.focusBaseScale.x * s, this.focusBaseScale.y * s, this.focusBaseScale.z);
        }
    }

    /** Trả cụm quầy về cỡ cũ, đĩa về chỗ, hiện lại các đĩa cho màn chơi thật. */
    private unfocus(): void {
        const tray = this.customer?.node.parent;
        if (tray && this.trayBasePos) tray.setPosition(this.trayBasePos);
        for (const t of this.hiddenTrays) t.active = true;
        this.hiddenTrays = [];
        this.unfocusSlots();
        const root = this.focusRoot;
        if (root && this.focusBaseScale) {
            Tween.stopAllByTarget(root);
            tween(root).to(0.3, { scale: this.focusBaseScale }, { easing: 'sineOut' }).start();
        }
    }

    /** Khay chờ trong tutorial: chỉ hiện `tutorialSlots`, căn giữa và giãn theo `tutorialSlotSpacing`. */
    private focusSlots(): void {
        const slots = this.tutorialSlots.filter(n => n?.isValid);
        const parent = slots[0]?.parent;
        if (!parent) return;
        this.hiddenSlots = parent.children.filter(c => c.active && !slots.includes(c));
        for (const c of this.hiddenSlots) c.active = false;
        slots.forEach((slot, i) => {
            this.slotBasePos.set(slot, slot.position.clone());
            const p = slot.position;
            slot.setPosition((i - (slots.length - 1) / 2) * this.tutorialSlotSpacing, p.y, p.z);
        });
    }

    /** Trả khay chờ về đủ ô và vị trí cũ cho màn chơi thật. */
    private unfocusSlots(): void {
        for (const [slot, pos] of this.slotBasePos) if (slot.isValid) slot.setPosition(pos);
        this.slotBasePos.clear();
        for (const c of this.hiddenSlots) if (c.isValid) c.active = true;
        this.hiddenSlots = [];
    }

    private setBoardVisible(visible: boolean, duration: number): void {
        const board = this.board;
        if (!board) return;
        const op = board.getComponent(UIOpacity) ?? board.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        const to = visible ? 255 : 0;
        if (duration <= 0) op.opacity = to;
        else tween(op).to(duration, { opacity: to }).start();
    }

    /** Khách đứng gần giữa màn hình nhất. */
    private middle(list: CustomerController[]): CustomerController | null {
        if (!list.length) return null;
        const xs = list.map(c => c.node.worldPosition.x);
        const center = (Math.min(...xs) + Math.max(...xs)) / 2;
        let best = 0;
        xs.forEach((x, i) => {
            if (Math.abs(x - center) < Math.abs(xs[best] - center)) best = i;
        });
        return list[best];
    }

    /** Vẽ khung thoại bo góc màu kem, bóng nâu nhạt phía dưới, đuôi chỉ sang trái (về thuyền trưởng). */
    /** Đổi thẻ <hl>...</hl> trong câu thoại thành thẻ màu RichText theo `highlightColor`. */
    private applyHighlight(text: string): string {
        const hex = this.highlightColor.toHEX('#rrggbb');
        return text.replace(/<hl>/g, `<color=#${hex}>`).replace(/<\/hl>/g, '</color>');
    }

    /** Ghi chữ vào RichText nếu có, không thì vào Label (Label không hiểu thẻ nên bỏ thẻ đi). */
    private setText(text: string): void {
        if (this.richText) this.richText.string = text;
        else if (this.textLabel) this.textLabel.string = text.replace(/<[^>]+>/g, '');
    }

    private drawBubble(): void {
        const g = this.bubble?.getComponent(Graphics);
        const ut = this.bubble?.getComponent(UITransform);
        if (!g || !ut) return;
        const w = ut.width;
        const h = ut.height;
        const x = -w * ut.anchorX;
        const y = -h * ut.anchorY;
        const r = 28;
        g.clear();
        g.fillColor = new Color(214, 186, 150, 255);
        g.roundRect(x, y - 8, w, h, r);
        g.fill();
        g.fillColor = new Color(255, 250, 238, 255);
        g.roundRect(x, y, w, h, r);
        g.fill();
        // Đuôi ở cạnh trái, phía dưới.
        g.moveTo(x + 4, y + h * 0.42);
        g.lineTo(x - 34, y + h * 0.22);
        g.lineTo(x + 4, y + h * 0.18);
        g.close();
        g.fill();
    }

    onDestroy(): void {
        this.blocker?.off(Node.EventType.TOUCH_END, this.onBlockerTap, this);
    }
}

/** Số ký tự hiển thị của câu thoại (không tính thẻ RichText như <color=...>). */
function visibleLength(text: string): number {
    return text.replace(/<[^>]+>/g, '').length;
}

/**
 * Phần đầu của câu thoại gồm `count` ký tự hiển thị, giữ nguyên các thẻ RichText đã mở
 * và tự đóng các thẻ còn dở, để hiệu ứng hiện chữ dần không làm vỡ thẻ màu.
 */
function revealRich(text: string, count: number): string {
    let out = '';
    let left = count;
    const open: string[] = [];
    for (const part of text.split(/(<[^>]+>)/)) {
        if (!part) continue;
        if (part.startsWith('<')) {
            if (left <= 0) break;
            out += part;
            if (part.startsWith('</')) open.pop();
            else if (!part.endsWith('/>')) open.push(part.slice(1).split(/[=\s>]/)[0]);
            continue;
        }
        if (left <= 0) break;
        out += part.substring(0, left);
        left -= part.length;
    }
    for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
    return out;
}
