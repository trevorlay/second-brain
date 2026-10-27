// mindmap.js: Mind Maps (list + blueprint canvas editor). All data stays on-device via store.js.
// Rendering is DOM bubbles + one SVG for lines, inside a "world" layer moved with a CSS transform.
// User text is only ever written with textContent (never innerHTML); colors are validated hex.
import * as store from './store.js';
import { uid } from './store.js';

const HEX = /^#[0-9a-f]{6}$/i;
const okCol = c => (typeof c === 'string' && HEX.test(c) ? c : null);
const BUBBLE = ['#ffffff', '#fff3b0', '#ffd6a5', '#ffadad', '#caffbf', '#b9fbc0', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#1e293b', '#0f766e'];
const TEXT = ['#0f172a', '#ffffff', '#1d4ed8', '#b91c1c', '#15803d', '#7c3aed', '#c2410c', '#475569'];
const LINE = ['#e6f0ff', '#ffd166', '#06d6a0', '#ef476f', '#7bdff2', '#c77dff', '#ff9f1c', '#ffffff'];
const PX = { s: 16, m: 20, l: 26, xl: 34 };
const SIZES = ['s', 'm', 'l', 'xl'];
const DEF_BG = '#ffffff', DEF_FG = '#0f172a', DEF_LINE = '#e6f0ff';
const MAX_HIST = 100;
const I = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/></svg>',
  fold: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  map: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/><circle cx="19.5" cy="18" r="2"/><path d="M9.5 10.5 6.2 7.2M14.5 10.5l3.3-3.3M14.5 13.5l3.3 3.3"/></svg>',
};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function download(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = s => (String(s || 'mind-map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mind-map').slice(0, 40);
export const plain = t => String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*(.+?)\*/g, '$1');

// Inline markup (**bold**, *italic*, __underline__) -> DOM nodes, built with textContent only.
function inline(parent, line) {
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g; let last = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > last) parent.appendChild(document.createTextNode(line.slice(last, m.index)));
    const t = m[0], tag = t.startsWith('**') ? 'b' : t.startsWith('__') ? 'u' : 'i', k = tag === 'i' ? 1 : 2;
    parent.appendChild(el(tag, null, t.slice(k, -k))); last = m.index + t.length;
  }
  if (last < line.length) parent.appendChild(document.createTextNode(line.slice(last)));
}
function richText(box, n, placeholder) {
  const lines = String(n.text || '').split('\n');
  if (!n.text) { box.appendChild(el('span', 'mm-ph', placeholder)); return; }
  let ul = null;
  for (const raw of lines) {
    const bullet = n.list ? raw.trim() !== '' : /^\s*[-•]\s+/.test(raw);
    const line = raw.replace(/^\s*[-•]\s+/, '');
    if (bullet) { if (!ul) { ul = el('ul'); box.appendChild(ul); } const li = el('li'); inline(li, line); ul.appendChild(li); }
    else { ul = null; const d = el('div'); if (!line) d.appendChild(document.createElement('br')); else inline(d, line); box.appendChild(d); }
  }
}

// ======================= Maps list =======================
let listQuery = '';
export async function renderMaps(ctx) {
  const { view, esc, toast, confirmDialog, promptDialog } = ctx;
  const maps = await store.listMaps();
  if (!/^#\/maps/.test(location.hash)) return;
  view.innerHTML = `<div class="row"><h1 class="spacer">Mind Maps</h1><button class="btn primary" id="mm-new" type="button">+ New map</button></div>
    <div class="searchbox">${I.find}<input id="mm-q" type="search" placeholder="Search maps by title" aria-label="Search maps by title" autocomplete="off" value="${esc(listQuery)}"></div>
    <div class="row mm-listtools"><button class="btn" id="mm-import" type="button">Import map (.json)</button><input type="file" id="mm-importfile" accept="application/json,.json" hidden></div>
    <div id="mm-list"></div>`;
  const draw = () => {
    const q = listQuery.trim().toLowerCase();
    const list = maps.filter(m => !q || m.title.toLowerCase().includes(q));
    const box = view.querySelector('#mm-list');
    if (!maps.length) { box.innerHTML = `<div class="empty"><span class="big">🗺️</span><b>No mind maps yet.</b><br>Tap <b>+ New map</b>, then tap the blue canvas to add your central subject.</div>`; return; }
    box.innerHTML = list.length ? list.map(m => `<div class="card mapcard" data-map="${esc(m.id)}">
      <a class="mapopen" href="#/map/${encodeURIComponent(m.id)}"><span class="mapicon">${I.map}</span><span class="spacer"><span class="name">${esc(m.title)}</span>
        <span class="sub">${m.nodes.length} bubble${m.nodes.length === 1 ? '' : 's'} · edited ${esc(new Date(m.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span></span></a>
      <div class="acts"><button class="btn" type="button" data-mact="rename">Rename</button><button class="btn" type="button" data-mact="dup">Duplicate</button><button class="btn" type="button" data-mact="json">Export</button><button class="btn danger" type="button" data-mact="del">Delete</button></div></div>`).join('')
      : `<div class="empty"><span class="big">🔎</span>No map titles match.</div>`;
  };
  draw();
  const q = view.querySelector('#mm-q'); q.oninput = () => { listQuery = q.value; draw(); };
  view.querySelector('#mm-new').onclick = () => newMap(ctx);
  view.querySelector('#mm-import').onclick = () => view.querySelector('#mm-importfile').click();
  view.querySelector('#mm-importfile').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); const m = d && d.kind === 'mindmap' ? d.map : d;
      if (!m || !Array.isArray(m.nodes)) throw 0;
      const saved = await store.saveMap({ ...m, id: uid(), createdAt: undefined });
      toast('Imported “' + saved.title + '”'); renderMaps(ctx);
    } catch { ctx.alertDialog('Can\u2019t import', 'That file isn\u2019t a mind map export.'); }
  };
  view.querySelector('#mm-list').onclick = async ev => {
    const b = ev.target.closest('[data-mact]'); if (!b) return;
    const m = maps.find(x => x.id === b.closest('[data-map]').dataset.map); const act = b.dataset.mact;
    if (act === 'rename') { const t = await promptDialog('Rename map', m.title, 'Save', 'Map title'); if (t) { await store.saveMap({ ...m, title: t }); toast('Renamed'); renderMaps(ctx); } }
    if (act === 'dup') { await store.saveMap({ ...structuredClone(m), id: uid(), title: m.title + ' (copy)', createdAt: undefined }); toast('Duplicated'); renderMaps(ctx); }
    if (act === 'json') exportJSON(m);
    if (act === 'del' && await confirmDialog('Delete this map?', `“${m.title}” and its ${m.nodes.length} bubbles will be removed from this phone.`, 'Delete', true)) {
      await store.deleteMap(m.id); toast('Map deleted'); renderMaps(ctx);
    }
  };
}
export async function newMap(ctx) {
  const t = await ctx.promptDialog('New mind map', '', 'Create', 'Map title (e.g. Business ideas)');
  if (t === null) return;
  const m = await store.saveMap({ title: t || 'Untitled map', nodes: [], links: [] });
  location.hash = '#/map/' + encodeURIComponent(m.id);
}
function exportJSON(m) {
  const data = { app: 'second-brain', kind: 'mindmap', version: 1, exportedAt: new Date().toISOString(), map: m };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), slug(m.title) + '.mindmap.json');
}

