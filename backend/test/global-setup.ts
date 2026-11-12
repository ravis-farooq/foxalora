import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Creates a throwaway CA and server certificates for the TLS tests (FOX-026):
 * valid "localhost", wrong host name, expired, and self-signed (untrusted).
 * Runs before the test workers start, so NODE_EXTRA_CA_CERTS reaches them; the
 * production code needs no test-only trust hook.
 */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fx-tls-'));
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });

  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Foxalora Test CA', '-keyout', 'ca-key.pem', '-out', 'ca.pem');

  // `openssl ca` (available in OpenSSL and LibreSSL) can set past validity dates.
  mkdirSync(join(dir, 'db'));
  writeFileSync(join(dir, 'db', 'index.txt'), '');
  writeFileSync(join(dir, 'db', 'serial'), '1000\n');
  writeFileSync(join(dir, 'ca.cnf'), [
    '[ ca ]', 'default_ca = test', '[ test ]', `dir = ${dir}`, 'database = $dir/db/index.txt', 'serial = $dir/db/serial',
    'new_certs_dir = $dir/db', 'certificate = $dir/ca.pem', 'private_key = $dir/ca-key.pem', 'default_md = sha256',
    'policy = any', 'copy_extensions = none', 'unique_subject = no', '[ any ]', 'commonName = supplied', '',
  ].join('\n'));

  const issue = (name: string, cn: string, extra: string[]) => {
    writeFileSync(join(dir, `${name}.ext`), `subjectAltName=DNS:${cn}\nextendedKeyUsage=serverAuth\n`);
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn}`, '-keyout', `${name}-key.pem`, '-out', `${name}.csr`);
    ssl('ca', '-batch', '-config', 'ca.cnf', '-in', `${name}.csr`, '-out', `${name}.pem`, '-extfile', `${name}.ext`, '-notext', ...extra);
  };
  issue('valid', 'localhost', ['-days', '2']);
  issue('wrongname', 'other.example', ['-days', '2']);
  issue('expired', 'localhost', ['-startdate', '200101000000Z', '-enddate', '200102000000Z']);
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', 'selfsigned-key.pem', '-out', 'selfsigned.pem');

  process.env.NODE_EXTRA_CA_CERTS = join(dir, 'ca.pem');
  process.env.FOXALORA_TEST_CERTS_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
