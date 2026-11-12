# Runbook: rotating encryption keys

Foxalora has two keyrings. Both use the format `id:base64key,id:base64key`: the **first** key encrypts, every listed key can decrypt. Keys are 32 random bytes (`openssl rand -base64 32`) and never go into the repository, the image or the database.

| Variable | Protects | Tests |
| --- | --- | --- |
| `FOXALORA_VAULT_KEYS` | Mailbox credentials in the session vault (Valkey) | `backend/test/vault.int.test.ts` |
| `FOXALORA_MASTER_KEYS` | Data keys for sensitive configuration (envelope encryption) | `backend/test/crypto.test.ts` |

## Routine rotation (no downtime, nobody is logged out)

1. Generate a new key and give it a new id, for example `v2`.
2. Put it **in front** of the current key and restart the API instances (one at a time is fine):
   `FOXALORA_VAULT_KEYS=v2:<new>,v1:<old>`
   - Vault: new sessions use `v2`; existing sessions are re-sealed with `v2` the next time they are used.
   - Master keys: new values use `v2`. Re-wrap existing values with `envelopeRewrap()` (only the small wrapped data key changes; the payload is untouched). A CLI command will be added when the first encrypted columns exist.
3. Wait until no entry still uses the old key:
   - Vault: at most `SESSION_MAX_HOURS` (absolute session lifetime, default 12 hours).
   - Master keys: until the re-wrap job reports zero remaining values.
4. Remove the old key and restart: `FOXALORA_VAULT_KEYS=v2:<new>`.
5. Destroy every copy of the old key.

## Emergency rotation (key may be exposed)

1. Replace the key immediately **without** keeping the old one: `FOXALORA_VAULT_KEYS=v3:<new>`.
2. Restart all API instances. Every vault entry sealed with the old key becomes unreadable and is deleted on next use, so **all users must log in again**. That is intended: nobody holding the old key can use those entries.
3. If a master key is exposed, also re-encrypt (not just re-wrap) the affected configuration values and rotate the secrets they protect (for example panel API tokens), because the old data keys must be treated as exposed too.
4. Record the incident in the audit log and follow `SECURITY.md`.

## Checks

- After step 2, `GET /api/v1/auth/me` with an existing session still answers 200 (routine rotation).
- The test suites above cover old-key entries during rotation and refusal after the old key is removed.
