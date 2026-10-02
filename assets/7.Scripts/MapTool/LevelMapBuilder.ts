import { _decorator, Component, instantiate, JsonAsset, Layers, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec2, Vec3 } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;
import { DrinkTile } from './DrinkTile';

/** Emitted on the builder node after a build, so managers (DrinkItemManager) can refresh. */
export const MAP_BUILT_EVENT = 'map-built';

/** JSON shape of `levels/Level_XX.json` from the Unity reference project. */
export interface LevelLayerJson {
    layer: number;
    gridX: number;
    gridY: number;
    /** drinkId -> row-major cell indices. */
    tiles: Record<string, number[]>;
    /** Row-major index of the top-left cell of each Delivery Box. */
    mail?: number[];
    offsetX?: number;
    offsetY?: number;
}

export interface LevelJson {
    level: number;
    layers: LevelLayerJson[];
}

/**
 * Editor tool: lays out a level's stacked tile map from its JSON. It only creates and places nodes;
 * gameplay state (covered tint, selectable tiles...) belongs to DrinkItemManager.
 * Tick "Build" in the Inspector to (re)generate the nodes under this node, "Clear" to remove them.
 * Index convention: row-major, x = index % gridX, y = floor(index / gridX), y = 0 is the top row.
 * Layers are centred on each other, so grids that differ by one cell sit half a cell apart.
 */
@ccclass('LevelMapBuilder')
@executeInEditMode
export class LevelMapBuilder extends Component {
    @property({ type: JsonAsset, tooltip: 'Level JSON (resources/level14/data/level_14.json)' })
    levelJson: JsonAsset | null = null;

    @property({ type: Prefab, tooltip: 'Tile prefab: root Sprite = card, child "Cup" Sprite = drink. Empty = build nodes in code.' })
    tilePrefab: Prefab | null = null;

    @property({ type: SpriteFrame, tooltip: 'Tile background (card). Only used when no Tile Prefab is set.' })
    cardFrame: SpriteFrame | null = null;

    @property({ type: [SpriteFrame], tooltip: 'Cup sprite per drink ID (index = drinkId)' })
    drinkFrames: SpriteFrame[] = [];

    @property({ type: Prefab, tooltip: 'Delivery Box prefab (root UITransform is resized to cover Mail Size cells). Empty = build in code.' })
    mailPrefab: Prefab | null = null;

    @property({ type: SpriteFrame, tooltip: 'Delivery Box sprite. Only used when no Mail Prefab is set.' })
    mailFrame: SpriteFrame | null = null;

    @property({ tooltip: 'Card size in px' })
    cardSize = new Vec2(140, 144);

    @property({ tooltip: 'Distance between cell centres. Keep it >= Card Size so tiles in the same layer do not overlap.' })
    cellStep = new Vec2(144, 148);

    @property({ tooltip: 'Cup height relative to card height' })
    cupHeightRatio = 0.82;

    @property({ tooltip: 'Cup vertical offset inside the card (px)' })
    cupOffsetY = 4;

    @property({ tooltip: 'Delivery Box size in cells (X = columns, Y = rows). The JSON anchor is its top-left cell.' })
    mailSize = new Vec2(2, 2);

    @property({ tooltip: 'Extra offset per layer in cells (index 0 = layer 1). Added to the automatic centring.' })
    layerOffsets: Vec2[] = [];

    @property({ tooltip: 'Tick to rebuild the map' })
    get build(): boolean {
        return false;
    }
    set build(v: boolean) {
        if (v) this.buildMap();
    }

    @property({ tooltip: 'Tick to remove the generated map' })
    get clear(): boolean {
        return false;
    }
    set clear(v: boolean) {
        if (v) this.clearMap();
    }

    @property({ readonly: true, tooltip: 'Result of the last build' })
    info = '';

    clearMap(): void {
        for (const child of [...this.node.children]) {
            if (!child.name.startsWith('Layer')) continue;
            // Detach now: destroy() only happens at the end of the frame, and a manager
            // refreshing right after a rebuild must not see the old tiles.
            child.removeFromParent();
            child.destroy();
        }
        this.info = '';
    }

    buildMap(): void {
        this.buildFromData(this.levelJson?.json as LevelJson | undefined);
    }

