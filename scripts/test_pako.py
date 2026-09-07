import urllib.request
import json
import base64
import zlib

with open('/Users/muhammadzubair/Desktop/app/SYSTEM_ARCHITECTURE_AND_FLOW.md', 'r') as f:
    text = f.read()

# Split by ```mermaid
parts = text.split("```mermaid")
print(f"Total parts found: {len(parts)-1}")

block = parts[1].split("```")[0].strip()
print(f"Diagram 1 lines: {len(block.splitlines())}")

obj = {'code': block, 'mermaid': {'theme': 'default'}}
json_str = json.dumps(obj)

# Pako deflate raw (wbits=-15)
compressor = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=-15)
deflated = compressor.compress(json_str.encode('utf-8')) + compressor.flush()
b64 = base64.urlsafe_b64encode(deflated).decode('ascii')
url = 'https://mermaid.ink/img/pako:' + b64
print('Pako URL length:', len(url))

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})
try:
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = resp.read()
        print('SUCCESS! Downloaded PNG of Diagram 1, size:', len(data))
        with open('/Users/muhammadzubair/Desktop/app/public/diagrams/01_master_all_to_all_architecture.png', 'wb') as out:
            out.write(data)
        print('Saved to public/diagrams/01_master_all_to_all_architecture.png')
except Exception as e:
    print('Failed with:', e)
