import { _decorator, Color, Component, UITransform, Vec3 } from 'cc';
import { DrinkTile } from './DrinkTile';
import { MAP_BUILT_EVENT } from './LevelMapBuilder';
const { ccclass, property, executeInEditMode } = _decorator;

/** Minimum overlap (px) before a higher tile counts as covering a lower one, so touching edges do not. */
const COVER_EPS = 2;

/**
 * Manages the tiles of a built map: finds every DrinkTile under this node,
 * decides which ones are covered and tints them. LevelMapBuilder only creates the nodes.
 *
 * Covered rule: a tile is covered when any tile on a higher layer overlaps its bounds
 * (card size + position), no matter how many layers above. Covered or not is binary:
 * every covered tile gets the same `coveredColor`.
 */
@ccclass('DrinkItemManager')
@executeInEditMode
export class DrinkItemManager extends Component {
    @property({ tooltip: 'Tint for tiles covered by a higher layer' })
    coveredColor = new Color(150, 150, 150, 255);

    @property({ tooltip: 'Tick to re-scan tiles and recompute covered state' })
    get refreshNow(): boolean {
        return false;
    }
    set refreshNow(v: boolean) {
        if (v) this.refresh();
    }

    @property({ readonly: true, tooltip: 'Result of the last refresh' })
    info = '';

    private tiles: DrinkTile[] = [];

    onLoad(): void {
        this.node.on(MAP_BUILT_EVENT, this.refresh, this);
    }

    onDestroy(): void {
        this.node.off(MAP_BUILT_EVENT, this.refresh, this);
    }

    start(): void {
        this.refresh();
    }

    /** Re-scan tiles under this node, recompute covered state and tints. Returns the covered count. */
    refresh(): number {
        this.tiles = this.node.getComponentsInChildren(DrinkTile);
        const onBoard = this.tiles.filter(t => !t.collected);
        let covered = 0;
        for (const t of onBoard) {
            t.covered = onBoard.some(o => o.layer > t.layer && this.overlaps(t, o));
            t.setTint(t.covered ? this.coveredColor : Color.WHITE);
            if (t.covered) covered++;
        }
        this.info = `${onBoard.length} tiles, ${covered} covered, ${onBoard.length - covered} selectable`;
        return covered;
    }

    getTiles(): readonly DrinkTile[] {
        return this.tiles;
    }

    isSelectable(t: DrinkTile): boolean {
        return !t.collected && !t.covered;
    }

    getSelectableTiles(): DrinkTile[] {
        return this.tiles.filter(t => this.isSelectable(t));
    }

    /** Take a tile off the board and uncover what was below it. */
    removeTile(t: DrinkTile): void {
        if (t.collected) return;
        t.collected = true;
        t.node.active = false;
        this.refresh();
    }

    /** Bounds overlap in this node's space, using each tile's real content size. */
    private overlaps(a: DrinkTile, b: DrinkTile): boolean {
        const pa = this.localPos(a);
        const pb = this.localPos(b);
        const sa = a.node.getComponent(UITransform)!.contentSize;
        const sb = b.node.getComponent(UITransform)!.contentSize;
        const w = (sa.width + sb.width) / 2 - Math.abs(pa.x - pb.x);
        const h = (sa.height + sb.height) / 2 - Math.abs(pa.y - pb.y);
        return w > COVER_EPS && h > COVER_EPS;
    }

    private localPos(t: DrinkTile): Vec3 {
        return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(t.node.worldPosition);
    }
}
