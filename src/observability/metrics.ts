import {timingSafeEqual} from 'node:crypto';

const counters=new Map<string,number>();
export function increment(name:string):void{counters.set(name,(counters.get(name)??0)+1);}
export function metricsAuthorized(header:string|undefined):boolean{
 const expected=process.env.METRICS_TOKEN;if(!expected||!header?.startsWith('Bearer '))return false;
 const actual=header.slice(7);const a=Buffer.from(actual);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function renderMetrics():string{
 return [...counters].sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>`freight_audit_${name.replace(/[^a-z0-9_]/gi,'_').toLowerCase()} ${value}`).join('\n')+'\n';
}
