# Hopper trademark and brand policy

Hopper's source code is free software under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`). You can use, study, change and share it under those terms.

That freedom covers the code, not the Hopper name and artwork. They tell users which builds come from this project. Anyone can fork the code, but users should be able to trust that an app called "Hopper" comes from here.

## What this covers

These are unregistered trademarks of the Hopper maintainer ([github.com/wjbeckett](https://github.com/wjbeckett)):

- the name **Hopper** when used for a media client or app
- the **Hopper mark**: poster tiles dropping into a gradient hopper that carries a play button
- the **Hopper wordmark and lockup** (the mark next to the word "Hopper")
- names and logos that look or sound so similar that people could mix them up with Hopper

The AGPL licence on the code does not give you any rights to these marks. AGPL-3.0 section 7(e) allows this.

## Brand files

The brand files are **© 2026 the Hopper maintainer, all rights reserved**. They are **not** licensed under the AGPL or any other open-source licence:

| Files | What they are |
| --- | --- |
| `brand/*.svg` and everything in `brand/out/` | Icon, splash and store artwork, with their rendered copies |
| `public/icon.png`, `public/largeIcon.png`, `public/splash.png` | The app icons and launch splash |
| The SVG paths and gradients in `src/components/HopperMark.tsx` | The mark and lockup as drawn in the app |

The React code around that artwork, `brand/render.sh` and the rest of the repository stay under the AGPL. The store screenshots in `brand/store/screenshots/` show third-party content (open movies and public-domain titles). They are included only to document the app.

## You don't need permission to

- Build and run Hopper, changed or unchanged, on your own TVs.
- Send pull requests to this project.
- Pass on unchanged official builds under the Hopper name, with all notices kept.
- Refer to the project accurately, for example "a fork of Hopper", "based on Hopper" or "works like Hopper".
- Write about it: reviews, articles, tutorials and talks.

## You need written permission to

- Distribute a **changed version** under the Hopper name or with the Hopper mark.
- **Publish to an app store**, including the LG Content Store, under the Hopper name or mark, or under an identity that could be mixed up with Hopper.
- Use the name or mark in a way that suggests this project made, runs or endorses your work.

## Forks

You can fork Hopper. That is your right under the AGPL. A fork you **distribute** needs its own name and its own artwork:

1. Replace the files in the "Brand files" table above.
2. Change the app ID (`com.hopperapp.hopper`) and the pairing service ID (`com.hopperapp.hopper.service`) everywhere they appear (`git grep com.hopperapp.hopper`: `public/appinfo.json`, `services/pairing/`, `src/platform/pairing.ts` and `scripts/`). This stops your app from replacing or clashing with Hopper on a TV.
3. Give it a different name. You can say that it is "based on Hopper".

## Silo

Hopper is an independent client for [Silo](https://siloserver.org/). It is not made, endorsed or supported by Silo Media L.L.C. "Silo" and the Silo logo are their trademarks, covered by [their own policy](https://github.com/Silo-Server/siloserver.org/blob/main/TRADEMARK.md). Hopper uses the Silo name only to say what it works with, and ships no Silo logo assets. This policy gives you no rights to Silo's marks.

## Asking

If you're not sure whether something is allowed, [open an issue](https://github.com/wjbeckett/hopper-webos/issues) and ask.

---

*Hopper and the Hopper mark are trademarks of the Hopper maintainer. They are not registered, so they are marked with ™, not ®.*
