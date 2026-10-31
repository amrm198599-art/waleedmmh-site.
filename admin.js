(()=>{
const $=s=>document.querySelector(s),app=$('#app');
const h=(t,a,...c)=>{const e=document.createElement(t);for(const k in a||{}){if(k==='class')e.className=a[k];else if(k.startsWith('on'))e[k]=a[k];else if(a[k]!==false&&a[k]!=null)e.setAttribute(k,a[k]===true?'':a[k])}c.flat().forEach(x=>e.append(x&&x.nodeType?x:document.createTextNode(x??'')));return e};
const say=(m,bad)=>{const b=$('#msg');b.replaceChildren(h('p',{class:bad?'warn':'okm',role:'status'},...(Array.isArray(m)?m:[m]).flatMap((x,i)=>i?[h('br'),x]:[x])));if(!bad)setTimeout(()=>b.replaceChildren(),6000)};
let tok=sessionStorage.getItem('tk'),site=null;
const api=async(p,o={})=>{
  const r=await fetch('/api/admin/'+p,{method:o.m||'GET',headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:o.b?JSON.stringify(o.b):undefined});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&p!=='login'){tok=null;sessionStorage.removeItem('tk');login('انتهت الجلسة، سجّل الدخول مجدداً.')}
  if(!r.ok){const e=new Error(j.error||'خطأ');e.details=j.details;throw e}
  return j;
};
const rc=(el,x)=>el.replaceChildren(...[].concat(x));
const fail=e=>say([e.message,...(e.details||[])],true);
$('#out').onclick=()=>{tok=null;sessionStorage.removeItem('tk');login()};

// ---------- الدخول ----------
function login(note){
  $('#out').hidden=true;
  const pw=h('input',{type:'password',id:'pw',autocomplete:'current-password',required:true});
  app.replaceChildren(h('form',{class:'card',style:'max-width:380px;margin:30px auto',onsubmit:async e=>{e.preventDefault();try{const j=await api('login',{m:'POST',b:{password:pw.value}});tok=j.token;sessionStorage.setItem('tk',tok);main()}catch(x){fail(x)}}},
    h('h1',{},'تسجيل الدخول'),note?h('p',{class:'warn'},note):'',h('label',{for:'pw'},'كلمة مرور الإدارة'),pw,h('p',{},h('button',{class:'btn',type:'submit'},'دخول'))));
}

// ---------- الهيكل ----------
const TABS=[['apps','التطبيقات'],['stats','الإحصائيات'],['reviews','التقييمات'],['site','بيانات الموقع'],['health','حالة الإعداد']];
let cur='apps';
async function main(){
  $('#out').hidden=false;
  try{site=(await api('site')).site}catch(e){fail(e)}
  show(cur);
}
function show(t){
  cur=t;const box=h('div');
  app.replaceChildren(h('div',{class:'tabs'},TABS.map(([k,l])=>h('button',{type:'button',class:k===t?'on':'',onclick:()=>show(k)},l))),box);
  ({apps:viewApps,stats:viewStats,reviews:viewReviews,site:viewSite,health:viewHealth})[t](box).catch(fail);
}

// ---------- تحويل الحقول ----------
const lines=v=>Array.isArray(v)?v.map(x=>typeof x==='object'?x.name+(x.purpose?' — '+x.purpose:''):x).join('\n'):(v||'');
const split=s=>s.split('\n').map(x=>x.trim()).filter(Boolean);
const toStrOrArr=s=>{const l=split(s);return l.length?l.length===1?l[0]:l:null};
const toPairs=s=>{const l=split(s).map(x=>{const i=x.indexOf(' — ');return i>0?{name:x.slice(0,i).trim(),purpose:x.slice(i+3).trim()}:x});return l.length?l.length===1&&typeof l[0]==='string'?l[0]:l:null};
const toRel=s=>split(s).map(x=>{const p=x.split('|').map(y=>y.trim());return{version:p[0],date:p[1]||null,notes:p[2]||null}});
const relTxt=v=>(v||[]).map(r=>[r.version,r.date||'',r.notes||''].join(' | ')).join('\n');
const get=(o,k)=>k.split('.').reduce((a,x)=>a==null?a:a[x],o);
const set=(o,k,v)=>{const p=k.split('.');p.slice(0,-1).forEach(x=>o=o[x]=o[x]||{});o[p[p.length-1]]=v};

const F=[
 ['id','المعرّف (حروف إنجليزية صغيرة وأرقام وشرطة، لا يتغير لاحقاً)','text',{ltr:1}],['name','اسم التطبيق','text'],
 ['status','الحالة','select',['coming','testing','published','paused']],['order','الترتيب في القائمة','number'],
 ['category','التصنيف','text'],['short','وصف قصير','text'],['description','الوصف الكامل (افصل الفقرات بسطر فارغ)','area'],
 ['features','المميزات (سطر لكل ميزة)','lines'],['version','الإصدار','text'],['updated','آخر تحديث (YYYY-MM-DD)','text'],
 ['size','الحجم','text'],['min_android','أندرويد المطلوب','text'],['icon','الأيقونة','img'],['screenshots','لقطات الشاشة','imgs'],
 ['play_url','رابط Google Play (https)','text',{ltr:1}],['apk.url','رابط تنزيل APK (https، يُستضاف خارج المستودع)','text',{ltr:1}],
 ['apk.sha256','بصمة SHA-256 لملف APK (64 خانة)','text',{ltr:1}],['apk.size','حجم APK','text'],
 ['releases','سجل الإصدارات (سطر لكل إصدار: الإصدار | التاريخ | الملاحظات)','rel']];
const PF=[['approved','اعتماد السياسة (لا تفعّله قبل مراجعتها)','check'],['updated','تاريخ آخر تحديث للسياسة','text'],
 ['data_collected','البيانات التي يجمعها التطبيق (سطر لكل بند؛ لعدم الجمع اكتب ذلك صراحةً)','sarr'],['permissions','الأذونات وسبب كل إذن (سطر: الإذن — السبب)','pairs'],
 ['third_party','الطرف الثالث والإعلانات والتحليلات','pairs'],['retention','الاحتفاظ بالبيانات','sarr'],['children','الأطفال','sarr'],['deletion','حذف البيانات وحقوق المستخدم','sarr']];
const TR=[['name','الاسم','text'],['category','التصنيف','text'],['short','وصف قصير','text'],['description','الوصف الكامل','area'],['features','المميزات (سطر لكل ميزة)','lines'],['min_android','أندرويد المطلوب','text']];

// ---------- بناء عنصر حقل + قراءة قيمته ----------
function field(def,val,fmeta){
  const [k,l,t,x]=def,id='f_'+Math.random().toString(36).slice(2),wrap=h('div',{class:'fld'});
  let inp,read;
  if(t==='check'){inp=h('input',{type:'checkbox',id,style:'width:auto'});inp.checked=!!val;wrap.append(h('label',{for:id,style:'display:flex;gap:8px;align-items:center'},inp,l));return{el:wrap,k,read:()=>inp.checked}}
  wrap.append(h('label',{for:id},l));
  if(t==='select'){inp=h('select',{id},x.map(o=>h('option',{value:o},{coming:'قيد التجهيز',testing:'قيد الاختبار',published:'منشور',paused:'متوقف'}[o])));inp.value=val||x[0];read=()=>inp.value}
  else if(t==='number'){inp=h('input',{id,type:'number',min:1});inp.value=val??'';read=()=>inp.value===''?null:+inp.value}
  else if(t==='img'){const c=imgField(val,false);wrap.append(c.el);return{el:wrap,k,read:c.read}}
  else if(t==='imgs'){const c=imgField(val||[],true);wrap.append(c.el);return{el:wrap,k,read:c.read}}
  else{
    const area=['area','lines','sarr','pairs','rel'].includes(t);
    inp=h(area?'textarea':'input',{id,...(area?{rows:t==='area'?6:4}:{type:'text'}),class:x&&x.ltr?'lnk':''});
    inp.value=t==='rel'?relTxt(val):['lines','sarr','pairs'].includes(t)?lines(val):(val??'');
    read=()=>{const v=inp.value;return t==='lines'?split(v):t==='sarr'?toStrOrArr(v):t==='pairs'?toPairs(v):t==='rel'?toRel(v):v.trim()||null};
  }
  wrap.append(inp);return{el:wrap,k,read};
}
function imgField(val,multi){
  let cur=multi?[...val]:val?[val]:[];const box=h('div'),thumbs=h('div'),fi=h('input',{type:'file',accept:'image/png,image/jpeg,image/webp',...(multi?{multiple:true}:{})});
  const paint=()=>rc(thumbs,cur.map((u,i)=>h('span',{},h('img',{class:'thumb',src:u,alt:''}),h('button',{type:'button',class:'x',onclick:()=>{cur.splice(i,1);paint()}},'✕'))));
  fi.onchange=async()=>{for(const f of fi.files){
    if(f.size>2e6){say('«'+f.name+'»: الحجم أكبر من 2MB.',true);continue}
    const name=f.name.toLowerCase().replace(/[^a-z0-9._-]/g,'-').replace(/^[^a-z0-9]+/,'')||('img-'+Date.now()+'.'+f.type.split('/')[1].replace('jpeg','jpg'));
    const data=await new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result.split(',')[1]);x.readAsDataURL(f)});
    try{const j=await api('upload',{m:'POST',b:{name,data}});multi?cur.push(j.url):cur=[j.url];paint();say('رُفعت «'+name+'» وستظهر على الموقع بعد البناء.')}catch(e){fail(e)}
  }fi.value=''};
  paint();box.append(thumbs,fi);return{el:box,read:()=>multi?cur:(cur[0]||null)};
}
const sect=(title,defs,obj,open)=>{const d=h('details',open?{open:true}:{},h('summary',{},title));const fs=defs.map(def=>field(def,get(obj,def[0])));fs.forEach(f=>d.append(f.el));return{el:d,fs}};

