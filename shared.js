// تحقق مشترك بين build.js ودالة الإدارة (functions/api.mjs): نفس القواعد في الاثنين.
const ST_KEYS = ['coming', 'testing', 'published', 'paused'];
const isHttps = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const okMedia = s => typeof s === 'string' && /^\/media\/[^\s\/\\"'<>]+\.(png|jpe?g|webp)$/i.test(s);
const ID_RE = /^[a-z0-9-]{1,60}$/;

// رابط نشر الموقع البرمجي (Netlify أو دومين عليه): أصل الموقع فقط (https + نطاق، بلا مسار ولا استعلام)،
// لأن sitemap.xml وrobots.txt يجب أن يكونا في جذر النطاق. ولا يُقبل رابط Google لأنه الموقع الرسمي المرجعي (official_url).
function siteUrlProblem(u) {
  let x; try { x = new URL(String(u).trim()); } catch { return 'ليس رابطاً صالحاً'; }
  if (x.protocol !== 'https:') return 'يجب أن يبدأ بـ https://';
  if (x.hostname === 'google.com' || x.hostname.endsWith('.google.com')) return 'هذا رابط Google (الموقع الرسمي المرجعي)؛ ضعه في official_url، وهنا ضع رابط Netlify أو دومين المشروع';
  if (x.username || x.password) return 'يجب ألا يحتوي على اسم مستخدم أو كلمة مرور';
  if (x.search || x.hash || x.pathname.replace(/\/+$/, '')) return 'يجب أن يكون عنوان النطاق فقط بلا مسار أو استعلام (مثل https://example.netlify.app)';
  return '';
}

function validateApp(a, f, codes) {
  const e = [], w = x => e.push(f + ': ' + x);
  if (!ID_RE.test(a.id || '')) w('id غير صالح (أحرف إنجليزية صغيرة وأرقام وشرطة فقط)');
  if (!a.name) w('name مطلوب');
  if (!ST_KEYS.includes(a.status)) w('status يجب أن يكون coming أو testing أو published أو paused');
  if (a.order != null && typeof a.order !== 'number') w('order يجب أن يكون رقماً');
  if (a.icon && !okMedia(a.icon)) w('icon يجب أن يكون مساراً مثل /media/icon.png');
  (a.screenshots || []).forEach(s => { if (!okMedia(s)) w('لقطة الشاشة ' + s + ' يجب أن تكون مساراً مثل /media/shot.png'); });
  if (a.play_url && !isHttps(a.play_url)) w('play_url يجب أن يبدأ بـ https://');
  if (a.apk && (!a.apk.url || !isHttps(a.apk.url) || !/^[a-f0-9]{64}$/i.test(a.apk.sha256 || ''))) w('apk يحتاج url يبدأ بـ https:// وsha256 صحيحاً (64 خانة)');
  if (a.status === 'published' && !a.play_url && !a.apk) w('لا يمكن وسم التطبيق «منشور» بلا play_url أو apk');
  if (a.i18n && codes) Object.keys(a.i18n).forEach(c => { if (!codes.includes(c)) w('i18n: اللغة «' + c + '» غير مفعّلة في site.json'); });
  // لا يُعتمد نص خصوصية ناقص: كل الحقول يجب أن تكون معبّأة بنص صريح
  const PF = ['data_collected', 'permissions', 'third_party', 'retention', 'children', 'deletion'];
  const full = (pv, lbl) => { if (pv && pv.approved) { const m = PF.filter(k => !(Array.isArray(pv[k]) ? pv[k].length : String(pv[k] || '').trim())); if (m.length) w('الخصوصية' + lbl + ' مُعتمدة لكن ينقصها: ' + m.join('، ')); } };
  full(a.privacy, '');
  Object.entries(a.i18n || {}).forEach(([c, o]) => full(o.privacy, ' (' + c + ')'));
  return e;
}

function validateSite(s) {
  const e = [];
  if (!s.brand) e.push('site.json: brand مطلوب');
  if (s.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s.email)) e.push('site.json: البريد غير صالح');
  if (s.url) { const pr = siteUrlProblem(s.url); if (pr) e.push('site.json: url ' + pr); }
  if (s.official_url && !isHttps(s.official_url)) e.push('site.json: official_url يجب أن يبدأ بـ https://');
  ['youtube', 'facebook'].forEach(k => { const v = (s.social || {})[k]; if (v && !isHttps(v)) e.push('site.json: social.' + k + ' يجب أن يبدأ بـ https://'); });
  const L = s.languages || [];
  if (!L.length) e.push('site.json: languages مطلوبة');
  if (!L.some(l => l.code === (s.default_lang || L[0] && L[0].code))) e.push('site.json: default_lang غير موجودة في languages');
  L.forEach(l => { if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l.code || '') || !['rtl', 'ltr'].includes(l.dir)) e.push('site.json: لغة غير صالحة (code وdir مطلوبان): ' + JSON.stringify(l)); });
  return e;
}

// مصدر واحد لرابط الموقع: site.json (url) ثم SITE_URL ثم متغير Netlify «URL». لا قيمة افتراضية مختلَقة.
function resolveSiteUrl(site, env) {
  const pick = [['site.json', site.url], ['SITE_URL', env.SITE_URL], ['URL', env.URL]].find(([, v]) => v && String(v).trim());
  if (!pick) return { url: '', source: null };
  const raw = String(pick[1]).trim().replace(/\/+$/, ''), problem = siteUrlProblem(raw);
  return problem ? { url: raw, source: pick[0], valid: false, problem } : { url: new URL(raw).origin, source: pick[0], valid: true };
}

module.exports = { resolveSiteUrl, siteUrlProblem, ST_KEYS, isHttps, okMedia, ID_RE, validateApp, validateSite };
