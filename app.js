import * as store from './store.js';
import { STATUSES, FILE_TYPES } from './store.js';

const VERSION = '1.0.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const state = { entries: [], projects: [], settings: {}, f: { q: '', app: '', project: '', status: '', tag: '' }, showArchived: false };

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sclass = s => 's-' + String(s).replace(/\s+/g, '-');
const isHttp = v => /^https?:\/\//i.test(String(v || '').trim());
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDate = d => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: x.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
const projName = id => (state.projects.find(p => p.id === id) || {}).name || 'No project';
const terms = () => state.f.q.toLowerCase().split(/\s+/).filter(Boolean);

// Escape text and wrap every occurrence of the search terms in <mark>.
function hl(text, ts = terms()) {
  text = String(text ?? '');
  if (!ts.length || !text) return esc(text);
  const low = text.toLowerCase(), on = new Uint8Array(text.length);
  for (const t of ts) { let i = low.indexOf(t); while (i !== -1) { on.fill(1, i, i + t.length); i = low.indexOf(t, i + 1); } }
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    if (on[i] && !open) { out += '<mark>'; open = true; } else if (!on[i] && open) { out += '</mark>'; open = false; }
    out += esc(text[i]);
  }
  return out + (open ? '</mark>' : '');
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); }
  catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied: ' + (txt.length > 40 ? txt.slice(0, 40) + '…' : txt));
}

const ICONS = {
  drive: '<svg viewBox="0 0 24 24"><path d="M8.5 3.5h7l5.5 9.5-3.5 6h-11L3 13z"/><path d="M8.5 3.5 14 13H3M15.5 3.5 10 13M21 13H10l-3.5 6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
};

// ---------- data ----------
async function load() {
  [state.entries, state.projects, state.settings] = await Promise.all([store.listEntries(), store.listProjects(), store.getSettings()]);
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t || 'dark';
  const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  $('meta[name=theme-color]').content = light ? '#f4f5fa' : '#101218';
}
function backupDue() {
  if (!state.entries.length) return false;
  const lb = state.settings.lastBackup;
  return !lb || (Date.now() - new Date(lb).getTime()) > 7 * 864e5;
}
function lastBackupText() {
  const lb = state.settings.lastBackup;
  if (!lb) return 'Never';
  const days = Math.floor((Date.now() - new Date(lb).getTime()) / 864e5);
  return new Date(lb).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + (days >= 1 ? ` (${days} day${days > 1 ? 's' : ''} ago)` : ' (today)');
}

// ---------- entry card ----------
function fileHTML(f, ts) {
  const val = f.value || '';
  const label = f.label || FILE_TYPES[f.type];
  const action = isHttp(val)
    ? `<a class="btn" href="${esc(val.trim())}" target="_blank" rel="noopener noreferrer">${ICONS.open}Open</a>`
    : `<button class="btn" type="button" data-copy="${esc(val)}">${ICONS.copy}Copy</button>`;
  return `<li class="file f-${f.type}"><span class="ficon" title="${esc(FILE_TYPES[f.type])}">${ICONS[f.type] || ICONS.other}</span>
    <div class="ftext"><div class="flabel">${hl(label, ts)}</div><div class="fval">${hl(val, ts)}</div></div>${val ? action : ''}</li>`;
}
function entryHTML(e, { showProject = true, ts = terms() } = {}) {
  const app = e.app + (e.app === 'Grok Bot' && e.botName ? ' · ' + e.botName : '');
  return `<article class="card entry" data-id="${esc(e.id)}">
    <div class="meta"><span class="badge ${sclass(e.status)}">${hl(e.status, ts)}</span><span class="apppill">${hl(app, ts)}</span><span class="date">${esc(fmtDate(e.date))}</span></div>
    ${showProject ? `<a class="proj" href="#/project/${encodeURIComponent(e.projectId || '')}">${hl(projName(e.projectId), ts)}</a>` : ''}
    <p class="what">${hl(e.what, ts)}</p>
    ${e.files.length ? `<ul class="files">${e.files.map(f => fileHTML(f, ts)).join('')}</ul>` : ''}
    ${e.nextStep ? `<div class="next"><b>Next:</b> ${hl(e.nextStep, ts)}</div>` : ''}
    ${e.tags.length ? `<div class="tags">${e.tags.map(t => `<button class="tag" type="button" data-tag="${esc(t)}">#${hl(t, ts)}</button>`).join('')}</div>` : ''}
    <div class="acts"><button class="btn" type="button" data-edit="${esc(e.id)}">Edit</button><button class="btn danger" type="button" data-del="${esc(e.id)}">Delete</button></div>
  </article>`;
}
// One delegated click handler for all entry cards
view.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-copy],[data-edit],[data-del],[data-tag]');
  if (!b) return;
  if (b.dataset.copy !== undefined) return copyText(b.dataset.copy);
  if (b.dataset.edit) return openForm(state.entries.find(e => e.id === b.dataset.edit));
  if (b.dataset.del) {
    const e = state.entries.find(x => x.id === b.dataset.del);
    if (await confirmDialog('Delete this entry?', `“${(e.what || '').slice(0, 80)}” will be removed from this phone.`, 'Delete', true)) {
      await store.deleteEntry(e.id); await load(); render(); toast('Entry deleted');
    }
    return;
  }
  if (b.dataset.tag) { state.f.tag = b.dataset.tag; if (!location.hash.startsWith('#/search')) location.hash = '#/search'; else render(); }
});

