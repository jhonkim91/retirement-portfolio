import fs from 'fs';
import path from 'path';

describe('web visibility assets', () => {
  const publicDir = path.resolve(__dirname, '../../public');

  it('serves robots and sitemap definitions', () => {
    const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
    const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Sitemap:');
    expect(sitemap).toContain('<urlset');
    expect(sitemap).toContain('/privacy-policy');
  });

  it('contains a no-js service description shell', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    expect(html).toContain('<noscript>');
    expect(html).toContain('자산관리 대장');
    expect(html).toContain('현황 대시보드');
  });

  it('keeps route-level code splitting in app router', () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
    expect(appSource).toContain('lazy(() => import(');
    expect(appSource).toContain('<Suspense');
  });
});
