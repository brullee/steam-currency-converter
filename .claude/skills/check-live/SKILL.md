---
name: check-live
description: Check that the extension still works on the real Steam store with the real exchange-rate API. Use when the user asks "does it still work", after a Steam redesign or a bug report about prices not converting, before a store release, or when the weekly Live check workflow failed.
---

1. Run `npm run test:live` in `tests/`. It loads the Chrome build into real Chrome, sets USD → EUR with no seeded rate, and checks: the rate API returns a plausible rate, every price on the specials search page converts and hovers back to USD, and the Portal 2 page's purchase prices convert. Needs network; about 30s.
2. Report each test's ok/not ok line and its assertion message. Say which kind of failure it is:
   - rate test failed → exchangerate-api.com is down or changed its response; the extension now leaves pages unconverted for everyone.
   - "markup changed" → Steam renamed or restructured the element; open the page and find the new markup before touching code.
   - "prices left unconverted" with prices in a non-USD currency → the store served another region's currency to this IP; not a bug.
3. To look at a failing page yourself, rerun with `HEADED=1`.

Never "fix" a failing check by loosening its selectors or assertions; find out what Steam changed and make the extension handle it, then add a fixture test for the new markup in `tests/e2e/`.
