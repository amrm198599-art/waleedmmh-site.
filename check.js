// تقرير جاهزية للنشر الرسمي: node check.js  (أو npm run check). مع --strict يفشل عند وجود أي بند ناقص.
const fs = require('fs'), p = require('path'), S = require('./shared.js');
const J = f => JSON.parse(fs.readFileSync(p.join(__dirname, f), 'utf8'));
const site = J('site.json'), SU = S.resolveSiteUrl(site, process.env);
const apps = fs.readdirSync(__dirname).filter(f => f.endsWith('.app.json')).map(f => J(f));
const PF = ['data_collected', 'permissions', 'third_party', 'retention', 'children', 'deletion'];
const miss = pv => PF.filter(k => !pv || !(Array.isArray(pv[k]) ? pv[k].length : String(pv[k] || '').trim()));
const todo = [], ok = [];
const chk = (cond, good, bad) => (cond ? ok : todo).push(cond ? good : bad);
chk(SU.url && SU.valid, `رابط نشر الموقع البرمجي: ${SU.url} (${SU.source})`, SU.url ? `رابط نشر الموقع البرمجي غير صالح (${SU.source}): ${SU.problem}` : 'رابط نشر الموقع البرمجي غير محدد: ضعه في site.json ← url أو متغير SITE_URL (أو من اللوحة: بيانات الموقع)');
chk(site.official_url && S.isHttps(site.official_url), `الموقع الرسمي المرجعي: ${site.official_url}`, 'الموقع الرسمي المرجعي (official_url) غير محدد');
chk(site.email, 'بريد الدعم مضبوط', 'بريد الدعم غير محدد');
chk((site.policy || {}).approved, 'سياسة خصوصية الموقع معتمدة', 'سياسة خصوصية الموقع مسودة (policy.approved)');
const langs = (site.languages || []).map(l => l.code).filter(c => c !== site.default_lang);
apps.forEach(a => {
  const m = miss(a.privacy);
  chk((a.privacy || {}).approved && !m.length, `${a.id}: سياسة معتمدة`, `${a.id}: السياسة ${(a.privacy || {}).approved ? 'معتمدة وناقصة' : 'مسودة'}${m.length ? ' — ينقص: ' + m.join('، ') : ''}`);
  langs.forEach(c => { const pv = ((a.i18n || {})[c] || {}).privacy; chk(pv && pv.approved && !miss(pv).length, `${a.id} [${c}]: سياسة معتمدة`, `${a.id} [${c}]: السياسة ${pv ? (pv.approved ? 'ناقصة' : 'مسودة') : 'غير مترجمة'}`); });
  if (a.status === 'published') chk(a.play_url || a.apk, `${a.id}: رابط تنزيل موجود`, `${a.id}: منشور بلا رابط`);
  if (a.apk) chk(/^[a-f0-9]{64}$/i.test(a.apk.sha256 || ''), `${a.id}: بصمة APK صحيحة الشكل`, `${a.id}: بصمة APK غير صحيحة`);
});
ok.forEach(x => console.log('✔ ' + x)); todo.forEach(x => console.log('✘ ' + x));
console.log(`\n${ok.length} جاهز، ${todo.length} متبقٍ`);
if (todo.length && process.argv.includes('--strict')) process.exit(1);
