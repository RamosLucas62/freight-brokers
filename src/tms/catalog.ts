/** Provider capabilities are explicit: a setup request is never a live connector. */
export const tmsProviders = [
 {id:'rose-rocket',name:'Rose Rocket',mode:'credentials',helpUrl:'https://roserocket.readme.io/docs/rose-rocket-api-oauth-20-authentication-guide',instructions:'Open Settings → Developer Portal → Applications. Create an application and service account, then copy the JSON body from Request Details. API access may need to be enabled by Rose Rocket.'},
 {id:'tai',name:'Tai TMS',mode:'credentials',helpUrl:'https://docs.taicloud.net/docs/obtaining-an-api-key',instructions:'In Tai, open Back Office → LSP → Public Authentication Keys. Create a key for your integration staff member and paste it below. Find your site address under LSP → Onboarding Guide.'},
 {id:'mcleod',name:'McLeod PowerBroker / LoadMaster',mode:'assisted',helpUrl:'https://www.mcleodsoftware.com/solutions/integrations/',instructions:'Requires licensed McLeod web services, your company-specific service address and an integration token. Save a setup request; do not send passwords or tokens through support.'},
 {id:'turvo',name:'Turvo',mode:'assisted',helpUrl:'https://turvo.com/connect/',instructions:'Requires Turvo API access and an approved application. Save a setup request to coordinate the application and account permissions.'},
 {id:'aljex',name:'Descartes Aljex',mode:'assisted',helpUrl:'https://www.aljex.com/integrations/',instructions:'API / EDI access and the data exchange must be arranged for your Aljex account. Save a setup request to coordinate access.'},
 {id:'ascendtms',name:'AscendTMS',mode:'assisted',helpUrl:'https://www.thefreetms.com/about-us',instructions:'The connection needs to be arranged with the AscendTMS integration team. Save a setup request to coordinate the supported data exchange.'},
 {id:'mercurygate',name:'MercuryGate',mode:'assisted',helpUrl:'https://partners.mercurygate.com/',instructions:'Requires an account-specific integration agreement and data mapping. Save a setup request to coordinate access.'},
] as const;
export type TmsProviderId=typeof tmsProviders[number]['id'];
export const assistedProviderIds=tmsProviders.filter(provider=>provider.mode==='assisted').map(provider=>provider.id);
