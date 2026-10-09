import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAccountExperience } from '../../services/accountExperience.js';
import { nextTick } from 'vue';
const root=fileURLToPath(new URL('../../../',import.meta.url)), compiled=new URL('../../../.phase5-features-test.mjs',import.meta.url);
const userId='00000000-0000-4000-8000-000000000001', workspaceId='00000000-0000-4000-8000-000000000002';
let current=null,result,notify,spoken=[],tones=0,connected=true;
const events=new EventTarget();
const policy=createAccountExperience({auth:{getUser:()=>current,isTabSessionCurrent:()=>!!current,getAuthGeneration:()=>1,getTabSessionIdentity:()=>current?userId+':session':null,
  getSessionMarker:()=>current?userId+':session':null,getAccessToken:()=> 'synthetic-only'},events,online:()=>connected,
  request:async()=>{if(result instanceof Error)throw result;if(typeof result==='function')return result();if(result?.httpStatus)return {ok:false,status:result.httpStatus};return {ok:true,json:async()=>result};}});
const body=(status='active',kind='individual')=>({account:{kind,userId,workspaceId},
  subscription:kind==='company'?{planCode:null,status:null,startsAt:null,endsAt:null,isEntitled:false}:{planCode:'individual',status,startsAt:'2026-10-01T00:00:00.000001Z',endsAt:'2026-11-01T00:00:00.000002Z',isEntitled:status==='active'},
  code:kind==='company'?'SUBSCRIPTION_REQUIRED':status==='active'?null:status==='expired'?'SUBSCRIPTION_EXPIRED':'SUBSCRIPTION_PENDING',
  features:{tts:kind==='company'||status==='active',telegram:kind==='company'||status==='active',presets:kind==='company'||status==='active'},
  personal:{readable:true,writable:kind==='company'||status==='active'},shared:kind==='company',loginReady:false});
before(async()=>{
  globalThis.__phase5AlarmPolicy=policy;
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.document={visibilityState:'visible'};
  globalThis.Audio=class {play(){tones++;if(!this.loop)setTimeout(()=>this.onended?.(),1);return Promise.resolve();}pause(){} load(){} removeAttribute(){} };
  globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  globalThis.speechSynthesis={getVoices:()=>[{lang:'tr-TR',localService:true}],speak:u=>{if(u.text.trim())spoken.push(u.text);setImmediate(()=>u.onend?.());},cancel(){},addEventListener(){},removeEventListener(){}};
  const mocks={policy:'export const accountExperience=globalThis.__phase5AlarmPolicy;',capacitor:'export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>"web"};',
    tts:'export const TextToSpeech={};',notifications:'export const LocalNotifications={};',haptics:'export const hapticAlarm=()=>{};',audio:'export default "synthetic-sound";'};
  const built=await build({root,configFile:false,logLevel:'silent',plugins:[{name:'phase5-alarm-fixture',enforce:'pre',resolveId(source){const name=source.includes('services/accountExperience')?'policy':source==='@capacitor/core'?'capacitor':source==='@capacitor-community/text-to-speech'?'tts':source==='@capacitor/local-notifications'?'notifications':source.includes('haptics')?'haptics':source.endsWith('.mp3')?'audio':null;return name?'\0phase5-alarm:'+name:null;},load(id){if(id.startsWith('\0phase5-alarm:'))return mocks[id.split(':').at(-1)];}},vue()],
    build:{write:false,minify:false,lib:{entry:root+'src/utils/notifications.js',formats:['es']},rollupOptions:{external:['vue']}}});
  await writeFile(compiled,(Array.isArray(built)?built[0]:built).output.find(o=>o.type==='chunk').code);notify=await import(compiled.href);
});
after(async()=>{notify?.stopAllAlarmSounds();policy.dispose();await unlink(compiled).catch(()=>{});delete globalThis.__phase5AlarmPolicy;});
for(const status of ['standalone','pending','expired','unavailable','active','company','company-offline','company-denied-offline'])test('Phase 5 actual notification effects: '+status+' TTS policy leaves normal alarm available',async()=>{
  connected=true;
  current=status==='standalone'?null:{id:userId,workspace_id:workspaceId,role:'worker',plan_code:'individual'};
  const company=status.startsWith('company');
  result=status==='unavailable'?Error('network'):body(company?'active':status,company?'company':'individual');
  policy.reset();await policy.refresh();const oldSpoken=spoken.length,oldTones=tones;
  if(status==='company-denied-offline'){result={httpStatus:403};assert.equal(await policy.refresh(),false);}
  if(status.endsWith('-offline'))connected=false;
  await notify.testAlarm();
  assert.ok(tones>oldTones,'ordinary audio remains available');
  assert.equal(spoken.length-oldSpoken,['active','company','company-offline'].includes(status)?1:0,'actual speech effect requires verified Individual rights or unchanged-session legacy company proof');
});
test('Phase 5 in-progress company speech stops when denial arrives while status remains offline',async()=>{
  connected=true;current={id:userId,workspace_id:workspaceId,role:'worker',plan_code:'individual'};
  result=body('active','company');policy.reset();assert.equal(await policy.refresh(),true);
  connected=false;events.dispatchEvent(new Event('offline'));await nextTick();
  const originalSpeak=speechSynthesis.speak,originalCancel=speechSynthesis.cancel;
  let started,cancelled=0,timer;
  const speaking=new Promise(resolve=>{started=resolve;});
  speechSynthesis.speak=u=>{if(u.text.trim()){spoken.push(u.text);started();}};
  speechSynthesis.cancel=()=>{cancelled++;};
  const alarm=notify.testAlarm();
  try {
    await Promise.race([speaking,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('speech did not start')),1000);})]);
    connected=true;let finish;result=()=>new Promise(resolve=>{finish=resolve;});const pending=policy.refresh();
    connected=false;events.dispatchEvent(new Event('offline'));await nextTick();
    assert.equal(policy.state.status,'offline');const previous=cancelled;
    finish({ok:false,status:403});assert.equal(await pending,false);await nextTick();
    assert.equal(policy.state.status,'offline');assert.ok(cancelled>previous,'server denial must interrupt already-playing speech without a status change');
  } finally {
    clearTimeout(timer);notify.stopAllAlarmSounds();await alarm;
    speechSynthesis.speak=originalSpeak;speechSynthesis.cancel=originalCancel;
  }
});
