// Wraps scene content into a full HTML document for Puppeteer capture.

export function wrapInHtml(content: string, css: string, width: number, height: number): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans:wght@400;600;700&family=Montserrat:wght@400;700;800&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
  ${css}
</style>
</head><body>${content}</body></html>`;
}
