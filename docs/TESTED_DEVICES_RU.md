# Проверенные устройства GameSpace

[Основная документация](../README.md) ·
[Кейс разработки](CASE_STUDY_RU.md)

В таблице перечислены фактически проведённые проверки GameSpace на физических
устройствах.

Для PWA на Android контрольными средами считаются Chrome (Chromium) и Firefox (Gecko).
Названия показывают фактически проверенный браузер и движок и не являются
рекомендацией производителя. Другие поддерживаемые браузеры также могут работать.

Год выпуска — год первого выхода модели на рынок. Строки отсортированы по
убыванию года, затем по названию модели и типу приложения: APK, затем PWA.
Ссылки в первой колонке ведут к источникам годов выпуска.

| Год выпуска | Устройство | ОС | Браузер/режим | Версия GameSpace | Архив | Результат |
|---|---|---|---|---|---|---|
| [2025][year-iphone17] | iPhone 17 Pro | iOS 26.5.2 | PWA, установлена на экран «Домой» | 0.3.7 | Демо-архив, 7z | ✅ Работает |
| [2025][year-pad2] | Xiaomi Redmi Pad 2 Pro | Xiaomi HyperOS 3.0.301.0, Android 16 | APK, Android WebView | 0.3.7 | 2,3 ГБ, 7z | ✅ Работает |
| [2025][year-pad2] | Xiaomi Redmi Pad 2 Pro | Xiaomi HyperOS 3.0.301.0, Android 16 | PWA, Chrome 150.0.7871.187 | 0.3.7 | 2,3 ГБ, 7z | ✅ Работает |
| [2024][year-note13-4g] | Xiaomi Redmi Note 13 Pro 4G (512 ГБ) | HyperOS 3.0.301.0, Android 16 | PWA, Chrome 151.0.7922.71 | 0.3.7 | 2,3 ГБ, 7z | ✅ Работает |
| [2019][year-note8] | Xiaomi Redmi Note 8 Pro | MIUI Global 12.5.3, Android 11 | APK, Android WebView | 0.3.6 | 2,3 ГБ, 7z | ✅ Работает |
| [2019][year-note8] | Xiaomi Redmi Note 8 Pro | MIUI Global 12.5.3, Android 11 | PWA, Chrome 151.0.7922.173 | 0.3.6 | Встроенное демо, 7z | ✅ Работает |
| [2018][year-note6] | Xiaomi Redmi Note 6 Pro | Android 8.1.0 | APK, Chrome WebView 138.0.7204.180 | 0.3.13 | Демо-архив, 7z | ✅ Работает |
| [2018][year-note6] | Xiaomi Redmi Note 6 Pro | Android 8.1.0 | PWA, Chrome 138.0.7204.180 | 0.3.13 | Импорт не проверен | ❌ Не запускается: сбой WebAPK (DEX 039) |

Результат «Работает» означает, что содержимое архива было установлено и
запускалось на указанном устройстве в соответствующем варианте GameSpace.

На Xiaomi Redmi Note 6 Pro страница установки PWA 0.3.13 открывается в Chrome
138.0.7204.180, приложение устанавливается и создаёт значок. Запуск со значка
завершается сбоем WebAPK: Android 8.1.0 не поддерживает обнаруженный формат
DEX 039. Журнал содержит сообщение `Unrecognized version number ...: 0 3 9`
и ошибку загрузки `org.chromium.webapk.shell_apk.h2o.SplashContentProvider`.
Сбой происходит до открытия GameSpace; импорт и работа архивов в установленной
PWA на этом устройстве не проверены.

Поддержка DEX 039 появилась в Android 9, согласно
[документации Android](https://source.android.com/docs/core/runtime/dex-format?hl=en).
Этот результат описывает полученную оболочку WebAPK в указанной среде;
причина выдачи несовместимого пакета по журналу не установлена.

Совместимость PWA на Android зависит от браузера и способа установки.
Для актуального Chrome Google указывает требование
[Android 10 и новее](https://support.google.com/chrome/answer/16737843?hl=en).

На планшетах Redmi Pad 2 Pro успешно проверены установка PWA 0.3.7 и APK 0.3.7,
импорт больших архивов 2,3 ГБ в каждое приложение и работа их содержимого.

На iPhone 17 Pro приложение PWA 0.3.7 установлено через меню Добавить на экран
«Домой». Демо-архив загружен, работа его содержимого проверена успешно. Название
и версия браузера в отчёте о проверке не указаны.

[year-note6]: https://indianexpress.com/article/technology/mobile-tabs/xiaomi-redmi-note-6-pro-price-in-india-features-specifications-sale-5458893/
[year-note8]: https://ir.mi.com/system/files-encrypted/nasdaq_kms/assets/2021/07/27/4-00-59/2019Q3.pdf
[year-note13-4g]: https://www.mi.com/uk/support/faq/details/KA-91489/
[year-iphone17]: https://support.apple.com/en-us/docs/iphone/301245
[year-pad2]: https://www.mi.com/global/support/faq/details/KA-608151/
