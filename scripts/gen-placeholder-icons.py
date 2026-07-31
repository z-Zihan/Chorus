import struct, zlib, os

def png(w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))

base = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons')
os.makedirs(base, exist_ok=True)
color = (0x63, 0x66, 0xf1, 0xff)  # --accent indigo
for name, size in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256), ('icon.png', 512)]:
    with open(os.path.join(base, name), 'wb') as f:
        f.write(png(size, size, color))
print('icons written')
