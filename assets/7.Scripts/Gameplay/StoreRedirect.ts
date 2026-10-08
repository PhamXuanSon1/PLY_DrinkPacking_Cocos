import { _decorator, Component, game } from 'cc';
import { ui } from '../Manager/UI';
import { gc } from '../Tool/GameController';
import { LEVEL_LOSE_EVENT, LEVEL_START_EVENT, LEVEL_WIN_EVENT, OrderManager } from './OrderManager';
const { ccclass, property } = _decorator;

/**
 * Tự đưa người chơi ra store trong màn chơi (sau tutorial), khi một trong các điều kiện xảy ra:
 * - Click đủ `clickLimit` lần.
 * - Click bất kỳ sau `timeLimit` giây kể từ lúc vào màn.
 * - Thua (sau `loseDelay` giây để kịp nghe sound thua).
 * Sau khi đã ra store, mọi click tiếp theo đều mở lại store. Thắng thì tắt luật này (WinPopup tự lo CTA).
 *
 * Đếm click bằng sự kiện DOM trên canvas nên tính cả click vào cốc lẫn chỗ trống,
 * và lần mở store nằm trong thao tác của người chơi (không bị chặn popup).
 */
@ccclass('StoreRedirect')
export class StoreRedirect extends Component {
    @property({ type: OrderManager, tooltip: 'Để trống = lấy OrderManager trên cùng node' })
    orderManager: OrderManager | null = null;

    @property({ tooltip: 'Số click trong màn chơi thì ra store (0 = tắt)' })
    clickLimit = 25;

    @property({ tooltip: 'Sau bao nhiêu giây trong màn chơi thì click tiếp theo ra store (0 = tắt)' })
    timeLimit = 20;

    @property({ tooltip: 'Thua thì ra store' })
    redirectOnLose = true;

    @property({ tooltip: 'Chờ bao nhiêu giây sau khi thua rồi mới ra store' })
    loseDelay = 1;

    /** Đang trong màn chơi: bắt đầu từ LEVEL_START, dừng khi thắng. */
    private playing = false;
    private clicks = 0;
    private timeUp = false;
    /** Đã ra store ít nhất một lần: từ đó mọi click đều mở store. */
    private redirected = false;

    // Gắn listener ở onEnable chứ không ở onLoad: onLoad vẫn chạy khi component bị bỏ tick,
    // nên tắt component trong Inspector phải tắt được toàn bộ luật ra store.
    onEnable(): void {
        if (!this.orderManager) this.orderManager = this.getComponent(OrderManager);
        const node = this.orderManager?.node;
        node?.on(LEVEL_START_EVENT, this.onLevelStart, this);
        node?.on(LEVEL_WIN_EVENT, this.onWin, this);
        node?.on(LEVEL_LOSE_EVENT, this.onLose, this);
        game.canvas?.addEventListener('pointerup', this.onClick);
    }

    onDisable(): void {
        this.playing = false;
        this.unscheduleAllCallbacks();
        const node = this.orderManager?.node;
        node?.off(LEVEL_START_EVENT, this.onLevelStart, this);
        node?.off(LEVEL_WIN_EVENT, this.onWin, this);
        node?.off(LEVEL_LOSE_EVENT, this.onLose, this);
        game.canvas?.removeEventListener('pointerup', this.onClick);
    }

    private onLevelStart(): void {
        this.playing = true;
        this.clicks = 0;
        this.timeUp = false;
        this.unscheduleAllCallbacks();
        if (this.timeLimit > 0) this.scheduleOnce(() => (this.timeUp = true), this.timeLimit);
    }

    private onWin(): void {
        this.playing = false;
        this.unscheduleAllCallbacks();
    }

    private onLose(): void {
        this.unscheduleAllCallbacks();
        if (!this.redirectOnLose) return;
        this.playing = false;
        this.scheduleOnce(() => this.redirect(), this.loseDelay);
    }

    /** Arrow function để add / remove listener DOM giữ đúng `this`. */
    private onClick = (): void => {
        if (this.redirected) return this.redirect();
        if (!this.playing) return;
        this.clicks++;
        if (this.timeUp || (this.clickLimit > 0 && this.clicks >= this.clickLimit)) this.redirect();
    };

    private redirect(): void {
        this.playing = false;
        this.redirected = true;
        if (ui) ui.openStore();
        else gc?.redirectToStore();
    }
}