// ---------- التطبيقات ----------
async function viewApps(box){
  const {apps}=await api('apps');
  box.replaceChildren(h('p',{},h('button',{class:'btn',type:'button',onclick:()=>edit(box,null,null,apps)},'+ تطبيق جديد')),
    apps.length?h('div',{class:'grid'},apps.sort((a,b)=>(a.data.order||99)-(b.data.order||99)).map(a=>h('div',{class:'card'},h('h3',{},a.data.name||a.data.id),h('p',{class:'note'},'الحالة: '+({coming:'قيد التجهيز',testing:'قيد الاختبار',published:'منشور',paused:'متوقف'}[a.data.status]||a.data.status)+' · السياسة: '+((a.data.privacy||{}).approved?'معتمدة':'مسودة')),
      h('button',{class:'sm',type:'button',onclick:()=>edit(box,a.data,a.sha,apps)},'تعديل')))):h('p',{class:'note'},'لا توجد تطبيقات.'));
}
// ---------- رفع APK لتعبئة الحقول (يُقرأ على جهازك ولا يُرفع) ----------
function apkPanel(isNew,main,priv,trs){
  const fi=h('input',{type:'file',accept:'.apk,application/vnd.android.package-archive'}),out=h('div');
  const inp=(fs,k)=>{const f=fs.find(x=>x.k===k);return f&&f.el.querySelector('input,textarea')};
  const val=(fs,k)=>(inp(fs,k)||{value:''}).value.trim();
  const put=(fs,k,v,keep)=>{const i=inp(fs,k);if(!i||v==null||(keep&&i.value.trim()))return false;i.value=v;return true};
  const NM={id:'المعرّف',name:'الاسم',version:'الإصدار',updated:'آخر تحديث',size:'الحجم',min_android:'أندرويد المطلوب','apk.size':'حجم APK','apk.sha256':'بصمة SHA-256'};
  fi.onchange=async()=>{
    const f=fi.files[0];if(!f)return;
    if(!window.ApkReader){say('قارئ APK لم يُحمَّل؛ حدّث الصفحة وأعد المحاولة.',true);return}
    rc(out,h('p',{class:'note'},'جارٍ قراءة الملف على جهازك (لا يُرفع إلى أي مكان)…'));
    try{
      const info=await window.ApkReader.readApk(f),d=new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
      const pl=window.ApkReader.plan(info,{isNew,today:d,langs:trs.map(t=>t.code),current:{id:val(main.fs,'id'),name:val(main.fs,'name'),permissions:split(inp(priv.fs,'permissions').value)}});
      const done=[];
      Object.entries(pl.set).forEach(([k,x])=>{if(put(main.fs,k,x,k==='id'||k==='name'))done.push(NM[k]||k)});
      const rel=inp(main.fs,'releases');
      if(rel&&pl.set.version&&!split(rel.value).some(l=>l===pl.set.version||l.startsWith(pl.set.version+' |'))){rel.value=[pl.set.version+' | '+d+' | ',rel.value.trim()].filter(Boolean).join('\n');done.push('سجل الإصدارات')}
      const pf=put(priv.fs,'permissions',pl.perms.ar.join('\n'),true);if(pf)done.push('الأذونات (العربية)');
      trs.forEach(t=>{if(pl.tr[t.code]&&put(t.meta.fs,'min_android',pl.tr[t.code].min_android))done.push('أندرويد المطلوب ('+t.code+')');
        if(pf&&t.code==='en'&&put(t.pv.fs,'permissions',pl.perms.en.join('\n'),true))done.push('الأذونات (en)')});
      rc(out,h('div',{class:'card'},h('b',{},'تمت القراءة: '+(info.label||info.package||f.name)),h('p',{class:'note'},'الحزمة: '+(info.package||'—')+' · versionCode: '+(info.versionCode??'—')),
        h('p',{},'عُبّئت الحقول: '+(done.join('، ')||'لا شيء')),
        pl.notes.length?h('ul',{},pl.notes.map(n=>h('li',{},n))):'',
        pl.hints.length?[h('b',{},'تنبيهات من ملف manifest:'),h('ul',{},pl.hints.map(n=>h('li',{},n)))]:'',
        h('p',{class:'note'},'البصمة محسوبة من هذا الملف نفسه، فارفع للاستضافة الملف ذاته دون أي تعديل. الفحص يعتمد على AndroidManifest فقط، وغياب تنبيه لا يعني غياب مكتبة أو سلوك. الوصف والتصنيف وبقية بنود السياسة (البيانات والطرف الثالث والاحتفاظ والحذف) تكتبها أنت، وتبقى السياسة مسودة حتى تعتمدها.'),
        val(main.fs,'apk.url')?'':h('p',{class:'warn'},'ضع رابط تنزيل APK (https) بعد رفعه لاستضافة ثابتة مثل GitHub Releases ثم احفظ؛ الحفظ يرفض البصمة بلا رابط.')));
    }catch(e){rc(out,'');say(e instanceof RangeError?'الملف كبير على ذاكرة جهازك؛ جرّب من حاسوب.':(e.message||'تعذّرت قراءة الملف'),true)}
    fi.value='';
  };
  return h('details',{open:true},h('summary',{},'رفع ملف APK لتعبئة الحقول تلقائياً'),h('p',{class:'note'},'اختر ملف APK فيُقرأ هنا على جهازك (لا يُرفع)، وتُعبّأ الحقول المستخرجة منه: الاسم والإصدار والحجم والبصمة وأقل أندرويد والأذونات.'),fi,out);
}

