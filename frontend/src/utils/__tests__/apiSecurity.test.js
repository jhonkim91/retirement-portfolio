import { __internal } from '../api';

describe('api security behavior', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    delete window.location;
    window.location = { href: 'http://localhost/' };
  });

  afterAll(() => {
    window.location = originalLocation;
  });

  it('clears local auth state and redirects on expired session (401)', async () => {
    localStorage.setItem('access_token', 'token-value');
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'tester' }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: '세션 만료' })
    });

    await expect(__internal.apiCall('/portfolio/summary')).rejects.toThrow('세션 만료');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(String(window.location.href)).toContain('/login');
  });
});
