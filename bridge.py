"""Arco bridge.

Serves the fader page to the tablet over Wi-Fi and forwards fader moves to
REAPER as OSC, which REAPER routes into its Virtual MIDI Keyboard input.

    tablet browser --WebSocket (TCP 4820)--> bridge (this) --OSC (UDP 4821)--> REAPER

Standard library only: run with `python bridge.py`.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import socket
import struct
import time
from pathlib import Path

WEB_ROOT = (Path(__file__).parent / "web").resolve()
# Don't rely on the Windows registry for these: ES modules must be served as JavaScript.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# --- OSC ---------------------------------------------------------------------

def _osc_pad(b: bytes) -> bytes:
    # OSC strings are null-terminated and padded to a multiple of 4 bytes.
    return b + b"\0" * (4 - len(b) % 4)


def osc_message(address: str, value: int) -> bytes:
    return _osc_pad(address.encode()) + _osc_pad(b",i") + struct.pack(">i", value)


class ReaperOsc:
    def __init__(self, host: str, port: int, channel_base: int):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.target = (host, port)
        self.channel_base = channel_base

    def cc(self, channel: int, cc: int, value: int) -> None:
        """channel is 1-16 as shown to the user; value is 0-127."""
        address = f"/vkb_midi/{channel - 1 + self.channel_base}/cc/{cc}"
        self.sock.sendto(osc_message(address, value), self.target)

    def note(self, channel: int, note: int, velocity: int) -> None:
        """velocity 0 = note off."""
        address = f"/vkb_midi/{channel - 1 + self.channel_base}/note/{note}"
        self.sock.sendto(osc_message(address, velocity), self.target)

    def pitch(self, channel: int, value14: int) -> None:
        """value14 0-16383, 8192 = centre."""
        address = f"/vkb_midi/{channel - 1 + self.channel_base}/pitch"
        self.sock.sendto(osc_message(address, value14), self.target)

    def cc14(self, channel: int, cc: int, value14: int, hi_res: bool) -> None:
        """value14 is 0-16383. Hi-res sends MSB on cc and LSB on cc+32 (CC 0-31 only)."""
        msb, lsb = value14 >> 7, value14 & 0x7F
        self.cc(channel, cc, msb)
        if hi_res and cc < 32:
            self.cc(channel, cc + 32, lsb)


# --- WebSocket (minimal server side, RFC 6455) ------------------------------

def ws_frame(opcode: int, payload: bytes) -> bytes:
    n = len(payload)
    if n < 126:
        header = struct.pack(">BB", 0x80 | opcode, n)
    elif n < 65536:
        header = struct.pack(">BBH", 0x80 | opcode, 126, n)
    else:
        header = struct.pack(">BBQ", 0x80 | opcode, 127, n)
    return header + payload


async def ws_session(reader, writer, headers, osc: ReaperOsc, peer: str) -> None:
    accept = base64.b64encode(
        hashlib.sha1((headers["sec-websocket-key"] + WS_GUID).encode()).digest()
    ).decode()
    writer.write(
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
    )
    await writer.drain()
    sock = writer.get_extra_info("socket")
    if sock is not None:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    print(f"[ws] {peer} connected")
    held = Held()

    try:
        while True:
            b0, b1 = await reader.readexactly(2)
            opcode, length = b0 & 0x0F, b1 & 0x7F
            if length == 126:
                (length,) = struct.unpack(">H", await reader.readexactly(2))
            elif length == 127:
                (length,) = struct.unpack(">Q", await reader.readexactly(8))
            mask = await reader.readexactly(4) if b1 & 0x80 else b""
            payload = await reader.readexactly(length)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

            if opcode == 0x8:  # close
                writer.write(ws_frame(0x8, payload[:2]))
                await writer.drain()
                break
            if opcode == 0x9:  # ping
                writer.write(ws_frame(0xA, payload))
                await writer.drain()
            elif opcode == 0x1:  # text
                reply = handle_message(payload, osc, held)
                if reply is not None:
                    writer.write(ws_frame(0x1, reply))
                    await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        # Tablet vanished (Wi-Fi drop, screen lock): don't leave notes or the pedal hanging.
        held.release(osc)
        print(f"[ws] {peer} disconnected")
        writer.close()


def _clamp(value, lo: int, hi: int) -> int:
    return min(max(int(value), lo), hi)


class Held:
    """What one tablet currently holds down, so it can be released if the tablet vanishes."""

    def __init__(self):
        self.notes = set()  # (channel, note)
        self.sustain = set()  # channels with CC64 down
        self.bent = set()  # channels with pitch bend away from centre

    def release(self, osc: ReaperOsc) -> None:
        for channel, note in self.notes:
            osc.note(channel, note, 0)
        for channel in self.sustain:
            osc.cc(channel, 64, 0)
        for channel in self.bent:
            osc.pitch(channel, 8192)
        self.notes.clear()
        self.sustain.clear()
        self.bent.clear()


def handle_message(payload: bytes, osc: ReaperOsc, held: Held):
    try:
        msg = json.loads(payload)
    except ValueError:
        return None
    if "ping" in msg:
        return json.dumps({"pong": msg["ping"]}).encode()
    for m in msg.get("cc", []):
        channel, cc, value = _clamp(m["ch"], 1, 16), _clamp(m["cc"], 0, 127), _clamp(m["v"], 0, 16383)
        osc.cc14(channel, cc, value, bool(m.get("hr")))
        if cc == 64:
            (held.sustain.add if value >> 7 >= 64 else held.sustain.discard)(channel)
    for m in msg.get("note", []):
        channel, note, velocity = _clamp(m["ch"], 1, 16), _clamp(m["n"], 0, 127), _clamp(m["v"], 0, 127)
        osc.note(channel, note, velocity)
        if velocity:
            held.notes.add((channel, note))
        else:
            held.notes.discard((channel, note))
    for m in msg.get("pitch", []):
        channel, value = _clamp(m["ch"], 1, 16), _clamp(m["v"], 0, 16383)
        osc.pitch(channel, value)
        (held.bent.add if value != 8192 else held.bent.discard)(channel)
    if msg.get("panic"):
        held.release(osc)
        for channel in range(1, 17):
            osc.cc(channel, 123, 0)  # All Notes Off
    return None


# --- HTTP (static files) -----------------------------------------------------

async def serve_file(writer, path: str) -> None:
    rel = path.split("?", 1)[0].lstrip("/") or "index.html"
    target = (WEB_ROOT / rel).resolve()
    if target.is_file() and target.is_relative_to(WEB_ROOT):
        body = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        status = "200 OK"
    else:
        body, ctype, status = b"Not found", "text/plain", "404 Not Found"
    writer.write(
        f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n"
        f"Content-Length: {len(body)}\r\nCache-Control: no-store\r\n"
        "Connection: close\r\n\r\n".encode() + body
    )
    await writer.drain()
    writer.close()


def make_handler(osc: ReaperOsc):
    async def handle(reader, writer):
        peer = writer.get_extra_info("peername")[0]
        try:
            request = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
            writer.close()
            return
        lines = request.decode("latin-1").split("\r\n")
        try:
            _method, path, _version = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        headers = {}
        for line in lines[1:]:
            key, sep, value = line.partition(":")
            if sep:
                headers[key.strip().lower()] = value.strip()
        if headers.get("upgrade", "").lower() == "websocket":
            await ws_session(reader, writer, headers, osc, peer)
        else:
            await serve_file(writer, path)

    return handle


# --- Startup -----------------------------------------------------------------

def lan_addresses() -> list[str]:
    addrs = []
    try:  # Address of the interface that routes outward (no packet is sent).
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            addrs.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.append(info[4][0])
    except OSError:
        pass
    addrs = [a for a in dict.fromkeys(addrs) if not a.startswith(("127.", "169.254."))]
    # Home routers almost always hand out 192.168.x.x; 10.x is often a VPN tunnel
    # (e.g. ProtonVPN uses 10.2.0.2) that the tablet can't reach, so list it last.
    return sorted(addrs, key=lambda a: (not a.startswith("192.168."), not a.startswith("172."), a))


def run_test_sweep(osc: ReaperOsc, channel: int, cc: int) -> None:
    """Sweep one CC 0 -> 127 -> 0 over ~2 s so you can check REAPER without the tablet."""
    print(f"Sweeping CC{cc} on channel {channel} -> {osc.target[0]}:{osc.target[1]}")
    for v in list(range(128)) + list(range(127, -1, -1)):
        osc.cc(channel, cc, v)
        time.sleep(0.008)
    print("Done.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Deliberately uncommon ports: 3000/8000/9000 are the usual defaults for dev servers
    # and other OSC apps (TouchOSC, Open Stage Control), so avoid clashing with them.
    ap.add_argument("--port", type=int, default=4820, help="web/WebSocket (TCP) port for the tablet (default 4820)")
    ap.add_argument("--reaper-host", default="127.0.0.1", help="host running REAPER (default 127.0.0.1)")
    ap.add_argument("--reaper-port", type=int, default=4821, help="REAPER OSC (UDP) listen port (default 4821)")
    # REAPER's /vkb_midi/<ch>/ counts channels from 0 (0 = MIDI channel 1), verified in REAPER.
    ap.add_argument("--channel-base", type=int, default=0, choices=(0, 1),
                    help="how REAPER numbers the channel in /vkb_midi/<ch>/: 0 = 0-15 (default, REAPER), 1 = 1-16")
    ap.add_argument("--test", action="store_true", help="send a CC1 sweep to REAPER and exit")
    args = ap.parse_args()

    osc = ReaperOsc(args.reaper_host, args.reaper_port, args.channel_base)
    if args.test:
        run_test_sweep(osc, channel=1, cc=1)
        return

    async def serve():
        server = await asyncio.start_server(make_handler(osc), "0.0.0.0", args.port)
        print(f"Sending OSC to REAPER at {args.reaper_host}:{args.reaper_port}")
        print("Open one of these on the tablet (same Wi-Fi):")
        for addr in lan_addresses() or ["<this PC's IP>"]:
            print(f"    http://{addr}:{args.port}")
        print("(Use your Wi-Fi address, usually 192.168.x.x - not a VPN address.)")
        print("Ctrl+C to stop.")
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
