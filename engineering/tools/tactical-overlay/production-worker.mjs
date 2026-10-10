// Persistent, bounded SVG rasterizer. stdout is a uint32 length + RGBA frame stream.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {compileProduction, validateProductionSnapshot, renderProductionSvg, sampleProduction} from '../player-review/tactics-production.mjs';
import {validateDocument} from '../player-review/tactics-document.mjs';

const require = createRequire(import.meta.url);
function loadSharp() {
  const paths = [process.env.TACTICS_SHARP_MODULE, 'sharp', join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')].filter(Boolean);
  for (const path of paths) { try { return require(path); } catch {} }
  throw new Error('未找到 Sharp SVG 渲染器；安装 sharp 或设置 TACTICS_SHARP_MODULE 为已安装模块路径。');
}
async function write(buffer) { if (!process.stdout.write(buffer)) await once(process.stdout, 'drain'); }
try {
  const sharp = loadSharp(); sharp.cache(false); sharp.concurrency(2);
  const request = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await validateDocument(request.document);
  const nativePlan = compileProduction(request.document, request.options);
  const plan = request.productionPlan ? validateProductionSnapshot(request.document, request.productionPlan) : nativePlan;
  if (plan.totalFrames > 18000 || plan.width * plan.height > 3840 * 2160) throw new Error('成片超出本地渲染上限。');
  for (let i = 0; i < plan.totalFrames; i++) {
    const svg = renderProductionSvg(request.document, sampleProduction(plan, i), {nameOverlay:request.options?.nameOverlay});
    const {data, info} = await sharp(Buffer.from(svg), {limitInputPixels: 3840 * 2160}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.width !== plan.width || info.height !== plan.height || info.channels !== 4) throw new Error('叠加图尺寸不一致。');
    const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
    await write(header); await write(data);
  }
} catch (error) { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; }
