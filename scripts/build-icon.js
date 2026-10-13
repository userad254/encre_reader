const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const racine = path.resolve(__dirname, '..');
const source = path.join(racine, 'build', 'icon.png');
const tailles = [16, 32, 48, 256];

async function main() {
  const pngs = [];

  for (const taille of tailles) {
    const destination = path.join(racine, 'build', `icon-${taille}.png`);
    await sharp(source)
      .resize(taille, taille, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(destination);
    pngs.push(destination);
  }

  const ico = await pngToIco(pngs);
  await fs.writeFile(path.join(racine, 'build', 'icon.ico'), ico);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});