import { Node, Sprite, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';

/**
 * Cho `node` nhảy theo đường vòng cung tới node `target` (cộng thêm `offset` theo world),
 * giữ nguyên parent trong lúc bay. Vị trí đích được tính lại mỗi frame nên vẫn
 * đáp đúng khi `target` đang di chuyển. Khi đáp mới gán `node` làm con của `parent`
 * (giữ nguyên transform world).
 * `matchScale` = true: scale world của cốc đổi dần từ lúc cất cánh tới scale world của
 * `parent` × `sizeRatio`, để cốc bay từ bàn (có thể bị thu nhỏ cho vừa màn) vẫn đáp lên
 * đĩa / khay đúng cỡ. `sizeRatio` dùng khi chỗ đáp cần cốc to hơn cốc trên bàn (ví dụ bằng ảnh Ghost).
 */
export function jumpTo(node: Node, parent: Node, target: Node, offset: Vec3 | null, done: (() => void) | undefined, duration: number, height: number, matchScale = true, sizeRatio = 1): void {
    Tween.stopAllByTarget(node);
    const start = node.worldPosition.clone();
    const end = new Vec3();
    const pos = new Vec3();
    const startScale = node.worldScale.clone();
    const endScale = new Vec3();
    const scale = new Vec3();
    const state = { k: 0 };
    tween(state)
        .to(duration, { k: 1 }, {
            easing: 'linear',
            onUpdate: () => {
                const k = state.k;
                if (matchScale) Vec3.lerp(scale, startScale, Vec3.multiplyScalar(endScale, parent.worldScale, sizeRatio), k);
                else scale.set(startScale);
                end.set(target.worldPosition);
                // offset đo lúc cất cánh nên co giãn theo scale hiện tại của cốc.
                if (offset) end.add3f(offset.x * scale.x / startScale.x, offset.y * scale.y / startScale.y, 0);
                Vec3.lerp(pos, start, end, k);
                // Đỉnh cung luôn cao hơn điểm cao nhất (đầu/cuối) một đoạn `height`, để cốc vọt
                // lên rồi rơi xuống đáp kể cả khi đích nằm cao hơn nhiều so với điểm xuất phát.
                // y là Bezier bậc 2 qua start/end, điểm điều khiển c chọn sao cho đỉnh = peak.
                const peak = Math.max(start.y, end.y) + height;
                const c = peak + Math.sqrt(Math.max(0, (peak - start.y) * (peak - end.y)));
                const u = 1 - k;
                pos.y = u * u * start.y + 2 * u * k * c + k * k * end.y;
                node.setWorldPosition(pos);
                if (matchScale) node.setWorldScale(scale);
            },
        })
        .call(() => {
            node.setParent(parent, true);
            done?.();
        })
        .start();
}

/**
 * Phần 1 của cú bay: cốc nhích lên một đoạn ngắn, thẻ nền (Sprite trên node gốc) phóng to và
 * mờ dần rồi biến mất; xong gọi `done` để bắt đầu phần 2 (thường là `jumpTo`).
 * Tween nâng chạy trên chính `node`, nên nếu `jumpTo` được gọi cho node này giữa chừng (ví dụ
 * khay dồn slot) thì phần nâng bị hủy cùng `done`. Hiệu ứng thẻ chạy trên node riêng nên vẫn chạy hết.
 */
export function liftOff(node: Node, done: () => void, height = 40, duration = 0.15, cardScale = 1.35): void {
    Tween.stopAllByTarget(node);
    fadeCard(node, duration, cardScale);
    tween(node)
        .by(duration, { position: new Vec3(0, height, 0) }, { easing: 'quadOut' })
        .call(() => {
            if (node.isValid) done();
        })
        .start();
}

/** Tắt thẻ nền và thay bằng một bản sao nằm sau cốc, phóng to tới `scale` và mờ về 0 rồi tự hủy. */
function fadeCard(node: Node, duration: number, scale: number): void {
    const card = node.getComponent(Sprite);
    if (!card || !card.enabled) return;
    card.enabled = false;
    const size = node.getComponent(UITransform)?.contentSize;
    const fx = new Node('CardFx');
    fx.layer = node.layer;
    node.insertChild(fx, 0);
    fx.addComponent(UITransform).setContentSize(size?.width ?? 100, size?.height ?? 100);
    const sprite = fx.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = card.spriteFrame;
    sprite.color = card.color;
    const opacity = fx.addComponent(UIOpacity);
    tween(fx).to(duration, { scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' }).start();
    tween(opacity)
        .to(duration, { opacity: 0 }, { easing: 'quadIn' })
        .call(() => {
            if (fx.isValid) fx.destroy();
        })
        .start();
}
