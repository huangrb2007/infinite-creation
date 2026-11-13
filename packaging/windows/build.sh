#!/usr/bin/env bash
# 在 Linux 上构建 Windows 安装包（需要 node 22、pnpm、bun、npm、makensis、curl、unzip）
#   bash packaging/windows/build.sh 0.2.0
# 产物：dist/DuanjuStudio-Setup-<版本>.exe
set -euo pipefail
VERSION="${1:-0.0.0}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/dist/win-build"
STAGE="$WORK/stage"
NODE_VER="v22.23.4"
rm -rf "$STAGE" && mkdir -p "$STAGE/app" "$STAGE/node" "$STAGE/bin" "$WORK/dl"

echo "[1/5] 构建前端与后端"
cd "$ROOT"
pnpm install --frozen-lockfile
(cd studio && pnpm build)
NODE_ENV=production NODE_OPTIONS=--max-old-space-size=6144 pnpm build

echo "[2/5] 拷贝程序文件"
cd "$STAGE/app"
for f in server.js next.config.mjs jsconfig.json LICENSE README.md config.example.json; do cp "$ROOT/$f" .; done
cp -r "$ROOT/app" "$ROOT/lib" "$ROOT/public" "$ROOT/skills" "$ROOT/workflows" "$ROOT/harness-skills" .
mkdir -p studio scripts vendor/openclaude .next packaging
cp -r "$ROOT/studio/dist" studio/
cp "$ROOT/scripts/serve-web.mjs" scripts/
cp -r "$ROOT/scripts/subtitle" scripts/ 2>/dev/null || true
cp -r "$ROOT/vendor/openclaude/dist" "$ROOT/vendor/openclaude/package.json" vendor/openclaude/
(cd "$ROOT/.next" && tar cf - --exclude=./cache .) | (cd .next && tar xf -)
cp "$ROOT/packaging/windows/launcher.mjs" packaging/

echo "[3/5] 安装 Windows 版运行依赖（版本与本地构建一致）"
node -e "
const root=process.argv[1]; const p=require(root+'/package.json'); const deps={};
for (const d of Object.keys(p.dependencies)) deps[d]=require(root+'/node_modules/'+d+'/package.json').version;
require('fs').writeFileSync('package.json', JSON.stringify({name:'duanju-studio',private:true,version:'$VERSION',type:'module',dependencies:deps},null,2));
" "$ROOT"
npm install --omit=dev --os=win32 --cpu=x64 --no-audit --no-fund
# 运行时不需要 SWC 编译器（只有构建时用），去掉省 140MB
rm -rf node_modules/@next/swc-*

echo "[4/5] 下载便携 Node 与 ffmpeg"
cd "$WORK/dl"
[ -f node.zip ] || curl -sSLo node.zip "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-x64.zip"
unzip -qo node.zip "node-$NODE_VER-win-x64/node.exe" "node-$NODE_VER-win-x64/LICENSE"
cp "node-$NODE_VER-win-x64/node.exe" "node-$NODE_VER-win-x64/LICENSE" "$STAGE/node/"
[ -f ff.zip ] || curl -sSLo ff.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
unzip -qo ff.zip '*/bin/ffmpeg.exe' '*/bin/ffprobe.exe' '*/LICENSE'
cp ffmpeg-*/bin/ffmpeg.exe ffmpeg-*/bin/ffprobe.exe "$STAGE/bin/"
cp ffmpeg-*/LICENSE "$STAGE/bin/FFMPEG_LICENSE.txt"

echo "[5/5] 生成安装包"
cd "$ROOT/packaging/windows"
makensis -V2 -DVERSION="$VERSION" -DMODE=start -DOUTFILE="$STAGE/DuanjuStudio.exe" launch-stub.nsi
makensis -V2 -DVERSION="$VERSION" -DMODE=stop -DOUTFILE="$STAGE/DuanjuStudio-stop.exe" launch-stub.nsi
makensis -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$ROOT/dist/DuanjuStudio-Setup-$VERSION.exe" installer.nsi
echo "完成：$ROOT/dist/DuanjuStudio-Setup-$VERSION.exe"
