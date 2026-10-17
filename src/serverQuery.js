// A2S_INFO query against the game's own "query port" (the Source/Steamworks
// server-info protocol). This is the only live signal this manager can get
// about who's actually connected to the server -- Enshrouded has no RCON,
// admin console, chat commands, or remote API at all (see processManager.js).
//
// Confidence note: this hasn't been verified against a real Enshrouded
// server (this sandbox can't run a Windows host or send/receive real UDP
// packets to one) -- it's inferred from (a) Enshrouded servers showing live
// player counts on BattleMetrics, and (b) the game exposing a dedicated
// "query port" setting (default 15637, separate from the game traffic
// port), which is exactly the Source-engine convention for an A2S query
// port. If Enshrouded turns out not to speak A2S after all, every failure
// here just surfaces as "Unknown" in the UI (see server.js) rather than
// breaking anything.

const dgram = require('dgram');

const A2S_INFO_REQUEST_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]);
const A2S_INFO_PAYLOAD = Buffer.from('Source Engine Query\0', 'ascii');

function buildInfoRequest(challengeBytes) {
  const parts = [A2S_INFO_REQUEST_HEADER, A2S_INFO_PAYLOAD];
  if (challengeBytes) parts.push(challengeBytes);
  return Buffer.concat(parts);
}

function readCString(buf, offset) {
  const end = buf.indexOf(0x00, offset);
  if (end === -1) throw new Error('Malformed A2S_INFO response (unterminated string).');
  return { value: buf.toString('utf8', offset, end), next: end + 1 };
}

// Expects the leading 0xFFFFFFFF prefix already stripped off.
function parseInfoResponse(buf) {
  let offset = 0;
  const header = buf.readUInt8(offset);
  offset += 1;
  if (header !== 0x49) return null; // not an A2S_INFO ('I') reply

  offset += 1; // protocol version, unused
  let r = readCString(buf, offset); offset = r.next; // name
  r = readCString(buf, offset); offset = r.next; // map
  r = readCString(buf, offset); offset = r.next; // folder
  r = readCString(buf, offset); offset = r.next; // game
  offset += 2; // steam app id (short), unused
  const players = buf.readUInt8(offset); offset += 1;
  const maxPlayers = buf.readUInt8(offset); offset += 1;
  const bots = buf.readUInt8(offset); offset += 1;

  return { players, maxPlayers, bots };
}

function queryOnce(host, port, requestBuf, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("Timed out waiting for a reply from the server's query port."));
    }, timeoutMs);

    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });

    socket.send(requestBuf, port, host, (err) => {
      if (err && !settled) {
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

/**
 * Queries a Source/Steamworks-style A2S_INFO endpoint for the current and
 * max player counts. Handles the optional challenge-response handshake --
 * some servers answer the first request with a 4-byte challenge and expect
 * it echoed back before they'll reply for real.
 */
async function queryPlayers(host, port, timeoutMs = 1500) {
  let response = await queryOnce(host, port, buildInfoRequest(), timeoutMs);
  if (response.length < 5 || response.readInt32LE(0) !== -1) {
    throw new Error('Unexpected reply from the query port (not a Source-style response).');
  }
  let body = response.slice(4);

  if (body.readUInt8(0) === 0x41) {
    // S2C_CHALLENGE ('A') -- resend the request with the challenge appended.
    const challenge = body.slice(1, 5);
    response = await queryOnce(host, port, buildInfoRequest(challenge), timeoutMs);
    body = response.slice(4);
  }

  const parsed = parseInfoResponse(body);
  if (!parsed) throw new Error('Unexpected reply from the query port (not an A2S_INFO response).');
  return parsed;
}

module.exports = { queryPlayers };
