// =====================================================================
//  Сборка готовых списков «бизнес без сайта» из OpenStreetMap.
//  Запускается GitHub Actions раз в сутки (или вручную):
//    node scripts/build-data.mjs            — все города
//    node scripts/build-data.mjs kzn ivn    — только указанные
//  Результат: data/<key>.json  →  { city, updated, cats: { barber: { total, leads: [...] } } }
// =====================================================================
import fs from 'node:fs/promises';
import { CATEGORIES, categoryOf, overpassFilters } from '../categories.js';

const UA = 'lead-bot/1.0 (GitHub Actions; OpenStreetMap data)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const SITE_TAGS = ['website', 'contact:website', 'url', 'brand:website'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function findArea(name) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  Object.entries({ q: name, countrycodes: 'ru', format: 'jsonv2', limit: '10', 'accept-language': 'ru' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('nominatim ' + r.status);
  const rel = (await r.json()).filter(x => x.osm_type === 'relation');
  const best = rel.find(x => ['city', 'town'].includes(x.addresstype)) || rel[0];
  if (!best) throw new Error('город не найден: ' + name);
  return 3600000000 + Number(best.osm_id);
}

async function overpass(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(180000),
        });
        if (r.ok) return await r.json();
        console.log(`  ${url.split('/')[2]}: ${r.status}`);
      } catch (e) { console.log(`  ${url.split('/')[2]}: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`); }
    }
    await sleep(30000 * (attempt + 1));
  }
  throw new Error('все серверы Overpass недоступны');
}

function lead(el) {
  const t = el.tags;
  return {
    name: t.name,
    address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', '),
    phone: t.phone || t['contact:phone'] || '',
    socials: ['contact:vk', 'contact:instagram', 'contact:telegram', 'vk', 'instagram']
      .filter(k => t[k]).map(k => k.replace('contact:', '')),
    lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon,
  };
}

async function buildCity(city) {
  const area = await findArea(city.name);
  const q = '[out:json][timeout:170];area(id:' + area + ')->.a;(' +
    overpassFilters().map(f => 'nwr' + f + '(area.a);').join('') + ');out center tags;';
  const data = await overpass(q);

  const cats = Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, { total: 0, leads: [] }]));
  const seen = new Set();
  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (!t.name || t.brand || t['brand:wikidata']) continue; // без названия и сетевые — пропускаем
    const cat = categoryOf(t);
    if (!cat) continue;
    const key = cat + '|' + t.name.toLowerCase() + '|' + (t['addr:street'] || '') + (t['addr:housenumber'] || '');
    if (seen.has(key)) continue;
    seen.add(key);
    cats[cat].total++;
    if (!SITE_TAGS.some(k => t[k])) cats[cat].leads.push(lead(el));
  }
  for (const c of Object.values(cats)) c.leads.sort((a, b) => Number(!!b.phone) - Number(!!a.phone));
  return { city: city.name, updated: new Date().toISOString().slice(0, 10), cats };
}

const cities = JSON.parse(await fs.readFile(new URL('../cities.json', import.meta.url)));
const only = process.argv.slice(2);
await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });

let failed = 0;
for (const city of cities.filter(c => !only.length || only.includes(c.key))) {
  console.log('▶', city.name);
  try {
    const res = await buildCity(city);
    await fs.writeFile(new URL(`../data/${city.key}.json`, import.meta.url), JSON.stringify(res));
    console.log('  ✓', Object.entries(res.cats).map(([k, v]) => `${k}:${v.leads.length}/${v.total}`).join(' '));
  } catch (e) {
    failed++;
    console.log('  ✗', e.message); // старый файл остаётся — бот покажет вчерашние данные
  }
  await sleep(5000); // бережём публичные серверы
}
if (failed === cities.length) process.exit(1);
