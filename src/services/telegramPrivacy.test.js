import test from 'node:test';
import assert from 'node:assert/strict';
import {browser,loggedIn,user} from './testSupport/authHarness.js';
test('legacy Telegram cleanup is idempotent, preserves auth/preferences, never binds or unlinks',async()=>{
 const b=browser(),tab=b.tab();tab.setFetch(()=>loggedIn());await tab.auth.login('A','pin');
 const marker=tab.auth.getSessionMarker();
 for(const storage of [tab.context.localStorage,tab.context.sessionStorage]){
  storage.setItem('telegramChatId','-10012345678901234567');
  storage.setItem('user',JSON.stringify({...user,telegram_chat_id:'old',telegramChatId:'older',theme:'dark'}));
  storage.setItem('theme','dark');storage.setItem('timers','unchanged');storage.setItem('customTelegramSetting','keep');
 }
 let calls=0;tab.setFetch(()=>{calls++;throw Error('cleanup must not use HTTP');});
 for(let i=0;i<2;i++)tab.auth.cleanLegacyTelegramStorage();
 for(const storage of [tab.context.localStorage,tab.context.sessionStorage]){
  assert.equal(storage.getItem('telegramChatId'),null);
  assert.deepEqual(JSON.parse(storage.getItem('user')),{...user,theme:'dark'});
  assert.equal(storage.getItem('theme'),'dark');assert.equal(storage.getItem('timers'),'unchanged');assert.equal(storage.getItem('customTelegramSetting'),'keep');
 }
 assert.equal(tab.auth.getSessionMarker(),marker);assert.equal(calls,0);
 tab.auth.saveUser({...user,telegram_chat_id:'do-not-persist',telegramChatId:'do-not-persist'});
 assert.deepEqual(JSON.parse(tab.context.localStorage.getItem('user')),user);
});
test('startup cleanup removes legacy keys without deleting malformed unrelated user data',()=>{
 const tab=browser().tab();tab.context.localStorage.setItem('telegramChatId','123');tab.context.localStorage.setItem('user','malformed');
 tab.auth.initializeAuthSession();assert.equal(tab.context.localStorage.getItem('telegramChatId'),null);assert.equal(tab.context.localStorage.getItem('user'),'malformed');
});
