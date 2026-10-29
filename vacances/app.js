(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = val => String(val == null ? "" : val).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
const CATEGORY = {hotel:"Hôtel",camping:"Camping",rental:"Location",other:"Autre"};
const TOURISM = {hotel:"hotel",motel:"hotel",resort:"hotel",camp_site:"camping",caravan_site:"camping",apartment:"rental",chalet:"rental",guest_house:"other",hostel:"other",wilderness_hut:"other",holiday_village:"other"};
const FIELDS = ["country","destination","checkin","checkout","adults","budget","airport","radius","stars","board","flight","pool","beach","sea"];
const HUBS=(window.ESCAPADE_HUBS||[]).map(([name,country,lat,lon])=>({name,country,lat,lon}));
const state = {kind:"hotel",place:"",center:null,items:[],pins:new Map(),lastUpdate:null,loading:false,worldSample:false,country:"",globalLoading:false,countryLoading:false,previewEpoch:0};
const map = L.map("map",{worldCopyJump:true,zoomControl:true,minZoom:2}).setView([20,0],2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
 attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
 maxZoom:18
}).addTo(map);
const layers = L.layerGroup().addTo(map);
const hubLayers = L.layerGroup().addTo(map);

function safeURL(value){
 const s=String(value||"").trim();
 if(!s)return "";
 const candidate = /^https?:\/\//i.test(s) ? s : /^[\w.-]+\.[a-z]{2,}([:/?#]|$)/i.test(s) ? "https://"+s : "";
 if(!candidate)return "";
 try{const u=new URL(candidate);return (u.protocol==="http:"||u.protocol==="https:")?u.href:"";}catch(_){return "";}
}
function setStatus(message,variant=""){
 $("status").textContent=message;
 $("statusDot").className="state-dot "+variant;
}
function setBusy(on){
 state.loading=on;
 ["searchBtn","loadHere","refresh"].forEach(id=>$(id).disabled=on);
 if(on)setStatus("Chargement des hébergements dans cette zone…","busy");
}
function savedForm(){
 try{const old=JSON.parse(localStorage.getItem("escapade_preferences_v2")||"{}");
 FIELDS.forEach(id=>{if(old[id]===undefined)return;const e=$(id);if(e.type==="checkbox")e.checked=Boolean(old[id]);else e.value=old[id];});
 if(old.kind){state.kind=old.kind;document.querySelectorAll(".category").forEach(b=>b.classList.toggle("active",b.dataset.kind===state.kind));}
 }catch(_){}
}
function saveForm(){
 const values={kind:state.kind};FIELDS.forEach(id=>{const e=$(id);values[id]=e.type==="checkbox"?e.checked:e.value;});
 try{localStorage.setItem("escapade_preferences_v2",JSON.stringify(values));}catch(_){}
}
function formData(){
 return {checkin:$("checkin").value,checkout:$("checkout").value,adults:Number($("adults").value)||2,
 budget:Number($("budget").value)||null,airport:$("airport").value,board:$("board").value,flight:$("flight").checked,pool:$("pool").checked,beach:$("beach").checked,sea:$("sea").checked,
 radius:Number($("radius").value)||35000,stars:Number($("stars").value)||0};
}
function validate(){
 const f=formData();
 if(!f.checkin||!f.checkout||f.checkout<=f.checkin){setStatus("La date de départ doit être postérieure à l'arrivée.","error");return false;}
 if(f.adults<1||f.adults>20){setStatus("Le nombre de voyageurs doit être compris entre 1 et 20.","error");return false;}
 return true;
}
function osmURL(item){return "https://www.openstreetmap.org/"+item.type+"/"+item.id;}
function bookingURL(item){
 const q = new URLSearchParams({ss:[item.name,item.location||state.place].filter(Boolean).join(", "),checkin:$("checkin").value,checkout:$("checkout").value,group_adults:String(formData().adults),no_rooms:"1",selected_currency:"EUR"});
 return "https://www.booking.com/searchresults.fr.html?"+q.toString();
}
function airbnbURL(){
 const place=state.place||$("destination").value||($("country").value?$("country").selectedOptions[0].text:"Monde entier");
 const q=new URLSearchParams({checkin:$("checkin").value,checkout:$("checkout").value,adults:String(formData().adults)});
 return "https://www.airbnb.fr/s/"+encodeURIComponent(place)+"/homes?"+q.toString();
}
function packageURL(){
 const f=formData();
 const airport=f.airport||"Paris";
 const terms=[state.place||$("destination").value,"vol hôtel",airport,f.checkin,f.checkout,
 f.board==="all"?"all inclusive":"",f.budget?"moins de "+f.budget+" euros par personne":"",f.adults+" personnes"].filter(Boolean).join(" ");
 return "https://www.google.com/search?q="+encodeURIComponent(terms);
}
function link(target,label){return '<a href="'+esc(target)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';}
function iconFor(kind){return L.divIcon({className:"",html:'<span class="marker '+esc(kind)+'"></span>',iconSize:[19,19],iconAnchor:[9,9]});}
function isPool(tags){return ["yes","private","customers","indoor","outdoor"].includes(String(tags.swimming_pool||tags["swimming_pool:access"]||"").toLowerCase());}
function normalize(element){
 const t=element.tags||{};
 const kind=TOURISM[t.tourism];if(!kind)return null;
 const lat=Number(element.lat??element.center?.lat),lon=Number(element.lon??element.center?.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
 const name=t["name:fr"]||t.name||t["name:en"]||"";
 if(!name.trim())return null;
 const starsString=String(t.stars||t["stars:official"]||"");
 const match=starsString.match(/\b[1-5]\b/);
 const stars=match?Number(match[0]):null;
 const url=safeURL(t.website||t["contact:website"]||t.url);
 const location=[t["addr:city"]||t["addr:place"]||"",t["addr:country"]||""].filter(Boolean).join(", ");
 return {id:element.id,type:element.type,lat,lon,kind,name:name.trim(),stars,site:url,pool:isPool(t),location,phone:t.phone||t["contact:phone"]||""};
}
function formatPlace(item){return item.location||state.place||"Lieu géolocalisé";}
function popup(item){
 const mainURL=item.site||osmURL(item);
 return '<div class="popup-title">'+esc(item.name)+'</div>'+
 '<div class="popup-detail">'+esc(CATEGORY[item.kind])+' · '+esc(formatPlace(item))+
 '<br>Étoiles : '+(item.stars?esc(item.stars)+"★":"non renseignées")+
 '<br>Prix / disponibilité / formule : non vérifiés</div>'+
 '<div class="popup-actions">'+link(mainURL,item.site?"Site officiel ↗":"Fiche OpenStreetMap ↗")+
 link(item.kind==="rental"?airbnbURL():bookingURL(item),item.kind==="rental"?"Recherche Airbnb ↗":"Recherche Booking ↗")+
 (formData().flight?link(packageURL(),"Vol + hébergement ↗"):"")+'</div>';
}

function countryLabel(code){
 const display = new Intl.DisplayNames(["fr"],{type:"region"});
 try{return display.of(code)||code;}catch(_){return code;}
}
function setupCountries(){
 const select=$("country");
 const display = new Intl.DisplayNames(["fr"],{type:"region"});
 const entries=[];
 for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
  const code=String.fromCharCode(a,b);
  const label=display.of(code);
  if(label&&label!==code&&!/^((code)|région inconnue)/i.test(label))entries.push({code,label});
 }
 entries.push({code:"XK",label:"Kosovo"});
 entries.sort((a,b)=>a.label.localeCompare(b.label,"fr"));
 entries.forEach(({code,label})=>{
  const opt=document.createElement("option");opt.value=code;opt.textContent=label;select.appendChild(opt);
 });
}
function chosenHubs(){
 const code=$("country").value;
 return code?HUBS.filter(h=>h.country===code):HUBS;
}
function boundsFor(hubs){
 if(!hubs.length)return;
 if(hubs.length===1)map.setView([hubs[0].lat,hubs[0].lon],7);
 else map.fitBounds(hubs.map(h=>[h.lat,h.lon]),{padding:[35,35],maxZoom:7});
}
function showHubs(){
 hubLayers.clearLayers();
 const hubs=chosenHubs();
 for(const h of hubs){
  const mark=L.circleMarker([h.lat,h.lon],{radius:5.6,weight:1.5,color:"#ffffff",fillColor:"#f1ab56",fillOpacity:.9,opacity:.95});
  mark.bindTooltip(h.name,{direction:"top"});
  mark.on("click",()=>visitHub(h));
  mark.addTo(hubLayers);
 }
 return hubs;
}
function renderHubCards(hubs){
 const list=$("results");
 list.replaceChildren();
 if(!hubs.length){
  list.innerHTML='<div class="blank"><span>⌖</span><strong>Aucun point d’accès préchargé pour ce pays.</strong><p>Déplacez la carte sur une ville puis cliquez sur « Chercher autour de la carte ».</p></div>';
  return;
 }
 const frag=document.createDocumentFragment();
 hubs.forEach(h=>{
  const card=document.createElement("article");
  card.className="result hub-result";card.tabIndex=0;
  card.innerHTML='<div class="resulttop"><div><h4>'+esc(h.name)+'</h4><div class="mini">'+esc(countryLabel(h.country))+'</div></div><span class="pill">Zone à explorer</span></div><div class="line">Cliquer pour rechercher des hébergements réels autour de ce point. Ce repère n’est pas une offre.</div>';
  const go=()=>visitHub(h);
  card.addEventListener("click",go);card.addEventListener("keydown",e=>{if(e.key==="Enter")go();});
  frag.appendChild(card);
 });
 list.appendChild(frag);
}
async function visitHub(h){
 if(state.loading)return;
 state.previewEpoch++;
 state.center={lat:h.lat,lon:h.lon};
 state.place=h.name+", "+countryLabel(h.country);
 map.setView([h.lat,h.lon],11);
 state.items=[];
 render();
 await loadPlaces(false);
}
async function showCountryFallback(code){
 if(!code)return;
 try{
  const resp=await fetch("https://restcountries.com/v3.1/alpha/"+encodeURIComponent(code)+"?fields=latlng,capitalInfo",{signal:AbortSignal.timeout(10000)});
  if(!resp.ok)throw Error("géolocalisation indisponible");
  const data=await resp.json();
  const location=data.capitalInfo?.latlng||data.latlng;
  if(!Array.isArray(location)||location.length<2)throw Error("localisation indisponible");
  map.setView(location,6);
  state.center={lat:location[0],lon:location[1]};
  state.place=$("country").selectedOptions[0].text+" (centre du pays)";
  setStatus("Pays sélectionné. Déplacez la carte vers une ville, puis cliquez sur « Chercher autour de la carte ».","ok");
 }catch(_){setStatus("Pays choisi. Explorez librement la carte puis lancez une recherche dans la zone.","ok");}
}
function setCountryView(){
 state.previewEpoch++;
 state.items=[];state.center=null;state.worldSample=false;state.place="";
 const hubs=showHubs();
 if($("country").value){
  if(hubs.length)boundsFor(hubs);
  else showCountryFallback($("country").value);
  setStatus("Pays : "+$("country").selectedOptions[0].text+" · Choisissez une zone à explorer.","ok");
 }else{
  map.setView([20,0],2);
  setStatus("Monde entier : choisissez un point orange, ou lancez « Explorer le monde ».","ok");
 }
 render();
}

async function loadCountrySample(){
 const code=$("country").value;
 if(!code||state.countryLoading||state.loading)return;
 const epoch=state.previewEpoch;
 const hubs=chosenHubs();
 if(!hubs.length){
  if(!state.center)await showCountryFallback(code);
  if(state.center&&state.previewEpoch===epoch)await loadPlaces(false);
  return;
 }
 state.countryLoading=true;
 const name=$("country").selectedOptions[0].text;
 setStatus("Recherche d’hébergements dans plusieurs zones de "+name+"…","busy");
 const selected=hubs.slice(0,7),cache="escapade_country_v1_"+code;
 try{
  try{
   const c=JSON.parse(localStorage.getItem(cache)||"null");
   if(c&&Date.now()-c.time<24*3600000&&Array.isArray(c.items)){
    if(epoch!==state.previewEpoch)return;
    state.items=c.items;state.lastUpdate=c.time;state.place=name+" · aperçu de "+selected.length+" zones";
    render();setStatus(state.items.length+" hébergements dans "+selected.length+" zones. Tarifs et disponibilités non vérifiés.","ok");
    $("updateTime").textContent="Collecte : "+new Date(c.time).toLocaleString("fr-FR");
    return;
   }
  }catch(_){}
  const kinds="hotel|motel|resort|camp_site|caravan_site|apartment|chalet|guest_house|hostel|wilderness_hut|holiday_village";
  const query="[out:json][timeout:45];"+selected.map(h=>'nwr["tourism"~"^('+kinds+')$"](around:12000,'+h.lat+','+h.lon+');out center 30;').join("");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000);
  let response;
  try{response=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:new URLSearchParams({data:query}),signal:controller.signal});}
  finally{clearTimeout(timer);}
  if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();if(!Array.isArray(data.elements))throw Error("Réponse incorrecte");
  if(epoch!==state.previewEpoch)return;
  const unique=new Map();
  data.elements.map(normalize).filter(Boolean).forEach(item=>{
   const nearest=selected.reduce((best,h)=>{
    const d=Math.hypot((h.lat-item.lat)*111,(h.lon-item.lon)*111*Math.cos(item.lat*Math.PI/180));
    return !best||d<best.distance?{h,distance:d}:best;
   },null);
   if(!item.location&&nearest)item.location=nearest.h.name+", "+name;
   unique.set(item.type+"/"+item.id,item);
  });
  state.items=[...unique.values()];state.lastUpdate=Date.now();state.place=name+" · aperçu de "+selected.length+" zones";
  try{localStorage.setItem(cache,JSON.stringify({time:state.lastUpdate,items:state.items}));}catch(_){}
  render();setStatus(state.items.length+" hébergements dans "+selected.length+" zones du pays (aperçu non exhaustif).","ok");
  $("updateTime").textContent="Collecte : "+new Date(state.lastUpdate).toLocaleString("fr-FR");
 }catch(_){
  if(epoch===state.previewEpoch){setStatus("Service de collecte indisponible. Cliquez sur un point orange pour chercher localement.","error");render();}
 }finally{state.countryLoading=false;}
}

