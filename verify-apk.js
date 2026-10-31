// يتحقق قبل البناء أن كل رابط APK يعيد ملفاً بنفس بصمة SHA-256 المكتوبة. يفشل عند اختلاف البصمة أو تعذّر الرابط (HTTP)،
// ويكتفي بتحذير عند انقطاع الشبكة. يُتخطى كلياً بـ SKIP_APK_VERIFY=1.
const fs = require('fs'), p = require('path'), crypto = require('crypto');
(async () => {
  if (process.env.SKIP_APK_VERIFY) return console.log('تخطي التحقق من APK');
  const apps = fs.readdirSync(__dirname).filter(f => f.endsWith('.app.json')).map(f => ({ f, a: JSON.parse(fs.readFileSync(p.join(__dirname, f), 'utf8')) })).filter(x => x.a.apk && x.a.apk.url);
  const bad = [];
  for (const { f, a } of apps) {
    try {
      const r = await fetch(a.apk.url, { redirect: 'follow' });
      if (!r.ok) { bad.push(`${f}: الرابط أعاد HTTP ${r.status}`); continue; }
      const h = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
      if (h.toLowerCase() !== a.apk.sha256.toLowerCase()) bad.push(`${f}: البصمة لا تطابق الملف (الفعلية ${h})`);
      else console.log(`${f}: البصمة مطابقة`);
    } catch (e) { console.warn(`تحذير: تعذّر الوصول لرابط ${f} (${e.message}) ولم يُتحقق منه`); }
  }
  if (bad.length) { console.error('فشل التحقق من APK:\n- ' + bad.join('\n- ')); process.exit(1); }
})();