    /** Build from level data directly (used by the Drink Map Tool editor panel). */
    buildFromData(json: LevelJson | undefined): void {
        if (!json || !json.layers) {
            this.info = 'Missing level JSON';
            console.warn('[LevelMapBuilder] ' + this.info);
            return;
        }
        this.clearMap();

        const layers = [...json.layers].sort((a, b) => a.layer - b.layer);
        const layerCounts: number[] = [];
        let mailCount = 0;

        layers.forEach((l, li) => {
            const layerNode = this.createNode(`Layer${l.layer}`, this.node);
            const cells: { x: number; y: number; id: number }[] = [];
            for (const key of Object.keys(l.tiles)) {
                for (const index of l.tiles[key]) {
                    cells.push({ x: index % l.gridX, y: Math.floor(index / l.gridX), id: Number(key) });
                }
            }
            // Rows top to bottom so each row draws over the lip of the row above.
            cells.sort((a, b) => a.y - b.y || a.x - b.x);
            for (const c of cells) {
                const node = this.createTile(layerNode, c.id, `T_${c.x}_${c.y}_d${c.id}`);
                node.setPosition(this.cellPos(l, li, c.x, c.y));
                const data = node.getComponent(DrinkTile) ?? node.addComponent(DrinkTile);
                data.layer = li;
                data.x = c.x;
                data.y = c.y;
                data.drinkId = c.id;
            }
            layerCounts.push(cells.length);
            for (const index of l.mail ?? []) {
                this.createMail(layerNode, l, li, index % l.gridX, Math.floor(index / l.gridX));
                mailCount++;
            }
        });

        const total = layerCounts.reduce((a, b) => a + b, 0);
        const perLayer = layers.map((l, i) => `L${l.layer}:${layerCounts[i]}`).join(' ');
        this.info = `Level ${json.level}: ${total} tiles (${perLayer}), ${mailCount} mail`;
        console.log('[LevelMapBuilder] ' + this.info);
        this.node.emit(MAP_BUILT_EVENT);
    }

    private cellPos(l: LevelLayerJson, layerIndex: number, x: number, y: number): Vec3 {
        const extra = this.layerOffsets[layerIndex] ?? Vec2.ZERO;
        const ox = (l.offsetX ?? 0) + extra.x;
        const oy = (l.offsetY ?? 0) + extra.y;
        return new Vec3(
            (x - (l.gridX - 1) / 2 + ox) * this.cellStep.x,
            ((l.gridY - 1) / 2 - y - oy) * this.cellStep.y,
            0,
        );
    }

    private createTile(parent: Node, drinkId: number, name: string): Node {
        const node = this.tilePrefab ? this.createFromPrefab(name, parent) : this.createTileNodes(name, parent);
        node.getComponent(UITransform)!.setContentSize(this.cardSize.x, this.cardSize.y);

        const frame = this.drinkFrames[drinkId] ?? null;
        if (!frame) console.warn(`[LevelMapBuilder] No sprite for drink ${drinkId}`);
        const cup = node.getChildByName('Cup')!;
        const sprite = cup.getComponent(Sprite)!;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        const h = this.cardSize.y * this.cupHeightRatio;
        const size = frame ? frame.originalSize : null;
        const w = size && size.height > 0 ? (h * size.width) / size.height : h * 0.7;
        cup.getComponent(UITransform)!.setContentSize(w, h);
        cup.setPosition(0, this.cupOffsetY, 0);
        return node;
    }

    /** Prefab instance; must have a Sprite on the root and a child "Cup" with a Sprite. */
    private createFromPrefab(name: string, parent: Node): Node {
        const node = instantiate(this.tilePrefab!);
        node.name = name;
        parent.addChild(node);
        if (!node.getComponent(Sprite) || !node.getChildByName('Cup')?.getComponent(Sprite)) {
            console.warn('[LevelMapBuilder] Tile prefab needs a root Sprite and a child "Cup" with a Sprite');
        }
        return node;
    }

    /** Fallback when no prefab is assigned: card Sprite + empty "Cup" child. */
    private createTileNodes(name: string, parent: Node): Node {
        const node = this.createNode(name, parent);
        const bg = node.addComponent(Sprite);
        bg.sizeMode = Sprite.SizeMode.CUSTOM;
        bg.spriteFrame = this.cardFrame;
        this.createNode('Cup', node).addComponent(Sprite);
        return node;
    }

    private createMail(parent: Node, l: LevelLayerJson, layerIndex: number, x: number, y: number): void {
        const a = this.cellPos(l, layerIndex, x, y);
        const b = this.cellPos(l, layerIndex, x + Math.max(1, Math.round(this.mailSize.x)) - 1, y + Math.max(1, Math.round(this.mailSize.y)) - 1);
        const name = `Mail_${x}_${y}`;
        let node: Node;
        if (this.mailPrefab) {
            node = instantiate(this.mailPrefab);
            node.name = name;
            parent.addChild(node);
        } else {
            node = this.createNode(name, parent);
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = this.mailFrame;
        }
        node.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        node.getComponent(UITransform)!.setContentSize(
            Math.abs(b.x - a.x) + this.cardSize.x,
            Math.abs(b.y - a.y) + this.cardSize.y,
        );
    }

    private createNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform);
        parent.addChild(node);
        return node;
    }
}
