import { randomBytes, scrypt } from 'node:crypto';

if (process.stdin.isTTY) {
  console.error('Read the password from stdin; do not pass it as a command-line argument.');
  process.exit(2);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const password = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
if (!password || password.length > 256) {
  console.error('Password must contain 1–256 characters.');
  process.exit(2);
}

const salt = randomBytes(16);
const digest = await new Promise((resolve, reject) => {
  scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => {
    if (error) reject(error);
    else resolve(value);
  });
});
process.stdout.write(`scrypt$16384$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}\n`);
