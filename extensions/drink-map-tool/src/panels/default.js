'use strict';

const fs = require('fs');
const path = require('path');
const PKG = 'drink-map-tool';
const DRINK_PER_CUSTOMER = 3;
const UNDO_LIMIT = 60;

exports.template = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'style', 'default.css'), 'utf8');
exports.$ = {
    jsonUrl: '#jsonUrl', pickJson: '#pickJson', loadJson: '#loadJson', saveJson: '#saveJson', newLevel: '#newLevel',
    unityDir: '#unityDir', unityLevel: '#unityLevel', loadUnity: '#loadUnity',
    levelNum: '#levelNum', hard: '#hard', region: '#region',
    layerTabs: '#layerTabs', addLayer: '#addLayer', removeLayer: '#removeLayer', layerUp: '#layerUp', layerDown: '#layerDown',
    gridX: '#gridX', gridY: '#gridY', offsetX: '#offsetX', offsetY: '#offsetY', ghostBelow: '#ghostBelow',
    palette: '#palette', fillLayer: '#fillLayer', clearLayer: '#clearLayer', shuffleIds: '#shuffleIds', undo: '#undo',
    grid: '#grid', preview: '#preview', previewUpTo: '#previewUpTo',
    customers: '#customers', genCustomers: '#genCustomers', shuffleCustomers: '#shuffleCustomers', stats: '#stats',
    spriteRoot: '#spriteRoot', maxId: '#maxId', cardW: '#cardW', cardH: '#cardH', stepX: '#stepX', stepY: '#stepY',
    mailW: '#mailW', mailH: '#mailH', cupRatio: '#cupRatio', cupOffsetY: '#cupOffsetY', coveredGray: '#coveredGray', reloadSprites: '#reloadSprites',
    status: '#status', saveBeforeApply: '#saveBeforeApply', apply: '#apply',
};

/**
 * Editor state. Each layer keeps its cells as "x,y" -> drinkId and its Delivery Box anchors as "x,y".
 * Index convention matches the game: row-major, index = y * gridX + x, y = 0 is the top row.
 */
let level = null;
let currentLayer = 0;
let tool = { type: 'drink', id: 0 };
let undoStack = [];
let sprites = { card: null, mail: null, drinks: [] };
const images = new Map();
let painting = false;
/** Delivery Box size in cells, from the "Mail W/H" inputs. */
let mailW = 2;
let mailH = 2;

// ---------- helpers ----------

function req(method, ...args) {
    return Editor.Message.request(PKG, method, ...args).catch((e) => ({ ok: false, error: e.message }));
}

function num(input, fallback) {
    const v = Number(input.value);
    return Number.isFinite(v) ? v : fallback;
}

function key(x, y) {
    return x + ',' + y;
}

function parseKey(k) {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
}

function fileUrl(file) {
    if (!file) return '';
    const normalized = String(file).replace(/\\/g, '/');
    return 'file:///' + normalized.split('/').map((part, i) => (i === 0 ? part : encodeURIComponent(part))).join('/');
}

