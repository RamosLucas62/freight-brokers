/** Only implemented connectors are offered as connectable. */
export const tmsProviders = [
 {id:'rose-rocket',name:'Rose Rocket',mode:'credentials',helpUrl:'https://roserocket.readme.io/docs/rose-rocket-api-oauth-20-authentication-guide',instructions:'Open Settings → Developer Portal → Applications. Create an application and service account, then copy the JSON body from Request Details. API access may need to be enabled by Rose Rocket.'},
 {id:'tai',name:'Tai TMS',mode:'credentials',helpUrl:'https://docs.taicloud.net/docs/obtaining-an-api-key',instructions:'In Tai, open Back Office → LSP → Public Authentication Keys. Create a key for your integration staff member and paste it below. Find your site address under LSP → Onboarding Guide.'},
 {id:'mcleod',name:'McLeod PowerBroker / LoadMaster',mode:'credentials',helpUrl:'https://www.mcleodsoftware.com/solutions/integrations/',instructions:'Enter your McLeod-hosted service hostname, company ID and integration token. Delivered orders are checked automatically for new documents. Licensed web services and imaging access are required.'},
 {id:'turvo',name:'Turvo',mode:'unavailable',helpUrl:'https://turvo.com/connect/',instructions:'Requires Turvo API access and an approved application. The connector is not yet available.'},
 {id:'aljex',name:'Descartes Aljex',mode:'unavailable',helpUrl:'https://www.aljex.com/integrations/',instructions:'API / EDI access and the data exchange must be arranged for your Aljex account. The connector is not yet available.'},
 {id:'ascendtms',name:'AscendTMS',mode:'unavailable',helpUrl:'https://www.thefreetms.com/about-us',instructions:'The connection needs to be arranged with the AscendTMS integration team. The connector is not yet available.'},
 {id:'mercurygate',name:'MercuryGate',mode:'unavailable',helpUrl:'https://partners.mercurygate.com/',instructions:'Requires an account-specific integration agreement and data mapping. The connector is not yet available.'},
] as const;
export type TmsProviderId=typeof tmsProviders[number]['id'];
