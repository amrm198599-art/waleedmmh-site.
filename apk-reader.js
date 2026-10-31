// قارئ APK يعمل داخل متصفح لوحة التحكم (وفي Node للاختبارات). الملف لا يُرفع إلى أي مكان:
// يُقرأ محلياً ويُستخرج منه ما هو مكتوب فيه فعلاً (الحزمة، الإصدار، أقل أندرويد، الأذونات، الاسم) مع بصمة SHA-256.
// لا يخمّن شيئاً عن سلوك التطبيق: التنبيهات المستخرجة من الـ manifest تنصح بمراجعة السياسة ولا تكتب ادعاءات فيها.
(function (root) {
  'use strict';
  const u16 = (d, o) => d.getUint16(o, true), u32 = (d, o) => d.getUint32(o, true);
  const dec8 = new TextDecoder('utf-8'), dec16 = new TextDecoder('utf-16le');
  const view = (d, o, n) => new Uint8Array(d.buffer, d.byteOffset + o, n);

  // ───────── ZIP ─────────
  function zipEntries(dv) {
    let e = -1;
    for (let i = dv.byteLength - 22; i >= Math.max(0, dv.byteLength - 22 - 65535); i--) if (u32(dv, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('الملف ليس APK صالحاً (لم يُعثر على فهرس ZIP).');
    const n = u16(dv, e + 10); let p = u32(dv, e + 16); const map = Object.create(null);
    for (let i = 0; i < n; i++) {
      if (p + 46 > dv.byteLength || u32(dv, p) !== 0x02014b50) throw new Error('فهرس ZIP تالف.');
      const nl = u16(dv, p + 28), el = u16(dv, p + 30), cl = u16(dv, p + 32);
      map[dec8.decode(view(dv, p + 46, nl))] = { method: u16(dv, p + 10), csize: u32(dv, p + 20), lo: u32(dv, p + 42) };
      p += 46 + nl + el + cl;
    }
    return map;
  }
  async function inflateRaw(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function readEntry(dv, ent) {
    const o = ent.lo;
    if (ent.csize === 0xffffffff || o === 0xffffffff) throw new Error('ملفات ZIP64 غير مدعومة.');
    if (u32(dv, o) !== 0x04034b50) throw new Error('رأس ملف داخل APK تالف.');
    const raw = view(dv, o + 30 + u16(dv, o + 26) + u16(dv, o + 28), ent.csize);
    if (ent.method === 0) return raw;
    if (ent.method === 8) return inflateRaw(raw);
    throw new Error('طريقة ضغط غير مدعومة داخل APK.');
  }

  // ───────── جدول النصوص (مشترك بين AXML وARSC) ─────────
  function pool(dv, o) {
    const hs = u16(dv, o + 2), n = u32(dv, o + 8), utf8 = !!(u32(dv, o + 16) & 0x100), ss = u32(dv, o + 20), out = [];
    for (let i = 0; i < n; i++) {
      let p = o + ss + u32(dv, o + hs + 4 * i);
      if (utf8) {
        if (dv.getUint8(p++) & 0x80) p++;
        let b = dv.getUint8(p++); if (b & 0x80) b = ((b & 0x7f) << 8) | dv.getUint8(p++);
        out.push(dec8.decode(view(dv, p, b)));
      } else {
        let l = u16(dv, p); p += 2; if (l & 0x8000) { l = ((l & 0x7fff) << 16) | u16(dv, p); p += 2; }
        out.push(dec16.decode(view(dv, p, l * 2)));
      }
    }
    return out;
  }

  // ───────── AndroidManifest.xml الثنائي ─────────
  function parseManifest(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u16(dv, 0) !== 0x0003) throw new Error('AndroidManifest.xml ليس بصيغة AXML المتوقعة.');
    const total = Math.min(u32(dv, 4), dv.byteLength), els = []; let p = u16(dv, 2), strings = [];
    const str = i => (i >= 0 && i < strings.length ? strings[i] : null);
    while (p + 8 <= total) {
      const type = u16(dv, p), size = u32(dv, p + 4); if (!size) break;
      if (type === 0x0001) strings = pool(dv, p);
      else if (type === 0x0102) {
        const attrs = {}, count = u16(dv, p + 28); let a = p + 16 + u16(dv, p + 24);
        for (let i = 0; i < count; i++, a += 20) {
          const name = str(dv.getInt32(a + 4, true)), raw = dv.getInt32(a + 8, true), dt = dv.getUint8(a + 15), data = u32(dv, a + 16);
          attrs[name] = dt === 0x03 ? str(data) : dt === 0x01 ? { ref: data } : dt === 0x12 ? data !== 0 : (dt === 0x10 || dt === 0x11) ? data | 0 : raw >= 0 ? str(raw) : null;
        }
        els.push({ tag: str(dv.getInt32(p + 20, true)), attrs });
      }
      p += size;
    }
    return els;
  }

  // ───────── resources.arsc: حلّ مرجع مثل @string/app_name (نأخذ الإعداد الافتراضي أولاً) ─────────
  function makeResolver(arsc) {
    const dv = new DataView(arsc.buffer, arsc.byteOffset, arsc.byteLength);
    if (u16(dv, 0) !== 0x0002) return () => null;
    const total = Math.min(u32(dv, 4), dv.byteLength), pkgs = {}; let p = u16(dv, 2), global = null;
    while (p + 8 <= total) {
      const t = u16(dv, p), s = u32(dv, p + 4); if (!s) break;
      if (t === 0x0001 && !global) global = pool(dv, p); else if (t === 0x0200) pkgs[u32(dv, p + 8)] = p;
      p += s;
    }
    const fin = (c, depth, self) => (!c ? null : c.dt === 0x03 ? (global || [])[c.data] ?? null : c.dt === 0x01 ? self(c.data, depth + 1) : (c.dt === 0x10 || c.dt === 0x11) ? c.data | 0 : null);
    return function resolve(id, depth = 0) {
      const po = pkgs[id >>> 24], tid = (id >>> 16) & 0xff, eid = id & 0xffff;
      if (depth > 5 || po == null) return null;
      const end = Math.min(po + u32(dv, po + 4), dv.byteLength); let q = po + u16(dv, po + 2), any = null;
      while (q + 8 <= end) {
        const t = u16(dv, q), h = u16(dv, q + 2), s = u32(dv, q + 4); if (!s) break;
        if (t === 0x0201 && dv.getUint8(q + 8) === tid) {
          const fl = dv.getUint8(q + 9), cnt = u32(dv, q + 12), es = u32(dv, q + 16), cfg = u32(dv, q + 20); let off = null;
          if (fl & 1) { for (let i = 0; i < cnt; i++) { const v = u32(dv, q + h + 4 * i); if ((v & 0xffff) === eid) { off = (v >>> 16) * 4; break; } } }
          else if (fl & 2) { if (eid < cnt) { const v = u16(dv, q + h + 2 * eid); if (v !== 0xffff) off = v * 4; } }
          else if (eid < cnt) { const v = u32(dv, q + h + 4 * eid); if (v !== 0xffffffff) off = v; }
          if (off != null) {
            const eo = q + es + off;
            if (!(u16(dv, eo + 2) & 1)) {
              const c = { dt: dv.getUint8(eo + 11), data: u32(dv, eo + 12) };
              let def = true; for (let i = 4; i < cfg && i < 64; i++) if (dv.getUint8(q + 20 + i)) { def = false; break; }
              if (def) return fin(c, depth, resolve);
              if (!any) any = c;
            }
          }
        }
        q += s;
      }
      return fin(any, depth, resolve);
    };
  }

  // ───────── تنبيهات من الـ manifest فقط (لا من الشيفرة المجمّعة) ─────────
  const SDKS = [
    ['admob', /^com\.google\.android\.gms\.ads\b/], ['firebase', /^com\.google\.firebase\b/], ['measurement', /^com\.google\.android\.gms\.measurement\b/],
    ['facebook', /^com\.facebook\b/], ['adnet', /^(com\.applovin|com\.unity3d\.ads|com\.ironsource|com\.vungle|com\.chartboost|com\.mbridge|com\.inmobi|com\.startapp|com\.adcolony|com\.bytedance\.sdk|com\.mopub)\b/],
    ['analytics3p', /^(com\.amplitude|com\.mixpanel|com\.appsflyer|com\.adjust\.sdk|com\.flurry|io\.sentry|com\.bugsnag|com\.onesignal|com\.segment)\b/]];
  const HINTS = {
    vpn: ['يعرّف التطبيق خدمة VPN. وضّح في السياسة هل تُعالَج الحركة على الجهاز فقط أم تُمرَّر إلى خادم خارجي، وهل يُسجَّل منها شيء وأين ولكم من الوقت.', 'The app declares a VPN service. State in the policy whether traffic is handled on-device only or sent to an outside server, and whether anything is logged, where, and for how long.'],
    accessibility: ['يعرّف التطبيق خدمة وصول (Accessibility). اشرح في السياسة ما تفعله بالضبط.', 'The app declares an Accessibility service. Explain in the policy exactly what it does.'],
    notif_listener: ['يعرّف التطبيق خدمة قراءة الإشعارات. اشرح في السياسة ما يُقرأ ويُحفظ.', 'The app declares a notification-listener service. Explain what is read and stored.'],
    device_admin: ['يعرّف التطبيق مشرف جهاز (Device Admin). اشرح سبب ذلك في السياسة.', 'The app declares a Device Admin receiver. Explain why in the policy.'],
    admob: ['يظهر في الـ manifest ما يدل على إعلانات Google (AdMob). اذكرها في «الطرف الثالث والإعلانات».', 'The manifest shows Google ads (AdMob) components. Mention them under third parties and ads.'],
    firebase: ['يظهر في الـ manifest ما يدل على Firebase. اذكر الخدمات المستخدمة فعلاً (تحليلات، أعطال، إشعارات...).', 'The manifest shows Firebase components. List the services actually used (analytics, crashes, messaging...).'],
    measurement: ['يظهر ما يدل على Google Analytics (قياس). اذكره في «الطرف الثالث والتحليلات».', 'The manifest shows Google Analytics (measurement). Mention it under third parties and analytics.'],
    facebook: ['يظهر في الـ manifest ما يدل على Facebook SDK. اذكره في «الطرف الثالث».', 'The manifest shows the Facebook SDK. Mention it under third parties.'],
    adnet: ['يظهر في الـ manifest ما يدل على شبكة إعلانات خارجية. اذكرها في «الطرف الثالث والإعلانات».', 'The manifest shows an outside ad network. Mention it under third parties and ads.'],
    analytics3p: ['يظهر في الـ manifest ما يدل على أداة تحليلات أو تتبع أعطال خارجية. اذكرها في السياسة.', 'The manifest shows an outside analytics or crash-reporting tool. Mention it in the policy.']};
  function hintIds(els) {
    const ids = new Set(), tx = (e, k) => typeof e.attrs[k] === 'string' ? e.attrs[k] : '';
    els.forEach(e => {
      const perm = tx(e, 'permission'), nm = tx(e, 'name');
      if (e.tag === 'service' && perm === 'android.permission.BIND_VPN_SERVICE') ids.add('vpn');
      if (e.tag === 'action' && nm === 'android.net.VpnService') ids.add('vpn');
      if (perm === 'android.permission.BIND_ACCESSIBILITY_SERVICE') ids.add('accessibility');
      if (perm === 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE') ids.add('notif_listener');
      if (perm === 'android.permission.BIND_DEVICE_ADMIN') ids.add('device_admin');
      if (['service', 'activity', 'receiver', 'provider', 'meta-data'].includes(e.tag)) SDKS.forEach(([id, re]) => { if (re.test(nm)) ids.add(id); });
    });
    return [...ids];
  }

  // ───────── تعريفات الأذونات (ما يتيحه الإذن في أندرويد، لا سبب استخدام تطبيقك له) ─────────
  const PERM = {
    INTERNET: ['يتيح الوصول إلى الإنترنت', 'Allows access to the internet'], ACCESS_NETWORK_STATE: ['يتيح قراءة حالة الاتصال بالشبكة', 'Allows reading network connection state'],
    ACCESS_WIFI_STATE: ['يتيح قراءة حالة الواي فاي', 'Allows reading Wi-Fi state'], CHANGE_NETWORK_STATE: ['يتيح تغيير حالة الاتصال بالشبكة', 'Allows changing network connectivity state'],
    CHANGE_WIFI_STATE: ['يتيح تغيير حالة الواي فاي', 'Allows changing Wi-Fi state'], FOREGROUND_SERVICE: ['يتيح تشغيل خدمة في المقدمة مع إشعار ظاهر', 'Allows running a foreground service with a visible notification'],
    POST_NOTIFICATIONS: ['يتيح إرسال إشعارات', 'Allows posting notifications'], RECEIVE_BOOT_COMPLETED: ['يتيح التشغيل التلقائي عند إقلاع الجهاز', 'Allows starting automatically when the device boots'],
    WAKE_LOCK: ['يمنع الجهاز من السكون أثناء عمل التطبيق', 'Keeps the device awake while the app runs'], VIBRATE: ['يتيح الاهتزاز', 'Allows vibration'],
    REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: ['يتيح طلب استثناء التطبيق من توفير البطارية', 'Allows asking to be exempt from battery optimizations'], SCHEDULE_EXACT_ALARM: ['يتيح جدولة منبّهات بتوقيت دقيق', 'Allows scheduling exact alarms'],
    CAMERA: ['يتيح استخدام الكاميرا', 'Allows using the camera'], RECORD_AUDIO: ['يتيح تسجيل الصوت بالميكروفون', 'Allows recording audio with the microphone'],
    ACCESS_FINE_LOCATION: ['يتيح الوصول إلى الموقع الدقيق', 'Allows access to precise location'], ACCESS_COARSE_LOCATION: ['يتيح الوصول إلى الموقع التقريبي', 'Allows access to approximate location'],
    ACCESS_BACKGROUND_LOCATION: ['يتيح الوصول إلى الموقع في الخلفية', 'Allows access to location in the background'], READ_CONTACTS: ['يتيح قراءة جهات الاتصال', 'Allows reading contacts'],
    WRITE_CONTACTS: ['يتيح تعديل جهات الاتصال', 'Allows modifying contacts'], READ_EXTERNAL_STORAGE: ['يتيح قراءة الملفات من التخزين', 'Allows reading files from storage'],
    WRITE_EXTERNAL_STORAGE: ['يتيح الكتابة في التخزين', 'Allows writing to storage'], MANAGE_EXTERNAL_STORAGE: ['يتيح الوصول الواسع إلى كل ملفات التخزين', 'Allows broad access to all files on storage'],
    READ_MEDIA_IMAGES: ['يتيح قراءة الصور', 'Allows reading images'], READ_MEDIA_VIDEO: ['يتيح قراءة الفيديوهات', 'Allows reading videos'], READ_MEDIA_AUDIO: ['يتيح قراءة الملفات الصوتية', 'Allows reading audio files'],
    READ_PHONE_STATE: ['يتيح قراءة حالة الهاتف', 'Allows reading phone state'], CALL_PHONE: ['يتيح إجراء مكالمات', 'Allows making phone calls'], READ_SMS: ['يتيح قراءة الرسائل النصية', 'Allows reading SMS'],
    SEND_SMS: ['يتيح إرسال رسائل نصية', 'Allows sending SMS'], RECEIVE_SMS: ['يتيح استقبال الرسائل النصية', 'Allows receiving SMS'], GET_ACCOUNTS: ['يتيح الاطلاع على الحسابات في الجهاز', 'Allows listing accounts on the device'],
    QUERY_ALL_PACKAGES: ['يتيح الاطلاع على قائمة كل التطبيقات المثبّتة', 'Allows seeing the list of all installed apps'], PACKAGE_USAGE_STATS: ['يتيح قراءة إحصاءات استخدام التطبيقات', 'Allows reading app usage statistics'],
    SYSTEM_ALERT_WINDOW: ['يتيح العرض فوق التطبيقات الأخرى', 'Allows drawing over other apps'], REQUEST_INSTALL_PACKAGES: ['يتيح طلب تثبيت تطبيقات', 'Allows requesting installation of apps'],
    BLUETOOTH_CONNECT: ['يتيح الاتصال بأجهزة البلوتوث المقترنة', 'Allows connecting to paired Bluetooth devices'], BLUETOOTH_SCAN: ['يتيح البحث عن أجهزة البلوتوث', 'Allows scanning for Bluetooth devices'],
    NFC: ['يتيح استخدام NFC', 'Allows using NFC'], USE_BIOMETRIC: ['يتيح استخدام البصمة أو الوجه للتحقق', 'Allows using biometrics for authentication'], USE_FINGERPRINT: ['يتيح استخدام البصمة للتحقق', 'Allows using fingerprint authentication']};
  const permInfo = short => PERM[short] || (/^FOREGROUND_SERVICE_/.test(short) ? ['يتيح تشغيل خدمة في المقدمة من نوع محدد', 'Allows running a typed foreground service'] : null);
  const shortPerm = n => n.replace(/^android\.permission\./, '');

  // ───────── أسماء إصدارات أندرويد وصيغ العرض ─────────
  const API = { 21: '5.0', 22: '5.1', 23: '6', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' };
  const androidName = api => API[api] || null;
  const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function suggestId(label, pkg) {
    const ok = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return (/^[\x20-\x7e]+$/.test(label || '') && ok(label)) || ok(pkg) || '';
  }

  // ───────── القراءة الرئيسية ─────────
  async function readApk(input) {
    const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer(), dv = new DataView(buf);
    const ents = zipEntries(dv), mf = ents['AndroidManifest.xml'];
    if (!mf) throw new Error(ents['base/manifest/AndroidManifest.xml'] ? 'هذا ملف AAB وليس APK؛ ارفع ملف APK.' : Object.keys(ents).some(n => n === 'manifest.json') ? 'هذا يبدو XAPK؛ ارفع APK واحداً.' : 'الملف لا يحتوي AndroidManifest.xml فليس APK صالحاً.');
    const els = parseManifest(await readEntry(dv, mf));
    let resolve = () => null;
    if (ents['resources.arsc']) { try { resolve = makeResolver(await readEntry(dv, ents['resources.arsc'])); } catch (e) { resolve = () => null; } }
    const val = v => v && typeof v === 'object' && 'ref' in v ? resolve(v.ref) : v;
    const m = els.find(e => e.tag === 'manifest') || { attrs: {} }, sdk = els.find(e => e.tag === 'uses-sdk') || { attrs: {} }, ap = els.find(e => e.tag === 'application') || { attrs: {} };
    const num = v => { v = val(v); return v == null || v === '' || isNaN(+v) ? null : +v; };
    const seen = new Set(), permissions = els.filter(e => /^uses-permission(-sdk-(23|m))?$/.test(e.tag) && typeof e.attrs.name === 'string')
      .map(e => e.attrs.name).filter(n => !seen.has(n) && seen.add(n)).map(n => ({ full: n, short: shortPerm(n) }));
    const digest = await (root.crypto || globalThis.crypto).subtle.digest('SHA-256', buf);
    const label = val(ap.attrs.label), vn = val(m.attrs.versionName);
    return {
      package: typeof m.attrs.package === 'string' ? m.attrs.package : null, label: typeof label === 'string' && label.trim() ? label.trim() : null,
      versionName: vn != null && vn !== '' ? String(vn) : null, versionCode: num(m.attrs.versionCode), minSdk: num(sdk.attrs.minSdkVersion), targetSdk: num(sdk.attrs.targetSdkVersion),
      permissions, hints: hintIds(els), size: buf.byteLength, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
    };
  }

  // ───────── خطة التعبئة: قيم مقترحة + ملاحظات (دالة نقية قابلة للاختبار) ─────────
  const token = line => { const s = String(line).split(' — ')[0].trim(), m = s.match(/\(([A-Za-z0-9_.]+)\)\s*$/); return shortPerm(m ? m[1] : s).toUpperCase(); };
  function plan(info, ctx) {
    ctx = ctx || {}; const cur = ctx.current || {}, langs = ctx.langs || [], set = {}, notes = [], tr = {};
    if (ctx.isNew && !cur.id) { const id = suggestId(info.label, info.package); if (id) set.id = id; }
    if (info.label) { if (!cur.name) set.name = info.label; else if (cur.name !== info.label) notes.push(`اسم التطبيق داخل APK «${info.label}» يختلف عمّا كتبته «${cur.name}»؛ لم أغيّره.`); }
    else notes.push('تعذّرت قراءة اسم التطبيق من الملف؛ اكتبه يدوياً.');
    if (info.versionName) set.version = info.versionName; else notes.push('لا يحمل الملف اسم إصدار؛ اكتب الإصدار يدوياً.');
    if (ctx.today) set.updated = ctx.today;
    set.size = fmtSize(info.size); set['apk.size'] = set.size; set['apk.sha256'] = info.sha256;
    if (info.minSdk) {
      const v = androidName(info.minSdk) || 'API ' + info.minSdk;
      set.min_android = `Android ${v} فأحدث`; langs.forEach(c => { tr[c] = { min_android: c === 'en' ? `Android ${v} or later` : `Android ${v}+` }; });
    } else notes.push('لا يحدد الملف أقل إصدار أندرويد؛ اكتبه يدوياً.');
    const known = [], unknown = [];
    info.permissions.forEach(p => (permInfo(p.short) ? known : unknown).push(p));
    const perms = { ar: [...known.map(p => `${p.short} — ${permInfo(p.short)[0]}`), ...unknown.map(p => p.short)], en: [...known.map(p => `${p.short} — ${permInfo(p.short)[1]}`), ...unknown.map(p => p.short)] };
    if (!info.permissions.length) notes.push('الملف لا يطلب أي إذن؛ اكتب ذلك صراحةً في السياسة.');
    else notes.push('كتبتُ لكل إذن تعريفه في أندرويد (ما يتيحه الإذن)؛ أضف بعده السبب الفعلي لاستخدام تطبيقك له.');
    if (unknown.length) notes.push('أذونات بلا تعريف جاهز، اكتب لها شرحاً: ' + unknown.map(p => p.short).join('، '));
    if (cur.permissions && cur.permissions.length) {
      const a = new Set(info.permissions.map(p => p.short.toUpperCase())), b = new Set(cur.permissions.map(token));
      const added = [...a].filter(x => !b.has(x)), removed = [...b].filter(x => !a.has(x));
      if (added.length || removed.length) notes.push('أذونات السياسة الحالية لا تطابق الـ APK. ' + (added.length ? 'موجودة في APK وغير مكتوبة: ' + added.join('، ') + '. ' : '') + (removed.length ? 'مكتوبة وغير موجودة في APK: ' + removed.join('، ') + '. ' : '') + 'لم أغيّر نص السياسة.');
      else notes.push('أذونات السياسة الحالية تطابق أذونات APK.');
    }
    return { set, tr, perms, notes, hints: info.hints.map(h => HINTS[h][0]), hintsEn: info.hints.map(h => HINTS[h][1]) };
  }

  const api = { readApk, plan, suggestId, fmtSize, androidName, permInfo, HINTS, _parse: { zipEntries, parseManifest, makeResolver, pool } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApkReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
