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

- The page-header **Map destinations** button runs a single mapping queue with completed-destination progress inside the button. The page automatically checks once every 24 hours while open (or when reopened after that interval), with the last attempt saved locally. Opening maps or backup-order popups subscribes to that queue; it does not start another lookup.
- Each pass imports the shared dictionary in one authenticated, read-only request, then geocodes only destinations without a cached result. Successful coordinates persist locally and in private Blob. Automatic daily checks skip previously unresolved destinations; a manual run can retry them after their 24-hour cooldown. This avoids spending credits repeatedly on ambiguous source data. Existing offline coordinates remain available throughout failures and quota limits. Multiple tabs on the same origin coordinate through Web Locks; conditional server reservations protect the shared budget across devices.
- Queries include city, STO/state and country. Country codes handle provider naming variants such as South Korea / Republic of Korea.
- Vercel's Production, Preview and Development environments use `RAKE_GEOCODERS=photon,geoapify`, in that order, with `GEOCODING_FREE_PLAN=1`. Photon is keyless; Geoapify requires `GEOAPIFY_API_KEY`. The private `BLOB_READ_WRITE_TOKEN` remains required for shared cache and budgets. `RAKE_GEOCODERS=off` disables online lookups without a code change. The older `RAKE_GEOCODER` selector is retained when the chain setting is absent and identifies the owner of legacy usage counters (Photon in this deployment).
- Each provider has a separate, shared limit of 100 attempted lookups/day and 200/month. These are conservative app limits, not the providers' advertised allowances. Existing Photon spending is migrated without resetting it. Providers are attempted serially: exhausted allowances, HTTP failures, malformed responses and timeouts move to the next configured provider. A successful response with an ambiguous or missing destination is cached for review and does not spend additional providers' credits. HTTP 429/402 pauses the provider until the next UTC day unless it supplies Retry-After; authentication failures pause it for 24 hours, other failures for 15 minutes. Retry-After is respected. Missing keys are skipped without calls.
- An optional third provider, Maps.co, is implemented but not enabled in Vercel. To enable it, create a free account, add `GEOCODE_MAPS_CO_API_KEY` and append `,mapsco` to `RAKE_GEOCODERS`. It also requires `GEOCODING_FREE_PLAN=1`. No paid plan or billing upgrade is configured. Geoapify's free plan permits commercial production use with attribution; Maps.co permits use and storage of geocoded results. Public Nominatim is not used for this automated fallback queue because of its periodic/bulk-use and single-machine restrictions; Open-Meteo's hosted free API is for non-commercial use.
- Cache limit: 5,000 destinations, with at least two seconds between new lookups. Each upstream attempt is reserved with a conditional Blob write before making the request; the chain holds a shared lease across providers. Cooldowns are durable across devices. Failed reservations never call a provider. All providers exhausted or unavailable retains cached/offline behaviour. Negative lookups expire after 24 hours. City matches require the exact normalized city, country and subdivision, valid coordinates and an unambiguous result. Geoapify additionally requires confidence of at least 0.9. Only place names are sent, not order or customer details.
- Shared-cache reads bypass the private Blob CDN with `cache=0`, the origin-read option used by Vercel's SDK. This ensures reservation and result writes use the current ETag; a random query string or fetch `no-store` alone does not bypass that CDN. `Accept-Encoding: identity` preserves a strong object ETag: compressed responses carry a weak ETag and fail conditional writes as the cache grows. Weak/missing ETags fail closed. Conditional writes and quota counters remain intact. See [Vercel Blob get implementation](https://github.com/vercel/storage/blob/main/packages/blob/src/get.ts).
- Location status appears in the Total EBTP orders table: Online cached, Offline fallback, or Unmapped. Unknown export countries remain unresolved rather than being queried as India.

Provider references: [Photon usage terms](https://github.com/komoot/photon#demo-server), [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [Geoapify geocoding documentation](https://apidocs.geoapify.com/docs/geocoding/), [Geoapify free-plan terms](https://www.geoapify.com/pricing/), [Maps.co API](https://geocode.maps.co/docs/), [Maps.co terms](https://geocode.maps.co/terms/), [public Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/). Photon permits reasonable usage but provides no availability guarantee; offline mapping is retained. Storage concurrency: [Vercel Blob conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk). Provider caps do not measure other applications using the same API key or unrelated Vercel Blob usage; use dedicated keys and retain Vercel's free-plan limits.
