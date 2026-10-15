import { _decorator, Component, Enum, find, Label, Node, SpriteFrame, Vec2 } from 'cc';
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
    modePlay: { id: 'modePlay', name: 'Chế độ chơi', displayOrder: 4, style: 'section' },
};

/** Phát trên node này khi bắt đầu màn chơi (sau tutorial) / thắng / thua. */
export const LEVEL_START_EVENT = 'level-start';
export const LEVEL_WIN_EVENT = 'level-win';
export const LEVEL_LOSE_EVENT = 'level-lose';

/** Trạng thái một ô trên đĩa của đơn. */
enum SlotState {
    /** Chưa có cốc nào được giao cho ô này. */
    Empty,
    /** Đã giữ chỗ: cốc đang bay tới ô này. */
    Flying,
    /** Cốc đã đáp xuống ô này. */
    Landed,
}

/** Một ô của đơn: loại đồ uống khách cần ở đúng vị trí đó trên đĩa. */
interface OrderSlot {
    drinkId: number;
    state: SlotState;
}

/** Một đơn: cupsPerOrder ô, mỗi ô một loại (có thể lặp loại, ví dụ [A, A, B]). */
interface Order {
    slots: OrderSlot[];
    done: boolean;
    /** Khách hết giờ đang bỏ đi: không nhận cốc mới cho tới khi khách khác vào nhận tiếp đơn. */
    leaving: boolean;
    /** Đơn chưa nhận cốc nào bị hủy và đã trả cốc về inventory (chỉ trả một lần). */
    cancelled: boolean;
    /** Thời gian đồng hồ cố định cho khách đầu tiên nhận đơn này (khách giữa đầu màn); không có = ngẫu nhiên. */
    fixedTime?: number;
}

/** Cách khách gọi đơn. */
export enum OrderMode {
    /** 3 cốc khác loại nhau (ví dụ [A, B, C]); cuối màn không còn đủ loại thì cho lặp loại. */
    Different,
    /** 3 cốc cùng một loại (ví dụ [A, A, A]). */
    Same,
}

/** Số ô đã được giữ chỗ (đang bay hoặc đã đáp). */
function filledCount(order: Order): number {
    return order.slots.filter(s => s.state !== SlotState.Empty).length;
}

function allLanded(order: Order): boolean {
    return order.slots.every(s => s.state === SlotState.Landed);
}

/**
 * Quản lý khách và đơn đồ uống.
 *
 * Mỗi đơn gồm cupsPerOrder ô; `orderMode` quyết định các ô khác loại (Different) hay cùng loại (Same).
 * Loại cốc lấy từ inventory thực tế của màn: `unassigned` = số cốc mỗi loại chưa dành cho đơn nào, tạo đơn thì trừ, đơn chưa nhận
 * cốc nào bị hủy thì cộng lại. Nhờ vậy tổng cốc trên bàn + khay + đơn đang xử lý + đơn đã xong
 * luôn bằng tổng cốc lúc bắt đầu. Xác suất rút nghiêng về loại đang lấy được ngay (cốc trong khay,
 * cốc lộ / sắp lộ trên bàn, trừ phần các đơn đang chờ đã dành) để giảm nguy cơ bí.
 */
@ccclass('OrderManager')
export class OrderManager extends Component {
    // ── Màn chơi ──
    @property({ tooltip: 'Tự bắt đầu màn khi vào scene. TutorialManager tắt cờ này và tự gọi startLevel() khi tutorial xong', group: GROUP.level })
    autoStart = true;

    
    @property({ type: Enum(OrderMode), tooltip: 'Different: mỗi đơn 3 cốc khác loại nhau. Same: mỗi đơn 3 cốc cùng một loại', group: GROUP.modePlay })
    orderMode = OrderMode.Different;

