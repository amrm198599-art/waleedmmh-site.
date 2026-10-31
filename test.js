// اختبارات آلية: node --test  (أو npm test). تعمل على نسخة مؤقتة، بلا شبكة.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), p = require('path'), { execFileSync } = require('child_process');
const R = __dirname;
const sandbox = (mut) => {
  const d = fs.mkdtempSync(p.join(os.tmpdir(), 'site-'));
  fs.readdirSync(R).filter(f => /\.(js|json|css|svg|html|mjs)$/.test(f) && f !== 'package-lock.json').forEach(f => fs.copyFileSync(p.join(R, f), p.join(d, f)));
  if (mut) mut(d);
  return d;
};
const build = (d, env = { URL: 'https://example.test' }) => { try { const e = { ...process.env }; delete e.URL; delete e.SITE_URL; execFileSync('node', ['build.js'], { cwd: d, env: { ...e, ...env }, stdio: 'pipe' }); return { ok: true }; } catch (e) { return { ok: false, err: String(e.stderr) }; } };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(p.join(d, e.name)) : [p.join(d, e.name)]);
const edit = (d, f, fn) => { const j = JSON.parse(fs.readFileSync(p.join(d, f), 'utf8')); fn(j); fs.writeFileSync(p.join(d, f), JSON.stringify(j)); };

