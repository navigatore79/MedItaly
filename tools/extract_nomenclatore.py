"""Extract a search index from the official Ministry PDF; keep the PDF authoritative."""
import json
import re
import sys
import fitz

source, destination = sys.argv[1:3]
pattern = re.compile(r'^(?:(?:H|R|MR)\n)*((?:\d{2}\.[0-9A-Z]+(?:\.[0-9A-Z]+)?|G\d{3}))\n')
items = []
seen = set()
for page_number, page in enumerate(fitz.open(source), start=1):
    blocks = [block[4].strip() for block in page.get_text('blocks')]
    for index, block in enumerate(blocks):
        match = pattern.match(block)
        if not match or match.group(1) in seen or match.group(1).startswith('G'):
            continue
        description = block[match.end():]
        if not description and index + 1 < len(blocks):
            description = blocks[index + 1]
        label = re.sub(r'\s+', ' ', description.splitlines()[0]).strip()[:170] if description else ''
        if len(label) < 5 or re.match(r'^\d+$', label):
            continue
        seen.add(match.group(1))
        items.append({'code': match.group(1), 'label': label, 'page': page_number})
with open(destination, 'w', encoding='utf-8') as output:
    json.dump({'source': 'Ministero della Salute · DPCM LEA 12 gennaio 2017, Allegato 4', 'items': items}, output, ensure_ascii=False, separators=(',', ':'))
print(len(items))
