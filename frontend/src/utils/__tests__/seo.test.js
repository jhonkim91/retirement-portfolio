import { applyPageMetadata } from '../seo';

describe('applyPageMetadata', () => {
  it('renders metadata tags for title/description/og/twitter', () => {
    applyPageMetadata({
      title: '테스트 화면',
      description: '메타데이터 테스트',
      path: '/about'
    });

    expect(document.title).toContain('테스트 화면');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('메타데이터 테스트');
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain('테스트 화면');
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toContain('테스트 화면');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain('/about');
  });
});
