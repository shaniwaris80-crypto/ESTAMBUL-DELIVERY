export const twilioMessageStatuses=new Set(["queued","sending","sent","delivered","undelivered","failed"]);

export function shouldRetryTwilioResponse(httpStatus,providerCode,attempt){
  return httpStatus===429&&Number(providerCode)===20429&&attempt===1;
}

export function classifyTwilioResponse({ok,httpStatus,providerCode,messageSid}){
  if(ok&&typeof messageSid==="string"&&/^SM[0-9a-fA-F]{32}$/.test(messageSid))
    return {status:"provider_accepted",messageSid};
  if(ok)return {status:"unknown",messageSid:null};
  if(httpStatus>=500)return {status:"unknown",messageSid:null};
  return {status:"provider_rejected",messageSid:null};
}

export function mergeTwilioStatus(current,incoming){
  if(!twilioMessageStatuses.has(incoming))throw new TypeError("Unsupported Twilio status");
  if(!twilioMessageStatuses.has(current))return incoming;
  const rank={queued:1,sending:2,sent:3,undelivered:4,failed:4,delivered:5};
  return rank[incoming]>=rank[current]?incoming:current;
}
