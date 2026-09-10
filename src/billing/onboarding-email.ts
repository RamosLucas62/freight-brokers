import {createHash} from 'node:crypto';
import {plans,planFromMetadata} from './plans.js';
import {sendSecurityEmail} from '../notifications/security.sender.js';
import {info} from '../observability/logger.js';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const value=(input:unknown)=>typeof input==='string'?input:'';

export async function sendCheckoutOnboardingEmail(object:Record<string,unknown>,portalUrl=process.env.PORTAL_URL):Promise<void>{
 const sessionId=value(object.id);const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
 const details=typeof object.customer_details==='object'&&object.customer_details?object.customer_details as Record<string,unknown>:{};
 const email=value(details.email)||value(object.customer_email);const plan=plans[planFromMetadata(metadata.plan_code)].name;
 if(!sessionId.startsWith('cs_')||!email||!portalUrl)throw new Error('STRIPE_ONBOARDING_EMAIL_INVALID');
 const onboardingUrl=new URL('/onboarding',portalUrl);onboardingUrl.searchParams.set('session_id',sessionId);
 const trial=object.payment_status==='no_payment_required';
 const subscriptionCopy=trial
  ?`Your 7-day free trial of Olympian ${escapeHtml(plan)} has started.`
  :`Your Olympian ${escapeHtml(plan)} subscription has been confirmed.`;
 const button='display:inline-block;background:#ef5427;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border:2px solid #11110f;border-radius:7px;box-shadow:4px 4px 0 #11110f';
 await sendSecurityEmail({
  to:email,subject:'Welcome to Olympian — set up your account',idempotencyKey:`checkout-onboarding-${createHash('sha256').update(sessionId).digest('hex').slice(0,40)}`,
  html:`<div style="background:#f7f7f0;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#11110f"><div style="max-width:600px;margin:0 auto;background:#fff;border:2px solid #11110f;border-radius:12px;padding:32px;box-shadow:7px 8px 0 #11110f"><p style="margin:0 0 24px;font-size:20px"><span style="color:#ef5427">●</span> Olympian</p><h1 style="font-size:36px;line-height:1.05;letter-spacing:-1.5px;margin:0 0 18px">Welcome to Olympian</h1><p style="font-size:17px;line-height:1.55;margin:0 0 12px">${subscriptionCopy}</p><p style="font-size:17px;line-height:1.55;margin:0 0 26px">Click the button below to configure your company, report recipients and private invoice intake address.</p><p style="margin:0 0 28px"><a href="${escapeHtml(onboardingUrl.href)}" style="${button}">Set up your account</a></p><p style="font-size:13px;line-height:1.5;color:#66665f;margin:0">This link is connected to the email used at checkout: ${escapeHtml(email)}. If you did not start this subscription, contact Olympian support.</p></div></div>`,
 });
 info('stripe.onboarding_email.sent',{checkout_session_id:sessionId,plan:plan.toLowerCase(),trial});
}
