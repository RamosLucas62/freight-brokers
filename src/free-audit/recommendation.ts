export type RecommendedPlan='core'|'growth'|'scale';

export function recommendedPlan(loads:string|null|undefined):RecommendedPlan{
 const label=String(loads??'').trim().toLowerCase();
 const values=label.match(/\d[\d,]*/g)?.map(value=>Number(value.replaceAll(',',''))).filter(Number.isFinite)??[];
 const volume=values.length?Math.max(...values):0;
 const openEnded=/(?:\bover\b|\babove\b|more\s+than|\+)/.test(label);
 return volume>1500||(openEnded&&volume>=1500)?'scale':volume>500?'growth':'core';
}
