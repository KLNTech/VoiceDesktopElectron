#!/usr/bin/env python3
"""Render the Markdown subset this repository's documents use into one print-ready HTML page.

Deliberately not a Markdown implementation. It covers headings, fenced code, tables, lists,
blockquotes, rules, paragraphs and four inline forms - which is everything `docs/*.md` uses -
and nothing else. A dependency-free renderer that handles the documents we actually write beats
pulling a parser into a repo whose whole point is that it stays small.

    scripts/md2html.py OUT.html TITLE IN.md [IN.md ...]
"""
import html
import re
import sys

INLINE_CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<![*\w])\*([^*\n]+)\*(?!\*)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
AUTOLINK = re.compile(r"<(https?://[^>]+)>")


def inline(text: str) -> str:
    """Code spans and links are lifted out of the RAW text, then what is left is escaped.

    Escaping first and lifting afterwards double-escapes every code span - `a && b` renders as
    `a &amp;&amp; b` - because the lifted text has already been through html.escape once.
    """
    spans: list[str] = []

    def stash(fragment: str) -> str:
        spans.append(fragment)
        return f"\x00{len(spans) - 1}\x00"

    text = INLINE_CODE.sub(lambda m: stash(f"<code>{html.escape(m.group(1))}</code>"), text)
    text = AUTOLINK.sub(
        lambda m: stash(f'<a href="{html.escape(m.group(1), quote=True)}">'
                        f"{html.escape(m.group(1))}</a>"),
        text,
    )
    text = LINK.sub(
        lambda m: stash(f'<a href="{html.escape(m.group(2), quote=True)}">'
                        f"{inline(m.group(1))}</a>"),
        text,
    )
    text = html.escape(text, quote=False)
    text = BOLD.sub(r"<strong>\1</strong>", text)
    text = ITALIC.sub(r"<em>\1</em>", text)
    return re.sub(r"\x00(\d+)\x00", lambda m: spans[int(m.group(1))], text)


def render_table(rows: list[str]) -> str:
    def cells(line: str) -> list[str]:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    head, body = cells(rows[0]), [cells(r) for r in rows[2:]]
    out = ["<table><thead><tr>"]
    out += [f"<th>{inline(c)}</th>" for c in head]
    out.append("</tr></thead><tbody>")
    for row in body:
        out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def render(md: str) -> str:
    lines = md.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if line.startswith("```"):
            lang = line[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            cls = f' class="lang-{html.escape(lang)}"' if lang else ""
            out.append(f"<pre{cls}><code>{html.escape(chr(10).join(buf))}</code></pre>")
            continue

        if not line.strip():
            i += 1
            continue

        if re.fullmatch(r"\s*(-{3,}|_{3,}|\*{3,})\s*", line):
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"(#{1,6})\s+(.*)", line)
        if m:
            level = len(m.group(1))
            out.append(f"<h{level}>{inline(m.group(2).strip())}</h{level}>")
            i += 1
            continue

        if line.lstrip().startswith("|") and i + 1 < len(lines) and re.match(
            r"\s*\|[\s:|-]+\|\s*$", lines[i + 1]
        ):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(lines[i])
                i += 1
            out.append(render_table(rows))
            continue

        if line.lstrip().startswith(">"):
            buf = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            out.append(f"<blockquote>{render(chr(10).join(buf))}</blockquote>")
            continue

        m = re.match(r"(\s*)([-*+]|\d+\.)\s+(.*)", line)
        if m:
            ordered = m.group(2)[0].isdigit()
            tag = "ol" if ordered else "ul"
            items: list[str] = []
            while i < len(lines):
                mm = re.match(r"(\s*)([-*+]|\d+\.)\s+(.*)", lines[i])
                if mm and len(mm.group(1)) == 0:
                    items.append(mm.group(3))
                    i += 1
                elif items and lines[i].startswith(("  ", "\t")) and lines[i].strip():
                    items[-1] += " " + lines[i].strip()  # continuation of the previous item
                    i += 1
                else:
                    break
            body = "".join(f"<li>{inline(it)}</li>" for it in items)
            out.append(f"<{tag}>{body}</{tag}>")
            continue

        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(
            r"\s*(#{1,6}\s|```|\||>|[-*+]\s|\d+\.\s)", lines[i]
        ):
            buf.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(buf))}</p>")

    return "\n".join(out)


CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
:root { --ink:#16181d; --muted:#5b6270; --rule:#d9dde5; --code-bg:#f5f6f8; --accent:#3f4cf0; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
       color: var(--ink); margin:0; }
h1 { font-size: 21pt; letter-spacing:-.02em; margin: 0 0 .3em; page-break-before: always; }
h1:first-of-type { page-break-before: avoid; }
h2 { font-size: 14pt; margin: 1.5em 0 .4em; padding-bottom:.25em; border-bottom:1px solid var(--rule); }
h3 { font-size: 11.5pt; margin: 1.2em 0 .3em; }
h4 { font-size: 10.5pt; margin: 1em 0 .25em; color: var(--muted); }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 1.25em; margin: .5em 0; }
li { margin: .18em 0; }
a { color: var(--accent); text-decoration: none; }
code { font: 9pt/1.4 "SF Mono", ui-monospace, Menlo, monospace; background: var(--code-bg);
       padding: .1em .32em; border-radius: 3px; }
pre { background: var(--code-bg); border: 1px solid var(--rule); border-radius: 6px;
      padding: .7em .9em; overflow-x: auto; page-break-inside: avoid; margin: .7em 0; }
pre code { background: none; padding: 0; font-size: 8.2pt; line-height: 1.45; white-space: pre; }
@media print { pre { overflow-x: hidden; } }
blockquote { margin: .8em 0; padding: .5em .9em; border-left: 3px solid var(--accent);
             background: #f7f8ff; color: var(--muted); page-break-inside: avoid; }
blockquote p { margin: .25em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9pt;
        page-break-inside: avoid; }
th, td { border: 1px solid var(--rule); padding: .38em .55em; text-align: left;
         vertical-align: top; }
th { background: var(--code-bg); font-weight: 600; }
hr { border: none; border-top: 1px solid var(--rule); margin: 1.6em 0; }
.doc-meta { color: var(--muted); font-size: 9pt; margin-bottom: 1.5em; }
"""


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    out_path, title, sources = sys.argv[1], sys.argv[2], sys.argv[3:]
    body = "\n".join(render(open(s, encoding="utf-8").read()) for s in sources)
    page = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head><body>"
        f"{body}</body></html>"
    )
    open(out_path, "w", encoding="utf-8").write(page)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
