# Startup zip pop-up: spec (content-v4)

Jake asked for this: *"have a pop up when you start asking for zip so you know code and frost stuff."*
This is content and spec only. No app code was changed. Data lives in **`jurisdictions.json`**, with the reference logic in `reference/takeoff-reference.mjs` (`resolveJurisdiction()`, `requiredPierDepthIn()`). Facts were checked on 2026-10-28 (America/Denver).

---

## 1. When it shows

- On first launch, when `m.site?.zip` is empty.
- On later launches, only if the user picked "Remind me later", or if `jurisdictions.json` `meta.version` is newer than `m.site.lookupVersion`. In that case, show a one-line "Local info updated, review?" banner instead of the full modal.
- Always reachable later from **Settings → Location** and from the price-check pre-check (card 1, "Location").
- It's a modal, but it doesn't block. "Skip for now" is always there, and skipping goes to the fallback in §5.

## 2. Modal content

**Title:** Where are you building?

**Copy:**
> Enter the ZIP code of the property. We'll use it to fill in your local building code, frost depth (how deep piers must go), snow-load info, sales tax and the nearest Home Depot. You can change any of it later.
> *A ZIP isn't a code boundary. We'll ask you to confirm the county if your ZIP crosses one.*

**Field:** `ZIP code` with `inputmode="numeric"`, `autocomplete="postal-code"`, maxlength 10, placeholder `e.g. 59833`.

**Validation:**
- Trim the value and accept `^\d{5}(-\d{4})?$`. Store only the first 5 digits.
- If invalid, show inline "Enter a 5-digit ZIP code." The Continue button stays disabled.
- The value has to be a key in `jurisdictions.json → zips`. If it isn't, go to §5 (unknown ZIP) instead of showing an error.

**Buttons:** `Continue` (primary) · `Skip for now`.

### 2a. Result card (after Continue, ZIP found)

Show a card with one row per value. Each row gets a **source link** (the URL from the JSON) and a badge: ✅ *verified* or ⚠️ *UNVERIFIED, call*.

| Row | From `jurisdictions.json` | 59833 shows |
|---|---|---|
| Place | `place.name`, `place.type`, `primary_county`, `state` | Florence (unincorporated CDP), Ravalli County, MT. *Not inside any city limits.* |
| **Which county?** (radio, shown only when `jurisdictions.length > 1`) | `jurisdictions[].label` | ◉ Ravalli County, outside city/town limits (default) ○ Missoula County portion (north of County Line Rd) |
| Code | `code.residential` + `edition`, `effective` | 2024 IRC as amended by ARM Title 24 Ch. 301, effective 2026-09-26 (State) |
| Building permit | `residential_building_permit_required` + note | **Not required** by the State for a single-family home outside certified jurisdictions. Electrical permit **is** required (homeowner permit OK). |
| **Frost depth** | `design.frost_depth_in` | **36 in** to bottom of footing for 1-story wood frame (48 in for 2-story or masonry) ✅ |
| Ground snow load | `design.ground_snow_load_psf` | ⚠️ UNVERIFIED, site-specific (ASCE 7 Hazard Tool). Roof minimum 30 psf after reductions ✅ |
| Ice barrier | `design.ice_barrier_required` | Required in Montana ✅ |
| Sales tax | `tax.combined_pct` | **0%**. Montana has no general sales tax, and this isn't a resort-tax area ✅ |
| Nearest Home Depot | `store.name`, `address`, `phone` | Missoula #3102, 2725 Radio Way, (406) 523-0901. *Prices shown are NOT localized to this store.* |
| **Call first** | `call_first` + `other_permits[]` | Montana Building Codes Bureau **(406) 841-2056**, buildingcodes@mt.gov. If you add a bedroom: Ravalli County Environmental Health (406) 375-6565 (septic). Floodplain: Ravalli County Planning (406) 375-6530. |

**Buttons:** `Use these values` (primary) · `Edit` (makes frost depth and tax editable inline) · `Back`.

The footer stays visible: *"These come from public sources checked on {meta.checked_date}. Codes change, and your building official has the final say. Confirm before you dig or buy."*

## 3. What "Use these values" writes

```js
m.site = { zip: '59833', jurisdictionId: 'mt-state-ravalli-unincorporated', lookupVersion: jdoc.meta.version,
           confirmedAt: ISOString, frostSource: 'lookup' | 'user', taxSource: 'lookup' | 'user' };
getLayer(m, 'foundation').params.frostDepthIn = 36;      // design.frost_depth_in.value (verified only)
m.estimate.taxRatePct = null;                            // null = "use the zip lookup" (0 for 59833)
m.estimate.iceBarrier = true;                            // design.ice_barrier_required.value
m.estimate.storeLabel = store.name + ' (prices not localized)';
regenerate(m, 'foundation');                             // piers get re-drawn at the new depth
```

