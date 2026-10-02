#!/bin/sh
# Pasang penanda versi (?v=...) pada skrip lokal di mall.html supaya browser/CDN
# GitHub Pages (cache ±10 menit) tidak mencampur HTML baru dengan JS lama.
# Jalankan sebelum commit setiap kali mall-*.js berubah:  sh tools/bump-version.sh
set -e
cd "$(dirname "$0")/.."
V=$(date -u +%Y%m%d%H%M)
sed -i.bak -E "s#(src=\"mall-(world|sky|audio|post)\.js)(\?v=[0-9a-z]+)?\"#\1?v=$V\"#g" mall.html
rm -f mall.html.bak
grep -o 'mall-[a-z]*\.js?v=[0-9a-z]*' mall.html
