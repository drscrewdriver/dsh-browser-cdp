import sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'E:/test/rewrite-agently/mine-dsh-plugins/dsh-browser-cdp/src/index.ts'
d = open(p, encoding='utf-8').read()
idx = d.index('in a raw heredoc')
region = d[idx:idx+45]
print('REPR:', repr(region))
print('CODEPOINTS around FFFD:', [(i, hex(ord(c))) for i,c in enumerate(region) if ord(c) > 0x2500])
