(()=>{
const r=document.documentElement,b=document.getElementById('th');
if(b)b.onclick=()=>{const d=(r.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'))==='dark'?'light':'dark';r.dataset.theme=d;try{localStorage.setItem('theme',d)}catch(e){}};
const q=document.getElementById('q'),cs=[...document.querySelectorAll('.chip')],cards=[...document.querySelectorAll('.app[data-name]')],none=document.getElementById('none');
let cat='';
const f=()=>{const t=(q?q.value:'').trim().toLowerCase();let n=0;cards.forEach(c=>{const ok=(!t||c.dataset.name.includes(t))&&(!cat||c.dataset.cat===cat);c.hidden=!ok;if(ok)n++});if(none)none.hidden=n>0};
if(q)q.oninput=f;
cs.forEach(c=>c.onclick=()=>{cat=c.dataset.cat;cs.forEach(x=>x.classList.toggle('on',x===c));f()});

// إحصائيات مجهولة: بلا كوكيز ولا IP؛ تُتجاهل مع إشارة «عدم التتبع» وعلى localhost
const track=o=>{try{navigator.sendBeacon('/api/track',new Blob([JSON.stringify(o)],{type:'application/json'}))}catch(e){}};
if(navigator.doNotTrack!=='1'&&!/^(localhost|127\.)/.test(location.hostname)){
  track({t:'v',path:location.pathname});
  document.addEventListener('click',e=>{const a=e.target.closest('[data-dl]');if(a){const x=a.dataset.dl.split(':');track({t:'d',app:x[0],kind:x[1]})}});
}

// التقييمات
const rv=document.getElementById('rv');
if(rv){
  const S=JSON.parse(document.getElementById('rvs').textContent),app=rv.dataset.app,t0=Date.now();
  const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
  const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
  const sum=document.getElementById('rv-sum'),list=document.getElementById('rv-list'),form=document.getElementById('rf'),msg=document.getElementById('rf-msg');
  fetch('/api/reviews?app='+encodeURIComponent(app)).then(r=>r.ok?r.json():Promise.reject()).then(d=>{
    sum.textContent=d.count?S.rv_avg.replace('{avg}',d.avg.toFixed(1)).replace('{n}',d.count):S.rv_none;
    d.reviews.forEach(v=>{
      const c=el('div','card rev');
      c.append(el('b','',stars(v.rating)+' '),el('span','',v.name||S.rv_anon),el('small','',' · '+new Date(v.date).toLocaleDateString(r.lang)),el('p','',v.text));
      if(v.reply){const rp=el('p','note');rp.append(el('b','',S.rv_reply+': '),document.createTextNode(v.reply));c.append(rp)}
      list.append(c);
    });
  }).catch(()=>{sum.textContent=S.rv_load_err});
  form.hidden=false;
  form.onsubmit=async e=>{
    e.preventDefault();msg.textContent='';
    const d=Object.fromEntries(new FormData(form));
    if((d.text||'').trim().length<10){msg.textContent=S.rv_short;return}
    form.querySelector('button').disabled=true;
    try{
      const res=await fetch('/api/reviews',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app,rating:+d.rating,name:d.name,text:d.text,website:d.website,elapsed:Date.now()-t0})});
      if(res.ok){form.reset();msg.textContent=S.rv_ok}
      else{msg.textContent=res.status===429?S.rv_limit:S.rv_err;form.querySelector('button').disabled=false}
    }catch(x){msg.textContent=S.rv_err;form.querySelector('button').disabled=false}
  };
}
})();
