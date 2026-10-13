// Imported before router/main startup. Only the intended route can consume the
// token once; never persist it or echo it to DOM, telemetry or other URLs.
let link=null;
export function captureAuthLink(location,history) {
 const purpose=location.pathname==='/account/activate'?'activation':location.pathname==='/account/reset'?'reset':null;
 if(!purpose) return null;
 const raw=location.hash;
 if(raw || location.search) history.replaceState(history.state,'',location.pathname); // clear even malformed links
 const values=new URLSearchParams(raw.slice(1));
 if([...values.keys()].length!==2 || values.getAll('id').length!==1 || values.getAll('token').length!==1 ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.get('id') || '') ||
  !/^[A-Za-z0-9_-]{43}$/.test(values.get('token') || '')) return null;
 return {purpose,challengeId:values.get('id').toLowerCase(),context:values.get('token')};
}
if(typeof window!=='undefined') link=captureAuthLink(window.location,window.history);
export function takeAuthLink(purpose) {const value=link;link=null;return value?.purpose===purpose?value:null;}
