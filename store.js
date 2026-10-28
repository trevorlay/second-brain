// store.js: the ONLY module that touches storage. Everything is on-device (IndexedDB).
// Async API: init, listEntries, getEntry, saveEntry, deleteEntry, listProjects, getProject,
// saveProject, getSettings, saveSettings, exportAll, importAll.
// A future Google Drive sync can wrap/replace this module without touching the UI.
const DB_NAME = 'second-brain';
const DB_VERSION = 2; // v2 (app 1.1.0): adds the 'maps' store; existing stores are left untouched
const SCHEMA = 2;

export const DEFAULT_APPS = ['Grok Bot', 'Gemini', 'Muse', 'ChatGPT', 'Other'];
export const STATUSES = ['idea', 'in progress', 'done'];
export const FILE_TYPES = {
  drive: 'Google Drive link',
  phone: 'Phone path',
  chat: 'AI chat link',
  other: 'Other',
};
const SEED_PROJECTS = ['Contraption Lab', 'Cozy Craft Post site', 'Halloween match-3 game', 'Halloween tiles', 'Side-gig dashboard'];
const DEFAULT_SETTINGS = {
  theme: 'dark', apps: DEFAULT_APPS.slice(), lastProjectId: null, lastApp: 'Grok Bot',
  lastBotName: '', lastBackup: null, seeded: false,
};

let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
    };
    req.onblocked = () => console.warn('DB upgrade blocked by another open tab');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function done(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
async function all(store) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).getAll()); }
async function get(store, key) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).get(key)); }
async function put(store, val) { const db = await openDB(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val); await done(tx); return val; }

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
const now = () => new Date().toISOString();

function normEntry(e) {
  return {
    id: e.id || uid(),
    date: e.date || now().slice(0, 10),
    projectId: e.projectId || null,
    app: e.app || 'Other',
    botName: e.app === 'Grok Bot' ? (e.botName || '').trim() : '',
    what: (e.what || '').trim(),
    files: (e.files || []).map(f => ({ type: FILE_TYPES[f.type] ? f.type : 'other', value: (f.value || '').trim(), label: (f.label || '').trim() })).filter(f => f.value || f.label),
    status: STATUSES.includes(e.status) ? e.status : 'in progress',
    nextStep: (e.nextStep || '').trim(),
    tags: [...new Set((e.tags || []).map(t => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))],
    createdAt: e.createdAt || now(),
    updatedAt: e.updatedAt || now(),
  };
}

export async function init() {
  const s = await getSettings();
  if (!s.seeded) {
    const existing = await all('projects');
    if (!existing.length) {
      const t = Date.now();
      for (let i = 0; i < SEED_PROJECTS.length; i++) {
        await put('projects', { id: uid(), name: SEED_PROJECTS[i], archived: false, createdAt: new Date(t + i).toISOString(), updatedAt: now() });
      }
    }
    await saveSettings({ seeded: true });
  }
}

