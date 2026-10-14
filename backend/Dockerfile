# Stage 1: Build Rust binary
FROM rust:1.85-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifest and source files
COPY Cargo.toml ./
COPY src ./src

# Build release binary
RUN cargo build --release --bin backend

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim AS runner

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libsqlite3-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create directory for persistent SQLite database
RUN mkdir -p /data

# Copy compiled binary from builder
COPY --from=builder /app/target/release/backend /usr/local/bin/backend

EXPOSE 8080

ENV PORT=8080
ENV DATABASE_URL="sqlite:///data/solana-vps.sqlite?mode=rwc"
ENV RUST_LOG="backend=info,tower_http=info"
ENV TREASURY_WALLET="DemoTreasury111111111111111111111111111111"

VOLUME ["/data"]

CMD ["backend"]
