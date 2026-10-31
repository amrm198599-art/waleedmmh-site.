// واجهة الموقع والإدارة (Netlify Function واحدة على /api/*).
// البيانات الدائمة للمحتوى = ملفات JSON في GitHub (فيعيد Netlify البناء)، والتقييمات والإحصائيات = Netlify Blobs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import shared from '../shared.js';

const { validateApp, validateSite, ID_RE } = shared;
const env = k => process.env[k] || '';
const LOCAL = () => env('LOCAL_DIR'); // للاختبار المحلي فقط: يستبدل GitHub وBlobs بملفات

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (s, m) => { const e = new Error(m); e.status = s; throw e; };
const day = (d = new Date()) => d.toISOString().slice(0, 10);

// ---------- التخزين (Blobs) ----------
async function store(name) {
  if (LOCAL()) {
    const dir = path.join(LOCAL(), 'blobs', name); fs.mkdirSync(dir, { recursive: true });
    const f = k => path.join(dir, encodeURIComponent(k));
    return {
      get: async k => fs.existsSync(f(k)) ? JSON.parse(fs.readFileSync(f(k), 'utf8')) : null,
      set: async (k, v) => fs.writeFileSync(f(k), JSON.stringify(v)),
      del: async k => fs.rmSync(f(k), { force: true }),
      list: async pre => fs.readdirSync(dir).map(decodeURIComponent).filter(k => k.startsWith(pre || ''))
    };
  }
  const { getStore } = await import('@netlify/blobs');
  const s = getStore(name);
  return {
    get: k => s.get(k, { type: 'json' }), set: (k, v) => s.setJSON(k, v), del: k => s.delete(k),
    list: async pre => { const r = await s.list({ prefix: pre || '' }); return r.blobs.map(b => b.key); }
  };
}

// ---------- مستودع الملفات (GitHub) ----------
const repo = {
  async gh(method, url, body) {
    if (!env('GITHUB_TOKEN') || !env('GITHUB_REPO')) fail(503, 'لم يُضبط GITHUB_TOKEN وGITHUB_REPO في إعدادات Netlify.');
    const r = await fetch('https://api.github.com/repos/' + env('GITHUB_REPO') + url, { method, headers: { authorization: 'Bearer ' + env('GITHUB_TOKEN'), accept: 'application/vnd.github+json', 'user-agent': 'waleedmmh-admin', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { }
    if (!r.ok) { const m = { 401: 'GITHUB_TOKEN غير صالح.', 403: 'GITHUB_TOKEN بلا صلاحية كتابة على المستودع (Contents: Read and write).', 404: 'الملف أو المستودع غير موجود (راجع GITHUB_REPO).', 409: 'تغيّر الملف في مكان آخر. أعد تحميل القائمة ثم عدّل مجدداً.', 422: 'الملف موجود مسبقاً أو بصمته قديمة. أعد تحميل القائمة.' }[r.status]; fail(r.status === 409 || r.status === 422 ? r.status : 502, m || ('خطأ من GitHub: ' + ((j && j.message) || r.status))); }
    return j;
  },
  br: () => env('GITHUB_BRANCH') || 'main',
  async list() {
    if (LOCAL()) return fs.readdirSync(path.join(LOCAL(), 'repo'));
    return (await this.gh('GET', '/contents/?ref=' + this.br())).filter(x => x.type === 'file').map(x => x.name);
  },
  async read(f) {
    if (LOCAL()) { const p = path.join(LOCAL(), 'repo', f); if (!fs.existsSync(p)) return null; const b = fs.readFileSync(p); return { text: b.toString('utf8'), sha: crypto.createHash('sha1').update(b).digest('hex') }; }
    try { const j = await this.gh('GET', '/contents/' + encodeURIComponent(f).replace(/%2F/g, '/') + '?ref=' + this.br()); return { text: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha }; }
    catch (e) { if (e.status === 502 && /غير موجود/.test(e.message) || /غير موجود/.test(e.message)) return null; throw e; }
  },
  async write(f, buf, msg, sha) {
    buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (LOCAL()) {
      const p = path.join(LOCAL(), 'repo', f), ex = fs.existsSync(p) ? crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex') : null;
      if (ex && ex !== sha) fail(sha ? 409 : 422, 'تعارض أو ملف موجود');
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return;
    }
    const body = { message: msg, content: buf.toString('base64'), branch: this.br(), committer: { name: 'WALEEDMMH Admin', email: 'admin@users.noreply.github.com' } };
    if (sha) body.sha = sha;
    await this.gh('PUT', '/contents/' + f.split('/').map(encodeURIComponent).join('/'), body);
  },
  async del(f, sha, msg) {
    if (LOCAL()) { fs.rmSync(path.join(LOCAL(), 'repo', f), { force: true }); return; }
    await this.gh('DELETE', '/contents/' + f.split('/').map(encodeURIComponent).join('/'), { message: msg, sha, branch: this.br() });
  }
};

// ---------- الأمان ----------
const secret = () => { const s = env('SESSION_SECRET'); if (s.length < 32) fail(503, 'لم يُضبط SESSION_SECRET (32 حرفاً على الأقل) في إعدادات Netlify.'); return s; };
const hmac = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const mint = () => { const p = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600e3 })).toString('base64url'); return p + '.' + hmac(p); };
function auth(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)\.(.+)$/);
  if (!m) fail(401, 'غير مصرّح.');
  const p = m[1];
  if (!eq(hmac(p), m[2])) fail(401, 'غير مصرّح.');
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { fail(401, 'غير مصرّح.'); }
  if (!o.exp || o.exp < Date.now()) fail(401, 'انتهت الجلسة، سجّل الدخول مجدداً.');
}
const ip = req => (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
// بصمة أحادية الاتجاه تتغير يومياً، لعدّ المحاولات فقط
const ipHash = req => crypto.createHash('sha256').update((env('SESSION_SECRET') || 'x') + day() + ip(req)).digest('hex').slice(0, 16);
async function tooMany(bucket, limit) {
  const s = await store('ratelimit'), v = (await s.get(bucket)) || { n: 0 };
  v.n++; await s.set(bucket, v); return v.n > limit;
}
async function body(req, max = 100e3) {
  const len = +(req.headers.get('content-length') || 0);
  if (len > max) fail(413, 'الطلب كبير جداً.');
  const t = await req.text();
  if (t.length > max) fail(413, 'الطلب كبير جداً.');
  try { return JSON.parse(t || '{}'); } catch { fail(400, 'JSON غير صالح.'); }
}
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200e\u200f\u202a-\u202e]/g, '').trim().slice(0, n);
const siteCodes = async () => { const s = await repo.read('site.json'); return s ? (JSON.parse(s.text).languages || []).map(l => l.code) : []; };

