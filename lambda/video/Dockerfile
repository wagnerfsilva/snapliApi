FROM public.ecr.aws/lambda/nodejs:22 AS runtime

FROM debian:bookworm-slim AS ffmpeg

COPY --from=runtime /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core pax-utils \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/ffmpeg/bin /opt/ffmpeg/lib \
    && cp /usr/bin/ffmpeg /usr/bin/ffprobe /opt/ffmpeg/bin/ \
    && for binary in /usr/bin/ffmpeg /usr/bin/ffprobe; do \
        lddtree -l "$binary" | while read -r library; do cp -L "$library" /opt/ffmpeg/lib/; done; \
    done

FROM runtime

WORKDIR /var/task
COPY --from=ffmpeg /opt/ffmpeg /opt/ffmpeg
COPY --from=ffmpeg /usr/share/fonts/truetype/dejavu /usr/share/fonts/truetype/dejavu
COPY --from=ffmpeg /etc/fonts /etc/fonts
COPY lambda/video/ffmpeg.sh /usr/local/bin/ffmpeg
COPY lambda/video/ffprobe.sh /usr/local/bin/ffprobe
RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
COPY lambda/video/package*.json ./
RUN npm ci --omit=dev
COPY lambda/video/index.js ./lambda/video/index.js
COPY src/services/video-processing.service.js ./src/services/video-processing.service.js
RUN ffmpeg -hide_banner -filters 2>/dev/null | grep -q zscale \
    && ffmpeg -hide_banner -filters 2>/dev/null | grep -q tonemap \
    && ffmpeg -hide_banner -filters 2>/dev/null | grep -q drawtext \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264

CMD ["lambda/video/index.handler"]