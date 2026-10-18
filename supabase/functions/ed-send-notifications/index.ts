/* Legacy status message dispatcher: intentionally disabled.
 * Customer receives one private tracking link upon Rider acceptance.
 * Every later update is visible on that page. Do not message at every status.
 * No Twilio call, queue claim, cron send, or database mutation can occur here.
 * Keep this endpoint compatible with existing Rider clients while upgrading.
 */
const allowedOrigin="https://shaniwaris80-crypto.github.io";
const headers={
 "Content-Type":"application/json","Cache-Control":"no-store",
 "Access-Control-Allow-Origin":allowedOrigin,
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Access-Control-Allow-Methods":"POST,OPTIONS"
};
Deno.serve((req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers});
 const origin=req.headers.get("origin");
 if(origin&&origin!==allowedOrigin)return new Response(JSON.stringify({error:"Origin not allowed"}),{status:403,headers});
 return new Response(JSON.stringify({
  enabled:false,claimed:0,accepted:0,failed:0,
  reason:"Single tracking link only. Status changes are updated on the private customer tracking page."
 }),{status:200,headers});
});