# Evidencia de escaneo de seguridad

- Fecha (UTC): 2026-11-20T21:49:03.153Z
- Comando: `npm run scan:security` (`node scripts/security/run-security-scans.mjs`)
- Docker Engine: 29.8.2; Node.js del host: v24.11.0
- Proyecto montado en solo lectura en `/src`; `.env` y `certs/` se ocultan con montajes vacios.
- Severidad normalizada: Semgrep ERROR=HIGH, WARNING=MEDIUM, INFO=LOW; OSV por puntaje CVSS; Gitleaks siempre HIGH; Checkov sin severidad = UNRATED.
- Archivo generado automaticamente. No editar a mano.

## Resultado de la compuerta: APROBADO

Bloquean: hallazgos CRITICAL, HIGH o UNRATED sin excepcion vigente en `scripts/security/accepted-findings.json`, herramientas que no produjeron reporte y excepciones mal formadas.


### Hallazgos bloqueantes (0)

Ninguno.

### Excepciones aplicadas (0)

Ninguna.

## Resumen por herramienta

| Herramienta | Estado | CRITICAL | HIGH | MEDIUM | LOW | INFO | UNRATED | Reporte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Semgrep (SAST) | ok | 0 | 0 | 3 | 0 | 0 | 0 | semgrep.json, semgrep.sarif |
| OSV-Scanner (SCA) | ok | 0 | 0 | 0 | 0 | 0 | 0 | osv-scanner.json |
| Trivy filesystem (vuln, secret, misconfig) | ok | 0 | 0 | 0 | 0 | 0 | 0 | trivy-fs.json |
| Trivy image (miniwasp-app:security-scan construida desde Dockerfile) | ok | 0 | 0 | 10 | 0 | 0 | 0 | trivy-image.json |
| Gitleaks (secretos, modo directorio sin git) | ok | 0 | 0 | 0 | 0 | 0 | 0 | gitleaks.json |
| Checkov (IaC: Dockerfile, docker-compose.yml) | ok | 0 | 0 | 0 | 0 | 0 | 0 | checkov.json |
| npm audit (incluye devDependencies) | ok | 0 | 0 | 0 | 0 | 0 | 0 | npm-audit.json |
| CycloneDX SBOM (@cyclonedx/cyclonedx-npm@6.0.1) | ok | 0 | 0 | 0 | 0 | 0 | 0 | sbom.cdx.json |
| Politica de licencias (derivada del SBOM CycloneDX) | ok | 0 | 0 | 0 | 2 | 0 | 0 | licenses.json |

## Detalle por herramienta

### Semgrep (SAST)

- Imagen: `semgrep/semgrep:1.184.0@sha256:cc1b68266f267878b39739373ea9985b9a78e5d64497dd875c8de100b22695ed`
- Version: `1.184.0`
- Codigo de salida: 0 (48.6 s)
- Reporte: `semgrep.json, semgrep.sarif`

```text
docker run --rm --name miniwasp-scan-semgrep-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --workdir /src semgrep/semgrep:1.184.0@sha256:cc1b68266f267878b39739373ea9985b9a78e5d64497dd875c8de100b22695ed semgrep scan --config p/javascript --config p/nodejs --config p/owasp-top-ten --config p/secrets --config p/dockerfile --config scripts/security/semgrep-rules/docker-compose.yml --metrics=off --disable-version-check --json-output=/out/semgrep.json --sarif-output=/out/semgrep.sarif src scripts Dockerfile docker-compose.yml
```

### OSV-Scanner (SCA)

- Imagen: `ghcr.io/google/osv-scanner:v2.7.1@sha256:a70ffffc2bfd33482953e5d6b64c6fcdb30239717a07b0f0d3ab2859ce3e4cde`
- Version: `osv-scanner version: 2.7.1`
- Codigo de salida: 0 (3.9 s)
- Reporte: `osv-scanner.json`
- Notas: paquetes analizados: 410

```text
docker run --rm --name miniwasp-scan-osv-scanner-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --workdir /src ghcr.io/google/osv-scanner:v2.7.1@sha256:a70ffffc2bfd33482953e5d6b64c6fcdb30239717a07b0f0d3ab2859ce3e4cde scan source --lockfile /src/package-lock.json --format json --output /out/osv-scanner.json
```

