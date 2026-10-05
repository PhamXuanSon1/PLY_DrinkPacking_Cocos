import { Node, Tween, tween, Vec3 } from 'cc';

/**
 * Cho `node` nhảy theo đường vòng cung tới node `target` (cộng thêm `offset` theo world),
 * giữ nguyên parent và scale trong lúc bay. Vị trí đích được tính lại mỗi frame nên vẫn
 * đáp đúng khi `target` đang di chuyển. Khi đáp mới gán `node` làm con của `parent`
 * (giữ nguyên transform world).
 */
export function jumpTo(node: Node, parent: Node, target: Node, offset: Vec3 | null, done: (() => void) | undefined, duration: number, height: number): void {
    Tween.stopAllByTarget(node);
    const start = node.worldPosition.clone();
    const end = new Vec3();
    const pos = new Vec3();
    const state = { k: 0 };
    tween(state)
        .to(duration, { k: 1 }, {
            easing: 'linear',
            onUpdate: () => {
                const k = state.k;
                end.set(target.worldPosition);
                if (offset) end.add(offset);
                Vec3.lerp(pos, start, end, k);
                // Đỉnh cung luôn cao hơn điểm cao nhất (đầu/cuối) một đoạn `height`, để cốc vọt
                // lên rồi rơi xuống đáp kể cả khi đích nằm cao hơn nhiều so với điểm xuất phát.
                // y là Bezier bậc 2 qua start/end, điểm điều khiển c chọn sao cho đỉnh = peak.
                const peak = Math.max(start.y, end.y) + height;
                const c = peak + Math.sqrt(Math.max(0, (peak - start.y) * (peak - end.y)));
                const u = 1 - k;
                pos.y = u * u * start.y + 2 * u * k * c + k * k * end.y;
                node.setWorldPosition(pos);
            },
        })
        .call(() => {
            node.setParent(parent, true);
            done?.();
        })
        .start();
}
