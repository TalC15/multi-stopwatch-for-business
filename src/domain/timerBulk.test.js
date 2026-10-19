import test from 'node:test';
import assert from 'node:assert/strict';
import {timerBulkState} from './timerBulk.js';
const row=(id,status='idle',type='up',isShared=false,extra={})=>({id,status,type,isShared,...extra});
test('bulk state chooses selected personal/shared section and reacts to manual state',()=>{
 const rows=[row('up','running'),row('paused','paused'),row('down','running','down'),row('shared','running','up',true)];
 assert.deepEqual(timerBulkState(rows,'up').ids,['up']);
 assert.deepEqual(timerBulkState(rows,'down').ids,['down']);
 assert.deepEqual(timerBulkState(rows,'shared').ids,['shared']);
 rows[0].status='paused';assert.deepEqual(timerBulkState(rows,'up').ids,['up','paused']);
 assert.equal(timerBulkState(rows,'up').action,'start');rows[1].status='running';assert.equal(timerBulkState(rows,'up').label,'Tümünü duraklat');
});
for(const extra of [{status:'completed'},{status:'expired'},{status:'deleted'},{status:'archived'},{syncDeleted:true},{archivedAt:'date'},{archived_at:'date'},{record_status:'deleted'},{recordStatus:'archived'}])test('bulk excludes terminal '+JSON.stringify(extra),()=>{
 assert.deepEqual(timerBulkState([row('x','paused','up',false,extra)],'up').ids,[]);
});
test('bulk empty/read-only/unknown tab are disabled without inventing a toggle',()=>{
 assert.deepEqual(timerBulkState([],'up').ids,[]);assert.deepEqual(timerBulkState([row('x')],'up',false).ids,[]);assert.deepEqual(timerBulkState([row('x')],'other').ids,[]);
});
