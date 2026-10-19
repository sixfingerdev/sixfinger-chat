# SixFinger sandbox imajı: modelin komut çalıştırdığı yalıtılmış ortam.
#   docker build -t sixfinger-sandbox:latest sandbox/
# Çalışma zamanında sandboxd bu imajı salt okunur, ayrıcalıksız ve kaynak sınırlı çalıştırır (bkz. docs/sandbox.md).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash coreutils findutils procps ca-certificates curl wget git ripgrep jq unzip zip tar gzip xz-utils \
      python3 python3-pip python3-venv python3-numpy python3-pandas python3-matplotlib python3-requests python3-bs4 python3-yaml \
      nodejs npm netcat-openbsd less nano sqlite3 bc \
    && rm -rf /var/lib/apt/lists/*

# Ayrıcalıksız kullanıcı (sandboxd --user 1000:1000 ile çalıştırır)
RUN groupadd -g 1000 sandbox && useradd -u 1000 -g 1000 -m -d /work -s /bin/bash sandbox \
    && chmod 755 /work

# pip/npm: /work (RAM'deki tmpfs) altında kurulum yapılabilsin
ENV HOME=/work PIP_USER=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_BREAK_SYSTEM_PACKAGES=1 \
    PYTHONUSERBASE=/work/.local NPM_CONFIG_PREFIX=/work/.npm-global \
    PATH=/work/.local/bin:/work/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /work
USER 1000:1000
CMD ["sleep", "infinity"]
