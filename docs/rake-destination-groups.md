# Rake destination grouping and mapping review

Prepared 21 November 2026 from the current EBTP LIVE sheet and geographical references. This is a country grouping, not a confirmation that a shipping route is available.

## EURO — Europe region

Use the UN M49 Europe grouping, rather than European Union membership:

Albania, Andorra, Austria, Belarus, Belgium, Bosnia and Herzegovina, Bulgaria, Croatia, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Holy See (Vatican City), Hungary, Iceland, Ireland, Italy, Latvia, Liechtenstein, Lithuania, Luxembourg, Malta, Moldova, Monaco, Montenegro, Netherlands, North Macedonia, Norway, Poland, Portugal, Romania, Russia, San Marino, Serbia, Slovakia, Slovenia, Spain, Sweden, Switzerland, Ukraine, United Kingdom.

Source: [UN Statistics Division M49](https://unstats.un.org/unsd/methodology/m49/overview), [UN geographical subregions map](https://www.un.org/geospatial/sites/default/files/files/documents/2023/Mar/4634.2_m49subregions.pdf). Territories and any company-specific exceptions need explicit mapping.

Current LIVE STO aliases implemented:

| STO | Country | Group |
| --- | --- | --- |
| Jura | Switzerland | EURO |
| Nrth Rhine Westfalia; Germany | Germany | EURO |
| Cheshire; Londonderry | United Kingdom | EURO |
| South Denmark | Denmark | EURO |
| Praha | Czechia | EURO |
| HARJU | Estonia | EURO |
| Aust-Agder County | Norway | EURO |

## Middle East

Unlike Europe under M49, “Middle East” has no single universal boundary. The implemented geographical planning list is Bahrain, Cyprus, Egypt, Iran, Iraq, Israel, Jordan, Kuwait, Lebanon, Oman, Palestine, Qatar, Saudi Arabia, Syria, Türkiye, United Arab Emirates, Yemen. This follows the common geographical Middle East definition, including Türkiye and Cyprus; it does not extend to all of MENA or the Caucasus.

References: [UN Middle East map](https://www.un.org/geospatial/sites/default/files/files/documents/2020/Apr/middle_east_4102r05_nov11_110.pdf), [University of Illinois Cyprus geography sheet](https://csames.illinois.edu/system/files/2020-12/Cyprus_Info_Sheet.pdf), [UN M49 Western Asia classification](https://unstats.un.org/unsd/methodology/m49/overview). The planning list is not represented as the UN Western Asia list.

Current LIVE data has Oman and Dubai (United Arab Emirates); both are implemented as Middle East. All listed country names are recognized when provided directly in STO or a country field. Unknown subdivisions still need a country alias; no country is guessed from an ambiguous city.

## Other export countries and Export Road

Current aliases: Ontario → Canada; Arizona → United States; Tokyo → Japan; Inch´on-jikhalsi and Soul-t´ukpyolsi → South Korea; Santa Catarina → Brazil. These groups display the country name.

Kathmandu → Nepal and Samtse → Bhutan are implemented as Export Road. A known foreign STO is used even when Customer TYPE is not marked Export.

The implemented geographic land-neighbour list is Afghanistan, Bangladesh, Bhutan, China, Myanmar, Nepal and Pakistan ([Indian Ministry of Home Affairs](https://www.mha.gov.in/border-management-i-division)). Export Road is a geographic planning category; actual border/route availability is a separate planning check. Sri Lanka and Maldives are maritime neighbours and are not automatically road destinations.

## Rows needing source review

- Jura / Lugano identifies Switzerland, but Lugano is in Ticino, not Jura. Country grouping is possible; a precise state-qualified lookup may fail. [Ticino official municipality list](https://www4.ti.ch/fileadmin/DFE/DE-UCR/download/Comuni_Sezioni_IdentAN.pdf).
- Kathmandu / Birgunj and Londonderry / London contain conflicting city/subdivision pairs. Do not silently replace the source subdivision.
- Export rows with Odisha / Paradip or Jakhapura identify an Indian port or domestic location, not the final export country. They remain “Export — country unresolved”.
- City values such as EURO, Canada, Oman, Arizona and ODHISHA are regions/countries/states, not precise destination cities. No invented city coordinates are assigned.
- Typographical names require review when an online provider cannot return an unambiguous match. Whitespace and trailing punctuation are cleaned automatically.

## Online mapping behaviour

- Known coordinates retain the offline fallback. Missing locations are looked up automatically when an authenticated mapping status check confirms the provider is configured. The manual button can refresh destinations lacking an online cached coordinate.
- Queries include city, STO/state and country. Country codes handle provider naming variants such as South Korea / Republic of Korea.
- Photon is the default free, keyless provider. It uses OpenStreetMap data. The existing private `BLOB_READ_WRITE_TOKEN` is required for shared cache and budgets. No new geocoding account or paid API is needed. Optional Geoapify requires both `GEOAPIFY_API_KEY` and `GEOCODING_FREE_PLAN=1`; otherwise it is never called. `RAKE_GEOCODER` can explicitly select `photon`, `geoapify`, or `off`.
- Shared limits: 100 attempted lookups/day, 200/month, 5,000 cached destinations, at least two seconds between new lookups. Credits are reserved with a conditional Blob write before calling the provider. A failed reservation, exhausted budget or unavailable provider retains offline behaviour. Negative lookups expire after 24 hours. Photon matches must have the exact normalized city name, country and subdivision; ambiguous matches stay unresolved.
- Location status appears in the Total EBTP orders table: Online cached, Offline fallback, or Unmapped. Unknown export countries remain unresolved rather than being queried as India.

Provider references: [Photon usage terms](https://github.com/komoot/photon#demo-server), [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [Geoapify geocoding documentation](https://apidocs.geoapify.com/docs/geocoding/). Photon permits reasonable usage but provides no availability guarantee; offline mapping is retained. Storage concurrency: [Vercel Blob conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk).
