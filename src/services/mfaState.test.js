import test from 'node:test';
import assert from 'node:assert/strict';
import {readMfaState,mfaRemaining,mfaTime} from './mfaState.js';
const state={phase:'challenge',serverNow:'2026-10-16T12:00:00Z',expiresAt:'2026-10-16T12:02:00Z',resendAvailableAt:'2026-10-16T12:01:00Z',sendLimitAvailableAt:null,lockedUntil:null,riskUntil:null,attemptsRemaining:6,delivery:'accepted',challengeId:'00000000-0000-4000-8000-000000000001',context:'a'.repeat(43)};
test('MFA display uses server interval and monotonic elapsed, not browser wall clock or payload countdown',()=>{
 const parsed=readMfaState({...state,expiresIn:999999,deviceId:'forged',accessToken:'secret'});
 assert.equal(parsed.expiresIn,undefined);assert.equal(parsed.deviceId,undefined);assert.equal(parsed.accessToken,undefined);
 const original=Date.now;Date.now=()=>0;
 try{assert.equal(mfaRemaining(parsed,'expiresAt',5000,55000),70);assert.equal(mfaRemaining(parsed,'expiresAt',5000,200000),0);assert.equal(mfaTime(70),'1:10');}
 finally{Date.now=original;}
});
test('malformed server states cannot enable MFA completion',()=>{
 for(const bad of [{phase:'authorized'},{serverNow:'no date'},{attemptsRemaining:7},{expiresAt:'forever'},{context:'bad'},{delivery:'success'}])assert.equal(readMfaState({...state,...bad}),null);
});
