export type AuthSession = {
  token: string;
  user: { id: number; username: string; email: string };
};

export const apiCall = async <T>(
  baseUrl: string,
  endpoint: string,
  method = 'GET',
  body?: unknown,
  token?: string
): Promise<T> => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = (payload as { error?: string }).error || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return payload as T;
};

export const registerAndLogin = async (
  baseUrl: string,
  suffix = Date.now().toString()
): Promise<AuthSession> => {
  const username = `qa_user_${suffix}`;
  const email = `qa_${suffix}@example.com`;
  const password = 'pw123456';

  await apiCall(baseUrl, '/api/auth/register', 'POST', {
    username,
    email,
    password
  });

  const login = await apiCall<{ access_token: string; user: { id: number; username: string; email: string } }>(
    baseUrl,
    '/api/auth/login',
    'POST',
    { username, password }
  );

  return {
    token: login.access_token,
    user: login.user
  };
};
