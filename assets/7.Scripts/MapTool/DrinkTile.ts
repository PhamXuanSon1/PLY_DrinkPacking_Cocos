import { _decorator, Color, Component, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Dữ liệu của một cốc trên bảng. LevelMapBuilder điền dữ liệu khi tạo bản đồ;
 * DrinkItemManager đọc và quản lý trạng thái khi chạy (bị che, đã thu thập).
 */
@ccclass('DrinkTile')
export class DrinkTile extends Component {
    @property({ tooltip: 'Chỉ số lớp, 0 là lớp dưới cùng' })
    layer = 0;

    @property({ tooltip: 'Cột trong lưới của lớp' })
    x = 0;

    @property({ tooltip: 'Hàng trong lưới của lớp, 0 là hàng trên cùng' })
    y = 0;

    @property({ tooltip: 'Mã đồ uống (khớp với drink_<id>.png và tệp JSON màn chơi)' })
    drinkId = 0;

    /** Bị một ô ở lớp cao hơn che. Được DrinkItemManager thiết lập. */
    covered = false;

    /** Đã được lấy khỏi bảng. Được DrinkItemManager thiết lập. */
    collected = false;

    /** Đổi màu thẻ và node con "Cup"; bỏ trống `cupColor` thì cốc dùng cùng màu với thẻ. */
    setTint(color: Color, cupColor: Color = color): void {
        const card = this.getComponent(Sprite);
        if (card) card.color = color;
        const cup = this.node.getChildByName('Cup')?.getComponent(Sprite);
        if (cup) cup.color = cupColor;
    }
}
