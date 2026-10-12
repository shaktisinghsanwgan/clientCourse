# Kajabi Partner Course Synchronization API

Node.js API that keeps two course partners in sync across an 8-week program. Each person has independent chapter progress. The next week opens only after both people finish every active chapter in the current week.

MySQL is the source of truth for identity links, chapter progress, and week access. Kajabi hosts the course. This API does not change Kajabi lessons.

## Stack

- Node.js 20+
- Express
- MySQL 8 (InnoDB, UTC)
- Prisma
- JWT
- Zod

## Kajabi plan limits

Kajabi’s official Public API is available only on plans that expose user API keys under Admin → Settings → Security. Documentation: [Kajabi API V1](https://developers.kajabi.com).

When `KAJABI_API_BASE_URL`, `KAJABI_API_KEY`, and `KAJABI_API_SECRET` are set, this server uses only documented endpoints:

- `POST /v1/oauth/token` with `grant_type=client_credentials`
- `GET /v1/customers` filtered by email search and optional `filter[site_id]`
- `GET /v1/purchases?filter[customer_id]=...&filter[active]=true`

`KAJABI_API_KEY` is the OAuth client id. `KAJABI_API_SECRET` is the client secret.

If those values are empty, the server does not call Kajabi and does not invent a connection. Kajabi user IDs are not stored from browser input.

Purchase webhooks use Kajabi’s documented `purchase` event shape (`id`, `event`, `payload`). The payload is not treated as proof of payment. The server calls the purchases endpoint and marks the user `PAID` only when Kajabi returns an active purchase. Configure the hook target URL on the server:

`https://api.yourdomain.com/api/v1/integrations/kajabi/webhook?token=YOUR_WEBHOOK_SECRET`

Do not put `ADMIN_API_KEY`, the webhook token, or Kajabi credentials in frontend code. A Kajabi thank-you page submission is not payment proof.

## Business rules

- One purchaser has one partner. One partner email cannot be linked to two purchasers.
- Week 1 is available after the invited partner has signed in. Payment is handled before the partner is saved, so this API does not check payment status.
- Week N+1 unlocks only when both users complete every active chapter in week N.
- Completion counts and percentages are calculated on the server from active chapters.
- Deactivated chapters stay in history and drop out of the completion total.
- A week with no active chapters is not complete, so it does not open the next week.
- Week 8 completion marks the course complete. Week 9 does not exist.
- Reversing a chapter recalculates progress and locks later weeks again.
- The authenticated user always comes from the JWT. Client `userId`, `paymentStatus`, and `progressPercentage` values are rejected.

## Local setup

```bash
docker compose up -d
copy .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

Docker Compose publishes MySQL on port 3307 so it does not collide with a local MySQL service on 3306. The API listens on `http://localhost:5000`.

Health check: `GET /api/v1/health`

Seed data is sample chapter counts only (5, 4, 6, 5, 4, 6, 5, 4). Replace it with `POST /api/v1/chapters/sync`. The application reads chapter counts from MySQL.

## Scripts

```bash
npm run dev
npm start
npm test
npm run lint
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

Tests use `kajabi_partner_course_test` from `.env.test`. They refuse to truncate a database whose name does not end in `_test`.

## Authentication

| Caller | Header |
| --- | --- |
| User | `Authorization: Bearer <jwt>` |
| Trusted server / chapter admin | `X-Api-Key: <ADMIN_API_KEY>` |

`POST /api/v1/users/register` returns a JWT for the purchaser. `POST /api/v1/users/login` with `{ "email" }` signs in an existing user. If that email belongs to a pending partner invitation, login creates the partner account and activates the partnership. No email code is sent.

## Main routes

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/health` | Public |
| POST | `/api/v1/users/register` | Admin key |
| POST | `/api/v1/users/login` | Public |
| POST | `/api/v1/users/sync` | JWT |
| GET | `/api/v1/users/me` | JWT |
| POST | `/api/v1/partners/link` | JWT or admin key |
| GET | `/api/v1/partners/me` | JWT |
| GET | `/api/v1/partners/progress` | JWT |
| GET | `/api/v1/course` | JWT |
| GET | `/api/v1/course/sync` | JWT |
| POST | `/api/v1/chapters/sync` | Admin key |
| POST | `/api/v1/chapters` | Admin key |
| PATCH | `/api/v1/chapters/:chapterId` | Admin key |
| PATCH | `/api/v1/chapters/:chapterId/active` | Admin key |
| GET | `/api/v1/chapters/week/:weekNumber` | JWT |
| POST | `/api/v1/chapters/complete` | JWT |
| GET | `/api/v1/progress/me` | JWT |
| GET | `/api/v1/progress/partner` | JWT |
| GET | `/api/v1/progress/week/:weekNumber` | JWT |
| POST | `/api/v1/integrations/kajabi/webhook?token=` | Webhook token |
| GET | `/api/v1/integrations/kajabi/status` | Public status only |

`GET /api/v1/course/sync` returns all 8 weeks for the signed-in user and the other partner.

Chapter completion body:

```json
{ "chapterId": "week-1-chapter-1", "completed": true }
```

Purchaser registration body (server-to-server):

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "kajabiCustomerId": "kajabi_123",
  "purchaseReference": "optional-context-only",
  "offerReference": "optional-context-only"
}
```

`paymentStatus` is not accepted. This API does not track payment. A partner is saved only after payment has already happened.

Partner link body:

```json
{ "partnerName": "Jane Doe", "partnerEmail": "jane@example.com" }
```

Admin callers also send `purchaserEmail`.

## Errors

```json
{ "success": false, "message": "You cannot access this week yet", "errorCode": "WEEK_LOCKED" }
```

Common codes: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `UNAUTHORIZED`, `VALIDATION_ERROR`, `CHAPTER_NOT_FOUND`, `CHAPTER_INACTIVE`, `WEEK_LOCKED`, `INVALID_WEEK`, `PARTNER_NOT_FOUND`, `PARTNER_NOT_REGISTERED`, `DUPLICATE_PARTNER`, `PURCHASE_NOT_VERIFIED`, `KAJABI_API_NOT_CONFIGURED`, `KAJABI_INTEGRATION_FAILURE`, `IDENTITY_CONFLICT`.

## Railway

The repo is ready for Railway. `npm start` runs `prisma migrate deploy` and then listens on Railway's `PORT`. The Prisma CLI is a production dependency, and `postinstall` generates the client during the build.

Create two services in one Railway project:

1. **MySQL** from the Railway MySQL template.
2. **This API** from this GitHub repository. Railway reads `railway.toml`.

On the API service, set these variables before the first successful deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` |
| `JWT_SECRET` | a long random string |
| `JWT_EXPIRES_IN` | `7d` |
| `ADMIN_API_KEY` | a private key for register and chapter admin |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | the public site that calls this API, if it is on another domain |

