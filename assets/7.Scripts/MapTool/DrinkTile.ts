import { _decorator, Color, Component, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Data of one cup on the board. LevelMapBuilder fills it when building;
 * DrinkItemManager reads it and owns the runtime state (covered, collected).
 */
@ccclass('DrinkTile')
export class DrinkTile extends Component {
    @property({ tooltip: 'Layer index, 0 = bottom layer' })
    layer = 0;

    @property({ tooltip: 'Column in its layer grid' })
    x = 0;

    @property({ tooltip: 'Row in its layer grid, 0 = top row' })
    y = 0;

    @property({ tooltip: 'Drink ID (matches drink_<id>.png and the level JSON)' })
    drinkId = 0;

    /** Covered by a tile on a higher layer. Set by DrinkItemManager. */
    covered = false;

    /** Taken off the board. Set by DrinkItemManager. */
    collected = false;

    /** Tint the card and its "Cup" child. */
    setTint(color: Color): void {
        const card = this.getComponent(Sprite);
        if (card) card.color = color;
        const cup = this.node.getChildByName('Cup')?.getComponent(Sprite);
        if (cup) cup.color = color;
    }
}