// ---------- المسارات العامة ----------
async function track(req) {
  if (/bot|crawl|spider|preview|headless|monitor/i.test(req.headers.get('user-agent') || '')) return new Response(null, { status: 204 });
  const b = await body(req, 2000), s = await store('stats'), key = day() + '/' + Math.floor(Math.random() * 4);
  const v = (await s.get(key)) || { v: {}, d: {} };
  if (b.t === 'v') {
    const pth = String(b.path || '');
    if (!/^\/[A-Za-z0-9_\-\/]{0,120}$/.test(pth) || /^\/(admin|api)(\/|$)/.test(pth)) return new Response(null, { status: 204 });
    if (v.v[pth] || Object.keys(v.v).length < 300) v.v[pth] = (v.v[pth] || 0) + 1;
  } else if (b.t === 'd') {
    if (!ID_RE.test(b.app || '') || !['play', 'apk'].includes(b.kind)) return new Response(null, { status: 204 });
    const k = b.app + ':' + b.kind;
    if (v.d[k] || Object.keys(v.d).length < 100) v.d[k] = (v.d[k] || 0) + 1;
  } else return new Response(null, { status: 204 });
  await s.set(key, v);
  return new Response(null, { status: 204 });
}

async function reviewsOf(app) {
  const s = await store('reviews'), keys = (await s.list(app + '/')).slice(-300);
  return (await Promise.all(keys.map(k => s.get(k)))).filter(Boolean);
}
async function getReviews(u) {
  const app = u.searchParams.get('app') || '';
  if (!ID_RE.test(app)) fail(400, 'تطبيق غير صالح.');
  const ok = (await reviewsOf(app)).filter(r => r.status === 'approved').sort((a, b) => b.date.localeCompare(a.date));
  const avg = ok.length ? ok.reduce((n, r) => n + r.rating, 0) / ok.length : 0;
  return json({ avg, count: ok.length, reviews: ok.slice(0, 50).map(r => ({ name: r.name, rating: r.rating, text: r.text, date: r.date, reply: r.reply || '' })) });
}
async function postReview(req) {
  const b = await body(req, 5000);
  if (b.website) return json({ ok: true }); // فخ الروبوتات
  if (!ID_RE.test(b.app || '')) fail(400, 'تطبيق غير صالح.');
  const rating = Number(b.rating), text = clean(b.text, 1000), name = clean(b.name, 60);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'تقييم غير صالح.');
  if (text.length < 10) fail(400, 'النص قصير.');
  if (!(Number(b.elapsed) >= 3000)) fail(400, 'أُرسل بسرعة غير طبيعية.');
  const a = await repo.read(b.app + '.app.json');
  if (!a || !['published', 'testing'].includes(JSON.parse(a.text).status)) fail(400, 'لا يقبل هذا التطبيق تقييمات.');
  if (await tooMany('rv:' + day() + ':' + ipHash(req), 3)) fail(429, 'كثير.');
  const id = Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  await (await store('reviews')).set(b.app + '/' + id, { id, app: b.app, rating, name, text, date: new Date().toISOString(), status: 'pending', reply: '' });
  return json({ ok: true, pending: true });
}

