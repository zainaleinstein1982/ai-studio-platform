# 🚀 TUTORIAL — Menjalankan & Menguji Atelier AI Platform Gateway

**Atelier** adalah platform API AI lengkap (12 fase / STEP):
**Foundation → Authentication → API Key → Dashboard → Gateway → Storage → Queue → Provider SDK → Text→3D → Image→3D → Video → History → Billing.**

Stack: React 19 · Vite 7 · TypeScript · Tailwind v4 · shadcn/ui · Convex (backend & database) · Convex Auth · Framer Motion · Recharts · Vitest.

---

## 1. Prasyarat

| Alat | Kebutuhan |
|---|---|
| **Bun** | `>= 1.1` (package manager — wajib, jangan pakai npm/yarn) |
| **Node.js** | `>= 20.19` |
| **Akun Convex** | Gratis di https://dashboard.convex.dev (untuk backend & database) |
| **Browser** | Chrome / Edge / Firefox terbaru |

---

## 2. Cara Menjalankan

### Opsi A — Online (Freebuff cloud, yang sedang Anda pakai sekarang)

1. Buka preview dari dashboard Freebuff: `https://<project>.freebuff.dev` (contoh: `young-planes-feel.freebuff.dev`).
2. Backend Convex sudah otomatis jalan (dev deployment `academic-pheasant-223.convex.cloud`).
3. Kalau preview blank / error, klik ikon **↻ Refresh preview** di toolbar.

### Opsi B — Lokal di komputer Anda

```bash
# 1. Clone / salin folder project, lalu masuk ke folder
cd ai-platform

# 2. Install dependensi
bun install

# 3. Hubungkan ke Convex (login sekali)
bunx convex dev --once        # memicu login + codegen tipe (_generated)
```

> Konfigurasi Convex ada di `convex.json` (sudah dibuat). Untuk project baru,
> jalankan `bunx convex init` lalu pilih project Anda.

**Terminal 1 — backend Convex** (biarkan berjalan):
```bash
bunx convex dev
```

**Terminal 2 — frontend Vite** (biarkan berjalan):
```bash
bun run dev
# → buka http://localhost:5173
```

> ⚠️ Untuk **GitHub Pages** nanti, tambahkan `base: "/<nama-repo>/"` di
> `vite.config.ts` hanya untuk build tersebut (lihat komentar di file — default
> `/` sengaja dipakai supaya preview Freebuff tidak kena redirect 302).

### Opsi C — Deploy produksi

```bash
bunx convex deploy            # deploy backend Convex ke produksi
bun run build                 # build frontend → folder dist/
# Host dist/ di Vercel, Netlify, atau GitHub Pages (SPA fallback → index.html)
```

---

## 3. Perintah Penting (di root project)

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Jalankan frontend (Vite, port 5173) |
| `bunx convex dev --once` | Codegen tipe Convex + deploy ke dev (non-interaktif) |
| `bunx convex dev` | Backend Convex development (interaktif, terminal sendiri) |
| `bunx convex deploy` | Deploy backend ke produksi |
| `bunx vitest run` | **Jalankan SEMUA tes** (saat ini **271 tes lulus**) |
| `bunx vitest run src/convex/gateway` | Tes per modul (gateway, billing, dashboard, dll) |
| `bun tsc -b --noEmit` | Typecheck seluruh project |
| `bunx eslint .` | Lint seluruh project |
| `bun run build` | Build produksi frontend |

---

## 4. 🧪 Panduan Uji Fungsional (manual, di preview)

> Urutan ini menelusuri pipeline 12 STEP. Centang tiap item setelah berhasil.

### 4.1 Landing Page (STEP 01)
- [ ] Hero "One gateway for every model." tampil dengan tema studio (off-white, serif).
- [ ] Nav: Pipeline · Platform · Providers · Docs · Sign in · Get started.
- [ ] Klik **Create your first key →** → diarahkan ke `/auth`.
- [ ] Klik **Read the docs** → membuka halaman lain dengan benar.
- [ ] Responsive: cek di lebar layar mobile (navbar mengecil, tidak overflow).

### 4.2 Authentication (STEP 02)
- [ ] Di `/auth`, pilih **Email OTP** → masukkan email → kode 6 digit terkirim → verifikasi → masuk dashboard.
- [ ] Registrasi **password** (nama + email + password) → login kembali berhasil.
- [ ] **Lupa password** → kode reset terkirim → ganti password.
- [ ] **Anonymous / guest** → bisa masuk tanpa email.
- [ ] Akses `/dashboard` tanpa login → dilempar ke `/auth?returnTo=/dashboard` → setelah login kembali ke dashboard.
- [ ] **Sign out** dari sidebar kiri bawah → kembali ke landing.