    // Giữ tên biến `maxWalkouts` để scene không mất giá trị đã lưu.
    @property({ displayName: 'Số lần sai ra store', tooltip: 'Mỗi khách hết giờ bỏ đi = 1 lần sai. Sai đủ bấy nhiêu lần thì thua và mở store. 0 = tắt', group: GROUP.level })
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

    @property({ tooltip: 'Khi rút loại cho đơn mới, tính cả cốc sẽ lộ sau tối đa bao nhiêu đợt bốc (0 = chỉ cốc đang lộ). Đợt d = cốc lộ ra sau khi bốc hết các đợt trước', group: GROUP.order })
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
        // Different: mỗi loại không cần chia hết cho cupsPerOrder, chỉ tổng cốc quyết định số đơn.
        // Same: mỗi loại tự chia thành các đơn. Phần dư không thuộc đơn nào: thắng khi đủ
        // totalOrders đơn, không cần bốc hết cốc dư.
        const total = tiles.filter(t => !t.collected).length;
        let orders = Math.floor(total / this.cupsPerOrder);
        if (this.orderMode === OrderMode.Same) {
            orders = 0;
            this.unassigned.forEach(n => (orders += Math.floor(n / this.cupsPerOrder)));
        }
        const leftover = total - orders * this.cupsPerOrder;
        if (leftover) console.warn(`[OrderManager] ${total} cups, ${leftover} cup(s) will not be ordered (mode ${OrderMode[this.orderMode]})`);
        this.totalOrders = orders;
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

        const target = this.findSlot(tile.drinkId);
        if (!target && this.tray?.isFull()) return; // Khay đầy: không nhận thêm, không mất cốc.

