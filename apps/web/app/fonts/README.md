# 本地字体来源与许可

构建期不再访问 Google Fonts（离线/可复现构建，桌面发布链路要求）。

| 文件 | 字体 | 版本/来源 | 许可 |
| --- | --- | --- | --- |
| `InterVariable.woff2` | Inter Variable（roman, 全字符集） | rsms 官方发布 <https://rsms.me/inter/font-files/InterVariable.woff2>（v4.x） | SIL OFL 1.1 |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono Variable wght 100–800（latin 子集） | Google Fonts v24 静态托管产物 | SIL OFL 1.1 |

CJK 文本按 `app/globals.css` 的字体栈回退到系统字体（PingFang SC / Hiragino Sans GB 等），无需本地打包。

升级方式：替换同名文件并更新本表；`app/fonts.ts` 的 `weight` 范围需与字体实际可变轴一致。
