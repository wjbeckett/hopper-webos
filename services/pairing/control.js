"use strict";
// SiloControl transport: what lets a Silo phone app control Hopper (#155). Hopper follows the Roku
// receiver (silo-roku docs/silocontrol.md): `_silocast-roku._tcp` over mDNS, and SiloControl v2
// frames over plain TCP (level `plain`), which the phone apps already dial for a Roku.
//
// This module only moves frames. It accepts local-network peers, sends the TV's hello, answers and
// sends pings, closes a connection that never says hello, and hands every other message to the
// app, which makes all protocol decisions (src/control/). Node 12 safe: no optional chaining, no
// nullish coalescing.
var net = require("net");
var mdns = require("./mdns");

var SERVICE = "_silocast-roku._tcp.local";
var FIRST_PORT = 52817; // silo-roku section 5.2: 52817, then up to 52826, then any port
var LAST_PORT = 52826;
var MAX_FRAME = 65536;
var MAX_CONTROLLERS = 4;
var HELLO_WAIT_MS = 5000;
var PING_INTERVAL_MS = 3000;
var MAX_MISSED_PONGS = 3;

/** a.b.c.d (or ::ffff:a.b.c.d) in a private, link-local or loopback IPv4 range (section 5.5). */
function isLocalPeer(address) {
  var host = String(address || "").replace(/^::ffff:/i, "");
  var parts = host.split(".");
  if (parts.length !== 4) return false;
  var octets = [];
  for (var i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return false;
    var value = Number(parts[i]);
    if (value > 255) return false;
    octets.push(value);
  }
  var a = octets[0];
  var b = octets[1];
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return a === 169 && b === 254;
}

