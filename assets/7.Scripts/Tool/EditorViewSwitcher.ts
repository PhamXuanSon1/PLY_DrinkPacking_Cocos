import { _decorator, Component, Enum, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { TutorialManager } from '../Gameplay/TutorialManager';
const { ccclass, property, executeInEditMode, executionOrder } = _decorator;

/** Màn hình muốn xem trong editor. */
export enum EditorView {
    All,
    Intro,
    Gameplay,
    Endcard,
    LoseCard,
}

/**
 * Chỉ dùng trong editor: chọn xem Intro (tutorial) / Gameplay / Endcard thay vì cả 3 chồng lên nhau.
 * Bật các node của màn đang chọn, tắt các node thuộc màn khác (node có trong nhiều màn vẫn bật).
 * View Intro còn nhờ TutorialManager dựng cảnh tutorial (khách giữa, đơn mẫu, 3 cốc mẫu) và ẩn
 * các node tutorial không dùng (đĩa khác, ô khay thừa, thuyền trưởng khi tắt Use Guide).
 *
 * Khi chạy game (preview / build) luôn bật lại mọi node trong các danh sách và mọi node bị ẩn
 * để xem trước, trước khi các script khác onLoad (TutorialManager / WinPopup phải onLoad mới
 * chạy đúng và tự ẩn hiện). Nên chọn màn nào rồi lưu scene cũng không ảnh hưởng game.
 */
@ccclass('EditorViewSwitcher')
@executeInEditMode
@executionOrder(-1000)
export class EditorViewSwitcher extends Component {
    @property({ type: [Node], tooltip: 'Các node của màn Intro (tutorial)' })
    intro: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node của màn Gameplay' })
    gameplay: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node của Endcard (thắng)' })
    endcard: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node của endcard thua (LosePopup)' })
    loseCard: Node[] = [];

    @property({ type: TutorialManager, tooltip: 'Dựng cảnh tutorial khi xem Intro. Để trống = tự tìm trong scene' })
    tutorial: TutorialManager | null = null;

    @property
    private _view = EditorView.All;

    /** Các node bị ẩn để xem trước Intro; lưu cùng scene để khi chạy game bật lại. */
    @property({ type: [Node], visible: false })
    private previewHidden: Node[] = [];

    @property({ type: Enum(EditorView), tooltip: 'Chọn màn muốn xem trong editor. Không ảnh hưởng khi chạy game' })
    get view(): EditorView {
        return this._view;
    }
    set view(v: EditorView) {
        this._view = v;
        if (EDITOR) this.apply();
    }

    onLoad(): void {
        if (EDITOR) return;
        for (const n of [...this.all(), ...this.previewHidden]) if (n?.isValid) n.active = true;
    }

    private apply(): void {
        for (const n of this.previewHidden) if (n?.isValid) n.active = true;
        this.previewHidden = [];
        const tutorial = this.tutorial ?? this.node.scene?.getComponentInChildren(TutorialManager) ?? null;
        tutorial?.editorPreview(false);

        const shown = new Set(this._view === EditorView.All ? this.all() : this.listOf(this._view));
        for (const n of this.all()) if (n?.isValid) n.active = shown.has(n);

        if (this._view !== EditorView.Intro || !tutorial) return;
        for (const n of tutorial.editorPreview(true)) {
            if (!n?.isValid || !n.active) continue;
            n.active = false;
            this.previewHidden.push(n);
        }
    }

    private listOf(v: EditorView): Node[] {
        switch (v) {
            case EditorView.Intro: return this.intro;
            case EditorView.Gameplay: return this.gameplay;
            case EditorView.Endcard: return this.endcard;
            case EditorView.LoseCard: return this.loseCard;
            default: return [];
        }
    }

    private all(): Node[] {
        return [...this.intro, ...this.gameplay, ...this.endcard, ...this.loseCard];
    }
}
