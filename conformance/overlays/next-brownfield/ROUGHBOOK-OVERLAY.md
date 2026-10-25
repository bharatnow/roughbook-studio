# next-brownfield

The brownfield fixture of ROUGHBOOK-BROWNFIELD-PLAN.md, B1: an app with pages of its own, laid over
the `next` fixture (create-next-app 16.4.2) by `conformance/run.mjs`. It has a layout with a shared
header and footer, five pages and a dynamic route (`/`, `/pricing`, `/about`, `/blog`,
`/blog/[slug]`), a section that fetches its data on the server (`PricingSection`), a page behind a
sign-in (`/account`, which `proxy.ts` sends to `/login` without a session, and whose summary reads
the account layout's provider), and Storybook's stories (`components/home/hero.stories.tsx`, with
`.storybook/main.js`; Storybook's packages are left out, since nothing here runs it). Edit it by
hand: no scaffold writes it.
