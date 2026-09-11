import {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
export const AdminAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('company.create'),name:z.string().trim().min(1).max(200),alias:z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63)}),
 z.object({action:z.literal('company.update'),id:z.string().uuid(),name:z.string().trim().min(1).max(200),status:z.enum(['active','inactive','paused'])}),
 z.object({action:z.literal('user.create'),email:z.string().trim().email().max(254).toLowerCase(),company_id:z.string().uuid()}),
 z.object({action:z.literal('membership.add'),user_id:z.string().uuid(),company_id:z.string().uuid()}),
 z.object({action:z.literal('membership.remove'),user_id:z.string().uuid(),company_id:z.string().uuid()}),
 z.object({action:z.literal('user.enable'),user_id:z.string().uuid(),enabled:z.boolean()}),
 z.object({action:z.literal('user.role'),user_id:z.string().uuid(),role:z.enum(['admin','customer'])}),
 z.object({action:z.literal('confidence.review'),id:z.string().uuid(),result:z.enum(['confirmed','corrected']),corrected_fields:z.record(z.unknown()).default({})}),
]);
export async function adminAction(db:SupabaseClient,actor:string,input:unknown){
 const parsed=AdminAction.parse(input);let {action,...payload}=parsed;
 if(action==='confidence.review'){
  const review=parsed as Extract<z.infer<typeof AdminAction>,{action:'confidence.review'}>;
  const result=await db.rpc('portal_admin_review_confidence',{p_actor:actor,p_review:review.id,p_result:review.result,p_corrected_fields:review.corrected_fields});
  if(result.error)throw new Error('Unable to record this quality review. Refresh and try again.');
  return result.data;
 }
 if(action==='user.create'){
 const registration=parsed as Extract<z.infer<typeof AdminAction>,{action:'user.create'}>;
 // Validate company before creating an Auth identity. No email is sent here.
 const company=await db.from('audit_tenants').select('id').eq('id',registration.company_id).maybeSingle();
 if(company.error||!company.data)throw new Error('Company not found.');
 let lookup=await db.rpc('portal_admin_find_user',{p_actor:actor,p_email:registration.email});
 if(lookup.error)throw new Error('Unable to verify user.');
 let userId=lookup.data as string|null;
 if(!userId){
 const created=await db.auth.admin.createUser({email:registration.email,email_confirm:false});
 if(created.error){
 // A simultaneous registration may already have created the same identity.
 lookup=await db.rpc('portal_admin_find_user',{p_actor:actor,p_email:registration.email});
 if(lookup.error||!lookup.data)throw new Error('Unable to create user. Please try again.');
 userId=lookup.data;
 }else userId=created.data.user.id;
 }
 const result=await db.rpc('portal_admin_action',{p_actor:actor,p_action:'user.register',p_payload:{user_id:userId,company_id:registration.company_id}});
 if(result.error)throw new Error('User access could not be assigned. Retry with the same email to complete registration.');
 return result.data;
 }
 const result=await db.rpc('portal_admin_action',{p_actor:actor,p_action:action,p_payload:payload});
 if(result.error)throw new Error('Unable to save. Check the details and refresh. You cannot disable yourself or remove your own admin role.');
 return result.data;
}