function image(file, onLoad) {
    if (!file) return null;
    let img = images.get(file);
    if (!img) {
        img = new Image();
        img.onload = onLoad;
        img.src = fileUrl(file);
        images.set(file, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}

function emptyLayer(gridX, gridY) {
    return { gridX, gridY, offsetX: 0, offsetY: 0, cells: new Map(), mails: new Set() };
}

function newLevel() {
    return { level: 1, hard: 'normal', region: 0, customers: [], layers: [emptyLayer(5, 5)] };
}

function fromJson(json) {
    const lv = { level: Number(json.level) || 1, hard: json.hard || 'normal', region: Number(json.region) || 0,
        customers: Array.isArray(json.customers) ? json.customers.map(Number) : [], layers: [] };
    const layers = Array.isArray(json.layers) ? [...json.layers].sort((a, b) => (a.layer || 0) - (b.layer || 0)) : [];
    for (const l of layers) {
        const layer = emptyLayer(Math.max(1, Number(l.gridX) || 1), Math.max(1, Number(l.gridY) || 1));
        layer.offsetX = Number(l.offsetX) || 0;
        layer.offsetY = Number(l.offsetY) || 0;
        for (const id of Object.keys(l.tiles || {})) {
            for (const index of l.tiles[id]) {
                layer.cells.set(key(index % layer.gridX, Math.floor(index / layer.gridX)), Number(id));
            }
        }
        for (const index of l.mail || []) layer.mails.add(key(index % layer.gridX, Math.floor(index / layer.gridX)));
        lv.layers.push(layer);
    }
    if (!lv.layers.length) lv.layers.push(emptyLayer(5, 5));
    return lv;
}

function toJson(lv) {
    return {
        level: lv.level,
        hard: lv.hard,
        region: lv.region,
        customers: lv.customers.slice(),
        layers: lv.layers.map((l, i) => {
            const tiles = {};
            const ids = [...new Set(l.cells.values())].sort((a, b) => a - b);
            for (const id of ids) {
                tiles[String(id)] = [...l.cells.entries()].filter(([, v]) => v === id)
                    .map(([k]) => { const p = parseKey(k); return p.y * l.gridX + p.x; }).sort((a, b) => a - b);
            }
            const out = { layer: i + 1, gridX: l.gridX, gridY: l.gridY, tiles };
            if (l.mails.size) {
                out.mail = [...l.mails].map((k) => { const p = parseKey(k); return p.y * l.gridX + p.x; }).sort((a, b) => a - b);
            }
            if (l.offsetX) out.offsetX = l.offsetX;
            if (l.offsetY) out.offsetY = l.offsetY;
            return out;
        }),
    };
}

function view(panel) {
    return {
        cardW: num(panel.$.cardW, 140), cardH: num(panel.$.cardH, 144),
        stepX: num(panel.$.stepX, 144), stepY: num(panel.$.stepY, 148),
        cupRatio: num(panel.$.cupRatio, 0.82), cupOffsetY: num(panel.$.cupOffsetY, 4),
        coveredGray: num(panel.$.coveredGray, 150),
        mailW, mailH,
    };
}

/** Cell centre in board space; same formula as LevelMapBuilder.cellPos. */
function cellPos(l, x, y, v) {
    return { x: (x - (l.gridX - 1) / 2 + l.offsetX) * v.stepX, y: ((l.gridY - 1) / 2 - y - l.offsetY) * v.stepY };
}

/** All tiles as flat records with positions. */
function allTiles(v) {
    const out = [];
    level.layers.forEach((l, li) => {
        for (const [k, id] of l.cells) {
            const p = parseKey(k);
            const pos = cellPos(l, p.x, p.y, v);
            out.push({ layer: li, x: p.x, y: p.y, id, px: pos.x, py: pos.y });
        }
    });
    return out;
}

/** Same rule as DrinkItemManager.overlaps: card bounds overlap by more than 2px. */
function overlaps(a, b, v) {
    return Math.abs(a.px - b.px) < v.cardW - 2 && Math.abs(a.py - b.py) < v.cardH - 2;
}

function isCovered(t, tiles, v) {
    return tiles.some((o) => o.layer > t.layer && overlaps(t, o, v));
}

function pushUndo() {
    undoStack.push(JSON.stringify(toJson(level)));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function drinkSprite(id) {
    return sprites.drinks[id] || null;
}

// ---------- editing ----------

function applyTool(panel, x, y, erase) {
    const l = level.layers[currentLayer];
    const k = key(x, y);
    if (erase || tool.type === 'erase') {
        l.cells.delete(k);
        l.mails.delete(k);
    } else if (tool.type === 'drink') {
        l.cells.set(k, tool.id);
    } else if (tool.type === 'mail') {
        if (l.mails.has(k)) {
            l.mails.delete(k);
        } else {
            if (x + mailW > l.gridX || y + mailH > l.gridY) {
                panel.$.status.textContent = 'Hộp mail ' + mailW + '×' + mailH + ' không vừa tại (' + x + ',' + y + ').';
                return;
            }
            for (const m of [...l.mails]) {
                const p = parseKey(m);
                if (Math.abs(p.x - x) < mailW && Math.abs(p.y - y) < mailH) l.mails.delete(m);
            }
            l.mails.add(k);
        }
    }
    refresh(panel);
}

function resizeLayer(l, gridX, gridY) {
    l.gridX = gridX;
    l.gridY = gridY;
    for (const k of [...l.cells.keys()]) {
        const p = parseKey(k);
        if (p.x >= gridX || p.y >= gridY) l.cells.delete(k);
    }
    for (const k of [...l.mails]) {
        const p = parseKey(k);
        if (p.x + mailW > gridX || p.y + mailH > gridY) l.mails.delete(k);
    }
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function idCounts() {
    const m = new Map();
    for (const l of level.layers) for (const id of l.cells.values()) m.set(id, (m.get(id) || 0) + 1);
    return m;
}

function readCustomers(panel) {
    level.customers = String(panel.$.customers.value || '').split(/[\s,;]+/).filter((s) => s !== '').map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0);
}

// ---------- rendering ----------

function syncInputs(panel) {
    const l = level.layers[currentLayer];
    panel.$.levelNum.value = level.level;
    panel.$.hard.value = level.hard;
    panel.$.region.value = level.region;
    panel.$.gridX.value = l.gridX;
    panel.$.gridY.value = l.gridY;
    panel.$.offsetX.value = l.offsetX;
    panel.$.offsetY.value = l.offsetY;
    panel.$.customers.value = level.customers.join(',');
}

function renderTabs(panel) {
    panel.$.layerTabs.innerHTML = level.layers.map((l, i) =>
        '<div class="tab' + (i === currentLayer ? ' active' : '') + '" data-layer="' + i + '">L' + (i + 1) +
        ' · ' + l.gridX + '×' + l.gridY + ' · ' + l.cells.size + '</div>').join('');
    panel.$.layerTabs.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            currentLayer = Number(tab.dataset.layer);
            syncInputs(panel);
            refresh(panel);
        });
    });
}

