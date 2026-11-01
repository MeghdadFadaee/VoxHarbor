# App icons

VoxHarbor's orange waveform mark is provided as local assets for browser tabs, bookmarks and home-screen shortcuts:

- `/favicon.svg`: scalable browser favicon.
- `/favicon.ico`: 16, 32 and 48 pixel fallback images.
- `/favicon-16x16.png` and `/favicon-32x32.png`: PNG favicon fallbacks.
- `/apple-touch-icon.png`: opaque 180 pixel Apple touch icon.
- `/icons/app-192.png` and `/icons/app-512.png`: standard app icons.
- `/icons/app-maskable-512.png`: opaque icon with extra padding for platform masks.
- `/icons/safari-pinned-tab.svg`: monochrome pinned-tab mark.
- `/site.webmanifest`: application name, launch location, colors and home-screen icons.

The assets are linked from the document head and explicitly served by the HTTP adapter. Both application and deployment content policies allow the same-origin manifest. They require no sign-in or external asset requests.

Regenerate the artwork with `npm run icons:build`. The generator uses Node built-ins and the same waveform geometry for its SVG, PNG and ICO outputs. Generated assets are checked into the source tree as project files, so deployment does not require an image-processing dependency.

The manifest supplies shortcut/standalone presentation metadata; it does not add offline support, a service worker or a guarantee of installability on every browser. Accounts, identities and connections retain their existing backend ownership and storage rules.
