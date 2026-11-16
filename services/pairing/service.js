"use strict";
// Silo companion-pairing service. It advertises `_silopair-roku._tcp` while the
// app's setup screen is open, speaks the length-prefixed JSON pairing frames
// over plain TCP, and exposes received messages to the web app as an event
// queue. All protocol decisions (device login, codes) stay in the web app.
// It also carries phone remote control (SiloControl, control.js): the
// control* methods below, with events pushed to the app's subscription.
// Node 12 safe: no optional chaining, no nullish coalescing.
var Service = require("webos-service");
var net = require("net");
var mdns = require("./mdns");
var control = require("./control");

var MAX_FRAME = 1 << 20;
var HELLO_STATE = "setup";

var svc = new Service("com.hopperapp.hopper.service");

var advertiser = null;
var server = null;
var conn = null;
var identity = { name: "LG webOS TV", id: "webos-tv" };
var events = [];
var seq = 0;
var lastError = "";

function emit(type, message) {
  seq += 1;
  events.push({ seq: seq, type: type, message: message || null });
  if (events.length > 30) events.shift();
}

function writeFrame(socket, message) {
  var body = Buffer.from(JSON.stringify(Object.assign({ v: 1 }, message)), "utf8");
  var len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([len, body]));
}

function onConnection(socket) {
  if (conn) { socket.destroy(); return; } // one phone at a time
  conn = socket;
  var acc = Buffer.alloc(0);
  writeFrame(socket, {
    type: "hello", tvName: identity.name, tvDeviceId: identity.id,
    state: HELLO_STATE, supportedVersions: [1]
  });
  emit("connected");
  socket.on("data", function (chunk) {
    acc = Buffer.concat([acc, chunk]);
    while (acc.length >= 4) {
      var n = acc.readUInt32BE(0);
      if (n > MAX_FRAME) { socket.destroy(); return; }
      if (acc.length < 4 + n) break;
      var text = acc.toString("utf8", 4, 4 + n);
      acc = acc.slice(4 + n);
      try { emit("message", JSON.parse(text)); } catch (e) { /* ignore bad frame */ }
    }
  });
  socket.on("error", function () { /* closed handler reports it */ });
  socket.on("close", function () {
    if (conn === socket) conn = null;
    emit("disconnected");
  });
}

function stopAll() {
  if (advertiser) { advertiser.stop(); advertiser = null; }
  if (conn) { conn.destroy(); conn = null; }
  if (server) { try { server.close(); } catch (e) { /* closed */ } server = null; }
}

// start({ name, id }) -> { port }
svc.register("start", function (message) {
  var args = message.payload || {};
  stopAll();
  events = [];
  lastError = "";
  identity = { name: String(args.name || "LG webOS TV"), id: String(args.id || "webos-tv") };
  server = net.createServer(onConnection);
  server.on("error", function (e) { lastError = "tcp: " + e.message; });
  server.listen(0, function () {
    var port = server.address().port;
    advertiser = mdns.createAdvertiser({
      name: identity.name, id: identity.id, port: port, state: HELLO_STATE,
      onError: function (e) { lastError = "mdns: " + e.message; }
    });
    advertiser.start(function (err) {
      if (err) {
        lastError = "mdns: " + err.message;
        message.respond({ returnValue: false, errorText: lastError });
        return;
      }
      message.respond({ returnValue: true, port: port });
    });
  });
});

// poll({ since }) -> { events: [...], connected, error }
svc.register("poll", function (message) {
  var since = Number((message.payload || {}).since) || 0;
  message.respond({
    returnValue: true,
    events: events.filter(function (e) { return e.seq > since; }),
    connected: !!conn,
    error: lastError
  });
});

// send({ message }) writes one pairing message to the connected phone.
svc.register("send", function (message) {
  var body = (message.payload || {}).message;
  if (!conn || !body) { message.respond({ returnValue: false, errorText: "not_connected" }); return; }
  try {
    writeFrame(conn, body);
    message.respond({ returnValue: true });
  } catch (e) {
    message.respond({ returnValue: false, errorText: e.message });
  }
});

// closeConnection() drops the phone (after serverResult) but keeps advertising.
svc.register("closeConnection", function (message) {
  if (conn) { conn.end(); }
  message.respond({ returnValue: true });
});

svc.register("stop", function (message) {
  stopAll();
  events = [];
  message.respond({ returnValue: true });
});

// ---- Phone remote control (control.js, #155)

var controlEvents = [];
var controlSubscriber = null;

function controlEmit(event) {
  if (controlSubscriber) {
    controlSubscriber.respond({ returnValue: true, event: event });
    return;
  }
  // Kept until the app subscribes again (a reload), within reason.
  controlEvents.push(event);
  if (controlEvents.length > 100) controlEvents.shift();
}

var remote = control.createControl({ emit: controlEmit });

// controlStart({ hello, instance, id, txt }) -> { port }
svc.register("controlStart", function (message) {
  var args = message.payload || {};
  if (!args.hello || !Array.isArray(args.txt)) { message.respond({ returnValue: false, errorText: "hello and txt are required" }); return; }
  remote.start({ hello: args.hello, instance: String(args.instance || "Hopper"), id: String(args.id || "webos-tv"), txt: args.txt.map(String) }, function (err, port) {
    if (err) message.respond({ returnValue: false, errorText: err.message });
    else message.respond({ returnValue: true, port: port });
  });
});

// controlEvents({ subscribe: true }): every event from control.js, as { event }. One subscriber.
svc.register("controlEvents", function (message) {
  message.respond({ returnValue: true, subscribed: !!message.isSubscription });
  if (!message.isSubscription) return;
  controlSubscriber = message;
  var queued = controlEvents;
  controlEvents = [];
  queued.forEach(function (event) { message.respond({ returnValue: true, event: event }); });
}, function (message) {
  if (controlSubscriber && controlSubscriber.uniqueToken === message.uniqueToken) controlSubscriber = null;
});

// controlUpdate({ hello?, txt? })
svc.register("controlUpdate", function (message) {
  var args = message.payload || {};
  remote.update({ hello: args.hello || null, txt: Array.isArray(args.txt) ? args.txt.map(String) : null });
  message.respond({ returnValue: true });
});

// controlSend({ id, message }) writes one frame to a connected phone.
svc.register("controlSend", function (message) {
  var args = message.payload || {};
  var sent = !!args.message && remote.send(String(args.id), args.message);
  message.respond(sent ? { returnValue: true } : { returnValue: false, errorText: "not_connected" });
});

// controlClose({ id, reason })
svc.register("controlClose", function (message) {
  var args = message.payload || {};
  remote.close(String(args.id), String(args.reason || ""));
  message.respond({ returnValue: true });
});

svc.register("controlStop", function (message) {
  remote.stop();
  controlEvents = [];
  message.respond({ returnValue: true });
});
