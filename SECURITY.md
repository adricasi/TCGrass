# Security policy

## Reporting a vulnerability
Please **don't open a public issue** for security problems. Report them privately through
GitHub: **Security → Report a vulnerability** on this repository
(<https://github.com/adricasi/TCGrass/security/advisories/new>).

Include what you found, how to reproduce it and the impact you expect. You'll get an
acknowledgement as soon as possible, and we'll agree on a disclosure date once a fix is ready.
Please don't access other players' data, run denial-of-service tests or use automated scanners
against the public instance at tcgrass.duckdns.org.

## Supported versions
Only the latest `main` (the version deployed at tcgrass.duckdns.org) receives fixes.

## Especially interesting
- Anything that stores, logs or leaks a captured photo.
- Reading or forging a player secret, or acting as another player.
- Creating, duplicating or stealing cards, or influencing the rarity roll.
- Bypassing trade locks, friendship checks, capture cooldowns or daily caps.
- Script injection through card data, display names or model output.

## How the project is protected
- Strict Content Security Policy, HSTS and other security headers set by the API.
- Player secrets stored only as SHA-256 hashes and accepted only in the `Authorization`
  header; logs redact credentials.
- Model output validated with zod against the catalogue; flavor text rendered as text.
- Dependencies pinned in `package-lock.json`, `npm audit` and a secret scan in CI,
  GitHub Actions pinned by commit SHA, and Dependabot updates.
- The container runs read-only as a non-root user; the release agent pulls images by digest.