        // Cốc rời bàn ngay (model), node vẫn giữ lại để nhảy lên khách hoặc khay.
        this.itemManager.detachTile(tile);
        Ply_SoundManager.Ins?.playFxOneShot(FxType.TapTile);
        // Giao thẳng vào ô đang chờ cùng loại; nếu không khách nào cần thì cất tạm vào khay chờ.
        if (target) this.deliver(target.order, target.index, tile);
        else this.tray?.add(tile);
        this.checkLose();
    }

    /**
     * Ô chưa giữ chỗ cần loại `drinkId` trong các đơn đang nhận cốc (bỏ qua khách đang bỏ đi / đã xong).
     * Nhiều khách cùng cần: ưu tiên khách gần hoàn thành (nhiều ô đã giữ chỗ nhất) để khách đi sớm.
     */
    private findSlot(drinkId: number): { order: Order; index: number } | null {
        let best: { order: Order; index: number } | null = null;
        let bestFilled = -1;
        for (const o of this.active) {
            if (!o || o.done || o.leaving) continue;
            const index = o.slots.findIndex(s => s.state === SlotState.Empty && s.drinkId === drinkId);
            if (index < 0) continue;
            const filled = filledCount(o);
            if (filled > bestFilled) {
                best = { order: o, index };
                bestFilled = filled;
            }
        }
        return best;
    }

    /** Giao cốc vào ô `index` của đơn: giữ chỗ ngay, cốc nhảy lên đúng ô; đủ cả đơn đáp xong thì khách rời đi. */
    private deliver(order: Order, index: number, tile: DrinkTile): void {
        const slot = this.active.indexOf(order);
        // Giữ chỗ ngay khi bắt đầu bay để cốc bấm tiếp (kể cả bấm nhanh) không vào trùng ô.
        order.slots[index].state = SlotState.Flying;
        // Đã giữ chỗ đủ cả đơn (kể cả cốc đang bay): khách không còn chờ nữa.
        if (filledCount(order) === order.slots.length) this.timerOf(slot)?.stop();
        this.customers[slot].receive(tile.node, index, () => {
            // Chỉ tính là đã tới nơi sau khi animation đáp xuống hoàn tất.
            order.slots[index].state = SlotState.Landed;
            // Khách đang bỏ đi: khách thay thế sẽ kiểm tra đủ đơn khi vào (replaceCustomer).
            if (!order.done && !order.leaving && allLanded(order)) this.complete(order, slot);
            // Hết cốc bay mà khay đầy, không còn nước đi: thua ngay chứ không treo màn.
            else this.checkLose();
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
        const drinks = this.pickOrder();
        if (!drinks) return;
        // Dành cốc cho đơn ngay khi tạo: đơn khác không thể gọi lại chính những cốc này.
        for (const id of drinks) this.unassigned.set(id, (this.unassigned.get(id) ?? 0) - 1);
        const order: Order = {
            slots: drinks.map(drinkId => ({ drinkId, state: SlotState.Empty })),
            done: false,
            leaving: false,
            cancelled: false,
            fixedTime,
        };
        this.active[slot] = order;
        this.showCustomer(slot, order, talk, instant);
    }

    /**
     * Cho một khách (avatar kế tiếp) vào nhận đơn `order` ở chỗ `slot` và giao luôn cốc đúng loại
     * đang chờ trong khay vào đúng ô còn trống; đồng hồ chỉ hiện khi khách đã trượt vào tới chỗ đứng.
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
        const frames = order.slots.map(s => this.mapBuilder?.drinkFrames[s.drinkId] ?? null);
        customer.show(avatar, frames, talk, instant, () => this.startTimer(slot, order), look);
        // Đơn dở (khách thay thế): khôi phục từng ô theo trạng thái riêng, không suy từ tổng số cốc.
        if (filledCount(order) > 0) {
            customer.restoreProgress(
                order.slots.map(s => s.state !== SlotState.Empty),
                order.slots.map(s => s.state === SlotState.Landed),
            );
        }

        // Tự chuyển cốc đúng loại đang chờ trong khay vào từng ô còn trống.
        order.slots.forEach((s, index) => {
            if (s.state !== SlotState.Empty) return;
            const tile = this.tray?.take(s.drinkId, 1)[0];
            if (tile) this.deliver(order, index, tile);
        });
    }

    /**
     * Khách đã đứng vào chỗ: bật đồng hồ nếu vẫn còn chờ cốc (trong lúc trượt vào có thể đã được giao
     * đủ từ khay). Trước click cốc đầu tiên đồng hồ ẩn và đứng yên; đã ra store thì đứng yên.
     */
    private startTimer(slot: number, order: Order): void {
        if (!this.useTimer || this.finished || this.active[slot] !== order || order.leaving || filledCount(order) >= order.slots.length) return;
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

    /**
     * Hết giờ: khách bỏ đi (1 lần sai); sai đủ `maxWalkouts` lần thì thua và mở store,
     * nếu không thì khách khác vào thay.
     */
    private onTimeout(slot: number): void {
        const order = this.active[slot];
        if (this.finished || !order || order.done || order.leaving || filledCount(order) >= order.slots.length) return;
        order.leaving = true;
        this.walkouts++;
        if (this.maxWalkouts > 0 && this.walkouts >= this.maxWalkouts) {
            this.lose('walkouts');
            gc?.redirectToStore();
        }
        this.customers[slot].angryLeave(() => this.replaceCustomer(slot, order));
    }

    /**
     * Khách thay thế khách bỏ đi. Đơn chưa giữ chỗ ô nào: hủy đơn, trả đúng các cốc của đơn về
     * inventory (một lần) và gọi đơn mới như bình thường. Đơn dở (có ô đã nhận / đang bay tới):
     * khách mới nhận tiếp đúng đơn đó, cốc trên đĩa giữ nguyên nên không mất cốc nào.
     */
    private replaceCustomer(slot: number, order: Order): void {
        if (this.finished) return;
        order.leaving = false;
        if (filledCount(order) === 0) {
            if (!order.cancelled) {
                order.cancelled = true;
                for (const s of order.slots) this.unassigned.set(s.drinkId, (this.unassigned.get(s.drinkId) ?? 0) + 1);
            }
            this.active[slot] = null;
            this.spawnCustomer(slot);
        } else {
            this.showCustomer(slot, order);
            // Cốc cuối đã đáp trong lúc khách cũ bỏ đi: khách thay thế nhận đủ đơn ngay.
            if (!order.done && allLanded(order)) this.complete(order, slot);
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


    /** Loại cốc cho đơn mới theo `orderMode`; null khi inventory còn lại không đủ một đơn. */
    private pickOrder(): number[] | null {
        if (this.orderMode === OrderMode.Same) {
            const id = this.pickSameDrink();
            return id === null ? null : new Array<number>(this.cupsPerOrder).fill(id);
        }
        return this.pickDifferentOrder();
    }

    /**
     * Mode Different: rút ngẫu nhiên cupsPerOrder loại khác nhau cho đơn mới từ inventory `unassigned`
     * (rút không hoàn lại: không gọi quá số cốc còn lại của từng loại). Cuối màn còn ít loại hơn số
     * cốc một đơn thì mới cho lặp loại. Trả về null khi tổng cốc chưa dành không đủ một đơn.
     *
     * Cốc đang nằm trong khay được đưa vào đơn trước (giải phóng khay, mỗi loại 1 cốc).
     * Các ô còn lại rút có trọng số nghiêng về loại lấy được sớm: "cung gần" = cốc trong khay + cốc
     * lộ / sắp lộ trên bàn (tối đa `lookahead` đợt bốc) − các ô đang chờ của khách khác cùng loại.
     * Loại chỉ có cốc nằm sâu vẫn có thể được gọi nhưng với xác suất rất thấp.
     * Đây là thiên vị, không phải bảo đảm có đường thắng.
     */
    private pickDifferentOrder(): number[] | null {
        const need = this.cupsPerOrder;
        const left = new Map<number, number>();
        let total = 0;
        this.unassigned.forEach((n, id) => {
            if (n <= 0) return;
            left.set(id, n);
            total += n;
        });
        if (total < need) return null;

        const near = new Map<number, number>();
        const inTray = new Map<number, number>();
        const reach = this.itemManager?.reachableByDepth(this.lookahead) ?? [];
        for (const counts of reach) counts.forEach((n, id) => near.set(id, (near.get(id) ?? 0) + n));
        left.forEach((_, id) => {
            const n = this.tray?.count(id) ?? 0;
            inTray.set(id, n);
            near.set(id, (near.get(id) ?? 0) + n);
        });
        // Cốc gần đã được dành cho ô đang chờ của khách khác thì không tính là cung gần nữa.
        for (const o of this.active) {
            if (!o || o.done) continue;
            for (const s of o.slots) if (s.state === SlotState.Empty) near.set(s.drinkId, (near.get(s.drinkId) ?? 0) - 1);
        }

        const drinks: number[] = [];
        const picked = new Map<number, number>();
        const take = (id: number): void => {
            drinks.push(id);
            picked.set(id, (picked.get(id) ?? 0) + 1);
            left.set(id, left.get(id)! - 1);
            near.set(id, (near.get(id) ?? 0) - 1);
            inTray.set(id, Math.max(0, (inTray.get(id) ?? 0) - 1));
        };
        // Cốc trong khay chưa khách nào cần (luôn nằm trong `unassigned`) được đưa vào đơn trước, loại
        // nhiều cốc trong khay nhất trước, để mỗi khách mới giải phóng khay; mỗi loại 1 cốc vì đơn khác loại.
        const trayIds = Array.from(inTray.keys()).filter(id => inTray.get(id)! > 0).sort((a, b) => inTray.get(b)! - inTray.get(a)!);
        for (const id of trayIds) {
            if (drinks.length < need && left.get(id)! > 0) take(id);
        }
        while (drinks.length < need) {
            // Chỉ rút loại chưa có trong đơn; cuối màn không còn đủ loại khác nhau thì mới cho lặp loại
            // (bắt buộc để mọi cốc còn lại vẫn chia hết vào đơn).
            let fresh = false;
            left.forEach((n, id) => {
                if (n > 0 && !picked.has(id)) fresh = true;
            });
            const weights: { id: number; w: number }[] = [];
            let sum = 0;
            left.forEach((n, id) => {
                if (n <= 0 || (fresh && picked.has(id))) return;
                const free = near.get(id) ?? 0;
                const w = (free > 0 ? 1 + 3 * Math.min(free, need) + 2 * (inTray.get(id) ?? 0) : 0.05) * Math.sqrt(n);
                weights.push({ id, w });
                sum += w;
            });
            let r = Math.random() * sum;
            let id = weights[weights.length - 1].id;
            for (const e of weights) {
                r -= e.w;
                if (r < 0) {
                    id = e.id;
                    break;
                }
            }
            take(id);
        }
        // Xáo vị trí trên đĩa để cốc lấy từ khay không luôn nằm bên trái.
        for (let i = drinks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = drinks[i];
            drinks[i] = drinks[j];
            drinks[j] = t;
        }
        return drinks;
    }

    /**
     * Mode Same: chọn loại đồ uống dễ phục vụ nhất cho đơn cupsPerOrder cốc cùng loại (thuật toán của
     * cơ chế cũ). Số cốc "còn trống" của một loại = cốc trong khay + cốc lấy được trên bàn − các ô
     * đang chờ cùng loại của khách đang đứng, để không có 2 khách cùng đòi 6 cốc khi bàn chỉ lộ 2 cốc.
     * Điểm ưu tiên:
     * 1. Đủ một đơn với số cốc còn trống sau ít đợt bốc nhất (0 = đang lộ, tối đa `lookahead`).
     * 2. Số cốc còn trống lấy được ngay, tối đa bằng một đơn.
     * 3. Cốc trong khay, để giải phóng khay.
     * 4. Tránh trùng loại với khách đang đứng.
     */
    private pickSameDrink(): number | null {
        const need = this.cupsPerOrder;
        const reach = this.itemManager?.reachableByDepth(this.lookahead) ?? [new Map<number, number>()];
        let bestId: number | null = null;
        let bestScore = -Infinity;
        this.unassigned.forEach((left, id) => {
            // Không tạo đơn nếu số cốc còn lại không đủ cho một đơn hoàn chỉnh.
            if (left < need) return;
            const inTray = this.tray?.count(id) ?? 0;
            let reserved = 0;
            let waiting = 0;
            for (const o of this.active) {
                if (!o || o.done) continue;
                const open = o.slots.filter(s => s.drinkId === id && s.state === SlotState.Empty).length;
                reserved += open;
                if (o.slots.some(s => s.drinkId === id)) waiting++;
            }
            // Cộng dồn cốc lấy được theo từng đợt bốc; tìm đợt sớm nhất gom đủ một đơn.
            let free = inTray - reserved;
            let readyAt = -1;
            reach.forEach((counts, d) => {
                free += counts.get(id) ?? 0;
                if (readyAt < 0 && free >= need) readyAt = d;
            });
            const freeNow = inTray + (reach[0]?.get(id) ?? 0) - reserved;
            const tier = readyAt < 0 ? 0 : reach.length - readyAt;
            // `left` giúp phân định khi các điểm khác bằng nhau.
            const score = tier * 1000 + Math.max(0, Math.min(need, freeNow)) * 100 + inTray * 10 - waiting * 50 + left;
            if (score > bestScore) {
                bestScore = score;
                bestId = id;
            }
        });
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
        const canDeliver = (this.itemManager?.getSelectableTiles() ?? []).some(t => this.findSlot(t.drinkId));
        // Cốc đang bay / khách đang rời đi (vui hoặc giận, khách sau sẽ vào nhận đơn).
        const pending = this.active.some(o => o && (o.done || o.leaving || o.slots.some(s => s.state === SlotState.Flying)));
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
