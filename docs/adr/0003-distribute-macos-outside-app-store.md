# macOS 客户端采用 App Store 外直接分发

macOS 首版客户端通过开发者签名与 Apple 公证后的 DMG 直接分发，不以 Mac App Store 上架为目标。桌面伴随形态需要透明窗口，而 Tauri 在 macOS 上实现透明窗口必须启用 `macOSPrivateApi`，官方明确说明这会阻止应用被 Mac App Store 接受；选择直接分发可以保留透明宠物这一核心体验，代价是需要自行托管下载、更新与版本信任链，并维护签名、公证和 Gatekeeper 验证流程。
