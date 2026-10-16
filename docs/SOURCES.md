# Source and boundaries

Stall was generated and assembled from the committed `runeditrun/base` foundation at `ada9f574d8a7247edc3a1180b593ad182b1fbb37`, then converted with Base's package-mode exporter. The exact published CLI pin is `@runeditrun/rer` 0.2.34. The copied runtime, auth, mail, import-kit and D1 transport remain MIT source. `composition.lock.json` records foundation origins.

Copied and adapted sources, never edited in place:

- [Barrow](https://github.com/just-every/run-barrow/tree/695819a29c7ff7add8572982007b75e6702963ed): `src/barrow/orders.ts`, `pier.ts` and `access.ts` for Pier-owned reservations, durable order revisions and live authorization; its import adapters for native targets, before-images, journal and undo.
- [Pier](https://github.com/just-every/run-pier/tree/dab5731f83d4fc925e378b67ff780fac14a5182b): catalogue and decimal quantity interpretation, native reservation shape and order/dispatch commands. Stock and reservation policy continue to execute in Pier.
- [Pane](https://github.com/just-every/run-pane/tree/39eee85064598e72caadfaeded0cff6302d0ce83): public-page shell and the separation of public forms from the owner desk adapted to a React shop page. React escapes listing text. Stall owns its checkout page; Pane remains separately deployable.
- Current Satchel, Barrow and Lanyard mains supplied the worked package-mode launch, deploy, auth and portability conventions.

Stripe Checkout, signed webhooks, approval drafts and the retail product mapping are Stall's new integration. External calls are isolated; tests fake only those network edges. No demo provider or pretend stock runs in the application.
