const base='http://127.0.0.1:10000';
let cookie='';
async function get(path){return fetch(base+path,{headers:cookie?{Cookie:cookie}:{}});}
async function post(path,body){return fetch(base+'/api/'+path,{method:'POST',
  headers:{'Content-Type':'application/json','Origin':base,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
function assert(ok,msg){if(!ok)throw Error(msg);}
const poll=async()=>{for(let i=0;i<25;i++){try{const r=await get('/api/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,600));}throw Error('DB not ready');};
await poll();
let r=await get('/api/me');assert(r.ok&&((await r.json()).user===null),'anonymous me');
r=await post('register',{username:'testuser_123',password:'TrulySafe123!',accept:true});
const data=await r.json();assert(r.status===201&&data.user.username==='testuser_123'&&data.recoveryCode,'register '+JSON.stringify(data));
cookie=(r.headers.get('set-cookie')||'').split(';')[0];assert(cookie.startsWith('iron_shift_beta='),'Secure cookie');
r=await get('/api/me');assert(r.ok&&((await r.json()).user.username==='testuser_123'),'authenticated me');
r=await post('recovery-ok',{code:data.recoveryCode});assert(r.ok&&(await r.json()).user.hasRecovery,'recovery confirmation');
r=await post('profile',{displayName:'IronCaptain'});assert(r.ok&&(await r.json()).user.displayName==='IronCaptain','profile change');
r=await post('arsenal',{data:{v:1,cfg:{test:true}}});assert(r.ok,'arsenal save');
r=await get('/api/arsenal');assert(r.ok&&(await r.json()).data.cfg.test,'arsenal load');
r=await post('logout',{});assert(r.ok,'logout');cookie='';
r=await post('login',{login:'testuser_123',password:'TrulySafe123!'});assert(r.ok,'login');
cookie=(r.headers.get('set-cookie')||'').split(';')[0];
r=await get('/api/leaderboard?scope=all&offset=0');assert(r.ok&&(await r.json()).players.length===1,'leaderboard');
r=await post('account-export',{});assert(r.ok&&(await r.json()).user.username==='testuser_123','GDPR export');
r=await post('account-delete',{confirm:'testuser_123',password:'TrulySafe123!'});assert(r.ok&&(await r.json()).deleted,'account deletion');
cookie='';r=await get('/api/me');assert(r.ok&&(await r.json()).user===null,'logout after delete');
console.log('PASS: registration, recovery, sessions, profile, cross-request storage, leaderboard, export & deletion');
