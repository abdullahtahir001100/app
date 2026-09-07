const fs = require('fs');

// Mermaid 11 uses ES module or browser window, but we can test via parsing or simple regex
const md = fs.readFileSync('SYSTEM_ARCHITECTURE_AND_FLOW.md', 'utf8');
const parts = md.split('```mermaid');

console.log(`Checking ${parts.length - 1} diagrams...`);

for (let i = 1; i < parts.length; i++) {
  const code = parts[i].split('```')[0].trim();
  const firstLine = code.split('\n')[0];
  console.log(`\nDiagram ${i}: ${firstLine}`);
  
  // Check illegal patterns:
  // 1. <--> with |label|
  const badBi = code.match(/<-->\|.*?\|/g);
  if (badBi) {
    console.error(`  [!] Error: <--> with label: ${badBi.join(', ')}`);
  }
  // 2. -->> with colon in flowchart
  const badArrowColon = code.match(/-->>\s*\w+:/g);
  if (badArrowColon) {
    console.error(`  [!] Error: -->> with colon: ${badArrowColon.join(', ')}`);
  }
  // 3. Unquoted parens/commas in edge label
  const badEdgeChars = code.match(/\|[^"|\n]*[(),?][^"|\n]*\|/g);
  if (badEdgeChars) {
    console.error(`  [!] Error: Unquoted special chars in label: ${badEdgeChars.join(', ')}`);
  }
  // 4. graph TB with nested subgraphs
  if (firstLine.startsWith('graph')) {
    const subgraphs = (code.match(/subgraph /g) || []).length;
    const ends = (code.match(/end\b/g) || []).length;
    if (subgraphs > 2) {
      console.warn(`  [!] Warning: 'graph' used with ${subgraphs} subgraphs. Use 'flowchart' instead.`);
    }
  }
}
