import ReactMarkdown from "react-markdown";

// Strict allowlist (PRODUCT §7.2): headings h2–h4, bold, italic, code, links,
// lists, blockquote. react-markdown does NOT render raw HTML by default, so no
// rehype-raw is added — this is XSS-safe.
const ALLOWED = [
  "p", "br", "strong", "em", "code", "pre",
  "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a",
];

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={safeHref(href)} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
