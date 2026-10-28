// prompt.js: "Prompt builder" for mind maps. Pure, offline, deterministic templates (no network, no keys)
// plus the result sheet and the prompt history view. User text is only ever inserted with textContent / .value.
import * as store from './store.js';

export const TYPES = { image: 'Image', music: 'Music', code: 'Code', text: 'Text', plan: 'Plan' };
// Strip **bold**, *italic*, __underline__ and "- " bullets; collapse to one line.
export const clean = t => String(t || '').split('\n').map(l => l.replace(/^\s*[-•]\s+/, '').trim()).filter(Boolean).join('; ')
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\s+/g, ' ').trim();

const KW = {
  image: ['art', 'artwork', 'sprite', 'sprites', 'image', 'images', 'logo', 'logos', 'draw', 'drawing', 'render', 'icon', 'icons', 'picture', 'pictures',
    'illustration', 'illustrate', 'portrait', 'wallpaper', 'texture', 'textures', 'tile', 'tiles', 'tileset', 'pixel', 'painting', 'sticker', 'stickers', 'thumbnail', 'poster', 'banner', 'mockup', 'concept art'],
  code: ['code', 'coding', 'app', 'apps', 'script', 'scripts', 'function', 'functions', 'bug', 'bugs', 'build', 'api', 'apis', 'program', 'website', 'web app',
    'plugin', 'bot', 'database', 'sql', 'python', 'javascript', 'typescript', 'react', 'android', 'ios', 'unity', 'godot', 'lua', 'deploy', 'backend', 'frontend', 'pwa'],
};
KW.music = ['music', 'track', 'tracks', 'song', 'songs', 'loop', 'loops', 'soundtrack', 'soundtracks', 'sound', 'sounds', 'sfx', 'audio', 'beat', 'beats', 'theme song', 'ambient', 'ost', 'jingle', 'melody'];
KW.research = ['research', 'compare', 'comparison', 'sources', 'find out', 'analyze', 'analyse', 'market', 'competitors', 'statistics', 'study', 'review of', 'investigate', 'pros and cons'];
KW.plan = ['plan', 'plans', 'roadmap', 'steps', 'how do i', 'how to', 'strategy', 'schedule', 'timeline', 'milestones'];
KW.text = ['write', 'description', 'descriptions', 'copy', 'post', 'posts', 'email', 'story', 'blog', 'article', 'caption', 'captions', 'bio', 'tagline', 'slogan', 'newsletter', 'letter', 'summary', 'pitch', 'announcement', 'listing', 'dialogue', 'lyrics'];
const has = (txt, w) => new RegExp('(^|[^a-z0-9])' + w.replace(/ /g, '\\s+') + '($|[^a-z0-9])', 'i').test(txt);
const score = (txt, t) => KW[t].reduce((s, w) => s + (has(txt, w) ? 1 : 0), 0);
// Child bubble (the deliverable) weighs most; the rest of the path breaks ties. Plan wins only when the child asks for one.
export function guessType(path, { research = false } = {}) {
  const child = path[path.length - 1] || '', all = path.join(' \n ');
  if (score(child, 'plan')) return 'plan';
  const order = research ? ['music', 'image', 'code', 'research', 'text'] : ['music', 'image', 'code', 'text'];
  const sc = t => score(child, t) * 10 + score(all, t);
  let best = 'text', bs = 0;
  for (const t of order) { const v = sc(t); if (v > bs) { bs = v; best = t; } }
  return best;
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

const GAMEW = ['game', 'games', 'match', 'match-3', 'match 3', 'puzzle', 'level', 'levels', 'player', 'sprite', 'sprites', 'rpg', 'platformer', 'godot', 'unity', 'roblox'];
const isGame = all => GAMEW.some(w => has(all, w));
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, a: 1 };
function trackCount(txt) {
  const m = txt.match(/(?:at\s+least\s+|about\s+|around\s+|maybe\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:more\s+|new\s+|extra\s+|different\s+)*(?:background\s+|music\s+|bgm\s+|looping\s+|game\s+)*(tracks?|songs?|loops?|themes?|pieces?|tunes?)/i);
  if (!m) return null; const n = /^\d+$/.test(m[1]) ? +m[1] : NUMW[m[1].toLowerCase()]; return Math.max(1, Math.min(n || 1, 12));
}
function musicTheme(all) {
  const f = w => has(all, w);
  if (['halloween', 'spooky', 'dracula', 'werewolf', 'ghost', 'ghosts', 'pumpkin', 'pumpkins', 'witch', 'haunted', 'vampire', 'zombie'].some(f))
    return { sure: true, theme: 'spooky but fun Halloween casual game', genre: 'playful spooky orchestral-pop for a casual mobile game', inst: 'pizzicato strings, celesta / music box, harpsichord, bassoon, light organ, soft choir "oohs", marimba, light hand percussion and finger snaps', key: 'minor keys (e.g. D minor, A minor) with a cheeky, bouncy feel', bpm: '100–125 BPM' };
  if (['lantern', 'latern', 'lanterns', 'candle', 'night', 'moon'].some(f))
    return { sure: false, theme: 'spooky but fun Halloween / glowing-lantern casual game', genre: 'whimsical, playful spooky casual-game music (orchestral-pop)', inst: 'pizzicato strings, celesta / music box, marimba, harpsichord, bassoon, soft choir pads and light percussion', key: 'minor keys with a bouncy, cheeky feel (e.g. D minor, E minor)', bpm: '100–125 BPM' };
  if (['cozy', 'cute', 'farm', 'garden', 'cafe'].some(f)) return { sure: true, theme: 'cozy, cute casual game', genre: 'cozy lo-fi acoustic / light orchestral', inst: 'acoustic guitar, ukulele, glockenspiel, soft piano, light shakers', key: 'major keys (C, F, G major)', bpm: '85–110 BPM' };
  if (['space', 'sci-fi', 'cyber', 'neon', 'robot'].some(f)) return { sure: true, theme: 'sci-fi / synthwave game', genre: 'synthwave / chiptune-electronic', inst: 'analog synth pads, arpeggiated synths, punchy electronic drums, synth bass', key: 'minor keys', bpm: '100–128 BPM' };
  if (['fantasy', 'rpg', 'dragon', 'quest', 'medieval'].some(f)) return { sure: true, theme: 'fantasy adventure game', genre: 'light fantasy orchestral', inst: 'strings, flute, harp, french horn, light percussion', key: 'modal / Dorian flavour', bpm: '90–120 BPM' };
  return { sure: false, theme: 'casual puzzle game', genre: 'upbeat, light casual-game music', inst: 'marimba, pizzicato strings, glockenspiel, light piano, soft synth pad, light percussion', key: 'mostly major keys with one or two gentle minor-key moods', bpm: '95–120 BPM' };
}
const MOODS = [
  ['Main gameplay loop', 'playful and catchy, steady energy that never gets tiring on repeat', 'middle'],
  ['Calm / thinking', 'relaxed and mysterious, sparse and airy, good for slow puzzle-solving', 'slower end'],
  ['Upbeat bonus / combo', 'bright, bouncy and exciting, for streaks, boosters and bonus rounds', 'faster end'],
  ['Tension / last moves', 'suspenseful but still fun, building urgency for low moves or timers', 'faster end'],
  ['Menu / map screen', 'warm, inviting and memorable, a light theme-like melody', 'middle'],
  ['Night / ambient', 'soft, dreamy and atmospheric, minimal percussion', 'slower end'],
  ['Boss / special level', 'dramatic and driving but still playful', 'faster end'],
  ['Victory-adjacent', 'cheerful, triumphant and light, without a final ending cadence', 'middle'],
];