### 4.3 API Key Platform (STEP 03)
- [ ] Tab **API Keys** → **Create key** → kunci muncul sekali (`apk_...`) + prefix tampil di daftar.
- [ ] **Reveal** → hanya tampil satu kali; **Revoke** → kunci berubah status revoked.
- [ ] Atur **quota / daily limit / monthly limit / expiry** di dialog buat kunci.
- [ ] Cek tab **History** → semua aksi kunci tercatat (audit log).

### 4.4 Gateway Router (STEP 04)
- [ ] Tab **Gateway** → pilih route `text`, provider `openai/gpt-4o`, tulis prompt → **Send**.
- [ ] Lihat **live trace**: accepted → queued → dequeued → attempt → completed, lengkap dengan latency & kredit.
- [ ] Centang **Stream** → respons muncul bertahap (chunk).
- [ ] Centang **Simulate failure** → retry otomatis jalan (attempts bertambah), lalu berhasil/ gagal sesuai logika retry.
- [ ] Tab **Mission Control** → status provider & counter request ikut berubah realtime.

### 4.5 Provider SDK (STEP 05)
- [ ] Tab **SDK** → pilih provider (OpenAI, Claude, Gemini, Meshy, Runway, dll — 15 provider) → generate task.
- [ ] Lihat kontrak 6 operasi: authenticate · generate · status · cancel · download · webhook di panel provider.
- [ ] Generate **webhook secret** (muncul sekali) → tombol **Deliver** mengirim event tersign.

### 4.6 Text → 3D (STEP 06)
- [ ] Tab **Text → 3D** → ketik prompt (mis. *"a ceramic vase, matte cream"*) → **Generate**.
- [ ] Pipeline 10 tahap berjalan: optimize prompt → provider router → submit → polling → download.
- [ ] Set **completed**: unduh **GLB · FBX · OBJ** + preview render.
- [ ] Uji **Retry** (jika gagal) dan **webhook** `generation.completed` di panel bawah.

### 4.7 Image → 3D (STEP 07)
- [ ] Tab **Image → 3D** → **Upload** foto referensi (PNG/JPG).
- [ ] Validasi dimensi/format muncul; klik **Generate 3D** (tombol aktif setelah upload).
- [ ] Lihat pipeline: background removal → enhancement → **vision caption** (otomatis) → prompt optimization → mesh.
- [ ] **Completed** → unduh GLB · FBX · OBJ + Preview; tombol **Cancel task** saat proses; **Retry task (n/3)** jika gagal.

### 4.8 Video — Text & Image (STEP 08)
- [ ] Tab **Video** → mode **Text to Video** → prompt → submit → progress bar & frame counter (`progress %`, `framesRendered/totalFrames`, fps, durasi).
- [ ] Streaming: preview frame muncul saat masih rendering (jika mode streaming aktif).
- [ ] Mode **Image to Video** → upload still → vision caption → motion prompt → render.
- [ ] **Completed** → preview poster + unduh clip (mp4).

### 4.9 Storage (STEP 09)
- [ ] Tab **Storage** → lihat ringkasan bucket (`atelier-assets`, dsb) + kuota.
- [ ] **Upload object** manual → tercatat dengan ukuran & sumber (`manual`).
- [ ] Salin **signed URL** → buka di tab baru (valid selama TTL).
- [ ] Cache stats: hits per kind (image · video · glb · preview) bertambah saat file diakses ulang.

### 4.10 Queue (STEP 10)
- [ ] Tab **Queue** → **Enqueue** job dengan prioritas high/normal/low.
- [ ] Lihat worker pool: job `queued` → `processing` → `completed` sesuai slot & prioritas.
- [ ] Aktifkan **force failure** → job retry dengan backoff → ke **DLQ (dead)** setelah max attempts.
- [ ] Tab **Mission Control** → tekanan antrian (queue pressure) & backlog per antrian ter-update.

### 4.11 Dashboard / Mission Control (STEP 11)
- [ ] KPI: Credits · Revenue · Requests today · Success rate · **Live tasks** (berdenyut saat ada proses) · Storage used.
- [ ] **Provider status**: 8 kartu provider dengan state circuit breaker (closed / half-open / open).
- [ ] **Analytics**: chart 7 hari (credits + requests) + usage per provider.
- [ ] **Realtime feed**: aktivitas gateway/SDK/queue muncul live dengan badge LIVE.
- [ ] Klik mini-panel (API Keys · Team · Storage · Billing) → pindah tab terkait.

