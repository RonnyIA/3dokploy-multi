import http from 'node:http';
import { existsSync } from 'node:fs';

const SOCKET_PATH = '/var/run/docker.sock';

export function isDockerSocketAvailable(): boolean {
  return existsSync(SOCKET_PATH);
}

export function queryDockerSocket(apiPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isDockerSocketAvailable()) {
      return reject(new Error('Docker socket not available'));
    }

    const options: http.RequestOptions = {
      socketPath: SOCKET_PATH,
      path: apiPath,
      method: 'GET',
      headers: {
        Host: 'docker.sock',
        Accept: 'application/json',
      },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Docker socket request timed out'));
    });
    req.end();
  });
}