async function loadGlobalSample(){
 if(state.loading||state.globalLoading)return;
 state.globalLoading=true;
 const epoch=state.previewEpoch;
 setStatus("Recherche d’un échantillon de vrais hébergements sur plusieurs continents…","busy");
 const points=["Palma de Majorque","Agadir","Zanzibar","Dubaï","Phuket","Bali — Denpasar","Sydney","Honolulu","Cancún","Punta Cana","Cartagena","Rio de Janeiro","Port Louis","Rhodes","Nadi","Tokyo"];
 const chosen=points.map(name=>HUBS.find(h=>h.name===name)).filter(Boolean);
 const kind="hotel|motel|resort|camp_site|caravan_site|apartment|chalet|guest_house|hostel|wilderness_hut|holiday_village";
 const key="escapade_world_samples_v1";
 try{
  const cached=JSON.parse(localStorage.getItem(key)||"null");
  if(cached&&Date.now()-cached.time<24*3600000&&Array.isArray(cached.items)){
   if(epoch!==state.previewEpoch)return;
   state.items=cached.items;state.worldSample=true;state.lastUpdate=cached.time;state.place="Échantillon mondial (16 secteurs)";render();
   setStatus(state.items.length+" établissements réels dans 16 zones. Échantillon mondial, non exhaustif. Les prix ne sont pas vérifiés.","ok");
   $("updateTime").textContent="Collecte : "+new Date(cached.time).toLocaleString("fr-FR");state.globalLoading=false;return;
  }
 }catch(_){}
 try{
  const queries=chosen.map(h=>'nwr["tourism"~"^('+kind+')$"](around:9000,'+h.lat+','+h.lon+');out center 15;').join("");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),55000);
  let response;
  try{response=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:new URLSearchParams({data:"[out:json][timeout:50];"+queries}),signal:controller.signal});}
  finally{clearTimeout(timer);}
  if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();
  if(!Array.isArray(data.elements))throw Error("données manquantes");
  if(epoch!==state.previewEpoch)return;
  const items=new Map();
  data.elements.map(normalize).filter(Boolean).forEach(v=>{
   const nearest=chosen.reduce((best,h)=>{
    const d=Math.hypot((h.lat-v.lat)*111,(h.lon-v.lon)*111*Math.cos(v.lat*Math.PI/180));
    return !best||d<best.distance?{h,distance:d}:best;
   },null);
   if(!v.location&&nearest)v.location=nearest.h.name+", "+countryLabel(nearest.h.country);
   items.set(v.type+"/"+v.id,v);
  });
  state.items=[...items.values()];state.worldSample=true;state.lastUpdate=Date.now();
  try{localStorage.setItem(key,JSON.stringify({time:state.lastUpdate,items:state.items}));}catch(_){}
  state.place="Échantillon mondial (16 secteurs)";
  render();
  setStatus(state.items.length+" hébergements dans 16 secteurs du monde. Catalogue partiel : tarifs et disponibilités inconnus.","ok");
  $("updateTime").textContent="Collecte : "+new Date(state.lastUpdate).toLocaleString("fr-FR");
 }catch(e){
  if(epoch!==state.previewEpoch)return;
  setStatus("Échantillon mondial indisponible pour le moment. Les points orange restent utilisables : choisissez une zone pour y chercher des établissements.","error");
  render();
 }finally{state.globalLoading=false;}
}

