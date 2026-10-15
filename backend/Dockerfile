# syntax=docker/dockerfile:1
# Gateway image: the Axum backend serving the built frontend (owner dashboard
# and SSH signing page). Build from the repository root; see compose.yaml.
# Tagged here; hadolint cannot see tags through ARGs, hence its DL3006 ignores below.
ARG RUST_IMAGE=rust:1.98.0-trixie
ARG NODE_IMAGE=node:24.10.0-trixie-slim
ARG DEBIAN_IMAGE=debian:trixie-slim

# hadolint ignore=DL3006
FROM ${RUST_IMAGE} AS backend
WORKDIR /src
# The gateway depends on ssh/auth-core, which inherits settings from its workspace.
COPY ssh/Cargo.toml ssh/Cargo.lock ssh/
COPY ssh/auth-core ssh/auth-core
COPY backend backend
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/backend/target \
    cargo build --locked --release --manifest-path backend/Cargo.toml \
    && install -D backend/target/release/solana-auth-gateway /out/solana-auth-gateway

# hadolint ignore=DL3006
FROM ${NODE_IMAGE} AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend ./
RUN npm run build

# hadolint ignore=DL3006
FROM ${DEBIAN_IMAGE}
COPY --from=backend /out/solana-auth-gateway /usr/local/bin/
COPY --from=frontend /src/frontend/dist /opt/frontend
ENV SOLANA_FRONTEND_DIR=/opt/frontend \
    SOLANA_GATEWAY_BIND=0.0.0.0:3000
USER nobody
EXPOSE 3000
CMD ["solana-auth-gateway"]