function edit(box,orig,sha,apps){
  const isNew=!orig,o=JSON.parse(JSON.stringify(orig||{status:'coming',features:[],screenshots:[],releases:[],privacy:{approved:false}}));
  const main=sect('البيانات الأساسية',F,o,true);
  if(!isNew)main.fs.find(f=>f.k==='id').el.querySelector('input').disabled=true;
  const priv=sect('سياسة الخصوصية (العربية)',PF,o.privacy||{},false);
  const langs=(site.languages||[]).filter(l=>l.code!==site.default_lang);
  const trs=langs.map(l=>{o.i18n=o.i18n||{};const t=o.i18n[l.code]||{};return{code:l.code,meta:sect('ترجمة: '+l.name,TR,t,false),pv:sect('سياسة الخصوصية: '+l.name,PF,t.privacy||{},false)}});
  const apkp=apkPanel(isNew,main,priv,trs);
  const save=async()=>{
    const a={...o};
    main.fs.forEach(f=>{const v=f.read();set(a,f.k,v)});
    if(!a.apk||(!a.apk.url&&!a.apk.sha256&&!a.apk.size))a.apk=null;else if(!a.apk.size)delete a.apk.size;
    a.privacy={...(o.privacy||{})};priv.fs.forEach(f=>a.privacy[f.k]=f.read());
    a.i18n={...(o.i18n||{})};
    trs.forEach(t=>{const x={...(a.i18n[t.code]||{})};t.meta.fs.forEach(f=>{const v=f.read();if(v==null||v===''||(Array.isArray(v)&&!v.length))delete x[f.k];else x[f.k]=v});
      const pv={...(x.privacy||{})};t.pv.fs.forEach(f=>{pv[f.k]=f.read()});
      if(Object.values(pv).some(v=>v&&!(Array.isArray(v)&&!v.length)))x.privacy=pv;else delete x.privacy;
      if(Object.keys(x).length)a.i18n[t.code]=x;else delete a.i18n[t.code]});
    if(!Object.keys(a.i18n).length)delete a.i18n;
    try{await api('apps/'+encodeURIComponent(a.id||'x'),{m:'PUT',b:{app:a,sha}});say('تم الحفظ. سيظهر التعديل على الموقع بعد انتهاء البناء (دقيقة تقريباً).');show('apps')}catch(e){fail(e)}
  };
  const del=!isNew&&h('button',{class:'sm dn',type:'button',onclick:async()=>{if(!confirm('حذف «'+o.name+'» نهائياً من الموقع؟'))return;try{await api('apps/'+o.id,{m:'DELETE'});say('تم الحذف.');show('apps')}catch(e){fail(e)}}},'حذف التطبيق');
  box.replaceChildren(h('p',{},h('button',{class:'sm',type:'button',onclick:()=>show('apps')},'← القائمة')),h('h2',{style:'margin-top:0'},isNew?'تطبيق جديد':o.name),
    h('div',{class:'card'},apkp,main.el,priv.el,trs.flatMap(t=>[t.meta.el,t.pv.el])),
    h('p',{class:'row'},h('button',{class:'btn',type:'button',onclick:save},'حفظ'),del||''));
}

