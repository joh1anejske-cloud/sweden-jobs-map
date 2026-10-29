'use strict';
/**
 * Escapade -- Vercel serverless endpoint for actual hotel-rate lookups.
 * This endpoint requires LITEAPI_KEY in Vercel environment variables.
 * Never return provider credentials or raw supplier offers to the browser.
 * Flight prices and packages are explicitly NOT verified by this adapter.
 */
const crypto = require('node:crypto');
const BOARD = Object.freeze({all:['AI','TI','AI1','AI2','AI3'],half:['HB','HB1','HB2','HB3'],full:['FB','FB1','FB2','FB3'],breakfast:['BB','BB1','BB2','BB3','BI'],none:['RO']});
const allowedOrigin = (origin) =>
  /^https:\/\/joh1anejske-cloud\.github\.io$/.test(origin||'') ||
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin||'') ||
  (process.env.ESCAPADE_SITE_ORIGIN && origin===process.env.ESCAPADE_SITE_ORIGIN);
const isDate = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z'));
const finite = (v) => typeof v==='number' && Number.isFinite(v);
const money = v => v&&finite(v.amount)&&String(v.currency||'').toUpperCase()==='EUR'?v.amount:null;
function totalFromOffer(offer,rate) {
  const ssp=offer.suggestedSellingPrice;
  const retail=offer.offerRetailRate;
  const ratePublic=rate.retailRate?.suggestedSellingPrice?.[0];
  const retailRate=rate.retailRate?.total?.[0];
  // Nuitee's documentation says a public display must use the supplier's
  // Suggested Selling Price when provided. Do not expose a potentially
  // private wholesale price as if it were a public booking offer.
  const base=money(ssp)||money(ratePublic);
  if(base===null||base<=0)return null;
  let extras=0;
  for(const tax of (rate.retailRate?.taxesAndFees||[])){
    if(tax?.included===false){
      const v=money(tax);
      if(v===null)return null; // never claim a strict max budget with unknown unavoidable fees
      extras+=v;
    }
  }
  return Number((base+extras).toFixed(2));
}
function normalizeRecord(entry,adults,board,minStars,maxPerPerson,flightRequired){
  const info=entry.hotelData||entry.hotel||entry.property||entry;
  const name=info.name||info.hotelName||entry.hotelName||'';
  const latitude=Number(info.latitude??info.location?.latitude??info.location?.lat);
  const longitude=Number(info.longitude??info.location?.longitude??info.location?.lon);
  const starsRaw=Number(info.starRating??info.stars);
  const stars=Number.isFinite(starsRaw)&&starsRaw>=1&&starsRaw<=5?starsRaw:null;
  if(minStars&&(stars===null||stars<minStars))return null;
  if(!name||typeof name!=='string')return null;
  let best=null;
  for(const offer of entry.roomTypes||[]){
    // Only public standard offers. 'package' might be gated for closed-user groups.
    if(offer.rateType==='package')continue;
    const rates=offer.rates||[];
    if(rates.length!==1)continue; // single occupancy search; avoid incorrect aggregate totals
    const rate=rates[0];
    if(Number(rate.adultCount)!==adults)continue;
    const boardCode=String(rate.boardType||'').toUpperCase();
    if(board!=='any'&&!BOARD[board]?.includes(boardCode))continue;
    const price=totalFromOffer(offer,rate);
    if(price===null)continue;
    const per=price/adults;
    // When flights are required, this is not a complete package price.
    // Keep hotel quotes for comparison, but do not mark budget as met.
    if(maxPerPerson&&per>maxPerPerson)continue; // cannot be a qualifying package even with free flights
    if(best===null||price<best.total)best={total:price,pp:Number(per.toFixed(2)),boardCode,boardName:rate.boardName||'',room:rate.name||'',refundability:rate.cancellationPolicies?.refundableTag||'',taxesIncluded:'provider-rate-with-identified-fees'};
  }
  if(!best)return null;
  let url='';
  try{
    const str=info.website||info.url||'';
    const parsed=new URL(str);
    if(['http:','https:'].includes(parsed.protocol))url=parsed.toString();
  }catch(_){}
  return {
   id:String(entry.hotelId||entry.id||''),name:name.slice(0,160),stars,
   lat:Number.isFinite(latitude)&&Math.abs(latitude)<=90?latitude:null,
   lon:Number.isFinite(longitude)&&Math.abs(longitude)<=180?longitude:null,
   officialSite:url,offer:best,flightIncluded:false,completePackage:false,
   budgetVerified:!flightRequired&&(!maxPerPerson||best.pp<=maxPerPerson),
   source:'Nuitee / LiteAPI',currency:'EUR'
  };
}
async function getRates(payload,key){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),14000);
  try{
    const response=await fetch('https://api.liteapi.travel/v3.0/hotels/rates',{
      method:'POST',headers:{'x-api-key':key,'accept':'application/json','content-type':'application/json'},
      body:JSON.stringify(payload),signal:controller.signal
    });
    if(response.status===204)return [];
    if(!response.ok)throw Error('Fournisseur indisponible (HTTP '+response.status+').');
    const data=await response.json();
    if(data.sandbox===true)throw Error('Tarifs de démonstration refusés : environnement sandbox détecté.');
    return Array.isArray(data.data)?data.data:[];
  }finally{clearTimeout(timeout);}
}
async function handler(req,res){
  const origin=req.headers?.origin||'';
  if(origin&&allowedOrigin(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='OPTIONS'){
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Escapade-Access');
    return res.status(204).end();
  }
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  if(origin&&!allowedOrigin(origin))return res.status(403).json({error:'ORIGIN_DENIED'});
  // Protect a potentially billable supplier quota. Browser origin alone is not authentication.
  const requiredPin=process.env.ESCAPADE_ACCESS_PIN||'';
  if(!requiredPin||requiredPin.length<12)return res.status(503).json({error:'ACCESS_NOT_CONFIGURED',message:'Un code d’accès privé de 12 caractères minimum doit être configuré sur le serveur.'});
  const givenPin=String(req.headers?.['x-escapade-access']||'');
  const a=crypto.createHash('sha256').update(givenPin).digest();
  const b=crypto.createHash('sha256').update(requiredPin).digest();
  if(!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'ACCESS_DENIED',message:'Code d’accès aux tarifs manquant ou incorrect.'});
  if(!process.env.LITEAPI_KEY)return res.status(503).json({error:'PROVIDER_NOT_CONFIGURED',message:'Clé LiteAPI de production manquante sur le serveur.'});
  if(process.env.LITEAPI_PRODUCTION!=='true')return res.status(503).json({error:'PRODUCTION_NOT_ENABLED',message:'Environnement de production non activé. Aucun tarif sandbox ne sera présenté comme réel.'});
  let input;
  try{input=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body||{};}
  catch(_){return res.status(400).json({error:'INVALID_JSON'});}
  const checkin=input.checkin,checkout=input.checkout,adults=Number(input.adults),board=String(input.board||'any');
  const minStars=Number(input.minStars||0),budget=Number(input.budget||0),flight=Boolean(input.flight);
  const locations=Array.isArray(input.locations)?input.locations:[];
  if(!isDate(checkin)||!isDate(checkout)||checkout<=checkin||Date.parse(checkin+'T00:00:00Z')<=Date.now()-86400000||!Number.isInteger(adults)||adults<1||adults>8||
      !(board==='any'||BOARD[board])||!Number.isFinite(budget)||budget<0||budget>250000||![0,3,4,5].includes(minStars)||
      locations.length<1||locations.length>4)
   return res.status(400).json({error:'INVALID_SEARCH'});
  for(const loc of locations){
    if(!finite(loc.lat)||!finite(loc.lon)||Math.abs(loc.lat)>90||Math.abs(loc.lon)>180||typeof loc.name!=='string'||loc.name.length>120)
       return res.status(400).json({error:'INVALID_LOCATION'});
  }
  const all=[],failures=[];
  for(const loc of locations){
    const payload={
      checkin,checkout,currency:'EUR',guestNationality:'FR',
      occupancies:[{adults}],latitude:loc.lat,longitude:loc.lon,radius:Math.min(35000,Math.max(3000,Number(input.radius)||12000)),
      limit:20,timeout:9,maxRatesPerHotel:12,includeHotelData:true
    };
    if(board!=='any')payload.boardType=BOARD[board].join(',');
    if(minStars)payload.starRating=[3,3.5,4,4.5,5].filter(s=>s>=minStars);
    try{
      const entries=await getRates(payload,process.env.LITEAPI_KEY);
      for(const hotel of entries){
        const item=normalizeRecord(hotel,adults,board,minStars,budget,flight);
        if(item){item.region=loc.name.slice(0,100);all.push(item);}
      }
    }catch(e){failures.push(loc.name+': '+e.message);}
  }
  const dedup=new Map();
  for(const hotel of all){
    const k=hotel.id||hotel.name+'|'+hotel.region;
    if(!dedup.has(k)||hotel.offer.total<dedup.get(k).offer.total)dedup.set(k,hotel);
  }
  const offers=[...dedup.values()].sort((a,b)=>a.offer.pp-b.offer.pp).slice(0,100);
  return res.status(200).json({
     provider:'Nuitee / LiteAPI',checkedAt:new Date().toISOString(),environment:'production',
     priceScope:'hotel_only',flightIncluded:false,completePackage:false,
     pricingNote:'Prix hôtels affichés uniquement ; vol, transports et éventuels frais inconnus non inclus. Un tarif doit être revalidé avant réservation.',
     offers,regionsChecked:locations.length,failures
  });
}
module.exports=handler;
module.exports._test={normalizeRecord,totalFromOffer,BOARD};
