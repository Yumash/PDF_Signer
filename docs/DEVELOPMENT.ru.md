# PDF Signer — Руководство разработчика (RU)

English version: [DEVELOPMENT.en.md](DEVELOPMENT.en.md)
· ← [README](../README.md#русский) · [CHANGELOG](../CHANGELOG.md#русский)

## Обзор

PDF Signer — офлайн-инструмент для наложения рукописной подписи на PDF и
изображения. Работает полностью локально: фронтенд на React + Konva общается с
бэкендом FastAPI, который растрирует страницы, удаляет фон подписи и впечатывает
подписи в итоговый файл. Оригинал документа не изменяется.

## Архитектура

```
┌─────────────── Фронтенд (React 19 + Vite + Konva) ───────────────┐
│ useDocument   – открытие файла; pdfjs-dist рендерит PDF в браузере │
│                 в data URL канваса; отдаёт реальные пиксельные     │
│                 размеры страниц (pageDims) и счётчик loadId        │
│ useSignatures – CRUD библиотеки подписей через /api/signatures     │
│ useCanvas     – слои подписей по странице (+ undo/redo useHistory) │
│ CanvasEditor  – Konva-stage; drag / resize / rotate / opacity      │
│ App           – оркестрация; сборка payload экспорта               │
│ i18n          – каталоги RU/EN, t(), переключатель языка           │
└────────────────────────────────────────────────────────────────────┘
                 │  HTTP (same-origin через nginx-proxy, или :8000 в dev)
┌─────────────── Бэкенд (FastAPI · Python 3.11) ───────────────────┐
│ api/document   – /render: растр страниц (PyMuPDF) → base64 PNG     │
│ api/signatures – загрузка (удаление фона), список, image, delete   │
│ api/export     – впечатывание подписей в PDF (PyMuPDF) или image   │
│ services/      – pdf_service, pdf_writer, composer,                │
│                  signature_service                                 │
│ errors.py      – ApiError {code,message} + DomainError             │
└────────────────────────────────────────────────────────────────────┘
```

### Поток данных (экспорт)

1. Фронт рендерит каждую страницу в реальном пиксельном размере и размещает слои
   подписей в этом пространстве (Konva-stage = размер страницы, пропорции
   сохраняются).
2. При экспорте шлёт `pages` (подписи по страницам + `stage_w/stage_h` +
   опц. `jitter`) и `delete_pages`.
3. Бэкенд перерисовывает каждую подписанную PDF-страницу в 200 DPI, масштабирует
   координаты подписи на `pix / stage` (равномерно — пропорции совпадают),
   накладывает подписи (Pillow) и пересобирает документ.

## Справочник API

База: `/api`. Ошибки в формате `{ "detail": { "code": "<код>", "message": "<english>" } }`.
Фронт мапит `code` на локализованное сообщение.

### `GET /api/config`
Возвращает `{ "demo_mode": bool, "version": "<x.y.z>" }`. Статичная сборка фронта
запрашивает это при старте (она не читает env-переменные), чтобы понять, запущен
ли сервер как stateless публичное демо. См. раздел **Демо-режим** ниже.

### `POST /api/document/render`
Form: `file`. Возвращает `{ "page_count": n, "pages": ["<base64 png>", ...] }`.
Ошибки: `unsupported_file_type` (422), `file_too_large` (413), `too_many_pages`,
`page_too_large`, `image_too_large` (422).

### `POST /api/signatures?remove_bg=true|false`
Form: `file` (изображение). Возвращает `{ "id": "<uuid>", "filename", "size" }`.
Ошибки: `file_too_large` (413), `unsupported_signature_format`, `image_too_large`,
`signature_not_detected` (422 — фон не отделился от чернил).

### `GET /api/signatures`
Возвращает `[{ "id", "filename", "size" }, ...]`.

### `GET /api/signatures/{id}/image`
Возвращает PNG. `signature_not_found` (404) для неизвестного или не-UUID id.

### `DELETE /api/signatures/{id}`
Возвращает `{ "deleted": "<id>" }`. `signature_not_found` (404).

### `POST /api/export`
Form: `file`; `pages` (JSON); `delete_pages` (JSON-список индексов, опц.).
`pages` — список `{ page_idx, stage_w, stage_h, jitter, signatures: [{ id, x, y, w, h, angle, opacity }] }`.
Возвращает подписанный PDF или изображение (формат источника сохраняется).
Ошибки: `invalid_pages_payload`, `file_too_large` (413), `corrupt_pdf`,
`corrupt_image`, `page_index_out_of_range`, `stage_aspect_mismatch`,
`invalid_dimensions`, `stage_dims_required`, `invalid_signature_id`,
`coords_out_of_bounds`, `unsupported_file_type`, `too_many_pages`,
`page_too_large`, `image_too_large`, `no_pages_left` (все 422).

### `GET /health`
Возвращает `{ "status": "ok", "service": "pdf-signer-api" }`.

## Ключевое поведение

- **Удаление фона** (`signature_service._remove_bg_adaptive`): порог по яркости
  относительно бумаги (оценка по угловым пикселям); кадрирование по bbox
  альфа-канала (чернила); `signature_not_detected`, если ничего не осталось.
- **Джиттер подписи**: детерминированная вариация по инстанции с seed
  `(sig_id, page, index)`; интенсивность 0..1 со слайдера; 0 = выкл.
- **Многостраничность**: слои хранятся по индексу страницы; экспорт впечатывает
  каждую подписанную страницу.
- **Удаление страниц**: помеченные страницы исключаются из экспорта (обратимый
  переключатель, не деструктивная правка оригинала).
- **Лимиты** (анти-DoS): `MAX_FILE_SIZE` 50 МБ, `MAX_PAGES` 500,
  `MAX_PIXMAP_PIXELS` ~64 Мп, защита от decompression-bomb в Pillow.
- **Демо-режим** (`DEMO_MODE=1`, `constants.is_demo_mode()`): сервер не хранит
  ничего. `POST /api/signatures` удаляет фон в памяти и возвращает PNG инлайном в
  base64 (без записи на диск); список/изображение/переименование/удаление и
  `GET /api/history` инертны (`[]` / 404). `POST /api/export` берёт пиксели
  подписей из form-поля `signatures_data` (JSON `{ id: base64png }`, ограничено
  `MAX_SIGNATURES_DATA_BYTES` → 413 и `MAX_INLINE_SIGS`) и пропускает и копию
  результата, и запись истории. Браузер (`lib/demoStore.js`, IndexedDB) хранит
  единственную копию библиотеки и истории. Некорректное значение `DEMO_MODE`
  трактуется как «выключено» (fail-safe).

## Разработка

```bash
# Бэкенд
cd backend
pip install -r requirements.txt
uvicorn main:app --reload          # http://localhost:8000

# Фронтенд
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

`DATA_DIR` (по умолчанию `./data`) содержит `signatures/` и `output/`.

## Тестирование

```bash
pip install -r backend/requirements.txt pytest httpx
python -m pytest                   # бэкенд (pytest.ini задаёт pythonpath=backend)

cd frontend && npm run lint        # ESLint flat config
cd frontend && npm test            # Vitest (хуки, i18n)
cd frontend && npm run build       # прод-сборка
```

CI (`.github/workflows/ci.yml`) гоняет backend pytest и frontend lint, test, build на
push в main и на pull request.

## Деплой

- **Docker** (рекомендуется): `docker compose up` → http://localhost:8080.
  Бэкенд доступен только через nginx-proxy (без host-порта); контейнеры под
  non-root; `/data` — named volume.
- **Публичное демо (stateless)**: `docker compose -f docker-compose.yml -f
  docker-compose.demo.yml up`. Оверрайд ставит `DEMO_MODE=1` и убирает том данных
  (через merge-тег `!reset` — пустой список бы смёржился, а не заменил), поэтому
  сервер ничего не хранит и посетители изолированы; единственная копия — в
  браузере. Обычный `docker compose up` остаётся полностью персистентным.
- **Нативное приложение (Tauri)**: `scripts/build-exe.sh` собирает под **текущую
  ОС** и складывает инсталляторы в **`./release/`**. Скрипт собирает
  FastAPI-sidecar (PyInstaller из `backend/api_server.spec`), кладёт его под Rust
  target-triple (`api-server-<triple>[.exe]`, как в `externalBin` в
  `tauri.conf.json`), затем запускает `tauri build` (bundle `targets: "all"` →
  все форматы инсталляторов для этой ОС). Иконки версионируются в
  `src-tauri/icons/`. Нативная сборка **Windows-first** (проверена там);
  macOS/Linux идут тем же путём, но экспериментальны.

  Общие пререквизиты: **Rust/cargo**, **Python 3.11 + PyInstaller**, **Node/npm**.

  | ОС | Доп. пререквизиты | Сборка | Результат в `./release/` |
  |---|---|---|---|
  | **Windows** | WebView2 (предустановлен в Win 10/11) | `bash scripts/build-exe.sh` | `*-setup.exe` (NSIS), `*.msi` |
  | **macOS** | Xcode Command Line Tools (`xcode-select --install`) | `bash scripts/build-exe.sh` | `*.dmg`, `*.app` |
  | **Linux** | `webkit2gtk-4.1`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential` (имена для Debian/Ubuntu) | `bash scripts/build-exe.sh` | `*.deb`, `*.rpm`, `*.AppImage` |

  Tauri почти не кросс-компилирует — собирайте инсталляторы каждой ОС **на этой
  же ОС** (или её CI-раннере). Для запуска «голого» бинарника держите
  `pdf-signer` и `api-server` рядом: приложение запускает sidecar из своей папки.

  CI (`release.yml`) собирает полный релиз под **Windows** при **мерже в main**:
  авто-тег `v<версия>` (из `package.json`, если версия поднята) и публикация
  `.exe`/`.msi` + образов GHCR на этом теге; ручной тег `v*` запускает ту же
  сборку. macOS/Linux в CI пока не собираются — соберите их локально скриптом
  выше.

## Интернационализация

Ответы API локаль-агностичны (код ошибки + английское `message`). Фронт
(`src/i18n/`) держит каталоги RU/EN, хелпер `t(key, vars)`, переключатель языка и
`resolveApiError(detail, t)`, мапящий коды ошибок на локализованный текст.
