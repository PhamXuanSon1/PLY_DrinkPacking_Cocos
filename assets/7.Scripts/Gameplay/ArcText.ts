import { _decorator, CCObject, Component, Label, Node, UITransform } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

/**
 * Chữ cong theo cung tròn (ví dụ chữ trên ruy băng). Đặt cùng node với một Label: Label đó chỉ dùng làm
 * mẫu (nội dung, font, cỡ, màu, viền) và bị ẩn; mỗi ký tự được sinh thành một node Label con, xếp dọc
 * theo cung tròn bán kính `radius` và xoay theo cung. Ký tự giữa nằm đúng tâm node.
 * Nếu chữ dài hơn bề rộng UITransform của node thì tự thu nhỏ cho vừa.
 * Các node ký tự không lưu vào scene và không hiện trong Hierarchy; chạy cả trong editor để xem trước.
 */
@ccclass('ArcText')
@requireComponent(Label)
@executeInEditMode
export class ArcText extends Component {
    @property({ tooltip: 'Bán kính cung (px). Càng nhỏ càng cong; số dương = cong lên (giữa cao), số âm = cong xuống' })
    get radius(): number {
        return this._radius;
    }
    set radius(v: number) {
        this._radius = v;
        this.rebuild();
    }

    @property({ tooltip: 'Khoảng cách thêm giữa các ký tự (px)' })
    get spacing(): number {
        return this._spacing;
    }
    set spacing(v: number) {
        this._spacing = v;
        this.rebuild();
    }

    @property({ tooltip: 'Tick để dựng lại sau khi sửa nội dung / style của Label' })
    get refresh(): boolean {
        return false;
    }
    set refresh(v: boolean) {
        if (v) this.rebuild();
    }

    @property
    private _radius = 800;

    @property
    private _spacing = 0;

    private chars: Node[] = [];

    onEnable(): void {
        this.rebuild();
    }

    onDisable(): void {
        this.clear();
        const label = this.getComponent(Label);
        if (label) label.enabled = true;
    }

    /** Đổi nội dung lúc chạy rồi dựng lại cung chữ. */
    setText(text: string): void {
        const label = this.getComponent(Label);
        if (!label) return;
        label.string = text;
        this.rebuild();
    }

    rebuild(): void {
        const label = this.getComponent(Label);
        if (!label || !this.enabledInHierarchy) return;
        this.clear();
        label.enabled = false;

        const text = [...label.string];
        const widths: number[] = [];
        for (const ch of text) {
            const n = new Node('char');
            n._objFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
            n.layer = this.node.layer;
            this.node.addChild(n);
            const l = n.addComponent(Label);
            l.string = ch;
            l.useSystemFont = label.useSystemFont;
            l.font = label.font;
            l.fontFamily = label.fontFamily;
            l.fontSize = label.fontSize;
            l.lineHeight = label.lineHeight;
            l.isBold = label.isBold;
            l.color = label.color;
            l.enableOutline = label.enableOutline;
            l.outlineColor = label.outlineColor;
            l.outlineWidth = label.outlineWidth;
            l.enableShadow = label.enableShadow;
            l.shadowColor = label.shadowColor;
            l.shadowOffset = label.shadowOffset;
            l.overflow = Label.Overflow.NONE;
            l.updateRenderData(true);
            widths.push(n.getComponent(UITransform)!.width);
            this.chars.push(n);
        }

        // Tổng chiều dài cung chữ; quá bề rộng node thì thu nhỏ cả cụm.
        const total = widths.reduce((a, b) => a + b, 0) + this._spacing * Math.max(0, text.length - 1);
        const maxWidth = this.node.getComponent(UITransform)?.width ?? total;
        const k = total > 0 && total > maxWidth ? maxWidth / total : 1;
        const r = this._radius;

        let s = -total / 2;
        this.chars.forEach((n, i) => {
            const mid = (s + widths[i] / 2) * k;
            s += widths[i] + this._spacing;
            n.setScale(k, k, 1);
            if (Math.abs(r) < 1) {
                n.setPosition(mid, 0, 0);
                n.angle = 0;
                return;
            }
            const theta = mid / r;
            n.setPosition(r * Math.sin(theta), r * Math.cos(theta) - r, 0);
            n.angle = (-theta * 180) / Math.PI;
        });
    }

    private clear(): void {
        for (const n of this.chars) if (n.isValid) n.destroy();
        this.chars = [];
        // Dọn cả node ký tự còn sót (ví dụ sau khi script được nạp lại trong editor).
        for (const n of [...this.node.children]) {
            if (n.name === 'char' && n._objFlags & CCObject.Flags.DontSave) n.destroy();
        }
    }
}