// ======================= Editor =======================
export async function openEditor(id, ctx) {
  const { view, toast, confirmDialog, promptDialog } = ctx;
  const loaded = await store.getMap(id);
  if (!location.hash.startsWith('#/map/')) return () => {};
  if (!loaded) { view.innerHTML = `<div class="empty">Map not found. <a href="#/maps">Back to Mind Maps</a></div>`; return () => {}; }
  const map = store.normMap(loaded);
  document.body.classList.add('mm-open');
  const root = el('div', 'mm'); root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Mind map editor');
  root.innerHTML = `
  <div class="mm-top">
    <button class="mm-ib" id="mm-back" type="button" aria-label="Back to Mind Maps">${I.back}</button>
    <button class="mm-title" id="mm-title" type="button" aria-label="Rename map"></button>
    <span class="mm-saved" id="mm-saved" role="status" aria-live="polite">Saved</span>
    <button class="mm-ib" id="mm-undo" type="button" aria-label="Undo">${I.undo}</button>
    <button class="mm-ib" id="mm-redo" type="button" aria-label="Redo">${I.redo}</button>
    <button class="mm-ib" id="mm-find" type="button" aria-label="Find in map">${I.find}</button>
    <button class="mm-ib" id="mm-more" type="button" aria-label="More options" aria-haspopup="menu">${I.more}</button>
  </div>
  <div class="mm-findbar" id="mm-findbar" hidden><input id="mm-findq" type="search" placeholder="Find in this map" aria-label="Find in this map" enterkeyhint="search" autocomplete="off">
    <span id="mm-findn" class="mm-findn"></span><button class="btn" id="mm-findnext" type="button">Next</button><button class="mm-ib" id="mm-findx" type="button" aria-label="Close search">${I.x}</button></div>
  <div class="mm-edit" id="mm-edit" hidden><textarea id="mm-text" rows="2" aria-label="Bubble text" placeholder="Type the idea…" enterkeyhint="enter"></textarea>
    <div class="mm-editrow"><span class="mm-tip">Select words + B/I/U to format them. Start a line with “- ” for a bullet.</span><button class="btn primary" id="mm-done" type="button">Done</button></div></div>
  <div class="mm-stage" id="mm-stage" tabindex="0" aria-label="Mind map canvas. Tab to move between bubbles, Enter adds a child, Delete removes.">
    <div class="mm-world" id="mm-world"><svg class="mm-svg" id="mm-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg><div id="mm-nodes"></div></div>
    <div class="mm-empty" id="mm-empty"><b>Tap anywhere</b> to add your central subject</div>
    <div class="mm-banner" id="mm-banner" hidden><span>Tap another bubble to link to</span><button class="btn" id="mm-linkcancel" type="button">Cancel</button></div>
    <div class="mm-zoom"><button type="button" id="mm-zout" aria-label="Zoom out">−</button><span id="mm-zpct" aria-label="Zoom level">100%</span><button type="button" id="mm-zin" aria-label="Zoom in">+</button><button type="button" id="mm-fit" aria-label="Fit map to screen">${I.fit}</button></div>
  </div>
  <div class="mm-pop" id="mm-pop" hidden></div>
  <div class="mm-menu" id="mm-menu" role="menu" hidden>
    <button type="button" role="menuitem" data-menu="png">Export image (PNG)</button>
    <button type="button" role="menuitem" data-menu="share" id="mm-share">Share image…</button>
    <button type="button" role="menuitem" data-menu="json">Export map (.json)</button>
    <button type="button" role="menuitem" data-menu="kids" id="mm-kids"></button>
    <button type="button" role="menuitem" data-menu="rename">Rename map</button>
    <button type="button" role="menuitem" data-menu="tips">Show tips</button>
  </div>
  <div class="mm-tools" id="mm-tools" hidden>
    <div class="mm-row" id="mm-nodetools">
      <button type="button" data-t="edit" aria-label="Edit text">${I.edit}<span>Edit</span></button>
      <button type="button" data-t="child" aria-label="Add child bubble">${I.plus}<span>Child</span></button>
      <button type="button" data-t="link" aria-label="Link to another bubble">${I.link}<span>Link</span></button>
      <button type="button" data-t="fold" aria-label="Collapse or expand branch">${I.fold}<span id="mm-foldlbl">Collapse</span></button>
      <button type="button" data-t="del" class="danger" aria-label="Delete bubble and its branch">${I.trash}<span>Delete</span></button>
    </div>
    <div class="mm-row" id="mm-fmt">
      <button type="button" data-t="bg" aria-label="Bubble color"><i class="sw" id="sw-bg"></i><span>Bubble</span></button>
      <button type="button" data-t="fg" aria-label="Text color"><i class="sw sw-a" id="sw-fg">A</i><span>Text</span></button>
      <button type="button" data-t="line" aria-label="Branch line color"><i class="sw sw-l" id="sw-line"></i><span>Line</span></button>
      <button type="button" data-t="b" aria-label="Bold" aria-pressed="false"><b class="fmt">B</b></button>
      <button type="button" data-t="i" aria-label="Italic" aria-pressed="false"><i class="fmt">I</i></button>
      <button type="button" data-t="u" aria-label="Underline" aria-pressed="false"><u class="fmt">U</u></button>
      <button type="button" data-t="size" aria-label="Text size"><b class="fmt" id="mm-sizelbl">M</b></button>
      <button type="button" data-t="list" aria-label="Bullet list" aria-pressed="false"><span class="fmt">•≡</span></button>
    </div>
    <div class="mm-row" id="mm-linktools" hidden>
      <span class="mm-linklbl">Link</span>
      <button type="button" data-t="lcolor" aria-label="Link color"><i class="sw sw-l" id="sw-link"></i><span>Color</span></button>
      <button type="button" data-t="ldel" class="danger" aria-label="Delete link">${I.trash}<span>Delete link</span></button>
      <button type="button" data-t="ldone" aria-label="Done with link">${I.x}<span>Close</span></button>
    </div>
  </div>`;
  view.innerHTML = ''; view.appendChild(root);
  const $ = s => root.querySelector(s);
  const stage = $('#mm-stage'), world = $('#mm-world'), svg = $('#mm-svg'), nodesBox = $('#mm-nodes');
  const ta = $('#mm-text');

  // ---------- state ----------
  let sel = null, selLink = null, linkFrom = null, editing = null, lastTap = { id: null, t: 0 };
  let k = map.view.k || 1, tx = map.view.x, ty = map.view.y;
  const sizes = new Map();
  let hist = [], hi = -1;
  const snap = () => JSON.stringify({ nodes: map.nodes, links: map.links });
  const byId = id => map.nodes.find(n => n.id === id);
  const kids = id => map.nodes.filter(n => n.parent === id);
  const desc = id => { const out = []; const st = [id]; while (st.length) { const c = st.pop(); for (const n of kids(c)) { out.push(n); st.push(n.id); } } return out; };
  const hiddenSet = () => { const h = new Set(); for (const n of map.nodes) if (n.collapsed) for (const d of desc(n.id)) h.add(d.id); return h; };
  const lineOf = n => { let c = n; while (c) { if (c.line) return c.line; c = byId(c.parent); } return DEF_LINE; };
  const sz = n => sizes.get(n.id) || { w: 160, h: 56 };

  // ---------- saving ----------
  let saveT = null, dirty = false;
  const savedEl = $('#mm-saved');
  const doSave = async () => { clearTimeout(saveT); if (!dirty) return; dirty = false; map.view = { x: tx, y: ty, k }; await store.saveMap(map); if (!dirty) { savedEl.textContent = 'Saved'; savedEl.classList.remove('busy'); } };
  const schedule = (quiet = false) => { dirty = true; if (!quiet) { savedEl.textContent = 'Saving…'; savedEl.classList.add('busy'); } clearTimeout(saveT); saveT = setTimeout(doSave, quiet ? 900 : 350); };
  const commit = () => {
    const s = snap(); if (hist[hi] === s) return;
    hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > MAX_HIST + 1) hist.shift(); hi = hist.length - 1;
    updUndo(); schedule();
  };
  const restore = s => { const d = JSON.parse(s); map.nodes = d.nodes; map.links = d.links; if (sel && !byId(sel)) sel = null; if (selLink && !map.links.find(l => l.id === selLink)) selLink = null; renderAll(); schedule(); updUndo(); };
  const undo = () => { if (editing) finishEdit(); if (hi > 0) { hi--; restore(hist[hi]); toast('Undone'); } };
  const redo = () => { if (hi < hist.length - 1) { hi++; restore(hist[hi]); toast('Redone'); } };
  const updUndo = () => { $('#mm-undo').disabled = hi <= 0; $('#mm-redo').disabled = hi >= hist.length - 1; };

  // ---------- view transform ----------
  const applyView = () => {
    world.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
    const g = 24 * k, G = 120 * k;
    stage.style.backgroundSize = `${G}px ${G}px, ${G}px ${G}px, ${g}px ${g}px, ${g}px ${g}px, auto`;
    stage.style.backgroundPosition = `${tx}px ${ty}px, ${tx}px ${ty}px, ${tx}px ${ty}px, ${tx}px ${ty}px, 0 0`;
    $('#mm-zpct').textContent = Math.round(k * 100) + '%';
  };
  const zoomAt = (k2, sx, sy) => { k2 = Math.min(3, Math.max(0.15, k2)); tx = sx - (sx - tx) * (k2 / k); ty = sy - (sy - ty) * (k2 / k); k = k2; applyView(); schedule(true); };
  const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return [(cx - r.left - tx) / k, (cy - r.top - ty) / k]; };
  const centerOn = (n, k2 = k) => { const [cx, cy] = center(); k = k2; tx = cx - n.x * k; ty = cy - n.y * k; applyView(); schedule(true); };
  function fit() {
    const h = hiddenSet(); const vis = map.nodes.filter(n => !h.has(n.id));
    const r = stage.getBoundingClientRect();
    if (!vis.length) { k = 1; tx = r.width / 2; ty = r.height / 2; applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of vis) { const s = sz(n); x0 = Math.min(x0, n.x - s.w / 2); x1 = Math.max(x1, n.x + s.w / 2); y0 = Math.min(y0, n.y - s.h / 2); y1 = Math.max(y1, n.y + s.h / 2); }
    const pad = 36; k = Math.min(1.4, Math.max(0.15, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2 - 60) / (y1 - y0))));
    tx = r.width / 2 - (x0 + x1) / 2 * k; ty = (r.height - 60) / 2 - (y0 + y1) / 2 * k; applyView(); schedule(true);
  }

  // ---------- rendering ----------
  function renderAll() {
    const focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.mm-node')?.dataset.id;
    const h = hiddenSet();
    nodesBox.textContent = '';
    const q = findQ.toLowerCase();
    for (const n of map.nodes) {
      if (h.has(n.id)) continue;
      const d = el('div', 'mm-node' + (n.parent ? '' : ' root') + (n.id === sel ? ' sel' : '') + (n.id === linkFrom ? ' linkfrom' : '') +
        (q && plain(n.text).toLowerCase().includes(q) ? ' hit' : '') + (n.id === findCur ? ' hitcur' : '') + (n.id === editing?.id ? ' editing' : ''));
      d.dataset.id = n.id; d.tabIndex = 0; d.setAttribute('role', 'button');
      d.setAttribute('aria-label', (plain(n.text) || 'Empty bubble') + (n.collapsed ? `, collapsed, ${desc(n.id).length} hidden` : ''));
      d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
      d.style.background = okCol(n.bg) || DEF_BG; d.style.color = okCol(n.fg) || DEF_FG; d.style.fontSize = PX[n.size] + 'px';
      if (n.b) d.style.fontWeight = '800'; if (n.i) d.style.fontStyle = 'italic'; if (n.u) d.style.textDecoration = 'underline';
      const t = el('div', 'mm-txt'); richText(t, n, n.parent ? 'New idea' : 'Central subject'); d.appendChild(t);
      if (n.collapsed) { const b = el('button', 'mm-badge', '+' + desc(n.id).length); b.type = 'button'; b.setAttribute('aria-label', 'Expand branch'); b.dataset.expand = n.id; d.appendChild(b); }
      if (n.id === sel && !linkFrom) {
        const p = byId(n.parent); const left = p && n.x < p.x;
        const b = el('button', 'mm-plus' + (left ? ' left' : '')); b.type = 'button'; b.innerHTML = I.plus; b.setAttribute('aria-label', 'Add child bubble'); d.appendChild(b);
      }
      nodesBox.appendChild(d);
    }
    for (const d of nodesBox.children) sizes.set(d.dataset.id, { w: d.offsetWidth, h: d.offsetHeight });
    drawLines();
    $('#mm-empty').hidden = map.nodes.length > 0;
    updTools();
    if (focusId) { const f = nodesBox.querySelector(`[data-id="${CSS.escape(focusId)}"]`); if (f) f.focus({ preventScroll: true }); }
  }
  function edgePt(n, tx2, ty2) { // where the line from n's center toward (tx2,ty2) leaves n's box
    const s = sz(n), dx = tx2 - n.x, dy = ty2 - n.y; if (!dx && !dy) return [n.x, n.y];
    const sx = (s.w / 2 + 4) / Math.abs(dx || 1e-9), sy = (s.h / 2 + 4) / Math.abs(dy || 1e-9), f = Math.min(sx, sy, 1);
    return [n.x + dx * f, n.y + dy * f];
  }
  function geometry() {
    const h = hiddenSet(); const edges = [], links = [];
    for (const n of map.nodes) {
      if (!n.parent || h.has(n.id)) continue; const p = byId(n.parent); if (!p) continue;
      const mx = (p.x + n.x) / 2;
      edges.push({ id: n.id, color: lineOf(n), w: p.parent ? 3.5 : 5, pts: [p.x, p.y, mx, p.y, mx, n.y, n.x, n.y] });
    }
    for (const l of map.links) {
      const a = byId(l.from), b = byId(l.to); if (!a || !b || h.has(a.id) || h.has(b.id)) continue;
      const [x1, y1] = edgePt(a, b.x, b.y), [x2, y2] = edgePt(b, a.x, a.y);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len, ny = (x2 - x1) / len, bend = Math.min(80, len * 0.18);
      const cx = (x1 + x2) / 2 + nx * bend, cy = (y1 + y2) / 2 + ny * bend;
      const ax = x2 - cx, ay = y2 - cy, al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al, L = 16, W = 8;
      links.push({ id: l.id, color: okCol(l.color) || '#ffd166', x1, y1, cx, cy, x2, y2, head: [x2, y2, x2 - ux * L + uy * W, y2 - uy * L - ux * W, x2 - ux * L - uy * W, y2 - uy * L + ux * W] });
    }
    return { edges, links };
  }
  function drawLines() {
    const { edges, links } = geometry(); const f = v => v.toFixed(1);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of map.nodes) { x0 = Math.min(x0, n.x - 400); y0 = Math.min(y0, n.y - 400); x1 = Math.max(x1, n.x + 400); y1 = Math.max(y1, n.y + 400); }
    if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    svg.style.left = x0 + 'px'; svg.style.top = y0 + 'px'; svg.style.width = (x1 - x0) + 'px'; svg.style.height = (y1 - y0) + 'px'; svg.setAttribute('width', x1 - x0); svg.setAttribute('height', y1 - y0);
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    // Only numbers and validated hex colors go into this markup.
    svg.innerHTML = edges.map(e => { const p = e.pts.map(f); return `<path class="mm-edge" d="M${p[0]} ${p[1]}C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}" stroke="${e.color}" stroke-width="${e.w}"/>`; }).join('') +
      links.map(l => { const d = `M${f(l.x1)} ${f(l.y1)}Q${f(l.cx)} ${f(l.cy)} ${f(l.x2)} ${f(l.y2)}`; return `<g class="mm-link${l.id === selLink ? ' sel' : ''}" data-link="${l.id.replace(/[^\w-]/g, '')}">
        <path class="mm-linkline" d="${d}" stroke="${l.color}"/><path class="mm-linkhead" d="M${l.head.slice(0, 2).map(f).join(' ')}L${l.head.slice(2, 4).map(f).join(' ')}L${l.head.slice(4).map(f).join(' ')}Z" fill="${l.color}"/>
        <path class="mm-linkhit" d="${d}" data-link="${l.id.replace(/[^\w-]/g, '')}"/></g>`; }).join('');
  }
  function updTools() {
    const tools = $('#mm-tools'), n = sel && byId(sel);
    tools.hidden = !n && !selLink;
    $('#mm-nodetools').hidden = $('#mm-fmt').hidden = !n; $('#mm-linktools').hidden = !selLink || !!n;
    if (n) {
      $('#sw-bg').style.background = n.bg || DEF_BG; $('#sw-fg').style.color = n.fg || DEF_FG; $('#sw-fg').style.background = n.bg || DEF_BG; $('#sw-line').style.background = lineOf(n);
      for (const k2 of ['b', 'i', 'u', 'list']) $(`[data-t="${k2}"]`).setAttribute('aria-pressed', String(!!n[k2]));
      $('#mm-sizelbl').textContent = n.size.toUpperCase();
      $('#mm-foldlbl').textContent = n.collapsed ? 'Expand' : 'Collapse';
      $('[data-t="fold"]').disabled = !kids(n.id).length;
    }
    if (selLink) { const l = map.links.find(x => x.id === selLink); if (l) $('#sw-link').style.background = l.color || '#ffd166'; }
    $('#mm-banner').hidden = !linkFrom;
  }
  function select(id) { sel = id; selLink = null; closePop(); renderAll(); }

  // ---------- editing ----------
  function startEdit(id, isNew = false) {
    if (editing) finishEdit();
    const n = byId(id); if (!n) return;
    sel = id; editing = { id, isNew, orig: n.text };
    $('#mm-edit').hidden = false; ta.value = n.text; renderAll();
    requestAnimationFrame(() => { ensureVisible(n); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  }
  function finishEdit() {
    if (!editing) return; const { id, isNew, orig } = editing; editing = null;
    $('#mm-edit').hidden = true; ta.blur();
    const n = byId(id);
    if (n) {
      n.text = ta.value.replace(/\s+$/, '');
      if (isNew && !n.text.trim()) { map.nodes = map.nodes.filter(x => x !== n); if (sel === id) sel = n.parent || null; renderAll(); return; }
      if (isNew) { renderAll(); settle(n); }
      if (n.text !== orig || isNew) commit();
    }
    renderAll();
  }
  // After a new bubble gets its real (measured) size, nudge it down until it no longer overlaps anything.
  function settle(n) {
    const h = hiddenSet();
    for (let i = 0; i < 80; i++) {
      const s = sz(n);
      const hit = map.nodes.find(m => m !== n && !h.has(m.id) && Math.abs(m.x - n.x) < (sz(m).w + s.w) / 2 + 12 && Math.abs(m.y - n.y) < (sz(m).h + s.h) / 2 + 10);
      if (!hit) return; n.y = Math.round(n.y + 16);
    }
  }
  ta.addEventListener('input', () => { const n = editing && byId(editing.id); if (!n) return; n.text = ta.value; renderAll(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishEdit(); stage.focus({ preventScroll: true }); } });
  $('#mm-done').onclick = () => finishEdit();
  function ensureVisible(n) {
    const r = stage.getBoundingClientRect(), sx = n.x * k + tx, sy = n.y * k + ty;
    // Pan just enough to show the whole bubble (keeps its parent in view where possible).
    const s = sz(n), hw = s.w * k / 2 + 16, hh = s.h * k / 2 + 16, bottom = r.height - 160;
    let dx = 0, dy = 0;
    if (sx - hw < 0) dx = hw - sx; else if (sx + hw > r.width) dx = r.width - (sx + hw);
    if (sy - hh < 0) dy = hh - sy; else if (sy + hh > bottom) dy = bottom - (sy + hh);
    if (dx || dy) { tx += dx; ty += dy; applyView(); schedule(true); }
  }

  // ---------- structure ----------
  function addRoot(x, y) {
    const n = { id: uid(), parent: null, x: Math.round(x), y: Math.round(y), text: '', size: 'l', bg: null, fg: null, line: null, b: true, i: false, u: false, list: false, collapsed: false };
    map.nodes.push(n); startEdit(n.id, true);
  }
  function addChild(pid) {
    if (editing) finishEdit();
    const p = byId(pid); if (!p) return;
    if (p.collapsed) p.collapsed = false;
    const ks = kids(pid); let side;
    if (!p.parent) { const r = ks.filter(c => c.x >= p.x).length; side = r <= ks.length - r ? 1 : -1; }
    else { const gp = byId(p.parent); side = gp && p.x < gp.x ? -1 : 1; }
    const ps = sz(p), est = { w: 170, h: 58 };
    const x = Math.round(p.x + side * (ps.w / 2 + 60 + est.w / 2));
    const sideKids = ks.filter(c => (c.x - p.x) * side > 0);
    let y = sideKids.length ? Math.max(...sideKids.map(c => c.y + sz(c).h / 2)) + 22 + est.h / 2 : p.y;
    const h = hiddenSet();
    const clash = yy => map.nodes.some(m => !h.has(m.id) && Math.abs(m.x - x) < (sz(m).w + est.w) / 2 + 14 && Math.abs(m.y - yy) < (sz(m).h + est.h) / 2 + 12);
    for (let g = 0; g < 80 && clash(y); g++) y += 24;
    const n = { id: uid(), parent: pid, x, y: Math.round(y), text: '', size: 'm', bg: null, fg: null, line: null, b: false, i: false, u: false, list: false, collapsed: false };
    map.nodes.push(n); startEdit(n.id, true);
  }
  async function delNode(id) {
    const n = byId(id); if (!n) return; if (editing) finishEdit();
    const sub = desc(id); const nm = plain(n.text).slice(0, 60) || 'this bubble';
    const ok = sub.length || n.text ? await confirmDialog(n.parent ? 'Delete this bubble?' : 'Delete the central subject?',
      `“${nm}”${sub.length ? ` and the ${sub.length} bubble${sub.length === 1 ? '' : 's'} under it` : ''} will be removed. You can undo this.`, 'Delete', true) : true;
    if (!ok) return;
    const gone = new Set([id, ...sub.map(s => s.id)]);
    map.nodes = map.nodes.filter(m => !gone.has(m.id)); map.links = map.links.filter(l => !gone.has(l.from) && !gone.has(l.to));
    sel = n.parent && byId(n.parent) ? n.parent : null; commit(); renderAll(); toast('Deleted');
  }
  function toggleFold(id) { const n = byId(id); if (!n || !kids(id).length) return; n.collapsed = !n.collapsed; commit(); renderAll(); }
  function makeLink(a, b) {
    linkFrom = null;
    if (a === b) { toast('Pick a different bubble'); renderAll(); return; }
    if (map.links.some(l => (l.from === a && l.to === b))) { toast('Already linked'); renderAll(); return; }
    map.links.push({ id: uid(), from: a, to: b, color: '#ffd166' }); sel = b; commit(); renderAll(); toast('Linked');
  }

  // ---------- pointer: tap / drag / pan / pinch ----------
  const ptrs = new Map(); let g = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.mm-plus,.mm-badge,.mm-zoom,.mm-banner')) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [[ax, ay], [bx, by]] = [...ptrs.values()]; const r = stage.getBoundingClientRect();
      const mx = (ax + bx) / 2 - r.left, my = (ay + by) / 2 - r.top;
      g = { type: 'pinch', d0: Math.hypot(ax - bx, ay - by) || 1, k0: k, wx: (mx - tx) / k, wy: (my - ty) / k };
      return;
    }
    if (ptrs.size > 2) return;
    const nodeEl = e.target.closest('.mm-node'), linkEl = e.target.closest('.mm-linkhit');
    g = { type: nodeEl ? 'node' : linkEl ? 'link' : 'bg', id: nodeEl ? nodeEl.dataset.id : linkEl ? linkEl.dataset.link : null, sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty, moved: false };
  });
  const onMove = e => {
    if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (g.type === 'pinch') {
      if (ptrs.size < 2) return; const [[ax, ay], [bx, by]] = [...ptrs.values()]; const r = stage.getBoundingClientRect();
      k = Math.min(3, Math.max(0.15, g.k0 * Math.hypot(ax - bx, ay - by) / g.d0));
      tx = (ax + bx) / 2 - r.left - g.wx * k; ty = (ay + by) / 2 - r.top - g.wy * k; applyView(); return;
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 8) return;
    if (!g.moved) {
      g.moved = true;
      if (g.type === 'node') { const n = byId(g.id); const group = [n, ...(map.moveKids ? desc(n.id) : [])]; g.start = group.map(m => [m, m.x, m.y]); stage.classList.add('dragging'); }
    }
    if (g.type === 'node') {
      for (const [m, x0, y0] of g.start) { m.x = Math.round(x0 + dx / k); m.y = Math.round(y0 + dy / k); const d = nodesBox.querySelector(`[data-id="${CSS.escape(m.id)}"]`); if (d) { d.style.left = m.x + 'px'; d.style.top = m.y + 'px'; } }
      drawLines();
    } else { tx = g.tx0 + dx; ty = g.ty0 + dy; applyView(); }
  };
  const onUp = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') { if (!ptrs.size) { g = null; schedule(true); } return; }
    const gg = g; g = null; stage.classList.remove('dragging');
    if (e.type === 'pointercancel') { if (gg.moved && gg.type === 'node') commit(); return; }
    if (gg.moved) { if (gg.type === 'node') { commit(); renderAll(); } else schedule(true); return; }
    tap(gg, e);
  };
  addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(k * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  function tap(gg, e) {
    closePop(); closeMenu();
    if (gg.type === 'node') {
      if (linkFrom) return makeLink(linkFrom, gg.id);
      const now = Date.now();
      if (lastTap.id === gg.id && now - lastTap.t < 400) { lastTap = { id: null, t: 0 }; return startEdit(gg.id); }
      lastTap = { id: gg.id, t: now };
      if (editing && editing.id !== gg.id) finishEdit();
      if (sel !== gg.id) select(gg.id);
      return;
    }
    if (gg.type === 'link') { if (editing) finishEdit(); linkFrom = null; sel = null; selLink = gg.id; renderAll(); return; }
    if (linkFrom) { linkFrom = null; renderAll(); return; }
    if (editing) { finishEdit(); return; }
    if (!map.nodes.length) { const [x, y] = toWorld(e.clientX, e.clientY); return addRoot(x, y); }
    sel = null; selLink = null; renderAll();
  }
  nodesBox.addEventListener('click', e => {
    const p = e.target.closest('.mm-plus'); if (p) { e.stopPropagation(); return addChild(p.closest('.mm-node').dataset.id); }
    const b = e.target.closest('.mm-badge'); if (b) { e.stopPropagation(); return toggleFold(b.dataset.expand); }
  });
  nodesBox.addEventListener('focusin', e => { const d = e.target.closest('.mm-node'); if (d && d === e.target && sel !== d.dataset.id && !g) { sel = d.dataset.id; selLink = null; renderAll(); } });

  // ---------- keyboard ----------
  const onKey = e => {
    if (!root.isConnected) return;
    if (document.querySelector('#modal-root .overlay')) return;
    const typing = /^(TEXTAREA|INPUT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (typing || !root.contains(e.target)) return;
    if (e.key === 'Escape') { linkFrom = null; sel = null; selLink = null; closePop(); closeMenu(); renderAll(); stage.focus({ preventScroll: true }); return; }
    if (!sel) { if (e.key === 'Enter' && e.target === stage && !map.nodes.length) { const [cx, cy] = center(); addRoot((cx - tx) / k, (cy - ty) / k); e.preventDefault(); } return; }
    if (!e.target.closest('.mm-node,.mm-stage')) return;
    if (e.key === 'Enter') { e.preventDefault(); if (linkFrom) makeLink(linkFrom, sel); else addChild(sel); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delNode(sel); }
    else if (e.key === 'F2' || e.key === ' ') { e.preventDefault(); startEdit(sel); }
  };
  addEventListener('keydown', onKey);

  // ---------- toolbar ----------
  const pop = $('#mm-pop');
  function closePop() { pop.hidden = true; pop.textContent = ''; }
  function palette(title, colors, cur, apply, allowDefault = true) {
    pop.textContent = '';
    pop.appendChild(el('div', 'mm-poptitle', title));
    const grid = el('div', 'mm-swatches');
    for (const c of colors) { const b = el('button', 'mm-sw' + (c === cur ? ' on' : '')); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Color ' + c); b.dataset.color = c; grid.appendChild(b); }
    pop.appendChild(grid);
    const row = el('div', 'mm-poprow');
    const lab = el('label', 'btn mm-custom'); lab.textContent = 'Custom… '; const inp = el('input'); inp.type = 'color'; inp.id = 'mm-custom'; inp.value = cur || colors[0]; inp.setAttribute('aria-label', 'Custom color'); lab.appendChild(inp); row.appendChild(lab);
    if (allowDefault) { const d = el('button', 'btn', 'Default'); d.type = 'button'; d.dataset.color = ''; row.appendChild(d); }
    const x = el('button', 'btn', 'Close'); x.type = 'button'; x.dataset.close = '1'; row.appendChild(x);
    pop.appendChild(row);
    pop.onclick = ev => { const b = ev.target.closest('[data-color],[data-close]'); if (!b) return; if (b.dataset.close) return closePop(); apply(b.dataset.color || null); commit(); renderAll(); refreshOn(b.dataset.color); };
    inp.oninput = () => { apply(inp.value); renderAll(); };
    inp.onchange = () => { apply(inp.value); commit(); renderAll(); };
    const refreshOn = c => pop.querySelectorAll('.mm-sw').forEach(s => s.classList.toggle('on', s.dataset.color === c));
    pop.hidden = false;
  }
  function sizePop(n) {
    pop.textContent = ''; pop.appendChild(el('div', 'mm-poptitle', 'Text size'));
    const row = el('div', 'mm-poprow');
    for (const s of SIZES) { const b = el('button', 'btn' + (n.size === s ? ' primary' : ''), s.toUpperCase()); b.type = 'button'; b.dataset.size = s; b.style.fontSize = Math.min(24, PX[s]) + 'px'; row.appendChild(b); }
    pop.appendChild(row); pop.hidden = false;
    pop.onclick = ev => { const b = ev.target.closest('[data-size]'); if (!b) return; n.size = b.dataset.size; commit(); renderAll(); closePop(); };
  }
  const MARK = { b: '**', i: '*', u: '__' };
  $('#mm-tools').addEventListener('pointerdown', e => { if (editing && e.target.closest('[data-t="b"],[data-t="i"],[data-t="u"]')) e.preventDefault(); });
  $('#mm-tools').onclick = ev => {
    const b = ev.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t; const n = sel && byId(sel);
    if (t === 'ldel') { map.links = map.links.filter(l => l.id !== selLink); selLink = null; commit(); renderAll(); closePop(); toast('Link deleted'); return; }
    if (t === 'ldone') { selLink = null; closePop(); renderAll(); return; }
    if (t === 'lcolor') { const l = map.links.find(x => x.id === selLink); if (l) palette('Link color', LINE, l.color, c => { l.color = c || '#ffd166'; }, false); return; }
    if (!n) return;
    if (t !== 'b' && t !== 'i' && t !== 'u' && t !== 'list' && editing && t !== 'bg' && t !== 'fg' && t !== 'line' && t !== 'size') finishEdit();
    if (t === 'edit') return startEdit(n.id);
    if (t === 'child') return addChild(n.id);
    if (t === 'link') { linkFrom = n.id; closePop(); renderAll(); toast('Now tap the bubble to link to'); return; }
    if (t === 'fold') return toggleFold(n.id);
    if (t === 'del') return delNode(n.id);
    if (t === 'bg') return palette('Bubble color', BUBBLE, n.bg || DEF_BG, c => { n.bg = c; });
    if (t === 'fg') return palette('Text color', TEXT, n.fg || DEF_FG, c => { n.fg = c; });
    if (t === 'line') return palette('Branch line color (applies to this branch)', LINE, lineOf(n), c => { n.line = c; });
    if (t === 'size') return sizePop(n);
    if (t === 'list') { n.list = !n.list; commit(); renderAll(); return; }
    if (editing && editing.id === n.id && ta.selectionEnd > ta.selectionStart) { // format just the selected words
      const a = ta.selectionStart, z = ta.selectionEnd, m = MARK[t], v = ta.value;
      ta.value = v.slice(0, a) + m + v.slice(a, z) + m + v.slice(z); n.text = ta.value; ta.setSelectionRange(a, z + m.length * 2); renderAll(); ta.focus(); return;
    }
    n[t] = !n[t]; if (editing) { n.text = ta.value; } commit(); renderAll();
  };

  // ---------- top bar, zoom, find, menu ----------
  const title = $('#mm-title'); title.textContent = map.title;
  title.onclick = async () => { const t = await promptDialog('Rename map', map.title, 'Save', 'Map title'); if (t) { map.title = t; title.textContent = t; schedule(); } };
  $('#mm-back').onclick = () => { location.hash = '#/maps'; };
  $('#mm-undo').onclick = undo; $('#mm-redo').onclick = redo;
  $('#mm-zin').onclick = () => { const [cx, cy] = center(); zoomAt(k * 1.25, cx, cy); };
  $('#mm-zout').onclick = () => { const [cx, cy] = center(); zoomAt(k / 1.25, cx, cy); };
  $('#mm-fit').onclick = fit;
  $('#mm-linkcancel').onclick = () => { linkFrom = null; renderAll(); };
  let findQ = '', findCur = null, findList = [];
  const runFind = (step = 0) => {
    findQ = $('#mm-findq').value.trim();
    const q = findQ.toLowerCase();
    findList = q ? map.nodes.filter(n => plain(n.text).toLowerCase().includes(q)) : [];
    if (!findList.length) { findCur = null; $('#mm-findn').textContent = q ? 'No match' : ''; renderAll(); return; }
    let i = findList.findIndex(n => n.id === findCur); i = i < 0 ? 0 : (i + step) % findList.length;
    const n = findList[i]; findCur = n.id;
    let p = byId(n.parent), opened = false; while (p) { if (p.collapsed) { p.collapsed = false; opened = true; } p = byId(p.parent); }
    if (opened) commit();
    $('#mm-findn').textContent = `${i + 1}/${findList.length}`;
    renderAll(); centerOn(n, Math.max(k, 0.8));
  };
  $('#mm-find').onclick = () => { const fb = $('#mm-findbar'); fb.hidden = !fb.hidden; if (!fb.hidden) $('#mm-findq').focus(); else { $('#mm-findq').value = ''; findCur = null; runFind(); } };
  $('#mm-findq').oninput = () => { findCur = null; runFind(); };
  $('#mm-findq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); runFind(1); } };
  $('#mm-findnext').onclick = () => runFind(1);
  $('#mm-findx').onclick = () => $('#mm-find').click();
  const menu = $('#mm-menu');
  function closeMenu() { menu.hidden = true; }
  const canShare = !!(navigator.canShare && window.File);
  $('#mm-share').hidden = !canShare;
  $('#mm-more').onclick = () => { $('#mm-kids').textContent = 'Move children with bubble: ' + (map.moveKids ? 'On' : 'Off'); menu.hidden = !menu.hidden; closePop(); };
  menu.onclick = async e => {
    const b = e.target.closest('[data-menu]'); if (!b) return; closeMenu(); const m = b.dataset.menu;
    if (m === 'png') { const blob = await renderPNG(); download(blob, slug(map.title) + '.png'); toast('Image saved to Downloads'); }
    if (m === 'share') {
      const blob = await renderPNG(); const file = new File([blob], slug(map.title) + '.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: map.title }); } catch { } } else download(blob, file.name);
    }
    if (m === 'json') { await doSave(); exportJSON(map); toast('Map file saved to Downloads'); }
    if (m === 'kids') { map.moveKids = !map.moveKids; schedule(); toast('Move children with bubble: ' + (map.moveKids ? 'On' : 'Off')); }
    if (m === 'rename') title.click();
    if (m === 'tips') showHint(true);
  };

  // ---------- PNG export (drawn on a canvas, no DOM screenshot needed) ----------
  async function renderPNG() {
    const h = hiddenSet(); const vis = map.nodes.filter(n => !h.has(n.id));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of vis) { const s = sz(n); x0 = Math.min(x0, n.x - s.w / 2); x1 = Math.max(x1, n.x + s.w / 2); y0 = Math.min(y0, n.y - s.h / 2); y1 = Math.max(y1, n.y + s.h / 2); }
    if (!vis.length) { x0 = y0 = 0; x1 = y1 = 200; }
    const pad = 60; x0 -= pad; y0 -= pad + 30; x1 += pad; y1 += pad;
    const W = x1 - x0, H = y1 - y0, scale = Math.max(0.5, Math.min(2, 6000 / Math.max(W, H)));
    const c = document.createElement('canvas'); c.width = Math.ceil(W * scale); c.height = Math.ceil(H * scale);
    const x = c.getContext('2d'); x.scale(scale, scale); x.translate(-x0, -y0);
    const grd = x.createLinearGradient(x0, y0, x1, y1); grd.addColorStop(0, '#0b3d91'); grd.addColorStop(1, '#1e4fa8'); x.fillStyle = grd; x.fillRect(x0, y0, W, H);
    for (const [step, a] of [[24, 0.07], [120, 0.16]]) {
      x.strokeStyle = `rgba(255,255,255,${a})`; x.lineWidth = 1; x.beginPath();
      for (let gx = Math.floor(x0 / step) * step; gx < x1; gx += step) { x.moveTo(gx, y0); x.lineTo(gx, y1); }
      for (let gy = Math.floor(y0 / step) * step; gy < y1; gy += step) { x.moveTo(x0, gy); x.lineTo(x1, gy); }
      x.stroke();
    }
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '600 18px system-ui, sans-serif'; x.fillText(map.title, x0 + 20, y0 + 32);
    const { edges, links } = geometry();
    x.lineCap = 'round';
    for (const e of edges) { const p = e.pts; x.strokeStyle = e.color; x.lineWidth = e.w; x.beginPath(); x.moveTo(p[0], p[1]); x.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); x.stroke(); }
    for (const l of links) {
      x.strokeStyle = l.color; x.fillStyle = l.color; x.lineWidth = 3; x.setLineDash([10, 8]); x.beginPath(); x.moveTo(l.x1, l.y1); x.quadraticCurveTo(l.cx, l.cy, l.x2, l.y2); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.moveTo(l.head[0], l.head[1]); x.lineTo(l.head[2], l.head[3]); x.lineTo(l.head[4], l.head[5]); x.closePath(); x.fill();
    }
    for (const n of vis) {
      const s = sz(n), d = nodesBox.querySelector(`[data-id="${CSS.escape(n.id)}"]`);
      const r = Math.min(22, s.h / 2), bx = n.x - s.w / 2, by = n.y - s.h / 2;
      x.save(); x.shadowColor = 'rgba(0,0,0,.28)'; x.shadowBlur = 12; x.shadowOffsetY = 4;
      x.fillStyle = n.bg || DEF_BG; x.beginPath(); x.roundRect(bx, by, s.w, s.h, r); x.fill(); x.restore();
      const fs = PX[n.size]; x.fillStyle = n.fg || DEF_FG; x.font = `${n.i ? 'italic ' : ''}${n.b ? 800 : 500} ${fs}px system-ui, sans-serif`; x.textBaseline = 'middle';
      // Use the laid-out DOM lines so wrapping matches the screen.
      const lines = d ? domLines(d) : [plain(n.text)];
      const lh = fs * 1.25, top = n.y - (lines.length * lh) / 2 + lh / 2;
      lines.forEach((ln, i) => {
        const w = x.measureText(ln).width, lx = n.x - w / 2, ly = top + i * lh; x.fillText(ln, lx, ly);
        if (n.u) { x.fillRect(lx, ly + fs * 0.55, w, Math.max(1, fs / 14)); }
      });
    }
    return new Promise(res => c.toBlob(res, 'image/png'));
  }
  function domLines(d) { // text of each rendered line box inside a bubble
    const out = []; const txt = d.querySelector('.mm-txt'); if (!txt) return out;
    const range = document.createRange(); let cur = null, curTop = null;
    const walk = (node, prefix) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          for (let i = 0; i < ch.length; i++) { range.setStart(ch, i); range.setEnd(ch, i + 1); const rr = range.getClientRects()[0]; const top = rr ? Math.round(rr.top) : curTop;
            if (cur === null || Math.abs(top - curTop) > 3) { if (cur !== null) out.push(cur.trimEnd()); cur = prefix.v; prefix.v = ''; curTop = top; } cur += ch.data[i]; }
        } else if (ch.nodeType === 1) { if (ch.tagName === 'LI') { if (cur !== null) out.push(cur.trimEnd()); cur = null; walk(ch, { v: '• ' }); } else if (ch.tagName === 'DIV' || ch.tagName === 'UL') { if (cur !== null) out.push(cur.trimEnd()); cur = null; walk(ch, { v: '' }); } else walk(ch, prefix); }
      }
    };
    walk(txt, { v: '' }); if (cur !== null) out.push(cur.trimEnd());
    return out.length ? out : [''];
  }

  // ---------- first-run hint ----------
  async function showHint(force) {
    const s = await store.getSettings(); if (s.mmHintSeen && !force) return;
    const o = ctx.modal(`<div class="dialog mm-hint" role="dialog" aria-modal="true" aria-labelledby="mm-hint-h"><h3 id="mm-hint-h">Mind map basics</h3>
      <ul><li><b>Tap</b> the blue canvas to add your central subject.</li><li><b>Tap a bubble</b> to select it, then the round <b>+</b> adds a connected idea.</li>
      <li><b>Drag</b> a bubble to move it (its branch comes along). Drag the background to pan, pinch to zoom.</li>
      <li><b>Link</b> joins any two bubbles with a dashed arrow. <b>Double-tap</b> to edit text.</li><li>Everything saves automatically on this phone.</li></ul>
      <div class="row"><button class="btn primary" id="mm-hint-ok" type="button">Got it</button></div></div>`);
    o.querySelector('#mm-hint-ok').onclick = () => { o.remove(); store.saveSettings({ mmHintSeen: true }); };
  }

  // ---------- go ----------
  const onHide = () => { if (document.visibilityState === 'hidden') doSave(); };
  document.addEventListener('visibilitychange', onHide); addEventListener('pagehide', doSave);
  hist = [snap()]; hi = 0; updUndo();
  applyView(); renderAll();
  if (!map.view.x && !map.view.y) fit(); else applyView();
  showHint(false);
  // test/debug hook (read-only snapshot)
  root.mmDebug = { get map() { return JSON.parse(JSON.stringify(map)); }, get view() { return { tx, ty, k }; }, hist: () => hist.length };
  return async function cleanup() {
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', doSave);
    if (editing) finishEdit();
    document.body.classList.remove('mm-open');
    await doSave();
  };
}
