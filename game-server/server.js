'use strict';
// IRON SHIFT — private BETA account server. Existing FPS engine is untouched.
// No paid currency, no entitlement sales, no false server-authoritative gameplay.
const express = require('express');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const { Pool } = require('pg');
const { rateLimit } = require('express-rate-limit');

const scrypt = promisify(crypto.scrypt);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req,res,next) => { res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');next(); });
app.use('/api', express.json({limit:'24kb'}), (req,res,next)=>{
  res.set('Cache-Control','no-store');
  if (req.method === 'POST') {
    const origin = req.get('Origin');
    if (!origin || (()=>{try{return new URL(origin).host !== req.get('host');}catch{return true;}})())
      return res.status(403).json({error:'Invalid request origin'});
    if (!req.is('application/json')) return res.status(415).json({error:'JSON required'});
  }
  next();
});
const limit = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Too many attempts; try again later'}});
app.use('/api/register',limit);
app.use('/api/login',limit);
app.use('/api/password-recover',limit);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max:5, connectionTimeoutMillis:7000, idleTimeoutMillis:10000,
  ssl: process.env.DB_SSL === 'true' ? {rejectUnauthorized:true} : undefined
}) : null;
let ready=false;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const schema=[
  'CREATE TABLE IF NOT EXISTS beta_users (id BIGSERIAL PRIMARY KEY, username VARCHAR(16) UNIQUE NOT NULL, display_name VARCHAR(16) NOT NULL, password_hash TEXT NOT NULL, recovery_hash TEXT, recovery_ok BOOLEAN NOT NULL DEFAULT FALSE, xp INT NOT NULL DEFAULT 0, arsenal JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS beta_sessions (token_hash CHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL)',
  'CREATE INDEX IF NOT EXISTS beta_session_expiry ON beta_sessions(expires_at)',
  'CREATE TABLE IF NOT EXISTS beta_tickets (token_hash CHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  'CREATE TABLE IF NOT EXISTS beta_matches (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE, played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), map VARCHAR(30), mode VARCHAR(25), result VARCHAR(10), online BOOLEAN NOT NULL DEFAULT FALSE, duration INT NOT NULL DEFAULT 0, kills INT NOT NULL DEFAULT 0, deaths INT NOT NULL DEFAULT 0, assists INT NOT NULL DEFAULT 0, headshots INT NOT NULL DEFAULT 0, shots INT NOT NULL DEFAULT 0, hits INT NOT NULL DEFAULT 0, best_streak INT NOT NULL DEFAULT 0, xp INT NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS beta_match_user ON beta_matches(user_id,played_at DESC)'
];
async function initDb(){
  if(!pool) return;
  for(let tries=0;tries<6;tries++)try{
    for(const sql of schema)await pool.query(sql);
    ready=true;console.log('IRON SHIFT beta account database ready');return;
  }catch(e){console.error('Beta DB not ready:',String(e.message).slice(0,140));await sleep(2500);}
}
initDb();
const hashToken=t=>crypto.createHash('sha256').update(t).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
async function passwordHash(secret){
  const salt=crypto.randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(secret,salt,64)).toString('hex');
}
async function passwordCheck(secret,stored){
  if(typeof stored!=='string'||!/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored))return false;
  const [salt,hex]=stored.split(':');
  const got=await scrypt(secret,salt,64);
  return crypto.timingSafeEqual(got,Buffer.from(hex,'hex'));
}
function recoveryCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const b=crypto.randomBytes(20);
  const arr=[...b].map(x=>alphabet[x%alphabet.length]).join('');
  return arr.match(/.{1,5}/g).join('-');
}
function parseCookie(req){
  const c=(req.get('Cookie')||'').split(';').map(p=>p.trim().split('='));
  const pair=c.find(a=>a[0]==='iron_shift_beta');
  return pair?.[1]||null;
}
function setSessionCookie(res,t){
  res.cookie('iron_shift_beta',t,{httpOnly:true,secure:true,sameSite:'lax',maxAge:30*24*3600*1000,path:'/'});
}
function clearSessionCookie(res){res.clearCookie('iron_shift_beta',{httpOnly:true,secure:true,sameSite:'lax',path:'/'});}
async function auth(req){
  const cookie=parseCookie(req);
  if(!cookie||cookie.length>150||!ready)return null;
  const r=await pool.query('SELECT u.* FROM beta_sessions s JOIN beta_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1',[hashToken(cookie)]);
  return r.rows[0]||null;
}
const err=(res,status,message)=>res.status(status).json({error:message});
const route=fn=>async(req,res)=>{try {
  if(!ready) return err(res,503,'Account database is not connected. This is a beta preview.');
  await fn(req,res);
}catch(e){console.error('API error:',e?.code||e?.message);if(e.code==='23505')return err(res,409,'This username is already taken');return err(res,500,'Temporary server error');}};
const mustAuth=async(req,res)=>{const u=await auth(req);if(!u)err(res,401,'Please sign in');return u;};
async function issueSession(res,id){
  const t=token();await pool.query('INSERT INTO beta_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'30 days\')',[hashToken(t),id]);setSessionCookie(res,t);
}
async function revokeSessions(id){await pool.query('DELETE FROM beta_sessions WHERE user_id=$1',[id]);}
function publicUser(u){return {username:u.username,displayName:u.display_name,avatar:0,hasPassword:true,hasRecovery:!!u.recovery_ok,moderator:false};}
function levelOf(xp){const level=Math.max(1,Math.min(100,Math.floor(xp/500)+1));return {xp,level,into:level===100?0:xp%500,need:level===100?0:500};}
function num(v,max=99999){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(max,Math.floor(n))):0;}
async function snapshot(u){
 const ms=await pool.query('SELECT * FROM beta_matches WHERE user_id=$1 ORDER BY played_at DESC LIMIT 12',[u.id]);
 const ag=await pool.query('SELECT COUNT(*)::int AS matches,COALESCE(SUM(CASE WHEN result=\'win\' THEN 1 ELSE 0 END),0)::int AS wins,COALESCE(SUM(kills),0)::int AS kills,COALESCE(SUM(deaths),0)::int AS deaths,COALESCE(SUM(assists),0)::int AS assists,COALESCE(SUM(headshots),0)::int AS headshots,COALESCE(SUM(shots),0)::int AS shots,COALESCE(SUM(hits),0)::int AS hits,COALESCE(MAX(best_streak),0)::int AS "bestStreak",COALESCE(SUM(duration),0)::int AS seconds FROM beta_matches WHERE user_id=$1',[u.id]);
 return {user:publicUser(u),level:levelOf(u.xp),stats:ag.rows[0],recent:ms.rows.map(m=>({map:m.map,mode:m.mode,result:m.result,online:m.online,duration:m.duration,kills:m.kills,deaths:m.deaths,xp:m.xp,played_at:m.played_at}))};
}
const credentials=req=>({username:String(req.body?.username||req.body?.login||'').trim().toLowerCase(),password:req.body?.password});
function validPassword(p){return typeof p==='string'&&p.length>=10&&p.length<=128;}
function validUsername(u){return /^[a-z0-9_]{3,16}$/.test(u);}
app.get('/api/health',async(req,res)=>res.status(ready?200:503).json({status:ready?'ready':'setup_required',dbConnected:ready,feature:'beta_accounts',money:false}));
app.get('/api/me',route(async(req,res)=>{const u=await auth(req);res.json(u?await snapshot(u):{user:null,level:null,stats:null,recent:[]});}));
app.post('/api/register',route(async(req,res)=>{
 const {username,password}=credentials(req);
 if(!req.body?.accept)return err(res,422,'Accept the terms before creating an account');
 if(!validUsername(username)||!validPassword(password))return err(res,422,'Username: 3-16 letters/numbers/_; password: 10-128 characters');
 const pass=await passwordHash(password),code=recoveryCode(),rec=await passwordHash(code);
 const result=await pool.query('INSERT INTO beta_users(username,display_name,password_hash,recovery_hash) VALUES($1,$2,$3,$4) RETURNING *',[username,username,pass,rec]);
 const u=result.rows[0];await issueSession(res,u.id);res.status(201).json({...await snapshot(u),recoveryCode:code});
}));
app.post('/api/login',route(async(req,res)=>{
 const {username,password}=credentials(req);
 if(!validUsername(username)||typeof password!=='string')return err(res,401,'Invalid username or password');
 const r=await pool.query('SELECT * FROM beta_users WHERE username=$1',[username]);
 const u=r.rows[0];if(!u||!await passwordCheck(password,u.password_hash))return err(res,401,'Invalid username or password');
 await issueSession(res,u.id);res.json(await snapshot(u));
}));
app.post('/api/logout',route(async(req,res)=>{
 const t=parseCookie(req);if(t)await pool.query('DELETE FROM beta_sessions WHERE token_hash=$1',[hashToken(t)]);
 clearSessionCookie(res);res.json({ok:true});
}));
app.post('/api/recovery-ok',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const code=req.body?.code;
 if(!code||!await passwordCheck(code,u.recovery_hash))return err(res,422,'Recovery code does not match');
 await pool.query('UPDATE beta_users SET recovery_ok=TRUE WHERE id=$1',[u.id]);u.recovery_ok=true;res.json(await snapshot(u));
}));
app.post('/api/password-recover',route(async(req,res)=>{
 const username=String(req.body?.username||'').toLowerCase(),old=req.body?.code,newpw=req.body?.password;
 if(!validUsername(username)||!validPassword(newpw)||typeof old!=='string')return err(res,422,'Invalid recovery information');
 const r=await pool.query('SELECT * FROM beta_users WHERE username=$1',[username]);const u=r.rows[0];
 if(!u||!await passwordCheck(old,u.recovery_hash))return err(res,401,'Invalid recovery information');
 const code=recoveryCode();
 await pool.query('UPDATE beta_users SET password_hash=$1,recovery_hash=$2,recovery_ok=FALSE WHERE id=$3',[await passwordHash(newpw),await passwordHash(code),u.id]);
 await revokeSessions(u.id);await issueSession(res,u.id);u.recovery_ok=false;res.json({...await snapshot(u),recoveryCode:code});
}));
app.post('/api/password-change',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 if(!validPassword(req.body?.next)||!await passwordCheck(req.body?.current||'',u.password_hash))return err(res,422,'Wrong current password or new password too short');
 const code=recoveryCode();
 await pool.query('UPDATE beta_users SET password_hash=$1,recovery_hash=$2,recovery_ok=FALSE WHERE id=$3',[await passwordHash(req.body.next),await passwordHash(code),u.id]);
 await revokeSessions(u.id);await issueSession(res,u.id);u.recovery_ok=false;res.json({...await snapshot(u),recoveryCode:code});
}));
app.post('/api/recovery-new',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 if(!await passwordCheck(req.body?.password||'',u.password_hash))return err(res,422,'Password incorrect');
 const code=recoveryCode();
 await pool.query('UPDATE beta_users SET recovery_hash=$1,recovery_ok=FALSE WHERE id=$2',[await passwordHash(code),u.id]);
 u.recovery_ok=false;res.json({...await snapshot(u),recoveryCode:code});
}));
app.post('/api/profile',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const name=String(req.body?.displayName||'').trim();
 if(name.length<2||name.length>16||/[\x00-\x1f<>]/.test(name))return err(res,422,'Display name must be 2-16 characters');
 await pool.query('UPDATE beta_users SET display_name=$1 WHERE id=$2',[name,u.id]);u.display_name=name;res.json(await snapshot(u));
}));
app.post('/api/account-export',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const sn=await snapshot(u);
 res.set('Content-Disposition','attachment; filename="iron-shift-account.json"');
 res.json({exportedAt:new Date().toISOString(),...sn,arsenal:u.arsenal});
}));
app.post('/api/account-delete',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 if(String(req.body?.confirm||'').toLowerCase()!==u.username||!await passwordCheck(req.body?.password||'',u.password_hash))
   return err(res,422,'Confirm your username and password to delete the account');
 await pool.query('DELETE FROM beta_users WHERE id=$1',[u.id]);clearSessionCookie(res);res.json({deleted:true});
}));
app.get('/api/arsenal',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;res.json({data:u.arsenal||null});
}));
app.post('/api/arsenal',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const d=req.body?.data;if(!d||typeof d!=='object'||Array.isArray(d)||JSON.stringify(d).length>15000)return err(res,422,'Invalid loadout');
 // Data is user-controlled; this BETA storage must never authorize purchases or competitive rewards.
 await pool.query('UPDATE beta_users SET arsenal=$1 WHERE id=$2',[JSON.stringify(d),u.id]);res.json({ok:true});
}));
app.post('/api/match-start',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const t=token();await pool.query('INSERT INTO beta_tickets(token_hash,user_id) VALUES($1,$2)',[hashToken(t),u.id]);res.json({token:t});
}));
app.post('/api/match-end',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const t=String(req.body?.token||'');if(t.length<16||t.length>150)return err(res,422,'Invalid match token');
 const client=await pool.connect();try{
  await client.query('BEGIN');
  const got=await client.query('DELETE FROM beta_tickets WHERE token_hash=$1 AND user_id=$2 RETURNING started_at',[hashToken(t),u.id]);
  if(!got.rowCount){await client.query('ROLLBACK');return err(res,422,'Match token already used or expired');}
  const actual=num((Date.now()-new Date(got.rows[0].started_at).getTime())/1000,10800);
  if(actual<30){await client.query('COMMIT');return err(res,422,'Matches shorter than 30 seconds are not recorded');}
  const s=req.body?.summary||{},dur=Math.min(actual+3,num(s.duration,10800)),online=!!s.online;
  const result=['win','loss','draw','quit'].includes(s.result)?s.result:'quit';
  const xp=result==='quit'?0:Math.min(80,Math.floor(actual/20)*4)*(online?1:0.5);
  const kills=num(s.kills,Math.ceil(actual/3)+1),deaths=num(s.deaths,Math.ceil(actual/3)+1),assists=num(s.assists,Math.ceil(actual/3)+1),
  shots=num(s.shots,Math.ceil(actual*12)),hits=num(s.hits,shots),headshots=num(s.headshots,kills),streak=num(s.streak,kills);
  await client.query('INSERT INTO beta_matches(user_id,map,mode,result,online,duration,kills,deaths,assists,headshots,shots,hits,best_streak,xp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[u.id,String(s.map||'').slice(0,30),String(s.mode||'tdm').slice(0,25),result,online,dur,kills,deaths,assists,headshots,shots,hits,streak,Math.floor(xp)]);
  await client.query('UPDATE beta_users SET xp=xp+$1 WHERE id=$2',[Math.floor(xp),u.id]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 const rr=await pool.query('SELECT * FROM beta_users WHERE id=$1',[u.id]);const sn=await snapshot(rr.rows[0]);res.json({...sn,gained:sn.recent[0]?.xp||0,levelUp:false});
}));
app.get('/api/leaderboard',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const offset=num(req.query.offset,10000),query=String(req.query.q||'').slice(0,32);
 if(req.query.scope==='friends')return res.json({players:[],more:false,me:null});
 const q=await pool.query('SELECT username,display_name,xp FROM beta_users WHERE ($1=\'\' OR username ILIKE $2 OR display_name ILIKE $2) ORDER BY xp DESC,id ASC LIMIT 26 OFFSET $3',[query,'%'+query+'%',offset]);
 const players=q.rows.slice(0,25).map((p,i)=>({rank:offset+i+1,username:p.username,displayName:p.display_name,level:levelOf(p.xp).level,xp:p.xp,kd:0,relation:p.username===u.username?'me':''}));
 const count=await pool.query('SELECT COUNT(*)::int AS c FROM beta_users');res.json({players,more:q.rows.length>25,me:{rank:0,total:count.rows[0].c}});
}));
app.get('/api/player',route(async(req,res)=>{
 const u=await mustAuth(req,res);if(!u)return;
 const username=String(req.query.u||'').toLowerCase();const r=await pool.query('SELECT * FROM beta_users WHERE username=$1',[username]);
 if(!r.rowCount)return err(res,404,'Player not found');
 const sn=await snapshot(r.rows[0]);res.json({...sn,relation:'none',rank:0});
}));
app.use('/api', (req,res)=>err(res,501,'This feature is not available in beta yet'));
const dist=path.resolve(__dirname,'..','dist');
app.use(express.static(dist,{index:'index.html',extensions:['html'],setHeaders:(res,file)=>{
 if(file.endsWith('.html'))res.set('Cache-Control','no-cache');
}}));
app.get('/health', (req,res)=>res.status(200).json({game:'iron-shift',server:'running',accounts:ready?'ready':'setup_required',payments:false}));
app.use((req,res)=>res.status(404).send('Not found'));
const port=Number(process.env.PORT||10000);
app.listen(port,'0.0.0.0',()=>console.log('IRON SHIFT beta server listening on '+port));
