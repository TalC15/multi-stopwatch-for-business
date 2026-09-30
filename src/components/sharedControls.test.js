import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRenderer, reactive, nextTick } from 'vue';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)), modules={}, files=[];
globalThis.Audio=class {pause(){} play(){return Promise.resolve();}};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
globalThis.localStorage={getItem:()=>null};
const renderer=createRenderer({
 createElement:tag=>({tag,props:{},children:[],parent:null,addEventListener(k,v){this.props['on'+k[0].toUpperCase()+k.slice(1)]=v;},removeEventListener(){},setAttribute(k,v){this.props[k]=v;},removeAttribute(k){delete this.props[k];}}),createText:text=>({text}),createComment:text=>({text:''}),
 setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.children=[{text:t}];},
 patchProp:(n,k,_old,v)=>{n.props[k]=v;n[k]=v;},parentNode:n=>n.parent,nextSibling:n=>n?.parent?.children[n.parent.children.indexOf(n)+1] ?? null,
 insert(n,p,anchor){ if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}n.parent=p;const i=p.children.indexOf(anchor);p.children.splice(i<0?p.children.length:i,0,n);},
 remove(n){if(n?.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}},
});
const walk=n=>[n,...(n.children??[]).flatMap(walk)];const text=n=>(n.text??'')+(n.children??[]).map(text).join('');