`PORT` is set by Railway. Do not point `DATABASE_URL` at `MYSQL_PUBLIC_URL` unless the API cannot reach the private network. Use the private `MYSQL_URL`.

Then:

1. Generate a public domain for the API service.
2. Open `https://<your-domain>/api/v1/health`. A healthy database returns `"database": "up"`.
3. Run the sample chapter seed once from the API service shell: `npm run db:seed`. It skips itself if chapters already exist.
4. Open `https://<your-domain>/` to use the tester. Put `ADMIN_API_KEY` in the Admin API key field.

Kajabi values stay empty until that account has API keys. The webhook target, when used, is:

`https://<your-domain>/api/v1/integrations/kajabi/webhook?token=<KAJABI_WEBHOOK_SECRET>`

## Deployment

On the VPS:

```bash
sudo apt update
sudo apt install -y nginx mysql-server
sudo mysql -e "CREATE DATABASE kajabi_partner_course CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'partner_app'@'localhost' IDENTIFIED BY 'replace-this-password';"
sudo mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON kajabi_partner_course.* TO 'partner_app'@'localhost';"
```

Set MySQL to UTC in `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```
default-time-zone = '+00:00'
```

Then `sudo systemctl restart mysql`.

```bash
cp .env.example .env
# fill production secrets
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

Copy `deploy/nginx.conf`, replace the domain, then:

```bash
sudo certbot --nginx -d api.yourdomain.com
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Do not expose ports 3306 or 5000 publicly. Nginx proxies HTTPS to the local Node process.

Back up the database daily:

```bash
mysqldump --single-transaction --routines kajabi_partner_course > /var/backups/kajabi_partner_course-$(date -u +%F).sql
```

Health monitoring can call `GET /api/v1/health`.

Required production commands:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm start
```