// ---------- الإحصائيات ----------
async function viewStats(box){
  const sel=h('select',{onchange:()=>load(+sel.value),style:'width:auto'},[7,30,60].map(n=>h('option',{value:n,selected:n===30},n+' يوماً')));
  const out=h('div');box.append(h('p',{},sel),out);
  const rows=(o,fmt)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>h('tr',{},h('td',{class:'lnk'},fmt?fmt(k):k),h('td',{},String(v))));
  async function load(n){
    const s=await api('stats?days='+n),mx=Math.max(1,...s.days.map(d=>Math.max(d.views,d.downloads)));
    out.replaceChildren(
      h('div',{class:'two'},h('div',{class:'card'},h('h3',{},'مشاهدات الصفحات'),h('b',{style:'font-size:28px'},String(s.views))),h('div',{class:'card'},h('h3',{},'نقرات أزرار التنزيل'),h('b',{style:'font-size:28px'},String(s.dl)))),
      h('div',{class:'bars',title:'مشاهدات (أزرق) ونقرات تنزيل (أخضر) يومياً'},s.days.flatMap(d=>[h('i',{style:'height:'+(d.views/mx*100)+'%',title:d.day+': '+d.views}),h('i',{class:'d',style:'height:'+(d.downloads/mx*100)+'%',title:d.day+': '+d.downloads+' تنزيل'})])),
      h('h3',{},'أكثر الصفحات زيارة'),s.views?h('table',{},rows(s.pages)):h('p',{class:'note'},'لا توجد بيانات بعد.'),
      h('h3',{},'النقرات على التنزيل لكل تطبيق'),s.dl?h('table',{},rows(s.downloads,k=>k.replace(':play',' — Google Play').replace(':apk',' — APK'))):h('p',{class:'note'},'لا توجد نقرات بعد.'),
      h('p',{class:'note'},'الأرقام تقريبية: تُحسب زيارات المتصفحات التي لا ترسل «عدم التتبع»، وتُستبعد الروبوتات المعروفة. نقرات التنزيل ليست عدد التثبيتات الفعلي؛ عدد التثبيتات الحقيقي تجده في Google Play Console.'));
  }
  await load(30);
}

