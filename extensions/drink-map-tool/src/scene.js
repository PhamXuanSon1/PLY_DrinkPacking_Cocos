'use strict';

const { join } = require('path');
module.paths.push(join(Editor.App.path, 'node_modules'));

function findByUuid(root, uuid) {
    if (!root) return null;
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findByUuid(child, uuid);
        if (found) return found;
    }
    return null;
}

function loadAsset(cc, uuid) {
    if (!uuid) return Promise.resolve(null);
    return new Promise((resolve) => cc.assetManager.loadAny({ uuid }, (err, asset) => resolve(err ? null : asset)));
}

exports.methods = {
    /**
     * Build the map under the selected node through its LevelMapBuilder component
     * (added when missing), so the editor tool and the component share one layout logic.
     */
    async buildMap(o) {
        const cc = require('cc');
        const scene = cc.director.getScene();
        if (!scene) return { ok: false, error: 'Chưa mở scene.' };
        const parent = findByUuid(scene, o.parentUuid);
        if (!parent) return { ok: false, error: 'Không tìm thấy node đã chọn. Hãy chọn lại.' };
        const Builder = cc.js.getClassByName('LevelMapBuilder');
        if (!Builder) return { ok: false, error: 'Chưa có script LevelMapBuilder (assets/7.Scripts/MapTool). Đợi compile xong rồi thử lại.' };
        if (!parent.getComponent(cc.UITransform)) {
            return { ok: false, error: 'Node "' + parent.name + '" không có UITransform. Hãy chọn node UI nằm trong Canvas.' };
        }

        const builder = parent.getComponent(Builder) || parent.addComponent(Builder);
        const s = o.sprites || {};
        if (s.tilePrefab) builder.tilePrefab = await loadAsset(cc, s.tilePrefab.uuid);
        if (s.mailPrefab) builder.mailPrefab = await loadAsset(cc, s.mailPrefab.uuid);
        builder.cardFrame = await loadAsset(cc, s.card && s.card.uuid);
        builder.mailFrame = await loadAsset(cc, s.mail && s.mail.uuid);
        builder.drinkFrames = await Promise.all((s.drinks || []).map((d) => loadAsset(cc, d && d.uuid)));
        if (o.jsonUuid) builder.levelJson = await loadAsset(cc, o.jsonUuid);

        const v = o.view || {};
        builder.cardSize = new cc.Vec2(Number(v.cardW) || 140, Number(v.cardH) || 144);
        builder.cellStep = new cc.Vec2(Number(v.stepX) || 144, Number(v.stepY) || 148);
        builder.mailSize = new cc.Vec2(Math.max(1, Number(v.mailW) || 2), Math.max(1, Number(v.mailH) || 2));
        builder.cupHeightRatio = Number(v.cupRatio) || 0.82;
        builder.cupOffsetY = Number(v.cupOffsetY) || 0;
        // Covered tint is gameplay state: it lives on DrinkItemManager, which refreshes
        // itself when the builder emits 'map-built'.
        const Manager = cc.js.getClassByName('DrinkItemManager');
        // Prefer a manager elsewhere (e.g. Manager/DrinkItemManager) whose boardRoot is this map.
        const external = Manager ? cc.director.getScene().getComponentsInChildren(Manager).find(m => m.boardRoot === parent) : null;
        const manager = Manager ? (external || parent.getComponent(Manager) || parent.addComponent(Manager)) : null;
        const g = Math.max(0, Math.min(255, Math.round(Number(v.coveredGray) || 150)));
        if (manager) manager.coveredColor = new cc.Color(g, g, g, 255);

        builder.buildFromData(o.data);
        try { Editor.Message.send('scene', 'snapshot'); } catch (e) { /* scene may be closing */ }
        const info = builder.info + (manager ? ' · ' + manager.info : ' · (chưa có DrinkItemManager)');
        return { ok: true, info, node: parent.name };
    },
};