test('البناء ينجح ويولّد الصفحات واللغات وsitemap', () => {
  const d = sandbox(); assert.ok(build(d).ok);
  const all = walk(p.join(d, 'dist')).map(f => p.relative(p.join(d, 'dist'), f));
  for (const f of ['index.html', 'en/index.html', 'privacy/site/index.html', 'en/privacy/site/index.html', 'support/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'assets/theme.js', 'admin/index.html']) assert.ok(all.includes(f), 'مفقود: ' + f);
  const sm = fs.readFileSync(p.join(d, 'dist/sitemap.xml'), 'utf8'); assert.ok(sm.includes('https://example.test/en/apps/'));
});

test('كل الروابط الداخلية والأصول موجودة، ولا نصوص بلا استبدال', () => {
  const d = sandbox(); assert.ok(build(d).ok); const D = p.join(d, 'dist'), bad = [];
  walk(D).filter(f => f.endsWith('.html')).forEach(f => {
    const h = fs.readFileSync(f, 'utf8');
    if (/\{[a-z_]+\}/.test(h.replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''))) bad.push('نص غير مستبدل في ' + f);
    if (/<script(?![^>]*\bsrc=)(?![^>]*application\/(?:ld\+)?json)[^>]*>/.test(h)) bad.push('سكربت inline يخالف CSP في ' + f);
    for (const m of h.matchAll(/(?:href|src|action)="(\/[^"#?]*)/g)) {
      const u = m[1]; if (u.startsWith('/api/')) continue;
      const t = p.join(D, u); if (!(fs.existsSync(t) && (!fs.statSync(t).isDirectory() || fs.existsSync(p.join(t, 'index.html'))))) bad.push(`${p.relative(D, f)} → ${u}`);
    }
  });
  assert.deepEqual(bad, []);
});

test('كل صفحة بلغتها واتجاهها وبدائل hreflang', () => {
  const d = sandbox(); assert.ok(build(d).ok);
  const ar = fs.readFileSync(p.join(d, 'dist/index.html'), 'utf8'), en = fs.readFileSync(p.join(d, 'dist/en/index.html'), 'utf8');
  assert.match(ar, /lang="ar" dir="rtl"/); assert.match(en, /lang="en" dir="ltr"/); assert.match(en, /hreflang="ar"/);
});

test('حراسة البناء ترفض البيانات المعيبة', () => {
  const cases = {
    'منشور بلا رابط': j => { j.status = 'published'; },
    'رابط javascript': j => { j.play_url = 'javascript:alert(1)'; },
    'بصمة APK خاطئة': j => { j.apk = { url: 'https://x.test/a.apk', sha256: 'abc' }; },
    'لغة غير مفعّلة': j => { j.i18n.fr = { name: 'x' }; },
    'سياسة معتمدة وناقصة': j => { j.privacy.approved = true; j.privacy.retention = null; }
  };
  for (const [name, fn] of Object.entries(cases)) { const d = sandbox(x => edit(x, 'waleed-targma.app.json', fn)); const r = build(d); assert.equal(r.ok, false, name); }
});

test('سياسة غير مكتملة تظهر كمسودة', () => {
  const d = sandbox(); assert.ok(build(d).ok);
  assert.match(fs.readFileSync(p.join(d, 'dist/privacy/waleed-adshield-mobile/index.html'), 'utf8'), /class="warn"/);
});

test('لا XSS من بيانات التطبيق', () => {
  const d = sandbox(x => edit(x, 'waleed-targma.app.json', j => { j.name = '<img src=x onerror=alert(1)>'; })); assert.ok(build(d).ok);
  assert.ok(!fs.readFileSync(p.join(d, 'dist/apps/waleed-targma/index.html'), 'utf8').includes('<img src=x'));
});

test('رؤوس الأمان في netlify.toml', () => {
  const t = fs.readFileSync(p.join(R, 'netlify.toml'), 'utf8');
  for (const k of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(t.includes(k), k);
});

test('API: المصادقة والتطبيقات والتقييمات والإحصائيات', async () => {
  const d = fs.mkdtempSync(p.join(os.tmpdir(), 'api-')); fs.mkdirSync(p.join(d, 'repo'));
  ['site.json', 'waleed-targma.app.json'].forEach(f => fs.copyFileSync(p.join(R, f), p.join(d, 'repo', f)));
  Object.assign(process.env, { LOCAL_DIR: d, ADMIN_PASSWORD: 'correct-horse-battery', SESSION_SECRET: 'x'.repeat(40) });
  const { default: h } = await import(p.join(R, 'functions/api.mjs'));
  const call = async (m, u, b, t) => { const r = await h(new Request('http://x' + u, { method: m, headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })); const x = await r.text(); return { s: r.status, j: x ? JSON.parse(x) : null }; };
  assert.equal((await call('GET', '/api/admin/apps')).s, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'bad' })).s, 401);
  const { j: { token } } = await call('POST', '/api/admin/login', { password: 'correct-horse-battery' });
  assert.equal((await call('GET', '/api/admin/apps', null, token.slice(0, -3) + 'abc')).s, 401);
  const app = { id: 'demo-app', name: 'Demo', status: 'testing', privacy: { approved: false } };
  assert.equal((await call('PUT', '/api/admin/apps/demo-app', { app }, token)).s, 200);
  assert.equal((await call('PUT', '/api/admin/apps/demo-app', { app }, token)).s, 422);
  assert.equal((await call('PUT', '/api/admin/apps/demo-app', { app: { ...app, status: 'published' }, sha: 'x' }, token)).s, 400);
  const rv = { app: 'demo-app', rating: 5, name: 'Ali', text: 'تطبيق ممتاز جداً وسهل', elapsed: 5000 };
  assert.equal((await call('POST', '/api/reviews', { ...rv, elapsed: 10 })).s, 400);
  assert.equal((await call('POST', '/api/reviews', { ...rv, app: 'waleed-targma' })).s, 400);
  assert.equal((await call('POST', '/api/reviews', rv)).s, 200);
  assert.equal((await call('GET', '/api/reviews?app=demo-app')).j.count, 0);
  const pend = (await call('GET', '/api/admin/reviews?status=pending', null, token)).j.reviews; assert.equal(pend.length, 1);
  await call('PATCH', `/api/admin/reviews/demo-app/${pend[0].id}`, { status: 'approved' }, token);
  assert.equal((await call('GET', '/api/reviews?app=demo-app')).j.count, 1);
  await call('POST', '/api/reviews', rv); await call('POST', '/api/reviews', rv);
  assert.equal((await call('POST', '/api/reviews', rv)).s, 429);
  await call('POST', '/api/track', { t: 'v', path: '/apps/' }); await call('POST', '/api/track', { t: 'v', path: '/admin/' }); await call('POST', '/api/track', { t: 'd', app: 'demo-app', kind: 'play' });
  const st = (await call('GET', '/api/admin/stats?days=7', null, token)).j; assert.equal(st.views, 1); assert.equal(st.dl, 1);
});