function renderPalette(panel) {
    const maxId = Math.max(1, Math.floor(num(panel.$.maxId, 10)));
    const counts = idCounts();
    let html = '';
    for (let id = 0; id < maxId; id++) {
        const s = drinkSprite(id);
        const active = tool.type === 'drink' && tool.id === id ? ' active' : '';
        html += '<div class="swatch' + active + '" data-tool="drink" data-id="' + id + '" title="Drink ' + id + '">' +
            (s && s.file ? '<img src="' + fileUrl(s.file) + '">' : '') + '<span>#' + id + '</span>' +
            '<span class="cnt">' + (counts.get(id) || '') + '</span></div>';
    }
    html += '<div class="swatch tool' + (tool.type === 'mail' ? ' active' : '') + '" data-tool="mail" title="Hộp giao hàng ' + mailW + '×' + mailH + ' (click lại để bỏ)">' +
        (sprites.mail && sprites.mail.file ? '<img src="' + fileUrl(sprites.mail.file) + '">' : '') + '<span>Mail</span></div>';
    html += '<div class="swatch tool' + (tool.type === 'erase' ? ' active' : '') + '" data-tool="erase" title="Xóa ô"><span>✕ Xóa</span></div>';
    panel.$.palette.innerHTML = html;
    panel.$.palette.querySelectorAll('.swatch').forEach((el) => {
        el.addEventListener('click', () => {
            tool = el.dataset.tool === 'drink' ? { type: 'drink', id: Number(el.dataset.id) } : { type: el.dataset.tool };
            renderPalette(panel);
        });
    });
}

