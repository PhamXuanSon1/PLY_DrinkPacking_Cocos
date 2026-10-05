import { _decorator, Animation, assetManager, Component, find, instantiate, Label, Node, Prefab, SpriteFrame, Vec2 } from 'cc';
import { DrinkItemManager } from '../MapTool/DrinkItemManager';
import { DrinkTile } from '../MapTool/DrinkTile';
import { LevelMapBuilder } from '../MapTool/LevelMapBuilder';
import { CustomerController } from './CustomerController';
import { WaitTray } from './WaitTray';
const { ccclass, property } = _decorator;

/** Phát trên node này khi thắng / thua. */
export const LEVEL_WIN_EVENT = 'level-win';
export const LEVEL_LOSE_EVENT = 'level-lose';

/** Một đơn: khách cần cupsPerOrder cốc cùng loại `drinkId`. */
interface Order {
    drinkId: number;
    /** Số cốc đã được giao (kể cả cốc đang bay tới). */
    reserved: number;
    /** Số cốc đã đáp xuống đĩa. */
    landed: number;
    done: boolean;
}

/**
 * Quản lý khách và đơn đồ uống.
 *
 * Đơn không xáo ngẫu nhiên mà được sinh động theo hướng dễ thắng nhất: mỗi khi
 * một chỗ trống, chọn loại đồ uống mà người chơi đang lấy được nhiều cốc nhất
 * (cốc trong khay + cốc đang lộ trên bàn). Mỗi loại chỉ được gọi tối đa
 * (số cốc còn lại / cupsPerOrder) đơn nên tổng đơn luôn khớp tổng cốc.
 */
@ccclass('OrderManager')
export class OrderManager extends Component {
    // Các thành phần gameplay được nối trong Inspector.
    @property({ type: DrinkItemManager, tooltip: 'Quản lý các cốc trên bàn' })
    itemManager: DrinkItemManager | null = null;

    @property({ type: LevelMapBuilder, tooltip: 'Lấy sprite đồ uống theo drinkId (drinkFrames) cho ảnh mờ của khách' })
    mapBuilder: LevelMapBuilder | null = null;

    @property({ type: [CustomerController], tooltip: 'Các chỗ đứng của khách (3 chỗ)' })
    customers: CustomerController[] = [];

    @property({ type: WaitTray, tooltip: 'Khay chờ 6 ô' })
    tray: WaitTray | null = null;

    @property({ type: [SpriteFrame], tooltip: 'Avatar khách, dùng lần lượt' })
    avatarFrames: SpriteFrame[] = [];

    @property({ type: Label, tooltip: 'Nhãn tiến độ "đã phục vụ/tổng"' })
    progressLabel: Label | null = null;

    @property({ tooltip: 'Số cốc mỗi đơn' })
    cupsPerOrder = 3;

    @property({ tooltip: 'Thời gian hiển thị heart_emoji khi thắng (giây)' })
    heartEmojiDuration = 2;

    @property({ tooltip: 'Cứ ngẫu nhiên [x, y] khách mới vào thì có 1 khách nói (CustomerChat). Khách giữa luôn nói khi bắt đầu màn' })
    chatEvery = new Vec2(2, 3);

    /** Đơn theo từng vị trí khách; null nghĩa là vị trí đó đang trống hoặc chưa có đơn mới. */
    private active: (Order | null)[] = [];
    /** Số cốc mỗi loại chưa được dành cho đơn nào; giảm khi tạo đơn mới. */
    private unassigned = new Map<number, number>();
    /** Tổng số đơn của màn, số đơn đã phục vụ và số khách đã được tạo. */
    private totalOrders = 0;
    private served = 0;
    private spawned = 0;
    /** Chặn input và phát lại kết quả sau khi màn đã kết thúc. */
    private finished = false;
    private heartEmojiNode: Node | null = null;
    /** Số khách mới còn phải vào trước khi có khách nói tiếp. */
    private chatCountdown = 0;

    start(): void {
        // Chờ một frame để DrinkItemManager.start() quét xong các cốc.
        this.scheduleOnce(() => this.startLevel(), 0);
    }

