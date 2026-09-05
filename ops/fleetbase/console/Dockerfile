# A45 production-only build overlay for the self-hosted Fleetbase Console.
# The Fleetbase application/vendor source remains unchanged; this file controls only build and serve.
FROM node:22.22.0-alpine3.22 AS builder

WORKDIR /console

RUN mkdir -p ~/.pnpm
ENV PNPM_HOME=/root/.pnpm

ARG ENVIRONMENT=production
ARG DISABLE_RUNTIME_CONFIG=false
ARG EXTENSIONS=@nutrezee/fleetops-labels-engine
ARG DISABLE_FLEETBASE_ATTRIBUTION=false
ARG CONSOLE_RELEASE=0.7.48-a55.1

ENV DISABLE_RUNTIME_CONFIG=$DISABLE_RUNTIME_CONFIG
ENV EXTENSIONS=$EXTENSIONS
ENV DISABLE_FLEETBASE_ATTRIBUTION=$DISABLE_FLEETBASE_ATTRIBUTION
ENV PATH=/root/.pnpm/bin:$PATH

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions/nutrezee-labels-engine ./extensions/nutrezee-labels-engine
COPY .npmr[c] ./

RUN npm install -g ember-cli pnpm
RUN apk update && apk add git openssh-client
RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN pnpm install --frozen-lockfile

COPY . .

# Versioning happens only inside the image build. Runtime config remains enabled explicitly even
# though Fleetbase defaults it off for an Ember production build.
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version=process.argv[1]; fs.writeFileSync('package.json', JSON.stringify(p,null,4)+'\\n');" "$CONSOLE_RELEASE" \
    && test "$ENVIRONMENT" = production \
    && test "$DISABLE_RUNTIME_CONFIG" = false \
    && pnpm build --environment "$ENVIRONMENT"

FROM nginx:alpine

COPY --from=builder /console/dist /usr/share/nginx/html

# The Nutrezee extension loads its global shell stylesheet on direct Fleet-Ops routes. Ember may
# fingerprint the engine asset in production, so expose a stable alias owned by this deployment
# layer without changing Fleetbase or extension-loader vendor source.
RUN set -eux; \
    grep -q '%22environment%22%3A%22production%22' /usr/share/nginx/html/index.html; \
    ! grep -q '%22environment%22%3A%22development%22' /usr/share/nginx/html/index.html; \
    theme_alias='/usr/share/nginx/html/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css'; \
    theme_source="$(find /usr/share/nginx/html/engines-dist/@nutrezee/fleetops-labels-engine/assets -maxdepth 1 -type f -name 'engine*.css' | sort | head -n 1)"; \
    test -n "$theme_source"; \
    if [ "$theme_source" != "$theme_alias" ]; then cp "$theme_source" "$theme_alias"; fi; \
    test -s "$theme_alias"

EXPOSE 4200

COPY nginx.conf /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
