// prompt.js: "Prompt builder" for mind maps. Pure, offline, deterministic templates (no network, no keys)
// plus the result sheet and the prompt history view. User text is only ever inserted with textContent / .value.
import * as store from './store.js';

export const TYPES = { image: 'Image', code: 'Code', text: 'Text/General' };
// Strip **bold**, *italic*, __underline__ and "- " bullets; collapse to one line.
export const clean = t => String(t || '').split('\n').map(l => l.replace(/^\s*[-•]\s+/, '').trim()).filter(Boolean).join('; ')
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\s+/g, ' ').trim();

const KW = {
  image: ['art', 'artwork', 'sprite', 'sprites', 'image', 'images', 'logo', 'logos', 'draw', 'drawing', 'render', 'icon', 'icons', 'picture', 'pictures',
    'illustration', 'illustrate', 'portrait', 'wallpaper', 'texture', 'textures', 'tile', 'tiles', 'tileset', 'pixel', 'painting', 'sticker', 'stickers', 'thumbnail', 'poster', 'banner', 'mockup', 'concept art'],
  code: ['code', 'coding', 'app', 'apps', 'script', 'scripts', 'function', 'functions', 'bug', 'bugs', 'build', 'api', 'apis', 'program', 'website', 'web app',
    'plugin', 'bot', 'database', 'sql', 'python', 'javascript', 'typescript', 'react', 'android', 'ios', 'unity', 'godot', 'lua', 'deploy', 'backend', 'frontend', 'pwa'],
};
const has = (txt, w) => new RegExp('(^|[^a-z0-9])' + w.replace(/ /g, '\\s+') + '($|[^a-z0-9])', 'i').test(txt);
const score = (txt, t) => KW[t].reduce((s, w) => s + (has(txt, w) ? 1 : 0), 0);
export function guessType(path) {
  const child = path[path.length - 1] || '', all = path.join(' \n ');
  const s = t => score(child, t) * 2 + score(all, t);
  const si = s('image'), sc = s('code');
  if (!si && !sc) return 'text';
  if (si === sc) return score(child, 'image') >= score(child, 'code') ? 'image' : 'code';
  return si > sc ? 'image' : 'code';
}

// ---------- path finding over the map (tree first, then links) ----------
export function findPath(map, aId, bId) {
  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const up = id => { const out = []; const seen = new Set(); let c = byId.get(id); while (c && !seen.has(c.id)) { seen.add(c.id); out.push(c.id); c = byId.get(c.parent); } return out; };
  const ua = up(aId), ub = up(bId); const ib = new Map(ub.map((id, i) => [id, i]));
  const lcaI = ua.findIndex(id => ib.has(id));
  let ids, kind;
  if (lcaI >= 0) {
    const lca = ua[lcaI]; ids = [...ua.slice(0, lcaI + 1), ...ub.slice(0, ib.get(lca)).reverse()];
    kind = lca === aId ? 'down' : lca === bId ? 'up' : 'branch';
  } else { // different main topics: BFS over tree edges + dashed links
    const adj = new Map(map.nodes.map(n => [n.id, []]));
    const add = (x, y) => { if (adj.has(x) && adj.has(y)) { adj.get(x).push(y); adj.get(y).push(x); } };
    for (const n of map.nodes) if (n.parent) add(n.id, n.parent);
    for (const l of map.links) add(l.from, l.to);
    const prev = new Map([[aId, null]]); const q = [aId];
    while (q.length && !prev.has(bId)) { const c = q.shift(); for (const nx of adj.get(c) || []) if (!prev.has(nx)) { prev.set(nx, c); q.push(nx); } }
    if (prev.has(bId)) { ids = []; for (let c = bId; c; c = prev.get(c)) ids.unshift(c); kind = 'linked'; }
    else { ids = [aId, bId]; kind = 'separate'; }
  }
  const on = new Set(ids); const txt = id => clean(byId.get(id)?.text) || 'untitled idea';
  const related = map.links.filter(l => on.has(l.from) || on.has(l.to))
    .filter(l => !ids.some((id, i) => i && ((ids[i - 1] === l.from && id === l.to) || (ids[i - 1] === l.to && id === l.from))))
    .map(l => `${txt(l.from)} → ${txt(l.to)}`);
  return { ids, path: ids.map(txt), related: [...new Set(related)], kind };
}

export const chainText = path => path.map((t, i) => (i === 0 ? 'If ' : 'then ') + t).join(' ');
const q = s => `“${s}”`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const VERB = /^(please\s+)?(generate|create|make|design|draw|render|build|write|produce|develop|code|craft|come up with|get)\s+(me\s+)?/i;

