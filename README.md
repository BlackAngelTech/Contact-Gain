# Contact Gain v2

A polished Node.js/Express contact registration site with duplicate protection and an expanded admin center.

## Duplicate protection
Phone numbers are normalized before saving:
- spaces, brackets, dashes are ignored
- 00 prefixes are converted to +
- Zimbabwe local numbers beginning with 0 are normalized using the admin country code (default 263)
- a normalized phone number can only exist once
- editing a contact also checks for duplicates
- admin can scan/purge any duplicates that may already exist in an older database

## 18 admin functions
1. Registration on/off
2. VCF download on/off
3. Maintenance mode
4. VCF export
5. CSV export
6. JSON backup
7. Duplicate scanner
8. Duplicate purge
9. Contact search
10. Contact editing
11. Single-contact deletion
12. Delete-all protection
13. Site title editor
14. Welcome-message editor
15. Registration rate limit
16. Default country-code setting
17. Activity log
18. JSON backup restore

Also included: dashboard statistics, responsive design, rate limiting, consent requirement, XSS-safe contact rendering, and server-side validation.

## Run
1. Install Node.js 18+.
2. `npm install`
3. `npm start`
4. Open `http://localhost:3000`

Demo admin password: `858280`.

### Production security
Set environment variables:
`ADMIN_PASSWORD` and `ADMIN_SESSION_TOKEN`.

For a real public deployment, use HTTPS, a proper database, secure session authentication, CSRF protection, rate limiting at the reverse proxy, backups, audit logging, access controls, and a clear privacy/retention policy. Never share the admin password publicly.


## Added deployment files
- `public/admin.html` — dedicated responsive admin dashboard.
- `render.yaml` — Render web-service configuration.
- `.gitignore` — excludes dependencies, environment files, logs and live contact data.
- `.env.example` — environment variable template.

Open `/admin.html` for the dedicated admin panel. The older embedded admin controls remain available in the public page for compatibility.
