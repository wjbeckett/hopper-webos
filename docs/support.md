---
title: Hopper support
permalink: /support/
---

# Hopper support

Hopper is an app for LG webOS TVs that plays media from your own Silo media server. It is developed
independently and is not affiliated with Silo or LG.

## Before you start

- **You need a Silo server.** Hopper doesn't provide any content. It connects to a Silo server that you
  or someone in your household runs. Without one, there is nothing to sign in to.
- **Your TV needs webOS 6 or later** (LG TVs from 2021 on).
- **Problems with your library itself** (missing titles, metadata, users, transcoding settings) are
  managed on your Silo server, not in Hopper.

## Signing in

- **With your phone:** on the TV's first screen, open the Silo phone app, choose "Sign in on TV" and pick
  your TV. The phone and TV need to be on the same network.
- **With a code:** choose code sign-in on the TV, then follow the QR code or enter the code on another
  device.
- **With a password:** from the code screen, choose "Use password instead".

If the TV can't reach the server, check the server address and that the server is running.

## Report a problem or ask a question

Open an issue at
[github.com/wjbeckett/hopper-webos/issues](https://github.com/wjbeckett/hopper-webos/issues)
(a free GitHub account is needed). Search the existing issues first: someone may have asked already.

When reporting a problem, include:

- **What happened**, and what you expected instead.
- **The steps**, screen by screen, including the remote buttons you pressed.
- **Hopper's version**, shown under Settings → Server.
- **Your TV model and webOS version.**
- **Your Silo server version.**
- **For playback problems:** the file's container and its video, audio and subtitle formats.

Hopper keeps its diagnostics on the TV and never uploads them. You can view them under
Settings → Diagnostics if you are asked for details.

## Privacy

See the [privacy policy](../privacy/).
