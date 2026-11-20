// Категории бизнеса: ключ (уходит в callback_data), подпись и правила по тегам OpenStreetMap.
export const CATEGORIES = {
  barber: { label: '💈 Барбершопы и парикмахерские', tags: [['shop', /^hairdresser$/]] },
  beauty: { label: '💅 Салоны красоты',              tags: [['shop', /^(beauty|massage)$/]] },
  auto:   { label: '🚗 Автосервисы',                 tags: [['shop', /^car_repair$/], ['amenity', /^car_repair$/]] },
  tyres:  { label: '🛞 Шиномонтаж',                  tags: [['shop', /^tyres$/]] },
  dent:   { label: '🦷 Стоматологии',                tags: [['amenity', /^dentist$/], ['healthcare', /^dentist$/]] },
  fit:    { label: '🏋️ Фитнес',                      tags: [['leisure', /^fitness_centre$/], ['sport', /^yoga$/]] },
  flower: { label: '💐 Цветы',                       tags: [['shop', /^florist$/]] },
  bakery: { label: '🍰 Кондитерские и пекарни',      tags: [['shop', /^(bakery|confectionery|pastry)$/]] },
  vet:    { label: '🐾 Ветклиники',                  tags: [['amenity', /^veterinary$/], ['shop', /^pet_grooming$/]] },
  repair: { label: '🔑 Мастерские и ремонт',         tags: [['shop', /^repair$/], ['craft', /^(electronics_repair|shoemaker|key_cutter|tailor|watchmaker)$/]] },
};

/** К какой категории относится объект OSM (или null). */
export function categoryOf(t) {
  for (const [key, c] of Object.entries(CATEGORIES))
    if (c.tags.some(([k, re]) => t[k] && re.test(t[k]))) return key;
  return null;
}

/** Фильтр Overpass для всех категорий сразу. */
export function overpassFilters() {
  const out = [];
  for (const c of Object.values(CATEGORIES))
    for (const [k, re] of c.tags) out.push(`["${k}"~"${re.source}"]`);
  return [...new Set(out)];
}
