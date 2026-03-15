FROM ghcr.io/anomalyco/opencode:latest

ENV OPENCODE_HOST=0.0.0.0
ENV OPENCODE_PORT=4096
ENV HOME=/home/opencode

# Install Node.js, git, and other tools
RUN apk add --no-cache nodejs npm git

# Create user and set permissions
RUN addgroup -S opencode && adduser -S -G opencode -h /home/opencode opencode

COPY entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

USER opencode
WORKDIR /workspace

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /bin/sh -c 'nc -z 127.0.0.1 "$OPENCODE_PORT" || exit 1'

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]