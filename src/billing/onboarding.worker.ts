import {getSupabaseClient} from '../config/supabase.js';
import {failure,info} from '../observability/logger.js';
import {retrieveCheckoutSession} from './stripe.js';
import {sendCheckoutOnboardingEmail} from './onboarding-email.js';

interface OnboardingInvite {checkout_session_id:string;email:string;attempts:number}

export async function processOnboardingInvite():Promise<boolean>{
 const db=getSupabaseClient();const claimed=await db.rpc('claim_checkout_onboarding_invite');if(claimed.error)throw claimed.error;
 const invite=(claimed.data as OnboardingInvite[]|null)?.[0];if(!invite)return false;
 const started=Date.now();info('stripe.onboarding_email.started',{checkout_session_id:invite.checkout_session_id,attempt:invite.attempts});
 try{
  const checkout=await retrieveCheckoutSession(invite.checkout_session_id);
  const checkoutEmail=checkout.customer_details?.email??'';
  if(checkout.status!=='complete'||!['paid','no_payment_required'].includes(checkout.payment_status??'')||checkout.id!==invite.checkout_session_id||checkoutEmail.toLowerCase()!==invite.email.toLowerCase())throw new Error('STRIPE_ONBOARDING_SESSION_MISMATCH');
  await sendCheckoutOnboardingEmail(checkout as unknown as Record<string,unknown>);
  const completed=await db.rpc('finish_checkout_onboarding_invite',{p_session_id:invite.checkout_session_id,p_success:true,p_error:null});if(completed.error)throw completed.error;
  info('stripe.onboarding_email.completed',{checkout_session_id:invite.checkout_session_id,duration_ms:Date.now()-started});return true;
 }catch(error){
  failure('stripe.onboarding_email.failed',error,{checkout_session_id:invite.checkout_session_id,attempt:invite.attempts,duration_ms:Date.now()-started});
  const failed=await db.rpc('finish_checkout_onboarding_invite',{p_session_id:invite.checkout_session_id,p_success:false,p_error:error instanceof Error?error.message:'ONBOARDING_EMAIL_FAILED'});if(failed.error)throw failed.error;
  return true;
 }
}
