<img src="icon.png" width="96" alt="Kino Social">

# Kino Social

**Español.** Una red social pequeña dentro de Kino: cuenta lo que ves, comenta, sigue a otras personas y únete a comunidades.
Para instalarlo, abre Kino ▸ Plugins ▸ **De Kino** y toca **Instalar**. Necesita Kino 0.9.77 o más reciente.

**English.** A small social network inside Kino: share what you watch, comment, follow people and join communities.
To install it, open Kino ▸ Plugins ▸ **From Kino** and tap **Install**. It needs Kino 0.9.77 or newer.

## About this plugin

A small social network inside Kino: a feed of what people write and watch, likes, one level of comments, profiles,
@handles and people to follow. It is a **screen plugin** (`"screen"`, apiVersion 15) and the only Kino plugin with a server
of its own (`129-158-250-81.sslip.io`, an Oracle Cloud server; code in a separate repository).

## How it is built

The code lives in modules under `src/`. Kino installs one file, so `npm run build` (esbuild) bundles them into the shipped
`plugin.js`. Never edit `plugin.js` by hand: change `src/` and build again.

```text
src/
  plugin.js      entry: the exports Kino calls (screen, screenEvent, track, job)
  api.js         the server: login with kino.identity (challenge, signed token, device key) and every call
  events.js      screenEvent: every tap, change and timer of the screen (feed, posts, comments, likes, profile)
  track.js       track(event): what you finish watching becomes activity on its own, with the episode's picture
  activity.js    backfill from kino.library.watched when the screen opens (only finished titles, never 18+)
  notices.js     job(): new comments, likes and followers become notices in Kino's bell
  linkpreview.js a link's preview, read on the device: the page's head (Open Graph) or YouTube's oEmbed
  titlelink.js   a TMDB or IMDb link gets its title and poster from Kino's TMDB (those sites refuse previews)
  swear.js       swear words become "xxxx": a local list first, the AI only when the list finds nothing
  i18n.js        every text in Spanish and English
  ui/kit.js      small node builders (avatar, name block, buttons, spacing)
  ui/cards.js    a post, a link preview, an activity card, a comment, suggestions
  ui/views.js    the views: welcome, feed (phone and TV), thread, profile, people
```

## Try it

```bash
npm install
npm run build
npm run validate                                          # what Kino would say about the manifest and the views
node ../sdk/run.mjs --device phone . screenEvent open     # the first call of a session
node ../sdk/run.mjs --device tv . screen                  # the TV layout
npm test                                                  # node --test test/*.test.mjs
```

## What it asks for

`library` (read what you watched), `tracking` (Kino tells it when you finish an episode or a movie), `identity` (who you
are, without a login), `ai` (the swear filter's fallback), `schedule` (checking for notices in the background) and
`notifications` (notices in the bell). Each shows its line on the install sheet and can be switched off in Ajustes.
