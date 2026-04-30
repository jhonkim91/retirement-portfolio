# Web Rendering & Performance Budget

## Core Budget Targets
- LCP: `<= 2.5s`
- INP: `<= 200ms`
- CLS: `<= 0.1`

## Implemented Controls
- Route-level code splitting via `React.lazy` + `Suspense`
- Chart module split (`StockScreener` price chart lazy component)
- Metadata layer (`title`, `description`, `og`, `twitter`, `canonical`, `robots`)
- Static SEO assets: `robots.txt`, `sitemap.xml`, `manifest.json`
- No-JS fallback shell in `public/index.html`

## Measurement Workflow
1. `npm run build`
2. `npm run analyze` to inspect chunk sizes
3. Run Lighthouse in production deployment and verify:
   - LCP <= 2.5s
   - INP <= 200ms
   - CLS <= 0.1

## Notes
- `sitemap.xml` currently uses placeholder domain `https://example.com`.  
  Replace with your production domain before release.
