import { _decorator, Component, find, Label, Node, SpriteFrame, Vec2 } from 'cc';
import { gc } from '../Tool/GameController';
import { DrinkItemManager } from '../MapTool/DrinkItemManager';
import { DrinkTile } from '../MapTool/DrinkTile';
import { LevelMapBuilder } from '../MapTool/LevelMapBuilder';
import { CustomerController } from './CustomerController';
import { WaitTray } from './WaitTray';
import { FxType, Ply_SoundManager } from '../MyScript/ScriptTemplate/Ply_SoundManager';
const { ccclass, property } = _decorator;

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

/** Một đơn: cupsPerOrder ô, mỗi ô một loại (tối đa `maxTypesPerOrder` loại, ví dụ [A, A, B]). */
interface Order {
    slots: OrderSlot[];
    done: boolean;
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
 * Mỗi đơn gồm cupsPerOrder ô, tối đa `maxTypesPerOrder` loại. Loại cốc lấy từ inventory thực tế
 * của màn: `unassigned` = số cốc mỗi loại chưa dành cho đơn nào, tạo đơn thì trừ. Nhờ vậy tổng cốc
 * trên bàn + khay + đơn luôn bằng tổng cốc lúc bắt đầu. Xác suất rút nghiêng về loại đang lấy được
 * ngay (cốc trong khay, cốc lộ / sắp lộ trên bàn, trừ phần các đơn đang chờ đã dành) để giảm nguy cơ bí.
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

    @property({ tooltip: 'Mỗi đơn tối đa bấy nhiêu loại đồ uống (vd 2 → [A, A, B]); cuối màn thiếu cốc thì cho thêm loại. 1 = mỗi đơn một loại' })
    maxTypesPerOrder = 2;

    @property({ tooltip: 'Khi rút loại cho đơn mới, tính cả cốc sẽ lộ sau tối đa bao nhiêu đợt bốc (0 = chỉ cốc đang lộ). Đợt d = cốc lộ ra sau khi bốc hết các đợt trước' })
    lookahead = 2;

    @property({ tooltip: 'Cứ ngẫu nhiên [x, y] khách mới vào thì có 1 khách nói (CustomerChat). Khách giữa luôn nói khi bắt đầu màn' })
    chatEvery = new Vec2(2, 3);

    @property({ tooltip: 'Tự bắt đầu màn khi vào scene. TutorialManager tắt cờ này và tự gọi startLevel() khi tutorial xong' })
    autoStart = true;

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

    start(): void {
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
        // Mỗi loại không cần chia hết cho cupsPerOrder, chỉ tổng cốc quyết định số đơn; phần dư không
        // thuộc đơn nào (thắng khi đủ totalOrders đơn, không cần bốc hết cốc dư).
        const total = tiles.filter(t => !t.collected).length;
        if (total % this.cupsPerOrder) console.warn(`[OrderManager] ${total} cups, ${total % this.cupsPerOrder} cup(s) will not be ordered`);
        this.totalOrders = Math.floor(total / this.cupsPerOrder);
        this.served = 0;
        this.spawned = 0;
        this.finished = false;
        this.tray?.reset();
        // Mỗi vị trí bắt đầu chưa có đơn; gọi khách cho từng vị trí bên dưới.
        this.active = this.customers.map(() => null);
        // Lượt đầu chỉ khách đứng giữa nói; sau đó đếm lại từ đầu.
        const middle = this.middleSlot();
        this.customers.forEach((c, i) => {
            c.node.active = false;
            // Lượt khách đầu màn đứng sẵn ở quầy, không trượt vào.
            this.spawnCustomer(i, i === middle, true);
        });
        this.resetChatCountdown();
        this.updateLabel();
        this.node.emit(LEVEL_START_EVENT);
    }

