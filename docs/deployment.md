# Production Deployment

This runbook deploys the API to an Oracle Cloud Ubuntu VM, PostgreSQL on that VM, private media in Cloudflare R2, and the React app to Cloudflare Pages. Replace `example.com` with the domain in your Cloudflare zone. Keep all passwords and access keys out of Git and chat.

## Architecture

- `https://app.brightlookhomes.in`: Cloudflare Pages frontend.
- The browser calls the same-origin `/api/*` path. A Cloudflare Pages Function forwards it to `API_ORIGIN` (`https://api.brightlookhomes.in`), which resolves to Nginx on the Oracle VM and then the API on `127.0.0.1:4000`.
- PostgreSQL listens only on the VM's loopback interface.
- R2 is a private bucket. The API checks project access, then streams attachments from R2; the browser never receives R2 credentials or public object URLs.
- GitHub Actions deploys backend changes pushed to `main`. Cloudflare Pages builds the frontend and Pages Function from the same branch after Pages is connected to GitHub.

## 1. Create the R2 bucket

1. In Cloudflare, create an R2 bucket, for example `brightlook-crm-media`. Leave it private; do not enable public access or attach a public bucket domain.
2. Create an R2 API token with object read/write access limited to this bucket. Save the access key ID and secret directly in the VM's backend `.env` during step 4. The secret is shown only when created.
3. Note the Cloudflare account ID and exact bucket name. R2 uses the endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; the app uses S3-compatible requests with region `auto`.
4. No browser-to-R2 CORS rule is required because files are streamed through the API. Hard-deleted files are recorded in a PostgreSQL cleanup queue and retried if an R2 delete temporarily fails.

## 2. Create and secure the Oracle VM

Use an Ubuntu 22.04 or 24.04 VM. Oracle's Ampere A1 shape may be available in the Always Free tier, subject to current account quotas and regional capacity. Use a reserved public IP if available. Do not expose PostgreSQL or port 4000 to the public internet.

In the Oracle network security list/NSG, allow SSH (TCP 22) only from your admin IP, and HTTP/HTTPS (TCP 80/443) as required. On the VM:

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib rsync curl ca-certificates
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Install Node.js 22 LTS and PM2 using the official NodeSource instructions for Ubuntu, then:

```bash
sudo npm install --global pm2
sudo mkdir -p /var/www/brightlook-crm/backend
sudo chown -R "$USER":"$USER" /var/www/brightlook-crm
```

The SSH user used by GitHub Actions must be able to write under `/var/www/brightlook-crm` and run `npm`, `pm2`, and `rsync` without an interactive sudo prompt.

## 3. Create the PostgreSQL database

Ubuntu's default PostgreSQL configuration should listen on localhost only. Verify it with `sudo ss -ltnp | grep 5432`; do not open port 5432 in Oracle ingress or UFW.

Create a dedicated database role and database. Set the role password interactively so it does not enter shell history:

```bash
sudo -u postgres psql
```

At the `psql` prompt:

```sql
CREATE ROLE brightlook_app LOGIN;
\password brightlook_app
CREATE DATABASE brightlook OWNER brightlook_app;
\q
```

Use a URL-encoded password in `DATABASE_URL` if it contains URL-special characters. Test access from the VM with `psql -h 127.0.0.1 -U brightlook_app -d brightlook`; it should prompt for the password.

## 4. Configure the production API

Copy the application source to the VM once, or let the GitHub Actions workflow in step 6 create/update the directory. Create `/var/www/brightlook-crm/backend/.env` on the VM (never commit it):

```dotenv
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://brightlook_app:<URL_ENCODED_PASSWORD>@127.0.0.1:5432/brightlook
JWT_SECRET=<long-random-secret>
SEED_ADMIN_PASSWORD=<unique-admin-password>
CORS_ORIGIN=https://app.brightlookhomes.in
COOKIE_SAME_SITE=lax
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=brightlook-crm-media
R2_ACCESS_KEY_ID=<bucket-scoped-access-key>
R2_SECRET_ACCESS_KEY=<bucket-scoped-secret>
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=10
```

Generate `JWT_SECRET` on the VM with `openssl rand -base64 48`. Set restrictive permissions with `chmod 600 /var/www/brightlook-crm/backend/.env`. `COOKIE_SAME_SITE=lax` works when the frontend and API are HTTPS subdomains of the same registrable domain. Keep the values of `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, the database password, and R2 keys private.

The first API boot applies migrations. Seed only the production admin account with `npm run seed` from the backend directory; do not run `npm run seed -- --demo` in production. Then start the API under PM2:

```bash
cd /var/www/brightlook-crm/backend
npm ci --omit=dev
npm run migrate
npm run seed
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd
```

Run the `sudo` command printed by `pm2 startup` once to enable boot-time startup. Confirm the API locally with `curl -fsS http://127.0.0.1:4000/api/v1/health`.

