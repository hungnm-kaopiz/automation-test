import fs from "fs";

const P_ID = Number(process.argv[2] ?? 27);
const INPUT = "api.json";
const OUTPUT = `api.p_id-${P_ID}.json`;

const raw = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
const filtered = (raw.data as Array<{ p_id: number }>).filter(
  (item) => item.p_id === P_ID
);

fs.writeFileSync(OUTPUT, JSON.stringify({ ...raw, data: filtered }, null, 2));
console.log(`Found ${filtered.length} items with p_id=${P_ID} -> ${OUTPUT}`);
