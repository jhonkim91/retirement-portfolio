import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (url: string, timeoutMs = 90_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      // keep retrying until timeout
    }
    await wait(800);
  }
  throw new Error(`Server did not become ready in time: ${url}`);
};

export const startBackendServer = async (
  port = 5100,
  databaseFile = 'quality_gate_integration.db'
): Promise<{ baseUrl: string; process: ChildProcess; stop: () => Promise<void> }> => {
  const pythonBin = process.env.PYTHON_BIN
    || (process.platform === 'win32' ? 'py -3' : 'python');
  const cwd = path.resolve(__dirname, '../..');
  const baseUrl = `http://127.0.0.1:${port}`;

  const backendProcess = spawn(
    `${pythonBin} backend/app.py`,
    [],
    {
      cwd,
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        TESTING: '1',
        PORT: String(port),
        DATABASE_URL: `sqlite:///${databaseFile}`,
        JWT_SECRET_KEY: 'quality-gate-integration-secret-key'
      }
    }
  );

  let stdErrBuffer = '';
  backendProcess.stderr?.on('data', (chunk) => {
    stdErrBuffer += String(chunk || '');
  });

  try {
    await waitForServer(`${baseUrl}/api/version`, 120_000);
  } catch (error) {
    const reason = stdErrBuffer.trim();
    throw new Error(reason ? `Backend start failed: ${reason}` : String(error));
  }

  const stop = async () => {
    if (backendProcess.killed) return;
    backendProcess.kill('SIGTERM');
    await wait(500);
    if (!backendProcess.killed) {
      backendProcess.kill('SIGKILL');
    }
  };

  return {
    baseUrl,
    process: backendProcess,
    stop
  };
};