function frame(message) {
  var body = Buffer.from(JSON.stringify(message), "utf8");
  var length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

/**
 * options: { emit(event) }. Events: { type: "listening", port }, { type: "connected", id, peer },
 * { type: "message", id, message }, { type: "closed", id }, { type: "error", message }.
 */
function createControl(options) {
  var server = null;
  var advertiser = null;
  var timer = null;
  var hello = null;
  var connections = {};
  var nextId = 0;

  function emit(event) { options.emit(event); }

  function write(c, message) {
    try { c.socket.write(frame(message)); } catch (e) { /* the close handler reports it */ }
  }

  function drop(c) {
    if (!connections[c.id]) return;
    delete connections[c.id];
    try { c.socket.destroy(); } catch (e) { /* closed */ }
    emit({ type: "closed", id: c.id });
  }

  // A close with its reason to a peer that lists close_reason, a bare one otherwise, then the end.
  function closeConnection(c, reason) {
    if (!connections[c.id]) return;
    var withReason = reason && c.features.indexOf("close_reason") >= 0;
    write(c, withReason ? { type: "close", v: 2, close: { reason: reason } } : { type: "close", v: 2 });
    delete connections[c.id];
    emit({ type: "closed", id: c.id });
    try { c.socket.end(); } catch (e) { /* closed */ }
    setTimeout(function () { try { c.socket.destroy(); } catch (e) { /* closed */ } }, 500);
  }

  function onFrame(c, text) {
    var message;
    try { message = JSON.parse(text); } catch (e) { closeConnection(c, ""); return; }
    if (!message || typeof message !== "object" || typeof message.type !== "string") { closeConnection(c, ""); return; }
    if (message.type === "ping") { write(c, { type: "pong", v: 2 }); return; }
    if (message.type === "pong") {
      // Only a pong after our ping counts, so a peer that reads nothing can't keep itself alive.
      if (c.awaitingPong) { c.awaitingPong = false; c.missed = 0; }
      return;
    }
    if (message.type === "close") { drop(c); return; }
    if (message.type === "hello" && message.hello && typeof message.hello === "object") {
      c.saidHello = true;
      if (Array.isArray(message.hello.features)) c.features = message.hello.features.filter(function (f) { return typeof f === "string"; });
    }
    emit({ type: "message", id: c.id, message: message });
  }

  function admit(socket) {
    var ids = Object.keys(connections);
    if (ids.length < MAX_CONTROLLERS) return true;
    // At the limit, a connection that never said hello goes first; otherwise the newcomer is refused.
    for (var i = 0; i < ids.length; i++) {
      if (!connections[ids[i]].saidHello) { closeConnection(connections[ids[i]], "too_many_controllers"); return true; }
    }
    var refused = { socket: socket, features: [] };
    write(refused, { type: "hello", v: 2, hello: hello });
    write(refused, { type: "error", v: 2, error: { code: "too_many_controllers", message: "Too many devices are controlling this TV. Disconnect one and try again." } });
    write(refused, { type: "close", v: 2, close: { reason: "too_many_controllers" } });
    socket.end();
    return false;
  }

  function onConnection(socket) {
    if (!isLocalPeer(socket.remoteAddress)) { socket.destroy(); return; }
    socket.on("error", function () { /* the close handler reports it */ });
    if (!admit(socket)) return;
    nextId += 1;
    var c = { id: "c" + nextId, socket: socket, features: [], saidHello: false, acceptedAt: Date.now(), awaitingPong: false, missed: 0, nextPingAt: Date.now() + PING_INTERVAL_MS };
    connections[c.id] = c;
    var pending = Buffer.alloc(0);
    socket.on("data", function (chunk) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        var size = pending.readUInt32BE(0);
        if (size > MAX_FRAME) { drop(c); return; }
        if (pending.length < 4 + size) break;
        var text = pending.toString("utf8", 4, 4 + size);
        pending = pending.slice(4 + size);
        onFrame(c, text);
        if (!connections[c.id]) return;
      }
    });
    socket.on("close", function () { drop(c); });
    emit({ type: "connected", id: c.id, peer: String(socket.remoteAddress || "").replace(/^::ffff:/i, "") });
    write(c, { type: "hello", v: 2, hello: hello });
  }

  // The hello watchdog and the heartbeat (sections 5.5 and 6.3).
  function tick() {
    var now = Date.now();
    Object.keys(connections).forEach(function (id) {
      var c = connections[id];
      if (!c.saidHello) {
        if (now - c.acceptedAt >= HELLO_WAIT_MS) closeConnection(c, "timeout");
        return;
      }
      if (now < c.nextPingAt) return;
      c.nextPingAt = now + PING_INTERVAL_MS;
      if (c.awaitingPong) c.missed += 1;
      if (c.missed > MAX_MISSED_PONGS) { drop(c); return; }
      c.awaitingPong = true;
      write(c, { type: "ping", v: 2 });
    });
  }

  function listen(port, done) {
    var candidate = net.createServer(onConnection);
    candidate.once("error", function (e) {
      if (e.code === "EADDRINUSE" && port !== 0) listen(port < LAST_PORT ? port + 1 : 0, done);
      else done(e);
    });
    candidate.listen(port, "0.0.0.0", function () {
      candidate.on("error", function (e) { emit({ type: "error", message: "tcp: " + e.message }); });
      done(null, candidate);
    });
  }

  function stop() {
    Object.keys(connections).forEach(function (id) { closeConnection(connections[id], "tv_disconnected"); });
    if (timer) { clearInterval(timer); timer = null; }
    if (advertiser) { advertiser.stop(); advertiser = null; }
    if (server) { try { server.close(); } catch (e) { /* closed */ } server = null; }
  }

  return {
    /** config: { hello (the TV's hello payload), instance, id, txt: ["key=value", …] } */
    start: function (config, done) {
      stop();
      hello = config.hello;
      listen(FIRST_PORT, function (err, listening) {
        if (err) { done(err); return; }
        server = listening;
        var port = server.address().port;
        timer = setInterval(tick, 500);
        advertiser = mdns.createAdvertiser({
          service: SERVICE, instance: config.instance, id: config.id, port: port, txt: config.txt,
          onError: function (e) { emit({ type: "error", message: "mdns: " + e.message }); }
        });
        advertiser.start(function (e) {
          if (e) { stop(); done(e); return; }
          emit({ type: "listening", port: port });
          done(null, port);
        });
      });
    },
    /** A new hello or TXT (the `playing` flag, a server name learned later). */
    update: function (config) {
      if (config.hello) hello = config.hello;
      if (config.txt && advertiser) advertiser.update(config.txt);
    },
    send: function (id, message) {
      var c = connections[id];
      if (!c) return false;
      write(c, message);
      return true;
    },
    close: function (id, reason) {
      var c = connections[id];
      if (c) closeConnection(c, reason);
    },
    stop: stop,
    running: function () { return !!server; }
  };
}

module.exports = { createControl: createControl, isLocalPeer: isLocalPeer };