### 4.12 Billing (STEP 12)
- [ ] Tab **Billing** → pilih **paket kredit** → **Checkout** → dialog pilih provider (**Stripe / Midtrans / Xendit**) + metode (QRIS · e-wallet · VA · kartu).
- [ ] Tanpa API key, checkout berjalan **mode Simulated** → muncul pay URL + invoice pending.
- [ ] **Mark as paid** (settle) → invoice menjadi `paid`, kredit masuk saldo; atau **Cancel session**.
- [ ] Panel **Subscription**: set plan → status active + tanggal renew; **Cancel renewal** → status canceled-at-period-end; reactivate.
- [ ] **Revenue dashboard**: Gross · Fees · Net + chart 14 hari + split per provider.
- [ ] Setelah request gateway, tab Billing → **Usage** menampilkan kredit terpakai & estimasi biaya.

### 4.13 History & Docs
- [ ] Tab **History** → seluruh request (gateway, 3D, video, SDK, storage, billing) terdaftar dengan status.
- [ ] Tab **Docs** → baca panduan integrasi per modul (STEP 01–12).

---

## 5. ✅ Uji Otomatis (unit & integrasi dasar)

```bash
# Semua tes (16 file, 271 tes)
bunx vitest run

# Per modul
bunx vitest run src/convex/gateway     # circuit breaker, retry, validation
bunx vitest run src/convex/billing     # paket, checkout, webhook, revenue
bunx vitest run src/convex/dashboard   # revenue, health, queue pressure
bunx vitest run src/convex/threeD      # pipeline text→3D & image→3D
bunx vitest run src/convex/video       # pipeline video
bunx vitest run src/convex/queue       # priority, DLQ, retry
bunx vitest run src/convex/storage     # buckets, cache, signed URL
bunx vitest run src/convex/providers   # SDK contract
bunx vitest run src/convex/apiKeys.ts src/convex/keygen.ts src/convex/keyPolicy.ts
bunx vitest run src/convex/rateLimit.ts src/convex/billing/core.test.ts
```

Cek kualitas:
```bash
bun tsc -b --noEmit      # harus bersih
bunx eslint .            # 0 error
```

---

## 6. 🔧 Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Preview: `{"status":500,"message":"proxy upstream error"...}` | `base` di `vite.config.ts` tidak `/` (redirect 302 tak bisa diikuti proxy) | Pastikan tidak ada `base: "/..."`; klik **Refresh preview**. |
| Preview blank / respon lama | HMR websocket aktif di sandbox | Pastikan `server.hmr: false` di `vite.config.ts`. |
| Klik Sign in → `Failed to fetch dynamically imported module: .../src/pages/Auth.tsx` | Dev server sedang **restart** tepat saat klik (mis. setelah ubah `vite.config.ts`) — error transien | Cukup **refresh halaman** lalu coba lagi; jika tetap terjadi, cek `curl http://localhost:5173/src/pages/Auth.tsx` harus 200. |
| `Did you forget to run convex dev?` | Backend belum jalan / error compile | Jalankan `bunx convex dev --once`, perbaiki error TS, ulangi. |
| Sign-in tidak pernah selesai (loop ke /auth) | Auth config salah `customJwt` | Jangan ubah `src/convex/auth.config.ts` / `auth.ts` (lihat README). |
| Port 5173 sudah terpakai | Vite instance ganda | Matikan instance lama, jalankan ulang `bun run dev`. |
| GitHub Pages 404 selain `/` | SPA tanpa fallback + base salah | Set `base: "/<repo>/"` saat build GH Pages + fallback ke `index.html`. |

---

## 7. Struktur Kode (peta cepat)

```
src/
├─ pages/            Landing, Auth, Dashboard, NotFound
├─ components/dashboard/   Mission Control, Gateway, Text3D, Image3D, Video,
│                          Storage, Queue, SDK, API Keys, History, Billing, Docs, Account
├─ components/ui/    shadcn/ui primitives
├─ convex/
│  ├─ auth/          email OTP, password reset
│  ├─ gateway/       circuit breaker, retry, validation, providers
│  ├─ providers/     SDK contract (15 provider)
│  ├─ threeD/        pipeline text→3D & image→3D (core + tes)
│  ├─ video/         pipeline video (core + tes)
│  ├─ queue/         priority queue, DLQ (core + tes)
│  ├─ storage/       buckets, cache, signed URLs (core + tes)
│  ├─ billing/       core billing + payments (Stripe/Midtrans/Xendit seam)
│  ├─ dashboard/     revenue, health, queue pressure (core + tes)
│  ├─ schema.ts      seluruh tabel (users, apiKeys, gatewayRequests, …)
│  └─ http.ts        route HTTP: /v1/gateway, /v1/webhooks/..., /v1/billing/webhooks
```

---

Selamat mencoba! Kalau ada langkah yang gagal di checklist, kirim pesan
beserta nama tab & langkahnya — saya bantu perbaiki. 🎉
