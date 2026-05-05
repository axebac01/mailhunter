#!/usr/bin/env python3
"""
Konverterar Bolagsverkets MySQL-dumpar (grunduppgifter, bokslutsuppgifter, styrelse)
till tre CSV-filer som kan importeras med psql \\copy.

Streamar rad-för-rad — funkar även för 1.75 GB-filen utan att fylla minnet,
förutom bokslut där vi håller en dict OrgNr -> senaste bokslut (~1.2 M entries).

Användning:
    python3 convert_dumps.py /Users/axel/Downloads/SCB_2.0/Företagsdata
"""
import sys, os, csv, json, re, io
from pathlib import Path

DUMP_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else ".").expanduser()
OUT_DIR = Path("/tmp/se_import")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------- MySQL dump-parser ----------

INSERT_RE = re.compile(r"^INSERT INTO `([^`]+)`\s*(?:\(([^)]*)\))?\s*VALUES\s*", re.IGNORECASE)

def parse_values(s: str):
    """Parsa MySQL VALUES-tuples. Returnerar lista av tuples (list of strings/None)."""
    rows, cur, i, n = [], [], 0, len(s)
    while i < n:
        # hitta '('
        while i < n and s[i] != "(":
            i += 1
        if i >= n: break
        i += 1
        cur = []
        # parsa fält
        while i < n:
            c = s[i]
            if c == "'":
                # string literal
                i += 1
                start = i
                buf = []
                while i < n:
                    if s[i] == "\\" and i + 1 < n:
                        nxt = s[i+1]
                        buf.append({"n":"\n","t":"\t","r":"\r","0":"\0","\\":"\\","'":"'",'"':'"',"Z":"\x1a","b":"\b"}.get(nxt, nxt))
                        i += 2
                    elif s[i] == "'":
                        # could be end or escaped ''
                        if i + 1 < n and s[i+1] == "'":
                            buf.append("'"); i += 2
                        else:
                            i += 1
                            break
                    else:
                        buf.append(s[i]); i += 1
                cur.append("".join(buf))
            elif c == "N" and s[i:i+4] == "NULL":
                cur.append(None); i += 4
            elif c in " \t":
                i += 1
            elif c == ",":
                i += 1
            elif c == ")":
                i += 1
                rows.append(cur)
                break
            else:
                # number / unquoted token
                start = i
                while i < n and s[i] not in ",)":
                    i += 1
                cur.append(s[start:i].strip())
        # skip until comma or ;
        while i < n and s[i] in " ,;\n\r\t":
            i += 1
    return rows

def stream_inserts(filepath: Path, want_table: str):
    """Yield (col_names_or_None, row_values) för varje rad i alla INSERT INTO `want_table` ... VALUES ..."""
    cols = None
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        buf = ""
        for line in f:
            if not buf and not line.lstrip().upper().startswith("INSERT INTO"):
                continue
            buf += line
            # En INSERT slutar med ");\n"
            if buf.rstrip().endswith(";"):
                m = INSERT_RE.match(buf)
                if m and m.group(1) == want_table:
                    col_str = m.group(2)
                    these_cols = None
                    if col_str:
                        these_cols = [c.strip().strip("`") for c in col_str.split(",")]
                    rest = buf[m.end():]
                    # ta bort trailing ";"
                    rest = rest.rstrip().rstrip(";")
                    for row in parse_values(rest):
                        yield these_cols, row
                buf = ""

def get_create_table_columns(filepath: Path, table: str):
    """Plocka kolumn-ordning från CREATE TABLE."""
    cols = []
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        in_ct = False
        for line in f:
            if not in_ct:
                if re.match(rf"^CREATE TABLE `{re.escape(table)}`", line, re.IGNORECASE):
                    in_ct = True
                continue
            line_s = line.strip()
            if line_s.startswith("`"):
                end = line_s.find("`", 1)
                cols.append(line_s[1:end])
            elif line_s.startswith(")") or line_s.startswith("PRIMARY") or line_s.startswith("KEY") or line_s.startswith("UNIQUE"):
                if line_s.startswith(")"):
                    break
    return cols

# ---------- Hjälpfunktioner ----------

def to_int(v):
    if v is None or v == "": return None
    try: return int(float(v))
    except: return None

def clean(v):
    if v is None: return None
    s = str(v).strip()
    return s if s else None

# ---------- 1. grunduppgifter -> se_companies_base.csv ----------