function renderGrid(panel) {
    const v = view(panel);
    const l = level.layers[currentLayer];
    const tiles = allTiles(v);
    const showGhost = !!panel.$.ghostBelow.checked;
    const grid = panel.$.grid;
    grid.style.gridTemplateColumns = 'repeat(' + l.gridX + ', 52px)';
    grid.style.gridTemplateRows = 'repeat(' + l.gridY + ', 56px)';

    let html = '';
    for (let y = 0; y < l.gridY; y++) {
        for (let x = 0; x < l.gridX; x++) {
            const id = l.cells.get(key(x, y));
            const place = 'grid-column:' + (x + 1) + ';grid-row:' + (y + 1) + ';';
            let cls = 'cell';
            let inner = '<span class="coord">' + (y * l.gridX + x) + '</span>';
            if (id !== undefined) {
                const pos = cellPos(l, x, y, v);
                const covered = isCovered({ layer: currentLayer, px: pos.x, py: pos.y }, tiles, v);
                cls += ' filled' + (covered ? ' covered' : '');
                const s = drinkSprite(id);
                inner += (s && s.file ? '<img src="' + fileUrl(s.file) + '">' : '') + '<span class="id">' + id + '</span>';
            } else if (showGhost && currentLayer > 0) {
                const pos = cellPos(l, x, y, v);
                const below = tiles.find((t) => t.layer === currentLayer - 1 && overlaps(t, { px: pos.x, py: pos.y }, v));
                if (below) {
                    const s = drinkSprite(below.id);
                    cls += ' ghost';
                    inner += s && s.file ? '<img src="' + fileUrl(s.file) + '">' : '';
                }
            }
            html += '<div class="' + cls + '" style="' + place + '" data-x="' + x + '" data-y="' + y + '">' + inner + '</div>';
        }
    }
    for (const m of l.mails) {
        const p = parseKey(m);
        html += '<div class="mail" style="grid-column:' + (p.x + 1) + ' / span ' + mailW + ';grid-row:' + (p.y + 1) +
            ' / span ' + mailH + ';">MAIL</div>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.cell').forEach((cell) => {
        const x = Number(cell.dataset.x);
        const y = Number(cell.dataset.y);
        cell.addEventListener('mousedown', (event) => {
            event.preventDefault();
            pushUndo();
            painting = tool.type !== 'mail';
            applyTool(panel, x, y, event.button === 2);
        });
        cell.addEventListener('mouseenter', (event) => {
            if (!painting || !(event.buttons & 3)) return;
            applyTool(panel, x, y, (event.buttons & 2) !== 0);
        });
        cell.addEventListener('contextmenu', (event) => event.preventDefault());
    });
}

function renderPreview(panel) {
    const canvas = panel.$.preview;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const v = view(panel);
    const upTo = panel.$.previewUpTo.checked ? currentLayer : level.layers.length - 1;
    const tiles = allTiles(v).filter((t) => t.layer <= upTo);
    if (!tiles.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of tiles) {
        minX = Math.min(minX, t.px - v.cardW / 2); maxX = Math.max(maxX, t.px + v.cardW / 2);
        minY = Math.min(minY, t.py - v.cardH / 2); maxY = Math.max(maxY, t.py + v.cardH / 2);
    }
    const pad = 12;
    const scale = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2) / (maxY - minY));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const toX = (x) => canvas.width / 2 + (x - cx) * scale;
    const toY = (y) => canvas.height / 2 - (y - cy) * scale;
    const redraw = () => renderPreview(panel);
    const card = image(sprites.card && sprites.card.file, redraw);
    const mailImg = image(sprites.mail && sprites.mail.file, redraw);
    const dim = 'brightness(' + Math.max(0, Math.min(1, v.coveredGray / 255)) + ')';

    for (let li = 0; li <= upTo; li++) {
        const l = level.layers[li];
        const layerTiles = tiles.filter((t) => t.layer === li).sort((a, b) => a.y - b.y || a.x - b.x);
        for (const t of layerTiles) {
            ctx.filter = isCovered(t, tiles, v) ? dim : 'none';
            const w = v.cardW * scale;
            const h = v.cardH * scale;
            const x = toX(t.px) - w / 2;
            const y = toY(t.py) - h / 2;
            if (card) ctx.drawImage(card, x, y, w, h);
            else { ctx.fillStyle = '#fffaf2'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#b07a4f'; ctx.strokeRect(x, y, w, h); }
            const s = drinkSprite(t.id);
            const cup = image(s && s.file, redraw);
            if (cup) {
                const ch = v.cardH * v.cupRatio * scale;
                const cw = ch * cup.naturalWidth / cup.naturalHeight;
                ctx.drawImage(cup, toX(t.px) - cw / 2, toY(t.py + v.cupOffsetY) - ch / 2, cw, ch);
            } else {
                ctx.fillStyle = '#6b4a2a';
                ctx.font = Math.max(8, 14 * scale * 3) + 'px sans-serif';
                ctx.fillText(String(t.id), toX(t.px) - 4, toY(t.py) + 4);
            }
        }
        ctx.filter = 'none';
        for (const m of l.mails) {
            const p = parseKey(m);
            const a = cellPos(l, p.x, p.y, v);
            const b = cellPos(l, p.x + mailW - 1, p.y + mailH - 1, v);
            const w = (Math.abs(b.x - a.x) + v.cardW) * scale;
            const h = (Math.abs(b.y - a.y) + v.cardH) * scale;
            const x = toX((a.x + b.x) / 2) - w / 2;
            const y = toY((a.y + b.y) / 2) - h / 2;
            if (mailImg) ctx.drawImage(mailImg, x, y, w, h);
            else { ctx.fillStyle = 'rgba(240,120,190,0.8)'; ctx.fillRect(x, y, w, h); }
        }
    }
    ctx.filter = 'none';
}