    /** Bắt đầu (hoặc chơi lại) phần khách: đếm cốc, gắn input, gọi khách đầu tiên. */
    startLevel(): void {
        // Cocos có thể deserialize mảng customers thành null khi scene chưa gán Inspector.
        if (!Array.isArray(this.customers)) {
            const orderRoot = find('UI/Canvas3D/Scenes/ScaleGameplay/UI_SlotBar/UI_Orders', this.node.scene ?? undefined);
            this.customers = orderRoot?.children
                .map((tray) => tray.getChildByName('Customer')?.getComponent(CustomerController))
                .filter((customer): customer is CustomerController => customer !== null && customer !== undefined) ?? [];
        }

        // Đếm cốc chưa được gán cho đơn nào và gắn input cho chúng; gọi khách đầu tiên.
        const tiles = this.itemManager?.getTiles() ?? [];
        this.unassigned.clear();

        for (const t of tiles) {
            if (t.collected) continue;
            // Đếm số cốc chưa lấy của từng loại để chia thành các đơn.
            this.unassigned.set(t.drinkId, (this.unassigned.get(t.drinkId) ?? 0) + 1);
            // Gỡ listener cũ trước để gọi startLevel nhiều lần không tạo input trùng.
            t.node.off(Node.EventType.TOUCH_END, this.onTileTouched, this);
            t.node.on(Node.EventType.TOUCH_END, this.onTileTouched, this);
        }
        for (const [id, n] of this.unassigned) {
            if (n % this.cupsPerOrder !== 0) console.warn(`[OrderManager] drink ${id}: ${n} cups, not a multiple of ${this.cupsPerOrder}`);
        }
        this.totalOrders = Math.floor(tiles.filter(t => !t.collected).length / this.cupsPerOrder);
        this.served = 0;
        this.spawned = 0;
        this.finished = false;
        if (this.heartEmojiNode?.isValid) this.heartEmojiNode.active = false;
        this.tray?.reset();
        // Mỗi vị trí bắt đầu chưa có đơn; gọi khách cho từng vị trí bên dưới.
        this.active = this.customers.map(() => null);
        // Lượt đầu chỉ khách đứng giữa nói; sau đó đếm lại từ đầu.
        const middle = this.middleSlot();
        this.customers.forEach((c, i) => {
            c.node.active = false;
            this.spawnCustomer(i, i === middle);
        });
        this.resetChatCountdown();
        this.updateLabel();
    }

    private onTileTouched(event: { currentTarget: Node }): void {
        const tile = event.currentTarget.getComponent(DrinkTile);
        // Bỏ qua cốc không hợp lệ, màn đã xong, hoặc cốc đang bị che / không chọn được.
        if (!tile || this.finished || !this.itemManager?.isSelectable(tile)) return;

        const order = this.findOrder(tile.drinkId);
        if (!order && this.tray?.isFull()) return; // Khay đầy: không nhận thêm, không mất cốc.

        // Cốc rời bàn ngay (model), node vẫn giữ lại để nhảy lên khách hoặc khay.
        this.itemManager.detachTile(tile);
        // Giao thẳng nếu có khách cần loại này; nếu không thì cất tạm vào khay chờ.
        if (order) this.deliver(order, tile);
        else this.tray?.add(tile);
        this.checkLose();
    }

    /** Đơn đang chờ cùng loại, ưu tiên đơn đã có nhiều cốc nhất để khách đi sớm. */
    private findOrder(drinkId: number): Order | null {
        let best: Order | null = null;
        for (const o of this.active) {
            if (o && o.reserved < this.cupsPerOrder && o.drinkId === drinkId && (!best || o.reserved > best.reserved)) best = o;
        }
        return best;
    }

    /** Giao cốc cho đơn: giữ chỗ ngay, cốc nhảy lên đĩa; đủ cốc đáp xong thì khách rời đi. */
    private deliver(order: Order, tile: DrinkTile): void {
        const slot = this.active.indexOf(order);
        // Đặt chỗ ngay khi bắt đầu bay để cốc tiếp theo không bị giao quá số lượng đơn.
        const index = order.reserved++;
        this.customers[slot].receive(tile.node, index, () => {
            // Chỉ tính là đã tới nơi sau khi animation đáp xuống hoàn tất.
            order.landed++;
            if (order.landed === this.cupsPerOrder) this.complete(order, slot);
        });
    }

    private complete(order: Order, slot: number): void {
        // Đánh dấu done trước khi khách rời đi để không nhận thêm cốc cho đơn này.
        order.done = true;
        this.served++;
        this.updateLabel();
        this.customers[slot].leave(() => {
            // Dùng lại vị trí khách vừa rời; kiểm tra kết quả sau khi thử gọi khách tiếp theo.
            this.active[slot] = null;
            this.spawnCustomer(slot);
            this.checkWin();
            this.checkLose();
        });
    }

    /** Chỗ đứng gần giữa màn hình nhất (theo vị trí world x của khách). */
    private middleSlot(): number {
        const xs = this.customers.map(c => c.node.worldPosition.x);
        const center = (Math.min(...xs) + Math.max(...xs)) / 2;
        let best = 0;
        xs.forEach((x, i) => {
            if (Math.abs(x - center) < Math.abs(xs[best] - center)) best = i;
        });
        return best;
    }

    private resetChatCountdown(): void {
        const min = Math.round(this.chatEvery.x);
        const max = Math.max(min, Math.round(this.chatEvery.y));
        this.chatCountdown = min + Math.floor(Math.random() * (max - min + 1));
    }

