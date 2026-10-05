import { _decorator, Color, Component, Node, UITransform, Vec3 } from 'cc';
import { DrinkTile } from './DrinkTile';
import { MAP_BUILT_EVENT } from './LevelMapBuilder';
const { ccclass, property, executeInEditMode } = _decorator;

/** Độ chồng lấp tối thiểu theo mỗi trục (px); chạm cạnh hoặc chồng lấp không quá 2 px thì không tính là bị che. */
const COVER_EPS = 2;

/**
 * Quản lý các ô của bản đồ đã tạo: tìm mọi DrinkTile bên dưới node này,
 * xác định ô nào bị che và đổi màu chúng. LevelMapBuilder chỉ tạo các node.
 *
 * Quy tắc che: một ô bị che khi có bất kỳ ô nào ở lớp cao hơn chồng lấp lên phạm vi
 * của nó (kích thước thẻ và vị trí), bất kể cách nhau bao nhiêu lớp. Trạng thái che
 * chỉ có hai giá trị: mọi ô bị che đều dùng cùng màu `coveredColor`.
 */
@ccclass('DrinkItemManager')
@executeInEditMode
export class DrinkItemManager extends Component {
    @property({ type: Node, tooltip: 'Node chứa bản đồ (LevelMapBuilder). Để trống = chính node này' })
    boardRoot: Node | null = null;

    @property({ tooltip: 'Màu phủ cho ô bị che bởi lớp cao hơn' })
    coveredColor = new Color(168, 162, 158, 255);

    /** Bật trong Inspector để quét lại bản đồ; giá trị tự trở về false sau khi kích hoạt. */
    @property({ tooltip: 'Đánh dấu để quét lại các ô và tính lại trạng thái bị che' })
    get refreshNow(): boolean {
        return false;
    }
    set refreshNow(v: boolean) {
        if (v) this.refresh();
    }

    /** Tóm tắt kết quả lần cập nhật gần nhất: tổng số ô, số ô bị che và số ô có thể chọn. */
    @property({ readonly: true, tooltip: 'Kết quả của lần cập nhật gần nhất' })
    info = '';

    /** Tất cả DrinkTile nằm dưới node quản lý, bao gồm cả ô đã được thu thập. */
    private tiles: DrinkTile[] = [];

    /** Node chứa các cốc: boardRoot nếu được gán, ngược lại là chính node này. */
    private get board(): Node {
        return this.boardRoot ?? this.node;
    }

    onLoad(): void {
        // Cập nhật lại danh sách và trạng thái khi LevelMapBuilder phát sự kiện tạo bản đồ.
        this.board.on(MAP_BUILT_EVENT, this.refresh, this);
    }

    onDestroy(): void {
        // Hủy đăng ký để tránh gọi refresh sau khi component bị hủy.
        this.board.off(MAP_BUILT_EVENT, this.refresh, this);
    }

    start(): void {
        // Tính trạng thái ban đầu khi scene bắt đầu, kể cả khi bản đồ đã có sẵn.
        this.refresh();
    }

    /**
     * Quét lại các DrinkTile bên dưới node này, bỏ qua ô đã thu thập rồi tính lại trạng thái che.
     * Đổi màu từng ô theo trạng thái và cập nhật info; trả về số ô hiện đang bị che.
     */
    refresh(): number {
        this.tiles = this.board.getComponentsInChildren(DrinkTile);
        const onBoard = this.tiles.filter(t => !t.collected);
        let covered = 0;
        for (const t of onBoard) {
            // Chỉ ô ở lớp cao hơn mới che được ô hiện tại; chỉ cần một ô chồng lấp là đủ.
            t.covered = onBoard.some(o => o.layer > t.layer && this.overlaps(t, o));
            t.setTint(t.covered ? this.coveredColor : Color.WHITE);
            if (t.covered) covered++;
        }
        this.info = `${onBoard.length} ô, ${covered} ô bị che, ${onBoard.length - covered} ô có thể chọn`;
        return covered;
    }

    /** Trả về danh sách DrinkTile đã quét gần nhất; kiểu readonly ngăn bên gọi sửa danh sách này. */
    getTiles(): readonly DrinkTile[] {
        return this.tiles;
    }

    /** Ô có thể chọn khi chưa bị thu thập và không bị ô ở lớp cao hơn che. */
    isSelectable(t: DrinkTile): boolean {
        return !t.collected && !t.covered;
    }

    /** Lọc danh sách đã quét để lấy các ô hiện có thể tương tác. */
    getSelectableTiles(): DrinkTile[] {
        return this.tiles.filter(t => this.isSelectable(t));
    }

    /** Đánh dấu ô đã thu thập, ẩn node và quét lại để cập nhật trạng thái các ô còn trên bảng. */
    removeTile(t: DrinkTile): void {
        if (t.collected) return;
        t.collected = true;
        t.node.active = false;
        this.refresh();
    }

    /** Đánh dấu ô đã thu thập nhưng giữ node hiển thị (để cốc bay đi chỗ khác), rồi quét lại. */
    detachTile(t: DrinkTile): void {
        if (t.collected) return;
        t.collected = true;
        this.refresh();
    }

    /**
     * Kiểm tra chồng lấp hình chữ nhật trong không gian cục bộ của node quản lý.
     * Tính phần giao theo chiều rộng và chiều cao; cả hai đều phải lớn hơn COVER_EPS.
     */
    private overlaps(a: DrinkTile, b: DrinkTile): boolean {
        const pa = this.localPos(a);
        const pb = this.localPos(b);
        const sa = a.node.getComponent(UITransform)!.contentSize;
        const sb = b.node.getComponent(UITransform)!.contentSize;
        // Khoảng chồng lấp bằng nửa tổng kích thước trừ khoảng cách giữa hai tâm.
        const w = (sa.width + sb.width) / 2 - Math.abs(pa.x - pb.x);
        const h = (sa.height + sb.height) / 2 - Math.abs(pa.y - pb.y);
        return w > COVER_EPS && h > COVER_EPS;
    }

    /** Chuyển vị trí world của ô sang cùng hệ tọa độ cục bộ để so sánh với các ô khác. */
    private localPos(t: DrinkTile): Vec3 {
        return this.board.getComponent(UITransform)!.convertToNodeSpaceAR(t.node.worldPosition);
    }
}
