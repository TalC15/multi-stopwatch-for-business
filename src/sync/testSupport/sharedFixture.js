// Protocol adapter for the existing Phase 4 regression scenarios. Their IO gates
// remain injectable, but now produce canonical v5 responses instead of legacy ACKs.
export function sharedFixture({ backend, auth, now, serverTimer }) {
  let generation=0;
  const known=new Map();
  const row = source => ({...source,shared_revision:String(source.shared_revision ?? '0'),is_pay:Boolean(source.is_pay)});
  const frame=(fields,g=generation)=>({protocol:5,success:true,workspaceId:auth.state.user?.workspace_id,
    generation:String(g),serverNow:new Date(now()).toISOString(),...fields});
  return {
    api: {
      async snapshot() {
        const g=generation; const rows=await backend.dbGetSharedTimers();
        if (!Array.isArray(rows)) throw new Error('unavailable');
        const timers=rows.map(source=>{
          const copy=row(source); known.set(copy.id,copy); return copy;
        });
        return frame({complete:true,timers},g);
      },
      async command(body) {
        const old=known.get(body.timerId) ?? serverTimer({id:body.timerId,is_shared:true});
        let next={...old}; let result;
        if(body.command==='create') {
          result=await backend.dbCreateTimer({id:body.timerId,name:body.name,type:body.type,targetMinutes:body.targetMinutes});
          next=result?.timer;
        } else if(body.command==='delete') {
          result=await backend.dbDeleteTimer(body.timerId); next.record_status='deleted';
        } else {
          const update=body.command==='set-pay'?{is_pay:body.value}:body.command==='start'?
            {status:'running',ends_at:new Date(now()+old.target_minutes*60000-old.accumulated_ms).toISOString()}:
            {status:'paused',ends_at:null,accumulated_ms:Math.max(0,old.target_minutes*60000-(Date.parse(old.ends_at)-now())),paused_count:(old.paused_count??0)+1};
          result=await backend.dbUpdateTimer(body.timerId,update); Object.assign(next,update);
        }
        if(!result?.success) throw new Error('rejected');
        generation++;
        next=row({...next,shared_revision:String(BigInt(old.shared_revision??'0')+1n)});known.set(next.id,next);
        return frame({timer:next,mutationId:body.mutationId});
      },
    },
    event(callback,payload) {
      const data=payload.data;
      if(data?.protocol===5) return callback(payload);
      const old=known.get(data?.id);
      if(payload.event==='created') { generation++; return callback(payload); }
      if(!old) return callback(payload);
      const next={...old,shared_revision:String(BigInt(old.shared_revision)+1n)};
      if(payload.event==='deleted') next.record_status='deleted';
      else {
        if(data.status) next.status=data.status==='expired'?'completed':data.status;
        if(data.endsAt) next.ends_at=data.endsAt;
        if(data.isPay!==undefined) next.is_pay=data.isPay;
      }
      generation++; known.set(next.id,next);
      return callback({event:payload.event,data:frame({timer:next})});
    },
  };
}
