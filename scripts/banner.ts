// Writes the profile banner, light and dark, from the design system's primitive colours and
// its display font. `--check` writes nothing and fails when a committed banner differs from
// what it would write.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import opentype from "opentype.js";
import wawoff2 from "wawoff2";

type Token = { $value?: { hex: string } };

const resolve = (specifier: string): string => fileURLToPath(import.meta.resolve(specifier));

const primitives = JSON.parse(
  readFileSync(resolve("@abereghici/tokens/source/primitive.tokens.json"), "utf8"),
) as { primitive: Record<string, Token> };

const color = (name: string): string => {
  const hex = primitives.primitive[`palette-${name}`]?.$value?.hex;
  if (!hex) throw new Error(`No primitive colour palette-${name}`);
  return hex;
};

// GitHub serves README images through a proxy that loads no fonts, so the text is drawn as
// paths. Noto Serif's default instance is the regular weight.
const ttf = await wawoff2.decompress(
  readFileSync(resolve("@abereghici/tokens/fonts/NotoSerif-latin.woff2")),
);
const serif = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));

const WIDTH = 1280;
const HEIGHT = 320;

const STATEMENT = "Built to be built on.";
const TEXT_LEFT = 72;
const TEXT_SIZE = 60;

// Brâncuși's endless column: each column is a stack of beads, wide at the joints and narrow
// at the necks. A bead is 1.2 times as tall as its column is wide, and the neck is 30% of it.
type Column = { width: number; shade: number; offset: number };

// The columns fill the banner's right side, leaving the left to the statement. Shades index
// the variant's `shades`, from the darkest; -1 is the one ember column. Offsets shift each
// column's beads up, as a fraction of a bead, so the joints don't line up.
const COLUMNS: Column[] = [
  { width: 60, shade: 0, offset: 0.35 },
  { width: 92, shade: 1, offset: 0.8 },
  { width: 60, shade: 3, offset: 0.1 },
  { width: 124, shade: -1, offset: 0.55 },
  { width: 60, shade: 2, offset: 0.25 },
  { width: 96, shade: 1, offset: 0.7 },
  { width: 84, shade: 3, offset: 0.15 },
];

type Variant = { ground: string; shades: string[]; ember: string; text: string };

const VARIANTS: Record<"light" | "dark", Variant> = {
  light: {
    ground: color("moss-900"),
    shades: [color("moss-800"), color("moss-700"), color("moss-600"), color("moss-500")],
    ember: color("ember-400"),
    text: color("lichen-200"),
  },
  dark: {
    ground: color("night-950"),
    shades: [color("night-800"), color("night-700"), color("lichen-800"), color("lichen-700")],
    ember: color("ember-400"),
    text: color("lichen-200"),
  },
};

const round = (n: number): number => Math.round(n * 10) / 10;

const column = (left: number, { width, offset }: Column): string => {
  const bead = width * 1.2;
  const half = bead / 2;
  const inset = width * 0.35;
  const right = left + width;
  const top = -bead * (offset + 1);
  const steps = Math.ceil((HEIGHT - top) / half) + 1;
  const edge = (outer: number, inner: number) =>
    Array.from({ length: steps }, (_, i) => [i % 2 ? outer : inner, top + i * half] as const);
  const points = [...edge(right, right - inset), ...edge(left, left + inset).reverse()];
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
};

const columnsWidth = COLUMNS.reduce((sum, { width }) => sum + width, 0);
const columnsLeft = WIDTH - columnsWidth;

// The statement sits on the banner's middle: its capitals are centred vertically
const capHeight = (serif.tables.os2 as { sCapHeight: number }).sCapHeight;
const baseline = HEIGHT / 2 + (capHeight / serif.unitsPerEm) * TEXT_SIZE / 2;
const textRight = TEXT_LEFT + serif.getAdvanceWidth(STATEMENT, TEXT_SIZE);
if (textRight > columnsLeft - 48) {
  throw new Error(`The statement ends at ${round(textRight)}, too close to the columns`);
}
const statement = serif.getPath(STATEMENT, TEXT_LEFT, baseline, TEXT_SIZE).toPathData(1);

const render = ({ ground, shades, ember, text }: Variant): string => {
  let left = columnsLeft;
  const polygons = COLUMNS.map((c) => {
    const fill = c.shade === -1 ? ember : shades[c.shade];
    const polygon = `<polygon points="${column(left, c)}" fill="${fill}"/>`;
    left += c.width;
    return polygon;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${STATEMENT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${ground}"/>`,
    `<path d="${statement}" fill="${text}"/>`,
    ...polygons,
    "</svg>",
    "",
  ].join("\n");
};

const check = process.argv.includes("--check");
let stale = false;
for (const [name, variant] of Object.entries(VARIANTS)) {
  const path = fileURLToPath(new URL(`../.github/assets/banner-${name}.svg`, import.meta.url));
  const svg = render(variant);
  if (!check) {
    writeFileSync(path, svg);
    continue;
  }
  let committed = "";
  try {
    committed = readFileSync(path, "utf8");
  } catch {}
  if (committed !== svg) {
    console.error(`${path} is out of date: run pnpm build`);
    stale = true;
  }
}
if (stale) process.exit(1);
