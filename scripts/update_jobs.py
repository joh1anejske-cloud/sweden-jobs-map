#!/usr/bin/env python3
import json, re, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ENGINEERING = [
    "maskiningenjör","mekanikingenjör","produktionsingenjör","produktionstekniker",
    "manufacturing engineer","production engineer","mechanical engineer","industrial engineer",
    "process engineer","metodingenjör","mekanikkonstruktör","mechanical designer",
    "design engineer mechanical","industrialization engineer","manufacturing development"
]
HR = [
    "HR specialist","HR generalist","HR coordinator","HR koordinator","People & Culture",
    "People Operations","Talent Acquisition","rekryterare","recruiter","HR administratör",
    "Human Resources","HR Business Partner"
]
SOURCES = [
    ("JobSearch","https://jobsearch.api.jobtechdev.se/search"),
    ("JobAd Links","https://links.api.jobtechdev.se/joblinks"),
]

def clean(s):
    if s is None: return ""
    if isinstance(s,(dict,list)): return ""
    s = re.sub(r"<[^>]*>"," ",str(s))
    return re.sub(r"\s+"," ",s).strip()

def norm(s):
    s = unicodedata.normalize("NFD", clean(s)).encode("ascii","ignore").decode().lower()
    return s

def first(*vals):
    for v in vals:
        if v not in (None,"",[],{}): return v
    return ""

def deep(obj, path, default=""):
    cur = obj
    for p in path.split("."):
        if not isinstance(cur, dict): return default
        cur = cur.get(p)
    return default if cur is None else cur

def any_key(obj, keys):
    if isinstance(obj, dict):
        for k in keys:
            if k in obj and obj[k] not in (None,"",[],{}):
                return obj[k]
        for v in obj.values():
            r = any_key(v, keys)
            if r not in (None,"",[],{}): return r
    elif isinstance(obj, list):
        for v in obj:
            r = any_key(v, keys)
            if r not in (None,"",[],{}): return r
    return ""

def parse_hits(data):
    if isinstance(data, list): return data
    if not isinstance(data, dict): return []
    h = data.get("hits")
    if isinstance(h, list): return h
    if isinstance(h, dict) and isinstance(h.get("hits"), list):
        return [x.get("_source",x) if isinstance(x,dict) else x for x in h["hits"]]
    for k in ("results","joblinks","ads","items"):
        if isinstance(data.get(k), list): return data[k]
    return []

def fetch(url, q, offset=0):
    params = urlencode({"q":q,"limit":100,"offset":offset})
    req = Request(url+"?"+params, headers={"Accept":"application/json","User-Agent":"SwedenJobsMap/1.0"})
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def coords(ad):
    wa = first(ad.get("workplace_address"), ad.get("workplace"), ad.get("location"), ad.get("address"))
    wa = wa if isinstance(wa,dict) else {}
    c = first(wa.get("coordinates"), ad.get("coordinates"))
    if isinstance(c,list) and len(c)>=2:
        try:
            lon,lat=float(c[0]),float(c[1])
            if 54<=lat<=70 and 10<=lon<=25: return [lat,lon]
            if 54<=lon<=70 and 10<=lat<=25: return [lon,lat]
        except: pass
    try:
        lat=float(first(wa.get("latitude"),wa.get("lat"),ad.get("latitude"),ad.get("lat")))
        lon=float(first(wa.get("longitude"),wa.get("lon"),wa.get("lng"),ad.get("longitude"),ad.get("lon"),ad.get("lng")))
        if 54<=lat<=70 and 10<=lon<=25: return [lat,lon]
    except: pass
    return None

def too_senior(title, text):
    tt=norm(title); t=norm(text)
    if re.search(r"\b(senior|principal|staff engineer|team lead|tech lead|engineering manager|hr manager|people manager|head of|director|direktor|avdelningschef|gruppchef|projektchef|practice lead)\b",tt):
        return True
    if re.search(r"\b(internship|intern|praktik|praktikant|studentjobb|student job|thesis|examensarbete)\b",tt):
        return True
    pats = [
        r"(?:minst|minimum|at least|minimum of|more than|mer an)\s*([4-9]|[1-9]\d)\s*\+?\s*(?:ar|ars|year|years)",
        r"\b([5-9]|[1-9]\d)\s*\+?\s*(?:ar|ars|year|years)\s*(?:erfarenhet|experience)"
    ]
    return any(re.search(p,t) for p in pats)

def classify(title,text):
    if too_senior(title,text): return None
    tt=norm(title)
    eng=r"(maskiningenjor|mekanikingenjor|produktionsingenjor|produktionstekniker|manufacturing engineer|production engineer|mechanical engineer|industrial engineer|process engineer|metodingenjor|mekanikkonstruktor|mechanical designer|design engineer|industrialization engineer|manufacturing development)"
    hr=r"((^|\b)hr([ -]|$)|human resources|people\s*&?\s*culture|people operations|talent acquisition|rekryterare|recruiter|hr-koordinator|hr koordinator|hr business partner)"
    if re.search(eng,tt): return ("eng","Poste lié à la mécanique, production, méthodes, process ou industrialisation.")
    if re.search(hr,tt): return ("hr","Poste lié aux RH, People & Culture, recrutement ou People Operations.")
    return None

def lang_flag(text):
    t=norm(text)
    sv = re.search(r"(flytande|goda|mycket goda|excellent|fluent|professional).{0,30}(svenska|swedish)|(svenska|swedish).{0,30}(krav|required|obligatorisk|flytande|goda)",t)
    if sv: return "swedish"
    if "english" in t or "engelska" in t: return "english"
    return "unknown"