// ---------- the templates ----------
function imageStyle(all) {
  const f = w => has(all, w);
  const o = { style: 'polished digital illustration, clean shapes, professional quality', comp: 'single clear subject centred with breathing room, readable silhouette', light: 'soft key light from the top left with gentle rim light for separation',
    palette: 'a cohesive, limited palette of 5–7 harmonious colors with one accent color', detail: 'medium-high detail on the subject, simplified background', ar: '1:1 square, 1024×1024 px',
    bg: 'simple, uncluttered background that supports the subject', cons: 'keep proportions, line weight and palette consistent so variations look like one set', neg: [] };
  if (f('sprite') || f('sprites') || f('pixel') || f('tileset')) Object.assign(o, {
    style: '2D pixel art game sprite in the style of a polished indie game, crisp 1-px dark outlines, clean readable pixel clusters, no anti-aliasing blur',
    comp: 'full-body subject, centred, facing 3/4 toward the viewer, same scale and baseline in every frame; if several, lay them out as a sprite sheet on an even grid (e.g. 4 columns × 4 rows) with equal padding',
    light: 'simple top-left light source with 2–3 step cel shading and a small highlight; no realistic lighting effects',
    palette: 'limited palette of 16–24 colors, strong value contrast so it reads at small size',
    detail: 'low-to-medium detail designed to read clearly at 32×32 or 64×64 px; no tiny noisy details',
    ar: '1:1; each frame 64×64 px on a grid (render large, e.g. 1024×1024, then downscale with nearest-neighbour)',
    bg: 'transparent background (or a flat solid #FF00FF chroma-key color that is easy to remove), no shadows on the ground plane, no scenery',
    cons: 'same character proportions, outline color, palette and light direction across every sprite and frame so they fit together in one game',
    neg: ['anti-aliasing', 'gradients', 'photorealism', '3D render', 'motion blur', 'inconsistent scale', 'scenery or background objects'] });
  else if (f('logo') || f('logos')) Object.assign(o, { style: 'clean flat vector logo, simple geometric shapes, scalable, works in one color', comp: 'centred mark with generous margin; optional wordmark beside or below', light: 'flat, no lighting effects', palette: '2–3 brand colors with strong contrast; must also work in black and white', detail: 'minimal detail, readable at 32 px', bg: 'plain white or transparent background', cons: 'consistent stroke width and corner radius', neg: ['gradients', 'photorealism', 'tiny details', 'mockup scene', 'drop shadows'] });
  else if (f('icon') || f('icons') || f('sticker') || f('stickers')) Object.assign(o, { style: 'flat app icon / sticker style, bold shapes, thick clean outline', comp: 'one centred symbol filling about 70% of the canvas', detail: 'low detail, readable at 48 px', bg: 'transparent or plain solid background', cons: 'same outline weight, corner radius and palette across the whole set', neg: ['photorealism', 'small text', 'busy background'] });
  else if (f('texture') || f('textures') || f('tile') || f('tiles')) Object.assign(o, { style: 'seamless tileable game texture', comp: 'top-down, evenly distributed pattern with no obvious focal point; edges must tile seamlessly', ar: '1:1, 512×512 or 1024×1024 px', bg: 'the texture fills the whole frame', neg: ['visible seams', 'perspective', 'vignette', 'single focal object'] });
  else if (f('wallpaper') || f('banner') || f('thumbnail')) Object.assign(o, { ar: f('wallpaper') ? '9:16 for a phone wallpaper (or 16:9 for desktop)' : '16:9, 1920×1080 px', comp: 'rule-of-thirds composition with clear space for text or UI' });
  else if (f('portrait') || f('photo')) Object.assign(o, { style: 'photorealistic portrait, 85 mm lens look, shallow depth of field', light: 'soft window light with a subtle rim light', ar: '4:5 portrait' });
  else if (f('poster')) Object.assign(o, { ar: '2:3 portrait poster', comp: 'strong central focal point with a clear area for a title' });
  if (f('halloween') || f('spooky')) o.palette = 'Halloween palette: pumpkin orange, deep purple, slime green and near-black, with warm glowing accents';
  if (f('cozy') || f('cute')) o.style += ', cute and cozy mood with rounded friendly shapes';
  for (const m of ['watercolor', 'anime', 'low poly', 'isometric', 'chibi', 'cartoon', 'retro', 'neon', 'minimalist']) if (f(m)) o.style += `, ${m} style`;
  o.neg = ['blurry', 'low resolution', 'jpeg artifacts', 'watermark', 'signature', 'text or letters', 'cropped subject', 'extra limbs', 'deformed hands', ...o.neg];
  return o;
}
function langOf(all) {
  const L = [['python', 'Python'], ['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['react', 'React + TypeScript'], ['node', 'Node.js'], ['android', 'Kotlin (Android)'], ['kotlin', 'Kotlin'],
    ['ios', 'Swift (iOS)'], ['swift', 'Swift'], ['unity', 'C# (Unity)'], ['godot', 'GDScript (Godot)'], ['roblox', 'Luau (Roblox)'], ['lua', 'Lua'], ['sql', 'SQL'], ['rust', 'Rust'],
    ['pwa', 'vanilla HTML/CSS/JavaScript (PWA)'], ['website', 'HTML/CSS/JavaScript'], ['web app', 'HTML/CSS/JavaScript'], ['html', 'HTML/CSS/JavaScript'], ['excel', 'Excel formulas / VBA'], ['sheets', 'Google Apps Script']];
  const hit = L.find(([w]) => has(all, w)); return hit ? hit[1] : null;
}
function textRole(all) {
  const f = w => has(all, w);
  if (['income', 'money', 'sell', 'sales', 'business', 'etsy', 'gig', 'marketing', 'customers', 'pricing'].some(f)) return 'business strategist and growth coach for solo creators';
  if (['story', 'blog', 'post', 'write', 'script', 'video', 'youtube', 'newsletter'].some(f)) return 'professional writer and content strategist';
  if (['learn', 'study', 'course', 'skill', 'practice'].some(f)) return 'patient expert tutor and learning coach';
  if (['game', 'games', 'level', 'levels', 'player'].some(f)) return 'experienced game designer';
  return 'expert advisor and practical planner';
}

export function generate({ path, related = [], type, mapTitle = '' }) {
  const P = path[0], C = path[path.length - 1], mid = path.slice(1, -1), all = path.join(' \n ') + ' \n ' + related.join(' \n ');
  const steps = path.map((t, i) => `${i + 1}. ${i === 0 ? 'If' : 'then'} ${t}`).join('\n');
  const rel = related.length ? `\nRelated ideas (linked in my map): ${related.join('; ')}.` : '';
  const ctxLine = `${mapTitle ? `From my mind map “${mapTitle}”: ` : ''}${chainText(path)}.`;
  if (type === 'image') {
    const o = imageStyle(all); const subject = cap(C.replace(VERB, '')) || cap(C);
    const theme = mid.length ? ` for ${mid.join(', ')}` : '';
    return [
      `${cap(o.style.split(',')[0])}: ${subject}${theme}.`,
      ``,
      `Subject: ${subject}${theme} — the goal is ${q(C)}, starting from ${q(P)}.`,
      `Context: ${ctxLine}${rel}`,
      `Style & medium: ${o.style}.`,
      `Composition: ${o.comp}.`,
      `Lighting: ${o.light}.`,
      `Color palette: ${o.palette}.`,
      `Detail level: ${o.detail}.`,
      `Resolution / aspect ratio: ${o.ar}.`,
      `Background: ${o.bg}.`,
      `Consistency: ${o.cons}. Generate 4 variations that share this style so I can pick the best.`,
      ``,
      `Negative prompt: ${o.neg.join(', ')}.`,
    ].join('\n');
  }
  if (type === 'code') {
    const lang = langOf(all);
    return [
      `Role: You are a senior software engineer who writes clean, well-tested, production-ready code.`,
      ``,
      `Goal: ${C}.`,
      ``,
      `Context (if this, then that):\n${steps}${rel}`,
      `Start from ${q(P)} and treat every step above as a requirement that the next step builds on.`,
      ``,
      `Tech / language: ${lang ? `${lang}. Stick to it and its standard library unless a dependency clearly saves effort (say why).` : 'not decided yet. Recommend the simplest suitable language/stack in one line and why, then use it.'}`,
      ``,
      `Requirements:\n- Do exactly what the goal says; keep scope tight (no extra features).\n- Small, readable functions with clear names and short comments where the logic is not obvious.\n- Handle errors and invalid input gracefully with helpful messages.\n- No secrets or API keys in code; read config from environment or settings.`,
      ``,
      `Edge cases & tests: list the edge cases you considered (empty input, very large input, bad or missing data, offline/network failure, duplicates), and include unit tests for the main path and each edge case.`,
      ``,
      `Output format:\n1. A 2–3 sentence plan.\n2. The complete code in fenced code blocks, one per file, with the file name above each.\n3. The tests.\n4. How to run it, step by step.\n5. Known limitations and next steps.`,
      ``,
      `If anything important is ambiguous (platform, inputs/outputs, data format), ask me up to 3 clarifying questions before writing code; otherwise state your assumptions and proceed.`,
    ].join('\n');
  }
  return [
    `Role: You are an ${textRole(all)}.`,
    ``,
    `Goal: ${C}.`,
    ``,
    `Starting point: ${P}.`,
    `Context (if this, then that):\n${steps}${rel}`,
    ``,
    `Task: Give me the most effective step-by-step way to get from ${q(P)} to ${q(C)}. Follow the chain in order, use each step as a stepping stone, and point out any missing step between them.`,
    ``,
    `Steps: for each step give the action, why it matters, the tools or resources to use, the expected output, and how I know it is done.`,
    ``,
    `Constraints: be specific and practical, prefer free or low-cost options, avoid generic advice, keep it to what actually moves me toward the goal, and flag any assumptions.`,
    ``,
    `Output format:\n1. One-sentence summary of the approach.\n2. Numbered steps (as above).\n3. Quick start: the first action I can take today in under 30 minutes.\n4. Risks or common mistakes and how to avoid them.`,
    ``,
    `Before you start: if anything important is unclear (audience, budget, tools, deadline), ask me up to 3 clarifying questions first; otherwise state your assumptions and proceed.`,
  ].join('\n');
}

// ---------- clipboard / share ----------
export async function copy(txt, toast) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); ok = true; } } catch { }
  if (!ok) {
    const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.className = 'pb-offscreen';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
    try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
  }
  toast(ok ? 'Copied' : 'Copy blocked: long-press the text to copy'); return ok;
}

