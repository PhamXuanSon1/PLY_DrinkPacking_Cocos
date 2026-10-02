import { Node, Tween, tween, Vec3 } from 'cc';

/**
 * Cho `node` nhảy theo đường vòng cung tới node `target` (cộng thêm `offset` theo world),
 * giữ nguyên parent và scale trong lúc bay. Vị trí đích được tính lại mỗi frame nên vẫn
 * đáp đúng khi `target` đang di chuyển. Khi đáp mới gán `node` làm con của `parent`
 * (giữ nguyên transform world).
 */
export function jumpTo(node: Node, parent: Node, target: Node, offset: Vec3 | null, done?: () => void, duration = 0.35, height = 150): void {
    Tween.stopAllByTarget(node);
    const start = node.worldPosition.clone();
    const end = new Vec3();
    const pos = new Vec3();
    const state = { k: 0 };
    tween(state)
        .to(duration, { k: 1 }, {
            easing: 'sineInOut',
            onUpdate: () => {
                const k = state.k;
                end.set(target.worldPosition);
                if (offset) end.add(offset);
                Vec3.lerp(pos, start, end, k);
                pos.y += height * 4 * k * (1 - k);
                node.setWorldPosition(pos);
            },
        })
        .call(() => {
            node.setParent(parent, true);
            done?.();
        })
        .start();
}
