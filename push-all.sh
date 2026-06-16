#!/bin/bash
# ============================================================
# AI Morning Brief — 一键推送到 GitHub / Gitee / CNB
# 在 Mac 终端运行: chmod +x push-all.sh && ./push-all.sh
# ============================================================
set -e

REPO="personal-brief"
GITHUB_URL="https://github.com/cheyne2015/${REPO}.git"
GITEE_URL="https://gitee.com/cheyne2015/${REPO}.git"
CNB_URL="https://cnb.cool/cheyne2015/${REPO}.git"

echo ""
echo "🚀 AI Morning Brief — 推送到三个平台"
echo "========================================"

# ---- CNB ----
echo ""
echo "📦 [1/3] 推送 CNB..."
if git push cnb main 2>/dev/null; then
    echo "✅ CNB 推送成功 → https://cnb.cool/cheyne2015/${REPO}"
else
    echo "⚠️  CNB 推送失败，可能需要先设置 CNB CLI: cnb login"
fi

# ---- Gitee ----
echo ""
echo "📦 [2/3] 推送 Gitee..."
if git push gitee main 2>/dev/null; then
    echo "✅ Gitee 推送成功 → https://gitee.com/cheyne2015/${REPO}"
else
    echo "⚠️  Gitee 推送需要认证，请使用以下任一方式:"
    echo "   方式 A: 设置 SSH key → git remote set-url gitee git@gitee.com:cheyne2015/${REPO}.git && git push gitee main"
    echo "   方式 B: 使用 HTTPS + 密码/Token → git push gitee main (会提示输入用户名和密码)"
fi

# ---- GitHub ----
echo ""
echo "📦 [3/3] 推送 GitHub..."
if git push github main 2>/dev/null; then
    echo "✅ GitHub 推送成功 → https://github.com/cheyne2015/${REPO}"
else
    echo "⚠️  GitHub 推送需要认证，请使用以下任一方式:"
    echo ""
    echo "   方式 A (推荐): 使用 GitHub CLI"
    echo "     brew install gh          # 如果未安装"
    echo "     gh auth login            # 登录"
    echo "     git push github main"
    echo ""
    echo "   方式 B: 使用 Personal Access Token"
    echo "     1. 访问 https://github.com/settings/tokens"
    echo "     2. 创建 Classic Token (勾选 repo 权限)"
    echo "     3. 运行: git push https://YOUR_TOKEN@github.com/cheyne2015/${REPO}.git main"
    echo ""
    echo "   方式 C: 使用 SSH"
    echo "     git remote set-url github git@github.com:cheyne2015/${REPO}.git"
    echo "     git push github main"
fi

echo ""
echo "========================================"
echo "✨ 推送完成！"
echo ""
echo "仓库地址:"
echo "  GitHub: https://github.com/cheyne2015/${REPO}"
echo "  Gitee:  https://gitee.com/cheyne2015/${REPO}"
echo "  CNB:    https://cnb.cool/cheyne2015/${REPO}"
echo ""
