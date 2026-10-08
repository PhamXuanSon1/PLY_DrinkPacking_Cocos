import { _decorator, Component, find, Label, Node, SpriteFrame, Vec2 } from 'cc';
import { CustomerTimer } from './CustomerTimer';
import { gc, GameController } from '../Tool/GameController';
import { DrinkItemManager } from '../MapTool/DrinkItemManager';
import { DrinkTile } from '../MapTool/DrinkTile';
import { LevelMapBuilder } from '../MapTool/LevelMapBuilder';
import { CustomerController } from './CustomerController';
import { CustomerLookLibrary } from './CustomerLookLibrary';
import { WaitTray } from './WaitTray';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    level: { id: 'level', name: 'Màn chơi', displayOrder: 0, style: 'section' },
    refs: { id: 'refs', name: 'Tham chiếu', displayOrder: 1, style: 'section' },
    order: { id: 'order', name: 'Khách & đơn', displayOrder: 2, style: 'section' },
    timer: { id: 'timer', name: 'Đồng hồ', displayOrder: 3, style: 'section' },
};

/** Phát trên node này khi bắt đầu màn chơi (sau tutorial) / thắng / thua. */
export const LEVEL_START_EVENT = 'level-start';
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
    /** Khách hết giờ đang bỏ đi: không nhận cốc mới cho tới khi khách khác vào nhận tiếp đơn. */
    leaving: boolean;
    /** Thời gian đồng hồ cố định cho khách đầu tiên nhận đơn này (khách giữa đầu màn); không có = ngẫu nhiên. */
    fixedTime?: number;
}

/**
 * Quản lý khách và đơn đồ uống.
 *
 * Đơn không xáo ngẫu nhiên mà được sinh động theo hướng dễ thắng nhất: mỗi khi
 * một chỗ trống, chọn loại đồ uống mà người chơi gom đủ sớm nhất (cốc trong khay +
 * cốc lộ / sắp lộ trên bàn, trừ phần đã dành cho khách đang đứng). Mỗi loại chỉ được gọi tối đa
 * (số cốc còn lại / cupsPerOrder) đơn nên tổng đơn luôn khớp tổng cốc.
 */
@ccclass('OrderManager')
export class OrderManager extends Component {
    // ── Màn chơi ──
    @property({ tooltip: 'Tự bắt đầu màn khi vào scene. TutorialManager tắt cờ này và tự gọi startLevel() khi tutorial xong', group: GROUP.level })
    autoStart = true;

    @property({ tooltip: 'Thua khi có bấy nhiêu khách bỏ đi', group: GROUP.level })
    maxWalkouts = 3;

    // ── Tham chiếu: các thành phần gameplay được nối trong Inspector ──
    @property({ type: DrinkItemManager, tooltip: 'Quản lý các cốc trên bàn', group: GROUP.refs })
    itemManager: DrinkItemManager | null = null;

    @property({ type: LevelMapBuilder, tooltip: 'Lấy sprite đồ uống theo drinkId (drinkFrames) cho ảnh mờ của khách', group: GROUP.refs })
    mapBuilder: LevelMapBuilder | null = null;

    @property({ type: [CustomerController], tooltip: 'Các chỗ đứng của khách (3 chỗ)', group: GROUP.refs })
    customers: CustomerController[] = [];

    @property({ type: WaitTray, tooltip: 'Khay chờ 6 ô', group: GROUP.refs })
    tray: WaitTray | null = null;

    @property({ type: Label, tooltip: 'Nhãn tiến độ "đã phục vụ/tổng"', group: GROUP.refs })
    progressLabel: Label | null = null;

    // ── Khách & đơn ──
    @property({ type: CustomerLookLibrary, tooltip: 'Thư viện nhân vật (thân + mặt thường / vui / giận), dùng lần lượt. Có thì dùng thay Avatar Frames', group: GROUP.order })
    lookLibrary: CustomerLookLibrary | null = null;

    @property({ type: [SpriteFrame], tooltip: 'Avatar khách 1 ảnh (giận thì tô đỏ), dùng lần lượt. Chỉ dùng khi không có Look Library', group: GROUP.order })
    avatarFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Số cốc mỗi đơn', group: GROUP.order })
    cupsPerOrder = 3;

    @property({ tooltip: 'Khi chọn đơn mới, tính trước tối đa bao nhiêu đợt bốc (0 = chỉ cốc đang lộ). Đợt d = cốc lộ ra sau khi bốc hết các đợt trước', group: GROUP.order })
    lookahead = 2;

