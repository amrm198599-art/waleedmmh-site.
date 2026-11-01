// قسم «يوتيوبر»: استخراج اللقطات واختيار الأوضح وتحرير الصورة المصغرة كلها تجري في متصفحك.
// ملف الفيديو لا يُرفع؛ يُرسل للخادم فقط حتى 5 لقطات صغيرة مع النص المكتوب.
(function (root) {
  'use strict';
  const W = 1280, H = 720;

  // ───────── دوال نقية (قابلة للاختبار في Node) ─────────
  // تقييم لقطة من بيانات RGBA: حدّة (تباين لابلاس) + تباين + تنوّع ألوان، مع عقوبة للقطات المظلمة أو المحروقة.
  function scoreFrame(px, w, h) {
    const n = w * h, g = new Float32Array(n);
    let sum = 0, sr = 0, sy = 0, srr = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], y = 0.299 * r + 0.587 * gg + 0.114 * b;
      g[i] = y; sum += y;
      const rg = r - gg, yb = 0.5 * (r + gg) - b; sr += rg; sy += yb; srr += rg * rg; syy += yb * yb;
    }
    const mean = sum / n; let v = 0;
    for (let i = 0; i < n; i++) v += (g[i] - mean) * (g[i] - mean);
    const std = Math.sqrt(v / n);
    let lap = 0, c = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; lap += l * l; c++;
    }
    lap = c ? lap / c : 0;
    const mrg = sr / n, myb = sy / n, color = Math.sqrt(Math.max(0, srr / n - mrg * mrg) + Math.max(0, syy / n - myb * myb)) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
    const bright = mean < 45 ? mean / 45 : mean > 215 ? Math.max(0, (255 - mean) / 40) : 1;
    return (0.45 * Math.min(1, lap / 400) + 0.25 * Math.min(1, std / 64) + 0.3 * Math.min(1, color / 60)) * bright;
  }
  // يختار أفضل n لقطات بشرط ألا تتقارب في الزمن (فلا تتكرر المشاهد المتشابهة).
  function pickFrames(list, duration, n) {
    const gap = duration > 0 ? duration / 16 : 0, out = [];
    [...list].sort((a, b) => b.score - a.score).forEach(f => { if (out.length < n && out.every(o => Math.abs(o.t - f.t) >= gap)) out.push(f); });
    return out;
  }
  function wrapLines(measure, text, max) {
    const words = text.split(/\s+/).filter(Boolean), lines = []; let cur = '';
    words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (cur && measure(t) > max) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }
  const api = { scoreFrame, pickFrames, wrapLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.YT = api;
  if (typeof document === 'undefined' || !document.getElementById('yt-root')) return;

  // ───────── الواجهة ─────────
  const $ = id => document.getElementById(id);
  let I = {}; try { I = JSON.parse($('yt-i18n').textContent); } catch (e) { }
  const T = k => I[k] || k;
  const st = { file: null, frames: [], sel: 0, meta: null, busy: false, res: null };
  const say = (m, bad) => { const s = $('yt-status'); s.textContent = m || ''; s.className = m ? (bad ? 'warn' : 'note') : ''; };
  const ERR = { upstream: 'yt_m_upstream', forbidden: 'yt_m_forbidden', no_key: 'yt_m_no_key', limit: 'yt_m_limit', busy: 'yt_m_busy_srv', timeout: 'yt_m_timeout', bad_url: 'yt_m_bad_url', not_found: 'yt_m_not_found' };

  async function call(path, body) {
    let r, j = null;
    try { r = await fetch('/api/yt/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { throw fail('yt_m_err', 'network'); }
    try { j = await r.json(); } catch (e) { throw fail('yt_m_err', 'HTTP ' + r.status); }
    if (!r.ok) throw fail(ERR[j && j.code] || 'yt_m_err', 'HTTP ' + r.status + (j && j.code ? ' ' + j.code : '') + (j && j.detail ? ' ' + j.detail : ''));
    return j;
  }
  function fail(key, info) { const e = new Error(key); e.info = info; return e; }
  const errText = e => (T(e.message) === e.message ? T('yt_m_err') : T(e.message)) + (e.info && !/^yt_m_(limit|busy_srv|no_key|bad_url|not_found|timeout)$/.test(e.message) ? ' [' + e.info + ']' : '');
  function copyText(text, btn) {
    const done = () => { const o = btn.dataset.o || btn.textContent; btn.dataset.o = o; btn.textContent = T('yt_copied'); setTimeout(() => { btn.textContent = o; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => legacy());
    else legacy();
    function legacy() { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { } t.remove(); }
  }
  function save(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }

  // ───────── اللقطات ─────────
  function drawCover(ctx, src, sw, sh) {
    const k = Math.max(W / sw, H / sh), dw = sw * k, dh = sh * k; ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  // يحوّل مصدراً (فيديو/صورة) إلى لقطة: نسخة كاملة 1280×720 للمحرر، ونسخة صغيرة 640 تُرسل للتحليل، ودرجة.
  function makeFrame(src, sw, sh, t) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); drawCover(x, src, sw, sh);
    const s = document.createElement('canvas'); s.width = 160; s.height = 90; const sx = s.getContext('2d', { willReadFrequently: true }); sx.drawImage(c, 0, 0, 160, 90);
    const m = document.createElement('canvas'); m.width = 640; m.height = 360; m.getContext('2d').drawImage(c, 0, 0, 640, 360);
    return { t, score: scoreFrame(sx.getImageData(0, 0, 160, 90).data, 160, 90), url: c.toDataURL('image/jpeg', 0.9), small: m.toDataURL('image/jpeg', 0.72) };
  }
  function loadVideo(file) {
    return new Promise((res, rej) => {
      const v = document.createElement('video'), u = URL.createObjectURL(file), to = setTimeout(() => rej(new Error('yt_m_video_err')), 25000);
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.onloadedmetadata = () => { clearTimeout(to); res({ v, u }); };
      v.onerror = () => { clearTimeout(to); rej(new Error('yt_m_video_err')); };
      v.src = u;
    });
  }
  const seek = (v, t) => new Promise(res => { let d = false; const f = () => { if (!d) { d = true; v.removeEventListener('seeked', f); res(); } }; v.addEventListener('seeked', f); setTimeout(f, 4000); v.currentTime = t; });
  async function extract(file) {
    const { v, u } = await loadVideo(file);
    try {
      const d = v.duration; if (!isFinite(d) || d <= 0 || !v.videoWidth) throw new Error('yt_m_video_err');
      const N = d < 6 ? 6 : 12, all = [];
      for (let i = 0; i < N; i++) {
        const t = d * (0.05 + 0.9 * (i + 0.5) / N); await seek(v, t);
        say(T('yt_m_busy_frames') + ' ' + (i + 1) + '/' + N); all.push(makeFrame(v, v.videoWidth, v.videoHeight, t));
      }
      st.frames = pickFrames(all, d, 6);
    } finally { URL.revokeObjectURL(u); v.removeAttribute('src'); v.load(); }
  }
  const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('yt_m_err')); i.src = url; });
  async function framesFromImages(urls) {
    const out = []; for (let i = 0; i < urls.length; i++) { const im = await loadImg(urls[i]); out.push(makeFrame(im, im.naturalWidth, im.naturalHeight, i)); }
    st.frames = pickFrames(out, 0, 6);
  }

  // ───────── النتائج ─────────
  const lenNote = (el, id, max) => { const n = $(id); if (n) n.textContent = el.value.length + (max ? '/' + max : '') + ' ' + T('yt_chars'); };
  function bindCounters() {
    [['yt-title', 'yt-title-n', 100], ['yt-desc', 'yt-desc-n', 5000], ['yt-tags', 'yt-tags-n', 500]].forEach(([a, b, m]) => { const el = $(a); el.addEventListener('input', () => lenNote(el, b, m)); lenNote(el, b, m); });
  }
  function showResults(r) {
    st.res = r; $('yt-results').hidden = false;
    $('yt-title').value = r.title || ''; $('yt-desc').value = r.description || ''; $('yt-tags').value = (r.tags || []).join(', '); $('yt-hash').value = (r.hashtags || []).join(' ');
    bindCounters();
    const alt = $('yt-alts'); alt.replaceChildren();
    (r.alt_titles || []).forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.onclick = () => { $('yt-title').value = t; lenNote($('yt-title'), 'yt-title-n', 100); updatePreviews(); }; alt.append(b); });
    const th = r.thumbnail || {}; const opts = $('yt-textopts'); opts.replaceChildren();
    (th.text_options || []).forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.onclick = () => { $('yt-text').value = t; render(); }; opts.append(b); });
    if (th.reason) $('yt-reason').textContent = th.reason;
    if (Number.isInteger(th.best_frame) && th.best_frame >= 0 && th.best_frame < Math.min(5, st.frames.length)) { const f = st.frames.splice(th.best_frame, 1)[0]; st.frames.unshift(f); }
    st.sel = 0; renderFrames(); select(0);
  }
  function allText() {
    return [[T('yt_title_f'), $('yt-title').value], [T('yt_desc_f'), $('yt-desc').value], [T('yt_tags_f'), $('yt-tags').value], [T('yt_hash_f'), $('yt-hash').value]].map(([k, v]) => k + ':\n' + v.trim()).join('\n\n') + '\n';
  }

  // ───────── الصورة المصغرة ─────────
  function renderFrames() {
    const box = $('yt-frames'); box.replaceChildren();
    st.frames.forEach((f, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ytf' + (i === st.sel ? ' on' : ''); const im = document.createElement('img'); im.src = f.small; im.alt = ''; b.append(im);
      if (i === 0) { const s = document.createElement('span'); s.textContent = T('yt_best'); b.append(s); }
      b.onclick = () => select(i); box.append(b);
    });
  }
  async function select(i) {
    st.sel = i; const f = st.frames[i]; if (!f) return; if (!f.img) f.img = await loadImg(f.url);
    renderFrames(); $('yt-editor').hidden = false; render();
  }
  function render() {
    const f = st.frames[st.sel]; if (!f || !f.img) return;
    const c = $('yt-canvas'), x = c.getContext('2d'); x.clearRect(0, 0, W, H);
    const flt = 'filter' in x; if (flt) x.filter = 'brightness(' + $('yt-b').value + '%) contrast(' + $('yt-c').value + '%) saturate(' + $('yt-s').value + '%)';
    x.drawImage(f.img, 0, 0, W, H); if (flt) x.filter = 'none';
    const txt = $('yt-text').value.trim(); if (txt) drawText(x, txt);
    updatePreviews();
  }
  function drawText(x, txt) {
    const size = +$('yt-size').value, pos = $('yt-pos').value, rtl = /[\u0590-\u08FF]/.test(txt);
    x.font = '900 ' + size + 'px Tahoma, "Segoe UI", "Noto Sans Arabic", Arial, sans-serif'; x.direction = rtl ? 'rtl' : 'ltr'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = wrapLines(s => x.measureText(s).width, txt, W * 0.88).slice(0, 4), lh = size * 1.25, hh = lines.length * lh, pad = 36;
    const top = pos === 'top' ? pad : pos === 'bottom' ? H - pad - hh : (H - hh) / 2;
    if ($('yt-shade').checked) {
      const y0 = Math.max(0, top - 30), y1 = Math.min(H, top + hh + 30), g = x.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.25, 'rgba(0,0,0,.55)'); g.addColorStop(0.75, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, y0, W, y1 - y0);
    }
    x.lineJoin = 'round'; x.lineWidth = Math.max(6, size / 7); x.strokeStyle = '#000'; x.fillStyle = $('yt-color').value;
    lines.forEach((l, i) => { const y = top + lh * i + lh / 2; x.strokeText(l, W / 2, y); x.fillText(l, W / 2, y); });
  }
  function updatePreviews() {
    const c = $('yt-canvas'), t = $('yt-title').value.trim() || '…';
    [['yt-pm', 360], ['yt-pd', 300]].forEach(([id, w]) => { const p = $(id); p.width = w * 2; p.height = Math.round(w * 2 * 9 / 16); p.getContext('2d').drawImage(c, 0, 0, p.width, p.height); });
    document.querySelectorAll('.yt-ptitle').forEach(e => { e.textContent = t; });
  }
  function downloadThumb() {
    const c = $('yt-canvas'); let q = 0.92;
    const go = () => c.toBlob(b => { if (b && b.size > 2e6 && q > 0.5) { q -= 0.12; go(); } else if (b) save('thumbnail.jpg', b); }, 'image/jpeg', q); go();
  }

  // ───────── التحليل ─────────
  async function analyze() {
    if (st.busy) return; if (!st.file && !st.frames.length) return say(T('yt_m_need_src'), true);
    st.busy = true; $('yt-analyze').disabled = true; $('yt-results').hidden = true;
    try {
      if (st.file && !st.frames.length) { say(T('yt_m_busy_frames')); await extract(st.file); }
      say(T('yt_m_busy_ai'));
      const r = await call('analyze', { lang: $('yt-lang').value, note: $('yt-note').value, transcript: $('yt-sub').value, meta: st.meta || undefined, frames: st.frames.slice(0, 5).map(f => f.small) });
      showResults(r); say(T('yt_m_done'));
    } catch (e) { say(errText(e), true); }
    finally { st.busy = false; $('yt-analyze').disabled = false; }
  }
  async function fetchLink() {
    const url = $('yt-url').value.trim(); if (!url) return say(T('yt_m_need_src'), true);
    say(T('yt_m_busy_link')); $('yt-fetch').disabled = true;
    try {
      const r = await call('link', { url }); st.file = null; st.meta = { title: r.title, author: r.author, description: r.description, tags: r.tags };
      $('yt-file-name').textContent = T('yt_file_none'); await framesFromImages(r.images);
      if (!$('yt-note').value.trim() && r.title) $('yt-note').value = r.title;
      say(T(r.hasMeta ? 'yt_m_link_ok' : 'yt_m_link_nometa'));
    } catch (e) { say(errText(e), true); }
    finally { $('yt-fetch').disabled = false; }
  }
  function pickFile(f) {
    if (!f) return;
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) return say(T('yt_m_video_err'), true);
    st.file = f; st.frames = []; st.meta = null; $('yt-results').hidden = true; $('yt-editor').hidden = true; $('yt-frames').replaceChildren();
    $('yt-file-name').textContent = f.name; say(T('yt_m_file_ok') + ' ' + f.name);
  }
  async function write(kind) {
    const topic = $('yt-topic').value.trim(); if (!topic) return say(T('yt_m_need_topic'), true);
    const btns = [$('yt-ideas'), $('yt-script')]; btns.forEach(b => { b.disabled = true; }); say(T('yt_m_busy_ai'));
    try { const r = await call('write', { kind, topic, lang: $('yt-lang').value, minutes: +$('yt-min').value || 5 }); $('yt-out').value = r.text; $('yt-out-box').hidden = false; say(''); }
    catch (e) { say(errText(e), true); }
    finally { btns.forEach(b => { b.disabled = false; }); }
  }

  $('yt-upload').onclick = () => $('yt-file').click();
  $('yt-file').onchange = e => { pickFile(e.target.files[0]); e.target.value = ''; };
  $('yt-fetch').onclick = fetchLink; $('yt-analyze').onclick = analyze;
  $('yt-ideas').onclick = () => write('ideas'); $('yt-script').onclick = () => write('script');
  ['yt-text', 'yt-size', 'yt-pos', 'yt-color', 'yt-shade', 'yt-b', 'yt-c', 'yt-s'].forEach(id => { $(id).addEventListener('input', render); });
  $('yt-title').addEventListener('input', updatePreviews);
  document.querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => copyText($(b.dataset.copy).value, b); });
  $('yt-copyall').onclick = e => copyText(allText(), e.currentTarget);
  $('yt-txt').onclick = () => save('youtube-seo.txt', new Blob(['\ufeff' + allText()], { type: 'text/plain;charset=utf-8' }));
  $('yt-dl').onclick = downloadThumb;
  $('yt-out-dl').onclick = () => save('script.txt', new Blob(['\ufeff' + $('yt-out').value], { type: 'text/plain;charset=utf-8' }));
  if (!('filter' in document.createElement('canvas').getContext('2d'))) document.querySelectorAll('.yt-flt').forEach(e => { e.hidden = true; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
