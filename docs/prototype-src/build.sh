#!/usr/bin/env bash
# Membuat docs/prototype.pdf dari template.html. Butuh Google Chrome, Ghostscript, Python 3, dan `npm install` di dashboard/web/ (untuk font).
# Gambar ada di img/ (salinan yang sudah diperkecil dari foto uji bench dan tangkapan layar dashboard).
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
cal = [(0, 0), (15, 0.128), (37.5, 0.371), (75, 0.601), (112.5, 0.889), (150, 1.160)]   # Tabel 2, kanal R
L, R, T, B, W, H = 58, 14, 10, 34, 340, 220
pw, ph = W - L - R, H - T - B
x = lambda v: L + pw * v / 160
y = lambda a: T + ph - ph * a / 1.3
o = []
for a in (0, 0.25, 0.5, 0.75, 1.0, 1.25):
    o.append(f'<line x1="{L}" x2="{W-R}" y1="{y(a):.1f}" y2="{y(a):.1f}" stroke="#e3e9e6"/>')
    lab = f"{a:.2f}".replace(".", ",")
    o.append(f'<text x="{L-6}" y="{y(a)+3:.1f}" text-anchor="end" class="m">{lab}</text>')
for c in (0, 40, 80, 120, 160):
    o.append(f'<text x="{x(c):.1f}" y="{H-B+14}" text-anchor="middle" class="m">{c}</text>')
o.append(f'<text x="{L+pw/2:.1f}" y="{H-4}" text-anchor="middle">Kepekatan (mg/L)</text>')
o.append(f'<text x="12" y="{T+ph/2:.1f}" text-anchor="middle" transform="rotate(-90 12 {T+ph/2:.1f})">Absorbansi semu (R)</text>')
o.append('<polyline fill="none" stroke="#0f7a5f" stroke-width="2" points="' + " ".join(f"{x(c):.1f},{y(a):.1f}" for c, a in cal) + '"/>')
for c, a in cal:
    o.append(f'<circle cx="{x(c):.1f}" cy="{y(a):.1f}" r="3.6" fill="#fff" stroke="#0f7a5f" stroke-width="2"/>')
open("prototype.html", "w").write(open("template.html").read().replace("CAL_CHART", "\n".join(o)))
PY
google-chrome --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --no-pdf-header-footer \
  --virtual-time-budget=8000 --print-to-pdf="$PWD/prototype-raw.pdf" "file://$PWD/prototype.html" 2>&1 | tail -1
# kecilkan gambar supaya di bawah batas unggah 2 MB (bukti purwarupa di portal hackathon)
gs -q -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dPDFSETTINGS=/printer -dDownsampleColorImages=true -dColorImageResolution=200 \
  -dColorImageDownsampleThreshold=1.0 -dAutoFilterColorImages=false -dColorImageFilter=/DCTEncode -dJPEGQ=80 \
  -dNOPAUSE -dBATCH -sOutputFile="$PWD/../prototype.pdf" prototype-raw.pdf
rm -f prototype.html prototype-raw.pdf
ls -l ../prototype.pdf
