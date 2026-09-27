#!/usr/bin/env python3
"""
Assemble the handover document from its parts, then normalise every inline SVG
so it renders identically in a browser AND in WeasyPrint/cairosvg.

Why the SVG rewriting step exists:
  The diagrams are authored with a <style> block and CSS classes, which is far
  more readable to maintain. Browsers handle that fine. WeasyPrint ignores CSS
  inside <svg> entirely, and cairosvg silently drops any rule containing
  `text-transform`. Both produce garbled output. This script converts every
  class into equivalent inline presentation attributes, which every renderer
  understands, and scopes the arrowhead marker IDs per figure so each SVG is
  self-contained rather than depending on IDs defined in an earlier figure.

Usage:  python3 build.py
Output: OCAR_INFRASTRUCTURE_HANDOVER.html  (+ .pdf if weasyprint is installed)
"""
import re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = [f"part{i}.html" for i in range(1, 10)]
OUT_HTML = os.path.join(HERE, "OCAR_INFRASTRUCTURE_HANDOVER.html")
OUT_PDF = os.path.join(HERE, "OCAR_INFRASTRUCTURE_HANDOVER.pdf")

# CSS properties that have a direct SVG presentation-attribute equivalent.
ATTR_OK = {
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'rx', 'ry',
    'font-size', 'font-family', 'font-weight', 'font-style', 'letter-spacing',
    'marker-end', 'marker-start', 'opacity', 'fill-opacity', 'stroke-opacity',
    'text-anchor', 'dominant-baseline', 'stroke-linecap', 'stroke-linejoin',
}


def parse_style(css):
    rules = {}
    for m in re.finditer(r'\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}', css):
        props = {}
        for decl in m.group(2).split(';'):
            if ':' in decl:
                k, v = decl.split(':', 1)
                props[k.strip()] = v.strip()
        rules[m.group(1)] = props
    return rules


def expand_font(props):
    """`font: 600 11px Inter,sans-serif` -> discrete font-* attributes."""
    out = dict(props)
    f = out.pop('font', None)
    if not f:
        return out
    m = re.match(r'^\s*(italic\s+)?(\d{3})?\s*([\d.]+px)\s+(.+)$', f)
    if m:
        if m.group(1):
            out['font-style'] = 'italic'
        if m.group(2):
            out['font-weight'] = m.group(2)
        out['font-size'] = m.group(3)
        out['font-family'] = m.group(4).strip()
    return out


def marker_defs(sfx):
    def one(mid, colour):
        return (f'<marker id="{mid}{sfx}" viewBox="0 0 10 10" refX="9" refY="5" '
                f'markerWidth="7" markerHeight="7" markerUnits="strokeWidth" '
                f'orient="auto-start-reverse">'
                f'<path d="M0,0 L10,5 L0,10 z" fill="{colour}"/></marker>')
    return '<defs>' + one('ar', '#5b6b7d') + one('ara', '#0e7490') + one('ard', '#9b2226') + '</defs>'


def inline_one(svg, index):
    sfx = f'-f{index}'
    sm = re.search(r'<style>([\s\S]*?)</style>', svg)
    rules = {k: expand_font(v) for k, v in parse_style(sm.group(1)).items()} if sm else {}

    # Uppercase the text of any class declaring text-transform, before classes are stripped.
    for cls, props in rules.items():
        if props.get('text-transform') == 'uppercase':
            svg = re.sub(
                r'(<text[^>]*class="[^"]*\b' + re.escape(cls) + r'\b[^"]*"[^>]*>)([^<]*)(</text>)',
                lambda m: m.group(1) + m.group(2).upper() + m.group(3), svg)

    # Drop the authoring-time defs/markers/style; they are re-added scoped below.
    svg = re.sub(r'<defs>[\s\S]*?</defs>', '', svg)
    svg = re.sub(r'<marker[\s\S]*?</marker>', '', svg)
    svg = re.sub(r'<style>[\s\S]*?</style>', '', svg)

    def rewrite(m):
        tag, attrs, selfclose = m.group(1), m.group(2), m.group(3)
        cm = re.search(r'\bclass="([^"]*)"', attrs)
        if not cm:
            return m.group(0)
        merged = {}
        for c in cm.group(1).split():
            for k, v in rules.get(c, {}).items():
                if k in ATTR_OK:
                    merged[k] = v
        attrs = (attrs[:cm.start()] + attrs[cm.end():]).strip()
        existing = set(re.findall(r'\b([a-zA-Z-]+)=', attrs))   # inline attrs win
        add = ' '.join(f'{k}="{v}"' for k, v in merged.items() if k not in existing)
        body = ' '.join(p for p in (attrs, add) if p)
        return f'<{tag} {body}{selfclose}>'

    svg = re.sub(r'<(text|rect|path|line|circle|polygon)\s([^>]*?)(/?)>', rewrite, svg)

    # Scope marker references to this figure.
    svg = svg.replace('url(#ar-a)', f'url(#ara{sfx})').replace('url(#ar-d)', f'url(#ard{sfx})')
    svg = re.sub(r'url\(#ar\)', f'url(#ar{sfx})', svg)

    # Opaque background + this figure's own markers.
    svg = re.sub(r'(<svg[^>]*>)',
                 r'\1<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>' + marker_defs(sfx),
                 svg, count=1)
    return svg


def main():
    missing = [p for p in PARTS if not os.path.exists(os.path.join(HERE, p))]
    if missing:
        sys.exit(f"missing source parts: {missing}")

    doc = ''.join(open(os.path.join(HERE, p), encoding='utf-8').read() for p in PARTS)

    for i, svg in enumerate(re.findall(r'<svg[\s\S]*?</svg>', doc), 1):
        doc = doc.replace(svg, inline_one(svg, i))

    open(OUT_HTML, 'w', encoding='utf-8').write(doc)
    print(f"html: {OUT_HTML}  ({len(doc):,} bytes)")

    # Every marker referenced must be defined within the same figure.
    for i, svg in enumerate(re.findall(r'<svg[\s\S]*?</svg>', doc), 1):
        refs = set(re.findall(r'url\(#([^)]+)\)', svg))
        ids = set(re.findall(r'<marker id="([^"]+)"', svg))
        assert not (refs - ids), f"figure {i} references undefined markers: {refs - ids}"
    print("marker scoping: ok")

    try:
        from weasyprint import HTML
        HTML(OUT_HTML).write_pdf(OUT_PDF)
        print(f"pdf:  {OUT_PDF}")
    except ImportError:
        print("weasyprint not installed — skipped PDF")


if __name__ == '__main__':
    main()
