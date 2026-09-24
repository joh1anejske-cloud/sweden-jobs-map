#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://blocket-api.se/v1/search/car"

def get_page(page):
    params = urlencode({"sort_order":"PUBLISHED_DESC","page":page})
    req = Request(API+"?"+params, headers={"Accept":"application/json","User-Agent":"SwedenMap/1.0"})
    with urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    docs=[]
    total=0
    errors=[]
    for page in range(1,6):
        try:
            data=get_page(page)
            if page==1:
                total=int(data.get("total") or 0)
            batch=data.get("docs") or []
            if not isinstance(batch,list) or not batch:
                break
            docs.extend(batch)
            if len(docs)>=total and total:
                break
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            break
    payload={
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "source":"BlocketAPI",
        "total":total,
        "count":len(docs),
        "errors":errors,
        "docs":docs
    }
    with open("cars_latest.json","w",encoding="utf-8") as f:
        json.dump(payload,f,ensure_ascii=False,separators=(",",":"))
    print(f"Generated {len(docs)} recent car listings; total={total}; errors={len(errors)}")
    for e in errors[:5]:
        print("ERROR",e)

if __name__=="__main__":
    main()