export async function listEntries() {
  const list = await all('entries');
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export const getEntry = id => get('entries', id);
export async function saveEntry(e) {
  const old = e.id ? await get('entries', e.id) : null;
  const rec = normEntry({ ...e, createdAt: old ? old.createdAt : e.createdAt, updatedAt: now() });
  return put('entries', rec);
}
export async function deleteEntry(id) {
  const db = await openDB(); const tx = db.transaction('entries', 'readwrite'); tx.objectStore('entries').delete(id); await done(tx);
}

export async function listProjects() {
  const list = await all('projects');
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}
export const getProject = id => get('projects', id);
export async function saveProject(p) {
  const old = p.id ? await get('projects', p.id) : null;
  return put('projects', { id: p.id || uid(), name: (p.name || 'Untitled').trim(), archived: !!p.archived, createdAt: old ? old.createdAt : (p.createdAt || now()), updatedAt: now() });
}

export async function getSettings() {
  const rec = await get('settings', 'settings');
  const s = { ...DEFAULT_SETTINGS, ...(rec ? rec.value : {}) };
  if (!Array.isArray(s.apps) || !s.apps.length) s.apps = DEFAULT_APPS.slice();
  return s;
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const value = { ...cur, ...patch };
  await put('settings', { key: 'settings', value });
  return value;
}

// ---------- mind maps ----------
const HEX = /^#[0-9a-f]{6}$/i;
export const MAP_SIZES = ['s', 'm', 'l', 'xl'];
const col = c => (typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : null);
const num = (v, d = 0) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : d);
export function normMap(m) {
  m = m || {};
  const nodes = (Array.isArray(m.nodes) ? m.nodes : []).filter(n => n && n.id).slice(0, 2000).map(n => ({
    id: String(n.id).slice(0, 64), parent: n.parent ? String(n.parent).slice(0, 64) : null,
    x: num(n.x), y: num(n.y), text: String(n.text ?? '').slice(0, 2000),
    size: MAP_SIZES.includes(n.size) ? n.size : 'm', bg: col(n.bg), fg: col(n.fg), line: col(n.line),
    b: !!n.b, i: !!n.i, u: !!n.u, list: !!n.list, collapsed: !!n.collapsed,
  }));
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) if (n.parent && (!ids.has(n.parent) || n.parent === n.id)) n.parent = null;
  const links = (Array.isArray(m.links) ? m.links : []).filter(l => l && ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
    .map(l => ({ id: String(l.id || uid()).slice(0, 64), from: l.from, to: l.to, color: col(l.color) }));
  const v = m.view || {};
  return {
    id: m.id || uid(), title: String(m.title || 'Untitled map').trim().slice(0, 120) || 'Untitled map', nodes, links,
    view: { x: num(v.x), y: num(v.y), k: Math.min(3, Math.max(0.15, num(v.k, 1) || 1)) },
    moveKids: m.moveKids !== false, createdAt: m.createdAt || now(), updatedAt: m.updatedAt || now(),
  };
}
export async function listMaps() {
  return (await all('maps')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
export const getMap = id => get('maps', id);
export async function saveMap(m) {
  return put('maps', normMap({ ...m, updatedAt: now() }));
}
export async function deleteMap(id) {
  const db = await openDB(); const tx = db.transaction('maps', 'readwrite'); tx.objectStore('maps').delete(id); await done(tx);
}
// ---------- prompt history (v1.2.0) ----------
// Kept as one record {key:'prompts', value:[...]} in the existing 'settings' store, so no DB version bump
// or migration is needed and 1.1.x data is untouched.
const MAX_PROMPTS = 300;
function normPrompt(p) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  return { id: s(p.id || uid(), 64), mapId: p.mapId ? s(p.mapId, 64) : null, mapTitle: s(p.mapTitle, 120), parentId: p.parentId ? s(p.parentId, 64) : null, childId: p.childId ? s(p.childId, 64) : null,
    parentText: s(p.parentText, 500), childText: s(p.childText, 500), path: (Array.isArray(p.path) ? p.path : []).slice(0, 60).map(x => s(x, 500)),
    related: (Array.isArray(p.related) ? p.related : []).slice(0, 40).map(x => s(x, 600)), type: ['image', 'code', 'text', 'music', 'plan', 'research'].includes(p.type) ? p.type : 'text',
    prompt: s(p.prompt, 20000), ...(p.fav ? { fav: true } : {}), ...(p.source === 'builder' ? { source: 'builder', ai: s(p.ai, 20), aiOther: s(p.aiOther, 60), form: normForm(p.form || {}) } : {}), date: p.date || now(), updatedAt: p.updatedAt || p.date || now() };
}
// v1.3.0 builder form + templates (settings record 'pbTemplates').
export function normForm(f) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  return { ai: s(f.ai, 20), aiOther: s(f.aiOther, 60), type: s(f.type, 20), want: s(f.want, 4000), context: s(f.context, 8000), length: s(f.length, 20), tone: s(f.tone, 20), avoid: s(f.avoid, 2000) };
}
export async function listTemplates() { const r = await get('settings', 'pbTemplates'); return r && Array.isArray(r.value) ? r.value : []; }
async function putTemplates(list) { await put('settings', { key: 'pbTemplates', value: list.slice(0, 200) }); }
export async function saveTemplate(t) {
  const rec = { ...normForm(t), id: String(t.id || uid()).slice(0, 64), name: String(t.name || 'Template').slice(0, 80), updatedAt: now() };
  await putTemplates([rec, ...(await listTemplates()).filter(x => x.id !== rec.id)]); return rec;
}
export async function deleteTemplate(id) { await putTemplates((await listTemplates()).filter(x => x.id !== id)); }
export async function listPrompts() {
  const rec = await get('settings', 'prompts'); const v = rec && Array.isArray(rec.value) ? rec.value : [];
  return v.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
async function putPrompts(list) { await put('settings', { key: 'prompts', value: list.slice(0, MAX_PROMPTS) }); }
export async function savePrompt(p) {
  const rec = normPrompt({ ...p, updatedAt: now() }); const list = (await listPrompts()).filter(x => x.id !== rec.id);
  list.unshift(rec); list.sort((a, b) => (b.date || '').localeCompare(a.date || '')); await putPrompts(list); return rec;
}
export async function deletePrompt(id) { await putPrompts((await listPrompts()).filter(x => x.id !== id)); }

export async function dbInfo() {
  const db = await openDB(); return { version: db.version, stores: [...db.objectStoreNames] };
}

export async function exportAll() {
  const [entries, projects, settings, maps, prompts, promptTemplates] = await Promise.all([listEntries(), listProjects(), getSettings(), listMaps(), listPrompts(), listTemplates()]);
  const { lastProjectId, lastApp, lastBotName, seeded, mmHintSeen, ...portable } = settings;
  return { app: 'second-brain', schema: SCHEMA, exportedAt: now(), entries, projects, maps, prompts, promptTemplates, settings: portable };
}

// mode: 'merge' (keep the newer copy of each item by updatedAt) or 'replace' (wipe, then load).
const newerOf = (a, b) => !b || (a.updatedAt || '') > (b.updatedAt || '');
export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'second-brain' || !Array.isArray(data.entries) || !Array.isArray(data.projects)) {
    throw new Error('This file is not a Second Brain backup.');
  }
  // Read current data BEFORE opening the write transaction (awaiting inside it would auto-commit it).
  const curE = mode === 'replace' ? new Map() : new Map((await all('entries')).map(x => [x.id, x]));
  const curP = mode === 'replace' ? new Map() : new Map((await all('projects')).map(x => [x.id, x]));
  const curM = mode === 'replace' ? new Map() : new Map((await all('maps')).map(x => [x.id, x]));
  const maps = Array.isArray(data.maps) ? data.maps : []; // v1.0 backups have no maps
  const db = await openDB();
  const tx = db.transaction(['entries', 'projects', 'maps'], 'readwrite');
  const es = tx.objectStore('entries'), ps = tx.objectStore('projects'), ms = tx.objectStore('maps');
  if (mode === 'replace') { es.clear(); ps.clear(); if (maps.length || data.schema >= 2) ms.clear(); }
  for (const m of maps) { if (m && m.id && newerOf(m, curM.get(m.id))) ms.put(normMap(m)); }
  let added = 0, updated = 0;
  const newer = newerOf; // !b || (a.updatedAt || '') > (b.updatedAt || '');
  for (const p of data.projects) {
    if (!p || !p.id) continue;
    const old = curP.get(p.id);
    if (newer(p, old)) { ps.put({ id: p.id, name: String(p.name || 'Untitled'), archived: !!p.archived, createdAt: p.createdAt || now(), updatedAt: p.updatedAt || now() }); }
  }
  for (const e of data.entries) {
    if (!e || !e.id) continue;
    const old = curE.get(e.id);
    if (newer(e, old)) { es.put(normEntry(e)); old ? updated++ : added++; }
  }
  await done(tx);
  const s = data.settings || {};
  const cur = await getSettings();
  const patch = { seeded: true };
  if (Array.isArray(s.apps) && s.apps.length) patch.apps = mode === 'replace' ? s.apps : [...new Set([...cur.apps, ...s.apps])];
  if (mode === 'replace' && s.theme) patch.theme = s.theme;
  if (s.lastBackup && (!cur.lastBackup || s.lastBackup > cur.lastBackup)) patch.lastBackup = s.lastBackup;
  await saveSettings(patch);
  // Prompt history (v1.2.0+ backups). Older backups have none: keep what is on the phone.
  const prompts = Array.isArray(data.prompts) ? data.prompts.filter(x => x && x.id && typeof x.prompt === 'string') : null;
  if (prompts) {
    const cur = mode === 'replace' ? new Map() : new Map((await listPrompts()).map(x => [x.id, x]));
    for (const x of prompts) if (newerOf(x, cur.get(x.id))) cur.set(x.id, normPrompt(x));
    await putPrompts([...cur.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  }
  const tpls = Array.isArray(data.promptTemplates) ? data.promptTemplates.filter(x => x && x.id) : null;
  if (tpls) {
    const cur = mode === 'replace' ? new Map() : new Map((await listTemplates()).map(x => [x.id, x]));
    for (const x of tpls) if (newerOf(x, cur.get(x.id))) cur.set(x.id, { ...normForm(x), id: String(x.id).slice(0, 64), name: String(x.name || 'Template').slice(0, 80), updatedAt: x.updatedAt || now() });
    await putTemplates([...cur.values()]);
  }
  return { added, updated, total: data.entries.length, maps: maps.length, prompts: prompts ? prompts.length : 0, templates: tpls ? tpls.length : 0 };
}
