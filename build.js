// يولّد الموقع الثابت (متعدد اللغات) داخل dist من site.json و*.app.json و*.lang.json. بلا مكتبات خارجية.
const fs = require('fs'), p = require('path'), S = require('./shared.js');
const R = __dirname, D = p.join(R, 'dist');
const J = f => JSON.parse(fs.readFileSync(p.join(R, f), 'utf8'));
const site = J('site.json');
const LANGS = site.languages || [];
const codes = LANGS.map(l => l.code);
const DEF = site.default_lang || codes[0];
const err = [...S.validateSite(site)];
const strs = {};
codes.forEach(c => { try { strs[c] = J(c + '.lang.json'); } catch (e) { err.push(c + '.lang.json: مفقود أو غير صالح — ' + e.message); } });
const apps = fs.readdirSync(R).filter(f => f.endsWith('.app.json'))
  .map(f => { try { return { ...J(f), _f: f }; } catch (e) { err.push(f + ': JSON غير صالح — ' + e.message); return null; } })
  .filter(Boolean).sort((a, b) => (a.order || 99) - (b.order || 99));
apps.forEach(a => err.push(...S.validateApp(a, a._f, codes)));
if (new Set(apps.map(a => a.id)).size !== apps.length) err.push('معرّفات مكررة بين التطبيقات');
if (err.length) { console.error('أخطاء في البيانات:\n- ' + err.join('\n- ')); process.exit(1); }

const SU = S.resolveSiteUrl(site, process.env);
if (SU.url && !SU.valid) { console.error('رابط الموقع (' + SU.source + ': ' + SU.url + ') غير صالح: ' + SU.problem); process.exit(1); }
const BASE = SU.url;
// الموقع الرسمي المرجعي (مثلاً Google Sites): للعرض وsameAs فقط، ولا يدخل أبداً في canonical أو sitemap أو hreflang.
const OFFICIAL = site.official_url ? new URL(site.official_url).href : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pre = c => c === DEF ? '' : '/' + c;
const filled = v => v != null && v !== '' && !(Array.isArray(v) && !v.length);
const LOGO = '<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#0a1a44"/><path d="M8 14l7 22 9-14 9 14 7-22" fill="none" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const urls = [];
const write = (rel, html) => { const f = p.join(D, rel); fs.mkdirSync(p.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };

// نسخة التطبيق باللغة c: الحقول المترجمة فوق الأساس؛ والخصوصية لا تسقط على لغة أخرى أبداً.
function loc(a, c) {
  if (c === DEF) return { ...a, _has: true };
  const o = Object.fromEntries(Object.entries((a.i18n || {})[c] || {}).filter(([, v]) => filled(v)));
  return { ...a, ...o, privacy: { updated: (a.privacy || {}).updated, ...(o.privacy || {}) }, _has: !!(a.i18n || {})[c] };
}
const ST = { coming: 'st_coming', testing: 'st_testing', published: 'st_published', paused: 'st_paused' };
const STC = { coming: 'wn', testing: 'wn', published: 'ok', paused: 'bd' };

function render(c) {
  const L = LANGS.find(l => l.code === c);
  const t = (k, v) => { let s = (strs[c] && strs[c][k]) ?? strs[DEF][k] ?? k; for (const x in v || {}) s = s.split('{' + x + '}').join(v[x]); return s; };
  const U = lp => pre(c) + '/' + lp;
  const sv = { ...site, ...((site.i18n || {})[c] || {}) };
  const A = apps.map(a => loc(a, c));
  const sameAs = [OFFICIAL, ...Object.values(site.social || {})].filter(Boolean);
  const org = sameAs.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: sv.brand, ...(BASE ? { url: BASE + pre(c) + '/' } : {}), sameAs }).replace(/</g, '\\u003c')}</script>` : '';
  const page = (lp, { title, d, b, noindex, raw404 }) => {
    const desc = esc(d || sv.tagline);
    const alt = BASE && !noindex ? codes.map(x => `<link rel="alternate" hreflang="${x}" href="${BASE + pre(x) + '/' + lp}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${BASE}/${lp}">` : '';
    const sw = codes.length > 1 && !raw404 ? codes.filter(x => x !== c).map(x => `<a class="lg" href="${pre(x)}/${lp}" hreflang="${x}" lang="${x}" title="${esc(t('lang_label'))}">${esc(LANGS.find(l => l.code === x).name)}</a>`).join('') : '';
    if (!noindex) urls.push(pre(c) + '/' + lp);
    const soc = Object.entries({ ...(OFFICIAL ? { official: OFFICIAL } : {}), ...(site.social || {}) }).filter(([, v]) => v).map(([k, v]) => `<a href="${esc(v)}" rel="noopener">${k === 'official' ? esc(t('footer_official')) : k === 'youtube' ? 'YouTube' : k === 'facebook' ? 'Facebook' : esc(k)}</a>`).join('');
    write(raw404 ? '404.html' : p.join(pre(c), lp, 'index.html'), `<!doctype html>
