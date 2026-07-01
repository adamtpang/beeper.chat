// Render build/icon.svg -> build/icon.png (512x512). electron-builder turns
// that into the Windows app + installer icon on `npm run dist`.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, '..', 'build', 'icon.svg'));
await sharp(svg, { density: 512 }).resize(512, 512).png().toFile(join(dir, '..', 'build', 'icon.png'));
console.log('wrote build/icon.png');
