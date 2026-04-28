import re
with open('/workspace/diff.txt', 'r') as f:
    diff = f.read()
files = diff.split('diff --git ')
for file in files[1:]:
    lines = file.split('\n')
    header = lines[0]
    path = header.split(' b/')[-1]
    if 'offscreen' in path or 'extractor' in path or 'protocol' in path or 'examples' in path:
        print(f"--- {path} ---")
        print('\n'.join(lines[1:20]))
