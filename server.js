import express from 'express';
import cors from 'cors';
import { DatabaseSync as Database } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '32kb' }));
const dataPath = process.env.DATABASE_PATH || './data/roadsos.db';
fs.mkdirSync(path.dirname(path.resolve(dataPath)), { recursive: true });
const db = new Database(dataPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, auth_uid TEXT UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','mechanic','admin')), address TEXT DEFAULT '', vehicle TEXT DEFAULT '', registration TEXT DEFAULT '', garage TEXT DEFAULT '', services TEXT DEFAULT '', radius REAL DEFAULT 15, lat REAL, lng REAL, available INTEGER DEFAULT 0, verified INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, phone TEXT NOT NULL, relationship TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), mechanic_id INTEGER REFERENCES users(id), type TEXT NOT NULL, description TEXT DEFAULT '', lat REAL, lng REAL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sos (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), lat REAL, lng REAL, accuracy REAL, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, synced_at TEXT);
CREATE TABLE IF NOT EXISTS ratings (id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id), user_id INTEGER NOT NULL REFERENCES users(id), mechanic_id INTEGER NOT NULL REFERENCES users(id), stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5), feedback TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS requests_user_created ON requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_mechanic_status ON requests(mechanic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_created ON sos(created_at DESC);
`);
// Preserve existing SQLite accounts while attaching Supabase identities on first sign-in.
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'auth_uid')) db.exec('ALTER TABLE users ADD COLUMN auth_uid TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_auth_uid ON users(auth_uid) WHERE auth_uid IS NOT NULL');
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabaseAuth = supabaseUrl && supabasePublishableKey ? createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
// Optional first-run admin provisioning; never overwrite an existing account.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    if (process.env.ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
    db.prepare('INSERT INTO users(name,email,phone,password_hash,role,verified) VALUES(?,?,?,?,\'admin\',1)')
      .run(process.env.ADMIN_NAME || 'Road SOS Admin', email, process.env.ADMIN_PHONE || 'Not provided', await bcrypt.hash(process.env.ADMIN_PASSWORD, 12));
  }
}
function auth(req,res,next){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!supabaseAuth)return res.status(503).json({error:'Supabase Auth is not configured on the API.'});
  if(!t)return res.status(401).json({error:'Please sign in to continue.'});
  supabaseAuth.auth.getUser(t).then(({data,error})=>{
    if(error||!data.user)return res.status(401).json({error:'Your session is invalid or expired. Please sign in again.'});
    const identity=data.user,email=String(identity.email||'').trim().toLowerCase();
    if(!email||!identity.email_confirmed_at)return res.status(403).json({error:'Confirm your email address before using Road SOS.'});
    let row=db.prepare('SELECT * FROM users WHERE auth_uid=?').get(identity.id);
    if(!row){
      row=db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if(row){
        if(row.auth_uid&&row.auth_uid!==identity.id)return res.status(409).json({error:'This account is already linked to another sign-in.'});
        db.prepare('UPDATE users SET auth_uid=? WHERE id=?').run(identity.id,row.id);
        row=db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
      }else{
        const meta=identity.user_metadata||{};
        const r=['mechanic','user'].includes(meta.role)?meta.role:'user';
        const name=String(meta.name||email.split('@')[0]).trim().slice(0,100)||'Road SOS member';
        const phone=String(meta.phone||'Not provided').trim().slice(0,40);
        try{
          db.prepare('INSERT OR IGNORE INTO users(auth_uid,name,email,phone,password_hash,role,address,vehicle,registration,garage,services,radius) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(identity.id,name,email,phone,'supabase-auth-managed',r,String(meta.address||''),String(meta.vehicle||''),String(meta.registration||''),String(meta.garage||''),String(meta.services||''),Math.max(1,Math.min(200,Number(meta.radius)||15)));
          row=db.prepare('SELECT * FROM users WHERE auth_uid=?').get(identity.id);
          if(!row){
            row=db.prepare('SELECT * FROM users WHERE email=?').get(email);
            if(row&&!row.auth_uid){db.prepare('UPDATE users SET auth_uid=? WHERE id=?').run(identity.id,row.id);row=db.prepare('SELECT * FROM users WHERE id=?').get(row.id)}
          }
        }catch(e){console.error(e);return res.status(409).json({error:'Could not create your Road SOS profile. Contact an administrator.'})}
      }
    }
    if(!row)return res.status(409).json({error:'This email is already linked to another Road SOS sign-in.'});
    req.identity={id:row.id,role:row.role};req.roadUser=row;req.authUser=identity;next();
  }).catch(error=>{console.error('Supabase token verification failed:',error);res.status(503).json({error:'Could not verify your session right now.'})});
}
function role(...roles){return (req,res,next)=>roles.includes(req.identity.role)?next():res.status(403).json({error:'This area is not available for your account.'})}
function wrap(fn){return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)}
function publicUser(id){return db.prepare('SELECT id,name,email,phone,role,address,vehicle,registration,garage,services,radius,lat,lng,available,verified,created_at FROM users WHERE id=?').get(id)}
const distance=(a,b,c,d)=>{const rad=x=>x*Math.PI/180,R=6371,dl=rad(c-a),dn=rad(d-b),h=Math.sin(dl/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dn/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))};
app.get('/api/health',(req,res)=>res.json({ok:true,service:'road-sos'}));
app.get('/api/me',auth,wrap((req,res)=>{const u=publicUser(req.identity.id);if(!u)return res.status(401).json({error:'Account no longer exists.'});res.json({user:u})}));
app.put('/api/me',auth,wrap((req,res)=>{const {name,phone,address,vehicle,registration,garage,services,radius,lat,lng}=req.body||{};db.prepare('UPDATE users SET name=COALESCE(?,name),phone=COALESCE(?,phone),address=COALESCE(?,address),vehicle=COALESCE(?,vehicle),registration=COALESCE(?,registration),garage=COALESCE(?,garage),services=COALESCE(?,services),radius=COALESCE(?,radius),lat=COALESCE(?,lat),lng=COALESCE(?,lng) WHERE id=?').run(name,phone,address,vehicle,registration,garage,services,radius,lat,lng,req.identity.id);res.json({user:publicUser(req.identity.id)})}));
app.get('/api/contacts',auth,role('user','admin'),(req,res)=>res.json({contacts:db.prepare('SELECT id,name,phone,relationship FROM contacts WHERE user_id=?').all(req.identity.id)}));
app.put('/api/contacts',auth,role('user'),wrap((req,res)=>{const contacts=Array.isArray(req.body?.contacts)?req.body.contacts:[];if(contacts.length>2||contacts.some(c=>!c.name?.trim()||!c.phone?.trim()))return res.status(400).json({error:'Add up to two contacts with a name and phone number.'});const tx=db.transaction(()=>{db.prepare('DELETE FROM contacts WHERE user_id=?').run(req.identity.id);for(const c of contacts)db.prepare('INSERT INTO contacts(user_id,name,phone,relationship) VALUES(?,?,?,?)').run(req.identity.id,c.name.trim(),c.phone.trim(),String(c.relationship||''))});tx();res.json({contacts:db.prepare('SELECT id,name,phone,relationship FROM contacts WHERE user_id=?').all(req.identity.id)})}));
app.get('/api/mechanics',auth,role('user','admin'),wrap((req,res)=>{const lat=Number(req.query.lat),lng=Number(req.query.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'Share a valid location to find nearby mechanics.'});const rows=db.prepare("SELECT id,name,phone,garage,services,radius,lat,lng,available,verified FROM users WHERE role='mechanic' AND verified=1 AND available=1 AND lat IS NOT NULL AND lng IS NOT NULL").all().map(m=>({...m,distance:distance(lat,lng,m.lat,m.lng)})).filter(m=>m.distance<=m.radius).sort((a,b)=>a.distance-b.distance);res.json({mechanics:rows})}));
app.post('/api/requests',auth,role('user'),wrap((req,res)=>{const {mechanicId,type,description='',lat,lng}=req.body||{};const m=db.prepare("SELECT * FROM users WHERE id=? AND role='mechanic' AND verified=1 AND available=1").get(mechanicId);if(!m)return res.status(409).json({error:'This mechanic is not currently available.'});if(!type?.trim()||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return res.status(400).json({error:'Choose a breakdown type and share your current location.'});if(distance(Number(lat),Number(lng),m.lat,m.lng)>m.radius)return res.status(400).json({error:'This mechanic is outside their service area.'});const info=db.prepare('INSERT INTO requests(user_id,mechanic_id,type,description,lat,lng) VALUES(?,?,?,?,?,?)').run(req.identity.id,m.id,type.trim(),String(description).slice(0,500),lat,lng);res.status(201).json({request:requestFor(Number(info.lastInsertRowid))})}));
function requestFor(id){return db.prepare('SELECT r.*,u.name AS customer_name,u.phone AS customer_phone,m.name AS mechanic_name,m.phone AS mechanic_phone,m.garage,rt.stars AS rating_stars,rt.feedback AS rating_feedback FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN users m ON m.id=r.mechanic_id LEFT JOIN ratings rt ON rt.request_id=r.id WHERE r.id=?').get(id)}
app.get('/api/requests',auth,wrap((req,res)=>{let rows;if(req.identity.role==='admin')rows=db.prepare('SELECT id FROM requests ORDER BY created_at DESC LIMIT 200').all();else if(req.identity.role==='mechanic')rows=db.prepare('SELECT id FROM requests WHERE mechanic_id=? ORDER BY created_at DESC LIMIT 200').all(req.identity.id);else rows=db.prepare('SELECT id FROM requests WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(req.identity.id);res.json({requests:rows.map(r=>requestFor(r.id))})}));
app.patch('/api/requests/:id/status',auth,role('mechanic','admin'),wrap((req,res)=>{const {status}=req.body||{};if(!['accepted','rejected','on_the_way','arrived','in_progress','completed','cancelled'].includes(status))return res.status(400).json({error:'That status is not supported.'});const r=requestFor(Number(req.params.id));if(!r)return res.status(404).json({error:'Request not found.'});if(req.identity.role==='mechanic'&&r.mechanic_id!==req.identity.id)return res.status(403).json({error:'This request belongs to another mechanic.'});const allowed={pending:['accepted','rejected','cancelled'],accepted:['on_the_way','cancelled'],on_the_way:['arrived','cancelled'],arrived:['in_progress','cancelled'],in_progress:['completed']};if(!(allowed[r.status]||[]).includes(status))return res.status(409).json({error:`Cannot change ${r.status} to ${status}.`});db.prepare('UPDATE requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,r.id);res.json({request:requestFor(r.id)})}));
app.post('/api/requests/:id/rating',auth,role('user'),wrap((req,res)=>{const stars=Number(req.body?.stars),feedback=String(req.body?.feedback||'').slice(0,1000),r=requestFor(Number(req.params.id));if(!r||r.user_id!==req.identity.id)return res.status(404).json({error:'Completed request not found.'});if(r.status!=='completed')return res.status(409).json({error:'You can rate a request after service is completed.'});if(!Number.isInteger(stars)||stars<1||stars>5)return res.status(400).json({error:'Choose a rating from 1 to 5.'});try{db.prepare('INSERT INTO ratings(request_id,user_id,mechanic_id,stars,feedback) VALUES(?,?,?,?,?)').run(r.id,req.identity.id,r.mechanic_id,stars,feedback)}catch{return res.status(409).json({error:'This request has already been rated.'})}res.status(201).json({ok:true})}));
app.post('/api/sos',auth,role('user'),wrap((req,res)=>{const {lat,lng,accuracy}=req.body||{};if(lat!=null&&(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))))return res.status(400).json({error:'Location coordinates are invalid.'});const info=db.prepare('INSERT INTO sos(user_id,lat,lng,accuracy) VALUES(?,?,?,?)').run(req.identity.id,lat??null,lng??null,accuracy??null);res.status(201).json({sos:db.prepare('SELECT * FROM sos WHERE id=?').get(Number(info.lastInsertRowid))})}));
app.get('/api/sos',auth,role('admin'),(req,res)=>res.json({sos:db.prepare('SELECT s.*,u.name,u.phone FROM sos s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 200').all()}));
app.post('/api/mechanic/availability',auth,role('mechanic'),wrap((req,res)=>{const {available,lat,lng}=req.body||{};if(typeof available!=='boolean')return res.status(400).json({error:'Availability must be true or false.'});if(available&&(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))))return res.status(400).json({error:'Share your location before going online.'});db.prepare('UPDATE users SET available=?,lat=COALESCE(?,lat),lng=COALESCE(?,lng) WHERE id=?').run(available?1:0,lat,lng,req.identity.id);res.json({user:publicUser(req.identity.id)})}));
app.get('/api/admin/overview',auth,role('admin'),(req,res)=>res.json({stats:{users:db.prepare("SELECT count(*) n FROM users WHERE role='user'").get().n,mechanics:db.prepare("SELECT count(*) n FROM users WHERE role='mechanic'").get().n,unverified:db.prepare("SELECT count(*) n FROM users WHERE role='mechanic' AND verified=0").get().n,requests:db.prepare('SELECT count(*) n FROM requests').get().n,active:db.prepare("SELECT count(*) n FROM requests WHERE status IN ('pending','accepted','on_the_way','arrived','in_progress')").get().n,sos:db.prepare("SELECT count(*) n FROM sos WHERE status='active'").get().n}}));
app.get('/api/admin/mechanics',auth,role('admin'),(req,res)=>res.json({mechanics:db.prepare("SELECT id,name,email,phone,garage,services,verified,available FROM users WHERE role='mechanic' ORDER BY verified,id").all()}));
app.patch('/api/admin/mechanics/:id/verify',auth,role('admin'),wrap((req,res)=>{const verified=Boolean(req.body?.verified);const info=db.prepare("UPDATE users SET verified=? WHERE id=? AND role='mechanic'").run(verified?1:0,req.params.id);if(!info.changes)return res.status(404).json({error:'Mechanic not found.'});res.json({user:publicUser(Number(req.params.id))})}));
const webDist=path.resolve('dist');
if(fs.existsSync(webDist)){app.use(express.static(webDist));app.get('*',(req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(path.join(webDist,'index.html')))}
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'})});
const port = Number(process.env.PORT) || 4000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Road SOS API listening on port ${port}`);
});
