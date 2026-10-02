'use strict';

const fs = require('fs');
const path = require('path');

const PKG = 'drink-map-tool';
/** Prefab used for every tile when building into the scene (root Sprite = card, child "Cup"). */
const TILE_PREFAB_URL = 'db://assets/5.Prefabs/Tile.prefab';
/** Prefab used for every Delivery Box (root is resized to cover the mail block). */
const MAIL_PREFAB_URL = 'db://assets/5.Prefabs/Mail.prefab';

async function assetInfo(urlOrUuid) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', urlOrUuid);
    } catch (e) {
        return null;
    }
}

function assetFile(info) {
    if (!info) return '';
    if (info.file) return path.resolve(info.file);
    if (info.url && info.url.startsWith('db://assets')) {
        return path.join(Editor.Project.path, 'assets', info.url.substring('db://assets'.length));
    }
    return '';
}

/** SpriteFrame sub-asset uuid + source png path for an image url. */
async function spriteOf(url) {
    const info = await assetInfo(url);
    if (!info) return null;
    const sub = Object.values(info.subAssets || {}).find((s) => s.type === 'cc.SpriteFrame');
    if (!sub) return { uuid: '', file: assetFile(info), error: 'Ảnh chưa import dạng sprite-frame: ' + url };
    return { uuid: sub.uuid, file: assetFile(info) };
}

function parseJson(text, source) {
    try {
        return { ok: true, data: JSON.parse(text) };
    } catch (e) {
        return { ok: false, error: 'JSON lỗi (' + source + '): ' + e.message };
    }
}

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    async readLevel(url) {
        const info = await assetInfo(url);
        if (!info) return { ok: false, error: 'Không tìm thấy asset: ' + url };
        const file = assetFile(info);
        if (!file || !fs.existsSync(file)) return { ok: false, error: 'Không đọc được file: ' + url };
        const res = parseJson(fs.readFileSync(file, 'utf8'), url);
        if (res.ok) res.url = info.url;
        return res;
    },

    /** Read Level_<n>.json straight from the Unity reference project folder. */
    readUnityLevel(dir, level) {
        const file = path.join(String(dir || ''), 'Level_' + Number(level) + '.json');
        if (!fs.existsSync(file)) return { ok: false, error: 'Không có file: ' + file };
        const res = parseJson(fs.readFileSync(file, 'utf8'), file);
        if (res.ok) res.file = file;
        return res;
    },

    async selectedJson() {
        const selected = Editor.Selection.getSelected('asset') || [];
        for (const uuid of selected) {
            const info = await assetInfo(uuid);
            if (info && /\.json$/i.test(info.url || '')) return { ok: true, url: info.url };
        }
        return { ok: false, error: 'Chọn một file .json trong Assets trước.' };
    },

    async saveLevel(url, data) {
        if (!url || !String(url).startsWith('db://assets/') || !/\.json$/i.test(url)) {
            return { ok: false, error: 'Đường dẫn lưu phải dạng db://assets/....json' };
        }
        const text = JSON.stringify(data, null, 2);
        try {
            const info = await assetInfo(url);
            if (info) await Editor.Message.request('asset-db', 'save-asset', info.uuid, text);
            else await Editor.Message.request('asset-db', 'create-asset', url, text);
            const saved = await assetInfo(url);
            return { ok: true, url, uuid: saved ? saved.uuid : '' };
        } catch (e) {
            return { ok: false, error: 'Lưu thất bại: ' + e.message };
        }
    },

    /** Resolve card / mail / drink_<id> sprites under a db:// folder. */
    async resolveSprites(root, maxId) {
        const base = String(root || '').replace(/\/+$/, '');
        const out = { card: await spriteOf(base + '/ui/card.png'), mail: await spriteOf(base + '/ui/mail_4c.png'), drinks: [] };
        const count = Math.max(0, Math.floor(Number(maxId) || 0)) + 1;
        for (let i = 0; i < count; i++) out.drinks.push(await spriteOf(base + '/drinks/drink_' + i + '.png'));
        const prefab = await assetInfo(TILE_PREFAB_URL);
        out.tilePrefab = prefab ? { uuid: prefab.uuid, url: TILE_PREFAB_URL } : null;
        const mailPrefab = await assetInfo(MAIL_PREFAB_URL);
        out.mailPrefab = mailPrefab ? { uuid: mailPrefab.uuid, url: MAIL_PREFAB_URL } : null;
        return out;
    },

    async applyMap(options) {
        const o = options || {};
        if (!o.parentUuid) return { ok: false, error: 'Chọn node sẽ chứa map trong Hierarchy trước.' };
        try {
            return await Editor.Message.request('scene', 'execute-scene-script', {
                name: PKG,
                method: 'buildMap',
                args: [o],
            });
        } catch (e) {
            return { ok: false, error: 'Không cập nhật được scene: ' + e.message };
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
