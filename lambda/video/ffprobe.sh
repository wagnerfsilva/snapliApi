#!/bin/sh
exec /opt/ffmpeg/lib/ld-linux-x86-64.so.2 --library-path /opt/ffmpeg/lib /opt/ffmpeg/bin/ffprobe "$@"