// ---------- search ----------
function matches(e, ts) {
  const f = state.f;
  if (f.app && e.app !== f.app) return false;
  if (f.project && e.projectId !== f.project) return false;
  if (f.status && e.status !== f.status) return false;
  if (f.tag && !e.tags.includes(f.tag)) return false;
  if (!ts.length) return true;
  const hay = [e.what, e.nextStep, e.app, e.botName, e.status, e.date, fmtDate(e.date), projName(e.projectId), ...e.tags, ...e.tags.map(t => '#' + t),
    ...e.files.flatMap(x => [x.label, x.value, FILE_TYPES[x.type]])].join('\n').toLowerCase();
  return ts.every(t => hay.includes(t));
}
function renderSearch() {
  const tags = [...new Set(state.entries.flatMap(e => e.tags))].sort();
  const apps = [...new Set([...state.settings.apps, ...state.entries.map(e => e.app)])];
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const f = state.f;
  view.innerHTML = `
    ${backupDue() ? `<div class="banner"><span>🛟</span><div class="spacer">${state.settings.lastBackup ? 'It\u2019s been over a week since your last backup.' : 'You haven\u2019t backed up yet.'} Save a copy so nothing gets lost.</div><button class="btn" id="bk-now" type="button">Back up</button></div>` : ''}
    <div class="searchbox">${ICONS.search}<input id="q" type="search" placeholder="Where's my file?" autocomplete="off" enterkeyhint="search" value="${esc(f.q)}" aria-label="Search everything"><button class="clear" id="qclear" type="button" aria-label="Clear search"${f.q ? '' : ' hidden'}>×</button></div>
    <div class="filters">
      <select id="f-app" aria-label="Filter by app" class="${f.app ? 'on' : ''}">${opt('', 'All apps', f.app)}${apps.map(a => opt(a, a, f.app)).join('')}</select>
      <select id="f-project" aria-label="Filter by project" class="${f.project ? 'on' : ''}">${opt('', 'All projects', f.project)}${state.projects.map(p => opt(p.id, p.name + (p.archived ? ' (archived)' : ''), f.project)).join('')}</select>
      <select id="f-status" aria-label="Filter by status" class="${f.status ? 'on' : ''}">${opt('', 'Any status', f.status)}${STATUSES.map(s => opt(s, s[0].toUpperCase() + s.slice(1), f.status)).join('')}</select>
      <select id="f-tag" aria-label="Filter by tag" class="${f.tag ? 'on' : ''}">${opt('', 'Any tag', f.tag)}${tags.map(t => opt(t, '#' + t, f.tag)).join('')}</select>
      ${f.app || f.project || f.status || f.tag ? '<button class="btn ghost" id="f-clear" type="button">Clear filters</button>' : ''}
    </div>
    <div id="results"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => { state.f.q = q.value; $('#qclear').hidden = !q.value; renderResults(); });
  $('#qclear').onclick = () => { q.value = ''; state.f.q = ''; $('#qclear').hidden = true; renderResults(); q.focus(); };
  for (const k of ['app', 'project', 'status', 'tag']) $('#f-' + k).onchange = ev => { state.f[k] = ev.target.value; renderSearch(); };
  if ($('#f-clear')) $('#f-clear').onclick = () => { Object.assign(state.f, { app: '', project: '', status: '', tag: '' }); renderSearch(); };
  if ($('#bk-now')) $('#bk-now').onclick = doExport;
  renderResults();
}
function renderResults() {
  const ts = terms();
  const list = state.entries.filter(e => matches(e, ts));
  const filtered = ts.length || state.f.app || state.f.project || state.f.status || state.f.tag;
  const box = $('#results');
  if (!state.entries.length) {
    box.innerHTML = `<div class="empty"><span class="big">🧠</span><b>Nothing here yet.</b><br>Tap the <b>+</b> button to log what you did and where the file ended up.</div>`;
    return;
  }
  box.innerHTML = `<div class="resultcount">${filtered ? `${list.length} match${list.length === 1 ? '' : 'es'}` : `Recent entries (${list.length})`}</div>` +
    (list.length ? list.map(e => entryHTML(e, { ts })).join('') : `<div class="empty"><span class="big">🔎</span>No matches. Try fewer words or clear the filters.</div>`);
}

// ---------- projects ----------
function projStats(p) {
  const es = state.entries.filter(e => e.projectId === p.id);
  const steps = es.filter(e => e.nextStep && e.status !== 'done').map(e => e.nextStep);
  return { es, latest: es[0], steps };
}
function renderProjects() {
  const active = state.projects.filter(p => !p.archived), archived = state.projects.filter(p => p.archived);
  const card = p => {
    const { es, latest, steps } = projStats(p);
    return `<a class="card projcard${p.archived ? ' archived' : ''}" href="#/project/${encodeURIComponent(p.id)}">
      <div class="top"><div class="name">${esc(p.name)}</div>${latest ? `<span class="badge ${sclass(latest.status)}">${esc(latest.status)}</span>` : ''}<span class="chev">${ICONS.chev}</span></div>
      <div class="sub">${es.length ? `${es.length} entr${es.length === 1 ? 'y' : 'ies'} · last ${esc(fmtDate(latest.date))}` : 'No entries yet'}</div>
      ${steps.length ? `<ul class="steps">${steps.slice(0, 3).map(s => `<li>${esc(s)}</li>`).join('')}${steps.length > 3 ? `<li class="muted">+${steps.length - 3} more</li>` : ''}</ul>` : ''}
    </a>`;
  };
  view.innerHTML = `<div class="row"><h1 class="spacer">Projects</h1><button class="btn" id="newproj" type="button">+ New project</button></div>
    ${active.map(card).join('') || '<div class="empty">No active projects.</div>'}
    ${archived.length ? `<button class="btn ghost block" id="toggle-arch" type="button">${state.showArchived ? 'Hide' : 'Show'} archived (${archived.length})</button>
      ${state.showArchived ? `<h2>Archived</h2>${archived.map(card).join('')}` : ''}` : ''}`;
  $('#newproj').onclick = async () => {
    const name = await promptDialog('New project', '', 'Create');
    if (name) { const p = await store.saveProject({ name }); await load(); render(); toast('Project “' + p.name + '” added'); }
  };
  if ($('#toggle-arch')) $('#toggle-arch').onclick = () => { state.showArchived = !state.showArchived; render(); };
}
function renderProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) { view.innerHTML = `<div class="empty">Project not found. <a href="#/projects">Back to projects</a></div>`; return; }
  const { es, latest, steps } = projStats(p);
  view.innerHTML = `<div class="detailhead"><a class="iconbtn" href="#/projects" aria-label="Back to projects">${ICONS.back}</a><h1>${esc(p.name)}</h1></div>
    <div class="row small muted">${latest ? `<span class="badge ${sclass(latest.status)}">${esc(latest.status)}</span>` : ''}<span>${es.length} entr${es.length === 1 ? 'y' : 'ies'}</span>${p.archived ? '<span>· Archived</span>' : ''}</div>
    <div class="row projactions">
      <button class="btn primary" id="p-add" type="button">+ Add entry</button>
      <button class="btn" id="p-rename" type="button">Rename</button>
      <button class="btn" id="p-arch" type="button">${p.archived ? 'Unarchive' : 'Archive'}</button>
    </div>
    ${steps.length ? `<h2>Open next steps</h2><div class="card"><ul class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    <h2>Entries · newest first</h2>
    ${es.map(e => entryHTML(e, { showProject: false, ts: [] })).join('') || '<div class="empty"><span class="big">📝</span>No entries yet. Add the first one.</div>'}`;
  $('#p-add').onclick = () => openForm(null, { projectId: p.id });
  $('#p-rename').onclick = async () => {
    const name = await promptDialog('Rename project', p.name, 'Save');
    if (name && name !== p.name) { await store.saveProject({ ...p, name }); await load(); render(); toast('Renamed'); }
  };
  $('#p-arch').onclick = async () => {
    if (!p.archived && !await confirmDialog('Archive this project?', 'It moves to the bottom of the Projects list. Its entries stay searchable.', 'Archive')) return;
    await store.saveProject({ ...p, archived: !p.archived }); await load(); render(); toast(p.archived ? 'Unarchived' : 'Archived');
  };
}

// ---------- settings ----------
function renderSettings() {
  const s = state.settings;
  view.innerHTML = `<h1>Settings</h1>
    <h2>Theme</h2>
    <div class="seg" role="radiogroup" aria-label="Theme">${['dark', 'light', 'system'].map(t => `<button type="button" role="radio" aria-checked="${s.theme === t}" class="${s.theme === t ? 'on' : ''}" data-theme-set="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <h2>Apps you use</h2>
    <div class="card"><div class="applist" id="applist">${s.apps.map((a, i) => `<div class="row"><input type="text" value="${esc(a)}" data-app-i="${i}" aria-label="App name"><button class="iconbtn" type="button" data-app-del="${i}" aria-label="Remove ${esc(a)}">${ICONS.x}</button></div>`).join('')}</div>
      <div class="row" id="addapp-row"><input class="input spacer" id="newapp" type="text" placeholder="Add an app (e.g. Claude)"><button class="btn" id="addapp" type="button">Add</button></div>
      <p class="small muted">Renaming an app also updates your existing entries.</p></div>
    <h2>Backup</h2>
    <div class="card">
      <div class="kv"><span class="muted">Last backup</span><b id="lastbk">${esc(lastBackupText())}</b></div>
      ${backupDue() ? '<p class="small">🛟 Time for a backup. Save the file to Google Drive or keep it on your phone.</p>' : ''}
      <div class="row"><button class="btn primary spacer" id="export" type="button">Export backup</button><button class="btn spacer" id="import" type="button">Import backup</button></div>
      <input type="file" id="importfile" accept="application/json,.json" hidden>
      <p class="small muted">Export downloads one .json file with everything. Import lets you merge it with what's here or replace it.</p>
    </div>
    <h2>About</h2>
    <div class="card small"><div class="kv"><span class="muted">Version</span><span>${VERSION}</span></div>
      <div class="kv"><span class="muted">Entries</span><span>${state.entries.length}</span></div>
      <div class="kv"><span class="muted">Projects</span><span>${state.projects.length}</span></div>
      <p class="muted">Everything is stored only on this phone. Nothing is sent anywhere: no accounts, no tracking. Works offline.</p></div>`;
  $$('[data-theme-set]').forEach(b => b.onclick = async () => { state.settings = await store.saveSettings({ theme: b.dataset.themeSet }); applyTheme(state.settings.theme); render(); });
  $$('[data-app-i]').forEach(inp => inp.onchange = async () => {
    const i = +inp.dataset.appI, old = s.apps[i], name = inp.value.trim();
    if (!name) { inp.value = old; return; }
    if (name === old) return;
    if (s.apps.includes(name)) { toast('That app is already in the list'); inp.value = old; return; }
    const apps = s.apps.slice(); apps[i] = name;
    for (const e of state.entries.filter(e => e.app === old)) await store.saveEntry({ ...e, app: name });
    const patch = { apps }; if (s.lastApp === old) patch.lastApp = name;
    await store.saveSettings(patch); if (state.f.app === old) state.f.app = name;
    await load(); render(); toast('Renamed to ' + name);
  });
  $$('[data-app-del]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.appDel, name = s.apps[i];
    if (s.apps.length <= 1) return toast('Keep at least one app');
    if (!await confirmDialog(`Remove “${name}”?`, 'Existing entries keep their app name; it just won\u2019t be offered for new entries.', 'Remove', true)) return;
    await store.saveSettings({ apps: s.apps.filter((_, j) => j !== i) }); await load(); render();
  });
  const addApp = async () => {
    const name = $('#newapp').value.trim(); if (!name) return;
    if (s.apps.includes(name)) return toast('Already in the list');
    await store.saveSettings({ apps: [...s.apps, name] }); await load(); render(); toast('Added ' + name);
  };
  $('#addapp').onclick = addApp; $('#newapp').onkeydown = e => { if (e.key === 'Enter') addApp(); };
  $('#export').onclick = doExport;
  $('#import').onclick = () => $('#importfile').click();
  $('#importfile').onchange = doImport;
}
async function doExport() {
  const data = await store.exportAll();
  const stamp = new Date();
  data.settings.lastBackup = stamp.toISOString();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `second-brain-backup-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  await store.saveSettings({ lastBackup: stamp.toISOString() }); await load(); render();
  toast('Backup saved to Downloads');
}
async function doImport(ev) {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); if (data.app !== 'second-brain') throw 0; }
  catch { return alertDialog('Can\u2019t import', 'That file isn\u2019t a Second Brain backup.'); }
  const mode = await choiceDialog('Import backup', `${data.entries.length} entries and ${data.projects.length} projects from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'a backup'}.`,
    [{ v: 'merge', label: 'Merge with what\u2019s here', primary: true }, { v: 'replace', label: 'Replace everything', danger: true }]);
  if (!mode) return;
  const ok = mode === 'merge'
    ? await confirmDialog('Merge backup?', 'New entries are added. Where the same entry exists in both, the newer copy wins.', 'Merge')
    : await confirmDialog('Replace everything?', 'All entries and projects on this phone will be erased and replaced by the backup. This can\u2019t be undone.', 'Replace', true);
  if (!ok) return;
  try {
    const r = await store.importAll(data, mode);
    await load(); applyTheme(state.settings.theme); render();
    toast(mode === 'replace' ? `Restored ${r.total} entries` : `Merged: ${r.added} added, ${r.updated} updated`);
  } catch (err) { alertDialog('Import failed', err.message || String(err)); }
}