// ---------- التقييمات ----------
async function viewReviews(box){
  let st='pending';const out=h('div'),bar=h('div',{class:'tabs'});box.append(bar,out);
  async function load(){
    const j=await api('reviews?status='+st);
    rc(bar,[['pending','بانتظار المراجعة'],['approved','معتمدة'],['rejected','مرفوضة']].map(([k,l])=>h('button',{type:'button',class:k===st?'on':'',onclick:()=>{st=k;load().catch(fail)}},l+' ('+j.counts[k]+')')));
    rc(out,j.reviews.length?j.reviews.map(r=>{
      const rep=h('textarea',{rows:2,maxlength:500,placeholder:'ردّك العلني (اختياري)'});rep.value=r.reply||'';
      const act=(b,okm)=>async()=>{try{await api('reviews/'+r.app+'/'+r.id,{m:'PATCH',b:b()});say(okm);load()}catch(e){fail(e)}};
      return h('div',{class:'card',style:'margin-bottom:8px'},h('b',{},'★'.repeat(r.rating)+'☆'.repeat(5-r.rating)+' · '+r.app),h('small',{},' · '+(r.name||'بلا اسم')+' · '+new Date(r.date).toLocaleString('ar')),h('p',{},r.text),rep,
        h('p',{class:'row'},r.status!=='approved'?h('button',{class:'sm',type:'button',onclick:act(()=>({status:'approved',reply:rep.value}),'اعتُمد التقييم وظهر على الموقع.')},'اعتماد'):'',r.status==='approved'?h('button',{class:'sm',type:'button',onclick:act(()=>({reply:rep.value}),'حُفظ الرد.')},'حفظ الرد'):'',
          r.status!=='rejected'?h('button',{class:'sm',type:'button',onclick:act(()=>({status:'rejected'}),'رُفض التقييم.')},'رفض'):'',
          h('button',{class:'sm dn',type:'button',onclick:async()=>{if(!confirm('حذف التقييم نهائياً؟'))return;try{await api('reviews/'+r.app+'/'+r.id,{m:'DELETE'});load()}catch(e){fail(e)}}},'حذف')));
    }):h('p',{class:'note'},'لا توجد تقييمات هنا.'));
  }
  await load();
}

