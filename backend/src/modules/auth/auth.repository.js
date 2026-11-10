export const findByUsername = async (exec, username) =>
  (await exec.query('select * from users where lower(username) = lower($1)', [username])).rows[0];

export const findById = async (exec, id) =>
  (await exec.query('select * from users where id = $1', [id])).rows[0];

export const registerFailure = (exec, id) =>
  exec.query(
    `update users set failed_attempts = failed_attempts + 1,
       locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where id = $1`, [id]);

export const registerSuccess = (exec, id) =>
  exec.query('update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [id]);

export const insertRefreshToken = async (exec, { userId, tokenHash, expiresAt }) =>
  (await exec.query(
    'insert into refresh_tokens (user_id, token_hash, expires_at) values ($1,$2,$3) returning id',
    [userId, tokenHash, expiresAt])).rows[0];

export const findRefreshToken = async (exec, tokenHash) =>
  (await exec.query('select * from refresh_tokens where token_hash = $1', [tokenHash])).rows[0];

export const revokeRefreshToken = (exec, id, replacedBy = null) =>
  exec.query('update refresh_tokens set revoked_at = now(), replaced_by = $2 where id = $1 and revoked_at is null', [id, replacedBy]);

export const revokeAllForUser = (exec, userId) =>
  exec.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
