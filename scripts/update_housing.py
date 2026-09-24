#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen

QASA_GRAPHQL_URL = "https://api.qasa.se/graphql"
PAGE_SIZE = 200
MAX_LISTINGS = 5000

QUERY = """
query HomeSearch($order: HomeIndexSearchOrderInput, $offset: Int, $limit: Int, $params: HomeSearchParamsInput) {
  homeIndexSearch(order: $order, params: $params) {
    documents(offset: $offset, limit: $limit) {
      hasNextPage
      totalCount
      nodes {
        id
        title
        description
        firstHand
        furnished
        homeType
        householdSize
        bedroomCount
        monthlyCost
        rent
        roomCount
        shared
        squareMeters
        startDate
        endDate
        studentHome
        seniorHome
        tenantBaseFee
        petsAllowed
        smokingAllowed
        wheelchairAccessible
        publishedAt
        publishedOrBumpedAt
        location {
          locality
          route
          streetNumber
          point { lat lon }
        }
        uploads { order type url }
      }
    }
  }
}
""".strip()

HEADERS = {
    "Accept": "*/*",
    "Content-Type": "application/json",
    "Origin": "https://qasa.com",
    "Referer": "https://qasa.com/",
    "User-Agent": "Mozilla/5.0 SwedenMap/1.0",
}

def post(offset):
    payload = {
        "operationName": "HomeSearch",
        "query": QUERY,
        "variables": {
            "offset": offset,
            "limit": PAGE_SIZE,
            "order": {"direction": "descending", "orderBy": "published_or_bumped_at"},
            "params": {"currency": "SEK", "markets": ["sweden"]},
        },
    }
    req = Request(
        QASA_GRAPHQL_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=HEADERS,
        method="POST",
    )
    with urlopen(req, timeout=35) as response:
        data = json.loads(response.read().decode("utf-8"))
    if data.get("errors"):
        raise RuntimeError("; ".join(str(x.get("message", x)) for x in data["errors"]))
    return data["data"]["homeIndexSearch"]["documents"]

def first_image(uploads):
    if not isinstance(uploads, list):
        return ""
    images = [u for u in uploads if isinstance(u, dict) and u.get("url") and str(u.get("type","")).lower() in ("image","photo","")]
    if not images:
        images = [u for u in uploads if isinstance(u, dict) and u.get("url")]
    images.sort(key=lambda x: x.get("order", 0) if isinstance(x.get("order",0), (int,float)) else 0)
    return images[0].get("url","") if images else ""

def normalize(n):
    loc = n.get("location") if isinstance(n.get("location"), dict) else {}
    point = loc.get("point") if isinstance(loc.get("point"), dict) else {}
    lat, lon = point.get("lat"), point.get("lon")
    coords = None
    try:
        lat, lon = float(lat), float(lon)
        if 54 <= lat <= 70 and 10 <= lon <= 25:
            coords = [lat, lon]
    except (TypeError, ValueError):
        pass

    ident = str(n.get("id",""))
    rent = n.get("rent")
    monthly = n.get("monthlyCost")
    if monthly in (None, ""):
        try:
            monthly = float(rent or 0) + float(n.get("tenantBaseFee") or 0)
        except (TypeError, ValueError):
            monthly = rent

    return {
        "id": ident,
        "source": "Qasa",
        "title": n.get("title") or "Logement",
        "description": n.get("description") or "",
        "home_type": n.get("homeType") or "",
        "rent": rent,
        "monthly_cost": monthly,
        "rooms": n.get("roomCount"),
        "bedrooms": n.get("bedroomCount"),
        "sqm": n.get("squareMeters"),
        "furnished": n.get("furnished"),
        "shared": n.get("shared"),
        "first_hand": n.get("firstHand"),
        "student": n.get("studentHome"),
        "senior": n.get("seniorHome"),
        "pets_allowed": n.get("petsAllowed"),
        "smoking_allowed": n.get("smokingAllowed"),
        "wheelchair": n.get("wheelchairAccessible"),
        "household_size": n.get("householdSize"),
        "start_date": n.get("startDate") or "",
        "end_date": n.get("endDate") or "",
        "published": n.get("publishedAt") or "",
        "updated": n.get("publishedOrBumpedAt") or n.get("publishedAt") or "",
        "locality": loc.get("locality") or "",
        "route": loc.get("route") or "",
        "street_number": loc.get("streetNumber") or "",
        "coords": coords,
        "image": first_image(n.get("uploads")),
        "url": f"https://qasa.com/se/en/home/{ident}" if ident else "https://qasa.com/se/en",
    }

def main():
    offset = 0
    homes = []
    seen = set()
    total = None
    errors = []

    while len(homes) < MAX_LISTINGS:
        try:
            docs = post(offset)
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            break

        if total is None:
            total = docs.get("totalCount")
        nodes = docs.get("nodes") or []
        if not nodes:
            break

        for node in nodes:
            if not isinstance(node, dict):
                continue
            ident = str(node.get("id",""))
            if ident and ident in seen:
                continue
            if ident:
                seen.add(ident)
            homes.append(normalize(node))
            if len(homes) >= MAX_LISTINGS:
                break

        if docs.get("hasNextPage") is not True or len(homes) >= MAX_LISTINGS:
            break
        offset += PAGE_SIZE

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Qasa",
        "source_url": "https://qasa.com/se/en",
        "count": len(homes),
        "reported_total": total,
        "capped": bool(total and len(homes) < total),
        "errors": errors,
        "homes": homes,
    }
    with open("housing.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Generated {len(homes)} housing listings; reported_total={total}; errors={len(errors)}")
    for e in errors[:5]:
        print("ERROR", e)

if __name__ == "__main__":
    main()
