const db = require("better-sqlite3")("/app/data/db.sqlite");

const cards = [
  {
    name: "Storm Spotter",
    url: "https://storms.thunderborn.dev",
    description:
      "Storm photography planner — live radar and lightning strikes, thunder propagation rings, an HRRR forecast timeline, and photo spots that sync across devices.",
    tags: ["Leaflet", "NOAA", "Blitzortung"],
  },
  {
    name: "Maps",
    url: "https://maps.thunderborn.dev",
    description:
      "Interactive maps built on open data, no API keys. First up: a Florida traffic heatmap — every FDOT-counted road colored by how many vehicles use it per day.",
    tags: ["deck.gl", "FDOT", "Open data"],
  },
  {
    name: "Photos",
    url: "https://photos.thunderborn.dev",
    description:
      "Photography gallery for landscapes, roads, and weather — with EXIF details, location, and the story behind each shot.",
    tags: ["Astro", "Photography"],
  },
  {
    name: "Factorio Tools",
    url: "https://factorio.thunderborn.dev",
    description:
      "Utilities for Factorio players, starting with a blueprint up/downgrader that converts designs between tech tiers. Also usable as a dependency-free CLI.",
    tags: ["Python", "FastAPI", "Factorio"],
  },
  {
    name: "Renters Help",
    url: "https://renters.thunderborn.dev",
    description:
      "Move-in and move-out inspection checklists for renters — document the condition of every room and keep your deposit.",
    tags: ["Next.js", "React"],
  },
  {
    name: "Wanderer",
    url: "https://mapper.thunderborn.dev",
    description:
      "Self-hosted instance of the Wanderer wormhole mapper for EVE Online — live chain mapping and kill tracking for my corp.",
    tags: ["EVE Online", "Self-hosted"],
  },
];

const exists = db.prepare("SELECT id FROM tools WHERE url = ?");
const insert = db.prepare(
  "INSERT INTO tools (name, url, description, tags, display_order, active) VALUES (?, ?, ?, ?, ?, 1)"
);
const maxOrder = db
  .prepare("SELECT COALESCE(MAX(display_order), -1) AS m FROM tools")
  .get().m;

let order = maxOrder;
for (const c of cards) {
  if (exists.get(c.url)) {
    console.log(`skip (exists): ${c.name}`);
    continue;
  }
  order += 1;
  insert.run(c.name, c.url, c.description, JSON.stringify(c.tags), order);
  console.log(`added: ${c.name} (order ${order})`);
}

console.table(
  db
    .prepare("SELECT name, url, display_order, active FROM tools ORDER BY display_order")
    .all()
);
