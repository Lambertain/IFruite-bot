думай на русском
делай комит и пуш в гит

# iFruite Bot — Instagram AI Sales Assistant

## Суть
AI-бот для магазина Apple техники. Мониторит Instagram Direct через AdsPower, отвечает на вопросы о наличии/ценах из Airtable, отправляет на апрув менеджеру в Telegram.

## Стек
- Node.js (CommonJS) + Playwright + Grammy (Telegram) + OpenAI API
- Airtable для каталога товаров
- AdsPower для Instagram профиля

## Структура
- `src/` — исходный код
- `src/info/` — информация о магазине (стиль, категории, сервис, гарантия)
- `data/` — рантайм данные (gitignored)

## Переменные окружения
- TELEGRAM_BOT_TOKEN — токен Telegram бота
- TELEGRAM_CHAT_ID — ID чата iFruite
- OPENAI_API_KEY — ключ OpenAI API
- ADSPOWER_API_KEY — ключ AdsPower API
- ADSPOWER_API_BASE — база AdsPower API (default: http://local.adspower.net:50325)
- ADSPOWER_PROFILE_ID — ID профиля Instagram в AdsPower
- AIRTABLE_API_KEY — ключ Airtable API
- AIRTABLE_BASE_ID — ID базы Airtable
- SCAN_INTERVAL_MIN — интервал сканирования в минутах (default: 5)

## GitHub
- Repo: https://github.com/Lambertain/IFruite-bot.git

## Production Server
- IP: 185.203.242.10
- OS: Windows Server
- SSH: Administrator / 7ow1s82cM41L (только paramiko)
- AdsPower: http://local.adspower.net:50325
- AdsPower profile ID: k1agd7gr (Instagram)
- Приложение: C:\iFruite
- Task Scheduler: iFruiteBot

## Airtable
- Base ID: appO1e1yuLbJguQ4W
- Таблицы: iPhones, Exchange Rates
