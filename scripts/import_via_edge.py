#!/usr/bin/env python3
"""
Importerar de tre CSV-filerna från /tmp/se_import till Lovable Cloud
via edge-funktionen `ingest-se-data`.

Krav (env):
  SE_IMPORT_TOKEN  - samma värde som secret SE_IMPORT_TOKEN i Lovable Cloud
  SUPABASE_URL     - default: https://yinahywakjfgqoswqbgm.supabase.co
  ANON_KEY         - default: hårdkodad publishable key nedan
  CSV_DIR          - default: /tmp/se_import

Användning:
  export SE_IMPORT_TOKEN="..."
  python3 scripts/import_via_edge.py
  # eller bara en del:
  python3 scripts/import_via_edge.py companies
  python3 scripts/import_via_edge.py bokslut board
"""
import csv, json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

SUPA_URL = os.environ.get("SUPABASE_URL", "https://yinahywakjfgqoswqbgm.supabase.co")
ANON = os.environ.get(
    "ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmFoeXdha2pmZ3Fvc3dxYmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MDU1MzYsImV4cCI6MjA5MTk4MTUzNn0.OmfmXU6_QiI6IVCFJRdwkHni5IiU-nXIulQjbFnvI-M",
)
TOKEN = os.environ.get("SE_IMPORT_TOKEN")
CSV_DIR = Path(os.environ.get("CSV_DIR", "/tmp/se_import"))
ENDPOINT = f"{SUPA_URL}/functions/v1/ingest-se-data"
BATCH = int(os.environ.get("BATCH", "1000"))

if not TOKEN:
    print("FEL: SE_IMPORT_TOKEN saknas i miljön. Sätt: export SE_IMPORT_TOKEN=...")
    sys.exit(1)

csv.field_size_limit(sys.maxsize)

def post(kind: str, rows: list) -> dict:
    payload = json.dumps({"kind": kind, "rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT, data=payload, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ANON}",
            "apikey": ANON,
            "x-import-token": TOKEN,
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:500]
            if e.code in (429, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt); continue
            raise RuntimeError(f"HTTP {e.code}: {body}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 4:
                time.sleep(2 ** attempt); continue
            raise

def to_int(v):
    if v in ("", None): return None
    try: return int(v)
    except: return None

def to_bigint(v):
    return to_int(v)

ROW_TRANSFORMERS = {
    "companies": lambda r: {
        "org_nr": r["org_nr"],
        "name": r.get("name") or "(okänt)",
        "street_address": r.get("street_address") or None,
        "postal_code": r.get("postal_code") or None,
        "postal_city": r.get("postal_city") or None,
        "phone": r.get("phone") or None,
        "sni_code": r.get("sni_code") or None,
        "sni_text": r.get("sni_text") or None,
        "municipality": r.get("municipality") or None,
        "county": r.get("county") or None,
        "description": r.get("description") or None,
        "revenue_interval": r.get("revenue_interval") or None,
        "raw": json.loads(r["raw"]) if r.get("raw") else None,
    },
    "bokslut": lambda r: {
        "org_nr": r["org_nr"],
        "revenue_ksek": to_bigint(r.get("revenue_ksek")),
        "employees": to_int(r.get("employees")),
        "fiscal_year": to_int(r.get("fiscal_year")),
    },
    "board": lambda r: {
        "org_nr": r["org_nr"],
        "name": r["name"],
        "role": r.get("role") or None,
        "person_nr": r.get("person_nr") or None,
        "appointed_at": r.get("appointed_at") or "",
    },
}

FILES = {
    "companies": "se_companies_base.csv",
    "bokslut":   "se_bokslut_latest.csv",
    "board":     "se_board.csv",
}

def import_kind(kind: str):
    fp = CSV_DIR / FILES[kind]
    if not fp.exists():
        print(f"  SKIPPAR {kind}: {fp} saknas"); return
    transform = ROW_TRANSFORMERS[kind]
    total = sum(1 for _ in open(fp, encoding="utf-8")) - 1
    print(f"\n=== {kind}: {fp.name} ({total:,} rader) ===")
    t0 = time.time()
    sent = affected = 0
    batch = []
    with open(fp, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            try:
                batch.append(transform(row))
            except Exception as e:
                print(f"  SKIP rad: {e}"); continue
            if len(batch) >= BATCH:
                res = post(kind, batch)
                affected += res.get("affected", 0)
                sent += len(batch); batch = []
                rate = sent / max(time.time() - t0, 0.01)
                eta = (total - sent) / max(rate, 1)
                print(f"  {sent:>10,}/{total:,}  {rate:>6.0f} r/s  ETA {eta/60:5.1f} min", end="\r")
    if batch:
        res = post(kind, batch)
        affected += res.get("affected", 0)
        sent += len(batch)
    dt = time.time() - t0
    print(f"\n  KLART {kind}: {sent:,} skickade, {affected:,} affected, {dt/60:.1f} min")

if __name__ == "__main__":
    kinds = sys.argv[1:] or ["companies", "bokslut", "board"]
    for k in kinds:
        if k not in FILES:
            print(f"Okänd kind: {k}"); sys.exit(1)
        import_kind(k)
    print("\nAlla importer klara.")
