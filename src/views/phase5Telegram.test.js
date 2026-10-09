import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { computed, reactive, createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';

const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=[],views={};
const own='aaaaaaaa-0000-4000-8000-000000000001',other='aaaaaaaa-0000-4000-8000-000000000002';
before(async()=>{
  const mocks={
    backend:`const f=()=>globalThis.__telegramViewFixture;
      export const getUser=()=>f().user;
      export const getAuthGeneration=()=>f().generation;
      export const getTabSessionIdentity=()=>f().user?.id+':session';
      export const getSessionMarker=()=>getTabSessionIdentity();
      export const isTabSessionCurrent=()=>f().authenticated;
      export const getAccessToken=()=> 'synthetic';
      export const apiFetch=async()=>null;
      export const saveTelegramChatId=chat=>f().save(chat);
      export const cancelTelegramChatId=id=>f().remove(id);
      export const telegramControl=id=>f().read(id);`,
    policy:`const p=()=>globalThis.__telegramViewFixture.policy;
      export const accountExperience={get state(){return p().state;},get currentData(){return p().currentData;},
        canFeature:(...args)=>p().canFeature(...args),canShared:()=>p().canShared(),refresh:()=>p().refresh(),requireFeature:(...args)=>p().requireFeature(...args)};`,
    store:'export const useStopwatchStore=()=>({ready:true,stopwatches:[],roleStyles:{worker:{}},presetTimes:[],presetNames:[]});',
    theme:'export const useThemeStore=()=>({theme:"light",toggleTheme(){}});',
    router:'export const useRouter=()=>({push(){}});',
    message:`const log=(kind,text)=>globalThis.__telegramViewFixture.messages.push([kind,text]);export const message={withLoading:(_label,fn)=>fn,success:text=>log('success',text),warning:text=>log('warning',text),error:text=>log('error',text)};`,
    socket:'export const disconnectSocket=()=>{};export const connectSocket=()=>{};',
    component:'export default {render:()=>null};',
  };
  for(const name of ['ProfileView','SettingsView']){
    const artifact=new URL('../../.phase5-telegram-'+name+'.mjs',import.meta.url);compiled.push(artifact);
    const built=await build({root,configFile:false,logLevel:'silent',resolve:{alias:{'@':root+'src'}},plugins:[{
      name:'telegram-view-test-fixtures',enforce:'pre',
      resolveId(source){
        const key=source.includes('backendSync')?'backend':source.includes('services/accountExperience')?'policy':source.includes('stores/stopwatchStore')?'store':source.includes('stores/themeStore')?'theme':source==='vue-router'?'router':source.includes('composables/message')?'message':source.includes('services/socket')?'socket':/components\/(AccountStatusCard|SoundSettings|NotificationSettings)/.test(source)?'component':null;
        return key?'\0telegram-fixture:'+key:null;
      },
      load(id){if(id.startsWith('\0telegram-fixture:'))return mocks[id.split(':').at(-1)];},
      transform(source,id){if(id.endsWith('/'+name+'.vue'))return source.replace('</script>',`globalThis.__telegramViewFixture.capture({saveTelegram,removeTelegram,telegramSavedControl,telegramSaved,chatId});\n</script>`);},
    },vue()],build:{write:false,minify:false,lib:{entry:root+'src/views/'+name+'.vue',formats:['es']},rollupOptions:{external:['vue']}}});
    await writeFile(artifact,(Array.isArray(built)?built[0]:built).output.find(x=>x.type==='chunk').code);
    views[name]=(await import(artifact.href)).default;
  }
});
after(async()=>{await Promise.all(compiled.map(p=>unlink(p).catch(()=>{})));delete globalThis.__telegramViewFixture;delete globalThis.localStorage;});

async function fixture(name,mode='active'){
  const state=reactive({status:'verified',mode,userId:own});
  const f={user:{id:own,workspace_id:other,role:'worker',username:'Synthetic'},generation:1,authenticated:true,calls:[],removed:0,messages:[],storage:new Map(),writes:[],
    policy:{state,currentData:computed(()=>({account:{kind:state.mode==='company'?'company':'individual',userId:state.userId},personal:{readable:true}})),
      canFeature:()=>state.status==='verified'&&['active','company'].includes(state.mode),
      canShared:()=>false,refresh:async()=>true,requireFeature:async()=>['active','company'].includes(state.mode)&&state.status==='verified'},
    capture(bindings){this.bindings=bindings;},
    read:async id=>{f.calls.push(['read',id]);return {success:true,connected:true};},
    save:async chat=>{f.calls.push(['save',chat]);return {success:true};},
    remove:async id=>{f.calls.push(['remove',id]);return {success:'telegram bağlantısı kesildi.'};},
  };
  globalThis.__telegramViewFixture=f;
  globalThis.localStorage={setItem(key,value){f.writes.push(['set',key,value]);f.storage.set(key,value);},removeItem(key){f.removed++;f.writes.push(['remove',key]);f.storage.delete(key);}};
  let render;
  const component={setup(){render??=views[name].setup({}, {expose(){}});return render;}};
  f.html=()=>renderToString(createSSRApp(component));
  await f.html();
  f.switch=()=>{f.generation++;f.user={...f.user,id:other};state.userId=other;};
  return f;
}

for(const name of ['ProfileView','SettingsView']){
  for(const mode of ['active','company'])test(name+': '+mode+' can read, bind and unlink its own Telegram connection',async()=>{
    const f=await fixture(name,mode);f.read=async id=>{f.calls.push(['read',id]);return {success:true,connected:false};};
    await f.bindings.telegramSavedControl();assert.match(await f.html(),/Chat ID \(örn:/);
    f.bindings.chatId.value='1234';await f.bindings.saveTelegram();assert.match(await f.html(),/Bağlantıyı kes/);
    await f.bindings.removeTelegram(other);assert.equal(f.bindings.telegramSaved.value,false);
    assert.deepEqual(f.calls,[['read',own],['save','1234'],['remove',own]]);
  });
  for(const mode of ['pending','expired','cancelled'])test(name+': '+mode+' can read/unlink but cannot bind or gain notification rights',async()=>{
    const f=await fixture(name,mode);await f.bindings.telegramSavedControl();const html=await f.html();
    assert.match(html,/Bağlantıyı kes/);assert.doesNotMatch(html,/Chat ID \(örn:/);
    await f.bindings.removeTelegram();assert.equal(f.bindings.telegramSaved.value,false);
    f.bindings.chatId.value='5678';await f.bindings.saveTelegram();assert.equal(f.policy.canFeature('telegram'),false);
    assert.deepEqual(f.calls,[['read',own],['remove',own]]);assert.doesNotMatch(await f.html(),/Chat ID \(örn:|Bağlantıyı kes/);
  });
  test(name+': malformed connection state cannot masquerade as linked or open the bind form',async()=>{
    const f=await fixture(name);f.read=async()=>({success:true,connected:'true',telegram_chat_id:'must-not-display'});
    await f.bindings.telegramSavedControl();assert.equal(f.bindings.telegramSaved.value,null);
    const html=await f.html();assert.match(html,/Bağlantı durumu doğrulanamadı/);assert.doesNotMatch(html,/Bağlantıyı kes|Chat ID \(örn:|must-not-display/);
  });
  test(name+': unauthenticated session cannot query, bind or unlink',async()=>{
    const f=await fixture(name);f.authenticated=false;
    await f.bindings.telegramSavedControl();f.bindings.chatId.value='1234';await f.bindings.saveTelegram();await f.bindings.removeTelegram();
    assert.deepEqual(f.calls,[]);assert.equal(f.bindings.telegramSaved.value,null);
  });
  test(name+': late connection/unlink replies do not affect another session',async()=>{
    const f=await fixture(name,'expired');let finish;
    f.read=()=>new Promise(resolve=>{finish=resolve;});const reading=f.bindings.telegramSavedControl();f.switch();
    finish({success:true,connected:true});await reading;assert.equal(f.bindings.telegramSaved.value,null);
    let unlink;f.remove=()=>new Promise(resolve=>{unlink=resolve;});const removing=f.bindings.removeTelegram();f.switch();
    unlink({success:'telegram bağlantısı kesildi.'});await removing;assert.equal(f.removed,0);assert.equal(f.bindings.telegramSaved.value,null);
  });
}

const unverifiable='Telegram işleminin sonucu doğrulanamadı. Bağlantı durumunu yeniden kontrol edin.';
const invalidReplies=[
  ['string false',{success:'false'}],['object',{success:{}}],['array value',{success:[]}],
  ['missing',{}],['null success',{success:null}],['unknown string',{success:'unknown'}],
  ['boolean false',{success:false}],['number',{success:1}],['null response',null],
  ['string response','success'],['boolean response',true],['number response',1],
  ['array response',[]],['array with bind success',Object.assign([],{success:true})],
  ['array with unlink success',Object.assign([],{success:'telegram bağlantısı kesildi.'})],
];
for(const name of ['ProfileView','SettingsView']){
  for(const operation of ['save','remove']){
    for(const [label,response] of [...invalidReplies,[operation==='save'?'unlink response':'bind response',
      {success:operation==='save'?'telegram bağlantısı kesildi.':true}]]){
      test(`${name}: ${operation} rejects ${label} without storage writes or success notice`,async()=>{
        const f=await fixture(name);f.storage.set('telegramChatId','existing');
        await f.bindings.telegramSavedControl();f.bindings.chatId.value='1234';let mutations=0;
        f[operation]=async()=>{mutations++;return response;};
        await f.bindings[operation==='save'?'saveTelegram':'removeTelegram']();
        assert.deepEqual(f.writes,[]);assert.equal(f.storage.get('telegramChatId'),'existing');
        assert.equal(f.bindings.telegramSaved.value,null);assert.equal(mutations,1);
        assert.deepEqual(f.messages,[['warning',unverifiable]]);
        assert.match(await f.html(),/Durumu yenile/);
      });
    }
  }
  test(name+': exact valid mutation replies update storage, state and success notices',async()=>{
    const f=await fixture(name);f.bindings.chatId.value='1234';await f.bindings.saveTelegram();
    assert.equal(f.storage.get('telegramChatId'),'1234');assert.equal(f.bindings.telegramSaved.value,true);
    await f.bindings.removeTelegram();assert.equal(f.storage.has('telegramChatId'),false);
    assert.equal(f.bindings.telegramSaved.value,false);
    assert.deepEqual(f.messages,[['success','Telegram bağlandı!'],['success','Telegram bağlantısı kesildi']]);
  });
  test(name+': rejected refresh clears stale status without changing storage',async()=>{
    const f=await fixture(name);f.storage.set('telegramChatId','existing');
    await f.bindings.telegramSavedControl();assert.equal(f.bindings.telegramSaved.value,true);
    f.read=async()=>{throw new Error('synthetic rejected request');};
    await f.bindings.telegramSavedControl();assert.equal(f.bindings.telegramSaved.value,null);
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.messages,[['warning',unverifiable]]);
    assert.match(await f.html(),/Durumu yenile/);
  });
  test(name+': late bind reply and rejected refresh do not affect the next session',async()=>{
    const f=await fixture(name);let finish,started;
    const entered=new Promise(resolve=>{started=resolve;});
    f.save=()=>new Promise(resolve=>{finish=resolve;started();});f.bindings.chatId.value='1234';
    const saving=f.bindings.saveTelegram();await entered;f.switch();finish({success:true});await saving;
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.messages,[]);assert.equal(f.bindings.telegramSaved.value,null);
    let reject;f.read=()=>new Promise((_resolve,r)=>{reject=r;});
    const reading=f.bindings.telegramSavedControl();f.switch();reject(new Error('late request'));
    await reading;assert.deepEqual(f.writes,[]);assert.deepEqual(f.messages,[]);
  });
  test(name+': array status response is unknown even with success and connected properties',async()=>{
    const f=await fixture(name);f.read=async()=>Object.assign([],{success:true,connected:true});
    await f.bindings.telegramSavedControl();assert.equal(f.bindings.telegramSaved.value,null);
  });
}