test('Home identifies personal conflict and requires separate explicit acceptance',async()=>{
 const {store,calls}=fixture();
 Object.assign(store,{syncStatus:'conflict',pendingCount:1,resolvingSync:false,syncReview:null,
   syncIssues:[{seq:1,timerId:'personal',name:'Local edit',method:'Kaydetme',httpStatus:409,reason:'Çakışma',canReview:true}],
   reviewSyncIssue(){calls.push('review');this.syncReview={name:'Local edit',serverName:'Other device',revision:9,kind:'active'};},
   acceptSyncServer(){calls.push('accept');this.syncReview=null;this.syncIssues=[];this.pendingCount=0;this.syncStatus='done';},
   cancelSyncReview(){calls.push('cancel');this.syncReview=null;},retrySync(){calls.push('retry');}});
 const {tree,app}=mount('Home');
 try {
  assert.match(text(tree),/Local edit/);assert.match(text(tree),/409/);
  await button(tree,'Sunucu kaydını incele').props.onClick();await nextTick();
  assert.match(text(tree),/Other device/);assert.match(text(tree),/bekleyen değişikliklerinden vazgeçilir/);
  assert.equal(calls.includes('accept'),false);
  await button(tree,'Koru ve vazgeç').props.onClick();await nextTick();assert.equal(store.pendingCount,1);
  await button(tree,'Sunucu kaydını incele').props.onClick();await nextTick();
  await button(tree,'Yerel değişikliklerden vazgeç').props.onClick();await nextTick();
  assert.deepEqual(calls,['review','cancel','review','accept']);
  assert.equal(text(tree).includes('Bazı sayaçlar'),false);
 } finally {app.unmount();}
});
const button=(tree,label)=>walk(tree).find(n=>n.tag==='button'&&text(n).includes(label));
function fixture(){
 const calls=[];const store=reactive({sharedWritable:false,sharedState:'offline-readonly',sharedPending:false,ready:true,user:{id:'u',workspace_id:'w'},
  sharedNotice:{state:'offline-readonly',tone:'warning',message:'İnternet bağlantısı bekleniyor. Ortak sayaçlar çevrimdışıyken değiştirilemez.'},
  stopwatches:[],presetTimes:[],presetNames:[],name:'Work',duration:1,roleStyles:{},initialize(){},
  requireSharedWrite(){calls.push('guard');return this.sharedWritable;},
  async startTimer(){calls.push('start');return true;},async pauseTimer(){calls.push('pause');return true;},
  async updateIsPay(){calls.push('pay');return true;},async deleteTimer(){calls.push('delete');return true;},async addTimer(){calls.push('create');return 'new';}});
 globalThis.__sharedUi={store,calls};return{store,calls};
}
function mount(name,props){const tree={children:[]};const app=renderer.createApp(modules[name],props);app.mount(tree);return{tree,app};}
before(async()=>{
 for(const [name,entry] of Object.entries({Card:'src/components/stopwatch/StopwatchCard.vue',Add:'src/components/stopwatch/AddModal.vue',Home:'src/views/HomeView.vue'})){
  const mocks={store:'export const useStopwatchStore=()=>globalThis.__sharedUi.store;',theme:'export const useThemeStore=()=>({applyTheme(){}});',
   message:'export const message={warning:t=>globalThis.__sharedUi.calls.push("warning"),success(){},error(){}};',
   backend:'export const getAccessToken=()=>"test";export const getUser=()=>globalThis.__sharedUi.store.user;export const getAuthGeneration=()=>1;export const apiFetch=async()=>({ok:true,json:async()=>({workspace:{shared_mode_enabled:true}})});',
   router:'import {h} from "vue";export const RouterLink={props:["to"],render(){return h("a",{href:this.to},this.$slots.default?.());}};',
   haptics:'export const hapticTap=()=>{};',audio:'export default "";',stub:'export default {render(){return null;}};'};
  const result=await build({configFile:false,root,logLevel:'silent',resolve:{alias:{'@':path.join(root,'src')}},plugins:[{
   name:'phase5-ui-fixture',enforce:'pre',resolveId(source){
    const key=source==='vue-router'?'router':source.includes('stopwatchStore')?'store':source.includes('themeStore')?'theme':source.includes('composables/message')?'message':
      source.includes('backendSync')?'backend':source.includes('haptics')?'haptics':source.endsWith('.mp3')?'audio':
      /Navbar.vue|SettingsDrawer.vue/.test(source)?'stub':null; if(key)return '\0fixture:'+key;
   },load(id){if(id.startsWith('\0fixture:'))return mocks[id.slice(9)];}
  },vue({template:{compilerOptions:{hoistStatic:false}}})],build:{write:false,minify:false,lib:{entry:path.join(root,entry),formats:['es']},rollupOptions:{external:['vue']}}});
  const file=path.join(root,`.phase5-ui-${name}.mjs`);files.push(file);await writeFile(file,(Array.isArray(result)?result[0]:result).output.find(x=>x.type==='chunk').code);
  modules[name]=(await import(pathToFileURL(file).href)).default;
 }
});
after(async()=>{await Promise.all(files.map(f=>unlink(f).catch(()=>{})));delete globalThis.__sharedUi;});
for(const type of ['up','down'])test(`${type} card guards actual Start/Pause, payment, Delete and an already-open confirmation`,async()=>{
 const{store,calls}=fixture();const timer=reactive({id:'t',name:'Test',isShared:true,type,status:'running',targetMinutes:1,elapsed:0,remaining:60000,isPay:false});
 const{tree,app}=mount('Card',{timer});
 try {
  const pause=button(tree,'Pause'),pay=button(tree,'Ödenmedi'),del=walk(tree).find(n=>n.props?.['aria-label']==='Sil: Test');
  for(const b of[pause,pay,del]){assert.ok(b);assert.equal(b.props['aria-disabled'],true);assert.notEqual(b.props.disabled,true);await b.props.onClick();}
  assert.deepEqual(calls,['guard','guard','guard']);
  timer.status='idle';await nextTick();await button(tree,'Start').props.onClick();assert.equal(calls.at(-1),'guard');assert.equal(calls.includes('start'),false);
  store.sharedWritable=true;await nextTick();await del.props.onClick();await nextTick();
  store.sharedWritable=false;await nextTick();const confirm=button(tree,'Sil');assert.equal(confirm.props['aria-disabled'],true);
  await confirm.props.onClick();assert.equal(calls.includes('delete'),false);
  store.sharedWritable=true;await nextTick();await confirm.props.onClick();await nextTick();assert.equal(calls.filter(x=>x==='delete').length,1);
 } finally{app.unmount();}
});
for(const forceShared of [true,false])test(`AddModal forceShared=${forceShared} blocks shared create and automatic start`,async()=>{
 const{calls}=fixture();const{tree,app}=mount('Add',{isOpen:true,defaultType:'up',forceShared});
 try{
  await new Promise(resolve=>setImmediate(resolve));await nextTick();
  if(!forceShared){const toggle=walk(tree).find(n=>n.props?.role==='switch');assert.ok(toggle);await toggle.props.onClick();
   await nextTick();
  }
  const save=walk(tree).find(n=>n.tag==='button'&&text(n).includes('oluştur'));assert.ok(save);await save.props.onClick();
  assert.equal(calls.includes('create'),false);assert.equal(calls.includes('start'),false);assert.ok(calls.includes('guard'));
 }finally{app.unmount();}
});
test('Home shared band is announced and shared floating Add is guarded',async()=>{
 const{calls}=fixture();const{tree,app}=mount('Home');
 try{await button(tree,'Ortak').props.onClick();await nextTick();
  assert.ok(walk(tree).some(n=>n.props?.role==='status'&&n.props['aria-live']==='polite'&&text(n).includes('çevrimdışı')));
  const add=walk(tree).find(n=>n.tag==='button'&&n.props['aria-disabled']===true);assert.ok(add);await add.props.onClick();assert.ok(calls.includes('guard'));assert.equal(calls.includes('create'),false);
 }finally{app.unmount();}
});
test('shared card renders controller server-time elapsed, not the device wall clock',async()=>{
 fixture();const {tree,app}=mount('Card',{timer:{id:'t',name:'Clock',isShared:true,type:'up',status:'running',
   targetMinutes:1,elapsed:2500,accumulatedTime:0,startTime:Date.now()-100000,isPay:false}});
 try {await nextTick();assert.match(text(tree),/00:02/);assert.doesNotMatch(text(tree),/01:40/);}
 finally{app.unmount();}
});

