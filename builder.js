// Standalone Prompt builder (v1.3.0). Route #/prompts. Shares the engine, history and favorites in prompt.js / store.js.
import * as store from './store.js';
import * as pb from './prompt.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, id, cls = 'btn') => { const b = el('button', cls, label); b.type = 'button'; if (id) b.id = id; return b; };
const BLANK = { ai: 'grok', aiOther: '', type: '', want: '', context: '', length: 'normal', tone: 'neutral', avoid: '' };

function chips(id, label, map) {
  const g = el('div', 'pb-types pbx-chips'); g.id = id; g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', label);
  for (const [k, v] of Object.entries(map)) { const b = btn(v, null, 'chip'); b.dataset.v = k; b.setAttribute('role', 'radio'); g.appendChild(b); }
  return g;
}
function field(labelText, control) { const w = el('label', 'pbx-field'); w.appendChild(el('span', 'pbx-label', labelText)); w.appendChild(control); return w; }

export async function renderBuilder(ctx) {
  const { view, toast } = ctx;
  const st = await store.getSettings();
  const f = { ...BLANK, ai: st.pbAi || 'grok', aiOther: st.pbAiOther || '' };
  let curId = null, improved = null;
  view.textContent = '';
  const page = el('div', 'pbx'); view.appendChild(page);
  page.appendChild(el('h1', null, 'Prompt builder'));
  const card = el('div', 'pbx-card');
  const aiC = chips('pbx-ai', 'AI used', pb.AIS);
  const other = el('input', 'input pbx-in'); other.id = 'pbx-other'; other.type = 'text'; other.placeholder = 'Which AI? (e.g. ChatGPT)'; other.setAttribute('aria-label', 'Specify other AI');
  const typeC = chips('pbx-type', 'Type', pb.SB_TYPES);
  const auto = el('p', 'pbx-auto'); auto.id = 'pbx-auto'; auto.setAttribute('aria-live', 'polite');
  const want = el('textarea', 'input pbx-ta'); want.id = 'pbx-want'; want.rows = 3; want.placeholder = 'e.g. new spooky sprite art for my match-3 game';
  const context = el('textarea', 'input pbx-ta'); context.id = 'pbx-context'; context.rows = 2; context.placeholder = 'Optional: background, or an example of what you like';
  const lenC = chips('pbx-len', 'Length', pb.LENGTHS), toneC = chips('pbx-tone', 'Tone', pb.TONES);
  const avoid = el('textarea', 'input pbx-ta'); avoid.id = 'pbx-avoid'; avoid.rows = 2; avoid.placeholder = 'e.g. text, watermarks, gradients';
  card.append(field('AI used', aiC), other, field('Type', typeC), auto, field('Result wanted', want), field('Context (optional)', context),
    field('Length', lenC), field('Tone', toneC), field('Avoid (comma or new line)', avoid));
  page.appendChild(card);
  const hint = el('p', 'pbx-hint'); hint.id = 'pbx-hint'; page.appendChild(hint);
  const out = el('textarea', 'pb-text pbx-out'); out.id = 'pbx-out'; out.spellcheck = false; out.setAttribute('aria-label', 'Prompt preview (editable)');
  const prev = el('div', 'pbx-prev'); prev.appendChild(el('h2', null, 'Live preview')); prev.appendChild(out); page.appendChild(prev);
  const acts = el('div', 'pbx-acts');
  const bCopy = btn('Copy', 'pbx-copy', 'btn primary'), bOpen = btn('Open in AI', 'pbx-open', 'btn primary'), bFav = btn('☆ Save to favorites', 'pbx-fav'),
    bShare = btn('Share', 'pbx-share'), bClear = btn('Clear', 'pbx-clear'), bImp = btn('Improve', 'pbx-improve'), bTpl = btn('Templates', 'pbx-templates'), bHist = btn('History', 'pbx-history');
  acts.append(bCopy, bOpen, bFav, bShare, bImp, bTpl, bHist, bClear); page.appendChild(acts);
  bShare.hidden = !navigator.share;
  page.appendChild(el('p', 'pb-note', 'Built on this phone, no internet needed. Improve rewrites what you typed in Result wanted into a structured prompt.'));

  const setChips = (g, v) => g.querySelectorAll('[data-v]').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const guessed = () => pb.guessType([f.want + ' ' + f.context], { research: true });
  const effType = () => f.type || (f.want.trim() ? guessed() : 'image');
  const update = () => {
    const t = effType();
    setChips(aiC, f.ai); setChips(typeC, t); setChips(lenC, f.length); setChips(toneC, f.tone);
    other.hidden = f.ai !== 'other';
    auto.textContent = f.type ? 'Type picked by you' + (f.want.trim() && guessed() !== f.type ? ` (suggested: ${pb.SB_TYPES[guessed()]})` : '') : f.want.trim() ? `Auto-suggested: ${pb.SB_TYPES[t]} (tap a type to choose)` : '';
    hint.textContent = pb.aiHint(f.ai, t); hint.hidden = !hint.textContent;
    bOpen.textContent = f.ai === 'other' ? 'Copy (Other AI)' : 'Open in ' + pb.AIS[f.ai];
    out.value = improved != null ? improved : f.want.trim() ? pb.buildPrompt({ ...f, type: t }) : '';
    bFav.textContent = '☆ Save to favorites';
  };
  const fill = v => { Object.assign(f, BLANK, { ai: f.ai, aiOther: f.aiOther }, v); want.value = f.want; context.value = f.context; avoid.value = f.avoid; other.value = f.aiOther; improved = null; curId = null; update(); };
  const changed = () => { curId = null; improved = null; update(); };
  aiC.onclick = async e => { const b = e.target.closest('[data-v]'); if (!b) return; f.ai = b.dataset.v; await store.saveSettings({ pbAi: f.ai }); if (f.ai === 'other') setTimeout(() => other.focus(), 20); improved != null ? (improved = pb.improve(f.want, { ai: f.ai, type: f.type }), update()) : changed(); };
  typeC.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; f.type = b.dataset.v; changed(); };
  lenC.onclick = e => { const b = e.target.closest('[data-v]'); if (b) { f.length = b.dataset.v; changed(); } };
  toneC.onclick = e => { const b = e.target.closest('[data-v]'); if (b) { f.tone = b.dataset.v; changed(); } };
  want.oninput = () => { f.want = want.value; changed(); };
  context.oninput = () => { f.context = context.value; changed(); };
  avoid.oninput = () => { f.avoid = avoid.value; changed(); };
  other.oninput = () => { f.aiOther = other.value; store.saveSettings({ pbAiOther: other.value }); };
  out.oninput = () => { curId = null; };

  const record = async (fav = false) => {
    const prompt = out.value.trim(); if (!prompt) { toast('Type what you want first'); return null; }
    const id = curId || store.uid(); const old = (await store.listPrompts()).find(x => x.id === id);
    const rec = await store.savePrompt({ ...(old || {}), id, date: old ? old.date : new Date().toISOString(), source: 'builder', ai: f.ai, aiOther: f.aiOther, type: effType(),
      prompt: out.value, form: { ...f, type: effType() }, fav: fav || (old && old.fav), path: [f.want.trim().slice(0, 500)], parentText: '', childText: f.want.trim().slice(0, 500), mapTitle: '' });
    curId = rec.id; return rec;
  };
  bCopy.onclick = async () => { if (await record()) await pb.copy(out.value, toast); };
  bOpen.onclick = () => {
    const txt = out.value; if (!txt.trim()) { toast('Type what you want first'); return; }
    // Copy and open synchronously inside the tap so the browser allows both.
    let ok = false;
    const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.className = 'pb-offscreen'; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { } ta.remove();
    const p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(txt).then(() => true, () => ok) : Promise.resolve(ok);
    const url = pb.AI_URLS[f.ai];
    if (url) window.open(url, '_blank', 'noopener');
    p.then(done => toast(done ? (url ? 'Prompt copied — paste it in' : 'Prompt copied — paste it into ' + (f.aiOther || 'your AI')) : 'Copy blocked: long-press the preview to copy'));
    record();
  };
  bFav.onclick = async () => { if (await record(true)) { bFav.textContent = '★ Saved to favorites'; toast('Saved to favorites ★'); } };
  bShare.onclick = async () => { if (!(await record())) return; try { await navigator.share({ title: 'Prompt', text: out.value }); } catch { } };
  bClear.onclick = () => { fill({}); want.focus(); toast('Cleared'); };
  bImp.onclick = () => {
    if (!f.want.trim()) { toast('Paste a prompt in Result wanted, then tap Improve'); want.focus(); return; }
    improved = pb.improve(f.want, { ai: f.ai, type: f.type }); curId = null; update(); toast('Improved: role, task, details, avoid and format');
  };
  bHist.onclick = () => pb.openHistory(ctx, { onReopen: it => { fill(it.form || {}); if (it.prompt) { out.value = it.prompt; } curId = it.id; } });
  bTpl.onclick = () => openTemplates(ctx, f, effType, v => { fill(v); toast('Loaded “' + v.name + '”'); });

  if (pb.pending.load) { const it = pb.pending.load; pb.pending.load = null; fill(it.form || {}); out.value = it.prompt; curId = it.id; } else update();
}