- Only `verified:true` values are written automatically. An unverified value leaves the field `null` and the result row shows "enter it".
- If the user edits frost depth or tax, write their number and set `frostSource` / `taxSource` to `'user'`. The user's value always beats the lookup.
- If the user's frost depth is **less than** the lookup value, show a warning: "That's shallower than the {value} in published for {label}. Keep it?"

## 4. How the values flow into the takeoff

**Pier / footing depth**

```
frostDepthIn         = user value ?? lookup value (verified) ?? null
requiredPierDepthIn  = max(frostDepthIn + frostMarginIn, 12)      // 12 = IRC R403.1.4 min below undisturbed soil
frostMarginIn        = 0 by default
```

- The code itself adds no margin. Footing bottom must be **at or below** frost (IRC R403.1.4.1; MT ARM 24.301.142(9) "minimum depth from finished grade to the bottom of footings"). `frostMarginIn` is an optional user setting, e.g. "dig 3 in extra", and is never presented as code.
- The 2-story / masonry case: when `walls.params.stories > 1` (a proposed field) or the foundation is masonry, use `design.frost_depth_in.multistory_or_masonry_in` (48 in for the Montana state rule).
- The app's `regenerate()` already puts the pier bottom at `-frostDepthIn` and the top at `topAboveGradeIn.piers − gradeBeamDepthIn`. For 59833 that's 36 in deep + 18 in above grade = **54 in piers**, 56 in of tube each.
- The engine checks `pier bottom ≥ requiredPierDepthIn` and **flags** any shortfall. It also flags when the lookup has a frost depth but the model was never updated.
- **Jake's rule is unchanged:** piers go only under wall lines and corners, with the grade beam on those lines, never mid-span. A deeper frost depth makes piers longer. It never adds piers.

**Tax**

- `taxRatePct = m.estimate.taxRatePct (user) ?? zips[zip].tax.combined_pct (verified) ?? unknown`.
- If unknown, tax is priced at 0% **and flagged** "tax rate unknown, enter yours". We never use a made-up rate.
- `totals.taxSource` tells the UI which one was used.

**Other effects**

- `iceBarrier` defaults from `design.ice_barrier_required`.
- If the ground snow load is UNVERIFIED, the engine adds a flag saying the rafter, ridge, header and ceiling-joist sizes are EXAMPLE and weren't checked against the site snow load. It includes the call-first contact.
- Instructions: `frost_note`, the permit paragraph and the "who to call" box come from the chosen jurisdiction (see `instructions.md`).
- Price panel and disclaimer: show `store.name`, plus "prices not localized to this store" while `store.price_localization.status != 'OK'`.

## 5. Fallback: ZIP not in the lookup, or skipped

1. Keep the ZIP (`m.site.zip`) and show: **"We don't have local data for {zip} yet."**
2. Ask for the two values that change the estimate, both optional:
   - **Frost depth (in)**. Helper: "Ask your city or county building department, or your state building codes office."
   - **Sales tax rate (%)**. Helper: "Your combined state + local rate on building materials."
3. If frost depth is left blank:
   - Draw and price the piers at a **conservative 48 in** (`jurisdictions.json → fallback.conservativeFrostDepthIn`). This is a drawing default, not a code value.
   - Keep a red banner on the foundation layer and in the report: "Frost depth unknown. Piers drawn at 48 in as a conservative placeholder. Enter your local value."
   - Set `frostSource: 'fallback'` so the estimate stays FLAGGED.
   - *App note:* today `config.js` has `placeholderFrostIn: 24`. Changing it to the 48 in fallback is an App Builder decision. Until then, the engine flags the 24 in placeholder.
4. If tax is left blank: price at 0% with the flag "Tax not included; enter your rate."
5. Show "Call your building department" with no number, plus a link to search "{zip} building department".
6. **Skip for now** does the same as steps 3–5 and asks again at "I'm done".

## 6. Data schema (`jurisdictions.json`)

`meta.schema` in the file is the authoritative description. In short:

