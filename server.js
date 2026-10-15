const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'customers.json');
const PORT = Number(process.env.PORT || 8000);
const STATUSES = new Set(['Active', 'At risk', 'Inactive']);
const PLANS = new Set(['Starter', 'Professional', 'Enterprise']);
let customers;
const clients = new Set();

const seedCustomers = [
  ['Olivia Rhye','olivia@untitledui.com','Untitled UI','Design agency','Creative Director','Enterprise','Active','2025-01-12','#fbe9e3'],
  ['Phoenix Baker','phoenix@proseware.com','Proseware','Software','Product Manager','Professional','Active','2025-02-03','#e8e9ff'],
  ['Lana Steiner','lana@graphics.studio','Graphics Studio','Design agency','Founder','Enterprise','At risk','2025-02-17','#f8e3f1'],
  ['Demi Wilkinson','demi@brightpath.io','Brightpath','Education','Marketing Lead','Starter','Active','2025-03-01','#fff0d9'],
  ['Candice Wu','candice@layers.tech','Layers','Technology','VP of Product','Professional','Inactive','2025-03-09','#e0f2ee'],
  ['Natali Craig','natali@quotient.co','Quotient','Consulting','Designer','Starter','Active','2025-03-24','#f5e3d8'],
  ['Drew Cano','drew@catalog.app','Catalog','E-commerce','Founder','Enterprise','At risk','2025-04-02','#e8e5fb'],
  ['Orlando Diggs','orlando@circooles.com','Circooles','Technology','Engineering Lead','Professional','Active','2025-04-15','#e5eef8'],
  ['Andi Lane','andi@command.ai','Command+R','Artificial intelligence','Growth Lead','Enterprise','Active','2025-05-06','#f4e7df'],
  ['Kate Morrison','kate@quotient.co','Quotient','Consulting','Account Executive','Starter','Inactive','2025-05-18','#ece7fa'],
  ['Jenna Levine','jenna@layers.tech','Layers','Technology','UX Researcher','Professional','Active','2025-06-11','#def1ec'],
  ['Maximilian Huber','max@circooles.com','Circooles','Technology','CEO','Enterprise','At risk','2025-07-02','#fff0dd']
].map(([name,email,company,sector,role,plan,status,joined,color],index) => ({
  id:`c${String(index+1).padStart(2,'0')}`, name, email, company, sector, role, plan, status, joined, color,
  initials:name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()
}));

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  response.end(body === null ? '' : JSON.stringify(body));
}
async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request body is too large'), { status:413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Request body must be valid JSON'), { status:400 }); }
}
function validateCustomer(body, previous = {}) {
  const name = String(body.name ?? previous.name ?? '').trim();
  const email = String(body.email ?? previous.email ?? '').trim();
  const company = String(body.company ?? previous.company ?? '').trim();
  const plan = String(body.plan ?? previous.plan ?? 'Starter');
  const status = String(body.status ?? previous.status ?? 'Active');
  if (!name || !email || !company) throw Object.assign(new Error('Name, email, and company are required'), { status:400 });
  if (name.length > 80 || email.length > 120 || company.length > 100) throw Object.assign(new Error('A field is longer than allowed'), { status:400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address'), { status:400 });
  if (!PLANS.has(plan) || !STATUSES.has(status)) throw Object.assign(new Error('Choose a valid plan and status'), { status:400 });
  return { ...previous, ...body, name, email, company, role:String(body.role ?? previous.role ?? '').trim(), sector:String(body.sector ?? previous.sector ?? '').trim(), plan, status,
    id:previous.id || randomUUID(), joined:body.joined || previous.joined || new Date().toISOString().slice(0,10),
    color:previous.color || '#eee9ff', initials:name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase() };
}
async function persist() {
  const temp = `${DATA_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(customers, null, 2));
  await fs.rename(temp, DATA_FILE);
}
function broadcast() {
  const event = `event: snapshot\ndata: ${JSON.stringify(customers)}\n\n`;
  for (const response of clients) response.write(event);
}
async function serveStatic(urlPath, response) {
  const decoded = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const resolved = path.resolve(ROOT, `.${decoded}`);
  if (!resolved.startsWith(ROOT + path.sep) || resolved === DATA_FILE) return sendJson(response,404,{error:'Not found'});
  let bytes;
  try { bytes = await fs.readFile(resolved); }
  catch { return sendJson(response,404,{error:'Not found'}); }
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
  response.writeHead(200,{ 'Content-Type':types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
  response.end(bytes);
}
async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health' && request.method === 'GET') return sendJson(response,200,{status:'ok',customers:customers.length});
  if (url.pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200,{ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', Connection:'keep-alive' });
    response.write('retry: 2000\n'); clients.add(response);
    response.write(`event: snapshot\ndata: ${JSON.stringify(customers)}\n\n`);
    request.on('close',()=>clients.delete(response)); return;
  }
  if (url.pathname === '/api/customers' && request.method === 'GET') return sendJson(response,200,customers);
  if (url.pathname === '/api/customers' && request.method === 'POST') {
    const record = validateCustomer(await readJson(request));
    if (customers.some(item=>item.email.toLowerCase()===record.email.toLowerCase())) return sendJson(response,409,{error:'A customer with this email already exists'});
    customers.unshift(record); await persist(); broadcast(); return sendJson(response,201,record);
  }
  if (url.pathname === '/api/customers/import' && request.method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body.customers)) return sendJson(response,400,{error:'customers must be an array'});
    let imported = 0;
    for (const raw of body.customers) {
      const lower = key => Object.entries(raw || {}).find(([name])=>name.toLowerCase()===key)?.[1];
      const normalized = { name:lower('name')||lower('full name')||lower('fullname'), email:lower('email')||lower('email address'), company:lower('company')||lower('organization'), role:lower('role')||lower('job title')||lower('title'), sector:lower('sector')||lower('industry'), plan:lower('plan'), status:lower('status'), joined:lower('joined')||lower('created at')||lower('date') };
      if (!normalized.name || !normalized.email || !normalized.company) continue;
      try {
        const existing=customers.find(item=>item.email.toLowerCase()===String(normalized.email).toLowerCase());
        const record=validateCustomer(normalized,existing||{});
        if(existing) customers=customers.map(item=>item.id===existing.id?record:item); else customers.push(record);
        imported++;
      } catch { /* skip invalid import rows */ }
    }
    if (imported) { await persist(); broadcast(); }
    return sendJson(response,200,{imported,total:customers.length});
  }
  if (url.pathname === '/api/customers/bulk/status' && request.method === 'PATCH') {
    const body=await readJson(request);
    if (!Array.isArray(body.ids)||!STATUSES.has(body.status)) return sendJson(response,400,{error:'Provide customer ids and a valid status'});
    const ids=new Set(body.ids); customers=customers.map(item=>ids.has(item.id)?{...item,status:body.status}:item);
    await persist(); broadcast(); return sendJson(response,200,{updated:ids.size});
  }
  if (url.pathname === '/api/customers/bulk' && request.method === 'DELETE') {
    const body=await readJson(request);
    if (!Array.isArray(body.ids)) return sendJson(response,400,{error:'Provide customer ids'});
    const ids=new Set(body.ids),before=customers.length; customers=customers.filter(item=>!ids.has(item.id));
    const deleted=before-customers.length; if(deleted){await persist();broadcast();} return sendJson(response,200,{deleted});
  }
  const match=url.pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (match) {
    const id=decodeURIComponent(match[1]),index=customers.findIndex(item=>item.id===id);
    if(index<0) return sendJson(response,404,{error:'Customer not found'});
    if(request.method==='PUT') {
      const record=validateCustomer(await readJson(request),customers[index]);
      if(customers.some((item,i)=>i!==index&&item.email.toLowerCase()===record.email.toLowerCase())) return sendJson(response,409,{error:'A customer with this email already exists'});
      customers[index]=record; await persist(); broadcast(); return sendJson(response,200,record);
    }
    if(request.method==='DELETE') { customers.splice(index,1); await persist(); broadcast(); return sendJson(response,204,null); }
  }
  if (url.pathname.startsWith('/api/')) return sendJson(response,404,{error:'API route not found'});
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response,405,{error:'Method not allowed'});
  return serveStatic(url.pathname,response);
}

async function start() {
  await fs.mkdir(path.dirname(DATA_FILE),{recursive:true});
  try { customers=JSON.parse(await fs.readFile(DATA_FILE,'utf8')); if(!Array.isArray(customers)) throw new Error('Invalid data'); }
  catch(error) { if(error.code!=='ENOENT') console.error('Could not read customer store; using the starter records.',error); customers=seedCustomers; await persist(); }
  const server=http.createServer((request,response)=>{
    handle(request,response).catch(error=>{console.error(error);if(!response.headersSent)sendJson(response,error.status||500,{error:error.status?error.message:'Internal server error'});else response.end();});
  });
  server.listen(PORT,'127.0.0.1',()=>console.log(`Orbit CRUD is running at http://127.0.0.1:${PORT}`));
  setInterval(()=>{for(const response of clients)response.write(': keep-alive\n\n');},20000).unref();
}
start().catch(error=>{console.error(error);process.exitCode=1;});
