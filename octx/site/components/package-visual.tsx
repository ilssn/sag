import { Braces, FileText, Fingerprint, Network, Orbit } from "lucide-react";

const layers = [
  {
    className: "knowledge",
    icon: FileText,
    title: "knowledge/",
    detail: "Markdown + YAML frontmatter",
    files: ["index.md", "concepts/*.md"],
  },
  {
    className: "structure",
    icon: Braces,
    title: "data/",
    detail: "Portable semantic records",
    files: ["chunks.jsonl", "events.jsonl", "entities.jsonl"],
  },
  {
    className: "relations",
    icon: Network,
    title: "relations/",
    detail: "Explicit evidence chain",
    files: ["chunk-events.jsonl", "event-entities.jsonl"],
  },
  {
    className: "vectors",
    icon: Orbit,
    title: "vectors/",
    detail: "Optional, rebuildable acceleration",
    files: ["config.json", "*.arrow"],
  },
];

export function PackageVisual() {
  return (
    <div className="package-visual" aria-label="OCTX Package 文件结构示意">
      <div className="package-titlebar">
        <span className="file-fold" aria-hidden="true" />
        <strong>research-context.octx</strong>
        <em>ZIP / ZIP64</em>
      </div>

      <div className="package-manifest">
        <Fingerprint size={18} aria-hidden="true" />
        <span>
          <strong>manifest.json</strong>
          <small>Asset identity · Release · Package Digest</small>
        </span>
        <code>sha256:9bd4…e31a</code>
      </div>

      <div className="package-layers">
        {layers.map((layer) => {
          const Icon = layer.icon;
          return (
            <section className={`package-layer ${layer.className}`} key={layer.title}>
              <div>
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{layer.title}</strong>
                  <small>{layer.detail}</small>
                </span>
              </div>
              <p>
                {layer.files.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </p>
            </section>
          );
        })}
      </div>

      <div className="package-chain" aria-label="SAG structured evidence chain">
        <span>Document</span>
        <i>→</i>
        <span>Chunk</span>
        <i>→</i>
        <span>Event</span>
        <i>→</i>
        <span>Entity</span>
      </div>
    </div>
  );
}
