import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import vue from '@vitejs/plugin-vue';
import {createRenderer, h, reactive, nextTick} from 'vue';
import {writeFile, unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createAccountExperience} from '../services/accountExperience.js';
import {captureWorkspaceSession} from '../services/workspaceSession.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const views={};
const walk = (n) => [n, ...(n.children || []).flatMap(walk)],
  text = (n) => (n.text || "") + (n.children || []).map(text).join("");
const renderer = createRenderer({
  createElement: (tag) => ({
    tag,
    props: {},
    children: [],
    parent: null,
    focus() {
      this.focused = true;
      globalThis.document.activeElement = this;
    },
    getRootNode() {
      return globalThis.document;
    },
    getAttribute(k) {
      return this.props[k] ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
  }),
  setScopeId: (n, id) => {
    n.props[id] = "";
  },
  createText: (value) => ({ text: value }),
  createComment: () => ({ text: "" }),
  setText: (n, v) => {
    n.text = v;
  },
  setElementText: (n, v) => {
    n.children = [{ text: v }];
  },
  patchProp: (n, k, _old, v) => {
    n.props[k] = v;
    n[k] = v;
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
  insert(n, parent, anchor) {
    if (n.parent) {
      const i = n.parent.children.indexOf(n);
      if (i >= 0) n.parent.children.splice(i, 1);
    }
    n.parent = parent;
    const i = parent.children.indexOf(anchor);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
  },
  remove(n) {
    const i = n.parent?.children.indexOf(n);
    if (i >= 0) n.parent.children.splice(i, 1);
  },
});
const tick = async () => {
  await new Promise((r) => setImmediate(r));
  await nextTick();
};
const id=n=>`aaaaaaaa-0000-4000-8000-${String(n).padStart(12,'0')}`;
const active=user=>({account:{kind:'individual',userId:user.id,workspaceId:user.workspace_id},subscription:{planCode:'individual',status:'active',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-11-01T00:00:00Z',isEntitled:true},evaluatedAt:'2026-10-17T00:00:00Z',code:null,features:{tts:true,telegram:true,presets:true},personal:{readable:true,writable:true},shared:false,loginReady:true});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function fixture(view='AddModal', company=false, options={}){
 globalThis.Document=class {};globalThis.ShadowRoot=class {};globalThis.document=Object.assign(new Document(),{activeElement:null});globalThis.Image=class {};
 const f={generation:0,clock:0,requests:0,actions:[],messages:[],events:new EventTarget(),tree:{children:[]},connected:true};
 f.store=reactive({user:{id:id(1),workspace_id:options.workspaceId===null?null:id(2),role:options.role||'worker',disabled_at:options.disabledAt||null},presetNames:['Odak','Toplantı'],presetTimes:[5,25],name:'Taslağım',duration:17,ready:true,roleStyles:{worker:{text:""}},stopwatches:[],sharedWritable:false,addTimer:async()=>null,requireSharedWrite:()=>false});
 f.body=()=>company?{...active(f.store.user),account:{kind:'company',userId:f.store.user.id,workspaceId:f.store.user.workspace_id},subscription:{planCode:null,status:null,startsAt:null,endsAt:null,isEntitled:false},code:'SUBSCRIPTION_REQUIRED',shared:true,personal:{readable:!!f.store.user.workspace_id,writable:!!f.store.user.workspace_id}}:options.expired?{...active(f.store.user),subscription:{...active(f.store.user).subscription,status:'expired',endsAt:'2026-10-16T00:00:00Z',isEntitled:false},code:'SUBSCRIPTION_EXPIRED',features:{tts:false,telegram:false,presets:false},personal:{readable:true,writable:false}}:active(f.store.user);
 f.reply=()=>({ok:true,json:async()=>f.body()});
 f.workspaceRequest=async()=>({ok:true,json:async()=>({workspace:null})});
 f.telegram=async action=>action==='status'?{success:true,connected:false}:{};
 f.capture=()=>captureWorkspaceSession(f.auth);
 f.auth={getUser:()=>f.store.user,isTabSessionCurrent:()=>!!f.store.user,getAuthGeneration:()=>f.generation,getTabSessionIdentity:()=>String(f.generation),getSessionMarker:()=>String(f.generation),getAccessToken:()=> 'synthetic',AUTH_SESSION_CHANGED_EVENT:'session'};
 f.policy=createAccountExperience({auth:f.auth,events:f.events,online:()=>f.connected,monotonicNow:()=>f.clock,timeoutMs:40,request:async()=>{f.requests++;return f.reply();}});
 await f.policy.refresh();globalThis.__ux=f;globalThis.window=f.events;
 f.app=renderer.createApp(views[view],view==='AddModal'?{isOpen:true,defaultType:'up'}:{});f.app.component('RouterLink',{props:['to'],render(){return h('a',{href:this.to},this.$slots.default?.());}});f.app.mount(f.tree);await tick();
 f.input=(node,value)=>{node.props['onUpdate:modelValue'](value);};
 f.close=()=>{f.app.unmount();f.policy.dispose();};
 f.logout=()=>{f.generation++;f.store.user=null;f.events.dispatchEvent(new Event('session'));};
 f.switch=()=>{f.generation++;f.store.user={id:id(3),workspace_id:id(4),role:'worker'};f.events.dispatchEvent(new Event('session'));};
 return f;
}
const button=(f,label)=>walk(f.tree).find(n=>n.tag==='button'&&text(n).trim()===label);
before(async()=>{
 const mocks={
  policy:`export const accountExperience=new Proxy({},{get:(_,k)=>globalThis.__ux.policy[k]});`,
  store:`export const useStopwatchStore=()=>globalThis.__ux.store;`,
  theme:`export const useThemeStore=()=>({isDark:false,toggleTheme(){}});`,
  message:`const out=(...x)=>globalThis.__ux.messages.push(x);export const message={withLoading:(_m,fn)=>fn,warning:out,success:out,error:out};`,
  auth:`const f=()=>globalThis.__ux;export const getUser=()=>f().store.user;export const getAuthGeneration=()=>f().generation;export const getAccessToken=()=> 'synthetic';export const apiFetch=(...args)=>f().workspaceRequest(...args);export const saveTelegramChatId=(value)=>{f().actions.push(['bind',value]);return f().telegram('bind');};export const telegramControl=()=>{f().actions.push(['status']);return f().telegram('status');};export const cancelTelegramChatId=()=>{f().actions.push(['unlink']);return f().telegram('unlink');};`,
  capture:`export const captureWorkspaceSession=()=>globalThis.__ux.capture();`,
  router:`export const useRouter=()=>({push(){}});`,
  socket:`export const connectSocket=()=>{};export const disconnectSocket=()=>{};`,
  child:`export default {render(){return null}};`,
 };
 for(const [name,entry] of Object.entries({AddModal:'components/stopwatch/AddModal.vue',Settings:'views/SettingsView.vue',Profile:'views/ProfileView.vue'})){
  const output=await build({root,configFile:false,logLevel:'silent',resolve:{alias:{'@':root+'src'}},plugins:[{name:'ux-fixtures',enforce:'pre',resolveId(s){const key=s.includes('services/accountExperience')?'policy':s.includes('stores/stopwatchStore')?'store':s.includes('stores/themeStore')?'theme':s.includes('composables/message')?'message':s.includes('services/backendSync')?'auth':s.includes('workspaceSession')?'capture':s==='vue-router'?'router':s.includes('services/socket')?'socket':/\/(SoundSettings|NotificationSettings)\.vue$/.test(s)?'child':null;return key?'\0ux:'+key:null;},load(s){if(s.startsWith('\0ux:'))return mocks[s.slice(4)];}},vue({template:{compilerOptions:{hoistStatic:false}}})],build:{write:false,minify:false,lib:{entry:root+'src/'+entry,formats:['es']},rollupOptions:{external:['vue']}}});
  const path=root+'.ux-'+name+'.mjs';await writeFile(path,(Array.isArray(output)?output[0]:output).output.find(x=>x.type==='chunk').code);views[name]=(await import(path)).default;
 }
});
after(async()=>{for(const name of Object.keys(views))await unlink(root+'.ux-'+name+'.mjs').catch(()=>{});delete globalThis.__ux;});
test('UX real AddModal host nodes, draft, focus and selection survive slow refresh and expiry',async t=>{
 const f=await fixture();try{
  const input=walk(f.tree).find(n=>n.props?.id==='new-timer-name'),chip=button(f,'Odak');input.focus();input.selectionStart=3;
  f.input(input,'Yazdığım taslak');await nextTick();const requests=f.requests;
  const gate=deferred();f.reply=()=>gate.promise;const a=f.policy.refresh(),b=f.policy.refresh();await tick();
  const retained=button(f,'Odak')===chip;
  t.diagnostic(JSON.stringify({scenario:'modal-background',accountRequests:f.requests-requests,presetNodeRetained:retained,nameNodeRetained:walk(f.tree).includes(input)}));
  assert.equal(retained,true);assert.equal(globalThis.document.activeElement,input);assert.equal(input.selectionStart,3);assert.equal(f.store.name,'Yazdığım taslak');
  f.clock=30001;assert.equal(f.policy.canFeature('presets'),false);await button(f,'Odak').props.onClick();assert.equal(f.store.name,'Yazdığım taslak');
  gate.resolve({ok:true,json:async()=>active(f.store.user)});await Promise.all([a,b]);await tick();assert.equal(button(f,'Odak'),chip);assert.equal(f.store.name,'Yazdığım taslak');
 }finally{f.close();}
});
test('UX valid local edits and five preset selections do not wait for or issue account requests',async t=>{
 const f=await fixture();try{
  const before=f.requests;const input=walk(f.tree).find(n=>n.props?.id==='new-timer-name');f.input(input,'Normal ad');
  f.input(walk(f.tree).find(n=>n.props?.id==='new-timer-duration'),31);
  let synchronousDraft=true;
  for(let i=0;i<5;i++){f.store.name='Önce';const action=button(f,'Odak').props.onClick();synchronousDraft &&= f.store.name==='Odak';await action;await tick();}
  t.diagnostic(JSON.stringify({scenario:'five-preset-selections',accountRequests:f.requests-before,synchronousDraft}));
  assert.equal(synchronousDraft,true);
  assert.equal(f.requests,before);assert.equal(f.store.duration,31);
  await button(f,'kronometre oluştur').props.onClick();assert.equal(f.store.name,'Odak','failed submit retains draft');assert.equal(f.store.duration,31);
 }finally{f.close();}
});
for(const view of ['Settings','Profile'])test(`UX ${view} Telegram preserves connected state through failure, gates double-click and discards late account response`,async()=>{
 const f=await fixture(view);try{
  f.telegram=async()=>({success:true,connected:true});await button(f,'Durumu yenile').props.onClick();await tick();assert.match(text(f.tree),/✓ Telegram bağlı/);
  const gate=deferred();f.telegram=()=>gate.promise;const count=f.actions.length;
  const pending=button(f,'Durumu yenile').props.onClick();await tick();await button(f,'Durumu yenile').props.onClick();assert.equal(f.actions.length,count+1);assert.match(text(f.tree),/Telegram bağlı/);
  gate.resolve({error:'unavailable'});await pending;await tick();assert.match(text(f.tree),/Son bilinen durum: Telegram bağlı/);assert.match(text(f.tree),/tamamlanamadı/);
  f.telegram=async()=>({success:'telegram bağlantısı kesildi.'});await button(f,'Bağlantıyı kes').props.onClick();await tick();assert.doesNotMatch(text(f.tree),/✓ Telegram bağlı/);
  const input=walk(f.tree).find(n=>n.tag==='input'&&n.props.placeholder?.includes('Chat ID'));f.input(input,'12345');
  f.telegram=async()=>({error:'failure'});await button(f,'Kaydet').props.onClick();await tick();assert.equal(input.value,'12345');assert.doesNotMatch(text(f.tree),/✓ Telegram bağlı/);
  const late=deferred();f.telegram=()=>late.promise;const request=button(f,'Durumu yenile').props.onClick();f.switch();late.resolve({success:true,connected:true});await request;await tick();
  assert.doesNotMatch(text(f.tree),/✓ Telegram bağlı|12345/);
 }finally{f.close();}
});
test('UX Settings preset input node and draft survive account timeout with no whole-page spinner',async()=>{
 const f=await fixture('Settings');try{
  const input=walk(f.tree).find(n=>n.tag==='input'&&n.props.placeholder?.includes('isim')) || walk(f.tree).find(n=>n.tag==='input'&&n.props.type==='text');
  assert.ok(input);f.input(input,'Taslak etiket');input.focus();input.selectionStart=4;
  f.reply=()=>new Promise(()=>{});const request=f.policy.refresh();await tick();assert.ok(walk(f.tree).includes(input));await request;await tick();
  assert.ok(walk(f.tree).includes(input));assert.equal(globalThis.document.activeElement,input);assert.equal(input.selectionStart,4);assert.equal(input.value,'Taslak etiket');
  assert.equal(f.policy.canFeature('presets'),false);
 }finally{f.close();}
});

test('UX Telegram bind requires server success, failed unlink retains status, expired subscription may still unlink',async()=>{
 const f=await fixture('Settings');try{
  const input=walk(f.tree).find(n=>n.tag==='input'&&n.props.placeholder?.includes('Chat ID'));f.input(input,'76543');
  f.telegram=async action=>action==='bind'?{success:true}:{success:true,connected:true};
  await button(f,'Kaydet').props.onClick();await tick();assert.match(text(f.tree),/✓ Telegram bağlı/);assert.match(text(f.tree),/Telegram bağlandı/);
  f.telegram=async()=>{throw Error('network');};await button(f,'Bağlantıyı kes').props.onClick();await tick();assert.match(text(f.tree),/Son bilinen durum: Telegram bağlı/);assert.doesNotMatch(text(f.tree),/bağlantısı kaldırıldı/);
  f.policy.rejectAuthority();await tick();const before=f.requests;
  f.telegram=async()=>({success:'telegram bağlantısı kesildi.'});await button(f,'Bağlantıyı kes').props.onClick();await tick();assert.match(text(f.tree),/bağlantısı kaldırıldı/);assert.equal(f.requests,before);
  const draft=walk(f.tree).find(n=>n.tag==='input'&&n.props.placeholder?.includes('Chat ID'));f.input(draft,'98765');await nextTick();assert.equal(button(f,'Kaydet').props.disabled,true);
 }finally{f.close();}
});
test('UX a Telegram response after route unmount cannot change the next view',async()=>{
 const a=await fixture('Settings'),late=deferred();a.telegram=()=>late.promise;const request=button(a,'Durumu yenile').props.onClick();a.close();
 const b=await fixture('Profile');try{late.resolve({success:true,connected:true});await request;await tick();assert.doesNotMatch(text(b.tree),/✓ Telegram bağlı/);assert.equal(b.actions.filter(x=>x[0]==='bind').length,0);}finally{b.close();}
});

test('UX Company workspace draft survives expiry and refresh cannot cancel an in-flight join',async()=>{
 const f=await fixture('Profile',true);try{
  const input=walk(f.tree).find(n=>n.props?.placeholder==='Davet kodu');assert.ok(input);f.input(input,'TEAM42');await nextTick();
  const join=button(f,'Katıl');let posts=0;const gate=deferred();
  f.workspaceRequest=async(_url,opts)=>{if(opts.method==='POST'){posts++;await gate.promise;return {ok:false,json:async()=>({error:'Davet geçersiz'})};}return {ok:true,json:async()=>({workspace:null})};};
  f.policy.rejectAuthority();await tick();assert.ok(walk(f.tree).includes(input),'expiry must not remove workspace draft');assert.equal(input.value,'TEAM42');
  const pending=join.props.onClick();await tick();assert.equal(posts,1,'fresh proof must not supersede the join operation');
  await f.policy.refresh();await tick();gate.resolve();await pending;await tick();assert.ok(button(f,'Katıl'));assert.equal(button(f,'Katıl').props.disabled,false);assert.equal(input.value,'TEAM42');assert.equal(posts,1);assert.ok(f.messages.some(x=>x.includes('Davet geçersiz')));
 }finally{f.close();}
});

for(const view of ['Settings','Profile']){
 test(`UX R1 ${view}: Company workspace=null queries, binds and unlinks its own Telegram connection`,async()=>{
  const f=await fixture(view,true,{workspaceId:null});try{
   assert.equal(f.policy.currentData.value.account.kind,'company');assert.equal(f.policy.currentData.value.personal.readable,false);assert.equal(f.policy.canFeature('telegram'),true);
   assert.deepEqual(f.actions,[['status']],'the mounted view must query even without a personal workspace');
   const input=walk(f.tree).find(n=>n.props?.placeholder?.includes('Chat ID'));assert.ok(input);f.input(input,'654321');input.focus();input.selectionStart=3;await nextTick();
   const gate=deferred();f.reply=()=>gate.promise;const refresh=f.policy.refresh();await tick();
   assert.ok(walk(f.tree).includes(input),'background refresh retains the Telegram form');assert.equal(input.value,'654321');assert.equal(globalThis.document.activeElement,input);assert.equal(input.selectionStart,3);
   gate.resolve({ok:true,json:async()=>f.body()});await refresh;await tick();assert.ok(walk(f.tree).includes(input));assert.equal(f.actions.length,1,'refresh does not duplicate the Telegram query');
   f.telegram=async action=>action==='bind'?{success:true}:{success:'telegram bağlantısı kesildi.'};
   await button(f,'Kaydet').props.onClick();await tick();assert.match(text(f.tree),/✓ Telegram bağlı/);assert.match(text(f.tree),/Telegram bağlandı/);
   await button(f,'Bağlantıyı kes').props.onClick();await tick();assert.match(text(f.tree),/Telegram bağlantısı kaldırıldı/);assert.deepEqual(f.actions,[['status'],['bind','654321'],['unlink']]);
  }finally{f.close();}
 });
}

for(const view of ['Settings','Profile']){
 test(`UX R1 ${view}: Company workspace=null cannot bind after a fresh authority denial`,async()=>{
  const f=await fixture(view,true,{workspaceId:null});try{
   const input=walk(f.tree).find(n=>n.props?.placeholder?.includes('Chat ID'));f.input(input,'654321');await nextTick();const save=button(f,'Kaydet');
   f.policy.rejectAuthority();f.reply=()=>({ok:false});await save.props.onClick();await tick();
   assert.equal(f.policy.canFeature('telegram'),false);assert.deepEqual(f.actions,[['status']]);assert.ok(walk(f.tree).includes(input));assert.equal(input.value,'654321');assert.equal(button(f,'Kaydet').props.disabled,true);assert.match(text(f.tree),/Yeni bağlantı için/);
  }finally{f.close();}
 });
 test(`UX R1 ${view}: expired Individual retains status and unlink but cannot bind`,async()=>{
  const f=await fixture(view,false,{expired:true});try{
   assert.equal(f.policy.currentData.value.personal.readable,true);assert.equal(f.policy.canFeature('telegram'),false);
   assert.deepEqual(f.actions,[['status']]);f.telegram=async()=>({success:true,connected:true});await button(f,'Durumu yenile').props.onClick();await tick();
   f.telegram=async()=>({success:'telegram bağlantısı kesildi.'});await button(f,'Bağlantıyı kes').props.onClick();await tick();assert.match(text(f.tree),/bağlantısı kaldırıldı/);
   const input=walk(f.tree).find(n=>n.props?.placeholder?.includes('Chat ID'));f.input(input,'321');await nextTick();assert.equal(button(f,'Kaydet').props.disabled,true);await button(f,'Kaydet').props.onClick();await tick();assert.equal(f.actions.some(x=>x[0]==='bind'),false);assert.equal(input.value,'321');
  }finally{f.close();}
 });
 for(const denied of ['logged-out','disabled','agent','superadmin'])test(`UX R1 ${view}: ${denied} scope cannot expose or manage Telegram`,async()=>{
  const options=denied==='disabled'?{disabledAt:'2026-10-17T00:00:00Z'}:{role:['agent','superadmin'].includes(denied)?denied:'worker'};
  const f=await fixture(view,true,{workspaceId:null,...options});try{
   if(denied==='logged-out'){f.logout();await tick();}
   const requests=f.actions.length;assert.equal(f.policy.currentData.value,null);assert.equal(f.policy.canFeature('telegram'),false);
   assert.equal(button(f,'Durumu yenile'),undefined);assert.equal(button(f,'Kaydet'),undefined);assert.equal(button(f,'Bağlantıyı kes'),undefined);
   assert.equal(f.actions.length,requests);if(denied!=='logged-out')assert.deepEqual(f.actions,[]);
  }finally{f.close();}
 });
 test(`UX R1 ${view}: Company workspace=null discards status, bind and unlink replies after account/logout changes`,async()=>{
  for(const action of ['status','bind','unlink']){
   const f=await fixture(view,true,{workspaceId:null});try{
    if(action==='unlink'){f.telegram=async()=>({success:true,connected:true});await button(f,'Durumu yenile').props.onClick();await tick();}
    if(action==='bind'){f.input(walk(f.tree).find(n=>n.props?.placeholder?.includes('Chat ID')),'999');await nextTick();}
    const gate=deferred();f.telegram=()=>gate.promise;const pending=button(f,action==='status'?'Durumu yenile':action==='bind'?'Kaydet':'Bağlantıyı kes').props.onClick();await tick();
    if(action==='unlink')f.logout();else f.switch();await tick();
    gate.resolve(action==='status'?{success:true,connected:true}:action==='bind'?{success:true}:{success:'telegram bağlantısı kesildi.'});await pending;await tick();
    assert.equal(f.policy.currentData.value,null);assert.doesNotMatch(text(f.tree),/Telegram bağlandı|Telegram bağlantısı kaldırıldı|Telegram bağlı|999/);assert.deepEqual(f.messages,[]);
   }finally{f.close();}
  }
 });
}