async function openTemplates(ctx, f, effType, onLoad) {
  const o = ctx.modal('', 'pb-overlay');
  const sh = el('div', 'sheet pb-sheet pb-histsheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'pbt-h');
  const head = el('header'); const h = el('h2', null, 'Templates'); h.id = 'pbt-h'; head.appendChild(h);
  const x = btn('✕', 'pbt-x', 'iconbtn pb-iconx'); x.setAttribute('aria-label', 'Close'); head.appendChild(x); sh.appendChild(head);
  const body = el('div', 'body'); body.id = 'pbt-list'; sh.appendChild(body);
  const foot = el('footer', 'pb-foot'); const bSave = btn('Save current form as template', 'pbt-save', 'btn primary'); foot.appendChild(bSave); sh.appendChild(foot); o.appendChild(sh);
  const close = () => { o.remove(); removeEventListener('keydown', onEsc, true); };
  const onEsc = ev => { if (ev.key === 'Escape' && o.isConnected && o === o.parentNode.lastElementChild) { ev.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  x.onclick = close; o.addEventListener('click', ev => { if (ev.target === o) close(); });
  const draw = async () => {
    const mine = await store.listTemplates(); body.textContent = '';
    const sec = (title, list) => {
      body.appendChild(el('h2', null, title));
      if (!list.length) body.appendChild(el('p', 'pb-note', 'None yet. Fill in the form, then tap “Save current form as template”.'));
      for (const t of list) {
        const c = el('div', 'card pbh-item pbt-item'); c.dataset.tid = t.id;
        const top = el('div', 'pbh-top'); top.appendChild(el('span', 'pbh-type t-' + t.type, pb.SB_TYPES[t.type] || 'Auto'));
        top.appendChild(el('span', 'pbh-date', t.ai === 'other' ? (t.aiOther || 'Other') : pb.AIS[t.ai] || '')); c.appendChild(top);
        c.appendChild(el('div', 'pbh-chain', t.name)); c.appendChild(el('div', 'pbh-prev', t.want));
        const acts = el('div', 'acts'); const bl = btn('Load'); bl.dataset.t = 'load'; acts.appendChild(bl);
        if (!t.starter) { const bd = btn('Delete', null, 'btn danger'); bd.dataset.t = 'del'; acts.appendChild(bd); }
        c.appendChild(acts); body.appendChild(c);
      }
    };
    sec('My templates', mine); sec('Starter templates', pb.STARTERS);
  };
  body.onclick = async ev => {
    const b = ev.target.closest('[data-t]'); if (!b) return; const id = b.closest('[data-tid]').dataset.tid;
    const t = [...pb.STARTERS, ...(await store.listTemplates())].find(z => z.id === id); if (!t) return;
    if (b.dataset.t === 'load') { close(); onLoad(t); }
    if (b.dataset.t === 'del' && await ctx.confirmDialog('Delete template?', `“${t.name}” will be removed.`, 'Delete', true)) { await store.deleteTemplate(id); ctx.toast('Template deleted'); draw(); }
  };
  bSave.onclick = async () => {
    if (!f.want.trim()) { ctx.toast('Fill in Result wanted first'); return; }
    const name = await ctx.promptDialog('Template name', f.want.trim().slice(0, 40), 'Save', 'Template name'); if (!name) return;
    await store.saveTemplate({ ...f, type: f.type, name }); ctx.toast('Template saved'); draw();
  };
  await draw();
  return o;
}
