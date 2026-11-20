# syntax=docker/dockerfile:1

# Etapa 1: instala solo dependencias de produccion.
# Imagen base: node:22-alpine, fijada por digest (indice multi-arquitectura) para que el
# build sea reproducible. Para actualizarla: docker pull node:22-alpine y copiar el RepoDigest.
FROM node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: ningun paquete ejecuta codigo arbitrario durante la instalacion.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# TensorFlow.js y nsfwjs traen versiones para navegador, mapas de fuente y modelos que el servidor
# no usa. En Node solo se cargan dist/*.node.js, los binarios WASM y el modelo MobileNetV2: el resto
# se elimina (de unos 330 MB a unos 12 MB), con menos superficie y una imagen mas liviana.
WORKDIR /app/node_modules
RUN for package in @tensorflow/*/; do \
      find "${package}dist" -mindepth 1 -maxdepth 1 ! -name '*.node.js' ! -name '*.wasm' -exec rm -rf {} + ; \
      rm -rf "${package}src" "${package}tools" "${package}wasm-out" "${package}scripts" "${package}.rollup.cache" ; \
    done \
    && rm -f @tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm \
    && rm -rf nsfwjs/dist/browser nsfwjs/dist/cjs nsfwjs/dist/models/inception_v3 nsfwjs/dist/models/mobilenet_v2_mid \
    && find nsfwjs @tensorflow \( -name '*.map' -o -name '*.d.ts' \) -delete
WORKDIR /app

# Etapa 2: imagen de ejecucion. Misma base: node:22-alpine.
FROM node:22-alpine@sha256:5b05da3f938f1c604b24c633646d48805a6667f378cb4908438616f3cc48a0bf AS runtime
ENV NODE_ENV=production
# apk upgrade aplica los parches de seguridad de Alpine publicados despues de la imagen base
# (p. ej. zlib CVE-2026-4738, detectado por Trivy). En ejecucion solo se usa node: se eliminan
# npm, npx, corepack y yarn (y sus dependencias empaquetadas) para reducir la superficie de ataque.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
WORKDIR /app
# Los archivos quedan con dueno root: el usuario node puede leerlos pero no modificarlos.
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER node
EXPOSE 3000
# Alpine no trae curl: se usa fetch nativo de Node contra el endpoint publico /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/server/index.js"]
