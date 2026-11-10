"use strict";
// Minimal mDNS advertiser for `_silopair-roku._tcp` (proven on a webOS 22 TV).
// Node 12 safe: no optional chaining, no nullish coalescing.
var dgram = require("dgram");
var os = require("os");

var MDNS_ADDR = "224.0.0.251";
var MDNS_PORT = 5353;
var SERVICE = "_silopair-roku._tcp.local";
var META = "_services._dns-sd._udp.local";

function localIp() {
  var ifaces = os.networkInterfaces();
  var names = Object.keys(ifaces);
  for (var i = 0; i < names.length; i++) {
    var list = ifaces[names[i]];
    for (var j = 0; j < list.length; j++) {
      if (list[j].family === "IPv4" && !list[j].internal) return list[j].address;
    }
  }
  return null;
}

function encName(name) {
  var bufs = [];
  name.split(".").forEach(function (label) {
    var b = Buffer.from(label, "utf8");
    bufs.push(Buffer.from([b.length]), b);
  });
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function record(name, type, cls, ttl, rdata) {
  var head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(cls, 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encName(name), head, rdata]);
}

function response(records) {
  var h = Buffer.alloc(12);
  h.writeUInt16BE(0x8400, 2); // response, authoritative
  h.writeUInt16BE(records.length, 6);
  return Buffer.concat([h].concat(records));
}

// First question's name and type; enough to recognise our service queries.
function questions(buf) {
  var out = [];
  try {
    var count = buf.readUInt16BE(4);
    var off = 12;
    for (var i = 0; i < count; i++) {
      var labels = [];
      while (buf[off] !== 0) {
        if ((buf[off] & 0xc0) === 0xc0) { off += 1; break; }
        labels.push(buf.toString("utf8", off + 1, off + 1 + buf[off]));
        off += 1 + buf[off];
      }
      off += 1;
      out.push({ name: labels.join(".").toLowerCase(), type: buf.readUInt16BE(off) });
      off += 4;
    }
  } catch (e) { /* malformed packet: ignore */ }
  return out;
}

/**
 * options: { name, id, port, state ("setup"|"login"), serverIdentity?, onError? }
 * Labels may not contain dots, so the instance name is sanitised.
 */
function createAdvertiser(options) {
  var label = String(options.name || "Silo TV").replace(/\./g, " ").slice(0, 60);
  var instance = label + "." + SERVICE;
  var host = "silo-" + String(options.id || "tv").replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() + ".local";
  var ip = localIp();
  var sock = null;
  var timer = null;
  var lastReply = {};

  function txtRecord() {
    var pairs = [
      "v=1", "name=" + label, "id=" + options.id,
      "sid=" + Date.now().toString(36), "st=" + (options.state || "setup")
    ];
    if (options.state === "login" && options.serverIdentity) pairs.push("srv=" + options.serverIdentity);
    return Buffer.concat(pairs.map(function (s) {
      var b = Buffer.from(s, "utf8");
      return Buffer.concat([Buffer.from([b.length]), b]);
    }));
  }

  function announce(ttl) {
    var srv = Buffer.alloc(6);
    srv.writeUInt16BE(options.port, 4);
    return response([
      record(SERVICE, 12, 1, ttl, encName(instance)),
      record(instance, 33, 0x8001, ttl, Buffer.concat([srv, encName(host)])),
      record(instance, 16, 0x8001, ttl, txtRecord()),
      record(host, 1, 0x8001, ttl, Buffer.from(ip.split(".").map(Number)))
    ]);
  }

  function send(buf) {
    try { sock.send(buf, MDNS_PORT, MDNS_ADDR); } catch (e) { if (options.onError) options.onError(e); }
  }

  function onMessage(msg, rinfo) {
    var qs = questions(msg);
    for (var i = 0; i < qs.length; i++) {
      if (qs[i].name === META) {
        send(response([record(META, 12, 1, 120, encName(SERVICE))]));
      } else if (qs[i].name === SERVICE) {
        // Answer each asker at most once a second; browsers retry in bursts.
        var now = Date.now();
        if (now - (lastReply[rinfo.address] || 0) < 1000) continue;
        lastReply[rinfo.address] = now;
        send(announce(120));
      }
    }
  }

  return {
    start: function (done) {
      if (!ip) { done(new Error("no_network")); return; }
      sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sock.on("error", function (e) { if (options.onError) options.onError(e); });
      sock.on("message", onMessage);
      sock.bind(MDNS_PORT, function () {
        try {
          sock.setMulticastTTL(255);
          sock.setMulticastInterface(ip);
          sock.addMembership(MDNS_ADDR, ip);
        } catch (e) { done(e); return; }
        send(announce(120));
        timer = setInterval(function () { send(announce(120)); }, 15000);
        done(null);
      });
    },
    stop: function () {
      if (timer) { clearInterval(timer); timer = null; }
      if (!sock) return;
      send(announce(0)); // goodbye: phones drop the TV straight away
      var closing = sock;
      sock = null;
      setTimeout(function () { try { closing.close(); } catch (e) { /* closed */ } }, 100);
    }
  };
}

module.exports = { createAdvertiser: createAdvertiser };
