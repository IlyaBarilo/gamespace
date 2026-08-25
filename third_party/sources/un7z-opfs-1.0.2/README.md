# Сведения о соответствующем исходном коде: un7z-opfs 1.0.2 / 7-Zip 26.02

GameSpace распространяет неизменённые файлы `7zz.js` и `7zz.wasm` из npm-пакета
`un7z-opfs` версии 1.0.2.

Точный исходный npm-пакет находится рядом с настоящим README:

```text
un7z-opfs-1.0.2.tgz
sha256 3f079c61aa636e8aa6d9b6ab7c6e390453671d484c4f877f90f0412d9c75ddfe
sha512-mSEHck/538VWeixlift7TL6Wb8PxcE+84hJ4w2yCc51s7jSBwNfjPIRl6Mxs1Syr3wonDYMYI8KS/JTWKkE4DQ==
```

Первоначальный адрес загрузки:

```text
https://registry.npmjs.org/un7z-opfs/-/un7z-opfs-1.0.2.tgz
```

Исходный проект и инструкции по сборке:

```text
https://github.com/caiiiycuk/un7z-opfs
```

Двоичный файл WASM сообщает, что содержит архиватор 7-Zip 26.02. Снимок
исходного кода точного вышестоящего тега находится рядом с настоящим README:

```text
7zip-26.02-source.tar.gz
sha256 7e5600ad0b21918bc41803bd84d0c2967e097fb7fbaa2e7aeb90beeb1121e54b
```

Первоначальные адреса вышестоящего проекта:

```text
https://github.com/ip7z/7zip/releases/tag/26.02
https://www.7-zip.org/
```

При сборке `un7z-opfs` используются Emscripten SDK 6.0.5, патч
`7zz-emcc.patch` и реализация файловой системы `src-glue/opfs_fs.js`. Точный
патч, исходный код интеграции, лицензия, сгенерированные файлы, метаданные
пакета и инструкции по сборке находятся внутри включённого исходного
npm-пакета. GameSpace не вносит изменений в исходный код `7zz.js` или
`7zz.wasm`: файлы скопированы без изменений и могут быть заменены совместимой
повторной сборкой.
