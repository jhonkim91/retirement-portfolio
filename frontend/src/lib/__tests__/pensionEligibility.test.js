import {
  classifyInstrument,
  evaluateProductEligibility,
  summarizeRetirementEligibility
} from '../pensionEligibility';

describe('pensionEligibility', () => {
  it('classifies KRX ETF-style instruments as pension-eligible ETFs', () => {
    const result = classifyInstrument({
      product_name: 'KODEX AI전력핵심설비',
      product_code: '487240',
      asset_type: 'risk',
      unit_type: 'share'
    });

    expect(result.classification).toBe('pension_eligible_etf');
    expect(result.riskBucket).toBe('risk');
  });

  it('blocks direct stock-like instruments for retirement accounts', () => {
    const result = evaluateProductEligibility({
      accountType: 'retirement',
      accountCategory: 'irp',
      product: {
        product_name: '삼성전자',
        product_code: '005930',
        asset_type: 'risk',
        current_value: 1000000
      },
      holdings: []
    });

    expect(result.classification).toBe('prohibited_for_pension');
    expect(result.status).toBe('blocked');
  });

  it('warns when IRP/DC risk share exceeds the guide threshold', () => {
    const summary = summarizeRetirementEligibility({
      accountType: 'retirement',
      accountCategory: 'irp',
      cashAmount: 100000,
      products: [
        {
          product_name: 'KODEX AI전력핵심설비',
          product_code: '487240',
          asset_type: 'risk',
          current_value: 800000
        },
        {
          product_name: '교보악사파워인덱스',
          product_code: 'K55207BU0715',
          asset_type: 'risk',
          current_value: 400000
        }
      ]
    });

    expect(summary).not.toBeNull();
    expect(summary.riskShare).toBeGreaterThan(70);
    expect(summary.rules.find((rule) => rule.label.includes('70'))?.passed).toBe(false);
  });
});
