# Hopper: LG Content Store listing (draft)

**App name:** Hopper
**Category:** Entertainment
**App ID:** com.hopperapp.hopper · **Version:** 1.0 (the build number, 1.0.N, is set when the release is built)
**Privacy policy:** https://wjbeckett.github.io/hopper-webos/privacy/ (source: `docs/privacy.md`, published with GitHub Pages from `/docs` on `main`)
**Seller contact:** https://wjbeckett.github.io/hopper-webos/support/ (source: `docs/support.md`). A page rather than an email address, so the contact route can change without changing the listing.
**Tag keywords:** media server, Silo, movies, TV shows, series, home media, personal media, self-hosted, video player, audiobooks, music, streaming

## Short description
Watch the movies, series, music and audiobooks on your own Silo media server, on your LG TV.

## Description
Plain text, as pasted into Seller Lounge (LG requires 50 to 4000 bytes; this is 1928).

```text
Hopper connects your LG TV to your own Silo media server. Browse and play your movies, series, music and audiobooks in an interface built for the remote, and pick up where you left off on any device.

Getting started
- Sign in with your phone: choose "Sign in on TV" in the Silo phone app and pick your TV, with nothing to type on the remote.
- Or sign in with a QR code, a code on another device, or a username and password.
- Save several servers and switch between them.

Profiles
- A "Who's watching?" picker, with PIN protection for profiles.
- Create and edit household profiles, including child profiles with rating limits and library access.

Browsing
- Home and library rows from your server, with Continue Watching that updates live when you watch on another device.
- Sorting, filters, an A-Z jump bar, collections, music genres and shuffle.
- Details pages with cast, trailers, extras and related titles. Series pages with season tabs and spoiler protection for unwatched episodes.
- Search, calendar, watchlist, favorites and history.

Playback
- Your server chooses the best way to play each file for your TV.
- Resume, seek previews, chapters, and skip intro and credits.
- Up Next with auto-play, and audio, subtitle and quality choices while you watch.
- Subtitle styling, sync and online search, playback speed and a sleep timer.
- On a slow connection, quality lowers when playback keeps buffering.

Built for the TV
- Every screen works with the arrows, OK and Back, and with the Magic Remote pointer.
- Large, readable text, sized for the sofa.
- If the server stops answering, Hopper keeps trying and carries on where it stopped.
- Your sign-in is stored encrypted, your password is never stored, and diagnostics stay on the TV.

Hopper needs a Silo server that you run yourself. It does not provide, host or sell any content. Hopper is an independent client and is not affiliated with or endorsed by Silo.
```

## Reviewer test account
LG QA can't review the app without a server and an account:

- Server: `https://demo.siloserver.org`
- Username: `demo`
- Password: `demo`
- Steps: on first launch choose "Enter server address", enter the URL and select Continue, then on the code screen select "Use password instead" and sign in. The UX scenario document (section 4, kept by the maintainer) shows each screen.

Confirm with the demo server's operator that LG may use these credentials and that the server will
stay online during review.

## Assets
| Item | File |
|---|---|
| Store icon 400×400 | `brand/out/store/hopper-icon-400.png` (App Tile Color `#0E1030`, the icon's flat background) |
| Hero / preview 1920×1080 | `brand/out/store/hopper-store-banner-1920x1080.png` |
| Screenshots 1920×1080 | `brand/store/screenshots/01–05` |
| Self-checklist (v5.0), UX scenario document (v4.3) | Kept by the maintainer, not in the repository (`brand/store/qa/` is git-ignored) |

## Permissions
`appinfo.json` asks for the `settings` group (LG's "Read and modify system preferences and settings"). Hopper only reads the TV's caption style, for Settings → Subtitles → Use Device Settings. A developer-installed build is refused it, so whether it works can only be checked on the store-signed build (#106). If LG questions it, that is the reason; if they refuse it, the app keeps its own subtitle style.

## Before you submit
The steps left before submission are the open issues in the [Store submission milestone](https://github.com/wjbeckett/hopper-webos/milestone/2).