def convert_grunduppgifter():
    src = DUMP_DIR / "grunduppgifter.sql"
    out = OUT_DIR / "se_companies_base.csv"
    print(f"[1/3] grunduppgifter: {src} -> {out}")
    cols = get_create_table_columns(src, "grunduppgifter")
    print(f"      {len(cols)} kolumner i CREATE TABLE")

    mapped = {
        "OrgNr": "org_nr",
        "Företagsnamn": "name",
        "Postadress": "street_address",
        "Postnummer": "postal_code",
        "Postort": "postal_city",
        "Telefon": "phone",
        "Huvud SNI-kod": "sni_code",
        "Huvud SNI-text": "sni_text",
        "Kommun besöksadress": "municipality",
        "Län besöksadress": "county",
        "Bolagsordning_Korrekt": "description",
        "Omsättningsintervall": "revenue_interval",
    }
    raw_keep = [c for c in cols if c not in mapped and c != "OrgNr"]

    n = 0
    with open(out, "w", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["org_nr","name","street_address","postal_code","postal_city","phone","sni_code","sni_text","municipality","county","description","revenue_interval","raw"])
        for these_cols, row in stream_inserts(src, "grunduppgifter"):
            use_cols = these_cols or cols
            d = dict(zip(use_cols, row))
            org = clean(d.get("OrgNr"))
            if not org: continue
            raw = {k: d.get(k) for k in raw_keep if d.get(k) not in (None, "")}
            w.writerow([
                org,
                clean(d.get("Företagsnamn")) or "(okänt)",
                clean(d.get("Postadress")),
                clean(d.get("Postnummer")),
                clean(d.get("Postort")),
                clean(d.get("Telefon")),
                clean(d.get("Huvud SNI-kod")),
                clean(d.get("Huvud SNI-text")),
                clean(d.get("Kommun besöksadress")),
                clean(d.get("Län besöksadress")),
                clean(d.get("Bolagsordning_Korrekt")),
                clean(d.get("Omsättningsintervall")),
                json.dumps(raw, ensure_ascii=False) if raw else None,
            ])
            n += 1
            if n % 50000 == 0: print(f"      {n:,} rader…")
    print(f"      KLART: {n:,} bolag")

# ---------- 2. bokslutsuppgifter -> se_bokslut_latest.csv ----------

def convert_bokslut():
    src = DUMP_DIR / "bokslutsuppgifter.sql"
    out = OUT_DIR / "se_bokslut_latest.csv"
    print(f"[2/3] bokslutsuppgifter: {src} -> {out}")
    cols = get_create_table_columns(src, "bokslutsuppgifter")
    print(f"      {len(cols)} kolumner i CREATE TABLE")

    # Vi håller senaste raden per OrgNr i en dict
    latest = {}  # org_nr -> (period_slut, revenue_ksek, employees, fiscal_year)
    n = 0
    for these_cols, row in stream_inserts(src, "bokslutsuppgifter"):
        use_cols = these_cols or cols
        d = dict(zip(use_cols, row))
        org = clean(d.get("OrgNr"))
        if not org: continue
        period = clean(d.get("Bokslutsperiodens slut")) or ""
        if not period: continue
        slutkod = clean(d.get("Slutkod"))
        if slutkod and slutkod != "B": continue  # bara bokslutsdata, inte revisions
        prev = latest.get(org)
        if prev and prev[0] >= period:
            n += 1; continue
        nettoms = to_int(d.get("Nettoomsättning"))
        oms = to_int(d.get("OMSETTNING"))
        rev = nettoms if nettoms not in (None, 0) else oms
        rev_ksek = (rev // 1000) if rev is not None else None
        emp = to_int(d.get("Antal anställda"))
        try: fy = int(period[:4])
        except: fy = None
        latest[org] = (period, rev_ksek, emp, fy)
        n += 1
        if n % 100000 == 0: print(f"      {n:,} bokslut lästa, {len(latest):,} unika bolag…")

    with open(out, "w", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["org_nr","revenue_ksek","employees","fiscal_year"])
        for org, (_, rev, emp, fy) in latest.items():
            w.writerow([org, rev if rev is not None else "", emp if emp is not None else "", fy if fy is not None else ""])
    print(f"      KLART: {len(latest):,} bolag med bokslutsdata")

# ---------- 3. styrelse -> se_board.csv ----------

def convert_styrelse():
    candidates = [DUMP_DIR / "styrelse.sql", DUMP_DIR / "styrelseuppgifter.sql"]
    src = next((p for p in candidates if p.exists()), None)
    if not src:
        print("[3/3] styrelse.sql/styrelseuppgifter.sql saknas — hoppar över")
        return
    table = "styrelse"
    out = OUT_DIR / "se_board.csv"
    print(f"[3/3] styrelse: {src} -> {out}")
    cols = get_create_table_columns(src, table)
    print(f"      {len(cols)} kolumner")

    n = 0
    with open(out, "w", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["org_nr","name","role","person_nr","appointed_at"])
        for these_cols, row in stream_inserts(src, table):
            use_cols = these_cols or cols
            d = dict(zip(use_cols, row))
            org = clean(d.get("OrgNr"))
            name = clean(d.get("Namn"))
            if not org or not name: continue
            tt = clean(d.get("Tillträdesdatum")) or ""
            # Försök parsa YYYY-MM-DD eller YYYYMMDD
            appointed = ""
            if len(tt) == 10 and tt[4] == "-":
                appointed = tt
            elif len(tt) == 8 and tt.isdigit():
                appointed = f"{tt[:4]}-{tt[4:6]}-{tt[6:8]}"
            w.writerow([org, name, clean(d.get("Funktion")), clean(d.get("Personnr")), appointed])
            n += 1
            if n % 100000 == 0: print(f"      {n:,} ledamöter…")
    print(f"      KLART: {n:,} styrelseposter")

if __name__ == "__main__":
    if not DUMP_DIR.is_dir():
        print(f"FEL: {DUMP_DIR} är inte en mapp"); sys.exit(1)
    convert_grunduppgifter()
    convert_bokslut()
    convert_styrelse()
    print(f"\nAlla CSV-filer ligger i {OUT_DIR}/")
    print("Nästa steg: kör  bash scripts/import_to_cloud.sh")
