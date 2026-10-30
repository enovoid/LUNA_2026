// Open Graph 이미지(1200×630): 어두운 브랜드 배경 위의 루나 로고. 빌드 때 한 번 만든다.
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import logo from '../assets/luna.svg?raw';

export const GET: APIRoute = async () => {
  const inner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const size = 300;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#3A3A60"/>
      <stop offset="0.72" stop-color="#0E0D14"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#907FDF" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#907FDF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="600" cy="315" r="260" fill="url(#glow)"/>
  <g transform="translate(${600 - size / 2} ${315 - size / 2}) scale(${size / 738})">${inner}</g>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
