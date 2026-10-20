import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTwilioResponse,
  mergeTwilioStatus,
  shouldRetryTwilioResponse
} from "../supabase/functions/_shared/sms-policy.mjs";

const sid="SM"+"a".repeat(32);

test("retries only the first explicit Twilio rate-limit rejection",()=>{
  assert.equal(shouldRetryTwilioResponse(429,20429,1),true);
  assert.equal(shouldRetryTwilioResponse(429,20429,2),false);
  assert.equal(shouldRetryTwilioResponse(429,21610,1),false);
  assert.equal(shouldRetryTwilioResponse(500,20429,1),false);
});

test("classifies accepted responses only when Twilio provides a message SID",()=>{
  assert.deepEqual(classifyTwilioResponse({ok:true,httpStatus:201,messageSid:sid}),
    {status:"provider_accepted",messageSid:sid});
  assert.deepEqual(classifyTwilioResponse({ok:true,httpStatus:201,messageSid:""}),
    {status:"unknown",messageSid:null});
});

test("does not retry ambiguous server errors",()=>{
  assert.deepEqual(classifyTwilioResponse({ok:false,httpStatus:503,providerCode:0}),
    {status:"unknown",messageSid:null});
  assert.equal(shouldRetryTwilioResponse(503,0,1),false);
});

test("classifies a definite client rejection without claiming delivery",()=>{
  assert.deepEqual(classifyTwilioResponse({ok:false,httpStatus:400,providerCode:21610}),
    {status:"provider_rejected",messageSid:null});
});

test("status callbacks are monotonic and duplicates are idempotent",()=>{
  assert.equal(mergeTwilioStatus("queued","sent"),"sent");
  assert.equal(mergeTwilioStatus("sent","delivered"),"delivered");
  assert.equal(mergeTwilioStatus("delivered","sent"),"delivered");
  assert.equal(mergeTwilioStatus("failed","delivered"),"delivered");
  assert.throws(()=>mergeTwilioStatus("sent","pending"),/Unsupported/);
});
