(() => {
"use strict";
const $=id=>document.getElementById(id);
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const eurl=(url)=>{try{const p=new URL(url);return ["https:","http:"].includes(p.protocol)?p.href:"";}catch(_){return "";}};
const PRICE_ENDPOINT=window.ESCAPADE_PRICING_ENDPOINT||
  (location.hostname.endsWith(".vercel.app")?location.origin+"/api/offers":"");
const money=n=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(n));
const f=()=>({
 checkin:$("checkin").value,checkout:$("checkout").value,adults:Number($("adults").value)||2,
 budget:Number($("budget").value)||0,minStars:Number($("stars").value)||0,board:$("board").value,
 country:$("country").value,flight:$("flight").checked,radius:Number($("radius").value)||12000,
 airport:$("airport").value,destination:$("destination").value.trim()
});
const HUBS=(window.ESCAPADE_HUBS||[]).map(([name,country,lat,lon])=>({name,country,lat,lon}));
const WORLD=["Palma de Majorque","Agadir","Phuket","Rio de Janeiro"].map(name=>HUBS.find(h=>h.name===name)).filter(Boolean);
const officialBooking=(place)=>{
 const filters=f();return "https://www.booking.com/searchresults.fr.html?"+
 new URLSearchParams({ss:place,checkin:filters.checkin,checkout:filters.checkout,group_adults:String(filters.adults),no_rooms:"1",selected_currency:"EUR"}).toString();
};
const officialAirbnb=place=>{
 const filters=f();return "https://www.airbnb.fr/s/"+encodeURIComponent(place)+"/homes?"+
 new URLSearchParams({checkin:filters.checkin,checkout:filters.checkout,adults:String(filters.adults)}).toString();
};
const travelSearch=place=>{
 const filters=f();
 const q=[place,"séjour vol hôtel",filters.airport||"Paris",filters.checkin,filters.checkout,
 filters.board==="all"?"all inclusive":"",filters.budget?"moins de "+filters.budget+" euros par personne":"",filters.adults+" adultes"].filter(Boolean).join(" ");
 return "https://www.google.com/search?q="+encodeURIComponent(q);
};
function external(){
 const filters=f(),label=$("country").selectedOptions[0]?.text||"Monde entier";
 const place=filters.destination|| (filters.country?label:"vacances monde entier");
 const links=[
  ["Booking · hôtels",officialBooking(place)],
  ["Airbnb · locations",officialAirbnb(place)],
  ["Vol + hôtel · recherches",travelSearch(place)]
 ];
 const root=$("externalSearches");
 root.replaceChildren();
 links.forEach(([name,url])=>{
  const a=document.createElement("a");a.textContent=name;a.href=url;a.target="_blank";a.rel="noopener noreferrer";root.appendChild(a);
 });
}
function status(message,detail,kind){
 const b=$("quoteBanner");b.classList.toggle("live",kind==="live");b.classList.toggle("error",kind==="error");
 $("quoteStatus").textContent=message;$("quoteSub").textContent=detail;
}
function makeTargets(){
 const filters=f();
 if(filters.destination&&window.ESCAPADE_BRIDGE?.getSearchCenter){
  const center=window.ESCAPADE_BRIDGE.getSearchCenter();
  if(center&&Number.isFinite(center.lat)&&Number.isFinite(center.lon))return [{name:filters.destination,lat:center.lat,lon:center.lon}];
 }
 if(filters.country)return HUBS.filter(h=>h.country===filters.country).slice(0,4);
 return WORLD;
}
async function geocode(destination){
 const r=await fetch("https://geocoding-api.open-meteo.com/v1/search?"+new URLSearchParams({name:destination,count:"1",language:"fr",format:"json"}));
 if(!r.ok)throw Error("Destination non localisée.");
 const j=await r.json();const p=j.results?.[0];
 if(!p||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))throw Error("Destination non trouvée.");
 return {name:destination,lat:p.latitude,lon:p.longitude};
}
function renderOffers(result){
 const root=$("quoteResults");root.replaceChildren();
 const offers=(result.offers||[]).filter(x=>Number.isFinite(x.offer?.pp)&&Number.isFinite(x.offer?.total));
 if(!offers.length){
  root.innerHTML='<div class="quote-placeholder"><strong>Aucun tarif hôtel compatible dans les zones interrogées.</strong> Cela ne signifie pas qu’aucune offre n’existe ailleurs dans le monde. Vérifiez les dates ou un autre pays.</div>';
  window.ESCAPADE_BRIDGE?.showQuotes?.([]);
  return;
 }
 const fragment=document.createDocumentFragment();
 for(const item of offers.slice(0,100)){
  const article=document.createElement("article");article.className="verified-card";
  const name=document.createElement("h4");name.textContent=item.name;article.appendChild(name);
  const meta=document.createElement("div");meta.className="meta";meta.textContent=(item.region||"")+" · "+(item.stars?item.stars+" étoiles":"étoiles non renseignées");article.appendChild(meta);
  const amount=document.createElement("div");amount.className="amount";amount.textContent=money(item.offer.pp)+" / personne";article.appendChild(amount);
  const detail=document.createElement("div");detail.className="details";
  detail.textContent="Hôtel : "+money(item.offer.total)+" au total pour "+f().adults+" adulte(s) · "+(item.offer.boardName||item.offer.boardCode||"repas non précisés")+".";
  article.appendChild(detail);
  const note=document.createElement("div");note.className="notpkg";
  note.textContent=f().flight?"Vol NON inclus : le budget total n'est pas vérifié.":"Prix fournisseur hôtel seul ; taxes externes identifiées incluses. Revalidation obligatoire avant achat.";
  article.appendChild(note);
  const link=document.createElement("a");link.className="extlink";
  link.href=eurl(item.officialSite)||officialBooking([item.name,item.region].filter(Boolean).join(", "));
  link.textContent=eurl(item.officialSite)?"Site de l’hôtel (tarif à vérifier) ↗":"Rechercher cet hôtel sur Booking (prix indépendant) ↗";
  link.target="_blank";link.rel="noopener noreferrer";article.appendChild(link);
  if(Number.isFinite(item.lat)&&Number.isFinite(item.lon)){
    const button=document.createElement("button");button.className="secondary";button.type="button";button.textContent="Voir sur la carte";
    button.style.marginLeft="9px";button.style.padding="7px";button.addEventListener("click",()=>window.ESCAPADE_BRIDGE?.focusQuote?.(item.lat,item.lon,item.name));
    article.appendChild(button);
  }
  fragment.appendChild(article);
 }
 root.appendChild(fragment);
 window.ESCAPADE_BRIDGE?.showQuotes?.(offers);
}
async function search(){
 external();
 const params=f(),button=$("quoteSearch");
 if(!params.checkin||!params.checkout||params.checkout<=params.checkin){
  status("Dates incohérentes","Le départ doit être postérieur à l'arrivée.","error");return;
 }
 if(!PRICE_ENDPOINT){
  status("API de tarifs non activée","Nuitee nécessite une clé de production conservée côté serveur. Aucune API n'est liée à GitHub Pages actuellement.","error");
  $("quoteResults").innerHTML='<div class="quote-placeholder"><strong>La vérification tarifaire automatique est indisponible.</strong> Utilisez les liens Booking et Airbnb ci-dessous pour consulter directement les prix et disponibilités aux dates choisies. Aucune offre n’est présentée comme vérifiée.</div>';
  return;
 }
 button.disabled=true;button.textContent="Recherche de vrais tarifs en cours…";
 status("Interrogation des tarifs de production…","Jusqu’à quatre zones sont consultées, ce n’est pas un inventaire mondial complet.","live");
 try{
  let targets=makeTargets();
  if(params.destination)targets=[await geocode(params.destination)];
  if(!targets.length){status("Aucun centre de recherche","Déplacez la carte vers un pays ou précisez une ville.","error");return;}
  const response=await fetch(PRICE_ENDPOINT,{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({checkin:params.checkin,checkout:params.checkout,adults:params.adults,budget:params.budget,
     minStars:params.minStars,board:params.board,flight:params.flight,radius:Math.min(params.radius,35000),locations:targets})
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.message||(data.error==="PROVIDER_NOT_CONFIGURED"?"Fournisseur non configuré.":"HTTP "+response.status));
  if(data.environment!=="production"||data.priceScope!=="hotel_only"||!Array.isArray(data.offers))throw Error("Réponse fournisseur non validée. Aucun prix affiché.");
  const count=data.offers.length,failures=data.failures||[];
  status(count+" tarif(s) d'hébergement obtenus",
   "Données : "+new Date(data.checkedAt).toLocaleString("fr-FR")+" · "+data.regionsChecked+" zone(s) · "+
   (params.flight?"vol non chiffré : aucun forfait complet validé.":"hôtel seul (hors vol).")+
   (failures.length?" Certaines zones sont indisponibles.":""),"live");
  renderOffers(data);
 }catch(err){
  status("Prix non disponibles",err.message||"Service inaccessible. Aucun tarif fictif n’est affiché.","error");
  $("quoteResults").innerHTML='<div class="quote-placeholder"><strong>Impossible de confirmer des prix.</strong> Consultez les résultats chez les plateformes partenaires ci-dessous.</div>';
 }finally{button.disabled=false;button.innerHTML="Vérifier les offres hôtelières <span>↗</span>";}
}
$("quoteSearch").addEventListener("click",search);
["country","destination","checkin","checkout","adults","budget","board","flight","airport"].forEach(id=>{
 const input=$(id);input.addEventListener("change",external);
});
external();
if(!PRICE_ENDPOINT){
 status("Recherche de prix : connexion fournisseur nécessaire",
 "Le site GitHub Pages n'a pas d'accès privé aux tarifs de réservation. Les liens externes fonctionnent dès maintenant.","");
}else{
 status("Service de prix configuré","Cliquez pour vérifier des tarifs d'hôtel réels. Les vols sont exclus de cette première connexion.","live");
}
})();