def salary(text, direct=""):
    t=clean(direct)+" "+clean(text)
    m=re.search(r"(?i)(?:SEK|kr)\s*[\d .]{4,}(?:\s*[-–]\s*[\d .]{4,})?|[\d .]{4,}\s*(?:[-–]\s*[\d .]{4,}\s*)?(?:SEK|kr)(?:\s*/\s*(?:månad|month|år|year))?",t)
    return re.sub(r"\s+"," ",m.group(0)).strip() if m else ""

def parse_date(s):
    if not s: return None
    try:
        return datetime.fromisoformat(str(s).replace("Z","+00:00"))
    except:
        try: return datetime.strptime(str(s)[:10],"%Y-%m-%d").replace(tzinfo=timezone.utc)
        except: return None

def normalize(ad, source):
    if not isinstance(ad,dict): return None
    title=clean(first(ad.get("headline"),ad.get("title"),ad.get("label"),ad.get("position"),ad.get("job_title"),deep(ad,"occupation.label")))
    desc=clean(first(deep(ad,"description.text"),deep(ad,"description.text_formatted"),ad.get("description"),ad.get("summary"),ad.get("brief_description"),ad.get("body"),ad.get("text")))
    if not title: return None
    cl=classify(title,desc)
    if not cl: return None

    emp=ad.get("employer") if isinstance(ad.get("employer"),dict) else {}
    comp=ad.get("company") if isinstance(ad.get("company"),dict) else {}
    wa=first(ad.get("workplace_address"),ad.get("workplace"),ad.get("location"),ad.get("address"))
    wa=wa if isinstance(wa,dict) else {}
    company=clean(first(emp.get("name"),emp.get("workplace"),comp.get("name"),ad.get("company_name"),ad.get("employer_name"),ad.get("organisation_name"),ad.get("organization_name"),"Entreprise NC"))
    city=clean(first(wa.get("city"),wa.get("municipality"),ad.get("city"),ad.get("municipality"),ad.get("location_name")))
    region=clean(first(wa.get("region"),ad.get("region"),ad.get("county"),ad.get("region_name")))
    url=first(ad.get("webpage_url"),deep(ad,"application_details.url"),ad.get("application_url"),ad.get("source_url"),ad.get("url"),ad.get("link"),ad.get("original_url"),any_key(ad,["webpage_url","application_url","source_url","original_url"]))
    url=clean(url)
    published=first(ad.get("publication_date"),ad.get("published"),ad.get("publication_datetime"),ad.get("date"),ad.get("created_at"))
    deadline=first(ad.get("application_deadline"),ad.get("deadline"),ad.get("last_application_date"),ad.get("valid_through"))
    d=parse_date(deadline)
    if d and d < datetime.now(timezone.utc)-timedelta(days=1): return None
    ident=clean(first(ad.get("id"),ad.get("external_id"),ad.get("original_id"),ad.get("ad_id"),ad.get("uuid"),url,title+"|"+company+"|"+city))
    direct_salary=first(ad.get("salary"),ad.get("salary_description"),ad.get("salary_text"),ad.get("compensation"),deep(ad,"salary_type.label"))
    profile,reason=cl
    pub=parse_date(published)
    is_new=bool(pub and pub >= datetime.now(timezone.utc)-timedelta(days=3))
    return {
        "key":source+"|"+ident,"id":ident,"source":source,"title":title,"desc":desc[:5000],
        "profile":profile,"reason":reason,"company":company,"city":city,"region":region,
        "url":url,"published":str(published or ""),"deadline":str(deadline or ""),
        "lang":lang_flag(title+" "+desc),"salary":salary(desc,direct_salary),"coords":coords(ad),"new":is_new
    }

def dedupe(jobs):
    out=[]; seen=set()
    for j in jobs:
        k=(norm(j.get("url"))+"|"+norm(j.get("title"))+"|"+norm(j.get("company"))+"|"+norm(j.get("city")))
        if k in seen: continue
        seen.add(k); out.append(j)
    def key(j):
        d=parse_date(j.get("published"))
        return d.timestamp() if d else 0
    return sorted(out,key=key,reverse=True)

def search_one(q, source, url):
    out=[]; errs=[]
    for offset in (0,100):
        try:
            hits=parse_hits(fetch(url,q,offset))
            for ad in hits:
                j=normalize(ad,source)
                if j: out.append(j)
            if len(hits)<100: break
        except Exception as e:
            errs.append(f"{source}:{q}:{offset}:{type(e).__name__}")
            break
    return out,errs

def main():
    jobs=[]; errors=[]
    tasks=[(q,source,url) for q in ENGINEERING+HR for source,url in SOURCES]
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs=[ex.submit(search_one,*t) for t in tasks]
        for fut in as_completed(futs):
            try:
                j,e=fut.result(); jobs.extend(j); errors.extend(e)
            except Exception as e:
                errors.append("worker:"+type(e).__name__)
    jobs=dedupe(jobs)
    payload={"generated_at":datetime.now(timezone.utc).isoformat(),"count":len(jobs),"errors":errors[:50],"jobs":jobs}
    with open("jobs.json","w",encoding="utf-8") as f:
        json.dump(payload,f,ensure_ascii=False,separators=(",",":"))
    print(f"Generated {len(jobs)} jobs; {len(errors)} query errors")

if __name__=="__main__":
    main()
