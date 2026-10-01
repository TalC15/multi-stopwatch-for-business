import test from 'node:test';
import assert from 'node:assert/strict';
import { sortTimers, TIMER_SORT, normalizeTimerSort } from './timerSort.js';
const up = (id, remaining, extra = {}) => ({ id, type:'up', status:'running', targetMinutes:10, elapsed:600000-remaining, ...extra });
const down = (id, remaining, extra = {}) => ({ id, type:'down', status:'running', targetMinutes:10, remaining, ...extra });
const ids = items => items.map(t => t?.id);

test('nearest shows finished, closest and farthest; reverse shows farthest, closest and finished', () => {
  const source = [up('far',500000), down('done',0,{status:'expired'}), down('near',2000),up('mid',60000)];
  assert.deepEqual(ids(sortTimers(source)), ['done','near','mid','far']);
  assert.deepEqual(ids(sortTimers(source,TIMER_SORT.FARTHEST)), ['far','mid','near','done']);
});
test('target-reached count-ups and countdowns awaiting server completion are treated as finished views only', () => {
  const source=[up('target',0,{reachedTarget:true}),down('waiting',0),up('overdue',-5000),down('active',1000)];
  const original=structuredClone(source);
  assert.deepEqual(ids(sortTimers(source)),['overdue','target','waiting','active']);
  assert.deepEqual(source,original);
});
test('paused and idle timers use remaining target duration, regardless of running status', () => {
  const source=[down('running',5000),down('paused',1000,{status:'paused'}),up('idle',600000,{status:'idle'})];
  assert.deepEqual(ids(sortTimers(source)),['paused','running','idle']);
  assert.deepEqual(ids(sortTimers(source,TIMER_SORT.FARTHEST)),['idle','running','paused']);
});
test('uses server-derived display values, not device timestamps, for shared timers', () => {
  const shared=up('shared',1000,{isShared:true,dataMode:'shared',startTime:9000000000000,accumulatedTime:0});
  assert.deepEqual(ids(sortTimers([up('local',2000,{startTime:-9000000000000}),shared])),['shared','local']);
});
test('equal remaining durations and completed records keep deterministic ID order across refreshes and directions', () => {
  const a=up('a',1000),z=down('z',1000),doneA=down('done-a',0),doneZ=down('done-z',0);
  assert.deepEqual(ids(sortTimers([z,doneZ,a,doneA])),['done-a','done-z','a','z']);
  assert.deepEqual(ids(sortTimers([doneA,a,doneZ,z])),['done-a','done-z','a','z']);
  assert.deepEqual(ids(sortTimers([z,doneZ,a,doneA],TIMER_SORT.FARTHEST)),['a','z','done-a','done-z']);
});
test('invalid numbers, unknown types/statuses and missing timing data always sort last without throwing', () => {
  const invalid=[down('bad-nan',NaN),down('bad-negative',-1),up('bad-infinity',1,{elapsed:Infinity}),
    down('bad-string','1'),up('bad-target',1000,{targetMinutes:0}),up('bad-status',1000,{status:'unknown'}),
    {id:'bad-missing',type:'up',status:'running',targetMinutes:1},up('bad-type',1000,{type:'x'}),
    up('bad-coercion',1000,{targetMinutes:{valueOf(){throw Error('must not coerce')}}}),null];
  const valid=[up('near',1000),down('done',0),down('far',5000)];
  for(const direction of [TIMER_SORT.NEAREST,TIMER_SORT.FARTHEST]) {
    const result=sortTimers([...invalid,...valid],direction);
    assert.deepEqual(ids(result.slice(0,3)),direction===TIMER_SORT.NEAREST?['done','near','far']:['far','near','done']);
    assert.equal(result.length,invalid.length+valid.length);
  }
});
test('missing remaining uses valid elapsed; only non-running records may fall back to accumulated time', () => {
  const paused={id:'paused',type:'up',status:'paused',targetMinutes:1,accumulatedTime:59000};
  const running={...paused,id:'invalid-running',status:'running'};
  const fallback=down('fallback',null,{targetMinutes:1,elapsed:58000});
  assert.deepEqual(ids(sortTimers([running,fallback,paused])),['paused','fallback','invalid-running']);
});
test('frozen source and records remain untouched and the same timer objects are returned', () => {
  const a=Object.freeze(up('a',1000)),b=Object.freeze(down('b',5000)),source=Object.freeze([b,a]);
  const result=sortTimers(source);
  assert.notEqual(result,source); assert.equal(result[0],a); assert.equal(result[1],b);
  assert.deepEqual(source,[b,a]);
});
test('advancing display values reuses the existing array while relative order stays correct', () => {
  const source=[down('later',5000),down('soon',1000)];
  const previous=sortTimers(source);
  source[0].remaining-=100;source[1].remaining-=100;
  assert.equal(sortTimers(source,TIMER_SORT.NEAREST,previous),previous);
});
test('running timer crossing a paused timer reorders; completed timers move to the correct end', () => {
  const running=down('running',6000),paused=down('paused',5000,{status:'paused'}),source=[running,paused];
  let view=sortTimers(source); assert.deepEqual(ids(view),['paused','running']);
  running.remaining=4000; view=sortTimers(source,TIMER_SORT.NEAREST,view); assert.deepEqual(ids(view),['running','paused']);
  running.remaining=0;
  assert.deepEqual(ids(sortTimers(source,TIMER_SORT.FARTHEST,view)),['paused','running']);
});
test('add/delete, same-length membership replacement and server object replacement never reuse stale cards', () => {
  const a=up('a',1000),b=up('b',2000),view=sortTimers([b,a]);
  const replacement={...a,isPay:true};
  let next=sortTimers([replacement,b],TIMER_SORT.NEAREST,view);
  assert.equal(next[0],replacement); assert.notEqual(next,view);
  const c=up('c',500);
  next=sortTimers([b,c],TIMER_SORT.NEAREST,next); assert.deepEqual(ids(next),['c','b']);
  next=sortTimers([b,c,a],TIMER_SORT.NEAREST,next); assert.deepEqual(ids(next),['c','a','b']);
  assert.deepEqual(sortTimers([],TIMER_SORT.NEAREST,next),[]);
});
test('duplicate or missing identities never drop entries and remain stable by source position', () => {
  const a=up('same',1000),b=up('same',1000),c=up(undefined,1000);
  const result=sortTimers([b,a,c]); assert.equal(result.length,3); assert.equal(result[1],b); assert.equal(result[2],a);
  assert.equal(sortTimers([a,a],TIMER_SORT.NEAREST,[a,a]).length,2);
});
test('only the two allowed directions are accepted', () => {
  assert.equal(normalizeTimerSort('farthest'),TIMER_SORT.FARTHEST);
  for(const value of ['__proto__','<script>',null,{},'descending']) assert.equal(normalizeTimerSort(value),TIMER_SORT.NEAREST);
});
