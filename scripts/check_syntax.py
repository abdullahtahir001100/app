import re

with open('SYSTEM_ARCHITECTURE_AND_FLOW.md', 'r', encoding='utf-8') as f:
    text = f.read()

parts = text.split("```mermaid")
print(f"Total mermaid blocks: {len(parts)-1}")

for i in range(1, len(parts)):
    code = parts[i].split("```")[0].strip()
    print(f"\n================ BLOCK {i} ================")
    lines = code.splitlines()
    print(f"First line: {lines[0]}")
    # check common Mermaid syntax hazards:
    # 1. unquoted brackets in labels: e.g. ["Label (Info)"] is good, [Label (Info)] is BAD!
    # 2. semicolons or special characters inside node text
    # 3. labels with special chars like <br/> or : without quotes
    for line_idx, line in enumerate(lines):
        line_clean = line.strip()
        # Look for [ without following " or '
        # e.g., A[Some text (with parens)] -> syntax error
        if re.search(r'\[[^"\'][^\]]*[\(\):][^\]]*\]', line_clean):
            print(f"  Line {line_idx+1} POTENTIAL ERROR: {line_clean}")
