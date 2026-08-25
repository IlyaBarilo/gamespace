# Уведомления о сторонних компонентах

Оригинальный программный код GameSpace предоставляется по лицензии MIT,
содержащейся в файле `LICENSE`. Сторонние компоненты продолжают
распространяться на условиях собственных лицензий. Лицензия MIT проекта
GameSpace не заменяет и не ограничивает перечисленные ниже лицензии.

## Компоненты, включаемые в готовые приложения

### un7z-opfs 1.0.2 и 7-Zip 26.02 WebAssembly

- Проект: https://github.com/caiiiycuk/un7z-opfs
- Проект и исходный код 7-Zip: https://www.7-zip.org/ и
  https://github.com/ip7z/7zip/releases/tag/26.02
- Использование: распаковка 7z в GameSpace PWA
- Распространяемые файлы: `pwa-gamespace/src/vendor/7zz.js` и
  `pwa-gamespace/src/vendor/7zz.wasm`
- Лицензия: GNU LGPL 2.1 или более поздней версии с ограничением unRAR,
  указанным в вышестоящем пакете
- Copyright: 7-Zip Copyright (C) Igor Pavlov; авторские права на unRAR
  принадлежат Alexander Roshal

Включённый файл WASM сообщает, что содержит 7-Zip 26.02. GameSpace не
использует этот компонент для создания архиватора, совместимого с RAR.
Лицензия и ограничение вышестоящего пакета воспроизведены в
`third_party/licenses/7ZIP-UN7Z-LICENSE.txt`; текст LGPL 2.1 находится в
`third_party/licenses/LGPL-2.1.txt`.

Компонент хранится в отдельных файлах JavaScript и WebAssembly, поэтому его
можно заменить или повторно собрать. Точные архивы исходного кода
`un7z-opfs` и 7-Zip, контрольные суммы и сведения о сборке включены в
`third_party/sources/un7z-opfs-1.0.2/`.

### Среда выполнения Emscripten 6.0.5

- Проект: https://github.com/emscripten-core/emscripten
- Использование: сгенерированный вспомогательный код JavaScript/WebAssembly в
  сборке 7-Zip
- Лицензия: двойная лицензия MIT и University of Illinois/NCSA Open Source
  License

Версия инструментария сообщается пакетом `un7z-opfs`. Ссылка на лицензию
зафиксирована в `third_party/licenses/EMSCRIPTEN-LICENSE.md`.

### zip.js 2.8.57

- Проект: https://github.com/gildas-lormeau/zip.js
- Использование: распаковка ZIP/ZIP64 в GameSpace PWA
- Лицензия: BSD 3-Clause
- Copyright (c) 2023 Gildas Lormeau

Текст лицензии воспроизведён в
`third_party/licenses/ZIP-JS-BSD-3-CLAUSE.txt`.

### Apache Commons Compress 1.28.0

- Проект: https://commons.apache.org/proper/commons-compress/
- Использование: работа с архивами в GameSpace APK
- Лицензия: Apache License 2.0
- Copyright 2002-2025 The Apache Software Foundation

Текст Apache License воспроизведён в
`third_party/licenses/APACHE-2.0.txt`. Требуемое компонентом содержимое NOTICE
воспроизведено в `third_party/licenses/COMMONS-COMPRESS-NOTICE.txt`.

### Apache Commons Codec 1.19.0, Commons IO 2.20.0 и Commons Lang 3.18.0

- Проекты: https://commons.apache.org/proper/commons-codec/,
  https://commons.apache.org/proper/commons-io/ и
  https://commons.apache.org/proper/commons-lang/
- Использование: необходимые зависимости Commons Compress в GameSpace APK
- Лицензия: Apache License 2.0
- Copyright: The Apache Software Foundation

Общий текст Apache License воспроизведён в
`third_party/licenses/APACHE-2.0.txt`. NOTICE-файлы компонентов находятся в
`third_party/licenses/COMMONS-CODEC-NOTICE.txt`,
`third_party/licenses/COMMONS-IO-NOTICE.txt` и
`third_party/licenses/COMMONS-LANG3-NOTICE.txt`.

### XZ for Java 1.12

- Проект: https://tukaani.org/xz/java.html
- Использование: поддержка LZMA/LZMA2/XZ для 7z в GameSpace APK
- Лицензия: BSD Zero Clause License (0BSD)

XZ for Java версий 1.10 и новее предоставляется по лицензии BSD Zero Clause.
Текст лицензии воспроизведён в
`third_party/licenses/XZ-FOR-JAVA-1.12.txt`.

### Roboto 3.015

- Проект: https://github.com/googlefonts/roboto-3-classic
- Использование: встроенный демонстрационный сайт
- Файлы: `demo/games/tictac/Roboto-Regular.ttf`, `Roboto-Medium.ttf` и
  `Roboto-Bold.ttf`
- Лицензия: SIL Open Font License 1.1
- Copyright 2011 The Roboto Project Authors

Встроенные метаданные шрифтов указывают версию 3.015 (2026) и содержат ссылку
на Open Font License. Текст лицензии воспроизведён в
`third_party/licenses/ROBOTO-OFL-1.1.txt`, а для соблюдения условий лицензии в
самостоятельном демо-архиве — также в
`demo/THIRD_PARTY_LICENSES/ROBOTO-OFL-1.1.txt`.

## Репозиторий и средства сборки

### Зависимости сборки PWA

Точные воспроизводимые версии зависимостей зафиксированы в
`pwa-gamespace/package-lock.json`. К зависимостям только для сборки относятся
Vite, Rollup, esbuild, PostCSS и их транзитивные зависимости под разрешительными
лицензиями MIT, ISC, BSD 3-Clause и другими подобными лицензиями. Каталог
`node_modules` не копируется в выпуск GameSpace. При производственной сборке
дополнительно создаётся общий отчёт о лицензиях зависимостей.

### Android SDK и Android Gradle Plugin

Файлы Android SDK, загружаемые дистрибутивы Gradle и результаты сборки Android
являются локальными зависимостями сборки и исключены из публикации исходного
кода. Они не лицензируются как часть GameSpace.

## Материалы проекта

Оригинальные демонстрационные материалы GameSpace не входят в лицензию MIT и
регулируются `demo/DEMO_CONTENT_LICENSE.md`. Компоненты с отдельными
лицензиями, такие как шрифт Roboto, продолжают распространяться на собственных
условиях.
