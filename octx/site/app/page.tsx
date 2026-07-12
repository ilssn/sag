import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Check,
  FileArchive,
  FileText,
  Fingerprint,
  Network,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { PackageVisual } from "@/components/package-visual";
import { SiteFooter } from "@/components/site-footer";

const creationCode = `from octx import create_octx, open_octx, validate_octx

release = create_octx(
    source="./knowledge",
    workspace="./my-context",
    name="SAG Technical Research",
    output="research-context.octx",
)

with open_octx("research-context.octx") as package:
    report = validate_octx(package)
    assert report.valid`;

const importCode = `from zleap_sag import import_octx

installation = import_octx("research-context.octx")

# Documents are available immediately.
# Missing local indexes continue in the background.
print(installation.status)  # installed | indexing | ready`;

const principles = [
  {
    icon: FileText,
    title: "人和 Agent 都能读",
    text: "OCTX 直接采用 OKF 兼容 Markdown。没有专用 SDK，也能打开、审阅和版本控制。",
  },
  {
    icon: Fingerprint,
    title: "身份与内容分开",
    text: "UUIDv7 保持对象身份，Package Digest 锁定精确内容，Release 负责版本演进。",
  },
  {
    icon: Network,
    title: "结构随知识一起走",
    text: "Chunk、Event、Entity、关系和向量可以随包传播，不必在每个系统重复抽取。",
  },
  {
    icon: RefreshCw,
    title: "可复用，也可重建",
    text: "向量和本地索引是加速层。兼容就复用，不兼容就从可信上游完整重建。",
  },
];

export default function HomePage() {
  return (
    <main id="main-content" className="home-page">
      <section className="hero-section">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-content">
          <p className="hero-eyebrow">
            <span /> OCTX
          </p>
          <h1>Open Context</h1>
          <h2>
            让上下文成为可以传播的<span>资产。</span>
          </h2>
          <p className="hero-copy">
            将完整 Markdown、Chunk、Event、Entity、关系和向量封装为一个开放、可验证、可移植的上下文 Package。
            一次生成，在任何兼容的知识系统与 Agent 中复用。
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/docs/introduction">
              阅读文档 <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="secondary-button" href="/docs/specification">
              查看 v0.1 规范
            </Link>
          </div>
          <div className="hero-facts" aria-label="Open Context 核心事实">
            <span>
              <Check size={15} aria-hidden="true" /> OKF compatible
            </span>
            <span>
              <Check size={15} aria-hidden="true" /> Self-contained
            </span>
            <span>
              <Check size={15} aria-hidden="true" /> Vendor-neutral
            </span>
          </div>
        </div>
      </section>

      <section className="package-band">
        <div className="section-heading">
          <p>一个文件，不只是一个文档</p>
          <h2>知识正文、结构和证据链，保持在一起。</h2>
          <span>
            `.octx` 是一份不可变的完整快照。展开后仍是清晰、开放、可逐项校验的目录，而不是某个数据库的私有备份。
          </span>
        </div>
        <PackageVisual />
      </section>

      <section className="meaning-section">
        <div className="meaning-intro">
          <p>为什么需要 Open Context</p>
          <h2>文档会传播，提取后的上下文也应该传播。</h2>
        </div>
        <div className="meaning-copy">
          <p>
            今天，一份文档进入知识系统后，会被切分、抽取、关联和向量化。这些高成本成果通常只存在于某个数据库里。
            文件离开系统，结构就消失了。
          </p>
          <p>
            Open Context 把这些成果提升为独立资产。生产者可以发布，接收者可以检查、安装、升级和追溯，Agent
            则可以直接进入正常检索路径。
          </p>
        </div>
      </section>

      <section className="principles-band">
        <div className="section-heading compact">
          <p>开放标准的边界</p>
          <h2>保留知识本身，隐藏具体实现。</h2>
        </div>
        <div className="principles-grid">
          {principles.map((principle) => {
            const Icon = principle.icon;
            return (
              <article key={principle.title}>
                <Icon size={22} aria-hidden="true" />
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="flow-section">
        <div className="section-heading compact">
          <p>从创建到召回</p>
          <h2>同一个 Package，连接生产者与消费者。</h2>
        </div>
        <div className="flow-line" aria-label="Open Context 生命周期">
          <span>
            <FileText size={18} aria-hidden="true" /> Markdown / OKF
          </span>
          <i>→</i>
          <span>
            <Boxes size={18} aria-hidden="true" /> Create
          </span>
          <i>→</i>
          <span>
            <FileArchive size={18} aria-hidden="true" /> .octx
          </span>
          <i>→</i>
          <span>
            <ShieldCheck size={18} aria-hidden="true" /> Validate
          </span>
          <i>→</i>
          <span>
            <ScanSearch size={18} aria-hidden="true" /> Retrieve
          </span>
        </div>
      </section>

      <section className="quickstart-section">
        <div className="section-heading">
          <p>开始构建</p>
          <h2>创建、打开、校验，然后导入。</h2>
          <span>
            通用 <code>octx</code> 包负责创建、打开与校验；以
            <Link className="home-doc-link" href="/docs/sag">
              SAG
            </Link>
            为例，
            <Link className="home-doc-link" href="/docs/sag">
              <code>zleap-sag</code>
            </Link>{" "}
            可以把 <code>.octx</code> 导入检索系统，也可以将系统中的上下文导出为 <code>.octx</code>。
          </span>
        </div>
        <div className="code-columns">
          <article>
            <div className="code-column-heading">
              <strong>01</strong>
              <span>
                <b>创建与校验</b>
                <small>独立 octx 包</small>
              </span>
            </div>
            <CodeBlock code={creationCode} language="python" />
          </article>
          <article>
            <div className="code-column-heading">
              <strong>02</strong>
              <span>
                <b>导入 OCTX</b>
                <small>
                  <Link className="home-doc-link" href="/docs/sag">
                    zleap-sag adapter
                  </Link>
                </small>
              </span>
            </div>
            <CodeBlock code={importCode} language="python" />
          </article>
        </div>
      </section>

      <section className="levels-section">
        <div className="section-heading compact">
          <p>渐进采用</p>
          <h2>从可读文档，到可直接导入的完整上下文。</h2>
        </div>
        <div className="levels-table-wrap">
          <table className="levels-table">
            <thead>
              <tr>
                <th>层级</th>
                <th>Markdown</th>
                <th>稳定身份 / Release</th>
                <th>Chunk / Event / Entity</th>
                <th>向量</th>
                <th>用途</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>OKF Bundle</th>
                <td>✓</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>人和 Agent 可读</td>
              </tr>
              <tr>
                <th>OCTX</th>
                <td>✓</td>
                <td>✓</td>
                <td>可选</td>
                <td>可选</td>
                <td>可传播、可校验</td>
              </tr>
              <tr>
                <th>
                  <Link className="home-doc-link" href="/docs/sag-structured">
                    SAG-structured
                  </Link>
                </th>
                <td>✓</td>
                <td>✓</td>
                <td>完整且无孤立记录</td>
                <td>可选</td>
                <td>直接导入结构层</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="final-cta">
        <div>
          <p>OPEN BY DESIGN</p>
          <h2>上下文不应该被锁在一个数据库里。</h2>
          <span>从 Open Context v0.1 开始，创建第一份可传播的上下文资产。</span>
        </div>
        <Link className="primary-button" href="/docs/specification">
          阅读规范 <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <SiteFooter />
    </main>
  );
}