// ---------- dialogs ----------
function modal(html, cls = 'center') {
  const o = document.createElement('div'); o.className = 'overlay ' + cls; o.innerHTML = html;
  $('#modal-root').appendChild(o); return o;
}
function choiceDialog(title, text, choices) {
  return new Promise(res => {
    const o = modal(`<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="stack">
      ${choices.map((c, i) => `<button class="btn ${c.primary ? 'primary' : ''} ${c.danger ? 'danger' : ''}" data-i="${i}" type="button">${esc(c.label)}</button>`).join('')}
      <button class="btn ghost" data-i="-1" type="button">Cancel</button></div></div>`);
    o.onclick = e => { const b = e.target.closest('[data-i]'); if (!b && e.target !== o) return; const i = b ? +b.dataset.i : -1; o.remove(); res(i >= 0 ? choices[i].v : null); };
  });
}
function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const o = modal(`<div class="dialog" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button class="btn ghost" data-r="0" type="button">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1" type="button" id="dlg-ok">${esc(okLabel)}</button></div></div>`);
    o.onclick = e => { const b = e.target.closest('[data-r]'); if (!b && e.target !== o) return; o.remove(); res(b ? b.dataset.r === '1' : false); };
  });
}
function alertDialog(title, text) {
  return new Promise(res => {
    const o = modal(`<div class="dialog" role="alertdialog"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn primary" type="button">OK</button></div></div>`);
    o.querySelector('button').onclick = () => { o.remove(); res(); };
  });
}
function promptDialog(title, value = '', okLabel = 'OK') {
  return new Promise(res => {
    const o = modal(`<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>
      <input class="input" id="dlg-in" type="text" value="${esc(value)}" placeholder="Project name" enterkeyhint="done">
      <div class="row dlgrow"><button class="btn ghost" data-r="0" type="button">Cancel</button><button class="btn primary" data-r="1" type="button" id="dlg-ok">${esc(okLabel)}</button></div></div>`);
    const inp = o.querySelector('input'); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const finish = ok => { const v = inp.value.trim(); o.remove(); res(ok && v ? v : null); };
    inp.onkeydown = e => { if (e.key === 'Enter') finish(true); };
    o.onclick = e => { const b = e.target.closest('[data-r]'); if (!b && e.target !== o) return; finish(b && b.dataset.r === '1'); };
  });
}

