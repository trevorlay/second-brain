// store.js: the ONLY module that touches storage. Everything is on-device (IndexedDB).
// Async API: init, listEntries, getEntry, saveEntry, deleteEntry, listProjects, getProject,
// saveProject, getSettings, saveSettings, exportAll, importAll.
// A future Google Drive sync can wrap/replace this module without touching the UI.
const DB_NAME = 'second-brain';
const DB_VERSION = 1;
const SCHEMA = 1;

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
    };
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

export async function exportAll() {
  const [entries, projects, settings] = await Promise.all([listEntries(), listProjects(), getSettings()]);
  const { lastProjectId, lastApp, lastBotName, seeded, ...portable } = settings;
  return { app: 'second-brain', schema: SCHEMA, exportedAt: now(), entries, projects, settings: portable };
}

// mode: 'merge' (keep the newer copy of each item by updatedAt) or 'replace' (wipe, then load).
export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'second-brain' || !Array.isArray(data.entries) || !Array.isArray(data.projects)) {
    throw new Error('This file is not a Second Brain backup.');
  }
  // Read current data BEFORE opening the write transaction (awaiting inside it would auto-commit it).
  const curE = mode === 'replace' ? new Map() : new Map((await all('entries')).map(x => [x.id, x]));
  const curP = mode === 'replace' ? new Map() : new Map((await all('projects')).map(x => [x.id, x]));
  const db = await openDB();
  const tx = db.transaction(['entries', 'projects'], 'readwrite');
  const es = tx.objectStore('entries'), ps = tx.objectStore('projects');
  if (mode === 'replace') { es.clear(); ps.clear(); }
  let added = 0, updated = 0;
  const newer = (a, b) => !b || (a.updatedAt || '') > (b.updatedAt || '');
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
  return { added, updated, total: data.entries.length };
}