## 5. Put Nginx and TLS in front of the API

Create a Cloudflare DNS `A` record for `api.brightlookhomes.in` pointing to the VM's reserved IP. Initially set it to DNS-only while obtaining a certificate. Create `/etc/nginx/sites-available/brightlook-api`:

```nginx
server {
    listen 80;
    server_name api.brightlookhomes.in;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and obtain a Let's Encrypt certificate:

```bash
sudo ln -s /etc/nginx/sites-available/brightlook-api /etc/nginx/sites-enabled/brightlook-api
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.brightlookhomes.in
```

In Cloudflare, set SSL/TLS mode to **Full (strict)**. You may then enable the DNS proxy for `api.example.com`. Keep the API port and PostgreSQL port private; only Nginx should be internet-facing.

## 6. Enable backend deployments from GitHub

The checked-in workflow `.github/workflows/deploy-backend.yml` runs for backend changes pushed to `main`, copies `backend/` to the VM, installs production dependencies, runs migrations, then reloads PM2. It deliberately preserves `.env`, uploads, and database files on the VM.

1. Add the VM's public SSH key for the deploy user to `~/.ssh/authorized_keys` on the VM.
2. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `DEPLOY_HOST`: VM reserved IP or hostname.
   - `DEPLOY_USER`: SSH deploy username.
   - `DEPLOY_SSH_KEY`: the matching private key (paste only into GitHub Secrets, never into this repository or chat).
   - `DEPLOY_SSH_KNOWN_HOSTS`: verified `ssh-keyscan -H <VM_HOST>` output. Verify the VM host-key fingerprint independently before trusting it.
3. Push the workflow to `main`. Confirm the **Deploy backend** action succeeds, then check `https://api.example.com/api/v1/health`.

Database migrations run before PM2 reload. Keep schema changes backward-compatible with the currently running API so an automatic Pages deployment cannot get ahead of an incompatible backend change.

## 7. Deploy the frontend to Cloudflare Pages

Do this after the API health check passes:

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select `brightlookhomes-dev/CRM_v1`.
2. Select `main`, set the root directory to `frontend`, build command to `npm ci && npm run build`, and output directory to `dist`.
3. Add the Pages production environment variable `API_ORIGIN=https://api.brightlookhomes.in`. The checked-in Pages Function at `frontend/functions/api/[[path]].js` forwards same-origin `/api/*` requests to that API origin. Keep `VITE_API_BASE_URL=/api/v1` (the frontend default) so cookies and API requests stay same-origin in the browser.
4. Add `app.brightlookhomes.in` as a Pages custom domain only after the staging deployment and API are verified. Remove the custom domain from the old GitHub Pages configuration during cutover, then follow Pages' DNS instructions.
5. Keep the backend's `CORS_ORIGIN` set to `https://app.brightlookhomes.in` and reload the API if it changes. The Pages proxy avoids browser cross-origin requests; this exact origin remains a backend allow-list for requests forwarded through the proxy.

Pages automatically rebuilds on pushes to `main`. The backend workflow deploys backend changes on the same branch. Deploy backend changes first when coordinating a frontend feature that depends on a new API contract.

## 8. Verify production

- Open `https://api.brightlookhomes.in/api/v1/health`; expect `{"success":true,"message":"OK"}`.
- Open `https://app.brightlookhomes.in`, sign in with the production admin account, and verify login/refresh/logout. Confirm frontend API calls use the app origin's `/api/v1` path.
- Upload a small allowed image/PDF, confirm it appears in the private R2 bucket, and open it through the app. The object itself must not have a public URL.
- Verify a user without project access receives `403` for another project's attachment.
- Reboot the VM and confirm PM2 restores the API.
- Set up automated PostgreSQL backups and test a restore before relying on production data. R2 object versioning/lifecycle and backup policy should be selected in Cloudflare.

## Existing local data

Production PostgreSQL is a new database; `npm run migrate` creates its schema and `npm run seed` creates the admin. The local PGlite files under `backend/data` and uploaded files under `backend/uploads` are intentionally ignored by Git and are not deployed. If existing users/projects or attachments must be preserved, plan a one-time database and media export/import before switching users to production; do not copy the PGlite directory directly into PostgreSQL.