    @property({ tooltip: 'Cứ ngẫu nhiên [x, y] khách mới vào thì có 1 khách nói (CustomerChat). Khách giữa luôn nói khi bắt đầu màn', group: GROUP.order })
    chatEvery = new Vec2(2, 3);

    // ── Đồng hồ ──
    @property({ tooltip: 'Áp lực thời gian: mỗi khách có đồng hồ (CustomerTimer trên node Customer), hết giờ thì bỏ đi', group: GROUP.timer })
    useTimer = true;

    @property({ tooltip: 'Thời gian chờ của mỗi khách (đồng hồ), lấy ngẫu nhiên trong [x, y] giây. Áp dụng cho mọi khách', group: GROUP.timer })
    customerTime = new Vec2(8, 10);

    @property({ tooltip: 'Thời gian đồng hồ cố định (giây) của khách đứng giữa lúc bắt đầu màn. 0 = ngẫu nhiên như Customer Time', group: GROUP.timer })
    firstCustomerTime = 8;

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
    /** Số khách mới còn phải vào trước khi có khách nói tiếp. */
    private chatCountdown = 0;
    /** Số khách đã bỏ đi vì chờ quá lâu. */
    private walkouts = 0;
    /** Đồng hồ khách chỉ hiện và chạy từ lần click cốc đầu tiên trong màn chơi; trước đó ẩn. */
    private clockStarted = false;

    start(): void {
        // Đã ra store (GameController.stopGame): khóa cốc + dừng đồng hồ; quay lại game thì click
        // chỉ mở lại store (StoreRedirect), cốc không bay nữa.
        gc?.node.on(GameController.EVENT_STOP, this.onGameStop, this);
        if (!this.autoStart) return;
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
        this.walkouts = 0;
        this.clockStarted = false;
        this.finished = false;
        this.tray?.reset();
        // Mỗi vị trí bắt đầu chưa có đơn; gọi khách cho từng vị trí bên dưới.
        this.active = this.customers.map(() => null);
        // Lượt đầu chỉ khách đứng giữa nói; sau đó đếm lại từ đầu.
        const middle = this.middleSlot();
        this.customers.forEach((c, i) => {
            c.node.active = false;
            // Lượt khách đầu màn đứng sẵn ở quầy, không trượt vào.
            this.spawnCustomer(i, i === middle, true, i === middle && this.firstCustomerTime > 0 ? this.firstCustomerTime : undefined);
        });
        this.resetChatCountdown();
        this.updateLabel();
        this.node.emit(LEVEL_START_EVENT);
    }

    private onTileTouched(event: { currentTarget: Node }): void {
        const tile = event.currentTarget.getComponent(DrinkTile);
        // Bỏ qua cốc không hợp lệ, màn đã xong, hoặc cốc đang bị che / không chọn được.
        if (!tile || this.finished || gc?.stopped || !this.itemManager?.isSelectable(tile)) return;
        if (!this.clockStarted) {
            this.clockStarted = true;
            this.customers.forEach((_, i) => this.timerOf(i)?.resume());
        }

        const order = this.findOrder(tile.drinkId);
        if (!order && this.tray?.isFull()) return; // Khay đầy: không nhận thêm, không mất cốc.

        // Cốc rời bàn ngay (model), node vẫn giữ lại để nhảy lên khách hoặc khay.
        this.itemManager.detachTile(tile);
        Ply_SoundManager.Ins?.playFxOneShot(FxType.TapTile);
        // Giao thẳng nếu có khách cần loại này; nếu không thì cất tạm vào khay chờ.
        if (order) this.deliver(order, tile);
        else this.tray?.add(tile);
        this.checkLose();
    }

    /** Đơn đang chờ cùng loại, ưu tiên đơn đã có nhiều cốc nhất để khách đi sớm. */
    private findOrder(drinkId: number): Order | null {
        let best: Order | null = null;
        for (const o of this.active) {
            if (o && !o.leaving && o.reserved < this.cupsPerOrder && o.drinkId === drinkId && (!best || o.reserved > best.reserved)) best = o;
        }
        return best;
    }

