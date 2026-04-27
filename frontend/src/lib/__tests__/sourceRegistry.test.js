import {
  buildDataBadgeDescriptor,
  buildFreshnessMixWarning,
  inferSourceKeyFromCode
} from '../sourceRegistry';

describe('sourceRegistry', () => {
  it('infers source keys from codes', () => {
    expect(inferSourceKeyFromCode('487240')).toBe('naver');
    expect(inferSourceKeyFromCode('K55207BU0715')).toBe('funetf');
    expect(inferSourceKeyFromCode('SPY')).toBe('yahoo');
  });

  it('builds data badge descriptors with freshness metadata', () => {
    const badge = buildDataBadgeDescriptor({
      source: 'Naver',
      asOf: '2026-04-28T15:20:00',
      code: '487240'
    });

    expect(badge.name).toBeTruthy();
    expect(badge.freshnessClass).toBe('delayed_20m');
    expect(badge.asOfLabel).toContain('2026-04-28');
  });

  it('warns when freshness policies are mixed', () => {
    const warning = buildFreshnessMixWarning([
      { source: 'Naver', freshnessClass: 'delayed_20m', code: '487240' },
      { source: 'FunETF', freshnessClass: 'end_of_day', code: 'K55207BU0715' }
    ]);

    expect(warning).toBeTruthy();
  });
});
