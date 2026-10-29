# Utposten, prototyp fas 1.1

En första spelbar prototyp av spelprojektet: tower defense mot zombier i ett öppet landskap. Grafiken är medvetet enkel. Prototypen ska bara svara på en fråga: känns vägval, hinder och ljud rätt?

## Starta spelet

Spelet består av vanliga webbfiler, men det använder JavaScript-moduler och måste därför köras via en webbserver. Att dubbelklicka på `index.html` fungerar inte.

Det enklaste är att lägga mappen i ett nytt GitHub-repo och koppla det till Netlify, på samma sätt som dina andra verktyg. Netlify behöver ingen byggkonfiguration: publiceringsmappen är roten.

Vill du testa lokalt på en Mac kan du öppna Terminal i mappen och skriva `python3 -m http.server`, och sedan gå till `http://localhost:8000` i webbläsaren.

Three.js hämtas från jsDelivr när sidan laddas, så datorn behöver vara uppkopplad.

## Så spelar du

| Gör så här | Effekt |
|---|---|
| Klicka på ett verktyg eller tryck 1 till 5 | Välj dike, värn, pålar, armborst eller gevär |
| R / X | Reparera / riv |
| Klicka på kartan | Bygg eller använd verktyget |
| Högerklick eller Esc | Avmarkera verktyget |
| Mellanslag eller "Starta runda" | Starta nästa anfall |
| "Hastighet" | Växla mellan 1x, 2x och 4x |
| V eller "Vy" | Växla mellan vinklad vy och rak vy ovanifrån |
| Mushjulet | Zooma i den vinklade vyn |
| "Visa vägval för" | Visar pilar för hur en zombietyp tar sig till lägret |

Zombierna kommer från vänsterkanten (den rödtonade remsan) och går mot lägret till höger. Varje zombie har en vittring: en människa inom radien blir zombiens mål i stället för lägret (vandrare 2 rutor, koloss 3, löpare 4). Skottljud lockar på längre avstånd, för geväret 9 rutor. Varje zombie som når lägret tar av förrådet, och när förrådet är slut är spelet förlorat. Det finns fem rundor.

Under en runda går det inte att köpa eller ändra något. Mellan rundorna får du 100 poäng plus en bonus på upp till 30 poäng beroende på hur mycket av förrådet som finns kvar. Allt som överlever rundan följer med utan ny kostnad.

## Saker att testa

1. Sätt en rad värn tvärs över kartan med en lucka. Välj "Vandrare" under "Visa vägval för" och se pilarna gå genom luckan. Byt till "Koloss" och se pilarna gå rakt mot värnen.
2. Ställ ett armborst precis intill zombiernas väg och ett annat en bit bort. Det nära blir anfallet, det avlägsna lämnas i fred.
3. Ställ en gevärsskytt mitt på kartan. Den orange ringen visar hur långt skotten hörs. Zombier inom ringen lämnar sin väg och går på skytten.
4. Jämför med ett armborst på samma plats. Det är nästan tyst och drar inte till sig horden.
5. Lägg pålar i en trång passage och se dem slitas ner.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Sidan och dess layout |
| `css/style.css` | Utseende för gränssnittet |
| `js/config.js` | All balansdata: kostnader, hälsa, fart, vågor. Ändra siffror här |
| `js/map.js` | Kartan och terrängen |
| `js/flowfield.js` | Vägvalen (flödesfält med Dijkstras algoritm) |
| `js/game.js` | Spelreglerna, utan grafik |
| `js/view.js` | Grafiken i Three.js |
| `js/ui.js` | Knappar, panel och meddelanden |
| `js/main.js` | Kopplar ihop delarna och styr musen |
| `test/simulate.mjs` | Automatiska test av spellogiken (`node test/simulate.mjs`) |
| `test/balance.mjs` | Kör tre försvarsupplägg många gånger och mäter förluster per runda (`node test/balance.mjs`) |

## Kända begränsningar

Siktlinjer, höjdskillnader, kastare, klättrare, pansrade zombier, fler försvarare, målprioritering och miniatyrlooken kommer i senare faser enligt designdokumentet.

Tilt-shift laddas separat. Om den inte går att hämta körs spelet vidare utan effekten, och en varning syns i webbläsarens konsol.

Balansen är fortfarande grov. En tät ring av armborst kring lägret vinner nästan alltid, och oanvända poäng sparas utan gräns.