    /** Giao cốc cho đơn: giữ chỗ ngay, cốc nhảy lên đĩa; đủ cốc đáp xong thì khách rời đi. */
    private deliver(order: Order, tile: DrinkTile): void {
        const slot = this.active.indexOf(order);
        // Đặt chỗ ngay khi bắt đầu bay để cốc tiếp theo không bị giao quá số lượng đơn.
        const index = order.reserved++;
        // Đã giao đủ cốc (kể cả cốc đang bay): khách không còn chờ nữa.
        if (order.reserved === this.cupsPerOrder) this.timerOf(slot)?.stop();
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
    private spawnCustomer(slot: number, talk?: boolean, instant = false, fixedTime?: number): void {
        const drinkId = this.pickDrink();
        if (drinkId === null) return;
        this.unassigned.set(drinkId, this.unassigned.get(drinkId)! - this.cupsPerOrder);
        const order: Order = { drinkId, reserved: 0, landed: 0, done: false, leaving: false, fixedTime };
        this.active[slot] = order;
        this.showCustomer(slot, order, talk, instant);
    }

    /**
     * Cho một khách (avatar kế tiếp) vào nhận đơn `order` ở chỗ `slot` và giao luôn cốc cùng loại
     * đang chờ trong khay; đồng hồ chỉ hiện khi khách đã trượt vào tới chỗ đứng.
     * Dùng cho khách mới và khách thay thế khách bỏ đi (đơn dở).
     */
    private showCustomer(slot: number, order: Order, talk?: boolean, instant = false): void {
        // Xoay vòng nhân vật theo thứ tự khách được tạo (ưu tiên bộ có biểu cảm).
        const looks = (this.lookLibrary?.looks ?? []).filter(l => l?.body);
        const look = looks.length ? looks[this.spawned % looks.length] : null;
        const avatar = !look && this.avatarFrames.length ? this.avatarFrames[this.spawned % this.avatarFrames.length] : null;
        this.spawned++;
        if (talk === undefined) {
            talk = --this.chatCountdown <= 0;
            if (talk) this.resetChatCountdown();
        }
        const customer = this.customers[slot];
        customer.show(avatar, this.mapBuilder?.drinkFrames[order.drinkId] ?? null, talk, instant, () => this.startTimer(slot, order), look);
        if (order.reserved > 0) customer.restoreProgress(order.reserved, order.landed);

        // Tự chuyển cốc cùng loại đang chờ trong khay sang đơn.
        for (const tile of this.tray?.take(order.drinkId, this.cupsPerOrder - order.reserved) ?? []) this.deliver(order, tile);
    }

    /**
     * Khách đã đứng vào chỗ: bật đồng hồ nếu vẫn còn chờ cốc (trong lúc trượt vào có thể đã được giao
     * đủ từ khay). Trước click cốc đầu tiên đồng hồ ẩn và đứng yên; đã ra store thì đứng yên.
     */
    private startTimer(slot: number, order: Order): void {
        if (!this.useTimer || this.finished || this.active[slot] !== order || order.leaving || order.reserved >= this.cupsPerOrder) return;
        // Thời gian cố định chỉ áp cho khách đầu tiên của đơn; khách thay thế (nếu bỏ đi) lấy ngẫu nhiên.
        const time = order.fixedTime ?? this.randomTime();
        order.fixedTime = undefined;
        this.timerOf(slot)?.begin(() => this.onTimeout(slot), time, !this.clockStarted || !!gc?.stopped, !this.clockStarted);
    }

    private randomTime(): number {
        const min = Math.min(this.customerTime.x, this.customerTime.y);
        const max = Math.max(this.customerTime.x, this.customerTime.y);
        return min + Math.random() * (max - min);
    }

    private timerOf(slot: number): CustomerTimer | null {
        return this.customers[slot]?.getComponent(CustomerTimer) ?? null;
    }

    /** Hết giờ: khách bỏ đi; đủ `maxWalkouts` khách bỏ đi thì thua, nếu không thì khách khác vào thay. */
    private onTimeout(slot: number): void {
        const order = this.active[slot];
        if (this.finished || !order || order.done || order.leaving || order.reserved >= this.cupsPerOrder) return;
        order.leaving = true;
        this.walkouts++;
        if (this.walkouts >= this.maxWalkouts) this.lose('walkouts');
        this.customers[slot].angryLeave(() => this.replaceCustomer(slot, order));
    }

    /**
     * Khách thay thế khách bỏ đi. Đơn chưa có cốc nào: trả cốc về danh sách chưa gán và gọi đơn
     * mới như bình thường. Đơn dở (đã có cốc trên đĩa): khách mới nhận tiếp đúng đơn đó, cốc trên
     * đĩa giữ nguyên nên không mất cốc nào.
     */
    private replaceCustomer(slot: number, order: Order): void {
        if (this.finished) return;
        order.leaving = false;
        if (order.reserved === 0) {
            this.unassigned.set(order.drinkId, (this.unassigned.get(order.drinkId) ?? 0) + this.cupsPerOrder);
            this.active[slot] = null;
            this.spawnCustomer(slot);
        } else {
            this.showCustomer(slot, order);
        }
        this.checkLose();
    }

    private onGameStop(): void {
        this.customers.forEach((_, i) => this.timerOf(i)?.pause());
    }

    onDestroy(): void {
        gc?.node?.off(GameController.EVENT_STOP, this.onGameStop, this);
    }

    private stopTimers(): void {
        this.customers.forEach((_, i) => this.timerOf(i)?.stop());
    }


    /**
     * Chọn loại đồ uống dễ phục vụ nhất. Số cốc "còn trống" của một loại = cốc trong khay + cốc
     * lấy được trên bàn − số cốc các khách đang đứng còn thiếu của loại đó (đã được dành trước),
     * để không có 2 khách cùng đòi 6 cốc khi bàn chỉ lộ 2 cốc. Điểm ưu tiên:
     * 1. Đủ một đơn với số cốc còn trống sau ít đợt bốc nhất (0 = đang lộ, tối đa `lookahead`).
     * 2. Số cốc còn trống lấy được ngay, tối đa bằng một đơn.
     * 3. Cốc trong khay, để giải phóng khay.
     * 4. Tránh trùng loại với khách đang đứng.
     */
    private pickDrink(): number | null {
        const need = this.cupsPerOrder;
        const reach = this.itemManager?.reachableByDepth(this.lookahead) ?? [new Map<number, number>()];
        let bestId: number | null = null;
        let bestScore = -Infinity;
        for (const [id, left] of this.unassigned) {
            // Không tạo đơn nếu số cốc còn lại không đủ cho một đơn hoàn chỉnh.
            if (left < need) continue;
            const inTray = this.tray?.count(id) ?? 0;
            const waiting = this.active.filter(o => o && !o.done && o.drinkId === id) as Order[];
            const reserved = waiting.reduce((sum, o) => sum + need - o.reserved, 0);
            // Cộng dồn cốc lấy được theo từng đợt bốc; tìm đợt sớm nhất gom đủ một đơn.
            let free = inTray - reserved;
            let readyAt = -1;
            reach.forEach((counts, d) => {
                free += counts.get(id) ?? 0;
                if (readyAt < 0 && free >= need) readyAt = d;
            });
            const freeNow = inTray + (reach[0].get(id) ?? 0) - reserved;
            const tier = readyAt < 0 ? 0 : reach.length - readyAt;
            // `left` giúp phân định khi các điểm khác bằng nhau.
            const score = tier * 1000 + Math.max(0, Math.min(need, freeNow)) * 100 + inTray * 10 - waiting.length * 50 + left;
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
        this.stopTimers();
        console.log('[OrderManager] WIN');
        this.node.emit(LEVEL_WIN_EVENT);
    }

    /** Thua thêm một cách: khay đầy và không cốc lộ nào giao được cho khách đang chờ. */
    private checkLose(): void {
        if (this.finished || !this.tray?.isFull()) return;
        const canDeliver = (this.itemManager?.getSelectableTiles() ?? []).some(t => this.findOrder(t.drinkId));
        // Cốc đang bay / khách đang rời đi (vui hoặc giận, khách sau sẽ vào nhận đơn).
        const pending = this.active.some(o => o && (o.done || o.leaving || o.landed < o.reserved));
        // Chưa thua nếu còn nước đi hợp lệ hoặc animation/khách rời đi chưa xử lý xong.
        if (canDeliver || pending) return;
        this.lose('tray full');
    }

    private lose(reason: string): void {
        if (this.finished) return;
        this.finished = true;
        this.stopTimers();
        console.log(`[OrderManager] LOSE (${reason})`);
        // Endcard thua (LosePopup = WinPopup với Result = Lose) nghe sự kiện này và tự phát sound thua.
        this.node.emit(LEVEL_LOSE_EVENT);
    }

    private updateLabel(): void {
        // Hiển thị số đơn đã hoàn tất trên tổng số đơn của màn.
        if (this.progressLabel) this.progressLabel.string = `${this.served}/${this.totalOrders}`;
    }
}
