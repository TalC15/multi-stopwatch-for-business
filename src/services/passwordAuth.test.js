import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAuthLink} from './authLink.js';
import {browser,user,sid,sidB,access,response,loggedIn,deferred,settle} from './testSupport/authHarness.js';
const challengeId='00000000-0000-4000-8000-000000000099',context='a'.repeat(43);
const mfaState=()=>({phase:'challenge',serverNow:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),resendAvailableAt:new Date(Date.now()+60000).toISOString(),sendLimitAvailableAt:null,lockedUntil:null,riskUntil:null,attemptsRemaining:6,delivery:'accepted',challengeId,context});
const pending=()=>response(200,{mfaRequired:true,...mfaState()});
test('activation fragment immediately cleared, duplicate/invalid tokens fail and wrong route never accepts',()=>{
 let path;const history={state:{},replaceState:(_s,_title,value)=>{path=value;}};
 const location={pathname:'/account/activate',hash:`#id=${challengeId}&token=${context}`,search:''};
 assert.deepEqual(captureAuthLink(location,history),{purpose:'activation',challengeId,context});assert.equal(path,'/account/activate');
 for(const hash of ['#id=bad&token='+context,`#id=${challengeId}&token=${context}&token=${context}`,`#id=${challengeId}&token=short`, '#mfaPassed=true'])assert.equal(captureAuthLink({...location,hash},history),null);
 assert.equal(captureAuthLink({...location,pathname:'/profile'},history),null);
});
test('MFA pending grants no local identity/token/cache, completed session uses existing events only',async()=>{
 const b=browser(),tab=b.tab();const calls=[];
 tab.setFetch((url,options)=>{calls.push({url,options});return url.endsWith('password-login')?pending():loggedIn(sid,{...user,role:'agent'});});
 const first=await tab.auth.passwordLogin('admin@example.test','private-test-password');
 assert.equal(first.success,false);assert.equal(first.mfaRequired,true);assert.equal(tab.auth.getAccessToken(),null);assert.equal(b.writes.length,0);
 const done=await tab.auth.completePasswordMfa(challengeId,context,'12345678');assert.equal(done.success,true);assert.equal(done.user.role,'agent');
 assert.equal(tab.auth.getAccessToken(),access(sid));assert.equal(calls[1].url,'/api/auth/mfa/verify');
 for(const write of b.writes)assert.ok(!/12345678|private-test-password|a{43}/.test(write.value));
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
 assert.equal(calls[0].options.headers['X-KeepTimer-CSRF'],'1');
});
test('account switch makes pending MFA stale before request and cannot import old entitlement/session',async()=>{
 const b=browser(),a=b.tab(),other=b.tab();a.setFetch(()=>pending());
 await a.auth.passwordLogin('admin@example.test','private-password-only');
 other.setFetch(()=>loggedIn(sidB));assert.equal((await other.auth.login('worker','test-pin')).success,true);
 let calls=0;a.setFetch(()=>{calls++;return loggedIn();});
 const result=await a.auth.completePasswordMfa(challengeId,context,'12345678');assert.equal(result.stale,true);assert.equal(calls,0);
 assert.equal(a.auth.getAccessToken(),null);assert.equal(other.auth.getAccessToken(),access(sidB));
});
test('delayed MFA response after remote account switch is rejected; no identity overwrite',async()=>{
 const b=browser(),a=b.tab(),other=b.tab(),gate=deferred();a.setFetch(()=>pending());await a.auth.passwordLogin('a@example.test','test-password-only');
 // Deliberately disable cross-tab locks for a storage-event race: correctness
 // still rests on the generation/marker check after the response.
 a.context.navigator.locks=undefined;other.context.navigator.locks=undefined;
 a.setFetch(()=>gate.promise);const checking=a.auth.completePasswordMfa(challengeId,context,'12345678');await settle();
 other.setFetch(()=>loggedIn(sidB));await other.auth.login('worker','test-pin');gate.resolve(loggedIn());
 assert.equal((await checking).stale,true);assert.equal(other.auth.getAccessToken(),access(sidB));
});
test('MFA malformed first-factor token-bearing response is never treated as pending/success',async()=>{
 const b=browser(),tab=b.tab();tab.setFetch(()=>response(200,{mfaRequired:true,...mfaState(),accessToken:'forged'}));
 const first=await tab.auth.passwordLogin('admin@example.test','test-only-password');assert.equal(first.success,false);assert.equal(first.mfaRequired,undefined);assert.equal(b.writes.length,0);
});
test('Android password uses fixed native bridge and never HTTP/JS refresh persistence or privileged MFA fallback',async()=>{
 const b=browser(),calls=[],tab=b.tab({platform:'android',native:{passwordLogin:async body=>{calls.push(body);return {accessToken:access(),sessionId:sid,user:{...user,username:'owner'}};}}});
 tab.setFetch(()=>assert.fail('native must not call fetch'));
 assert.equal((await tab.auth.passwordLogin('owner@example.test','only-in-native-request')).success,true);assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{email:'owner@example.test',password:'only-in-native-request'});
 assert.ok(!JSON.stringify(b.writes).includes('only-in-native-request'));
 assert.equal((await tab.auth.completePasswordMfa(challengeId,context,'12345678')).success,false);
});
test('A pending MFA cannot resend after B logs in, after logout, or with a different context',async()=>{
 const b=browser(),a=b.tab(),other=b.tab();a.setFetch(()=>pending());
 await a.auth.passwordLogin('a@example.test','synthetic-password-only');
 let sent=0;a.setFetch(()=>{sent++;return response(200,{accepted:true,retryAfter:60});});
 assert.equal((await a.auth.resendPasswordMfa(challengeId,'b'.repeat(43))).stale,true);assert.equal(sent,0);
 other.setFetch(()=>loggedIn(sidB));await other.auth.login('b','fixture-pin');
 assert.equal((await a.auth.resendPasswordMfa(challengeId,context)).stale,true);assert.equal(sent,0);
 const solo=browser().tab();solo.setFetch(()=>pending());await solo.auth.passwordLogin('a@example.test','synthetic-password-only');
 await solo.auth.logout();solo.setFetch(()=>assert.fail('stale resend must never reach HTTP'));
 assert.equal((await solo.auth.resendPasswordMfa(challengeId,context)).stale,true);
});
test('delayed resend after remote account switch cannot update B; current resend uses auth transport',async()=>{
 const b=browser(),a=b.tab(),other=b.tab(),gate=deferred();a.setFetch(()=>pending());
 await a.auth.passwordLogin('a@example.test','synthetic-password-only');
 a.context.navigator.locks=undefined;other.context.navigator.locks=undefined;
 a.setFetch((url,options)=>{assert.equal(url,'/api/auth/mfa/resend');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');return gate.promise;});
 const sending=a.auth.resendPasswordMfa(challengeId,context);await settle();other.setFetch(()=>loggedIn(sidB));await other.auth.login('b','fixture-pin');
 gate.resolve(response(200,{accepted:true,retryAfter:60}));assert.equal((await sending).stale,true);
 assert.equal(other.auth.getAccessToken(),access(sidB));assert.equal(a.auth.getAccessToken(),null);
});
test('reload resumes server MFA without storage secrets; unknown resend retry retains operation through status sync',async()=>{
 const b=browser(),tab=b.tab();let state=mfaState();
 tab.setFetch(()=>response(200,{state}));
 assert.equal((await tab.auth.syncPasswordMfa()).state.challengeId,challengeId);
 const operations=[];let lose=true;
 tab.setFetch((url,options)=>{
  if(url.endsWith('/status'))return response(200,{state});
  operations.push(JSON.parse(options.body).operationId);
  if(lose){lose=false;throw Error('response lost');}
  return response(200,{accepted:true,...state});
 });
 assert.equal((await tab.auth.resendPasswordMfa(challengeId,context)).ok,false);
 await tab.auth.syncPasswordMfa();
 assert.equal((await tab.auth.resendPasswordMfa(challengeId,context)).ok,true);
 assert.equal(operations[0],operations[1]);assert.equal(b.writes.length,0);
 state={...state,phase:'locked',attemptsRemaining:0,lockedUntil:new Date(Date.now()+600000).toISOString()};
 await tab.auth.syncPasswordMfa();assert.equal(tab.auth.isPendingPasswordMfa(challengeId,context),false);
});
test('late status JSON and network failure after account switch cannot import A MFA state',async()=>{
 for(const reject of [false,true]){
  const b=browser(),a=b.tab(),other=b.tab(),gate=deferred(),entered=deferred();
  a.context.navigator.locks=undefined;other.context.navigator.locks=undefined;
  a.setFetch(()=>({ok:true,status:200,json:()=>{entered.resolve();return gate.promise;}}));
  const syncing=a.auth.syncPasswordMfa();await entered.promise;
  other.setFetch(()=>loggedIn(sidB));await other.auth.login('B','fixture-pin');
  if(reject)gate.reject(Error('lost'));else gate.resolve({state:mfaState()});
  const result=await syncing;assert.equal(result.stale,true);assert.equal(result.state,undefined);
  assert.equal(a.auth.isPendingPasswordMfa(challengeId,context),false);
 }
});
test('truncated verify JSON remains indeterminate and retry retains its operation UUID',async()=>{
 const tab=browser().tab(),operations=[];tab.setFetch(()=>pending());
 await tab.auth.passwordLogin('admin@example.test','synthetic-password-only');
 tab.setFetch((_url,options)=>{operations.push(JSON.parse(options.body).operationId);return {ok:false,status:401,json:async()=>{throw Error('body lost');}};});
 const first=await tab.auth.completePasswordMfa(challengeId,context,'11111111');
 assert.equal(first.indeterminate,true);assert.equal(first.success,false);
 await tab.auth.completePasswordMfa(challengeId,context,'11111111');assert.equal(operations[0],operations[1]);
});
