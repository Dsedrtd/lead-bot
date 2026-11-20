# Бот «Поиск клиентов без сайта»

Telegram-бот: выбираешь город и категорию бизнеса, а бот показывает тех,
у кого в OpenStreetMap нет ссылки на сайт: название, адрес, телефон и ссылки на карты.
Пользоваться может только владелец (`OWNER_ID`).

## Как устроено
- **GitHub Actions** (`.github/workflows/data.yml`) каждый день в 04:00 МСК запускает
  `scripts/build-data.mjs`: тот собирает из OpenStreetMap данные по городам из `cities.json`
  и сохраняет их в `data/<город>.json`.
- **Cloudflare Worker** (`worker.js`) отвечает в Telegram и читает готовые файлы из
  `DATA_URL` (raw.githubusercontent.com), поэтому ответ приходит сразу.
- `categories.js` содержит категории и правила по тегам OSM. Сетевые компании (brand) не показываются.

## Добавить город
Допишите строку в `cities.json` (`key` пишется латиницей и должен быть коротким), закоммитьте,
затем на GitHub откройте **Actions → «Обновить списки» → Run workflow** или дождитесь ночи.

## Собрать данные локально

```bash
node scripts/build-data.mjs kzn ivn
```

## Бот (из этой папки)

```bash
npx wrangler@4 deploy
```

```bash
npx wrangler@4 tail
```

Секреты задаются в Cloudflare: `BOT_TOKEN`, `WEBHOOK_SECRET`, `OWNER_ID`
(`npx wrangler@4 secret put <ИМЯ>`). После смены токена откройте
`https://lead-bot.forma-trener.workers.dev/setup?key=<WEBHOOK_SECRET>`.

## Ограничения
- Это данные OpenStreetMap: в крупных городах их много, в небольших мало. Перед тем как
  писать бизнесу, проверьте по ссылке «Яндекс Карты», что сайта действительно нет.