function renderStats(panel) {
    const v = view(panel);
    const tiles = allTiles(v);
    const lines = [];
    const err = (s) => lines.push('<span class="err">✕ ' + s + '</span>');
    const warn = (s) => lines.push('<span class="warn">! ' + s + '</span>');

    lines.push('Tổng cốc: ' + tiles.length + '  (' + level.layers.map((l, i) => 'L' + (i + 1) + ':' + l.cells.size).join(' ') + ')');
    const covered = tiles.filter((t) => isCovered(t, tiles, v)).length;
    lines.push('Bị che lúc bắt đầu: ' + covered + ' · Lấy được ngay: ' + (tiles.length - covered));
    lines.push('Khách: ' + level.customers.length + ' (cần ' + level.customers.length * DRINK_PER_CUSTOMER + ' cốc)');

    const supply = idCounts();
    const demand = new Map();
    for (const id of level.customers) demand.set(id, (demand.get(id) || 0) + DRINK_PER_CUSTOMER);
    const ids = [...new Set([...supply.keys(), ...demand.keys()])].sort((a, b) => a - b);
    const table = ids.map((id) => {
        const have = supply.get(id) || 0;
        const need = demand.get(id) || 0;
        return '#' + id + ': ' + have + (need ? '/' + need : '') + (have !== need ? ' ✕' : '');
    });
    if (table.length) lines.push('Cốc/đơn theo ID: ' + table.join('  '));

    if (tiles.length % DRINK_PER_CUSTOMER !== 0) err('Tổng cốc không chia hết cho ' + DRINK_PER_CUSTOMER + '.');
    for (const id of ids) {
        const have = supply.get(id) || 0;
        const need = demand.get(id) || 0;
        if (have !== need) err('ID ' + id + ': trên bàn ' + have + ' cốc, khách cần ' + need + '.');
        if (!drinkSprite(id) || !drinkSprite(id).uuid) warn('ID ' + id + ' chưa có ảnh drink_' + id + '.png.');
    }
    level.layers.forEach((l, li) => {
        for (const m of l.mails) {
            const p = parseKey(m);
            let filled = 0;
            if (p.x + mailW > l.gridX || p.y + mailH > l.gridY) err('Mail L' + (li + 1) + ' (' + p.x + ',' + p.y + ') ' + mailW + '×' + mailH + ' tràn ra ngoài lưới.');
            for (let dy = 0; dy < mailH; dy++) for (let dx = 0; dx < mailW; dx++) if (l.cells.has(key(p.x + dx, p.y + dy))) filled++;
            if (filled < mailW * mailH) warn('Mail L' + (li + 1) + ' (' + p.x + ',' + p.y + ') chỉ chứa ' + filled + '/' + (mailW * mailH) + ' cốc.');
        }
    });
    if (lines.every((s) => !s.includes('class="err"'))) lines.push('<span class="ok">✓ Dữ liệu hợp lệ</span>');
    panel.$.stats.innerHTML = lines.join('\n');
}

function refresh(panel) {
    renderTabs(panel);
    renderPalette(panel);
    renderGrid(panel);
    renderPreview(panel);
    renderStats(panel);
}

/** Panel dock mở ngay khi khởi động editor, lúc asset-db chưa sẵn sàng thì mọi ảnh đều tra không ra. */
async function waitAssetDb() {
    for (let i = 0; i < 120; i++) {
        try {
            if (await Editor.Message.request('asset-db', 'query-ready')) return;
        } catch (e) { /* asset-db chưa nhận message */ }
        await new Promise((r) => setTimeout(r, 500));
    }
}

async function loadSprites(panel) {
    await waitAssetDb();
    const res =await req('resolve-sprites', panel.$.spriteRoot.value, Math.max(1, num(panel.$.maxId, 10)) - 1);
    if (res && res.drinks) sprites = res;
    const missing = sprites.drinks.map((d, i) => (d && d.uuid ? -1 : i)).filter((i) => i >= 0);
    panel.$.status.textContent = missing.length ? 'Thiếu ảnh cốc ID: ' + missing.join(', ') : 'Đã tải ảnh.';
    refresh(panel);
}

