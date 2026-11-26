// Zkušební náhrada supabase-js: posílá dotazy na lokální server s PostgreSQL.
(function(){
const ss=sessionStorage;
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-User':ss.getItem('uid')||''},body:JSON.stringify(body)});const j=await r.json();return r.ok?{data:j,error:null}:{data:null,error:j}}
function from(table){const q={table,eq:{}};let single=false,head=false;
 const api={select(cols,o){q.cols=(cols||'*').replace(/\s/g,'');head=!!(o&&o.head);return api},eq(k,v){q.eq[k]=v;return api},order(k,o){q.order=[k,!o||o.ascending!==false];return api},limit(n){q.limit=n;return api},maybeSingle(){single=true;return api},
  then(res,rej){return post('/select',q).then(r=>{if(r.error)return res(r);if(head)return res({data:null,count:r.data.length,error:null});return res({data:single?(r.data[0]||null):r.data,error:null})},rej)}};return api}
window.supabase={createClient(){return{
 auth:{async getUser(){const id=ss.getItem('uid');return{data:{user:id?{id}:null}}},
  async signInWithPassword({email,password}){const r=await post('/login',{email,password});if(r.error)return{error:r.error};ss.setItem('uid',r.data.id);return{error:null}},
  async signOut(){ss.removeItem('uid')}},
 from, rpc:(n,a)=>post('/rpc/'+n,a||{}),
 functions:{async invoke(){return{data:null,error:{message:'Funkce ucty se v testu nevolá'}}}},
 storage:{from(){return{async createSignedUrl(){return{data:{signedUrl:'about:blank'}}},async upload(path){window.__uploaded=path;return{data:{path},error:null}}}}}
}}};
})();