// ---------- result sheet ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function btn(label, id, cls = 'btn') { const b = el('button', cls, label); b.type = 'button'; if (id) b.id = id; return b; }

// entry: {id?, mapId, mapTitle, parentId, childId, parentText, childText, path, related, type, prompt?, date?}
export async function openSheet(ctx, entry, { onSaveBubble, onHistory } = {}) {
  const e = { ...entry };
  if (!e.type) e.type = guessType(e.path);
  if (!e.prompt) e.prompt = generate(e);
  if (!e.id) { e.id = store.uid(); e.date = new Date().toISOString(); await store.savePrompt(e); }
  const o = ctx.modal('', 'pb-overlay');
  const sh = el('div', 'sheet pb-sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'pb-h');
  const head = el('header'); const h = el('h2', null, 'Prompt builder'); h.id = 'pb-h'; head.appendChild(h);
  const x = btn('✕', 'pb-x', 'iconbtn pb-iconx'); x.setAttribute('aria-label', 'Close'); head.appendChild(x); sh.appendChild(head);
  const body = el('div', 'body');
  const chain = el('div', 'pb-chain'); chain.id = 'pb-chain';
  e.path.forEach((t, i) => { if (i) chain.appendChild(el('span', 'pb-then', 'then')); else chain.appendChild(el('span', 'pb-then', 'If')); chain.appendChild(el('span', 'pb-step' + (i === 0 ? ' start' : i === e.path.length - 1 ? ' goal' : ''), t)); });
  body.appendChild(chain);
  if (e.related && e.related.length) body.appendChild(el('p', 'pb-rel', 'Linked: ' + e.related.join(' · ')));
  const tl = el('div', 'pb-types'); tl.setAttribute('role', 'radiogroup'); tl.setAttribute('aria-label', 'Target AI type');
  for (const [k, v] of Object.entries(TYPES)) { const b = btn(v, null, 'chip'); b.dataset.type = k; b.setAttribute('role', 'radio'); tl.appendChild(b); }
  body.appendChild(tl);
  const ta = el('textarea', 'pb-text'); ta.id = 'pb-text'; ta.setAttribute('aria-label', 'Generated prompt (editable)'); ta.spellcheck = false; ta.value = e.prompt;
  body.appendChild(ta);
  const note = el('p', 'pb-note', 'Built on this phone from your map, no internet needed. Edit freely before copying.'); body.appendChild(note);
  sh.appendChild(body);
  const foot = el('footer', 'pb-foot');
  const bCopy = btn('Copy', 'pb-copy', 'btn primary'), bSave = btn('Save as bubble', 'pb-save'), bShare = btn('Share', 'pb-share'),
    bRegen = btn('Regenerate', 'pb-regen'), bHist = btn('History', 'pb-hist'), bClose = btn('Close', 'pb-close');
  foot.append(bCopy, bSave, bShare, bRegen, bHist, bClose); sh.appendChild(foot); o.appendChild(sh);
  bSave.hidden = !onSaveBubble; bShare.hidden = !navigator.share;
  const markType = () => tl.querySelectorAll('[data-type]').forEach(b => { const on = b.dataset.type === e.type; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  markType();
  const persist = async () => { if (ta.value !== e.prompt) { e.prompt = ta.value; await store.savePrompt(e); } };
  const regen = async () => { e.prompt = generate(e); ta.value = e.prompt; await store.savePrompt(e); ctx.toast('Regenerated as ' + TYPES[e.type]); };
  tl.onclick = async ev => { const b = ev.target.closest('[data-type]'); if (!b || b.dataset.type === e.type) return; e.type = b.dataset.type; markType(); await regen(); };
  bRegen.onclick = regen;
  bCopy.onclick = async () => { await persist(); await copy(ta.value, ctx.toast); };
  bShare.onclick = async () => { await persist(); try { await navigator.share({ title: 'Prompt: ' + e.childText, text: ta.value }); } catch { } };
  bSave.onclick = async () => { await persist(); if (onSaveBubble(ta.value, e)) { close(); } };
  const close = async () => { await persist(); o.remove(); removeEventListener('keydown', onEsc, true); };
  const onEsc = ev => { if (ev.key === 'Escape' && o.isConnected && o === o.parentNode.lastElementChild) { ev.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  bClose.onclick = close; x.onclick = close;
  bHist.onclick = async () => { await close(); openHistory(ctx, { onSaveBubble, onHistory, mapId: e.mapId }); };
  o.addEventListener('click', ev => { if (ev.target === o) close(); });
  setTimeout(() => bCopy.focus({ preventScroll: true }), 30);
  return o;
}

// ---------- history ----------
export async function openHistory(ctx, opts = {}) {
  const o = ctx.modal('', 'pb-overlay');
  const sh = el('div', 'sheet pb-sheet pb-histsheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'pbh-h');
  const head = el('header'); const h = el('h2', null, 'Prompt history'); h.id = 'pbh-h'; head.appendChild(h);
  const x = btn('✕', 'pbh-x', 'iconbtn pb-iconx'); x.setAttribute('aria-label', 'Close'); head.appendChild(x); sh.appendChild(head);
  const body = el('div', 'body'); body.id = 'pbh-list'; sh.appendChild(body); o.appendChild(sh);
  const close = () => { o.remove(); removeEventListener('keydown', onEsc, true); };
  const onEsc = ev => { if (ev.key === 'Escape' && o.isConnected) { ev.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  x.onclick = close; o.addEventListener('click', ev => { if (ev.target === o) close(); });
  const draw = async () => {
    const list = await store.listPrompts(); body.textContent = '';
    if (!list.length) { const em = el('div', 'empty'); em.appendChild(el('span', 'big', '🪄')); em.appendChild(el('b', null, 'No prompts yet.')); em.appendChild(el('div', null, 'In a mind map, tap Prompt, then pick a parent and a child bubble.')); body.appendChild(em); return; }
    for (const it of list) {
      const c = el('div', 'card pbh-item'); c.dataset.pid = it.id;
      const top = el('div', 'pbh-top'); top.appendChild(el('span', 'pbh-type t-' + it.type, TYPES[it.type] || it.type));
      top.appendChild(el('span', 'pbh-date', new Date(it.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (it.mapTitle ? ' · ' + it.mapTitle : '')));
      c.appendChild(top);
      c.appendChild(el('div', 'pbh-chain', chainText(it.path && it.path.length ? it.path : [it.parentText, it.childText])));
      c.appendChild(el('div', 'pbh-prev', it.prompt.slice(0, 160) + (it.prompt.length > 160 ? '…' : '')));
      const acts = el('div', 'acts'); const bc = btn('Copy'), bo = btn('Reopen'), bd = btn('Delete', null, 'btn danger');
      bc.dataset.h = 'copy'; bo.dataset.h = 'open'; bd.dataset.h = 'del'; acts.append(bc, bo, bd); c.appendChild(acts); body.appendChild(c);
    }
  };
  body.onclick = async ev => {
    const b = ev.target.closest('[data-h]'); if (!b) return; const id = b.closest('[data-pid]').dataset.pid;
    const it = (await store.listPrompts()).find(z => z.id === id); if (!it) return;
    if (b.dataset.h === 'copy') await copy(it.prompt, ctx.toast);
    if (b.dataset.h === 'open') { close(); openSheet(ctx, it, { onSaveBubble: opts.mapId === it.mapId ? opts.onSaveBubble : null }); }
    if (b.dataset.h === 'del' && await ctx.confirmDialog('Delete this prompt?', 'It will be removed from your prompt history.', 'Delete', true)) { await store.deletePrompt(id); ctx.toast('Prompt deleted'); draw(); }
  };
  await draw();
  return o;
}