<html lang="${c}" dir="${L.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${esc(sv.brand)}</title><meta name="description" content="${desc}">
${noindex ? '<meta name="robots" content="noindex">' : ''}<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}"><meta property="og:type" content="website">
${BASE && !noindex ? `<link rel="canonical" href="${BASE + pre(c) + '/' + lp}"><meta property="og:url" content="${BASE + pre(c) + '/' + lp}">` : ''}${alt}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/style.css">
<script src="/assets/theme.js"></script>${lp === '' && !noindex ? org : ''}</head>
<body><header class="top"><a class="brand" href="${U('')}">${LOGO}<span>${esc(sv.brand)}</span></a>
<nav><a href="${U('apps/')}">${t('nav_apps')}</a><a href="${U('privacy/')}">${t('nav_privacy')}</a><a href="${U('support/')}">${t('nav_support')}</a>${sw}</nav>
<button id="th" class="ic" type="button" aria-label="${esc(t('theme'))}">◐</button></header>
<main>${b}</main>
<footer><p>© ${new Date().getFullYear()} ${esc(sv.brand)} — ${esc(sv.center)}</p><p><a href="${U('apps/')}">${t('footer_apps')}</a><a href="${U('privacy/')}">${t('footer_privacy')}</a><a href="${U('privacy/site/')}">${t('footer_site_privacy')}</a><a href="${U('support/')}">${t('footer_support')}</a></p>${soc ? `<p>${soc}</p>` : ''}<p>${t('footer_note')}</p></footer>
<script src="/assets/site.js" defer></script></body></html>`);
  };

  const ico = a => a.icon ? `<img class="ico" src="${esc(a.icon)}" alt="" width="64" height="64">` : `<span class="ico" aria-hidden="true">${esc([...a.name][0])}</span>`;
  const tag = a => `<span class="tag ${STC[a.status]}">${t(ST[a.status])}</span>`;
  const card = a => `<a class="card app" href="${U('apps/' + a.id + '/')}" data-name="${esc((a.name + ' ' + (a.short || '')).toLowerCase())}" data-cat="${esc(a.category || '')}">${ico(a)}<div><h3>${esc(a.name)}</h3><p>${esc(a.short || t('no_short'))}</p>${tag(a)}</div></a>`;
  const lst = v => Array.isArray(v) && v.length
    ? `<ul>${v.map(x => `<li>${typeof x === 'object' ? `<b>${esc(x.name)}</b>${x.purpose ? ' — ' + esc(x.purpose) : ''}` : esc(x)}</li>`).join('')}</ul>`
    : typeof v === 'string' && v.trim() ? `<p>${esc(v)}</p>` : `<p class="note">${t('pv_field_missing')}</p>`;
  const mail = site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>${t('pv_or')}` : '';
  const draftTag = ok => `<span class="tag ${ok ? 'ok' : 'wn'}">${ok ? t('pv_approved') : t('pv_isdraft')}</span>`;

  page('', { title: sv.center, b: `
<section class="hero"><h1>${esc(sv.center)}</h1><p>${esc(sv.tagline)}</p>
<p class="row"><a class="btn" href="${U('apps/')}">${t('hero_browse')}</a><a class="btn g" href="${U('support/')}">${t('hero_support')}</a></p></section>
<h2>${t('home_apps')}</h2><div class="grid">${A.map(card).join('')}</div>
<section class="box" style="margin-top:20px"><h2 style="margin-top:0">${t('transp_h')}</h2><p>${t('transp_p')}</p></section>` });

  const cats = [...new Set(A.map(a => a.category).filter(Boolean))];
  page('apps/', { title: t('store_h'), d: t('store_desc', { brand: sv.brand }), b: `
<h1>${t('store_h')}</h1>
<label for="q">${t('store_search')}</label><input id="q" type="search" placeholder="${esc(t('store_ph'))}">
${cats.length ? `<div class="chips"><button class="chip on" type="button" data-cat="">${t('store_all')}</button>${cats.map(x => `<button class="chip" type="button" data-cat="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
<div class="grid" style="margin-top:12px">${A.map(card).join('')}</div>
<p id="none" class="note" hidden>${t('store_none')}</p>` });

  A.forEach(a => {
    let dl = '';
    if (a.play_url) dl += `<p><a class="btn" href="${esc(a.play_url)}" rel="noopener" data-dl="${a.id}:play">${t('play')}</a></p>`;
    if (a.apk) dl += `<p><a class="btn g" style="color:var(--ac)" href="${esc(a.apk.url)}" rel="noopener" download data-dl="${a.id}:apk">${t('apk_dl')}${a.apk.size ? ' (' + esc(a.apk.size) + ')' : ''}</a></p>\n<p class="warn">${t('apk_warn')}</p><p>${t('sha')}</p><code>${esc(a.apk.sha256)}</code>`;
    if (!dl) dl = `<p class="note">${t('dl_none')}</p>`;
    const row = (k, v) => `<tr><th>${t(k)}</th><td>${v ? esc(v) : t('na')}</td></tr>`;
    const desc = a.description ? a.description.split(/\n{2,}/).map(x => `<p>${esc(x)}</p>`).join('') : `<p class="note">${t('no_desc')}</p>`;
    const rel = (a.releases || []).length ? `<ul>${a.releases.map(r => `<li><b>${esc(r.version)}</b>${r.date ? ' — ' + esc(r.date) : ''}${r.notes ? '<br>' + esc(r.notes) : ''}</li>`).join('')}</ul>` : `<p class="note">${t('no_rel')}</p>`;
    const rvs = JSON.stringify(Object.fromEntries(['rv_none', 'rv_avg', 'rv_ok', 'rv_err', 'rv_limit', 'rv_short', 'rv_reply', 'rv_anon', 'rv_load_err'].map(k => [k, t(k)]))).replace(/</g, '\\u003c');
    const rv = ['published', 'testing'].includes(a.status) ? `
<h2>${t('rv_h')}</h2><div id="rv" data-app="${a.id}"><p id="rv-sum" class="note">${t('rv_loading')}</p><div id="rv-list"></div>
<form id="rf" class="card" hidden><h3>${t('rv_write')}</h3><input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label for="rr">${t('rv_rating')}</label><select id="rr" name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})</option>`).join('')}</select>
<label for="rn">${t('rv_name')}</label><input id="rn" name="name" maxlength="60" autocomplete="nickname">
<label for="rt">${t('rv_text')}</label><textarea id="rt" name="text" required minlength="10" maxlength="1000"></textarea>
<p class="note">${t('rv_note')}</p><p><button class="btn" type="submit">${t('rv_send')}</button> <span id="rf-msg" role="status"></span></p></form></div>
<script type="application/json" id="rvs">${rvs}</script>` : '';
    page('apps/' + a.id + '/', { title: a.name, d: a.short || a.name, b: `
<p><a href="${U('apps/')}">${t('back_store')}</a></p>
<div class="head">${ico(a)}<div><h1>${esc(a.name)}</h1>${tag(a)}<p style="margin:4px 0 0;color:var(--mu)">${esc(a.short || '')}</p></div></div>
${a._has ? '' : `<p class="note">${t('untranslated')}</p>`}
<div class="card"><h2 style="margin-top:0">${t('dl_h')}</h2>${dl}</div>
<h2>${t('about_h')}</h2>${desc}
${(a.features || []).length ? `<h2>${t('features_h')}</h2><ul>${a.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
${(a.screenshots || []).length ? `<h2>${t('shots_h')}</h2><div class="shots">${a.screenshots.map(s => `<img loading="lazy" src="${esc(s)}" alt="${esc(t('shots_alt', { name: a.name }))}">`).join('')}</div>` : ''}
<h2>${t('details_h')}</h2><div class="card"><table>${row('d_status', t(ST[a.status]))}${row('d_version', a.version)}${row('d_updated', a.updated)}${row('d_size', a.size)}${row('d_android', a.min_android)}${row('d_cat', a.category)}</table></div>
<h2>${t('rel_h')}</h2>${rel}${rv}
<h2>${t('pp_h')}</h2><p><a href="${U('privacy/' + a.id + '/')}">${t('pp_link', { name: esc(a.name) })}</a> · <a href="${U('support/')}">${t('support_link')}</a></p>` });

    const pr = a.privacy || {};
    page('privacy/' + a.id + '/', { title: t('pv_title', { name: a.name }), b: `
<p><a href="${U('apps/' + a.id + '/')}">← ${esc(a.name)}</a></p><h1>${t('pv_h', { name: esc(a.name) })}</h1>
${pr.approved ? '' : `<p class="warn">${t('pv_draft')}</p>`}
<p>${t('pv_updated', { d: esc(pr.updated || t('pv_unset')) })}</p>
<p>${t('pv_intro', { name: esc(a.name), brand: esc(sv.brand) })}</p>
<h2>${t('pv_data')}</h2>${lst(pr.data_collected)}
<h2>${t('pv_perm')}</h2>${lst(pr.permissions)}
<h2>${t('pv_third')}</h2>${lst(pr.third_party)}
<h2>${t('pv_ret')}</h2>${lst(pr.retention)}
<h2>${t('pv_child')}</h2>${lst(pr.children)}
<h2>${t('pv_del')}</h2>${lst(pr.deletion)}
<h2>${t('pv_contact')}</h2><p>${t('pv_contact_p', { mail, form: U('support/') })}</p>` });
  });

  page('privacy/', { title: t('pvs_h'), b: `<h1>${t('pvs_h')}</h1><p>${t('pvs_p')}</p><div class="grid">
<a class="card app" href="${U('privacy/site/')}"><span class="ico" aria-hidden="true">◐</span><div><h3>${t('pv_site_card')}</h3>${draftTag((site.policy || {}).approved)}</div></a>
${A.map(a => `<a class="card app" href="${U('privacy/' + a.id + '/')}">${ico(a)}<div><h3>${esc(a.name)}</h3>${draftTag((a.privacy || {}).approved)}</div></a>`).join('')}</div>` });

  const sp = site.policy || {}, contact = site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : `<a href="${U('support/')}">${t('nav_support')}</a>`;
  page('privacy/site/', { title: t('sp_title'), b: `<h1>${t('sp_h')}</h1>${sp.approved ? '' : `<p class="warn">${t('sp_draft')}</p>`}
<p>${t('sp_updated', { d: esc(sp.updated || t('pv_unset')) })}</p><p>${t('sp_intro', { brand: esc(sv.brand) })}</p>
${t('sp').map(s => `<h2>${s.h}</h2>${s.p.map(x => `<p>${x.split('{contact}').join(contact)}</p>`).join('')}`).join('')}` });

  page('support/', { title: t('sup_h'), d: t('sup_h') + ' — ' + sv.brand, b: `
<h1>${t('sup_h')}</h1>${site.email ? `<p>${t('sup_mail')}: <a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>` : ''}
<form class="card" name="support" method="POST" action="${U('support/thanks/')}" data-netlify="true" netlify-honeypot="bot-field">
<input type="hidden" name="form-name" value="support"><p hidden><label>Do not fill: <input name="bot-field"></label></p>
<label for="n">${t('sup_name')}</label><input id="n" name="name" required maxlength="80">
<label for="e">${t('sup_email')}</label><input id="e" name="email" type="email" required maxlength="120">
<label for="a">${t('sup_app')}</label><select id="a" name="app"><option>${t('sup_site')}</option>${A.map(a => `<option>${esc(a.name)}</option>`).join('')}</select>
<label for="k">${t('sup_type')}</label><select id="k" name="type"><option>${t('sup_t1')}</option><option>${t('sup_t2')}</option><option>${t('sup_t3')}</option><option>${t('sup_t4')}</option></select>
<label for="m">${t('sup_msg')}</label><textarea id="m" name="message" required maxlength="3000"></textarea>
<p style="margin-bottom:0"><button class="btn" type="submit">${t('sup_send')}</button></p></form>
<h2>${t('faq_h')}</h2>
${[1, 2, 3].map(i => `<details><summary>${t('faq' + i + '_q')}</summary><p>${t('faq' + i + '_a')}</p></details>`).join('\n')}` });
  page('support/thanks/', { title: t('th_title'), noindex: true, b: `<h1>${t('th_h')}</h1><p>${t('th_p')}</p><p><a class="btn" href="${U('')}">${t('th_back')}</a></p>` });
  if (c === DEF) page('404', { title: t('nf_title'), noindex: true, raw404: true, b: `<h1>${t('nf_title')}</h1><p>${t('nf_p', { home: U(''), store: U('apps/') })}</p>` });
}
codes.forEach(render);

