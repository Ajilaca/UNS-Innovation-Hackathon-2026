# web

Dashboard React, TypeScript, dan Vite, dalam bahasa Indonesia.

```bash
npm install
npm run dev         # hot reload, /api diteruskan ke port 8000
npm run build       # hasil di dist/, disajikan oleh backend
npx tsc --noEmit
npx vitest run
```

Grafik digambar sendiri dengan SVG. Warna dan ukuran berupa token CSS di `src/styles.css`: latar peach `#fbf3ec` dan hijau `#0f7a5f`.

- [src/](src/): kode dashboard
- [public/](public/): berkas statis
- [vendor/](vendor/): pustaka pihak ketiga yang disimpan lokal
