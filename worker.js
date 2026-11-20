// =====================================================================
//  Бот «Поиск клиентов без сайта» (Cloudflare Worker)
//  /start → город → категория → список бизнесов без сайта (по 10)
//
//  Данные: готовые списки data/<key>.json в репозитории GitHub,
//  их раз в сутки собирает GitHub Actions (scripts/build-data.mjs).
//  Секреты (wrangler secret put …): BOT_TOKEN, WEBHOOK_SECRET, OWNER_ID
//  Переменная (wrangler.toml): DATA_URL
// =====================================================================

import { DurableObject } from 'cloudflare:workers';
import { CATEGORIES } from './categories.js';
import CITIES from './cities.json';

const PAGE = 10;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/tg' && req.method === 'POST') return await onUpdate(req, env, ctx);
      if (url.pathname === '/setup') return await setup(url, env);
      return new Response('lead bot', { status: 200 });
    } catch (e) {
      return new Response('error: ' + (e.message || e), { status: 500 });
    }
  },
};

// Старый класс оставлен пустым, чтобы Cloudflare корректно удалил его миграцией v2.
export class Search extends DurableObject {}

/* ---------- Telegram API ---------- */
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return r.json();
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const send = (env, chat_id, text, reply_markup) =>
  tg(env, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
const newSearchBtn = [{ text: '🔍 Новый поиск', callback_data: 'find' }];

/* ---------- Входящие ---------- */
async function onUpdate(req, env, ctx) {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const u = await req.json();
  const from = (u.message || u.callback_query || {}).from;
  if (!from || String(from.id) !== String(env.OWNER_ID)) {
    const chat = u.message?.chat?.id;
    if (chat) await send(env, chat, 'Это личный бот, доступ закрыт.');
    return new Response('ok');
  }
  ctx.waitUntil(handle(u, env).catch(e => {
    const chat = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
    if (chat) return send(env, chat, '⚠️ ' + esc(e.message || e));
  }));
  return new Response('ok');
}

async function handle(u, env) {
  if (u.message) {
    const chat = u.message.chat.id;
    const text = (u.message.text || '').trim();
    if (!text || text.startsWith('/')) return askCity(env, chat);
    const city = CITIES.find(c => c.name.toLowerCase().replace(/ё/g, 'е') === text.toLowerCase().replace(/ё/g, 'е'));
    if (!city) {
      return send(env, chat, `Города «${esc(text)}» пока нет в списке.\n\nЧтобы добавить, впиши его в файл <code>cities.json</code> в репозитории — данные появятся после ночного обновления.`,
        { inline_keyboard: [newSearchBtn] });
    }
    return askCategory(env, chat, city.key);
  }
  const cq = u.callback_query;
  const chat = cq.message.chat.id;
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  const [kind, a, b, c] = cq.data.split('|');
  if (kind === 'find') return askCity(env, chat);
  if (kind === 'other') return send(env, chat, '✍️ Напиши название города одним сообщением.');
  if (kind === 'city') return askCategory(env, chat, a);
  if (kind === 'cat') return showPage(env, chat, a, b, 0);         // cat|<city>|<cat>
  if (kind === 'more') return showPage(env, chat, a, b, Number(c)); // more|<city>|<cat>|<offset>
}

/* ---------- Шаги ---------- */
function askCity(env, chat) {
  const rows = [];
  for (let i = 0; i < CITIES.length; i += 3)
    rows.push(CITIES.slice(i, i + 3).map(c => ({ text: c.name, callback_data: 'city|' + c.key })));
  rows.push([{ text: '✍️ Другой город', callback_data: 'other' }]);
  return send(env, chat, '🏙 <b>Выбери город:</b>', { inline_keyboard: rows });
}

function askCategory(env, chat, cityKey) {
  const city = CITIES.find(c => c.key === cityKey);
  const rows = Object.entries(CATEGORIES).map(([k, v]) => [{ text: v.label, callback_data: `cat|${cityKey}|${k}` }]);
  return send(env, chat, `📍 <b>${esc(city.name)}</b>\nКакой бизнес ищем?`, { inline_keyboard: rows });
}

async function loadCity(env, cityKey) {
  const r = await fetch(`${env.DATA_URL}/${cityKey}.json`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Не удалось загрузить список (' + r.status + '), попробуй позже');
  return r.json();
}

async function showPage(env, chat, cityKey, catKey, offset) {
  const city = CITIES.find(c => c.key === cityKey);
  const data = await loadCity(env, cityKey);
  if (!data) {
    return send(env, chat, `По городу «${esc(city.name)}» список ещё не собран — он появится после ночного обновления.`,
      { inline_keyboard: [newSearchBtn] });
  }
  const { total, leads } = data.cats[catKey] || { total: 0, leads: [] };
  const cat = CATEGORIES[catKey].label;
  const date = data.updated.split('-').reverse().slice(0, 2).join('.');
  if (!leads.length) {
    return send(env, chat, `${cat} — ${esc(city.name)}\n\nВ базе ${total}, но без сайта никого нет.\n<i>данные от ${date}</i>`,
      { inline_keyboard: [newSearchBtn] });
  }
  const lines = leads.slice(offset, offset + PAGE).map((l, i) => {
    const q = encodeURIComponent(`${l.name} ${l.address} ${city.name}`);
    return [
      `<b>${offset + i + 1}. ${esc(l.name)}</b>`,
      l.address ? '📍 ' + esc(l.address) : '📍 адрес не указан',
      l.phone ? '📞 ' + esc(l.phone) : '📞 нет телефона',
      l.socials.length ? '💬 есть: ' + l.socials.join(', ') : '',
      `🗺 <a href="https://yandex.ru/maps/?text=${q}">Яндекс Карты</a> · <a href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=18/${l.lat}/${l.lon}">OSM</a>`,
    ].filter(Boolean).join('\n');
  });
  const head = offset === 0
    ? `${cat} — <b>${esc(city.name)}</b>\nВсего в базе: ${total}, <b>без сайта: ${leads.length}</b>\n<i>данные от ${date}</i>\n\n`
    : '';
  const next = offset + PAGE;
  const kb = [];
  if (next < leads.length) kb.push([{ text: `Ещё ▶️ (${leads.length - next})`, callback_data: `more|${cityKey}|${catKey}|${next}` }]);
  kb.push(newSearchBtn);
  return send(env, chat, head + lines.join('\n\n'), { inline_keyboard: kb });
}

/* ---------- Подключение вебхука: /setup?key=<WEBHOOK_SECRET> ---------- */
async function setup(url, env) {
  if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const hook = await tg(env, 'setWebhook', {
    url: `${url.origin}/tg`, secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  const cmds = await tg(env, 'setMyCommands', { commands: [{ command: 'find', description: 'Найти клиентов без сайта' }] });
  return new Response(JSON.stringify({ hook, cmds }, null, 2), { headers: { 'content-type': 'application/json' } });
}