export function generate({ path, related = [], type, mapTitle = '' }) {
  const P = path[0], C = path[path.length - 1], mid = path.slice(1, -1), all = path.join(' \n ') + ' \n ' + related.join(' \n ');
  const one = path.length < 2;
  const steps = path.map((t, i) => `${i + 1}. ${i === 0 ? 'If' : 'then'} ${t}`).join('\n');
  const rel = related.length ? `\nRelated ideas (linked in my map): ${related.join('; ')}.` : '';
  const kind = isGame(all) ? 'game' : 'game/project';
  const proj = one ? '' : `This is for my ${kind} ${q(P)}.`;
  const midLine = mid.length ? ` It sits under ${mid.map(q).join(' → ')} in my plan.` : '';
  const ctxLine = `${mapTitle ? `From my mind map “${mapTitle}”: ` : ''}${chainText(path)}.`;
  const deliver = cap(C.replace(VERB, '')) || cap(C);
  if (type === 'image') {
    const o = imageStyle(all); let subj = deliver;
    const sm = subj.match(/^(.*?)(\w+) for (\w+?)s?$/i); if (sm && sm[3].length > 2) subj = cap(`${sm[1]}${sm[3].toLowerCase()} ${sm[2]}`);
    const where = (mid.length ? ` for ${mid[mid.length - 1]}` : '') + (one ? '' : `, part of ${P}`);
    return [
      `${cap(o.style.split(',')[0])}: ${subj}${where}.`,
      ``,
      `Subject: ${subj}${where}.${proj ? ' ' + proj : ''}`,
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
  if (type === 'music') {
    const th = musicTheme(all); const n = trackCount(path.slice(1).join(' \n ')) || trackCount(all) || 1;
    const themeTxt = th.sure ? `The theme is a ${th.theme}.` : `If the ${kind === 'game' ? "game's" : "project's"} theme is a ${th.theme}, lean into that; otherwise keep it fitting for a ${th.theme === 'casual puzzle game' ? 'casual puzzle game' : 'casual puzzle game'}.`;
    const list = Array.from({ length: n }, (_, i) => { const m = MOODS[i % MOODS.length]; return `Track ${i + 1}: “${m[0]}”: ${m[1]}; tempo at the ${m[2]} of the range.`; }).join('\n');
    return [
      `Compose ${n === 1 ? 'one original instrumental background music track' : `${n} original instrumental background music tracks`} that loop seamlessly${proj ? ` for my ${kind} ${q(P)}` : ''}.`,
      ``,
      `What to make: ${n === 1 ? 'one background music track' : `${n} new background music tracks`} (my note: ${q(C)}).${n > 1 ? ` ${n} separate tracks, each with its own mood (described below), all clearly from the same soundtrack.` : ''}`,
      `Project context: ${proj || 'Background music for my project.'}${midLine} ${themeTxt}${rel}`,
      ``,
      n > 1 ? `Tracks:\n${list}` : `Track: ${MOODS[0][1]}.`,
      ``,
      `Genre & style: ${th.genre}.`,
      `Mood: fun and inviting, never stressful or annoying when heard many times in a row.`,
      `Tempo: ${th.bpm}, steady tempo with no tempo changes inside a track.`,
      `Key: ${th.key}; keep each track in one key.`,
      `Instruments: ${th.inst}. Instrumental only, no vocals.`,
      `Structure: short intro-free loop body, A section then B section (e.g. 8 + 8 bars) then back to A; a simple, memorable motif shared across the tracks.`,
      `Length: 60–120 seconds per track.`,
      `Seamless loop: the end must flow straight back into the start; matching tempo, key, instrumentation and energy at the loop point; no fade-in or fade-out; no ending cadence; no reverb or delay tail cut off at the end (let tails wrap into the start); loop point exactly on a bar boundary; instrumental with no vocals.`,
      `Mixing: sits in the background under gameplay; moderate, even loudness (around -16 LUFS), gentle low end, leave room in the mids and highs for sound effects (matches, combos, UI clicks).`,
      `Export: WAV (or high-quality OGG), 44.1 kHz, 16-bit stereo, one file per track, named by track title.`,
      ``,
      `Avoid: vocals or lyrics, abrupt endings, fades, silence at the start or end, clipping or distortion, overly busy or shrill melodies, sudden loud hits, copying existing songs.`,
    ].join('\n');
  }
  if (type === 'code') {
    const lang = langOf(all);
    return [
      `Role: You are a senior software engineer. Write the complete, working code for this now.`,
      ``,
      `Goal: ${deliver}.${proj ? ' ' + proj : ''}${midLine}`,
      ``,
      `Context (if this, then that):\n${steps}${rel}`,
      ``,
      `Tech / language: ${lang ? `${lang}. Stick to it and its standard library unless a dependency clearly saves effort (say why).` : 'not decided yet. Pick the simplest suitable language/stack (one line why) and use it.'}`,
      ``,
      `Requirements:\n- Do exactly what the goal says; keep scope tight (no extra features).\n- Small, readable functions with clear names and short comments where the logic is not obvious.\n- Handle errors and invalid input gracefully with helpful messages.\n- No secrets or API keys in code; read config from environment or settings.`,
      ``,
      `Edge cases & tests: handle empty input, very large input, bad or missing data, offline/network failure and duplicates, and include unit tests for the main path and each edge case.`,
      ``,
      `Output format: output the full code, ready to paste: every file complete in its own fenced code block with the file name above it (no placeholders, no "..." or "rest stays the same"), then the tests, then short run instructions. If something is ambiguous, state your assumption in one line and continue.`,
    ].join('\n');
  }
  if (type === 'plan') {
    return [
      `Role: You are an ${textRole(all)}.`,
      ``,
      `Goal: ${C}.`,
      ``,
      `Starting point: ${P}.${proj ? ' ' + proj : ''}`,
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
  return [
    `Write this for me now: ${deliver}.`,
    ``,
    `Project context: ${proj || 'For my own project.'}${midLine}`,
    `Background: ${ctxLine}${rel}`,
    ``,
    `You are a ${textRole(all).replace('expert advisor and practical planner', 'skilled professional writer')}. Write the finished piece itself, not a plan or an outline and not tips on how to write it.`,
    `Tone: clear, warm and specific to ${one ? 'this' : q(P)}; no generic filler or clichés.`,
    `Length & format: whatever fits the piece (e.g. a store description: a hook line, 3–5 short benefit bullets, a closing call to action); use headings or bullets only where they help.`,
    ``,
    `Output only the final text, ready to paste. If a detail is missing (name, price, link), use a clear [placeholder] instead of asking. Then add up to 2 alternative versions of the opening line.`,
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

// ---------- v1.3.0: standalone builder engine (shared helpers above) ----------
// Per-AI formatting follows each vendor's published prompting guidance (see PROMPT-SOURCES.md):
//  Claude  - XML-tagged sections, clear role + explicit instructions: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
//  Gemini  - persona / constraints / output format first, context before the task, task last ("Based on the information above"):
//            https://ai.google.dev/gemini-api/docs/prompting-strategies
//  Grok    - precise goal + requirements, only relevant context, Markdown/labelled sections, concise:
//            https://docs.x.ai/docs/guides/grok-code-prompt-engineering , https://docs.x.ai/developers/model-capabilities/text/best-practices
//  Muse    - Meta's assistant (meta.ai): plain conversational descriptions; images: subject, setting, mood, style, lighting and the
//            aspect ratio stated in text; be specific about format: https://www.meta.com/help/superintelligence/2074655449783957/ ,
//            https://dev.meta.ai/docs/api-reference/images/create-image
export const AIS = { grok: 'Grok', muse: 'Meta Muse', gemini: 'Gemini', claude: 'Claude', other: 'Other' };
export const SB_TYPES = { code: 'Code', image: 'Image', music: 'Music', research: 'Research', text: 'Text', plan: 'Plan' };
export const LENGTHS = { short: 'Short', normal: 'Normal', detailed: 'Detailed' };
export const TONES = { casual: 'Casual', professional: 'Professional', fun: 'Fun', neutral: 'Neutral' };
// Plain web addresses only. No prefill parameter is officially documented for these web apps, so we copy first and open.
export const AI_URLS = { grok: 'https://grok.com/', muse: 'https://www.meta.ai/', gemini: 'https://gemini.google.com/app', claude: 'https://claude.ai/new' };
// Claude replies with text and code only (no image or audio output): https://docs.claude.com/en/docs/about-claude/models/overview
export function aiHint(ai, type) {
  if (ai === 'claude' && type === 'image') return 'Claude can’t make images itself: it will polish this into a final prompt. Paste that into an image AI.';
  if (ai === 'claude' && type === 'music') return 'Claude can’t make audio itself: it will polish this into a final prompt. Paste that into a music AI.';
  if (type === 'music') return 'Many chat AIs can’t make audio. If yours replies with text only, paste this prompt into a music AI.';
  return '';
}
export const splitList = t => String(t || '').split(/[,;\n]+/).map(x => x.trim().replace(/\.$/, '')).filter(Boolean);
const mergeAvoid = (base, extra) => { const out = [], seen = new Set(); for (const x of [...base, ...splitList(extra)]) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; };
const sentence = t => { t = String(t || '').trim().replace(/\s+/g, ' '); return t && !/[.!?]$/.test(t) ? t + '.' : t; };
const firstLine = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';

// form: {ai, type, want, context, length, tone, avoid}. Returns a neutral spec the renderers format per AI.
export function compose(form) {
  const want = String(form.want || '').trim(), ctxt = String(form.context || '').trim();
  const type = form.type || guessType([want], { research: true });
  const len = form.length || 'normal', tone = form.tone || 'neutral';
  const all = want + ' \n ' + ctxt, deliver = cap(clean(want).replace(VERB, '')) || 'Something useful';
  const T = { casual: 'casual and friendly', professional: 'professional and polished', fun: 'fun, playful and upbeat', neutral: 'clear and neutral' }[tone];
  const sp = { type, role: '', task: '', details: [], avoid: [], format: '', uncertain: 'If a detail is missing, make a sensible assumption, state it in one line, and continue.', context: ctxt, deliver };
  if (type === 'image') {
    const o = imageStyle(all);
    if (tone === 'fun') o.style += ', playful and fun mood'; else if (tone === 'professional') o.style += ', clean, polished professional finish'; else if (tone === 'casual') o.style += ', relaxed, friendly feel';
    if (len === 'short') o.detail = 'simple, low detail, bold readable shapes'; else if (len === 'detailed') o.detail = 'high detail with rich textures on the subject, background still secondary';
    Object.assign(sp, { role: 'an expert digital artist and art director', task: `Create an image: ${deliver}.`,
      details: [['Style & medium', o.style], ['Composition', o.comp], ['Lighting', o.light], ['Color palette', o.palette], ['Detail level', o.detail], ['Aspect ratio / size', o.ar], ['Background', o.bg], ['Consistency', o.cons]],
      avoid: mergeAvoid(o.neg, form.avoid), format: 'Generate 4 variations that follow this description so I can pick the best.' });
  } else if (type === 'music') {
    const th = musicTheme(all), n = trackCount(all) || 1;
    const L = { short: '30–60 seconds', normal: '60–120 seconds', detailed: '120–180 seconds' }[len];
    const tracks = Array.from({ length: n }, (_, i) => { const m = MOODS[i % MOODS.length]; return `Track ${i + 1} “${m[0]}”: ${m[1]}; tempo at the ${m[2]} of the range`; });
    Object.assign(sp, { role: 'an experienced game and media composer', task: `Compose ${n === 1 ? 'one original instrumental track' : `${n} original instrumental tracks`} for: ${deliver}.`,
      details: [...(n > 1 ? [['Tracks', tracks.join('; ')]] : []), ['Theme', th.sure ? th.theme : `if the theme is a ${th.theme}, lean into it; otherwise keep it fitting for a casual game`], ['Genre & style', th.genre],
        ['Mood', tone === 'neutral' ? 'inviting, never annoying on repeat' : `${T}, never annoying on repeat`], ['Tempo', `${th.bpm}, steady`], ['Key', th.key], ['Instruments', th.inst], ['Length', `${L} per track`],
        ['Seamless loop', 'end flows straight back into the start with matching tempo, key and energy; no fade-in or fade-out; no reverb tail cut off; loop point on a bar boundary; instrumental, no vocals'],
        ['Mixing', 'background level with room in the mids and highs for sound effects'], ['Export', 'WAV or high-quality OGG, 44.1 kHz, one file per track']],
      avoid: mergeAvoid(['vocals or lyrics', 'abrupt endings', 'fades', 'clipping', 'overly busy melodies', 'copying existing songs'], form.avoid), format: n > 1 ? `${n} separate tracks, named by title.` : 'One track.' });
  } else if (type === 'code') {
    const lang = langOf(all);
    Object.assign(sp, { role: 'a senior software engineer who writes clean, working, production-ready code', task: `Write the complete, working code for: ${deliver}.`,
      details: [['Tech / language', lang || 'pick the simplest suitable stack and say why in one line'], ['Requirements', 'do exactly what is asked, keep scope tight, small readable functions, handle errors and invalid input, no secrets in code'],
        ['Comments', { short: 'minimal, only where logic is not obvious', normal: 'short comments where logic is not obvious', detailed: 'clear comments plus a short README section' }[len]],
        ['Tests', len === 'short' ? 'one quick test of the main path' : 'unit tests for the main path and edge cases (empty, large, bad or missing data, offline)'],
        ...(tone !== 'neutral' ? [['User-facing text', `messages and labels in a ${T} tone`]] : [])],
      avoid: mergeAvoid(['placeholders or "..." in code', 'unneeded dependencies', 'hard-coded secrets'], form.avoid),
      format: 'Output the full code: every file complete in its own fenced code block with the file name above it, then the tests, then short run instructions.' });
  } else if (type === 'research') {
    const L = { short: 'a 5-bullet summary', normal: 'about 500 words', detailed: 'a detailed report of about 1,200 words' }[len];
    Object.assign(sp, { role: 'a careful research analyst', task: `Research this and report back: ${deliver}.`,
      details: [['Scope', 'the most relevant, current information (state dates); say what is unknown'], ['Sources', 'prefer primary and reputable sources; cite each key claim with a link'],
        ['Method', 'compare options side by side where relevant and note trade-offs'], ['Tone', T], ['Length', L]],
      avoid: mergeAvoid(['unsourced claims', 'outdated information presented as current', 'filler'], form.avoid),
      format: 'A one-paragraph summary, key findings as bullets with sources, a comparison table if useful, then open questions and next steps.',
      uncertain: 'If something cannot be verified, say so clearly instead of guessing.' });
  } else if (type === 'plan') {
    Object.assign(sp, { role: `an ${textRole(all)}`, task: `Make a practical step-by-step plan for: ${deliver}.`,
      details: [['Steps', 'for each: the action, why it matters, tools or resources, expected output, and how I know it is done'], ['Tone', T],
        ['Length', { short: '5–7 steps', normal: '7–12 steps', detailed: 'a detailed plan with phases and milestones' }[len]]],
      avoid: mergeAvoid(['generic advice', 'expensive tools when free ones work'], form.avoid),
      format: 'One-sentence summary, numbered steps, a quick first action I can do today in under 30 minutes, then risks and how to avoid them.' });
  } else {
    const L = { short: 'about 50–100 words', normal: 'about 150–250 words', detailed: 'about 400–600 words' }[len];
    Object.assign(sp, { type: 'text', role: 'a skilled professional writer', task: `Write this for me now: ${deliver}.`,
      details: [['Tone', T], ['Length', L], ['Audience', 'infer it from the request and context; write for them directly']],
      avoid: mergeAvoid(['generic filler', 'clichés', 'making up facts (use [placeholders])'], form.avoid),
      format: 'Only the finished text, ready to paste (not a plan or tips), then 2 alternative opening lines.' });
  }
  if (form.formatOverride) { if (/\b(words?|sentences?|paragraphs?|seconds|minutes)\b/i.test(form.formatOverride)) sp.details = sp.details.filter(d => d[0] !== 'Length'); sp.format = form.formatOverride; sp.details.push(['Your format notes', form.formatOverride.replace(/\.$/, '')]); }
  return sp;
}
const ctxBlock = c => c ? `Here is background and/or an example of what I like (follow its style and facts):\n${c}` : '';
export function render(sp, ai = 'other') {
  const D = sp.details, ctx = ctxBlock(sp.context), polish = ai === 'claude' && (sp.type === 'image' || sp.type === 'music');
  const task = polish ? `Turn this brief into one final, ready-to-paste prompt for an ${sp.type === 'image' ? 'image' : 'music'} generator. Brief: ${sp.task}` : sp.task;
  if (ai === 'claude') return [
    `You are ${sp.role}.`, ``,
    ...(ctx ? [`<context>`, ctx, `</context>`, ``] : []),
    `<task>`, task, `</task>`, ``,
    `<requirements>`, ...D.map(([k, v]) => `- ${k}: ${v}`), `</requirements>`, ``,
    `<constraints>`, `- Avoid: ${sp.avoid.join(', ')}.`, `- ${sp.uncertain}`, `</constraints>`, ``,
    `<output_format>`, polish ? 'Return only the final prompt in one block, then one line listing the negative prompt / avoid terms.' : sp.format, `</output_format>`,
  ].join('\n');
  if (ai === 'gemini') return [
    `# Role`, `You are ${sp.role}.`, ``,
    ...(ctx ? [`# Context`, ctx, ``] : []),
    `# Requirements`, ...D.map(([k, v]) => `- **${k}:** ${v}`), ``,
    `# Constraints`, `- Avoid: ${sp.avoid.join(', ')}.`, `- ${sp.uncertain}`, ``,
    `# Output format`, sp.format, ``,
    `# Task`, `${ctx ? 'Based on the information above, ' : ''}${ctx ? task.charAt(0).toLowerCase() + task.slice(1) : task}`,
  ].join('\n');
  if (ai === 'grok') return [
    `GOAL: ${task}`, ``,
    `CONTEXT:`, `- You are ${sp.role}.`, ...(sp.context ? sp.context.split('\n').filter(Boolean).map(l => `- ${l.trim()}`) : []), ``,
    `DETAILS:`, ...D.map(([k, v]) => `- ${k}: ${v}`), ``,
    `OUTPUT FORMAT: ${sp.format}`, ``,
    `QUALITY BAR:`, `- Avoid: ${sp.avoid.join(', ')}.`, `- If uncertain: ${sp.uncertain}`,
  ].join('\n');
  if (ai === 'muse') {
    const g = k => (D.find(d => d[0] === k) || [])[1];
    if (sp.type === 'image') return [
      `${task.replace(/^Create an image: (.)/, (_, c) => 'Create an image of ' + c.toLowerCase())}`, `Style: ${g('Style & medium')}.`,
      `${cap(g('Composition'))}. ${cap(g('Lighting'))}. Colors: ${g('Color palette')}. ${cap(g('Detail level'))}.`,
      `Background: ${g('Background')}. ${cap(g('Consistency'))}.`,
      `Aspect ratio: ${g('Aspect ratio / size')}.`,
      ...(sp.context ? [``, `For reference: ${sp.context.replace(/\s+/g, ' ')}`] : []),
      ``, `Avoid: ${sp.avoid.join(', ')}.`, sp.format,
    ].join('\n');
    return [
      `${task} You are ${sp.role}.`,
      ...(sp.context ? [``, `Some background: ${sp.context.replace(/\s+/g, ' ')}`] : []),
      ``, `Please include:`, ...D.map(([k, v]) => `- ${k}: ${v}`), ``,
      `Format: ${sp.format}`, `Avoid: ${sp.avoid.join(', ')}. ${sp.uncertain}`,
    ].join('\n');
  }
  return [
    `Role: You are ${sp.role}.`, ``, `Task: ${task}`,
    ...(ctx ? [``, `Context: ${ctx}`] : []), ``,
    ...D.map(([k, v]) => `${k}: ${sentence(v)}`), ``,
    `Avoid: ${sp.avoid.join(', ')}.`, ``, `Output format: ${sp.format}`, ``, sp.uncertain,
  ].join('\n');
}
export const buildPrompt = form => render(compose(form), form.ai);

// Improve: restructure a hand-written prompt offline. Keeps the user's content, drops filler, sorts sentences into
// task / context / format / avoid, then renders it with the same per-AI structure.
const FILLER = [/\b(um+|uh+|erm|hey|hi|hello|thanks|thank you|thx|pls|please|kindly|basically|literally|actually|just|really|very|maybe|sort of|kind of|i guess|you know|like,)\b[,!]?\s*/gi,
  /^\s*(can|could|would|will) you\s+(please\s+)?/i, /^\s*i (want|would like|need) you to\s+/i, /^\s*i('d| would) like\s+(you to\s+)?/i, /^\s*i want\s+/i, /^\s*i need\s+/i, /^\s*(help me|try to)\s+/i, /\b(me )?like (?=(a|an|some|the)\b)/gi];
export function improve(raw, { ai = 'other', type = '' } = {}) {
  const parts = String(raw || '').replace(/\r/g, '').split(/\n+|(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const tidy = x => { let t = x; for (const r of FILLER) t = t.replace(r, ''); t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[,.\s]+/, '').trim(); return t.replace(/[?!]+$/, '.'); };
  const avoid = [], fmt = [], ctx = []; let task = '';
  for (const p of parts) {
    const t = tidy(p); if (!t || t.length < 3) continue;
    const m = t.match(/^(?:don'?t|do not|never|avoid|no|without)\s+(?:use\s+|include\s+|add\s+|make it\s+)?(.+)$/i);
    if (m) { avoid.push(...splitList(m[1].replace(/^(any|the)\s+/i, ''))); continue; }
    if (/\b(format|bullet|bullets|list|table|json|markdown|word|words|paragraph|paragraphs|sentences|characters|aspect ratio|in \d+)\b/i.test(t) && task) { fmt.push(sentence(t)); continue; }
    if (!task) task = t; else ctx.push(sentence(t));
  }
  if (!task) return '';
  const ty = type || guessType([task + ' ' + ctx.join(' ')], { research: true });
  return render(compose({ ai, type: ty, want: task.replace(/\.$/, ''), context: ctx.join('\n'), avoid: avoid.join(', '), formatOverride: fmt.length ? fmt.join(' ') : '' }), ai);
}

export const STARTERS = [
  { id: 'starter-sprites', name: 'Game sprite sheet', ai: 'gemini', type: 'image', want: 'Pixel art sprite sheet for my game hero: idle, walk and jump frames', context: '', length: 'normal', tone: 'fun', avoid: 'blurry edges', starter: true },
  { id: 'starter-music', name: 'Looping game music', ai: 'other', type: 'music', want: '3 background music tracks that loop seamlessly for my casual puzzle game', context: '', length: 'normal', tone: 'fun', avoid: '', starter: true },
  { id: 'starter-code', name: 'App feature code', ai: 'claude', type: 'code', want: 'Add an offline-first favorites list to my vanilla JavaScript PWA, saved in IndexedDB', context: '', length: 'normal', tone: 'neutral', avoid: 'frameworks', starter: true },
  { id: 'starter-research', name: 'Research brief', ai: 'grok', type: 'research', want: 'Compare the best ways for a solo indie dev to market a mobile match-3 game in 2026', context: '', length: 'normal', tone: 'professional', avoid: '', starter: true },
  { id: 'starter-listing', name: 'Store listing description', ai: 'muse', type: 'text', want: 'Write a store description for my game', context: '', length: 'normal', tone: 'fun', avoid: 'all caps, emojis', starter: true },
];

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
export const pending = { load: null };
export async function openHistory(ctx, opts = {}) {
  const o = ctx.modal('', 'pb-overlay');
  const sh = el('div', 'sheet pb-sheet pb-histsheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'pbh-h');
  const head = el('header'); const h = el('h2', null, 'Prompt history'); h.id = 'pbh-h'; head.appendChild(h);
  const x = btn('✕', 'pbh-x', 'iconbtn pb-iconx'); x.setAttribute('aria-label', 'Close'); head.appendChild(x); sh.appendChild(head);
  const filt = el('div', 'pb-types pbh-filter'); const fAll = btn('All', 'pbh-all', 'chip'), fFav = btn('★ Favorites', 'pbh-fav', 'chip');
  filt.append(fAll, fFav);
  const body = el('div', 'body'); body.id = 'pbh-list'; const wrap = el('div', 'body pbh-wrap'); wrap.append(filt); sh.append(wrap, body); o.appendChild(sh);
  let favOnly = !!opts.favOnly;
  const close = () => { o.remove(); removeEventListener('keydown', onEsc, true); };
  const onEsc = ev => { if (ev.key === 'Escape' && o.isConnected) { ev.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  x.onclick = close; o.addEventListener('click', ev => { if (ev.target === o) close(); });
  const draw = async () => {
    fAll.classList.toggle('on', !favOnly); fFav.classList.toggle('on', favOnly); fAll.setAttribute('aria-pressed', String(!favOnly)); fFav.setAttribute('aria-pressed', String(favOnly));
    const list = (await store.listPrompts()).filter(it => !favOnly || it.fav); body.textContent = '';
    if (!list.length) { const em = el('div', 'empty'); em.appendChild(el('span', 'big', favOnly ? '★' : '🪄')); em.appendChild(el('b', null, favOnly ? 'No favorites yet.' : 'No prompts yet.')); em.appendChild(el('div', null, favOnly ? 'Tap ☆ on a prompt to star it.' : 'Use the Prompts tab, or in a mind map tap Prompt, then pick a parent and a child bubble.')); body.appendChild(em); return; }
    for (const it of list) {
      const c = el('div', 'card pbh-item' + (it.fav ? ' fav' : '')); c.dataset.pid = it.id;
      const top = el('div', 'pbh-top'); top.appendChild(el('span', 'pbh-type t-' + it.type, SB_TYPES[it.type] || it.type));
      const where = it.source === 'builder' ? ' · ' + (it.ai === 'other' ? (it.aiOther || 'Other') : AIS[it.ai] || 'Builder') : it.mapTitle ? ' · ' + it.mapTitle : '';
      top.appendChild(el('span', 'pbh-date', new Date(it.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + where));
      const st = btn(it.fav ? '★' : '☆', null, 'iconbtn pbh-star'); st.dataset.h = 'star'; st.setAttribute('aria-label', it.fav ? 'Remove from favorites' : 'Add to favorites'); st.setAttribute('aria-pressed', String(!!it.fav)); top.appendChild(st);
      c.appendChild(top);
      c.appendChild(el('div', 'pbh-chain', it.source === 'builder' ? (it.form && it.form.want || '').slice(0, 140) : chainText(it.path && it.path.length ? it.path : [it.parentText, it.childText])));
      c.appendChild(el('div', 'pbh-prev', it.prompt.slice(0, 160) + (it.prompt.length > 160 ? '…' : '')));
      const acts = el('div', 'acts'); const bc = btn('Copy'), bo = btn('Reopen'), bd = btn('Delete', null, 'btn danger');
      bc.dataset.h = 'copy'; bo.dataset.h = 'open'; bd.dataset.h = 'del'; acts.append(bc, bo, bd); c.appendChild(acts); body.appendChild(c);
    }
  };
  fAll.onclick = () => { favOnly = false; draw(); }; fFav.onclick = () => { favOnly = true; draw(); };
  body.onclick = async ev => {
    const b = ev.target.closest('[data-h]'); if (!b) return; const id = b.closest('[data-pid]').dataset.pid;
    const it = (await store.listPrompts()).find(z => z.id === id); if (!it) return;
    if (b.dataset.h === 'star') { await store.savePrompt({ ...it, fav: !it.fav }); ctx.toast(it.fav ? 'Removed from favorites' : 'Added to favorites ★'); draw(); }
    if (b.dataset.h === 'copy') await copy(it.prompt, ctx.toast);
    if (b.dataset.h === 'open') {
      close();
      if (it.source === 'builder') { if (opts.onReopen) opts.onReopen(it); else { pending.load = it; location.hash = '#/prompts'; } }
      else openSheet(ctx, it, { onSaveBubble: opts.mapId === it.mapId ? opts.onSaveBubble : null });
    }
    if (b.dataset.h === 'del' && await ctx.confirmDialog('Delete this prompt?', 'It will be removed from your prompt history.', 'Delete', true)) { await store.deletePrompt(id); ctx.toast('Prompt deleted'); draw(); }
  };
  await draw();
  return o;
}