### Trivy filesystem (vuln, secret, misconfig)

- Imagen: `aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb`
- Version: `Version: 0.76.2`
- Codigo de salida: 0 (14.3 s)
- Reporte: `trivy-fs.json`
- Notas: package-lock.json (npm), Dockerfile (dockerfile)

```text
docker run --rm --name miniwasp-scan-trivy-fs-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --mount type=volume,source=miniwasp-trivy-cache,target=/cache --workdir /src aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb fs --cache-dir /cache --format json --output /out/trivy-fs.json --exit-code 0 --scanners vuln,secret,misconfig --include-dev-deps --skip-dirs node_modules --skip-dirs certs --skip-dirs coverage --skip-dirs reports --skip-dirs docs/evidence --skip-dirs .scannerwork --skip-dirs .stryker-tmp --skip-files .env /src
```

### Trivy image (miniwasp-app:security-scan construida desde Dockerfile)

- Imagen: `aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb`
- Version: `Version: 0.76.2`
- Codigo de salida: 0 (19.0 s)
- Reporte: `trivy-image.json`
- Notas: /work/miniwasp-image.tar (alpine 3.24.4) (alpine), Node.js (node-pkg)

```text
docker run --rm --name miniwasp-scan-trivy-image-8288 --cap-drop ALL --security-opt no-new-privileges --mount type=bind,source=<tmp>,target=/work,readonly --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --mount type=volume,source=miniwasp-trivy-cache,target=/cache --workdir /src aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb image --cache-dir /cache --format json --output /out/trivy-image.json --exit-code 0 --scanners vuln,secret --input /work/miniwasp-image.tar
```

### Gitleaks (secretos, modo directorio sin git)

