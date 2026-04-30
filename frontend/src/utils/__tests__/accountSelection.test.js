import { pickInitialAccountProfile } from '../api';

describe('account selection helpers', () => {
  it('keeps an explicitly stored account when it still exists', () => {
    const profiles = [
      { account_name: '퇴직연금', is_default: true, has_data: false, is_empty: true, has_name_issue: false },
      { account_name: '주식 통장', is_default: false, has_data: true, is_empty: false, has_name_issue: false }
    ];

    expect(pickInitialAccountProfile(profiles, '퇴직연금')?.account_name).toBe('퇴직연금');
  });

  it('prefers a populated account when stored selection is missing and default is empty', () => {
    const profiles = [
      { account_name: '퇴직연금', is_default: true, has_data: false, is_empty: true, has_name_issue: false },
      { account_name: '주식 통장', is_default: false, has_data: true, is_empty: false, has_name_issue: false }
    ];

    expect(pickInitialAccountProfile(profiles, '없는 계좌')?.account_name).toBe('주식 통장');
  });

  it('falls back to the default account when every account is empty', () => {
    const profiles = [
      { account_name: '퇴직연금', is_default: true, has_data: false, is_empty: true, has_name_issue: false },
      { account_name: 'IRP 보조', is_default: false, has_data: false, is_empty: true, has_name_issue: false }
    ];

    expect(pickInitialAccountProfile(profiles, '')?.account_name).toBe('퇴직연금');
  });
});
