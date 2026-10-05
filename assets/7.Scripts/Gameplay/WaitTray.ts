import { _decorator, Component, Node } from 'cc';
import { DrinkTile } from '../MapTool/DrinkTile';
import { jumpTo, liftOff } from './TileJump';
const { ccclass, property } = _decorator;

/**
 * Khay chờ: giữ chính các node cốc chưa có khách nhận. Cốc nhảy lên slot trống đầu tiên
 * và luôn được dồn về bên trái khi có cốc bị lấy đi.
 */
@ccclass('WaitTray')
export class WaitTray extends Component {
    // Các điểm đặt cốc trong khay, sắp theo thứ tự từ trái sang phải.
    @property({ type: [Node], tooltip: 'Các node slot, theo thứ tự trái sang phải' })
    slots: Node[] = [];

    @property({ tooltip: 'Độ cao cung nhảy khi cốc vào khay' })
    jumpHeight = 150;

    @property({ tooltip: 'Cốc nhích lên bao nhiêu px trước khi bay vào khay (liftOff)' })
    liftHeight = 40;

    @property({ tooltip: 'Thời gian cốc nhích lên và thẻ nền mờ đi (giây)' })
    liftDuration = 0.15;

    @property({ tooltip: 'Thẻ nền phóng to tới bao nhiêu lần trong lúc mờ đi' })
    liftCardScale = 1.35;

    /** Danh sách cốc đang chờ; thứ tự phần tử khớp với thứ tự slot và luôn được dồn trái. */
    private tiles: DrinkTile[] = [];

    /** Xóa khay khi bắt đầu lại màn: hủy các node cốc đang chờ rồi làm rỗng danh sách. */
    reset(): void {
        for (const t of this.tiles) t.node.destroy();
        this.tiles = [];
    }

    /** Khay đầy khi số cốc đang chờ đã bằng số slot được cấu hình. */
    isFull(): boolean {
        return this.tiles.length >= this.slots.length;
    }

    /** Đếm số cốc có cùng drinkId đang nằm trong khay. */
    count(drinkId: number): number {
        return this.tiles.filter(t => t.drinkId === drinkId).length;
    }

    /**
     * Thêm cốc vào slot kế tiếp. Trả về false nếu khay đầy.
     * Cốc nhích lên và thẻ nền mờ đi (liftOff) trước, rồi mới nhảy vào slot.
     */
    add(tile: DrinkTile): boolean {
        if (this.isFull()) return false;

        // Ghi nhận ngay để slot này được xem là đã chiếm trong lúc cốc còn đang bay.
        this.tiles.push(tile);
        // Tính slot lúc bắt đầu nhảy vì khay có thể đã dồn trái trong lúc cốc đang nhích lên.
        liftOff(tile.node, () => {
            const index = this.tiles.indexOf(tile);
            if (index >= 0) this.place(tile, index, this.jumpHeight);
        }, this.liftHeight, this.liftDuration, this.liftCardScale);
        return true;
    }

    /**
     * Lấy tối đa `max` cốc có cùng drinkId khỏi danh sách và trả chúng cho bên gọi.
     * Parent của các cốc được lấy chưa đổi ở đây; bên nhận sẽ xử lý tiếp.
     */
    take(drinkId: number, max: number): DrinkTile[] {
        const taken: DrinkTile[] = [];
        this.tiles = this.tiles.filter(t => {
            // Giữ cốc khác loại và giữ lại cốc cùng loại nếu đã lấy đủ số lượng yêu cầu.
            if (t.drinkId !== drinkId || taken.length >= max) return true;
            taken.push(t);
            return false;
        });

        // Lấp các slot trống từ trái sang phải; height = 0 làm cốc đi thẳng tới slot.
        if (taken.length > 0) this.tiles.forEach((t, i) => this.place(t, i, 0));
        return taken;
    }

    /** Cho cốc bay tới slot theo chỉ số; height quyết định độ cao của cung nhảy. */
    private place(tile: DrinkTile, index: number, height: number): void {
        const slot = this.slots[index];
        const target = slot.getChildByName('Circle') ?? slot;
        jumpTo(tile.node, slot, target, null, undefined, 0.3, height);
    }
}
