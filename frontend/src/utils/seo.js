const DEFAULT_TITLE = '자산관리 대장';
const DEFAULT_DESCRIPTION = '국내 주식, ETF, 연금 계좌를 한 화면에서 기록하고 점검하는 자산관리 대장';

const upsertMeta = (selector, attributes) => {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => {
      node.setAttribute(key, value);
    });
    document.head.appendChild(node);
  }
  return node;
};

const removeMeta = (selector) => {
  const node = document.head.querySelector(selector);
  if (node) {
    node.remove();
  }
};

export const applyPageMetadata = ({
  title,
  description,
  path = '/',
  image = '',
  noindex = false
} = {}) => {
  const finalTitle = title ? `${title} | ${DEFAULT_TITLE}` : DEFAULT_TITLE;
  const finalDescription = description || DEFAULT_DESCRIPTION;
  const origin = window.location?.origin || '';
  const canonicalUrl = `${origin}${path || '/'}`;

  document.title = finalTitle;
  upsertMeta('meta[name="description"]', { name: 'description' }).setAttribute('content', finalDescription);
  upsertMeta('meta[property="og:title"]', { property: 'og:title' }).setAttribute('content', finalTitle);
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }).setAttribute('content', finalDescription);
  upsertMeta('meta[property="og:type"]', { property: 'og:type' }).setAttribute('content', 'website');
  upsertMeta('meta[property="og:url"]', { property: 'og:url' }).setAttribute('content', canonicalUrl);

  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }).setAttribute('content', image ? 'summary_large_image' : 'summary');
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }).setAttribute('content', finalTitle);
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }).setAttribute('content', finalDescription);
  upsertMeta('meta[name="robots"]', { name: 'robots' }).setAttribute('content', noindex ? 'noindex,nofollow' : 'index,follow');

  if (image) {
    upsertMeta('meta[property="og:image"]', { property: 'og:image' }).setAttribute('content', `${origin}${image}`);
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image' }).setAttribute('content', `${origin}${image}`);
  } else {
    removeMeta('meta[property="og:image"]');
    removeMeta('meta[name="twitter:image"]');
  }

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', canonicalUrl);
};
