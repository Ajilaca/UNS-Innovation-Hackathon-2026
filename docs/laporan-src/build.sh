#!/usr/bin/env bash
# Membuat docs/laporan.pdf dari template.html. Butuh Google Chrome, Python 3, dan `npm install` di dashboard/web/ (untuk font).
# Tangkapan layar (pantauan.png) diambil dari aplikasi yang sedang berjalan: lihat dashboard/tools/shots.mjs.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
rows = [("Skala sensor warna (0,6×)", 0), ("Laju hilang warna (0,14×)", 5), ("Fraksi warna membandel (6×)", 30), ("COD limbah (2×)", 75),
        ("Warna per COD (2×)", 75), ("Efisiensi arus (0,57×)", 80), ("Resistansi larutan (3×)", 80), ("Drift sensor (3×)", 92),
        ("Variasi antar batch (2×)", 95), ("Tegangan lebih elektroda (2×)", 98)]   # dari docs/sensitivity.md, kendali umpan balik
L, R, T, h = 190, 40, 8, 22
W = 640 - L - R
x = lambda v: L + W * v / 100
o = []
for i, (n, v) in enumerate(rows):
    y = T + i * h
    o.append(f'<rect x="{L}" y="{y+3}" width="{W}" height="13" rx="2" fill="#edf2ef"/>')
    if v:
        o.append(f'<rect x="{L}" y="{y+3}" width="{x(v)-L:.1f}" height="13" rx="2" fill="#0f7a5f"/>')
    o.append(f'<text x="{L-8}" y="{y+13}" text-anchor="end">{n}</text>')
    o.append(f'<text x="{640-R+6}" y="{y+13}" style="font-weight:600">{v}%</text>')
b = x(98)
o.append(f'<line x1="{b:.1f}" x2="{b:.1f}" y1="{T-4}" y2="{T+len(rows)*h}" stroke="#17231e" stroke-width="1" stroke-dasharray="3 3"/>')
o.append(f'<text x="{b:.1f}" y="{T+len(rows)*h+13}" text-anchor="end" class="m">Nilai dasar 98%</text>')
open("laporan.html", "w").write(open("template.html").read().replace("BARS", "\n".join(o)))
PY
google-chrome --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --no-pdf-header-footer \
  --virtual-time-budget=5000 --print-to-pdf="$PWD/../laporan.pdf" "file://$PWD/laporan.html" 2>&1 | tail -1
rm -f laporan.html