write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n${BASE ? 'Sitemap: ' + BASE + '/sitemap.xml\n' : ''}`);
if (BASE) write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${BASE + u}</loc></url>`).join('\n')}\n</urlset>\n`);
else console.warn('تنبيه: رابط الموقع غير محدد (site.json ← url)، لن يُنشأ sitemap.xml ولا روابط canonical/hreflang.');
if (BASE) console.log('رابط الموقع: ' + BASE + ' (المصدر: ' + SU.source + ')');
const cp = (from, to) => { fs.mkdirSync(p.dirname(p.join(D, to)), { recursive: true }); fs.copyFileSync(p.join(R, from), p.join(D, to)); };
['style.css', 'site.js', 'theme.js', 'favicon.svg'].forEach(f => cp(f, 'assets/' + f));
cp('admin.html', 'admin/index.html'); cp('admin.js', 'admin/admin.js');
// الصور: من جذر المجلد ومن media/ (الرفع من لوحة التحكم يضعها في media/)
const imgs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => p.join(d, f)) : [];
[...imgs(R), ...imgs(p.join(R, 'media'))].forEach(f => cp(p.relative(R, f), 'media/' + p.basename(f)));
console.log(`تم: ${apps.length} تطبيق، ${codes.length} لغة، ${urls.length} صفحة في dist/`);