// ---------- مسارات الإدارة ----------
async function login(req) {
  secret();
  if (!env('ADMIN_PASSWORD')) fail(503, 'لم يُضبط ADMIN_PASSWORD في إعدادات Netlify.');
  if (await tooMany('login:' + new Date().toISOString().slice(0, 13) + ':' + ipHash(req), 8)) fail(429, 'محاولات كثيرة. انتظر ساعة.');
  const b = await body(req, 1000);
  if (!eq(b.password || '', env('ADMIN_PASSWORD'))) { await new Promise(r => setTimeout(r, 500)); fail(401, 'كلمة المرور غير صحيحة.'); }
  return json({ token: mint() });
}
const writeJson = (f, o, msg, sha) => repo.write(f, JSON.stringify(o, null, 2) + '\n', msg, sha);

async function adminApps() {
  const names = (await repo.list()).filter(f => f.endsWith('.app.json'));
  const apps = await Promise.all(names.map(async f => { const r = await repo.read(f); return { file: f, sha: r.sha, data: JSON.parse(r.text) }; }));
  return json({ apps });
}
async function putApp(req, id) {
  if (!ID_RE.test(id)) fail(400, 'معرّف غير صالح.');
  const b = await body(req, 200e3), a = b.app;
  if (!a || a.id !== id) fail(400, 'المعرّف في البيانات لا يطابق الرابط.');
  const errs = validateApp(a, id + '.app.json', await siteCodes());
  if (errs.length) return json({ error: 'بيانات غير صالحة', details: errs }, 400);
  await writeJson(id + '.app.json', a, (b.sha ? 'admin: تحديث ' : 'admin: إضافة ') + id, b.sha || undefined);
  return json({ ok: true });
}
async function delApp(req, id) {
  if (!ID_RE.test(id)) fail(400, 'معرّف غير صالح.');
  const r = await repo.read(id + '.app.json'); if (!r) fail(404, 'غير موجود.');
  await repo.del(id + '.app.json', r.sha, 'admin: حذف ' + id);
  return json({ ok: true });
}
async function getSite() { const r = await repo.read('site.json'); return json({ site: JSON.parse(r.text), sha: r.sha }); }
async function putSite(req) {
  const b = await body(req, 50e3), errs = validateSite(b.site || {});
  if (errs.length) return json({ error: 'بيانات غير صالحة', details: errs }, 400);
  await writeJson('site.json', b.site, 'admin: تحديث بيانات الموقع', b.sha);
  return json({ ok: true });
}
const MAGIC = { png: b => b.slice(0, 4).toString('hex') === '89504e47', jpg: b => b.slice(0, 3).toString('hex') === 'ffd8ff', webp: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' };
async function upload(req) {
  const b = await body(req, 3.2e6), m = String(b.name || '').toLowerCase().match(/^([a-z0-9][a-z0-9._-]{0,60})\.(png|jpe?g|webp)$/);
  if (!m) fail(400, 'اسم الملف: أحرف إنجليزية وأرقام وشرطة فقط، بامتداد png أو jpg أو webp.');
  const buf = Buffer.from(String(b.data || ''), 'base64');
  if (buf.length < 100 || buf.length > 2e6) fail(400, 'حجم الصورة يجب أن يكون أقل من 2MB.');
  if (!MAGIC[m[2] === 'jpeg' ? 'jpg' : m[2]](buf)) fail(400, 'محتوى الملف لا يطابق امتداده.');
  const f = 'media/' + m[1] + '.' + m[2], ex = await repo.read(f);
  await repo.write(f, buf, 'admin: رفع ' + f, ex ? ex.sha : undefined);
  return json({ url: '/' + f });
}
async function stats(u) {
  const days = Math.min(60, Math.max(1, +u.searchParams.get('days') || 30)), s = await store('stats');
  const out = { days: [], pages: {}, downloads: {}, views: 0, dl: 0 };
  const list = [...Array(days)].map((_, i) => day(new Date(Date.now() - i * 864e5))).reverse();
  await Promise.all(list.map(async d => {
    const keys = await s.list(d + '/'), vals = (await Promise.all(keys.map(k => s.get(k)))).filter(Boolean);
    const row = { day: d, views: 0, downloads: 0 };
    vals.forEach(v => { for (const k in v.v) { row.views += v.v[k]; out.pages[k] = (out.pages[k] || 0) + v.v[k]; } for (const k in v.d) { row.downloads += v.d[k]; out.downloads[k] = (out.downloads[k] || 0) + v.d[k]; } });
    out.days.push(row);
  }));
  out.days.sort((a, b) => a.day.localeCompare(b.day));
  out.views = out.days.reduce((n, r) => n + r.views, 0); out.dl = out.days.reduce((n, r) => n + r.downloads, 0);
  return json(out);
}
async function adminReviews(u) {
  const st = u.searchParams.get('status') || 'pending', s = await store('reviews');
  const all = (await Promise.all((await s.list('')).map(k => s.get(k)))).filter(Boolean);
  return json({ counts: { pending: all.filter(r => r.status === 'pending').length, approved: all.filter(r => r.status === 'approved').length, rejected: all.filter(r => r.status === 'rejected').length }, reviews: all.filter(r => st === 'all' || r.status === st).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200) });
}
async function patchReview(req, app, id) {
  if (!ID_RE.test(app) || !/^[0-9a-z-]+$/.test(id)) fail(400, 'معرّف غير صالح.');
  const b = await body(req, 3000), s = await store('reviews'), r = await s.get(app + '/' + id);
  if (!r) fail(404, 'غير موجود.');
  if (b.status) { if (!['approved', 'rejected', 'pending'].includes(b.status)) fail(400, 'حالة غير صالحة.'); r.status = b.status; }
  if (b.reply != null) r.reply = clean(b.reply, 500);
  await s.set(app + '/' + id, r); return json({ ok: true });
}
async function delReview(app, id) {
  if (!ID_RE.test(app) || !/^[0-9a-z-]+$/.test(id)) fail(400, 'معرّف غير صالح.');
  await (await store('reviews')).del(app + '/' + id); return json({ ok: true });
}
async function health() {
  const c = { admin_password: env('ADMIN_PASSWORD').length >= 12, session_secret: env('SESSION_SECRET').length >= 32, github_token: !!env('GITHUB_TOKEN'), github_repo: !!env('GITHUB_REPO'), repo_access: false, blobs: false };
  try { c.repo_access = !!(await repo.read('site.json')); } catch { }
  try { await (await store('stats')).list(''); c.blobs = true; } catch { }
  return json(c);
}

