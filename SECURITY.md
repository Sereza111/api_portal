# Security policy

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities involving authentication,
key handling or proxy access. Use GitHub's private vulnerability reporting for
this repository instead.

Include the affected route, configuration, reproduction steps and expected
impact. Do not include real API keys, cookies or customer data.

## Deployment baseline

- Terminate TLS before exposing the portal to the Internet.
- Keep `UPSTREAM_KEY`, `CLIENT_KEYS` and dashboard credentials outside Git.
- Set `PASSTHROUGH=0` unless forwarding unknown provider keys is intentional.
- Restrict the application port to the reverse proxy or private network.
- Rotate any credential that may have appeared in logs or issue reports.

