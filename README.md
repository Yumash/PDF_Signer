<div align="center">

# PDF Signer

**Инструмент для наложения рукописной подписи на документы**  
**A tool for placing handwritten signatures on documents**

[![Status](https://img.shields.io/badge/version-1.1.0-brightgreen)](https://github.com/TinaUma/PDF_Signer)
[![Python](https://img.shields.io/badge/python-3.11-blue?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

[Русский](#русский) · [English](#english)

</div>

---

<a name="русский"></a>

## 🇷🇺 Русский

### Что это

PDF Signer — инструмент для наложения рукописной подписи (скан или фото) на документы PDF, JPEG, PNG. Работает **полностью локально** — никакие данные не покидают устройство. Без облаков, без регистрации.

> Запустил → открыл файл → перетащил подпись → сохранил.

### Скриншоты

<div align="center">

![Интерфейс — пошаговые подсказки и подпись на документе](screenshots/01-interface.png)

*Пошаговые подсказки в сайдбаре, канвас сразу готов к работе, кнопка экспорта активируется когда подпись размещена*

![Результат — подписанный документ](screenshots/02-signed-document.png)

*Документ подписан — подпись точно в нужном месте*

![Поворот подписи](screenshots/03-rotate-signature.png)

*Поворот, масштаб, прозрачность — полный контроль*

</div>

### Возможности

- 📄 PDF (многостраничный) и изображения — JPG, PNG, TIFF, WEBP до 50 МБ
- ✍️ Библиотека подписей — загрузи один раз, используй всегда
- 🪄 Автоматическое удаление фона — адаптивный алгоритм на основе яркости, работает офлайн
- 🖱️ Интерактивный холст — drag & drop, resize, **rotate**, прозрачность
- ↩️ Undo / Redo — в тулбаре и через Ctrl+Z / Ctrl+Y
- 💾 Экспорт PDF и JPEG — оригинал не изменяется
- 🗂️ Многостраничная подпись — свои подписи на каждой странице + кнопка «на все страницы»
- 🎲 Уникализация подписи — лёгкие отличия каждого наложения, чтобы подписи не были идентичны
- 🌐 Языки RU / EN — переключение интерфейса
- 🧭 Пошаговые подсказки — сайдбар ведёт по шагам, активный шаг подсвечен
- ⚡ Без переключения режимов — канвас готов сразу после загрузки документа
- 🔒 Всё локально — никаких облаков, никакой регистрации

### Быстрый старт

**Требования:** Docker Desktop

```bash
git clone https://github.com/TinaUma/PDF_Signer.git
cd PDF_Signer
docker compose up
```

Открыть в браузере: **http://localhost:8080**

> 🌐 **Живое демо:** [https://tinacodes.space](https://tinacodes.space)

Подписи сохраняются в `./data/signatures/` и не пропадают между перезапусками.

#### Публичное демо (ничего не хранится на сервере)

Для публичного демо запустите stateless-режим: подписи и документы обрабатываются в памяти, а единственная копия остаётся в браузере посетителя (IndexedDB). На сервере не сохраняется ничего, том данных не монтируется.

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up
```

Каждый посетитель полностью изолирован, чужие файлы на сервере не накапливаются. В интерфейсе показывается баннер демо-режима. Обычный `docker compose up` (без второго файла) остаётся полностью персистентным.

Полное руководство (HTTPS/reverse-proxy, проверка, обновление, диагностика): [docs/DEMO.ru.md](docs/DEMO.ru.md).

> 🖥️ Нативная сборка (Tauri) для Windows / macOS / Linux — `scripts/build-exe.sh`
> собирает под текущую ОС; инструкции и пререквизиты в
> [docs/DEVELOPMENT.ru.md](docs/DEVELOPMENT.ru.md#деплой). Windows-first
> (проверено), macOS/Linux экспериментальны; для веба используйте Docker.
> 📄 Техническое задание: [docs/PDF_Signer_TZ_v1.0.pdf](docs/PDF_Signer_TZ_v1.0.pdf)
> 🛠 Руководство разработчика: [docs/DEVELOPMENT.ru.md](docs/DEVELOPMENT.ru.md)
> 📜 История изменений: [CHANGELOG.md](CHANGELOG.md#русский)

### Как пользоваться

1. **Загрузи подпись** — левая панель → «+ Загрузить подпись» (JPG, PNG, TIFF, WEBP)  
   Фон удалится автоматически, можно отключить тумблером
2. **Открой документ** — кнопка «Открыть документ» или перетащи файл
3. **Перетащи** подпись из библиотеки на документ
4. **Настрой** — двигай, масштабируй, крути, меняй прозрачность; для многостраничных — «на все страницы»
5. **Сохрани** — «Вставить и сохранить» → скачается готовый файл

### Стек технологий

| Слой | Технология |
|---|---|
| Frontend | React 19 · Vite · Tailwind CSS · **Konva.js** |
| Backend | **FastAPI** · Python 3.11 · Uvicorn |
| PDF (рендер) | **pdfjs-dist** (Mozilla, в браузере) |
| PDF (запись) | **PyMuPDF** (burn-in подписи) |
| Удаление фона | Алгоритм на основе яркости пикселей · NumPy · Pillow |
| Упаковка | **Docker Compose** · nginx · (Tauri — экспериментально) |

### Автор

Разработано [TinaUma](https://github.com/TinaUma) · портфолио-проект  
AI-ассистент: [Claude Code](https://claude.ai/code) by Anthropic  
Процесс разработки под управлением [TAUSIK](https://github.com/Kibertum/tausik-core) — AI-agent governance ([SENAR v1.3](https://senar.tech))

---

<a name="english"></a>

## 🇬🇧 English

### What is it

PDF Signer is a tool for placing a handwritten signature (scan or photo) onto PDF and image documents. Works **completely offline** — no data ever leaves your device. No cloud, no registration.

> Launch → open file → drag your signature → save.

### Screenshots

<div align="center">

![Interface — step guide and signature on document](screenshots/01-interface.png)

*Step-by-step hints in sidebar, canvas ready immediately, export button activates once a signature is placed*

![Result — signed document](screenshots/02-signed-document.png)

*Document signed — signature placed exactly where needed*

![Signature rotation](screenshots/03-rotate-signature.png)

*Rotate, scale, opacity — full control*

</div>

### Features

- 📄 PDF (multi-page) and images — JPG, PNG, TIFF, WEBP up to 50 MB
- ✍️ Signature library — upload once, reuse anytime
- 🪄 Automatic background removal — luminance-based adaptive algorithm, works offline
- 🖱️ Interactive canvas — drag & drop, resize, **rotate**, opacity control
- ↩️ Undo / Redo — in the toolbar and via Ctrl+Z / Ctrl+Y
- 💾 Export to PDF and JPEG — original file stays untouched
- 🗂️ Multi-page signing — per-page signatures + an "all pages" action
- 🎲 Signature uniquification — subtle per-placement variation so signatures aren't identical
- 🌐 RU / EN — UI language switch
- 🧭 Step-by-step hints — sidebar guides through the workflow, active step highlighted
- ⚡ No mode switching — canvas is ready immediately after loading a document
- 🔒 Fully local — no cloud, no registration

### Quick Start

**Requirements:** Docker Desktop

```bash
git clone https://github.com/TinaUma/PDF_Signer.git
cd PDF_Signer
docker compose up
```

Open in browser: **http://localhost:8080**

> 🌐 **Live demo:** [https://tinacodes.space](https://tinacodes.space)

Signatures are stored in `./data/signatures/` and persist across restarts.

#### Public demo (nothing stored on the server)

For a public demo, run the stateless mode: signatures and documents are processed in memory and the only copy stays in the visitor's browser (IndexedDB). The server persists nothing and no data volume is mounted.

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up
```

Every visitor is fully isolated and no one else's files accumulate on the server. The UI shows a demo-mode banner. A plain `docker compose up` (without the second file) stays fully persistent.

Full guide (HTTPS/reverse proxy, verification, updating, troubleshooting): [docs/DEMO.en.md](docs/DEMO.en.md).

> 🖥️ Native (Tauri) builds for Windows / macOS / Linux — `scripts/build-exe.sh`
> builds for the host OS; instructions and prerequisites in
> [docs/DEVELOPMENT.en.md](docs/DEVELOPMENT.en.md#deployment). Windows-first
> (verified), macOS/Linux experimental; for the web app use Docker.
> 📄 Spec: [docs/PDF_Signer_TZ_v1.0.pdf](docs/PDF_Signer_TZ_v1.0.pdf)
> 🛠 Developer guide: [docs/DEVELOPMENT.en.md](docs/DEVELOPMENT.en.md)
> 📜 Changelog: [CHANGELOG.md](CHANGELOG.md#english)

### How to use

1. **Upload your signature** — left panel → "+ Upload signature" (JPG, PNG, TIFF, WEBP)  
   Background is removed automatically; toggle to disable
2. **Open a document** — click "Open document" or drag & drop a file
3. **Drag** a signature from the library onto the document
4. **Adjust** — move, scale, rotate, set opacity; for multi-page docs use "all pages"
5. **Save** — "Embed & Save" → the signed file downloads automatically

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite · Tailwind CSS · **Konva.js** |
| Backend | **FastAPI** · Python 3.11 · Uvicorn |
| PDF (render) | **pdfjs-dist** (Mozilla, in browser) |
| PDF (write) | **PyMuPDF** (signature burn-in) |
| Background removal | Luminance-based pixel algorithm · NumPy · Pillow |
| Packaging | **Docker Compose** · nginx · (Tauri — experimental) |

### Author

Built by [TinaUma](https://github.com/TinaUma) · portfolio project  
AI assistant: [Claude Code](https://claude.ai/code) by Anthropic  
Development governed by [TAUSIK](https://github.com/Kibertum/tausik-core) — AI-agent governance ([SENAR v1.3](https://senar.tech))

---

<div align="center">

*Built with ❤️ and [Claude Code](https://claude.ai/code)*

</div>