export default async req => {
  try {
    const u = new URL(req.url), r = u.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent), m = req.method;
    if (r[0] === 'track' && m === 'POST') return await track(req);
    if (r[0] === 'reviews' && m === 'GET') return await getReviews(u);
    if (r[0] === 'reviews' && m === 'POST') return await postReview(req);
    if (r[0] === 'admin') {
      if (r[1] === 'login' && m === 'POST') return await login(req);
      auth(req);
      if (r[1] === 'health') return await health();
      if (r[1] === 'apps' && !r[2] && m === 'GET') return await adminApps();
      if (r[1] === 'apps' && r[2] && m === 'PUT') return await putApp(req, r[2]);
      if (r[1] === 'apps' && r[2] && m === 'DELETE') return await delApp(req, r[2]);
      if (r[1] === 'site' && m === 'GET') return await getSite();
      if (r[1] === 'site' && m === 'PUT') return await putSite(req);
      if (r[1] === 'upload' && m === 'POST') return await upload(req);
      if (r[1] === 'stats' && m === 'GET') return await stats(u);
      if (r[1] === 'reviews' && !r[2] && m === 'GET') return await adminReviews(u);
      if (r[1] === 'reviews' && r[3] && m === 'PATCH') return await patchReview(req, r[2], r[3]);
      if (r[1] === 'reviews' && r[3] && m === 'DELETE') return await delReview(r[2], r[3]);
    }
    return json({ error: 'غير موجود.' }, 404);
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'خطأ غير متوقع في الخادم.' }, 500);
  }
};
export const config = { path: '/api/*' };