// ---------- quick add / edit form ----------
let sheet = null, sheetPushed = false;
function closeSheet() {
  if (!sheet) return;
  sheet.remove(); sheet = null;
  if (sheetPushed) { sheetPushed = false; history.back(); }
}
addEventListener('popstate', () => { if (sheet) { sheetPushed = false; closeSheet(); } });

function guessType(v) {
  v = v.trim().toLowerCase();
  if (/drive\.google\.com|docs\.google\.com|sheets\.google|slides\.google/.test(v)) return 'drive';
  if (/chatgpt\.com|chat\.openai|gemini\.google|grok\.com|x\.com\/i\/grok|meta\.ai|bard\.google|claude\.ai/.test(v)) return 'chat';
  if (/^(\/|~\/|sdcard|storage|internal|download|documents|dcim|pictures|content:\/\/|file:\/\/)/.test(v)) return 'phone';
  return null;
}
function fileRowHTML(f = { type: 'drive', value: '', label: '' }) {
  return `<div class="filerow"><div class="row"><select data-k="type" aria-label="Location type">${Object.entries(FILE_TYPES).map(([k, v]) => `<option value="${k}"${k === f.type ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <button class="iconbtn" type="button" data-rmfile aria-label="Remove file location">${ICONS.x}</button></div>
    <input type="text" data-k="value" value="${esc(f.value)}" placeholder="Paste link or phone path" autocomplete="off" inputmode="url" aria-label="Link or path">
    <input type="text" data-k="label" value="${esc(f.label)}" placeholder="Label (e.g. Final logo PNG)" aria-label="File label"></div>`;
}
function openForm(entry = null, preset = {}) {
  if (sheet) closeSheet();
  const s = state.settings;
  const usable = state.projects.filter(p => !p.archived || (entry && p.id === entry.projectId) || p.id === preset.projectId);
  const lastProj = usable.find(p => p.id === s.lastProjectId) ? s.lastProjectId : (usable[0] || {}).id;
  const e = entry || { date: today(), projectId: preset.projectId || lastProj, app: s.apps.includes(s.lastApp) ? s.lastApp : s.apps[0], botName: s.lastBotName || '', what: '', files: [], status: 'in progress', nextStep: '', tags: [] };
  const apps = [...new Set([...s.apps, ...(entry ? [entry.app] : [])])];
  const bots = [...new Set(state.entries.map(x => x.botName).filter(Boolean))];
  const moreOpen = entry && (entry.nextStep || entry.tags.length || entry.date !== today());
  sheet = modal(`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <header><h2 id="sheet-title">${entry ? 'Edit entry' : 'Quick add'}</h2><button class="iconbtn" type="button" id="sheet-x" aria-label="Close">${ICONS.x}</button></header>
    <form class="body form" id="entryform" novalidate>
      <label class="lbl" for="fm-project">Project</label>
      <select id="fm-project">${usable.map(p => `<option value="${esc(p.id)}"${p.id === e.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">+ New project…</option></select>
      <label class="lbl">App used</label>
      <div class="chips" id="fm-app" role="radiogroup">${apps.map(a => `<button type="button" class="chip${a === e.app ? ' on' : ''}" role="radio" aria-checked="${a === e.app}" data-app="${esc(a)}">${esc(a)}</button>`).join('')}</div>
      <div id="botwrap"${e.app === 'Grok Bot' ? '' : ' hidden'}><label class="lbl" for="fm-bot">Bot name <span class="opt">(optional)</span></label>
        <input type="text" id="fm-bot" list="botlist" value="${esc(e.botName)}" placeholder="Which Grok Bot?" autocomplete="off"><datalist id="botlist">${bots.map(b => `<option value="${esc(b)}">`).join('')}</datalist></div>
      <label class="lbl" for="fm-what">What I did</label>
      <textarea id="fm-what" placeholder="e.g. Made the Halloween tile set, exported PNGs" enterkeyhint="done">${esc(e.what)}</textarea>
      <label class="lbl">Where the files are <span class="opt">(optional)</span></label>
      <div id="fm-files">${e.files.map(fileRowHTML).join('')}</div>
      <button type="button" class="btn block" id="fm-addfile">+ Add file location</button>
      <label class="lbl">Status</label>
      <div class="chips" id="fm-status">${STATUSES.map(st => `<button type="button" class="chip st ${sclass(st)}${st === e.status ? ' on' : ''}" data-st="${st}">${st[0].toUpperCase() + st.slice(1)}</button>`).join('')}</div>
      <details${moreOpen ? ' open' : ''}><summary>More: date, next step, tags</summary>
        <label class="lbl" for="fm-date">Date</label><input type="date" id="fm-date" value="${esc(e.date)}">
        <label class="lbl" for="fm-next">Next step <span class="opt">(optional)</span></label><input type="text" id="fm-next" value="${esc(e.nextStep)}" placeholder="What to do next">
        <label class="lbl" for="fm-tags">Tags <span class="opt">(comma separated)</span></label><input type="text" id="fm-tags" value="${esc(e.tags.join(', '))}" placeholder="logo, final, etsy" autocomplete="off">
      </details>
      <div class="err" id="fm-err"></div>
    </form>
    <footer>${entry ? '<button class="btn danger" type="button" id="fm-del">Delete</button>' : ''}<button class="btn primary" type="submit" form="entryform" id="fm-save">Save</button></footer>
  </div>`, 'sheetwrap');
  history.pushState({ sheet: 1 }, '', location.href); sheetPushed = true;
  const root = sheet, S = sel => root.querySelector(sel);
  let app = e.app, status = e.status;
  root.addEventListener('click', ev => { if (ev.target === root) closeSheet(); });
  S('#sheet-x').onclick = closeSheet;
  S('#fm-app').onclick = ev => { const b = ev.target.closest('[data-app]'); if (!b) return; app = b.dataset.app; $$('[data-app]', root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); S('#botwrap').hidden = app !== 'Grok Bot'; };
  S('#fm-status').onclick = ev => { const b = ev.target.closest('[data-st]'); if (!b) return; status = b.dataset.st; $$('[data-st]', root).forEach(x => x.classList.toggle('on', x === b)); };
  S('#fm-project').onchange = async ev => {
    if (ev.target.value !== '__new') return;
    const name = await promptDialog('New project', '', 'Create');
    if (!name) { ev.target.value = e.projectId || (usable[0] || {}).id || ''; return; }
    const p = await store.saveProject({ name }); await load();
    const o = new Option(p.name, p.id, true, true); ev.target.add(o, ev.target.options.length - 1); ev.target.value = p.id; e.projectId = p.id;
  };
  const addFile = (f) => { S('#fm-files').insertAdjacentHTML('beforeend', fileRowHTML(f)); const rows = $$('.filerow', root); const r = rows[rows.length - 1]; r.querySelector('[data-k=value]').focus(); };
  S('#fm-addfile').onclick = () => addFile();
  S('#fm-files').addEventListener('click', ev => { if (ev.target.closest('[data-rmfile]')) ev.target.closest('.filerow').remove(); });
  S('#fm-files').addEventListener('change', ev => { if (ev.target.dataset.k === 'type') ev.target.dataset.touched = '1'; });
  S('#fm-files').addEventListener('input', ev => {
    if (ev.target.dataset.k !== 'value') return;
    const sel = ev.target.closest('.filerow').querySelector('[data-k=type]');
    const g = guessType(ev.target.value); if (g && !sel.dataset.touched) sel.value = g;
  });
  if (S('#fm-del')) S('#fm-del').onclick = async () => {
    if (!await confirmDialog('Delete this entry?', 'It will be removed from this phone.', 'Delete', true)) return;
    await store.deleteEntry(entry.id); closeSheet(); await load(); render(); toast('Entry deleted');
  };
  S('#entryform').onsubmit = async ev => {
    ev.preventDefault();
    const projectId = S('#fm-project').value, what = S('#fm-what').value.trim();
    const err = [];
    if (!projectId || projectId === '__new') err.push('Pick a project.');
    if (!app) err.push('Pick an app.');
    if (!what) err.push('Say what you did.');
    if (err.length) { S('#fm-err').textContent = err.join(' '); (what ? S('#fm-project') : S('#fm-what')).focus(); return; }
    const files = $$('.filerow', root).map(r => ({ type: r.querySelector('[data-k=type]').value, value: r.querySelector('[data-k=value]').value, label: r.querySelector('[data-k=label]').value }));
    const botName = app === 'Grok Bot' ? S('#fm-bot').value.trim() : '';
    await store.saveEntry({ ...(entry || {}), date: S('#fm-date').value || today(), projectId, app, botName, what, files, status,
      nextStep: S('#fm-next').value, tags: S('#fm-tags').value.split(',') });
    await store.saveSettings({ lastProjectId: projectId, lastApp: app, ...(botName ? { lastBotName: botName } : {}) });
    closeSheet(); await load(); render(); toast(entry ? 'Saved' : 'Added ✓');
  };
  if (!entry) setTimeout(() => { if (root.isConnected) S('#fm-what').focus(); }, 60);
}

// ---------- router ----------
function render() {
  const h = location.hash || '#/search';
  const [, route, arg] = h.match(/^#\/([^/]*)\/?(.*)$/) || [, 'search'];
  $$('.bottomnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (route === 'project' ? 'projects' : route)));
  $$('.bottomnav a').forEach(a => a.toggleAttribute('aria-current', a.classList.contains('active')));
  if (route === 'projects') renderProjects();
  else if (route === 'project') renderProject(decodeURIComponent(arg));
  else if (route === 'settings') renderSettings();
  else renderSearch();
}
let lastRoute = '';
addEventListener('hashchange', () => {
  const r = location.hash.split('/')[1] || 'search';
  if (location.hash === '#/add') { history.replaceState(null, '', '#/search'); render(); openForm(); return; }
  render(); if (r !== lastRoute) scrollTo(0, 0); lastRoute = r;
});
$('#fab').onclick = () => openForm(null, location.hash.startsWith('#/project/') ? { projectId: decodeURIComponent(location.hash.slice(10)) } : {});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(state.settings.theme));

(async function start() {
  await store.init(); await load(); applyTheme(state.settings.theme);
  const wantAdd = location.hash === '#/add';
  if (wantAdd || !location.hash) history.replaceState(null, '', '#/search');
  render();
  if (wantAdd) openForm();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
