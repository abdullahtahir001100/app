const fs = require('fs');

const md = fs.readFileSync('SYSTEM_ARCHITECTURE_AND_FLOW.md', 'utf8');
const parts = md.split('```mermaid');
console.log(`Found ${parts.length - 1} mermaid blocks.`);

let d4 = "";
for (let i = 1; i < parts.length; i++) {
  const code = parts[i].split('```')[0].trim();
  if (code.includes('LayerSettings') || code.includes('ai_verifier') || code.includes('heal_ai')) {
    console.log(`Found AI Architecture diagram at index ${i}`);
    d4 = code;
    break;
  }
}

console.log("=== DIAGRAM 4 CONTENT ===");
console.log(d4);