function filtered(){
 const f=formData();
 return state.items.filter(item=>(state.kind==="all"||item.kind===state.kind)&&(!f.stars||item.stars==null||item.stars>=f.stars))
 .sort((a,b)=>$("sort").value==="stars"?((b.stars||0)-(a.stars||0))||a.name.localeCompare(b.name,"fr"):a.name.localeCompare(b.name,"fr"));
}
function render(){
 layers.clearLayers();state.pins.clear();
 const items=filtered();
 const hubs=showHubs();
 $("mappedCount").textContent=state.items.length;
 $("filteredCount").textContent=items.length;
 $("resultsSub").textContent=state.place?state.place+" · "+items.length+" lieu(x)":"Monde entier · "+hubs.length+" zones à parcourir";
 const list=$("results");list.replaceChildren();
 if(!state.items.length){renderHubCards(hubs);return;}
 if(!items.length){
 list.innerHTML='<div class="blank"><span>⌖</span><strong>Aucun établissement pour ce type.</strong><p>Essayez « Tous » ou choisissez un autre nombre d’étoiles.</p></div>';return;
 }
 const frag=document.createDocumentFragment();
 items.slice(0,450).forEach(item=>{
  const marker=L.marker([item.lat,item.lon],{icon:iconFor(item.kind),title:item.name}).bindPopup(()=>popup(item),{maxWidth:320}).addTo(layers);
  state.pins.set(item.type+"/"+item.id,marker);
  const card=document.createElement("article");
  card.className="result";card.tabIndex=0;
  card.innerHTML='<div class="resulttop"><div><h4>'+esc(item.name)+'</h4><div class="mini">'+esc(formatPlace(item))+'</div></div><span class="pill">'+esc(CATEGORY[item.kind])+'</span></div>'+
   '<div class="line">'+(item.stars?item.stars+" ★ (déclarées dans OSM)":"Étoiles non renseignées")+' · Tarif non renseigné</div>'+
   '<div class="sub"><span>Source : OpenStreetMap</span>'+(item.pool?'<span>Piscine indiquée</span>':'')+'<span>Position géolocalisée</span></div>'+
   '<div class="buttons">'+link(item.site||osmURL(item),item.site?"Site officiel ↗":"Fiche OSM ↗")+
   link(item.kind==="rental"?airbnbURL():bookingURL(item),item.kind==="rental"?"Rechercher sur Airbnb ↗":"Rechercher sur Booking ↗")+'</div>';
  const activate=()=>{map.setView([item.lat,item.lon],Math.max(map.getZoom(),13),{animate:true});marker.openPopup();};
  card.addEventListener("click",e=>{if(e.target.closest("a"))return;activate();});
  card.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.target.closest("a"))activate();});
  frag.appendChild(card);
 });
 list.appendChild(frag);
}
async function geoSearch(name){
 const url="https://geocoding-api.open-meteo.com/v1/search?"+new URLSearchParams({name,count:"5",language:"fr",format:"json"});
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
 const resp=await fetch(url,{signal:controller.signal});
 if(!resp.ok)throw new Error("Service de géolocalisation indisponible ("+resp.status+").");
 const data=await resp.json();
 const results=(data.results||[]).filter(x=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
 if(!results.length)throw new Error("Destination introuvable. Essayez le nom local d’une ville (ex. Palermo).");
 return results[0];
 }finally{clearTimeout(timer);}
}
function cacheKey(lat,lon,radius){return "escapade_osm_"+lat.toFixed(2)+"_"+lon.toFixed(2)+"_"+radius;}
function readCache(key){
 try{const c=JSON.parse(localStorage.getItem(key)||"null");if(c&&Date.now()-c.t<60*60*1000&&Array.isArray(c.items))return c;}catch(_){}
 return null;
}
function writeCache(key,items){
 try{localStorage.setItem(key,JSON.stringify({t:Date.now(),items:items.slice(0,550)}));}catch(_){}
}
async function loadPlaces(force=false){
 if(!state.center||state.loading)return;
 if(!validate())return;
 const radius=formData().radius;
 const {lat,lon}=state.center;
 const key=cacheKey(lat,lon,radius);
 const cache=!force&&readCache(key);
 if(cache){
 state.items=cache.items;state.lastUpdate=cache.t;
 render();
 setStatus(cache.items.length+" adresses issues du cache local (moins d’une heure).","ok");
 $("updateTime").textContent="Collecte : "+new Date(cache.t).toLocaleString("fr-FR");
 return;
 }
 setBusy(true);
 try{
 const allowed="hotel|motel|resort|camp_site|caravan_site|apartment|chalet|guest_house|hostel|wilderness_hut|holiday_village";
 const q='[out:json][timeout:25];nwr["tourism"~"^('+allowed+')$"](around:'+radius+','+lat.toFixed(5)+','+lon.toFixed(5)+');out center 550;';
 const body=new URLSearchParams({data:q});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),38000);
 let response;
 try{response=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body,signal:controller.signal});}
 finally{clearTimeout(timeout);}
 if(!response.ok)throw new Error("Service cartographique indisponible (HTTP "+response.status+").");
 const data=await response.json();
 if(!Array.isArray(data.elements))throw new Error("Réponse cartographique incomplète.");
 const entries=data.elements.map(normalize).filter(Boolean);
 const unique=new Map();
 entries.forEach(v=>{if(!v.location)v.location=state.place;unique.set(v.type+"/"+v.id,v);});
 state.items=[...unique.values()];
 state.lastUpdate=Date.now();
 writeCache(key,state.items);
 render();
 setStatus(state.items.length+" établissements géolocalisés · tarifs et disponibilités non vérifiés","ok");
 $("updateTime").textContent="Collecte : "+new Date(state.lastUpdate).toLocaleString("fr-FR");
 }catch(error){
 setStatus((error.name==="AbortError"?"Délai dépassé du service cartographique.":error.message)+" Réessayez ou réduisez le rayon.","error");
 if(!state.items.length)render();
 }finally{setBusy(false);}
}
async function runSearch(){
 if(state.loading||!validate())return;
 const query=$("destination").value.trim();
 saveForm();
 if(!query){
  setCountryView();
  if(!$("country").value)await loadGlobalSample();
  else await loadCountrySample();
  return;
 }
 setBusy(true);
 try{
 const place=await geoSearch(query);
 const center={lat:place.latitude,lon:place.longitude};
 state.center=center;
 state.place=[place.name,place.country].filter(Boolean).join(", ");
 $("country").value="";
 const zoom=formData().radius>=55000?9:formData().radius>=35000?10:formData().radius>=25000?11:12;
 map.setView([center.lat,center.lon],zoom);
 }catch(error){setStatus(error.name==="AbortError"?"Géolocalisation trop lente.":error.message,"error");setBusy(false);return;}
 setBusy(false);
 await loadPlaces(false);
}
function chooseKind(kind){
 if(!["hotel","camping","rental","other","all"].includes(kind))return;
 state.kind=kind;
 document.querySelectorAll(".category").forEach(btn=>{btn.classList.toggle("active",btn.dataset.kind===kind);btn.setAttribute("aria-pressed",btn.dataset.kind===kind?"true":"false");});
 saveForm();render();
}
document.querySelectorAll(".category").forEach(btn=>btn.addEventListener("click",()=>chooseKind(btn.dataset.kind)));
$("searchForm").addEventListener("submit",event=>{event.preventDefault();runSearch();});
$("loadHere").addEventListener("click",()=>{const c=map.getCenter();state.center={lat:c.lat,lon:c.lng};state.place="zone de carte ("+c.lat.toFixed(2)+", "+c.lng.toFixed(2)+")";state.items=[];state.previewEpoch++;saveForm();loadPlaces(false);});
$("refresh").addEventListener("click",()=>{if(state.center)loadPlaces(true);else if(!$("country").value)loadGlobalSample();else setStatus("Cliquez sur une zone du pays pour actualiser les établissements.","error");});
$("sort").addEventListener("change",render);
$("country").addEventListener("change",()=>{if(state.loading)return;$("destination").value="";saveForm();setCountryView();if($("country").value)loadCountrySample();});
FIELDS.forEach(id=>{
 const el=$(id);
 el.addEventListener("change",()=>{saveForm();if(state.items.length)render();});
});
$("resetBtn").addEventListener("click",()=>{
 try{localStorage.removeItem("escapade_preferences_v2");}catch(_){}
 $("searchForm").reset();
 $("destination").value="";$("country").value="";$("checkin").value="2027-08-10";$("checkout").value="2027-08-17";
 $("adults").value="2";$("budget").value="1100";$("radius").value="35000";$("stars").value="4";
 $("board").value="all";$("airport").value="PAR";$("flight").checked=true;$("beach").checked=true;
 chooseKind("hotel");setCountryView();
});
setInterval(()=>{if(document.visibilityState==="visible"&&state.center&&!state.loading&&state.lastUpdate&&Date.now()-state.lastUpdate>=60*60*1000)loadPlaces(true);},60000);
setupCountries();savedForm();chooseKind(state.kind);
setCountryView();
if($("country").value)loadCountrySample();
})();
