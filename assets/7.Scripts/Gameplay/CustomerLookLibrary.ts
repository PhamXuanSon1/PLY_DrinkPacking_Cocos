import { _decorator, CCObject, Component, Enum, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { CustomerController, CustomerLook, Expression, faceUnit } from './CustomerController';
const { ccclass, property, executeInEditMode } = _decorator;

/** Các nhóm thuộc tính trong Inspector, mỗi nhóm là một header gập / mở được. */
const GROUP = {
    tool: { id: 'tool', name: 'Tool chỉnh mặt (editor)', displayOrder: 0, style: 'section' },
    data: { id: 'data', name: 'Nhân vật', displayOrder: 1, style: 'section' },
};

/**
 * Thư viện nhân vật khách (thân + 3 mặt) dùng chung cho OrderManager và TutorialManager,
 * kèm tool chỉnh vị trí / cỡ mặt ngay trong editor:
 * 1. Tick Preview, chọn Edit Index (nhân vật) và Edit Expression (biểu cảm).
 * 2. Khách giữa trong scene (hoặc Preview Target) hiện nhân vật đó; node "Face" trên Avatar là mặt.
 * 3. Chọn node Face rồi kéo (Move) / phóng to thu nhỏ (Scale) bằng gizmo — Offset / Scale của mặt
 *    đang chọn được ghi vào thư viện. Hoặc sửa số trực tiếp trong danh sách Looks.
 * 4. Ctrl+S lưu scene. Node Face xem trước không bị lưu.
 */
@ccclass('CustomerLookLibrary')
@executeInEditMode
export class CustomerLookLibrary extends Component {
    @property({ type: [CustomerLook], tooltip: 'Các nhân vật khách', group: GROUP.data })
    looks: CustomerLook[] = [];

    @property({ type: CustomerController, tooltip: 'Khách dùng để xem trước. Để trống = khách đứng giữa', group: GROUP.tool })
    previewTarget: CustomerController | null = null;

    @property
    private _preview = false;

    @property({ tooltip: 'Bật: hiện nhân vật đang chỉnh lên khách trong scene để chỉnh mặt', group: GROUP.tool })
    get preview(): boolean {
        return this._preview;
    }
    set preview(v: boolean) {
        this._preview = v;
        this.last = null;
        if (EDITOR) v ? this.syncPreview() : this.clearPreview();
    }

    @property
    private _editIndex = 0;

    @property({ tooltip: 'Nhân vật đang chỉnh (số thứ tự trong Looks)', group: GROUP.tool })
    get editIndex(): number {
        return this._editIndex;
    }
    set editIndex(v: number) {
        this._editIndex = Math.max(0, Math.min(Math.round(v), Math.max(0, this.looks.length - 1)));
        this.last = null;
        if (EDITOR) this.syncPreview();
    }

    @property
    private _editExpression = Expression.Normal;

    @property({ type: Enum(Expression), tooltip: 'Biểu cảm đang chỉnh', group: GROUP.tool })
    get editExpression(): Expression {
        return this._editExpression;
    }
    set editExpression(v: Expression) {
        this._editExpression = v;
        this.last = null;
        if (EDITOR) this.syncPreview();
    }

    @property({ readonly: true, tooltip: 'Trạng thái tool', group: GROUP.tool })
    info = '';

    /** Lần đặt node Face gần nhất, để nhận ra người dùng vừa kéo / scale node đó. */
    private last: { face: Node; look: CustomerLook; expression: Expression; x: number; y: number } | null = null;

    update(): void {
        if (EDITOR && this._preview) this.syncPreview();
    }

    onDisable(): void {
        if (EDITOR) this.clearPreview();
    }

    /** Khách xem trước: Preview Target, hoặc khách đứng gần giữa màn hình nhất. */
    private target(): CustomerController | null {
        if (this.previewTarget?.isValid) return this.previewTarget;
        const all = this.node.scene?.getComponentsInChildren(CustomerController) ?? [];
        if (!all.length) return null;
        const xs = all.map(c => c.node.worldPosition.x);
        const center = (Math.min(...xs) + Math.max(...xs)) / 2;
        let best = 0;
        xs.forEach((x, i) => {
            if (Math.abs(x - center) < Math.abs(xs[best] - center)) best = i;
        });
        return all[best];
    }

    private syncPreview(): void {
        const look = this.looks[this._editIndex];
        const target = this.target();
        const expression = this._editExpression;
        if (!look?.body) return void (this.info = 'Nhân vật chưa có ảnh thân (Body)');
        if (!target?.avatar) return void (this.info = 'Không tìm thấy khách để xem trước');
        if (!target.node.activeInHierarchy) return void (this.info = 'Khách xem trước đang ẩn (chọn View Gameplay / Intro)');
        const setting = look.face(expression);
        const avatar = target.avatar.node;
        const face = target.getFaceNode(true, true);
        if (!face) return;
        // Người dùng vừa kéo / scale node Face: ghi ngược Offset / Scale vào thư viện.
        const last = this.last;
        if (last && last.face === face && last.look === look && last.expression === expression) {
            const p = face.position;
            const s = face.scale.x;
            if (Math.abs(p.x - last.x) > 0.01 || Math.abs(p.y - last.y) > 0.01 || Math.abs(s - 1) > 0.001) {
                const k = faceUnit(avatar, look.body);
                setting.offset.set(round1(p.x / k), round1(p.y / k));
                if (s > 0) setting.scale = Math.round(setting.scale * s * 1000) / 1000;
            }
        }
        target.applyLook(look, expression, true);
        this.last = { face, look, expression, x: face.position.x, y: face.position.y };
        this.info = `${look.name || 'Look ' + this._editIndex} / ${Expression[expression]}: offset (${setting.offset.x}, ${setting.offset.y}), scale ${setting.scale}`;
    }

    /** Tắt xem trước: gỡ node Face tạm (chỉ node không lưu). */
    private clearPreview(): void {
        const face = this.target()?.getFaceNode(false);
        if (face?.isValid && (face.hideFlags & CCObject.Flags.DontSave)) {
            face.removeFromParent();
            face.destroy();
        }
        this.last = null;
        this.info = '';
    }
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}