    /**
     * Gọi khách mới vào chỗ `slot` nếu còn đơn, rồi giao luôn cốc phù hợp đang có trong khay.
     * `talk` không truyền: tự quyết định theo `chatEvery` (cứ 2–3 khách thì 1 khách nói khi vào).
     */
    private spawnCustomer(slot: number, talk?: boolean): void {
        const drinkId = this.pickDrink();
        if (drinkId === null) return;
        this.unassigned.set(drinkId, this.unassigned.get(drinkId)! - this.cupsPerOrder);
        const order: Order = { drinkId, reserved: 0, landed: 0, done: false };
        this.active[slot] = order;
        // Xoay vòng avatar theo thứ tự khách được tạo.
        const avatar = this.avatarFrames.length ? this.avatarFrames[this.spawned % this.avatarFrames.length] : null;
        this.spawned++;
        if (talk === undefined) {
            talk = --this.chatCountdown <= 0;
            if (talk) this.resetChatCountdown();
        }
        this.customers[slot].show(avatar, this.mapBuilder?.drinkFrames[drinkId] ?? null, talk);

        // Tự chuyển cốc cùng loại đang chờ trong khay sang đơn mới.
        for (const tile of this.tray?.take(drinkId, this.cupsPerOrder) ?? []) this.deliver(order, tile);
    }

    /**
     * Chọn loại đồ uống dễ phục vụ nhất. Điểm ưu tiên:
     * 1. Số cốc lấy được ngay (khay + cốc đang lộ), tối đa bằng một đơn.
     * 2. Cốc trong khay, để giải phóng khay.
     * 3. Tránh trùng loại với khách đang đứng.
     */
    private pickDrink(): number | null {
        const selectable = this.itemManager?.getSelectableTiles() ?? [];
        let bestId: number | null = null;
        let bestScore = -Infinity;
        for (const [id, left] of this.unassigned) {
            // Không tạo đơn nếu số cốc còn lại không đủ cho một đơn hoàn chỉnh.
            if (left < this.cupsPerOrder) continue;
            const inTray = this.tray?.count(id) ?? 0;
            const visible = selectable.filter(t => t.drinkId === id).length;
            const sameActive = this.active.filter(o => o && !o.done && o.drinkId === id).length;
            // Ưu tiên loại có thể gom đủ nhanh, rồi loại đang chiếm khay; giảm điểm nếu
            // đã có khách khác chờ cùng loại. `left` giúp phân định khi các điểm gần bằng nhau.
            const score = Math.min(this.cupsPerOrder, inTray + visible) * 100 + inTray * 10 - sameActive * 50 + left;
            if (score > bestScore) {
                bestScore = score;
                bestId = id;
            }
        }
        return bestId;
    }

    private checkWin(): void {
        // Chỉ thắng khi mọi đơn đều đã được phục vụ và chưa có kết quả kết thúc trước đó.
        if (this.finished || this.served < this.totalOrders) return;
        this.finished = true;
        console.log('[OrderManager] WIN');
        this.showHeartEmoji();
        this.node.emit(LEVEL_WIN_EVENT);
    }

    /** Tạo heart_emoji dưới Tray_0 và tự ẩn sau khoảng thời gian cấu hình. */
    private showHeartEmoji(): void {
        const tray = find('UI/Canvas3D/Scenes/ScaleGameplay/UI_SlotBar/UI_Orders/Tray_0', this.node.scene ?? undefined);
        if (!tray) {
            console.warn('[OrderManager] Không tìm thấy Tray_0 để hiển thị heart_emoji.');
            return;
        }

        const show = (heart: Node): void => {
            this.heartEmojiNode = heart;
            heart.setPosition(0, 300, 0);
            heart.active = true;
            heart.getComponent(Animation)?.play();
            this.scheduleOnce(() => {
                if (heart.isValid) heart.active = false;
            }, this.heartEmojiDuration);
        };

        if (this.heartEmojiNode?.isValid) {
            show(this.heartEmojiNode);
            return;
        }

        assetManager.loadAny('028719ee-c859-4300-9dd9-70e2c1a82c1c', (error, prefab: Prefab) => {
            if (error || !prefab || !this.node.isValid || !tray.isValid) {
                console.warn('[OrderManager] Không tải được prefab heart_emoji.', error);
                return;
            }
            const heart = instantiate(prefab);
            heart.name = 'heart_emoji';
            tray.addChild(heart);
            show(heart);
        });
    }

    /** Thua khi khay đầy và không cốc lộ nào giao được cho khách đang chờ. */
    private checkLose(): void {
        if (this.finished || !this.tray?.isFull()) return;
        const canDeliver = (this.itemManager?.getSelectableTiles() ?? []).some(t => this.findOrder(t.drinkId));
        const pending = this.active.some(o => o && (o.done || o.landed < o.reserved)); // Cốc đang bay / khách đang rời đi.
        // Chưa thua nếu còn nước đi hợp lệ hoặc animation/khách rời đi chưa xử lý xong.
        if (canDeliver || pending) return;
        this.finished = true;
        console.log('[OrderManager] LOSE');
        this.node.emit(LEVEL_LOSE_EVENT);
    }

    private updateLabel(): void {
        // Hiển thị số đơn đã hoàn tất trên tổng số đơn của màn.
        if (this.progressLabel) this.progressLabel.string = `${this.served}/${this.totalOrders}`;
    }
}
