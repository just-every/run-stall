import { isActiveOperator, defaultRolePolicy, emailAllowed } from '../modules/operator-auth/accounts/roles.mjs';
import { opaqueToken } from '../modules/operator-auth/crypto.mjs';

// The installation key proves local dev access. Accept the real invitation
// through AuthStore's existing version/issuer-fenced transaction, and retain
// its dev provenance so no session from this door survives as a native login.
export async function acceptDevInvitation({ operator, store, config, hash }) {
  if (!emailAllowed(operator.email, config.allowList)) return null;
  const now = Date.now();
  const invitation = await store.first(`SELECT t.id,t.token_hash AS digest,t.issuer_id AS issuerId,t.issuer_version AS issuerVersion
    FROM oa_tokens t WHERE t.operator_id=? AND t.kind='invite' AND t.operator_version=?
    AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>? ORDER BY t.created_at DESC LIMIT 1`, [operator.id, operator.version, now]);
  if (!invitation) return null;
  const issuer = await store.operator(invitation.issuerId);
  if (!isActiveOperator(issuer, config.allowList) || issuer.version !== invitation.issuerVersion
    || !defaultRolePolicy({ actor: issuer, action: 'operators:invite', role: operator.role })) return null;
  await store.run(`INSERT INTO oa_dev_credentials(credential,id,created_at) VALUES('oa_tokens',?,?) ON CONFLICT DO NOTHING`, [invitation.id, now]);
  const token = opaqueToken(), session = { id: crypto.randomUUID(), hash: await hash(token), expiresAt: now + config.sessionSeconds * 1000 };
  const record = await store.consume(invitation.digest, now, session, config.allowList, issuer);
  return record ? { token, record } : null;
}
