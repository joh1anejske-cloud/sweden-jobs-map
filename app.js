(() => {
  const SWEDEN = [[55.0,10.5],[69.2,24.5]];
  const COLORS = {eng:"#dc2626",hr:"#16803c",home:"#7c3aed",car:"#2563eb",approx:"#f59e0b"};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  const strip = s => String(s == null ? "" : s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  const norm = s => strip(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const moneySek = v => { const n=num(v); return n==null?"NC":new Intl.NumberFormat("fr-FR").format(Math.round(n))+" SEK"; };
  const moneyEur = v => { const n=num(v); return n==null?"NC":new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(Math.round(n))+" €"; };
  const money = v => {
    const n=num(v);
    if(n==null)return "NC";
    const sek=moneySek(n);
    return state.fxRate ? sek+" (~"+moneyEur(n*state.fxRate)+")" : sek;
  };
  const fmtDate = d => { if(!d)return "NC"; const x=new Date(d); return isNaN(x)?"NC":x.toLocaleDateString("fr-FR"); };
  const daysOld = d => { const x=new Date(d); return isNaN(x)?9999:Math.max(0,(Date.now()-x.getTime())/86400000); };
  const boolLabel = v => v===true?"Oui":v===false?"Non":"NC";
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

  const map = L.map("map",{minZoom:4,zoomControl:true}).fitBounds(SWEDEN);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(map);
  const layer = L.layerGroup().addTo(map);

  const state = {
    mode:"jobs",
    jobs:[], homes:[], cars:[], latestCars:[],
    filtered:[], layers:new Map(),
    jobsGenerated:"", homesGenerated:"",
    carTotal:0,
    fxRate:null, fxDate:""
  };

  const COUNTY_CENTERS = {
    BLEKINGE:[56.18,15.28], DALARNA:[60.61,14.72], GOTLAND:[57.50,18.50],
    GAVLEBORG:[61.30,16.15], HALLAND:[56.90,12.65], JAMTLAND:[63.20,14.65],
    JONKOPING:[57.65,14.35], KALMAR:[57.20,16.05], KRONOBERG:[56.72,14.55],
    NORRBOTTEN:[66.75,20.65], SKANE:[55.95,13.55], STOCKHOLM:[59.35,18.05],
    SODERMANLAND:[59.05,16.65], UPPSALA:[60.05,17.65], VARMLAND:[59.85,13.15],
    VASTERBOTTEN:[64.55,18.45], VASTERNORRLAND:[62.80,17.25], VASTMANLAND:[59.65,16.15],
    VASTRA_GOTALAND:[58.20,12.90], OREBRO:[59.35,15.05], OSTERGOTLAND:[58.40,15.65]
  };

  function markerIcon(color){
    return L.divIcon({className:"",html:'<div style="width:18px;height:18px;border-radius:50%;background:'+color+';border:3px solid white;box-shadow:0 1px 5px #0006"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  }

  function setStatus(text){ $("globalStatus").textContent=text||""; }

  function switchTab(mode){
    state.mode=mode;
    document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===mode));
    document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+mode));
    const titles={
      jobs:["Emplois","Offres adaptées à vos deux profils"],
      homes:["Appartements","Locations en Suède selon tes critères"],
      cars:["Voitures","Annonces automobiles selon tes critères"]
    };
    $("resultsTitle").textContent=titles[mode][0];
    $("resultsHint").textContent=titles[mode][1];
    if(mode==="jobs") applyJobFilters();
    if(mode==="homes") applyHomeFilters();
    if(mode==="cars") drawCars();
    setTimeout(()=>map.invalidateSize(),50);
  }

  function saveForm(prefix, ids){
    const o={}; ids.forEach(id=>{ const el=$(id); if(el)o[id]=el.value; });
    localStorage.setItem(prefix,JSON.stringify(o));
  }
  function restoreForm(prefix, ids){
    let o={}; try{o=JSON.parse(localStorage.getItem(prefix)||"{}");}catch(e){}
    ids.forEach(id=>{ if($(id)&&o[id]!=null)$(id).value=o[id]; });
  }

  function clearMap(){ layer.clearLayers(); state.layers.clear(); }

  function resultCardBase(title,meta,tags,image){
    return (image?'<img class="thumb" loading="lazy" src="'+esc(image)+'" alt="">':'')+
      '<h3>'+esc(title)+'</h3><div class="meta">'+meta+'</div>'+tags;
  }

  function renderCards(items, cardBuilder, openFn){
    const list=$("resultsList"); list.innerHTML="";
    if(!items.length){ list.innerHTML='<div class="empty">Aucun résultat avec ces critères.</div>'; $("resultsCount").textContent="0 résultat"; return; }
    const frag=document.createDocumentFragment();
    items.slice(0,700).forEach(item=>{
      const el=document.createElement("article"); el.className="card"; el.tabIndex=0; el.innerHTML=cardBuilder(item);
      const go=()=>openFn(item); el.addEventListener("click",go); el.addEventListener("keydown",e=>{if(e.key==="Enter")go();}); frag.appendChild(el);
    });
    list.appendChild(frag);
    $("resultsCount").textContent=items.length+" résultat"+(items.length>1?"s":"")+(items.length>700?" • 700 affichés":"");
  }

  function openLayer(item){
    const l=state.layers.get(item._key);
    if(l){
      if(item.coords) map.setView(item.coords, item._approx?7:11);
      l.openPopup && l.openPopup();
    } else if(item.url) window.open(item.url,"_blank","noopener");
  }


  function updateFxDisplays(){
    const txt=state.fxRate ? "1 SEK = "+state.fxRate.toFixed(4)+" €"+(state.fxDate?" • "+state.fxDate:"") : "Taux indisponible";
    ["homeFxRate","carFxRate"].forEach(id=>{ if($(id))$(id).textContent=txt; });
    [["homeFxSek","homeFxEur"],["carFxSek","carFxEur"]].forEach(([sekId,eurId])=>{
      const sek=$(sekId),eur=$(eurId);
      if(!sek||!eur||!state.fxRate)return;
      if(sek.value!=="")eur.value=(Number(sek.value)*state.fxRate).toFixed(2);
      else if(eur.value!=="")sek.value=(Number(eur.value)/state.fxRate).toFixed(0);
    });
  }
  function bindFxPair(sekId,eurId){
    const sek=$(sekId),eur=$(eurId);
    if(!sek||!eur)return;
    sek.addEventListener("input",()=>{
      if(!state.fxRate){eur.value="";return;}
      const v=Number(sek.value); eur.value=sek.value!==""&&Number.isFinite(v)?(v*state.fxRate).toFixed(2):"";
    });
    eur.addEventListener("input",()=>{
      if(!state.fxRate){sek.value="";return;}
      const v=Number(eur.value); sek.value=eur.value!==""&&Number.isFinite(v)?(v/state.fxRate).toFixed(0):"";
    });
  }
  async function loadFx(){
    try{
      const r=await fetch("https://api.frankfurter.dev/v2/rate/sek/eur",{cache:"no-store"});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const d=await r.json();
      const rate=Number(d.rate);
      if(!Number.isFinite(rate)||rate<=0)throw new Error("Taux invalide");
      state.fxRate=rate;
      state.fxDate=d.date||new Date().toISOString().slice(0,10);
      localStorage.setItem("sekEurRate",JSON.stringify({rate:state.fxRate,date:state.fxDate}));
    }catch(e){
      try{
        const cached=JSON.parse(localStorage.getItem("sekEurRate")||"null");
        if(cached&&Number(cached.rate)>0){state.fxRate=Number(cached.rate);state.fxDate=cached.date||"taux mémorisé";}
      }catch(_){}
    }
    updateFxDisplays();
    if(state.mode==="homes")applyHomeFilters();
    if(state.mode==="cars")drawCars();
  }

  // ---------- JOBS ----------
  function jobPopup(j){
    const lang=j.lang==="swedish"?"Suédois requis":j.lang==="english"?"Anglais mentionné":"Langue NC";
    return '<div class="popup"><h3>'+esc(j.title)+'</h3><p><b>'+esc(j.company)+'</b><br>'+esc([j.city,j.region].filter(Boolean).join(", ")||"Lieu NC")+'</p><p>'+esc(lang)+'</p><p>Publié : '+esc(fmtDate(j.published))+(j.deadline?' • Limite : '+esc(fmtDate(j.deadline)):'')+'</p><p>Salaire : <b>'+esc(j.salary||"Non communiqué")+'</b></p>'+(j.url?'<a href="'+esc(j.url)+'" target="_blank" rel="noopener">Voir l’annonce ↗</a>':'')+'</div>';
  }
  function drawJobs(){
    clearMap();
    state.filtered.forEach(j=>{
      j._key="job-"+j.key;
      if(Array.isArray(j.coords)&&j.coords.length===2){
        const color=j.profile==="eng"?COLORS.eng:COLORS.hr;
        const m=L.marker(j.coords,{icon:markerIcon(color)}).bindPopup(jobPopup(j),{maxWidth:330}).addTo(layer);
        state.layers.set(j._key,m);
      }
    });
    renderCards(state.filtered,j=>{
      const tags='<span class="tag '+(j.profile==="eng"?"tag-red":"tag-green")+'">'+(j.profile==="eng"?"Ingénierie":"RH")+'</span>'+
        (j.new?'<span class="tag tag-blue">Nouveau</span>':'')+
        '<span class="tag tag-gray">'+(j.lang==="swedish"?"Suédois requis":j.lang==="english"?"Anglais":"Langue NC")+'</span>'+
        (j.salary?'<span class="tag tag-amber">'+esc(j.salary)+'</span>':'');
      return resultCardBase(j.title,'<b>'+esc(j.company)+'</b> • '+esc([j.city,j.region].filter(Boolean).join(", ")||"Lieu NC")+'<br>'+esc(fmtDate(j.published)),tags,"");
    },openLayer);
  }
  function populateJobRegions(){
    const sel=$("jobRegion"),cur=sel.value;
    const vals=[...new Set(state.jobs.map(j=>j.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"sv"));
    sel.innerHTML='<option value="">Toute la Suède</option>'+vals.map(x=>'<option>'+esc(x)+'</option>').join("");
    if(vals.includes(cur))sel.value=cur;
  }
  function applyJobFilters(){
    const p=$("jobProfile").value, fresh=$("jobFresh").value, lang=$("jobLanguage").value, salary=$("jobSalary").value, region=$("jobRegion").value, q=norm($("jobText").value);
    state.filtered=state.jobs.filter(j=>{
      if(p&&j.profile!==p)return false;
      if(fresh==="new"&&!j.new)return false;
      if(lang&&j.lang!==lang)return false;
      if(salary==="yes"&&!j.salary)return false;
      if(region&&j.region!==region)return false;
      if(q&&!norm([j.title,j.company,j.city,j.region].join(" ")).includes(q))return false;
      return true;
    });
    $("jTotal").textContent=state.jobs.length;
    $("jEng").textContent=state.jobs.filter(j=>j.profile==="eng").length;
    $("jHr").textContent=state.jobs.filter(j=>j.profile==="hr").length;
    $("jNew").textContent=state.jobs.filter(j=>j.new).length;
    $("jobUpdated").textContent=state.jobsGenerated?new Date(state.jobsGenerated).toLocaleString("fr-FR"):"NC";
    if(state.mode==="jobs")drawJobs();
  }
  async function loadJobs(){
    try{
      const r=await fetch("jobs.json?ts="+Date.now(),{cache:"no-store"}); if(!r.ok)throw new Error();
      const d=await r.json(); state.jobs=Array.isArray(d)?d:(d.jobs||[]); state.jobsGenerated=d.generated_at||"";
      populateJobRegions(); applyJobFilters();
    }catch(e){ setStatus("Les offres d’emploi sont momentanément indisponibles."); }
  }

  // ---------- HOUSING ----------
  function homePrice(h){ return num(h.monthly_cost)!=null?num(h.monthly_cost):num(h.rent); }
  function homeTypeFamily(t){
    const s=norm(t);
    if(/apartment|lagenhet|flat/.test(s))return"apartment";
    if(/house|villa|cottage|radhus|townhouse|stuga/.test(s))return"house";
    if(/room|rum/.test(s))return"room";
    return"other";
  }
  function homePopup(h){
    const loc=[h.route+(h.street_number?" "+h.street_number:""),h.locality].filter(Boolean).join(", ");
    return '<div class="popup"><h3>'+esc(h.title)+'</h3><p><b>'+esc(money(homePrice(h)))+'/mois</b><br>'+esc(loc||"Zone NC")+'</p><p>'+esc(h.rooms||"NC")+' pièces • '+esc(h.sqm||"NC")+' m² • '+esc(h.home_type||"Type NC")+'</p><p>Meublé : '+boolLabel(h.furnished)+' • Animaux : '+boolLabel(h.pets_allowed)+'</p><p>Disponible : '+esc(fmtDate(h.start_date))+'</p><p><small>La zone est indicative : les plateformes de location peuvent volontairement masquer l’adresse exacte.</small></p><a href="'+esc(h.url)+'" target="_blank" rel="noopener">Voir sur Qasa ↗</a></div>';
  }
  function drawHomes(){
    clearMap();
    state.filtered.forEach(h=>{
      h._key="home-"+h.id;
      if(Array.isArray(h.coords)&&h.coords.length===2){
        const c=L.circle(h.coords,{radius:650,color:COLORS.home,weight:2,fillOpacity:.13}).bindTooltip(esc(h.title)+' • '+esc(money(homePrice(h))),{sticky:true}).bindPopup(homePopup(h),{maxWidth:340}).addTo(layer);
        state.layers.set(h._key,c);
      }
    });
    renderCards(state.filtered,h=>{
      const loc=[h.route,h.locality].filter(Boolean).join(", ")||"Zone NC";
      let tags='<span class="tag tag-violet">'+esc(h.home_type||"Logement")+'</span>';
      if(h.furnished===true)tags+='<span class="tag tag-gray">Meublé</span>';
      if(h.pets_allowed===true)tags+='<span class="tag tag-green">Animaux OK</span>';
      if(h.first_hand===true)tags+='<span class="tag tag-blue">1re main</span>';
      return resultCardBase(h.title,'<span class="price">'+esc(money(homePrice(h)))+'/mois</span> • '+esc(loc)+'<br>'+esc(h.rooms||"NC")+' pièces • '+esc(h.sqm||"NC")+' m² • dispo '+esc(fmtDate(h.start_date)),tags,h.image||"");
    },openLayer);
  }
  function applyHomeFilters(){
    const q=norm($("homeArea").value), type=$("homeType").value, furn=$("homeFurnished").value, pets=$("homePets").value, first=$("homeFirstHand").value, fresh=$("homeFresh").value;
    const pmin=num($("homePriceMin").value),pmax=num($("homePriceMax").value),rmin=num($("homeRoomsMin").value),rmax=num($("homeRoomsMax").value),smin=num($("homeSqmMin").value),smax=num($("homeSqmMax").value);
    const avail=$("homeAvailable").value?new Date($("homeAvailable").value):null;
    state.filtered=state.homes.filter(h=>{
      const price=homePrice(h), rooms=num(h.rooms), sqm=num(h.sqm);
      if(q&&!norm([h.title,h.locality,h.route,h.description].join(" ")).includes(q))return false;
      if(type&&homeTypeFamily(h.home_type)!==type)return false;
      if(pmin!=null&&(price==null||price<pmin))return false;
      if(pmax!=null&&(price==null||price>pmax))return false;
      if(rmin!=null&&(rooms==null||rooms<rmin))return false;
      if(rmax!=null&&(rooms==null||rooms>rmax))return false;
      if(smin!=null&&(sqm==null||sqm<smin))return false;
      if(smax!=null&&(sqm==null||sqm>smax))return false;
      if(furn==="yes"&&h.furnished!==true)return false;
      if(furn==="no"&&h.furnished!==false)return false;
      if(pets==="yes"&&h.pets_allowed!==true)return false;
      if(pets==="no"&&h.pets_allowed!==false)return false;
      if(first==="yes"&&h.first_hand!==true)return false;
      if(fresh==="new"&&daysOld(h.updated||h.published)>7)return false;
      if(avail&&h.start_date){ const d=new Date(h.start_date); if(!isNaN(d)&&d>avail)return false; }
      return true;
    }).sort((a,b)=>(homePrice(a)||1e12)-(homePrice(b)||1e12));
    $("hTotal").textContent=state.homes.length;
    $("hFound").textContent=state.filtered.length;
    $("hMapped").textContent=state.filtered.filter(h=>h.coords).length;
    $("hUpdated").textContent=state.homesGenerated?new Date(state.homesGenerated).toLocaleString("fr-FR"):"NC";
    saveForm("swedenHomeFilters",["homeArea","homeType","homePriceMin","homePriceMax","homeRoomsMin","homeRoomsMax","homeSqmMin","homeSqmMax","homeFurnished","homePets","homeFirstHand","homeFresh","homeAvailable"]);
    if(state.mode==="homes")drawHomes();
  }
  async function loadHomes(){
    try{
      const r=await fetch("housing.json?ts="+Date.now(),{cache:"no-store"}); if(!r.ok)throw new Error();
      const d=await r.json(); state.homes=d.homes||[]; state.homesGenerated=d.generated_at||"";
      $("homeCoverage").textContent=d.capped?"Les "+state.homes.length+" annonces les plus récentes sont chargées sur "+(d.reported_total||"plus")+" disponibles.":"Données nationales chargées : "+state.homes.length+" annonces.";
      applyHomeFilters();
    }catch(e){
      $("homeCoverage").textContent="Données logement en cours de synchronisation.";
    }
  }

  // ---------- CARS ----------
  const CAR_API="https://blocket-api.se/v1/search/car";
  function deepFind(obj, keys, depth){
    if(depth>5||obj==null)return null;
    if(typeof obj==="object"&&!Array.isArray(obj)){
      for(const k of keys){ if(obj[k]!=null&&obj[k]!=="")return obj[k]; }
      for(const v of Object.values(obj)){ const x=deepFind(v,keys,depth+1); if(x!=null)return x; }
    } else if(Array.isArray(obj)){
      for(const v of obj){ const x=deepFind(v,keys,depth+1); if(x!=null)return x; }
    }
    return null;
  }
  function deepCoords(o){
    const candidates=[o.coordinates,o.location&&o.location.coordinates,o.geo,o.position,o.location];
    for(const c of candidates){
      if(Array.isArray(c)&&c.length>=2){
        let a=num(c[0]),b=num(c[1]); if(a!=null&&b!=null){
          if(a>=54&&a<=70&&b>=10&&b<=25)return[a,b];
          if(b>=54&&b<=70&&a>=10&&a<=25)return[b,a];
        }
      }
      if(c&&typeof c==="object"){
        const lat=num(c.lat!=null?c.lat:c.latitude),lon=num(c.lon!=null?c.lon:(c.lng!=null?c.lng:c.longitude));
        if(lat!=null&&lon!=null&&lat>=54&&lat<=70&&lon>=10&&lon<=25)return[lat,lon];
      }
    }
    const lat=num(deepFind(o,["latitude","lat"],0)),lon=num(deepFind(o,["longitude","lon","lng"],0));
    if(lat!=null&&lon!=null&&lat>=54&&lat<=70&&lon>=10&&lon<=25)return[lat,lon];
    return null;
  }
  function carLocationText(d){
    const l=d.location;
    if(typeof l==="string")return l;
    if(l&&typeof l==="object")return strip(l.name||l.label||l.city||l.locality||l.region||"");
    return strip(deepFind(d,["location_name","locality","city"],0)||"");
  }
  function carImage(d){
    const img=deepFind(d,["image","image_url","thumbnail","thumbnail_url"],0);
    if(typeof img==="string")return img;
    const images=d.images||d.image_urls;
    if(Array.isArray(images)&&images.length){ const x=images[0]; return typeof x==="string"?x:(x&&x.url)||""; }
    return "";
  }
  function normalizeCar(d,region){
    const priceObj=d.price&&typeof d.price==="object"?d.price:{};
    const price=num(priceObj.amount!=null?priceObj.amount:d.price);
    const heading=strip(d.heading||d.title||d.name||"Voiture");
    const id=String(d.id||d.ad_id||d.uuid||heading);
    const loc=carLocationText(d);
    let coords=deepCoords(d),approx=false;
    if(!coords&&region&&COUNTY_CENTERS[region]){coords=COUNTY_CENTERS[region];approx=true;}
    const url=strip(d.canonical_url||d.url||d.web_url||d.link||("https://www.blocket.se/mobility/item/"+id));
    const year=num(deepFind(d,["model_year","year","year_model"],0));
    const hp=num(deepFind(d,["engine_effect","horsepower","hp"],0));
    const mileage=num(deepFind(d,["mileage","milage","mileage_km","odometer"],0));
    const transmission=strip(deepFind(d,["transmission","gearbox"],0)||"");
    return {_key:"car-"+id,id,title:heading,price:price,location:loc,url:url,coords:coords,_approx:approx,year:year,hp:hp,mileage:mileage,transmission:transmission,image:carImage(d),raw:d};
  }
  function carPopup(c){
    return '<div class="popup"><h3>'+esc(c.title)+'</h3><p><b>'+esc(money(c.price))+'</b><br>'+esc(c.location||"Localisation régionale")+'</p><p>Année : '+esc(c.year||"NC")+' • Puissance : '+esc(c.hp||"NC")+' ch</p><p>Kilométrage : '+esc(c.mileage||"NC")+(c.transmission?' • '+esc(c.transmission):'')+'</p>'+(c._approx?'<p><small>Point placé au centre de la région car l’annonce ne fournit pas de coordonnées précises.</small></p>':'')+'<a href="'+esc(c.url)+'" target="_blank" rel="noopener">Voir l’annonce Blocket ↗</a></div>';
  }
  function drawCars(){
    clearMap();
    state.cars.forEach(c=>{
      if(!c.coords)return;
      let l;
      if(c._approx){
        l=L.circle(c.coords,{radius:35000,color:COLORS.approx,weight:2,fillOpacity:.07}).bindTooltip(esc(c.title)+' • '+esc(money(c.price)),{sticky:true}).bindPopup(carPopup(c),{maxWidth:340}).addTo(layer);
      } else {
        l=L.marker(c.coords,{icon:markerIcon(COLORS.car)}).bindTooltip(esc(c.title)+' • '+esc(money(c.price)),{direction:"top"}).bindPopup(carPopup(c),{maxWidth:340}).addTo(layer);
      }
      state.layers.set(c._key,l);
    });
    renderCards(state.cars,c=>{
      let tags="";
      if(c.year)tags+='<span class="tag tag-blue">'+esc(c.year)+'</span>';
      if(c.hp)tags+='<span class="tag tag-gray">'+esc(c.hp)+' ch</span>';
      if(c.transmission)tags+='<span class="tag tag-gray">'+esc(c.transmission)+'</span>';
      if(c._approx)tags+='<span class="tag tag-amber">Zone approximative</span>';
      return resultCardBase(c.title,'<span class="price">'+esc(money(c.price))+'</span> • '+esc(c.location||"Suède")+(c.mileage?'<br>Kilométrage : '+esc(c.mileage):''),tags,c.image||"");
    },openLayer);
    $("cFound").textContent=state.cars.length;
    $("cMapped").textContent=state.cars.filter(c=>c.coords).length;
    $("cTotal").textContent=state.carTotal||state.cars.length;
  }
  function addParam(p,k,id){
    const v=$(id).value.trim(); if(v!=="")p.append(k,v);
  }
  async function searchCars(){
    const btn=$("carSearchBtn"); btn.disabled=true; setStatus("Recherche des voitures…");
    saveForm("swedenCarFilters",["carQuery","carBrand","carRegion","carPriceMin","carPriceMax","carYearMin","carYearMax","carHpMin","carHpMax","carMileageMin","carMileageMax","carTransmission","carDrive","carSort"]);
    const p=new URLSearchParams();
    addParam(p,"query","carQuery");
    addParam(p,"models","carBrand");
    addParam(p,"locations","carRegion");
    addParam(p,"price_from","carPriceMin"); addParam(p,"price_to","carPriceMax");
    addParam(p,"year_from","carYearMin"); addParam(p,"year_to","carYearMax");
    addParam(p,"horsepower_from","carHpMin"); addParam(p,"horsepower_to","carHpMax");
    addParam(p,"milage_from","carMileageMin"); addParam(p,"milage_to","carMileageMax");
    addParam(p,"transmissions","carTransmission"); addParam(p,"wheel_drive","carDrive");
    addParam(p,"sort_order","carSort");
    const region=$("carRegion").value;
    const all=[]; let total=0, failure="";
    try{
      for(let page=1;page<=5;page++){
        p.set("page",String(page));
        const r=await fetch(CAR_API+"?"+p.toString(),{cache:"no-store"});
        if(!r.ok)throw new Error("HTTP "+r.status);
        const d=await r.json(); const docs=Array.isArray(d.docs)?d.docs:[];
        total=num(d.total)||total; all.push(...docs);
        if(!docs.length||all.length>=Math.min(total||9999,250))break;
      }
      const seen=new Set(); state.cars=all.map(x=>normalizeCar(x,region)).filter(c=>{ if(seen.has(c.id))return false;seen.add(c.id);return true; });
      state.carTotal=total;
      drawCars();
      setStatus("Recherche voitures terminée.");
    }catch(e){
      failure=String(e&&e.message?e.message:e);
      state.cars=[]; state.carTotal=0; drawCars();
      setStatus("La source voitures est momentanément indisponible : "+failure);
    }
    btn.disabled=false;
  }

  async function loadRecentCars(){
    try{
      const r=await fetch("cars_latest.json?ts="+Date.now(),{cache:"no-store"});
      if(!r.ok)throw new Error();
      const d=await r.json();
      const docs=Array.isArray(d.docs)?d.docs:[];
      const seen=new Set();
      state.latestCars=docs.map(x=>normalizeCar(x,"")).filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true;});
      state.cars=state.latestCars.slice();
      state.carTotal=num(d.total)||state.cars.length;
      if(state.mode==="cars")drawCars();
    }catch(e){}
  }

  // ---------- INIT ----------
  bindFxPair("homeFxSek","homeFxEur");
  bindFxPair("carFxSek","carFxEur");
  document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  $("fitSweden").addEventListener("click",()=>map.fitBounds(SWEDEN));
  ["jobProfile","jobFresh","jobLanguage","jobSalary","jobRegion"].forEach(id=>$(id).addEventListener("change",applyJobFilters));
  $("jobText").addEventListener("input",applyJobFilters);
  const homeIds=["homeArea","homeType","homePriceMin","homePriceMax","homeRoomsMin","homeRoomsMax","homeSqmMin","homeSqmMax","homeFurnished","homePets","homeFirstHand","homeFresh","homeAvailable"];
  restoreForm("swedenHomeFilters",homeIds);
  homeIds.forEach(id=>$(id).addEventListener(id==="homeArea"?"input":"change",applyHomeFilters));
  $("homeReset").addEventListener("click",()=>{homeIds.forEach(id=>$(id).value="");$("homeType").value="";$("homeFurnished").value="";$("homePets").value="";$("homeFirstHand").value="";$("homeFresh").value="";applyHomeFilters();});
  const carIds=["carQuery","carBrand","carRegion","carPriceMin","carPriceMax","carYearMin","carYearMax","carHpMin","carHpMax","carMileageMin","carMileageMax","carTransmission","carDrive","carSort"];
  restoreForm("swedenCarFilters",carIds);
  $("carSearchBtn").addEventListener("click",searchCars);
  $("carReset").addEventListener("click",()=>{carIds.forEach(id=>{if($(id))$(id).value="";});$("carSort").value="PUBLISHED_DESC";state.cars=[];state.carTotal=0;drawCars();});
  $("carQuery").addEventListener("keydown",e=>{if(e.key==="Enter")searchCars();});

  Promise.allSettled([loadJobs(),loadHomes(),loadRecentCars(),loadFx()]).then(()=>{ if(state.mode==="jobs")applyJobFilters(); setStatus("Données chargées."); });
  switchTab("jobs");
})();