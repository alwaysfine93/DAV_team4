// Vercel 서버에서만 실행됩니다. 비밀값은 환경변수에 넣으세요.
const ACTIONS = new Set(['list','create','update','delete']);
function reply(res,status,body) { return res.status(status).json(body); }
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','POST'].includes(req.method)) {
    res.setHeader('Allow','GET, POST');
    return reply(res,405,{ok:false,code:'METHOD_NOT_ALLOWED',message:'GET 또는 POST를 사용하세요.'});
  }
  const endpoint=process.env.FAMILY_SCRIPT_URL?.trim();
  const secret=process.env.FAMILY_API_SECRET?.trim();
  if (!endpoint || !secret) return reply(res,503,{ok:false,configured:false,connected:false,code:'ENV_MISSING',message:'FAMILY_SCRIPT_URL과 FAMILY_API_SECRET을 설정한 뒤 재배포하세요.'});
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) return reply(res,503,{ok:false,configured:true,connected:false,code:'BAD_SCRIPT_URL',message:'Apps Script 웹앱의 /exec 주소를 확인하세요.'});
  let payload={action:'health'};
  if(req.method==='POST') {
    let body=req.body;
    try {
      if (Buffer.isBuffer(body)) body=body.toString('utf8');
      if(typeof body==='string') body=JSON.parse(body);
      if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error();
      if(Buffer.byteLength(JSON.stringify(body),'utf8')>16000) return reply(res,413,{ok:false,code:'TOO_LARGE',message:'요청 내용이 너무 큽니다.'});
    } catch { return reply(res,400,{ok:false,code:'BAD_JSON',message:'JSON 요청 본문을 확인하세요.'}); }
    if(!ACTIONS.has(body.action)) return reply(res,400,{ok:false,code:'BAD_ACTION',message:'지원하지 않는 작업입니다.'});
    // 브라우저가 서버의 secret이나 API 목적지를 덮어쓸 수 없습니다.
    payload={action:body.action,id:body.id,version:body.version,event:body.event,from:body.from,to:body.to};
  }
  try {
    const upstream=await fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload,secret}),
      redirect:'follow',signal:AbortSignal.timeout(25000)
    });
    const raw=await upstream.text();
    let data;
    try { data=JSON.parse(raw); } catch { return reply(res,502,{ok:false,configured:true,connected:false,code:'SCRIPT_NOT_JSON',message:'Apps Script 웹앱 배포의 실행 사용자·접근 권한과 /exec 주소를 확인하세요.'}); }
    if(!data || typeof data.ok!=='boolean') return reply(res,502,{ok:false,code:'BAD_UPSTREAM',message:'Apps Script 응답 형식이 맞지 않습니다.'});
    if (data.code==='INVALID_FAMILY_CODE' || (data.ok && ((req.method==='GET' && data.mode!=='shared') || (payload.action==='list' && data.mode!=='shared')))) return reply(res,503,{ok:false,configured:true,connected:false,code:'SCRIPT_UPDATE_REQUIRED',message:'Apps Script에 공용 일정표용 Code.gs를 넣고 기존 웹앱 배포를 새 버전으로 업데이트하세요.'});
    if(!upstream.ok || !data.ok) {
      const status=[400,401,404,409,413,500,503].includes(data.status)?data.status:502;
      return reply(res,status,{ok:false,configured:true,connected:false,code:data.code || 'UPSTREAM_ERROR',message:data.message || 'Apps Script 연결에 실패했습니다.'});
    }
    if(req.method==='GET') return reply(res,200,{ok:true,configured:true,connected:data.connected===true,mode:'shared',service:'team4-shared-schedules'});
    return reply(res,200,data);
  } catch(err) {
    const timeout=err.name==='TimeoutError' || err.name==='AbortError';
    return reply(res,timeout?504:502,{ok:false,configured:true,connected:false,code:timeout?'TIMEOUT':'CONNECT_FAILED',message:timeout?'응답이 지연되고 있습니다. 목록을 새로 확인하고, 추가 요청을 재시도할 때는 같은 일정 ID를 사용하세요.':'Apps Script 서버 연결에 실패했습니다.'});
  }
}
