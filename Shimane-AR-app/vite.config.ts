import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from 'vite';

// 開発用のHTTPS証明書。`npm run cert` で作る。
// 実機テストにはHTTPSが必須（カメラAPIが secure context を要求するため）。
const KEY = new URL('./certs/dev-key.pem', import.meta.url);
const CERT = new URL('./certs/dev-cert.pem', import.meta.url);

const hasCert = existsSync(KEY) && existsSync(CERT);
if (!hasCert) {
  console.warn('\n[警告] 証明書がありません。`npm run cert` を実行してください。');
  console.warn('       このままだと http で起動し、スマホのカメラが使えません。\n');
}

export default defineConfig({
  server: {
    host: true, // LAN内の実機（スマホ）からアクセスできるようにする
    https: hasCert
      ? { key: readFileSync(KEY), cert: readFileSync(CERT) }
      : undefined,
  },
});