// ---------- بيانات الموقع ----------
async function viewSite(box){
  const {site:s,sha}=await api('site'),o=JSON.parse(JSON.stringify(s));
  const SF=[['brand','اسم العلامة','text'],['center','اسم المركز','text'],['tagline','الوصف المختصر','text'],['email','بريد الدعم العلني (يظهر في الموقع وسياسات الخصوصية)','text',{ltr:1}],['url','رابط نشر الموقع البرمجي (Netlify/دومين المشروع) — يُستخدم لـ canonical وsitemap، اتركه فارغاً لو لم يتحدد','text',{ltr:1}],['official_url','الموقع الرسمي المرجعي (مثل Google Sites) — يظهر في التذييل وبيانات SEO فقط','text',{ltr:1}],
    ['social.youtube','رابط YouTube','text',{ltr:1}],['social.facebook','رابط Facebook','text',{ltr:1}],['policy.approved','اعتماد سياسة خصوصية الموقع (بعد مراجعتها)','check'],['policy.updated','تاريخ آخر تحديث لسياسة الموقع','text']];
  const m=sect('بيانات الموقع',SF,o,true);
  const langs=(s.languages||[]).filter(l=>l.code!==s.default_lang).map(l=>({l,sc:sect('ترجمة: '+l.name,[['center','اسم المركز','text'],['tagline','الوصف المختصر','text']],(o.i18n||{})[l.code]||{},false)}));
  const save=async()=>{const a={...o};m.fs.forEach(f=>set(a,f.k,f.read()));a.i18n={...(o.i18n||{})};
    langs.forEach(({l,sc})=>{const x={};sc.fs.forEach(f=>{const v=f.read();if(v)x[f.k]=v});if(Object.keys(x).length)a.i18n[l.code]=x;else delete a.i18n[l.code]});
    try{await api('site',{m:'PUT',b:{site:a,sha}});site=a;say('تم الحفظ. سيظهر على الموقع بعد البناء.');show('site')}catch(e){fail(e)}};
  box.replaceChildren(h('div',{class:'card'},m.el,langs.map(x=>x.sc.el)),h('p',{class:'note'},'إضافة لغة جديدة تتم بملف ‎xx.lang.json‎ وإدخالها في languages داخل site.json (راجع README).'),h('p',{},h('button',{class:'btn',type:'button',onclick:save},'حفظ')));
}

// ---------- حالة الإعداد ----------
async function viewHealth(box){
  const c=await api('health'),R=[['admin_password','ADMIN_PASSWORD (12 حرفاً فأكثر)'],['session_secret','SESSION_SECRET (32 حرفاً فأكثر)'],['github_token','GITHUB_TOKEN'],['github_repo','GITHUB_REPO'],['repo_access','الوصول لقراءة المستودع'],['blobs','تخزين Netlify Blobs (التقييمات والإحصائيات)']];
  box.replaceChildren(h('div',{class:'card'},h('table',{},R.map(([k,l])=>h('tr',{},h('td',{},l),h('td',{class:c[k]?'':'warn'},c[k]?'✔ جاهز':'✘ غير جاهز'))))),h('p',{class:'note'},'الحفظ من هذه اللوحة يُنشئ commit في GitHub فيعيد Netlify بناء الموقع تلقائياً.'));
}
tok?main():login();
})();
