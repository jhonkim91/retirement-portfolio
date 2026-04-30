export const fetchJson = async (url: string, init: RequestInit = {}): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`http ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }
  return response.json();
};