for(const [state,tone,message,to,action] of [
 ['signed-out','info','Ortak sayaçları görmek için giriş yapın.','/login','Giriş yap'],
 ['workspace-required','info','Ortak sayaçları kullanmak için bir şirkete katılın.','/profile','Şirkete katıl'],
 ['loading','neutral','Ortak bölüm hazırlanıyor…'],
 ['reconciling','neutral','Ortak sayaçlar güncelleniyor…'],
 ['offline-readonly','warning','İnternet bağlantısı bekleniyor. Ortak sayaçlar çevrimdışıyken değiştirilemez.'],
 ['unavailable','warning','Ortak sayaçlara şu anda ulaşılamıyor. Değişiklik yapmadan yeniden deneyin.'],
 ['auth-required','error','Ortak sayaçlar için oturumunuzu doğrulayın.','/login','Giriş yap'],
 ['pending','neutral','Ortak sayaç işlemi tamamlanıyor…'],
 ['ready','info','Ortak sayaçlar ekip üyeleriyle güncel tutulur.'],
]) test(`Home shared ${state} renders one themed message, correct action and no personal warning`,async()=>{
 const {store,calls}=fixture();
 Object.assign(store,{sharedNotice:{state,tone,message,to,action},syncStatus:'retry',pendingCount:2,
  syncIssues:[{seq:1,name:'Private conflict',reason:'Personal issue',method:'Kaydetme'}],
  loadSharedTimers(){calls.push('reload-shared');}});
 const {tree,app}=mount('Home');
 try {
  await button(tree,'Ortak').props.onClick();await nextTick();
  const panels=walk(tree).filter(n=>n.props?.role==='status');assert.equal(panels.length,1);
  assert.match(text(panels[0]),new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(panels[0].props['data-state'],state);assert.equal(panels[0].props['aria-live'],'polite');
  assert.match(panels[0].props.class,/dark:/);assert.equal(/animate-/.test(panels[0].props.class),false);
  assert.ok(walk(panels[0]).some(n=>n.tag==='svg'&&n.props['aria-hidden']==='true'));
  assert.equal(text(tree).includes('Private conflict'),false);assert.equal(text(tree).includes('kişisel'),false);
  assert.equal(Boolean(button(tree,'Senkronizasyonu yeniden dene')),false);
  const links=walk(panels[0]).filter(n=>n.tag==='a');
  assert.equal(links.length,to?1:0);if(to){assert.equal(links[0].props.href,to);assert.equal(text(links[0]),action);}
  if(state==='unavailable'){await button(tree,'Yeniden dene').props.onClick();assert.deepEqual(calls,['reload-shared']);}
  assert.equal(text(tree).includes('Henüz ortak kronometre veya sayaç yok'),state==='ready');
 }finally{app.unmount();}
});
test('Home personal retry has one clear local-saved message and shared information stays in its own tab',async()=>{
 const {store}=fixture();Object.assign(store,{syncStatus:'retry',pendingCount:2,retrySync(){}});
 const {tree,app}=mount('Home');
 try {
  const panels=walk(tree).filter(n=>n.props?.role==='status');assert.equal(panels.length,1);
  assert.match(text(panels[0]),/Kişisel sayaçlar/);assert.match(text(panels[0]),/Cihazdaki kayıtlarınız korunuyor/);
  assert.equal(text(tree).includes('ekip üyeleriyle'),false);
  await button(tree,'Ortak').props.onClick();await nextTick();assert.equal(text(tree).includes('Kişisel sayaçlar'),false);
  await button(tree,'Kronometre').props.onClick();await nextTick();assert.match(text(tree),/Kişisel sayaçlar/);
 }finally{app.unmount();}
});
for(const isShared of [true,false]) test(`countdown isShared=${isShared} preserves server completion boundary with a simple label`,async()=>{
 fixture();const timer=reactive({id:'t',name:'Deadline',isShared,type:'down',status:'running',targetMinutes:1,
  elapsed:60000,remaining:0,accumulatedTime:60000,startTime:null,isPay:false});
 const {tree,app}=mount('Card',{timer});
 try {
  assert.equal(text(tree).includes('Bitiş onayı bekleniyor'),isShared);
  assert.equal(text(tree).includes('Sunucu doğrulaması'),false);
  assert.equal(timer.status,'running');
 }finally{app.unmount();}
});
