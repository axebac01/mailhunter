# Lista över fabricerade kontakter — Bisdata: Generationsskifte rensad

## Vad granskningen visar (verifierat mot databasen)

Av jobbets **2 885 personrader** är dessa påhittade eller obevisliga:

| Kategori | Antal | Vad det är |
|---|---|---|
| **Fabricerat namn** | 1 376 | Namnet hittades på från mejladressen (t.ex. `peter.diedriksson@wikibox.se` → "Peter Diedriksson"). Adressen är publicerad och troligen äkta, men personnamnet är uppfunnet. Värst: `poland.office@…` → "Poland Office", `quoteglobal.lam@…` → "Quoteglobal Lam". |
| **Gissad mejl** | 38 | Äkta person (namn+roll hittad på sidan), men adressen gissades höra till personen utan belägg. |
| **Hallucinerad adress** | 209 | AI-extraherad adress vars domän inte ens tillhör bolaget — garanterat påhittad. |
| **Overifierbar** | 832 | AI-extraherad adress på rätt domän, men vi kan inte i efterhand bevisa att den stod på sidan (sidinnehållet sparas inte). En okänd andel kan vara hallucinerad. |
| Har ingen mejl alls | 430 | Äkta personer utan adress — inget att ta bort ur sekvensen. |

## Leverans: en CSV att rensa sekvensen mot

Jag genererar en nedladdningsbar CSV med **alla 2 885 rader** från jobbet:

- Kolumner: `company, website, full_name, email, email_confidence, kategori, rekommendation`
- `kategori` = en av: `fabricerat_namn`, `gissad_mejl`, `hallucinerad_adress`, `overifierad`, `utan_mejl`
- `rekommendation` = `ta_bort` (1 376 + 38 + 209 = **1 623 rader**) / `granska` (832) / `behåll`

Så kan du filtrera på "ta_bort" i Excel/Sheets och plocka bort exakt de adresserna ur mejlsekvensen.

## Valfritt steg 2 — städa databasen för samma jobb

Efter att du rensat sekvensen: radera/markera de 1 623 fabricerade raderna i databasen (adresserna från "fabricerat namn" behålls som namnlösa företagskontakter, enligt tidigare beslut), så att de inte följer med i framtida exporter.

## Tekniska detaljer

- Läsning av `contact_people` + `companies` för jobb `8408025b-a81f-4577-b7dc-fac7694d5184`, skrivning till `/mnt/documents/`.
- Ingen förändring av scraper eller andra jobb i denna uppgift (det täcks av den redan pågående städplanen).