function setLevel(panel, lv, message) {
    level = lv;
    currentLayer = Math.min(currentLayer, level.layers.length - 1);
    undoStack = [];
    syncInputs(panel);
    refresh(panel);
    panel.$.status.textContent = message || '';
}

// ---------- panel ----------

exports.methods = {
    async loadJson() {
        const res = await req('read-level', this.$.jsonUrl.value.trim());
        if (!res || !res.ok) { this.$.status.textContent = (res && res.error) || 'Không tải được JSON.'; return; }
        setLevel(this, fromJson(res.data), 'Đã tải ' + res.url);
    },

    async pickJson() {
        const res = await req('selected-json');
        if (!res || !res.ok) { this.$.status.textContent = (res && res.error) || 'Chưa chọn JSON.'; return; }
        this.$.jsonUrl.value = res.url;
        await this.loadJson();
    },

    async loadUnity() {
        const n = Math.floor(num(this.$.unityLevel, 1));
        const res = await req('read-unity-level', this.$.unityDir.value.trim(), n);
        if (!res || !res.ok) { this.$.status.textContent = (res && res.error) || 'Không đọc được level Unity.'; return; }
        this.$.jsonUrl.value = 'db://assets/resources/levels/level_' + n + '.json';
        setLevel(this, fromJson(res.data), 'Đã import ' + res.file + '. Bấm Lưu JSON để lưu vào ' + this.$.jsonUrl.value);
    },

    async saveJson() {
        readCustomers(this);
        const res = await req('save-level', this.$.jsonUrl.value.trim(), toJson(level));
        this.$.status.textContent = res && res.ok ? 'Đã lưu ' + res.url : ((res && res.error) || 'Lưu thất bại.');
        return res;
    },

    async apply() {
        const selected = Editor.Selection.getSelected('node') || [];
        if (!selected.length) { this.$.status.textContent = 'Chọn node sẽ chứa map trong Hierarchy (nằm trong Canvas).'; return; }
        readCustomers(this);
        let jsonUuid = '';
        if (this.$.saveBeforeApply.checked) {
            const saved = await this.saveJson();
            if (!saved || !saved.ok) return;
            jsonUuid = saved.uuid;
        }
        this.$.apply.disabled = true;
        const res = await req('apply-map', { parentUuid: selected[0], data: toJson(level), jsonUuid, sprites, view: view(this) });
        this.$.apply.disabled = false;
        this.$.status.textContent = res && res.ok
            ? 'Đã dựng map vào "' + res.node + '": ' + res.info + '. Nhấn Ctrl+S để lưu scene.'
            : ((res && res.error) || 'Apply thất bại.');
    },
};

