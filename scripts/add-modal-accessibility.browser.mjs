// Real browser regression; no server, credentials, storage export or deployment.
// PATCHED_DIST optionally supplies an isolated compiled artifact at the TEST URL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base='https://keeptimer-test.vercel.app';
const out=process.env.TEST_UI_OUT || '.testsprite/add-modal-accessibility';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
const rows=[],diagnostic={};
const dist=process.env.PATCHED_DIST && path.resolve(process.env.PATCHED_DIST);
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json'};
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(![base,'https://keeptimer-backend-test.onrender.com'].includes(u.origin))return route.abort();
 if(!dist || u.origin!==base)return route.continue();
 const name=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\//,'');
 const file=path.resolve(dist,name);assert.ok(file.startsWith(dist+path.sep));
 try{return await route.fulfill({status:200,contentType:types[path.extname(file)] || 'application/octet-stream',body:await fs.readFile(file),headers:{'Content-Security-Policy':"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://keeptimer-backend-test.onrender.com wss://keeptimer-backend-test.onrender.com; img-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'"}});}catch{return route.abort();}
});
const page=await context.newPage();page.setDefaultTimeout(10000);
const fab=page.getByRole('button',{name:'Yeni ekle',exact:true});
const modal=page.getByRole('dialog');
const save=async()=>fs.writeFile(path.join(out,'results.json'),JSON.stringify({at:new Date().toISOString(),target:base,runner:dist?'ISOLATED_COMPILED_OVERRIDE_NOT_DEPLOYED':'LIVE_TEST_DEPLOYMENT',cases:rows,diagnostic},null,2));
async function run(id,fn){try{await fn();rows.push({id,status:'PASS'});}catch(e){rows.push({id,status:'FAIL',error:e.message.slice(0,400)});}await save();}
try{
 await page.goto(base,{waitUntil:'networkidle',timeout:90000});await fab.click();await modal.waitFor();
 diagnostic.afterOpen=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,ariaLabel:document.activeElement.getAttribute('aria-label')}));
 await run('ADD-MODAL-INITIAL-FOCUS',async()=>{assert.equal(await modal.evaluate(e=>e.contains(document.activeElement)),true,'Opening must move focus inside the modal');});
 await run('ADD-MODAL-TAB-AND-INERT',async()=>{
  await modal.locator('#new-timer-name').focus();
  for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.equal(await modal.evaluate(e=>e.contains(document.activeElement)),true,'Tab must stay inside modal');}
  await fab.evaluate(e=>e.focus());assert.equal(await modal.evaluate(e=>e.contains(document.activeElement)),true,'Background must remain inert');
 });
 await run('ADD-MODAL-ESCAPE-RETURN',async()=>{await modal.locator('#new-timer-name').focus();await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await fab.evaluate(e=>e===document.activeElement),true);});
 if(await modal.count())await modal.getByRole('button',{name:'Kapat',exact:true}).click();
 await run('ADD-MODAL-CLOSE-RETURN',async()=>{await fab.click();await modal.waitFor();await modal.getByRole('button',{name:'Kapat',exact:true}).click();await modal.waitFor({state:'detached'});assert.equal(await fab.evaluate(e=>e===document.activeElement),true);});
 await page.screenshot({path:path.join(out,'anonymous-final.png')});
}finally{await save();await context.close();await browser.close();}
console.log(JSON.stringify({cases:rows.length,pass:rows.filter(x=>x.status==='PASS').length,fail:rows.filter(x=>x.status==='FAIL').length}));
if(rows.some(x=>x.status==='FAIL'))process.exitCode=1;
