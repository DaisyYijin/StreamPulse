#!/bin/bash
# 飞牛 fnOS 原生应用包（fpk）构建脚本。
#
# 前置：Go 1.26+、fnpack（飞牛开发者工具，若没有则只生成目录不打包）。
# 用法：./scripts/build-fnos.sh 0.1.0
set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/fnos"
mkdir -p "$OUT"

build_arch() {
  local arch="$1" fnarch="$2"
  local dir="$OUT/streampulse-$arch"
  rm -rf "$dir"
  mkdir -p "$dir/cmd" "$dir/wizard" "$dir/config" "$dir/app/ui"

  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
    -o "$dir/streampulse" "$ROOT/cmd/server"

  cp "$ROOT/deploy/fnos/cmd/main" "$dir/cmd/main"
  cp "$ROOT/deploy/fnos/cmd/install_init" "$dir/cmd/install_init"
  cp "$ROOT/deploy/fnos/cmd/install_callback" "$dir/cmd/install_callback"
  cp "$ROOT/deploy/fnos/cmd/uninstall_init" "$dir/cmd/uninstall_init"
  cp "$ROOT/deploy/fnos/cmd/uninstall_callback" "$dir/cmd/uninstall_callback"
  cp "$ROOT/deploy/fnos/cmd/upgrade_init" "$dir/cmd/upgrade_init"
  cp "$ROOT/deploy/fnos/cmd/upgrade_callback" "$dir/cmd/upgrade_callback"
  cp "$ROOT/deploy/fnos/cmd/config_init" "$dir/cmd/config_init"
  cp "$ROOT/deploy/fnos/cmd/config_callback" "$dir/cmd/config_callback"
  cp "$ROOT/deploy/fnos/wizard/install" "$dir/wizard/install"
  cp "$ROOT/deploy/fnos/config.yml" "$dir/config.yml"
  cp "$ROOT/deploy/fnos/app/ui/config" "$dir/app/ui/config"

  # manifest 注入版本与架构
  sed -e "s/@VERSION@/$VERSION/g" -e "s/@ARCH@/$fnarch/g" \
    "$ROOT/deploy/fnos/manifest.tmpl" > "$dir/manifest"

  chmod +x "$dir/cmd/"* "$dir/streampulse"

  if command -v fnpack >/dev/null 2>&1; then
    (cd "$dir" && fnpack build)
    echo "built: $dir/*.fpk"
  else
    echo "fnpack 未安装，目录已生成：$dir"
    echo "安装飞牛开发者工具后在该目录执行：fnpack build"
  fi
}

build_arch amd64 x86_64
build_arch arm64 arm

echo "完成。输出目录：$OUT"
