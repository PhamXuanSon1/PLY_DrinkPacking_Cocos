import { _decorator, Component, Node } from 'cc';
import { DrinkTile } from '../MapTool/DrinkTile';
import { jumpTo } from './TileJump';
const { ccclass, property } = _decorator;

/**
 * Khay chờ: giữ chính các node cốc chưa có khách nhận. Cốc nhảy lên slot trống đầu tiên
 * và luôn được dồn về bên trái khi có cốc bị lấy đi.
 */
@ccclass('WaitTray')
export class WaitTray extends Component {
    @property({ type: [Node], tooltip: 'Các node slot, theo thứ tự trái sang phải' })
    slots: Node[] = [];

    /** Cốc theo slot, đã dồn trái. */
    private tiles: DrinkTile[] = [];

    /** Xóa khay (hủy các cốc đang nằm trong khay). */
    reset(): void {
        for (const t of this.tiles) t.node.destroy();
        this.tiles = [];
    }

    isFull(): boolean {
        return this.tiles.length >= this.slots.length;
    }

    count(drinkId: number): number {
        return this.tiles.filter(t => t.drinkId === drinkId).length;
    }

    /** Cho cốc nhảy lên slot trống đầu tiên; trả về false nếu khay đầy. */
    add(tile: DrinkTile): boolean {
        if (this.isFull()) return false;
        this.tiles.push(tile);
        this.place(tile, this.tiles.length - 1, 150);
        return true;
    }

    /** Lấy ra tối đa `max` cốc cùng loại (chưa đổi parent), rồi dồn các cốc còn lại. */
    take(drinkId: number, max: number): DrinkTile[] {
        const taken: DrinkTile[] = [];
        this.tiles = this.tiles.filter(t => {
            if (t.drinkId !== drinkId || taken.length >= max) return true;
            taken.push(t);
            return false;
        });
        if (taken.length > 0) this.tiles.forEach((t, i) => this.place(t, i, 0));
        return taken;
    }

    private place(tile: DrinkTile, index: number, height: number): void {
        const slot = this.slots[index];
        jumpTo(tile.node, slot, slot, null, undefined, 0.3, height);
    }
}
