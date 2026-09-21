/**
 * 開発用のHTTPS証明書を作る。
 *
 * スマホの実機からIPアドレスで開くには、証明書のSANに
 * 「IP Address:」としてそのIPが入っている必要がある。
 * DNS名として入れてもブラウザは認めない。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const OUT_DIR = new URL('../certs/', import.meta.url);

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net.address);

const san = [
  'DNS:localhost',
  'IP:127.0.0.1',
  ...ips.map((ip) => `IP:${ip}`),
].join(',');

mkdirSync(OUT_DIR, { recursive: true });

execFileSync('openssl', [
  'req', '-x509', '-nodes',
  '-newkey', 'rsa:2048',
  '-keyout', new URL('dev-key.pem', OUT_DIR).pathname,
  '-out', new URL('dev-cert.pem', OUT_DIR).pathname,
  '-days', '365',
  '-subj', '/CN=localhost',
  '-addext', `subjectAltName=${san}`,
], { stdio: 'inherit' });

console.log(`\n証明書を作成しました。対象:\n  ${san.split(',').join('\n  ')}`);
if (ips.length === 0) {
  console.warn('\n警告: LAN内のIPが見つかりません。Wi-Fiに接続してから再実行してください。');
}