- Imagen: `zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- Version: `v8.30.1`
- Codigo de salida: 0 (1.8 s)
- Reporte: `gitleaks.json`

```text
docker run --rm --name miniwasp-scan-gitleaks-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --workdir /src zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f dir /src --config /src/.gitleaks.toml --report-format json --report-path /out/gitleaks.json --redact --no-banner --exit-code 0
```

### Checkov (IaC: Dockerfile, docker-compose.yml)

- Imagen: `bridgecrew/checkov:3.4.4@sha256:ddf34d41033624e86f7578537cf23ad6880faf5aff4cf98aca657fae315b4195`
- Version: `3.4.4`
- Codigo de salida: 0 (7.8 s)
- Reporte: `checkov.json`
- Notas: dockerfile: 65 aprobados, 0 fallidos

```text
docker run --rm --name miniwasp-scan-checkov-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --workdir /src bridgecrew/checkov:3.4.4@sha256:ddf34d41033624e86f7578537cf23ad6880faf5aff4cf98aca657fae315b4195 --file /src/Dockerfile --file /src/docker-compose.yml --output json --soft-fail --skip-download
```

### npm audit (incluye devDependencies)

- Imagen: `node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf`
- Version: `10.9.9`
- Codigo de salida: 0 (2.3 s)
- Reporte: `npm-audit.json`
- Notas: dependencias analizadas: 420

```text
docker run --rm --name miniwasp-scan-npm-audit-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --workdir /src node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf npm audit --json --include=dev
```

### CycloneDX SBOM (@cyclonedx/cyclonedx-npm@6.0.1)

- Imagen: `node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf`
- Version: `10.9.9`
- Codigo de salida: 0 (24.9 s)
- Reporte: `sbom.cdx.json`
- Notas: componentes: 394, especificacion CycloneDX 1.6

```text
docker run --rm --name miniwasp-scan-cyclonedx-8288 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=<repo>,target=/src,readonly" --mount type=bind,source=<tmp>\empty.env,target=/src/.env,readonly --mount type=tmpfs,target=/src/certs --mount "type=bind,source=<repo>\docs\evidence\security,target=/out" --env NPM_CONFIG_IGNORE_SCRIPTS=true --env NPM_CONFIG_UPDATE_NOTIFIER=false --workdir /src node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --package-lock-only --spec-version 1.6 --output-format JSON --output-file /out/sbom.cdx.json
```

### Politica de licencias (derivada del SBOM CycloneDX)

- Imagen: `ninguna (Node.js local, sin dependencias)`
- Version: `node v24.11.0`
- Codigo de salida: 0 (0.0 s)
- Reporte: `licenses.json`
- Notas: MIT: 274, Apache-2.0: 63, ISC: 20, BSD-3-Clause: 13, BlueOak-1.0.0: 8, BSD-2-Clause: 8, LGPL-3.0-only: 2, MIT-0: 2, 0BSD: 1, Apache-2.0 AND MIT: 1, CC0-1.0: 1, CC-BY-4.0: 1

```text
node scripts/security/run-security-scans.mjs (paso interno)
```

## Todos los hallazgos (15)

| Severidad | Herramienta | Regla | Ubicacion | Mensaje |
| --- | --- | --- | --- | --- |
| MEDIUM | semgrep | problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification | scripts/load/lib/session-pool.mjs:19 | Checks for setting the environment variable NODE_TLS_REJECT_UNAUTHORIZED to 0, which disables TLS verification. This should only be used for debugging purposes. Setting the opti... |
| MEDIUM | semgrep | problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification | scripts/load/lib/session-pool.mjs:60 | Checks for setting the environment variable NODE_TLS_REJECT_UNAUTHORIZED to 0, which disables TLS verification. This should only be used for debugging purposes. Setting the opti... |
| MEDIUM | semgrep | problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification | scripts/load/lib/signaling-client.mjs:40 | Checks for setting the environment variable NODE_TLS_REJECT_UNAUTHORIZED to 0, which disables TLS verification. This should only be used for debugging purposes. Setting the opti... |
| MEDIUM | trivy | CVE-2026-107496 | /work/miniwasp-image.tar (alpine 3.24.4) | libcrypto3@3.5.9-r0: Issue summary: Encrypting a CMS message to an EC certificate whose gro ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-88822 | /work/miniwasp-image.tar (alpine 3.24.4) | libcrypto3@3.5.9-r0: Issue summary: QUIC, when performing automated peer detection, may all ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-88823 | /work/miniwasp-image.tar (alpine 3.24.4) | libcrypto3@3.5.9-r0: Issue summary: The AES-GCM-SIV implementation treats a zero-length Add ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-95691 | /work/miniwasp-image.tar (alpine 3.24.4) | libcrypto3@3.5.9-r0: Issue summary: A retransmitted QUIC CRYPTO frame can release packet st ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-95692 | /work/miniwasp-image.tar (alpine 3.24.4) | libcrypto3@3.5.9-r0: Issue summary: Setting an AES-GCM-SIV IV shorter than the expected non ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-107496 | /work/miniwasp-image.tar (alpine 3.24.4) | libssl3@3.5.9-r0: Issue summary: Encrypting a CMS message to an EC certificate whose gro ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-88822 | /work/miniwasp-image.tar (alpine 3.24.4) | libssl3@3.5.9-r0: Issue summary: QUIC, when performing automated peer detection, may all ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-88823 | /work/miniwasp-image.tar (alpine 3.24.4) | libssl3@3.5.9-r0: Issue summary: The AES-GCM-SIV implementation treats a zero-length Add ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-95691 | /work/miniwasp-image.tar (alpine 3.24.4) | libssl3@3.5.9-r0: Issue summary: A retransmitted QUIC CRYPTO frame can release packet st ... (corregido en 3.5.9-r1) |
| MEDIUM | trivy | CVE-2026-95692 | /work/miniwasp-image.tar (alpine 3.24.4) | libssl3@3.5.9-r0: Issue summary: Setting an AES-GCM-SIV IV shorter than the expected non ... (corregido en 3.5.9-r1) |
| LOW | license-policy | license:LGPL-3.0-only | package-lock.json | eslint-plugin-sonarjs@4.2.2 usa LGPL-3.0-only (solo desarrollo) |
| LOW | license-policy | license:LGPL-3.0-only | package-lock.json | @sonarsource/analyzer-commons-configurations@2.31.0-5284 usa LGPL-3.0-only (solo desarrollo) |
