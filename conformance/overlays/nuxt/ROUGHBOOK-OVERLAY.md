# nuxt

Existing pages for the `nuxt` fixture (ROUGHBOOK-BROWNFIELD-PLAN.md, B5b), laid over it by
`conformance/run.mjs`: `app.vue` renders the router's page, `/` shows a hero, and `/pricing` shows
the plans it loads with `useAsyncData` through `<PricingPlans>` and an FAQ, `<PricingFaq>`, each a
component of its own under `app/components/`. The pricing section is adopted and shown in its page
with an iteration the studio copies from the app. Edit it by hand: no scaffold writes it.
