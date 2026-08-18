# Korrigerad rensningslista — adressnivå istället för radnivå

## Felet (verifierat)

Rensningsfilen `bisdata-generationsskifte-att-ta-bort.csv` byggdes per databasrad. När samma mejladress fanns på både en fabricerad rad (t.ex. `matched_high`-dubblett) och en äkta extraherad rad (`extracted` på rätt domän) åkte adressen med i borttagningslistan via den fabricerade raden — trots att adressen faktiskt var publicerad. Exempel: `ewa.einerth@furuhojden.se` (VD, hittad på furuhojden.se/om-oss).

Omfattning: **60 av 1 588 unika adresser** i filen har en äkta extracted-rad och ska inte rensas bort.

## Fix

Generera `exports/bisdata-generationsskifte-att-ta-bort-v2.csv` ur den befintliga fulla granskningsfilen med regeln:

- En adress tas bara med om **alla** rader med den adressen är fabricerade/gissade/hallucinerade.
- Finns minst en `extracted`-rad på rätt domän (kategori `overifierad`) för samma adress → adressen stannar kvar i sekvensen.
- Deduplicera på adress (lowercase) — en rad per adress, så verktyget kan matcha rent.

Resultat (verifierade siffror): **1 528 unika adresser** att ta bort (istället för 1 588). Kolumner: `email, company, website, full_name, kategori`.

## Bonus: lista över de räddade adresserna

Generera även `exports/bisdata-generationsskifte-raddade-adresser.csv` med de 60 adresserna som togs bort från rensningslistan (email, company, full_name, role, source) — så du kan kontrollera dem själv och vara säker på att de ligger kvar i sekvensen.

## Tekniska detaljer

- Källa: `/mnt/documents/exports/bisdata-generationsskifte-rensad-fabricerade.csv` (2 921 rader, redan verifierad mot databasen). Ingen ny databasläsning behövs.
- Två nya filer skrivs till `/mnt/documents/exports/` och presenteras som artefakter. Inga ändringar i databas eller kod.
- Kommande databasstädning (steg 2 från tidigare plan) använder samma adressnivå-regel: en fabricerad rad raderas bara om adressen saknar äkta extracted-rad; annars raderas dubbletten men adressen behålls.
