---
title: Hopper privacy policy
permalink: /privacy/
---

# Hopper privacy policy

*Last updated: 17 November 2026*

Hopper is an app for LG webOS TVs that plays media from a Silo media server. It is developed
independently and is not affiliated with Silo or LG. This policy covers the Hopper app only.

**In short:** Hopper has no account system, analytics, advertising or tracking of its own. It
talks to the Silo server you choose and, for a few images and trailers, to the services named
below. The developer of Hopper receives no data from the app.

## What Hopper stores on your TV

Kept in the app's storage on the TV, and nowhere else:

- the addresses of the Silo servers you add, and which one is in use;
- your sign-in for each server: account and profile identifiers and the tokens that keep you
  signed in. Where the TV supports it, the tokens are encrypted with a key that never leaves
  the TV;
- a random identifier for this TV, created on first launch, so your server can tell your
  devices apart;
- the names and identifiers of the phones you allow to control the TV (see "Phone remote"
  below);
- app preferences, such as browsing and sort choices, the last screen you were on, and a
  measurement of your network speed used to choose playback quality.

Signing out removes that server's sign-in. Deleting the app, or its data, removes all of it.

## What Hopper sends to your Silo server

Hopper works by talking to the Silo server you add. It sends that server what it needs to
work: your sign-in, the TV's identifier, the name "LG webOS TV", the app version, which video
and audio formats the TV can play, what you browse and play, and your playback position so you
can resume on other devices.

That server is run by you or by whoever gave you access to it. What happens to data on the
server is up to its operator. For the Silo server software, see
[siloserver.org/privacy](https://siloserver.org/privacy).

## Other services

- **Profile pictures:** the preset avatars are loaded from DiceBear (`api.dicebear.com`). The
  request names the avatar style and a preset word such as "falcon". It contains nothing about
  you, though like any web request it reaches DiceBear from your network's IP address.
- **Request posters:** when your server lists titles you can request, their posters are loaded
  from The Movie Database's image service (`image.tmdb.org`).
- **Trailers:** trailer thumbnails are loaded from YouTube (`i.ytimg.com`). Opening a trailer
  hands it to the TV's YouTube app, where YouTube's and Google's own terms and privacy policy
  apply.
- **Phone setup:** to sign in with your phone, Hopper announces itself on your home network
  (mDNS) so the Silo app on your phone can find it. That exchange stays on your local network,
  between your phone, your TV and your server.
- **Phone remote:** while you're signed in, Hopper announces itself on your home network (mDNS)
  so the Silo phone app can find the TV and control playback. The announcement carries the TV's
  name, its random identifier, and your server's name and address, and anyone on your network
  can see it. A phone connects to the TV directly; that connection isn't encrypted, as with
  Silo's other TV apps, and stays on your local network. The first time a phone connects, the TV
  asks whether to allow it. The TV keeps the name and identifier of each phone you allow, so it
  can let that phone in next time; Settings → Server lists them and forgets them. Because the
  connection isn't encrypted, a device that can watch your network traffic could copy an allowed
  phone's identifier. When a phone starts a title for its own profile, the TV asks your server
  for a temporary sign-in to that profile, which the phone approves. It is kept in memory only,
  used for that playback, and signed out when the player closes. Nothing about this is sent anywhere else.

## Diagnostics

Hopper keeps a short log on the TV to help when something goes wrong. It is never uploaded,
and Hopper does not send crash reports or usage data anywhere.

## Children

Hopper does not collect personal information from anyone, including children. Profiles, PINs
and content ratings are managed on your Silo server.

## Changes and contact

Changes to this policy will be published here, with a new date at the top. Questions can be
raised at [github.com/wjbeckett/hopper-webos/issues](https://github.com/wjbeckett/hopper-webos/issues).
