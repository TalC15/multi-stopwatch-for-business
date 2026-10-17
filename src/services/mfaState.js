const phases=new Set(['idle','challenge','expired','locked','risk_wait','consumed']);
export function readMfaState(value){
 if(!value || typeof value!=='object' || Array.isArray(value) || !phases.has(value.phase) ||
  !Number.isFinite(Date.parse(value.serverNow)) || !Number.isInteger(value.attemptsRemaining) || value.attemptsRemaining<0 || value.attemptsRemaining>6)return null;
 const state={phase:value.phase,serverNow:value.serverNow,attemptsRemaining:value.attemptsRemaining};
 for(const key of ['expiresAt','resendAvailableAt','sendLimitAvailableAt','lockedUntil','riskUntil']){
  if(value[key]!==null && !Number.isFinite(Date.parse(value[key])))return null;
  state[key]=value[key];
 }
 if(value.challengeId!==null && (typeof value.challengeId!=='string' || !/^[a-f0-9-]{36}$/i.test(value.challengeId) || !/^[A-Za-z0-9_-]{43}$/.test(value.context || '')))return null;
 state.challengeId=value.challengeId;state.context=value.context;
 if(value.delivery!==null && !['pending','accepted','rejected','unknown'].includes(value.delivery))return null;
 state.delivery=value.delivery;return state;
}
// Display estimate only. No client timer is supplied to the auth API.
export function mfaRemaining(state,field,receivedAt,monotonicNow){
 if(!state?.[field])return 0;
 const elapsed=Math.max(0,monotonicNow-receivedAt);
 return Math.max(0,Math.ceil((Date.parse(state[field])-Date.parse(state.serverNow)-elapsed)/1000));
}
export const mfaTime=value=>`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