```
zips[zip] = {
  place: { name, type, state, primary_county, other_counties[], inside_city_limits, verified, sources[] },
  jurisdictions[]: {
    id, label, applies_when,
    building_authority: { name, phone, email, url, certified_local_program, verified, sources[] },
    residential_building_permit_required: true | false | 'ask', residential_building_permit_note,
    code: { residential, edition, effective, amended_by, verified, source, note },
    design: { frost_depth_in, ground_snow_load_psf, min_roof_snow_load_psf, ice_barrier_required, wind_mph,
              seismic_design_category, air_freezing_index, climate_zone, ... },   // each: { value, verified, source, note, status }
    other_permits[]: { what, who, verified, source },
    call_first: { name, phone, email, why }
  },
  default_jurisdiction_id,
  tax: { state_sales_tax_pct, local_tax_pct, combined_pct, resort_tax_applies, verified, sources[], note },
  store: { retailer, store_number, name, address, phone, url, verified, sources[], price_localization { possible, status, note } },
  defaults_used_in_takeoff: { jurisdiction_id, frostDepthIn, taxRatePct, iceBarrier, storeLabel }
}
fallback = { frostDepthIn: null, conservativeFrostDepthIn: 48, taxRatePct: null, note }
```

**Rules for adding ZIPs:**
- Every value needs a `source` URL and a `verified` flag.
- Missing means `value: null` + `status: "UNVERIFIED"` + who to call.
- Prefer the official building-department page, or the state's certified-jurisdiction list.
- Add a jurisdiction entry for every county or city the ZIP crosses.

## 7. 59833 summary (seed entry)

| Fact | Value | Verified | Source |
|---|---|---|---|
| Place | Florence, Ravalli County, MT. Unincorporated CDP, so no city limits. Part of the ZIP is in Missoula County. | ✅ | https://en.wikipedia.org/wiki/Florence,_Montana · https://dojmt.gov/wp-content/uploads/2011/05/mvmtcitiescountieszips.pdf · https://www.zip-codes.com/zip-code/59833/zip-code-59833.asp |
| Code authority | State Building Codes Bureau. Ravalli County isn't certified; only Hamilton, Stevensville and Darby are, for their city limits. | ✅ | https://bsd.dli.mt.gov/_docs/building-codes-permits/certified-city.pdf |
| Code edition | 2024 IRC (amended, ARM 24.301), effective 2026-09-26 | ✅ | https://bsd.dli.mt.gov/building-codes-permits/current-codes |
| Building permit, single-family addition | Not required by the State (residential < 5 units exempt) | ✅ | https://bsd.dli.mt.gov/building-codes-permits/permit-applications/building-permits/ · …/building-permit-faq |
| Electrical | State permit required. Homeowner permit allowed for your own home. | ✅ | https://bsd.dli.mt.gov/Building-Codes-Permits/permit-applications/electrical-permits/ |
| Plumbing | Homeowner doing own plumbing on own residence: no state permit | ✅ | https://bsd.dli.mt.gov/building-codes-permits/permit-applications/plumbing-permits/ |
| Frost / footing depth | 36 in (1-story wood frame); 48 in (multistory/masonry) | ✅ | https://bsd.dli.mt.gov/building-codes-permits/permit-applications/building-permits/building-permit-faq (ARM 24.301.142(9)) |
| Ground snow load | Site-specific via ASCE 7-22 Hazard Tool, **not looked up**. Minimum roof snow load 30 psf. | ⚠️ / ✅ | https://bsd.dli.mt.gov/building-codes-permits/snow-load-information |
| Ice barrier | Required statewide | ✅ | https://www.law.cornell.edu/regulations/montana/Mont-Admin-r-24.301.154 (item 23) |
| Sales tax | 0%. No resort tax here. | ✅ | https://revenue.mt.gov/taxes/general-sales-tax · https://mtresorttax.org/communities-overview/ |
| Septic / floodplain | Ravalli County Environmental Health (406) 375-6565; Planning (406) 375-6530 | ✅ | https://ravallicounty.gov/167/Septic-Permits · https://ravallicounty.gov/177/Planning |
| Nearest Home Depot | Missoula #3102, 2725 Radio Way, Missoula MT 59808, (406) 523-0901. Prices **not** localized (homedepot.com blocked automated store pricing). | ✅ store / ❌ localization | https://www.homedepot.com/l/Missoula/MT/Missoula/59808/3102 · https://www.homedepot.com/l/MT |
| Missoula County part of 59833 | Certified county program, (406) 258-3723. Table R301.2: frost 36 in, wind 105 mph, SDC D0, AFI 2,000, zone 6B, snow site-specific. | ✅ (sheet dated 2.2024, cites 2021 IRC) | https://www.missoulacounty.build/media/hdzhrtru/irc-design-criteria-r301-2.pdf |