    private onTileTouched(event: { currentTarget: Node }): void {
        const tile = event.currentTarget.getComponent(DrinkTile);
        // Bỏ qua cốc không hợp lệ, màn đã xong, đã ra store (GameController.stopGame: click lúc này chỉ
        // mở lại store, xem StoreRedirect), hoặc cốc đang bị che / không chọn được.
        if (!tile || this.finished || gc?.stopped || !this.itemManager?.isSelectable(tile)) return;

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

    /** Ô đang chờ cùng loại, ưu tiên đơn đã có nhiều cốc nhất để khách đi sớm. */
    private findSlot(drinkId: number): { order: Order; index: number } | null {
        let best: { order: Order; index: number } | null = null;
        let bestFilled = -1;
        for (const o of this.active) {
            if (!o || o.done) continue;
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
        this.customers[slot].receive(tile.node, index, () => {
            // Chỉ tính là đã tới nơi sau khi animation đáp xuống hoàn tất.
            order.slots[index].state = SlotState.Landed;
            if (!order.done && allLanded(order)) this.complete(order, slot);
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
    private spawnCustomer(slot: number, talk?: boolean, instant = false): void {
        const drinks = this.pickOrder();
        if (!drinks) return;
        // Dành cốc cho đơn ngay khi tạo: đơn khác không thể gọi lại chính những cốc này.
        for (const id of drinks) this.unassigned.set(id, (this.unassigned.get(id) ?? 0) - 1);
        const order: Order = { slots: drinks.map(drinkId => ({ drinkId, state: SlotState.Empty })), done: false };
        this.active[slot] = order;
        // Xoay vòng avatar theo thứ tự khách được tạo.
        const avatar = this.avatarFrames.length ? this.avatarFrames[this.spawned % this.avatarFrames.length] : null;
        this.spawned++;
        if (talk === undefined) {
            talk = --this.chatCountdown <= 0;
            if (talk) this.resetChatCountdown();
        }
        const frames = drinks.map(id => this.mapBuilder?.drinkFrames[id] ?? null);
        this.customers[slot].show(avatar, frames, talk, instant);

        // Tự chuyển cốc đúng loại đang chờ trong khay vào từng ô còn trống.
        order.slots.forEach((s, index) => {
            if (s.state !== SlotState.Empty) return;
            const tile = this.tray?.take(s.drinkId, 1)[0];
            if (tile) this.deliver(order, index, tile);
        });
    }

    /**
     * Rút ngẫu nhiên cupsPerOrder cốc cho đơn mới từ inventory `unassigned` (rút không hoàn lại:
     * không gọi quá số cốc còn lại của từng loại). Rút loại mới cho tới khi đủ `maxTypesPerOrder`
     * loại, các ô còn lại lặp lại các loại đã chọn; hết cốc của các loại đó thì mới thêm loại khác.
     * Trả về null khi tổng cốc chưa dành không đủ một đơn.
     *
     * Cốc đang nằm trong khay được đưa vào đơn trước (giải phóng khay, mỗi loại 1 cốc).
     * Các ô còn lại chỉ rút trong nhóm loại lấy được sớm nhất: trước hết loại "lấy được ngay" (cốc trong
     * khay + cốc đang lộ, trừ ô đang chờ của khách khác); không đủ mới tới loại lộ ra sau 1, 2...
     * đợt bốc (tối đa `lookahead`). Trong nhóm đó rút ngẫu nhiên có trọng số.
     * Giúp dễ gom đủ đơn nhưng không bảo đảm luôn có đường thắng.
     */
    private pickOrder(): number[] | null {
        const need = this.cupsPerOrder;
        const maxTypes = Math.max(1, this.maxTypesPerOrder);
        const left = new Map<number, number>();
        let total = 0;
        this.unassigned.forEach((n, id) => {
            if (n <= 0) return;
            left.set(id, n);
            total += n;
        });
        if (total < need) return null;

        // Ô đang chờ của các khách khác: cốc gần nhất của loại đó đã được dành cho họ.
        const demand = new Map<number, number>();
        for (const o of this.active) {
            if (!o || o.done) continue;
            for (const s of o.slots) if (s.state === SlotState.Empty) demand.set(s.drinkId, (demand.get(s.drinkId) ?? 0) + 1);
        }
        // avail[d]: số cốc mỗi loại lấy được sau tối đa d đợt bốc (khay + cốc lộ ở đợt 0..d) − phần đã dành.
        // Đợt 0 = cốc trong khay + cốc đang lộ, tức "lấy được ngay".
        const inTray = new Map<number, number>();
        const run = new Map<number, number>();
        left.forEach((_, id) => {
            const n = this.tray?.count(id) ?? 0;
            inTray.set(id, n);
            run.set(id, n);
        });
        const reach = this.itemManager?.reachableByDepth(this.lookahead) ?? [];
        const avail: Map<number, number>[] = [];
        for (let d = 0; d < Math.max(1, reach.length); d++) {
            reach[d]?.forEach((n, id) => run.set(id, (run.get(id) ?? 0) + n));
            const m = new Map<number, number>();
            run.forEach((n, id) => m.set(id, n - (demand.get(id) ?? 0)));
            avail.push(m);
        }

        const drinks: number[] = [];
        const picked = new Map<number, number>();
        const take = (id: number): void => {
            drinks.push(id);
            picked.set(id, (picked.get(id) ?? 0) + 1);
            left.set(id, left.get(id)! - 1);
            for (const m of avail) m.set(id, (m.get(id) ?? 0) - 1);
            inTray.set(id, Math.max(0, (inTray.get(id) ?? 0) - 1));
        };
        // Cốc trong khay chưa khách nào cần (luôn nằm trong `unassigned`) được đưa vào đơn trước, loại
        // nhiều cốc trong khay nhất trước, để mỗi khách mới giải phóng khay.
        const trayIds = Array.from(inTray.keys()).filter(id => inTray.get(id)! > 0).sort((a, b) => inTray.get(b)! - inTray.get(a)!);
        for (const id of trayIds) {
            if (drinks.length < need && picked.size < maxTypes && left.get(id)! > 0) take(id);
        }
        while (drinks.length < need) {
            // Chưa đủ `maxTypes` loại: chỉ rút loại chưa có trong đơn. Đủ rồi: chỉ lặp lại các loại đã chọn.
            // Không còn cốc phù hợp (cuối màn) thì rút loại bất kỳ còn cốc, để mọi cốc vẫn chia hết vào đơn.
            const wantNew = picked.size < maxTypes;
            const candidates: number[] = [];
            left.forEach((n, id) => {
                if (n > 0 && picked.has(id) !== wantNew) candidates.push(id);
            });
            if (candidates.length === 0) left.forEach((n, id) => n > 0 && candidates.push(id));
            // Chỉ gọi loại lấy được sớm nhất có thể: ưu tiên loại lấy được ngay (đợt 0), không có mới
            // tới loại lộ ra sau 1, 2... đợt bốc; cốc nằm sâu hơn `lookahead` chỉ gọi khi không còn cách nào.
            let tier = -1;
            for (let d = 0; d < avail.length && tier < 0; d++) {
                if (candidates.some(id => (avail[d].get(id) ?? 0) > 0)) tier = d;
            }
            const weights: { id: number; w: number }[] = [];
            let sum = 0;
            for (const id of candidates) {
                const free = tier >= 0 ? avail[tier].get(id) ?? 0 : 1;
                if (free <= 0) continue;
                const w = (1 + Math.min(free, need) + 2 * (inTray.get(id) ?? 0)) * Math.sqrt(left.get(id)!);
                weights.push({ id, w });
                sum += w;
            }
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

    private checkWin(): void {
        // Chỉ thắng khi mọi đơn đều đã được phục vụ và chưa có kết quả kết thúc trước đó.
        if (this.finished || this.served < this.totalOrders) return;
        this.finished = true;
        console.log('[OrderManager] WIN');
        this.node.emit(LEVEL_WIN_EVENT);
    }

    /** Thua khi khay đầy và không cốc lộ nào giao được cho khách đang chờ. */
    private checkLose(): void {
        if (this.finished || !this.tray?.isFull()) return;
        const canDeliver = (this.itemManager?.getSelectableTiles() ?? []).some(t => this.findSlot(t.drinkId));
        // Cốc đang bay / khách đang rời đi.
        const pending = this.active.some(o => o && (o.done || o.slots.some(s => s.state === SlotState.Flying)));
        // Chưa thua nếu còn nước đi hợp lệ hoặc animation/khách rời đi chưa xử lý xong.
        if (canDeliver || pending) return;
        this.finished = true;
        console.log('[OrderManager] LOSE');
        Ply_SoundManager.Ins?.playFail();
        this.node.emit(LEVEL_LOSE_EVENT);
    }

    private updateLabel(): void {
        // Hiển thị số đơn đã hoàn tất trên tổng số đơn của màn.
        if (this.progressLabel) this.progressLabel.string = `${this.served}/${this.totalOrders}`;
    }
}
