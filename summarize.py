import re
with open('/workspace/diff.txt', 'r') as f:
    diff = f.read()
files = diff.split('diff --git ')
for file in files[1:]:
    lines = file.split('\n')
    header = lines[0]
    path = header.split(' b/')[-1]
    if 'manifest.json' in path:
        print(file)