exports.ready = function () {
    const panel = this;
    level = newLevel();
    const on = (el, fn) => el.addEventListener('confirm', fn);
    const onInput = (el, fn) => el.addEventListener('change', fn);

    on(this.$.loadJson, () => this.loadJson());
    on(this.$.pickJson, () => this.pickJson());
    on(this.$.saveJson, () => this.saveJson());
    on(this.$.loadUnity, () => this.loadUnity());
    on(this.$.apply, () => this.apply());
    on(this.$.newLevel, () => setLevel(panel, newLevel(), 'Map mới 5×5. Nhớ đổi đường dẫn JSON trước khi lưu.'));
    on(this.$.reloadSprites, () => loadSprites(panel));

    on(this.$.addLayer, () => {
        pushUndo();
        const top = level.layers[level.layers.length - 1];
        level.layers.push(emptyLayer(top ? top.gridX : 5, top ? top.gridY : 5));
        currentLayer = level.layers.length - 1;
        syncInputs(panel); refresh(panel);
    });
    on(this.$.removeLayer, () => {
        if (level.layers.length <= 1) return;
        pushUndo();
        level.layers.splice(currentLayer, 1);
        currentLayer = Math.max(0, currentLayer - 1);
        syncInputs(panel); refresh(panel);
    });
    const swapLayer = (dir) => {
        const j = currentLayer + dir;
        if (j < 0 || j >= level.layers.length) return;
        pushUndo();
        [level.layers[currentLayer], level.layers[j]] = [level.layers[j], level.layers[currentLayer]];
        currentLayer = j;
        refresh(panel);
    };
    on(this.$.layerUp, () => swapLayer(1));
    on(this.$.layerDown, () => swapLayer(-1));

    onInput(this.$.levelNum, () => { level.level = Math.max(1, Math.floor(num(this.$.levelNum, 1))); });
    onInput(this.$.hard, () => { level.hard = this.$.hard.value; });
    onInput(this.$.region, () => { level.region = Math.max(0, Math.floor(num(this.$.region, 0))); });
    const onGrid = () => {
        pushUndo();
        const l = level.layers[currentLayer];
        resizeLayer(l, Math.max(1, Math.min(20, Math.floor(num(this.$.gridX, l.gridX)))),
            Math.max(1, Math.min(20, Math.floor(num(this.$.gridY, l.gridY)))));
        l.offsetX = num(this.$.offsetX, 0);
        l.offsetY = num(this.$.offsetY, 0);
        syncInputs(panel); refresh(panel);
    };
    [this.$.gridX, this.$.gridY, this.$.offsetX, this.$.offsetY].forEach((el) => onInput(el, onGrid));
    onInput(this.$.ghostBelow, () => renderGrid(panel));
    onInput(this.$.previewUpTo, () => renderPreview(panel));
    [this.$.cardW, this.$.cardH, this.$.stepX, this.$.stepY, this.$.cupRatio, this.$.cupOffsetY, this.$.coveredGray]
        .forEach((el) => onInput(el, () => refresh(panel)));
    const onMailSize = () => {
        mailW = Math.max(1, Math.min(10, Math.floor(num(this.$.mailW, 2))));
        mailH = Math.max(1, Math.min(10, Math.floor(num(this.$.mailH, 2))));
        this.$.mailW.value = mailW;
        this.$.mailH.value = mailH;
        refresh(panel);
    };
    [this.$.mailW, this.$.mailH].forEach((el) => onInput(el, onMailSize));
    onInput(this.$.maxId, () => loadSprites(panel));
    onInput(this.$.spriteRoot, () => loadSprites(panel));
    onInput(this.$.customers, () => { readCustomers(panel); renderStats(panel); });

    on(this.$.fillLayer, () => {
        if (tool.type !== 'drink') { this.$.status.textContent = 'Chọn một loại cốc trước.'; return; }
        pushUndo();
        const l = level.layers[currentLayer];
        for (let y = 0; y < l.gridY; y++) for (let x = 0; x < l.gridX; x++) if (!l.cells.has(key(x, y))) l.cells.set(key(x, y), tool.id);
        refresh(panel);
    });
    on(this.$.clearLayer, () => {
        pushUndo();
        const l = level.layers[currentLayer];
        l.cells.clear();
        l.mails.clear();
        refresh(panel);
    });
    on(this.$.shuffleIds, () => {
        pushUndo();
        const slots = [];
        level.layers.forEach((l) => { for (const k of l.cells.keys()) slots.push([l, k]); });
        const ids = shuffle(slots.map(([l, k]) => l.cells.get(k)));
        slots.forEach(([l, k], i) => l.cells.set(k, ids[i]));
        refresh(panel);
        this.$.status.textContent = 'Đã xáo ID ' + slots.length + ' cốc (giữ nguyên vị trí, số lượng mỗi loại).';
    });
    on(this.$.undo, () => {
        const snap = undoStack.pop();
        if (!snap) { this.$.status.textContent = 'Không còn gì để hoàn tác.'; return; }
        level = fromJson(JSON.parse(snap));
        currentLayer = Math.min(currentLayer, level.layers.length - 1);
        syncInputs(panel); refresh(panel);
    });
    on(this.$.genCustomers, () => {
        pushUndo();
        const list = [];
        for (const [id, count] of [...idCounts()].sort((a, b) => a[0] - b[0])) {
            for (let i = 0; i < Math.floor(count / DRINK_PER_CUSTOMER); i++) list.push(id);
        }
        level.customers = shuffle(list);
        syncInputs(panel); renderStats(panel);
    });
    on(this.$.shuffleCustomers, () => {
        readCustomers(panel);
        level.customers = shuffle(level.customers);
        syncInputs(panel); renderStats(panel);
    });

    this._stopPaint = () => { painting = false; };
    document.addEventListener('mouseup', this._stopPaint);

    syncInputs(panel);
    loadSprites(panel).then(() => this.loadJson());
};

exports.close = function () {
    if (this._stopPaint) document.removeEventListener('mouseup', this._stopPaint);
};
