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
# 检查：Agent 内核不能被打进产物（它内部的 import.meta.url 会被固化成构建机路径，Windows 上直接报错）
if grep -rl "file://$ROOT/vendor" .next/server >/dev/null 2>&1; then
  echo "Agent 内核被打包进了 .next，构建机路径会被固化：" && grep -rl "file://$ROOT/vendor" .next/server && exit 1
fi

echo "[2/5] 拷贝程序文件"
cd "$STAGE/app"
for f in server.js next.config.mjs jsconfig.json LICENSE README.md config.example.json; do cp "$ROOT/$f" .; done
cp -r "$ROOT/app" "$ROOT/lib" "$ROOT/public" "$ROOT/skills" "$ROOT/workflows" "$ROOT/harness-skills" "$ROOT/plugins" .
mkdir -p studio scripts vendor/openclaude .next packaging
cp -r "$ROOT/studio/dist" studio/
cp "$ROOT/scripts/serve-web.mjs" scripts/
cp -r "$ROOT/scripts/subtitle" scripts/ 2>/dev/null || true
cp -r "$ROOT/vendor/openclaude/dist" "$ROOT/vendor/openclaude/package.json" vendor/openclaude/
(cd "$ROOT/.next" && tar cf - --exclude=./cache .) | (cd .next && tar xf -)
cp "$ROOT/packaging/windows/launcher.mjs" "$ROOT/packaging/windows/tray.ps1" "$ROOT/packaging/windows/icon.ico" packaging/

echo "[3/5] 安装 Windows 版运行依赖（版本与本地构建一致）"
node -e "
const root=process.argv[1]; const p=require(root+'/package.json'); const deps={};
for (const d of Object.keys(p.dependencies)) deps[d]=require(root+'/node_modules/'+d+'/package.json').version;
require('fs').writeFileSync('package.json', JSON.stringify({name:'duanju-studio',private:true,version:'$VERSION',type:'module',dependencies:deps},null,2));
" "$ROOT"
npm install --omit=dev --os=win32 --cpu=x64 --no-audit --no-fund
# 运行时不需要 SWC 编译器（只有构建时用），去掉省 140MB
rm -rf node_modules/@next/swc-*

# 体积大、几乎不变的静态内容（Agent 内核、代码电影素材库、示例媒体）归到「运行环境」那一层：
# 升级包不带它们，完整包在标识没变时也跳过。source map 不随包分发。
find "$STAGE/app" -name '*.map' -not -path '*/node_modules/*' -delete
mkdir -p "$STAGE/heavy/skills" "$STAGE/heavy/public"
mv "$STAGE/app/vendor" "$STAGE/heavy/"
[ -d "$STAGE/app/skills/lemo-opuscar" ] && mv "$STAGE/app/skills/lemo-opuscar" "$STAGE/heavy/skills/"
[ -d "$STAGE/app/public/samples" ] && mv "$STAGE/app/public/samples" "$STAGE/heavy/public/"

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
# 运行环境标识：Node 版本 + ffmpeg 版本 + 实际装进去的依赖清单。标识没变 = 升级时不用重装那 5 万个文件
FF_VER="$(ls -d "$WORK"/dl/ffmpeg-*/ | head -1 | xargs basename)"
RUNTIME_SIG="$( { echo "$NODE_VER"; echo "$FF_VER"; (cd "$STAGE/app/node_modules" && find . -name package.json -maxdepth 3 | sort | xargs grep -h '"version"' 2>/dev/null); (cd "$STAGE/heavy" && find . -type f -printf '%p %s\n' | sort); } | sha256sum | cut -c1-16)"
echo "运行环境标识：$RUNTIME_SIG"
makensis -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DRUNTIME_SIG="$RUNTIME_SIG" -DOUTFILE="$ROOT/dist/DuanjuStudio-Setup-$VERSION.exe" installer.nsi
# 升级包：只有程序文件，装在已有的完整安装之上（运行环境标识一致才允许）
makensis -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DRUNTIME_SIG="$RUNTIME_SIG" -DUPDATE=1 -DOUTFILE="$ROOT/dist/DuanjuStudio-Update-$VERSION.exe" installer.nsi
ls -la "$ROOT"/dist/*.exe
echo "完成：$ROOT/dist/DuanjuStudio-Setup-$VERSION.exe 与 DuanjuStudio-Update-$VERSION.exe"
