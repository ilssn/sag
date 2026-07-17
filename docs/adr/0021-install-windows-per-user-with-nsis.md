---
status: accepted
---

# Windows 以 NSIS 按用户安装

Windows 安装包使用 NSIS `perUser` 模式（安装到 `%LOCALAPPDATA%\Programs`，零 UAC 提权），而非 MSI：免管理员安装契合个人知识库的单用户定位，自托管更新器可在无提权下原地换装，NSIS 亦自带多语言。MSI 的企业 GPO 分发能力不在 V1 需求内。WebView2 采用 embedBootstrapper（安装包增加约 2MB，换取离线安装能力）。V1 暂不做 Windows 代码签名：SmartScreen 将显示「未知发布者」警告，文档中向用户说明；发布流水线预留 signCommand 接入位（Azure Trusted Signing / SSL.com），取得证书后一键启用。