test('رابط الموقع مصدر واحد: site.json يغلب SITE_URL ثم URL، وبلا رابط لا sitemap ولا canonical', () => {
  const S = require('./shared.js');
  assert.deepEqual(S.resolveSiteUrl({ url: 'https://a.test/' }, { SITE_URL: 'https://b.test', URL: 'https://c.test' }), { url: 'https://a.test', source: 'site.json', valid: true });
  assert.equal(S.resolveSiteUrl({}, { SITE_URL: 'https://b.test', URL: 'https://c.test' }).source, 'SITE_URL');
  assert.equal(S.resolveSiteUrl({}, { URL: 'https://c.test' }).source, 'URL');
  assert.equal(S.resolveSiteUrl({}, {}).url, '');
  const none = sandbox(); assert.ok(build(none, {}).ok);
  assert.ok(!fs.existsSync(p.join(none, 'dist/sitemap.xml'))); assert.ok(!/rel="canonical"|hreflang="x-default"/.test(fs.readFileSync(p.join(none, 'dist/index.html'), 'utf8')));
  const own = sandbox(x => edit(x, 'site.json', j => { j.url = 'https://mine.test'; })); assert.ok(build(own, { URL: 'https://other.test' }).ok);
  assert.match(fs.readFileSync(p.join(own, 'dist/en/index.html'), 'utf8'), /canonical" href="https:\/\/mine\.test\/en\/"/);
  assert.ok(fs.readFileSync(p.join(own, 'dist/sitemap.xml'), 'utf8').includes('https://mine.test/apps/') && !fs.readFileSync(p.join(own, 'dist/sitemap.xml'), 'utf8').includes('other.test'));
  assert.equal(build(sandbox(x => edit(x, 'site.json', j => { j.url = 'http://insecure.test'; }))).ok, false);
});

test('لا دومين مكتوب يدوياً في الشيفرة أو الصفحات المولّدة', () => {
  const d = sandbox(); assert.ok(build(d, {}).ok);
  const hits = walk(p.join(d, 'dist')).filter(f => /\.(html|txt|xml)$/.test(f)).filter(f => /https?:\/\/(?!youtube\.com|www\.facebook\.com|www\.w3\.org|sites\.google\.com)/.test(fs.readFileSync(f, 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')));
  assert.deepEqual(hits.map(f => p.basename(f)), []);
});

test('check.js يبلّغ عن الرابط المفقود والسياسات المسودة، ويفشل في --strict', () => {
  const run = a => { try { return { code: 0, out: execFileSync('node', ['check.js', ...a], { cwd: R, env: { ...process.env, URL: '', SITE_URL: '' }, stdio: 'pipe' }).toString() }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  const r = run([]); assert.equal(r.code, 0); assert.match(r.out, /✘ رابط نشر الموقع البرمجي غير محدد/); assert.match(r.out, /✘ waleed-adshield-mobile: السياسة مسودة/);
  assert.equal(run(['--strict']).code, 1);
});

test('الموقع الرسمي المرجعي منفصل عن رابط النشر: يظهر في التذييل وsameAs ولا يدخل canonical/sitemap', () => {
  const S = require('./shared.js'), site = JSON.parse(fs.readFileSync(p.join(R, 'site.json'), 'utf8'));
  assert.equal(S.resolveSiteUrl(site, {}).url, ''); // official_url لا يُستخدم كرابط نشر
  const d = sandbox(); assert.ok(build(d, { URL: 'https://netlify-deploy.test' }).ok);
  const home = fs.readFileSync(p.join(d, 'dist/index.html'), 'utf8'), en = fs.readFileSync(p.join(d, 'dist/en/index.html'), 'utf8');
  assert.match(home, /sites\.google\.com\/view\/waleedmmh789\//); assert.match(home, /الموقع الرسمي/); assert.match(en, /Official website/);
  assert.match(home, /application\/ld\+json[^>]*>[^<]*"sameAs":\["https:\/\/sites\.google\.com/);
  assert.match(home, /canonical" href="https:\/\/netlify-deploy\.test\/"/);
  const sm = fs.readFileSync(p.join(d, 'dist/sitemap.xml'), 'utf8'); assert.ok(!sm.includes('google') && sm.includes('netlify-deploy.test'));
  assert.ok(!/canonical[^>]*google/.test(home));
  assert.equal(build(sandbox(x => edit(x, 'site.json', j => { j.official_url = 'http://x.test'; }))).ok, false);
});

// ───────── مرحلة الإكمال: رابط النشر وSEO والخصوصية ─────────
const readJ = f => JSON.parse(fs.readFileSync(p.join(R, f), 'utf8'));

test('رابط النشر: يُرفض رابط Google Sites وأي مسار أو استعلام، ويُطبَّع الأصل، وتصل الرسالة للبناء واللوحة وcheck.js', () => {
  const S = require('./shared.js'), mk = u => ({ brand: 'b', languages: [{ code: 'ar', dir: 'rtl' }], url: u });
  const bad = { 'https://sites.google.com/view/waleedmmh789/home': /Google/, 'http://a.test': /https/, 'https://a.test/en': /بلا مسار/, 'https://a.test/?q=1': /بلا مسار/, 'https://u:p@a.test': /مستخدم/, 'abc': /صالح/ };
  for (const [u, re] of Object.entries(bad)) {
    const r = S.resolveSiteUrl({ url: u }, {}); assert.equal(r.valid, false, u); assert.match(r.problem, re, u);
    assert.equal(S.validateSite(mk(u)).length, 1, u); // نفس القاعدة في لوحة التحكم (functions/api.mjs)
  }
  assert.deepEqual(S.validateSite(mk('https://mine.test/')), []);
  assert.equal(S.resolveSiteUrl({ url: 'HTTPS://Mine.Test/' }, {}).url, 'https://mine.test');
  let r = build(sandbox(x => edit(x, 'site.json', j => { j.url = 'https://sites.google.com/view/waleedmmh789/home'; })));
  assert.equal(r.ok, false); assert.match(r.err, /official_url/);
  r = build(sandbox(), { SITE_URL: 'https://a.test/en' }); assert.equal(r.ok, false); assert.match(r.err, /SITE_URL/);
  const out = execFileSync('node', ['check.js'], { cwd: R, env: { ...process.env, URL: '', SITE_URL: 'https://x.test/p' }, stdio: 'pipe' }).toString();
  assert.match(out, /✘ رابط نشر الموقع البرمجي غير صالح \(SITE_URL\)/);
});

test('SEO: كل canonical وhreflang وog:url وsitemap وrobots تستخدم رابط النشر فقط ومتطابقة فيما بينها', () => {
  const base = 'https://mine.test', stray = /google|netlify-other/;
  const d = sandbox(x => edit(x, 'site.json', j => { j.url = base + '/'; })); assert.ok(build(d, { URL: 'https://netlify-other.test' }).ok);
  const D = p.join(d, 'dist'), sm = fs.readFileSync(p.join(D, 'sitemap.xml'), 'utf8'), rb = fs.readFileSync(p.join(D, 'robots.txt'), 'utf8');
  const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), canon = [];
  assert.equal(new Set(smUrls).size, smUrls.length, 'روابط مكررة في sitemap');
  assert.ok(smUrls.length >= 10 && smUrls.every(u => u.startsWith(base + '/')) && !stray.test(sm));
  walk(D).filter(f => f.endsWith('.html')).forEach(f => {
    const rel = p.relative(D, f), h = fs.readFileSync(f, 'utf8'); if (rel.startsWith('admin')) return;
    if (/<meta name="robots" content="noindex">/.test(h)) { assert.ok(!/rel="canonical"|hreflang="|og:url/.test(h.replace(/<a [^>]*>/g, '')), 'صفحة noindex بلا canonical: ' + rel); return; }
    const c = [...h.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]); assert.equal(c.length, 1, rel);
    assert.equal(c[0], base + '/' + rel.replace(/index\.html$/, ''), rel); canon.push(c[0]);
    assert.ok(h.includes('<meta property="og:url" content="' + c[0] + '">'), 'og:url ' + rel);
    const hl = [...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
    assert.deepEqual(hl.map(m => m[1]).sort(), ['ar', 'en', 'x-default'], rel);
    assert.ok(hl.every(m => m[2].startsWith(base + '/') && !stray.test(m[2])) && !stray.test(c[0]), rel);
  });
  assert.deepEqual([...canon].sort(), [...smUrls].sort(), 'canonical يجب أن يطابق sitemap تماماً');
  assert.ok(rb.includes('Sitemap: ' + base + '/sitemap.xml\n') && rb.includes('Disallow: /admin/') && rb.includes('Disallow: /api/') && !stray.test(rb));
  // رابط من SITE_URL (بلا site.json.url) يعطي النتيجة نفسها، وبلا أي رابط لا يُكتب سطر Sitemap
  const e = sandbox(); assert.ok(build(e, { SITE_URL: 'https://env.test/' }).ok);
  assert.ok(fs.readFileSync(p.join(e, 'dist/robots.txt'), 'utf8').includes('Sitemap: https://env.test/sitemap.xml\n'));
  const n = sandbox(); assert.ok(build(n, {}).ok); assert.ok(!/Sitemap:/.test(fs.readFileSync(p.join(n, 'dist/robots.txt'), 'utf8')));
});

test('الخصوصية: ترجمة كل تطبيق مطابقة لأصلها في البنية، بلا نصوص مؤقتة', () => {
  const site = readJ('site.json'), others = site.languages.map(l => l.code).filter(c => c !== site.default_lang);
  const PF = ['data_collected', 'permissions', 'third_party', 'retention', 'children', 'deletion'], n = v => Array.isArray(v) ? v.length : (String(v || '').trim() ? 1 : 0);
  let checked = 0;
  fs.readdirSync(R).filter(f => f.endsWith('.app.json')).map(readJ).forEach(a => others.forEach(c => {
    const pv = ((a.i18n || {})[c] || {}).privacy; if (!pv) return; checked++;
    PF.forEach(k => assert.equal(n(pv[k]), n(a.privacy[k]), `${a.id} [${c}] ${k}`));
    assert.equal(pv.updated, a.privacy.updated, a.id + ' تاريخ التحديث');
    (a.privacy.permissions || []).forEach((x, i) => assert.equal(typeof pv.permissions[i], typeof x, `${a.id} [${c}] permissions[${i}]`));
    assert.ok(!/todo|tbd|lorem|xxx|سيُضاف|يُملأ لاحقا/i.test(JSON.stringify([a.privacy, pv])), a.id + ': نص مؤقت');
  }));
  assert.ok(checked >= 1);
});

test('صفحات الخصوصية: وليد ترجمة كاملة بالعربية والإنجليزية، وAdShield لا يُختلق له شيء', () => {
  const d = sandbox(); assert.ok(build(d).ok);
  const tg = readJ('waleed-targma.app.json'), PL = ['data_collected', 'permissions', 'third_party', 'retention', 'deletion'];
  [['ar', 'privacy/waleed-targma/', tg.privacy], ['en', 'en/privacy/waleed-targma/', tg.i18n.en.privacy]].forEach(([c, path, pv]) => {
    const t = readJ(c + '.lang.json'), h = fs.readFileSync(p.join(d, 'dist', path, 'index.html'), 'utf8'), main = h.match(/<main>[\s\S]*<\/main>/)[0];
    assert.ok(!main.includes(t.pv_field_missing), c + ': حقل فارغ في سياسة وليد ترجمة');
    assert.equal((main.match(/<li>/g) || []).length, PL.reduce((s, k) => s + pv[k].length, 0), c + ': عدد البنود');
    assert.ok(main.includes(pv.children) || main.includes(pv.children.replace(/'/g, '&#39;')), c + ': قسم الأطفال');
    assert.equal(main.includes('class="warn"'), !pv.approved, c + ': تنبيه المسودة يتبع حالة الاعتماد');
    assert.ok(main.includes(t.pv_contact), c + ': قسم التواصل');
  });
  [['ar', 'privacy/waleed-adshield-mobile/'], ['en', 'en/privacy/waleed-adshield-mobile/']].forEach(([c, path]) => {
    const t = readJ(c + '.lang.json'), main = fs.readFileSync(p.join(d, 'dist', path, 'index.html'), 'utf8').match(/<main>[\s\S]*<\/main>/)[0];
    assert.equal(main.split(t.pv_field_missing).length - 1, 6, c + ': الأقسام الستة تظهر فارغة صراحة لا بنص مختلَق');
    assert.ok(main.includes('class="warn"'));
  });
});
